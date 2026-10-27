import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { positionLocal, sin, uniform, uv, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS } from '../constants/blocks.js';

function randomAt(x, z) {
  let state = ((x * 73856093) ^ (z * 19349663)) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function branch(points, baseRadius, tipRadius, segments = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const sides = 10, geometry = new THREE.TubeGeometry(curve, segments, 1, sides, false);
  const positions = geometry.attributes.position, uv = geometry.attributes.uv, length = curve.getLength();
  for (let i = 0; i <= segments; i++) {
    const center = curve.getPointAt(i / segments), radius = THREE.MathUtils.lerp(baseRadius, tipRadius, i / segments);
    for (let j = 0; j <= sides; j++) {
      const k = i * (sides + 1) + j;
      positions.setXYZ(k, center.x + (positions.getX(k) - center.x) * radius,
        center.y + (positions.getY(k) - center.y) * radius, center.z + (positions.getZ(k) - center.z) * radius);
      uv.setXY(k, j / sides * Math.PI * baseRadius * 2, i / segments * length);
    }
  }
  geometry.computeVertexNormals(); return geometry;
}

export class Vegetation {
  constructor(barkMaterial) {
    this.barkMaterial = barkMaterial;
    this.treeTemplates = new Map();
    this.leafGeometry = new THREE.PlaneGeometry(.36, .72, 1, 2);
    // A shallow folded blade catches light differently on each side of the leaf vein.
    const positions = this.leafGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setZ(i, Math.abs(positions.getX(i)) * -.15);
    this.leafGeometry.computeVertexNormals();
    let resolveLeaf, rejectLeaf;
    this.ready = new Promise((resolve, reject) => { resolveLeaf = resolve; rejectLeaf = reject; });
    const map = new THREE.TextureLoader().load('/textures/vegetation/leaf-color.png', resolveLeaf, undefined, () => {
      const status = document.getElementById('menu-status');
      if (status) status.textContent = 'Leaf textures could not load. Reload to retry.';
      rejectLeaf(new Error('Leaf textures could not load'));
    });
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    this.leafMaterial = new MeshStandardNodeMaterial({ name: 'Living oak foliage', map, alphaTest: .45,
      side: THREE.DoubleSide, roughness: .85, metalness: 0, alphaToCoverage: true, vertexColors: true });
    this.wind = uniform(0);
    // Leaves are baked into world space, so the sway is in world axes; shortcut: phase comes from the vertex, not the leaf origin.
    const phase = positionLocal.x.mul(.37).add(positionLocal.z.mul(.29));
    this.leafMaterial.positionNode = positionLocal.add(vec3(
      sin(this.wind.mul(1.35).add(phase)).mul(.065).mul(uv().y), 0, sin(this.wind.mul(.83).add(phase)).mul(.035).mul(uv().y)));
  }

  build(chunk, world, camera = { x: 8, z: 12 }) {
    const group = new THREE.Group(); group.name = `vegetation-${chunk.cx},${chunk.cz}`;
    group.userData.center = new THREE.Vector3(chunk.cx * 16 + 8, 0, chunk.cz * 16 + 8);
    const wood = [], leaves = [], tint = new THREE.Color(), object = new THREE.Object3D();
    const leaf = (x, y, z, scale, random, ground = false, shadow = true) => {
      object.position.set(x, y, z);
      object.rotation.set(ground ? -.3 - random() * 1.3 : random() * Math.PI, random() * Math.PI * 2, random() * .9 - .45);
      object.scale.setScalar(scale); object.updateMatrix();
      tint.setHSL(.24 + random() * .035, .26 + random() * .16, .25 + random() * .20);
      leaves.push({ matrix: object.matrix.clone(), color: tint.clone(), shadow });
    };
    for (const tree of chunk.trees) {
      const random = randomAt(tree.x, tree.z), centerX = tree.x + tree.width / 2, centerZ = tree.z + tree.width / 2;
      let highest = 0;
      for (let y = 0; y < tree.height; y++) for (let x = 0; x < tree.width; x++) for (let z = 0; z < tree.width; z++) {
        if (world.getBlock(tree.x + x, tree.y + y, tree.z + z) === BLOCKS.WOOD_LOG
          && world.getNaturalTree(tree.x + x, tree.y + y, tree.z + z)?.id === tree.id) highest = Math.max(highest, y + 1);
      }
      if (!highest) continue;
      const large = tree.width > 1, radius = large ? .95 : .43;
      const crownY = tree.y + (large ? 8.5 : 4.4), crownRadius = large ? 4.6 : 2.65;
      const geometry = this._treeGeometry(tree, highest).clone();
      // Templates share branch structure; roots still settle onto this tree's actual ground.
      const positions = geometry.attributes.position, ground = new Map();
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        if (y > .25) continue;
        const x = Math.floor(centerX + positions.getX(i)), z = Math.floor(centerZ + positions.getZ(i)), key = `${x},${z}`;
        if (!ground.has(key)) ground.set(key, Math.min(0, world.surfaceHeight(x, z) + 1 - tree.y));
        positions.setY(i, y + ground.get(key) * (1 - Math.max(0, y) / .25));
      }
      geometry.translate(centerX, tree.y, centerZ); wood.push(geometry);
      // Individual cutout leaves follow an uneven ellipsoid, not the old cube surfaces.
      for (let x = tree.x - tree.radius; x <= tree.x + tree.radius; x++)
        for (let z = tree.z - tree.radius; z <= tree.z + tree.radius; z++)
          for (let y = tree.y + highest; y < tree.y + tree.crown; y++) {
            if (!world.isNaturalLeaf(x, y, z) || world.getNaturalTree(x, y, z)?.id !== tree.id) continue;
            for (let n = 0; n < (large ? 10 : 20); n++) {
              const lx = x + random(), ly = y + random(), lz = z + random();
              const dx = (lx - centerX) / crownRadius, dz = (lz - centerZ) / crownRadius;
              const dy = (ly - crownY) / (large ? 3.1 : 1.95);
              if (dx * dx + dy * dy + dz * dz > 1.12 + random() * .14) continue;
              leaf(lx, ly, lz, .56 + random() * .54, random);
            }
          }
    }
    // Low growing herbs avoid roads, floors, and player-cleared ground.
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const wx = chunk.cx * 16 + x, wz = chunk.cz * 16 + z, random = randomAt(wx, wz);
      if (world.getRegion(wx, wz).id !== 'hearthwood' || random() > .13) continue;
      const y = world.surfaceHeight(wx, wz);
      if (world.getBlock(wx, y, wz) !== BLOCKS.GRASS || world.getBlock(wx, y + 1, wz) !== BLOCKS.AIR) continue;
      const px = wx + .2 + random() * .6, pz = wz + .2 + random() * .6;
      for (let n = 0; n < 7; n++) {
        const angle = n * 2.399, reach = .09 + random() * .16;
        leaf(px + Math.cos(angle) * reach, y + 1.18 + random() * .14, pz + Math.sin(angle) * reach, .42 + random() * .24, random, true, false);
      }
    }
    if (wood.length) {
      const mesh = new THREE.Mesh(mergeGeometries(wood, false), this.barkMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true; group.add(mesh);
      wood.forEach(geometry => geometry.dispose());
    }
    for (const shadow of [true, false]) {
      const batch = leaves.filter(entry => entry.shadow === shadow);
      // A stable shuffled prefix keeps every canopy represented as instance counts change.
      const shuffle = randomAt(chunk.cx + 991, chunk.cz - 731);
      for (let i = batch.length - 1; i > 0; i--) {
        const j = Math.floor(shuffle() * (i + 1)); [batch[i], batch[j]] = [batch[j], batch[i]];
      }
      if (!batch.length) continue;
      const mesh = new THREE.Mesh(this._leafGeometry(batch), this.leafMaterial);
      mesh.userData.fullCount = batch.length; mesh.userData.herbs = !shadow; mesh.userData.leaves = true;
      mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh);
    }
    this.setLod(group, camera);
    return group;
  }

  // Leaves are baked into one plain mesh per chunk: three's node renderer builds a separate shader for every
  // InstancedMesh (its matrix array length and uuid are part of the program key), ~20 ms each as chunks stream in.
  // shortcut: ~290 B per leaf of vertex data instead of 64 B of instance matrix, fine at today's chunk counts; go back to InstancedMesh if three shares instanced programs.
  _leafGeometry(batch) {
    const src = this.leafGeometry, n = src.attributes.position.count, indexCount = src.index.count;
    const position = new Float32Array(batch.length * n * 3), normal = new Float32Array(batch.length * n * 3),
      uvs = new Float32Array(batch.length * n * 2), color = new Float32Array(batch.length * n * 3), index = new Uint32Array(batch.length * indexCount);
    const p = new THREE.Vector3(), nm = new THREE.Matrix3();
    batch.forEach((entry, i) => {
      nm.getNormalMatrix(entry.matrix);
      for (let v = 0; v < n; v++) {
        const o = i * n + v;
        p.fromBufferAttribute(src.attributes.position, v).applyMatrix4(entry.matrix).toArray(position, o * 3);
        p.fromBufferAttribute(src.attributes.normal, v).applyMatrix3(nm).normalize().toArray(normal, o * 3);
        uvs.set([src.attributes.uv.getX(v), src.attributes.uv.getY(v)], o * 2);
        entry.color.toArray(color, o * 3);
      }
      for (let k = 0; k < indexCount; k++) index[i * indexCount + k] = i * n + src.index.getX(k);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.userData.indicesPerLeaf = indexCount;
    geometry.computeBoundingSphere(); return geometry;
  }

  _treeGeometry(tree, highest) {
    const variant = ((tree.x * 13 ^ tree.z * 7) >>> 0) % 8;
    const key = `${tree.width},${highest},${variant}`;
    if (this.treeTemplates.has(key)) return this.treeTemplates.get(key);
    const random = randomAt(variant + 71, tree.width), large = tree.width > 1, radius = large ? .95 : .43;
    const crownY = large ? 8.5 : 4.4, crownRadius = large ? 4.6 : 2.65, wood = [];
    wood.push(branch([[0, -.08, 0], [.13, highest * .5, -.08], [-.12, highest + (large ? 3 : 1.3), .1]], radius, radius * .19, 16));
    for (let root = 0; root < (large ? 7 : 4); root++) {
      const angle = root * 2.399 + random() * .3, reach = radius * (1.8 + random());
      wood.push(branch([[0, radius * 1.1, 0], [Math.cos(angle) * reach * .55, .16, Math.sin(angle) * reach * .55],
        [Math.cos(angle) * reach, .045, Math.sin(angle) * reach]], radius * .32, .025, 5));
    }
    for (let limb = 0; limb < (large ? 14 : 9); limb++) {
      const angle = limb * 2.399 + random() * .4, reach = crownRadius * (.56 + random() * .38);
      const startY = highest * (.62 + random() * .35);
      const end = [Math.cos(angle) * reach, crownY + (random() - .4) * (large ? 3.5 : 1.9), Math.sin(angle) * reach];
      wood.push(branch([[0, startY, 0], [Math.cos(angle) * reach * .42, (startY + end[1]) * .5 + .3, Math.sin(angle) * reach * .42], end], radius * .32, .022, 8));
    }
    const geometry = mergeGeometries(wood, false); wood.forEach(part => part.dispose());
    this.treeTemplates.set(key, geometry); return geometry;
  }

  setLod(group, camera) {
    const center = group.userData.center;
    const distance = Math.hypot(camera.x - center.x, camera.z - center.z);
    const density = distance > 42 ? .2 : distance > 24 ? .65 : 1;
    for (const mesh of group.children) {
      if (mesh.userData.leaves) {
        // The shuffled prefix of the baked leaves is the LOD: draw range counts indices, one leaf is a fixed run of indices.
        const count = mesh.userData.herbs ? (distance < 24 ? mesh.userData.fullCount : 0) : Math.ceil(mesh.userData.fullCount * density);
        mesh.userData.count = count; mesh.visible = count > 0;
        mesh.geometry.setDrawRange(0, count * mesh.geometry.userData.indicesPerLeaf);
        mesh.castShadow = !mesh.userData.herbs && distance < 26;
      } else mesh.castShadow = distance < 38;
    }
  }

  remove(group) {
    group.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
  }

  update(time) { this.wind.value = time; }
}
