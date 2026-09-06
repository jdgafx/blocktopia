import { TextureLoader } from './texture-loader.js';
import * as THREE from 'three';
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
    const map = new TextureLoader().load('/textures/vegetation/leaf-color.png', resolveLeaf, undefined, () => {
      const status = document.getElementById('menu-status');
      if (status) status.textContent = 'Leaf textures could not load. Reload to retry.';
      rejectLeaf(new Error('Leaf textures could not load'));
    });
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    this.leafMaterial = new THREE.MeshStandardMaterial({ name: 'Living oak foliage', map, alphaTest: .45,
      side: THREE.DoubleSide, roughness: .85, metalness: 0, alphaToCoverage: true });
    this.leafDepth = new THREE.MeshDepthMaterial({ map, alphaTest: .45, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
    this.wind = { value: 0 };
    for (const material of [this.leafMaterial, this.leafDepth]) material.onBeforeCompile = shader => {
      shader.uniforms.vegetationTime = this.wind;
      shader.vertexShader = `uniform float vegetationTime;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * .37 + instanceMatrix[3].z * .29;
          transformed.x += sin(vegetationTime * 1.35 + phase) * .065 * uv.y;
          transformed.z += sin(vegetationTime * .83 + phase) * .035 * uv.y;
        #endif`);
    };
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
      const mesh = new THREE.InstancedMesh(this.leafGeometry, this.leafMaterial, batch.length);
      batch.forEach((entry, index) => { mesh.setMatrixAt(index, entry.matrix); mesh.setColorAt(index, entry.color); });
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      mesh.userData.fullCount = batch.length; mesh.userData.herbs = !shadow;
      mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.customDepthMaterial = this.leafDepth;
      mesh.computeBoundingSphere(); group.add(mesh);
    }
    this.setLod(group, camera);
    return group;
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
      if (mesh.isInstancedMesh) {
        mesh.count = mesh.userData.herbs ? (distance < 24 ? mesh.userData.fullCount : 0) : Math.ceil(mesh.userData.fullCount * density);
        mesh.castShadow = !mesh.userData.herbs && distance < 26;
      } else mesh.castShadow = distance < 38;
    }
  }

  remove(group) {
    group.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (mesh.isInstancedMesh) mesh.dispose(); else mesh.geometry.dispose();
    });
  }

  update(time) { this.wind.value = time; }
}
