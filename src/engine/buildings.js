import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS } from '../constants/blocks.js';

// Each part stays inside its editable source cell. Render, collision and targeting share it.
function box(parts, material, x0, y0, z0, x1, y1, z1) {
  if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
  parts.push({ material, x0, x1, z0, z1, b0: y0, b1: y0, t0: y1, t1: y1 });
}
function slope(parts, material, x0, x1, z0, z1, bottom, top, cellY) {
  // Split at clipping planes so every roof prism lies entirely inside its source voxel.
  const cuts = [x0, x1];
  for (const f of [bottom, top]) for (const y of [cellY, cellY + 1]) {
    const delta = f(x1) - f(x0);
    if (Math.abs(delta) < 1e-8) continue;
    const x = x0 + (y - f(x0)) / delta * (x1 - x0);
    if (x > x0 && x < x1) cuts.push(x);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
    if (top(mid) <= cellY || bottom(mid) >= cellY + 1) continue;
    parts.push({ material, x0: a, x1: b, z0, z1,
      b0: Math.max(cellY, bottom(a)), b1: Math.max(cellY, bottom(b)),
      t0: Math.min(cellY + 1, top(a)), t1: Math.min(cellY + 1, top(b)), roof: true });
  }
}

export function cottageParts(building, x, y, z, id) {
  const parts = [], X = x - building.x, Z = z - building.z;
  const add = (m, a, b, c, d, e, f) => box(parts, m, x + a, y + b, z + c, x + d, y + e, z + f);
  const west = X === 0, east = X === 6, north = Z === 0, south = Z === 6;
  if (y === 28) {
    const interior = X > 0 && X < 6 && Z > 0 && Z < 6;
    add(2, 0, 0, 0, 1, interior ? .94 : 1, 1);
    if (interior) add(0, 0, .94, 0, 1, 1, 1);
    return parts;
  }
  if (y >= 33 || (y === 32 && (X < 0 || X > 6 || Z < 0 || Z > 6))) {
    const roof = wx => 32.35 + Math.min(wx - building.x + 1, building.x + 8 - wx) * .7;
    for (let row = 0; row < 3; row++) {
      const a = x + row / 3 + .006, b = x + (row + 1) / 3 - .006;
      const stagger = ((X + 1) * 3 + row) % 2 === 0;
      const seams = stagger ? [0, .5, 1] : [0, .25, .75, 1];
      for (let col = 0; col < seams.length - 1; col++) {
        const z0 = z + seams[col] + (col > 0 || stagger ? .008 : 0);
        const z1 = z + seams[col + 1] - (col < seams.length - 2 || stagger ? .008 : 0);
        const ridge = building.x + 3.5, spans = a < ridge && b > ridge ? [[a, ridge], [ridge, b]] : [[a, b]];
        for (const [left, right] of spans) slope(parts, 3, left, right, z0, z1, wx => roof(wx) - .11, roof, y);
      }
    }
    // Continuous decking under the staggered shingles blocks rain/light through their joints.
    const peak = building.x + 3.5, decking = x < peak && x + 1 > peak ? [[x, peak], [peak, x + 1]] : [[x, x + 1]];
    for (const [left, right] of decking) slope(parts, 1, left, right, z, z + 1, wx => roof(wx) - .15, wx => roof(wx) - .11, y);
    // Timber gables close the front/back below the roof; the attic stays hollow.
    if (north || south) {
      const z0 = z + (north ? .1 : .72), z1 = z0 + .18;
      const ridge = building.x + 3.5, spans = x < ridge && x + 1 > ridge ? [[x, ridge], [ridge, x + 1]] : [[x, x + 1]];
      for (const [left, right] of spans) slope(parts, 0, left, right, z0, z1, () => 33, wx => roof(wx) - .13, y);
    }
    if (west || east) {
      const left = x + (west ? .09 : .64), right = x + (west ? .36 : .91);
      slope(parts, 1, left, right, z, z + 1, () => 33, wx => roof(wx) - .13, y);
    }
    return parts;
  }
  if (west || east || north || south) {
    const panel = (axis, lo, hi) => {
      const slab = (m, a, b, h0, h1, depth0 = lo, depth1 = hi) => {
        if (axis === 'z' && south && y < 32) {
          if (X === 2) b = Math.min(b, .8);
          if (X === 4) a = Math.max(a, .2);
        }
        if (axis === 'x') add(m, depth0, h0, a, depth1, h1, b);
        else add(m, a, h0, depth0, b, h1, depth1);
      };
      if (id === BLOCKS.GLASS) {
        slab(4, .07, .93, .07, .93, lo + .11, lo + .13);
        slab(1, 0, .09, 0, 1); slab(1, .91, 1, 0, 1);
        slab(1, .48, .52, 0, 1); slab(1, 0, 1, .47, .53);
        if (y === 30) slab(1, 0, 1, 0, .11, Math.max(0, lo - .08), Math.min(1, hi + .08));
        if (y === 31) slab(1, 0, 1, .9, 1);
      } else if (y === 29) {
        slab(5, 0, 1, 0, 1, lo + .025, hi - .025);
        for (let row = 0; row < 3; row++) for (let stone = 0; stone < 2; stone++)
          slab(2, stone * .5 + .014, (stone + 1) * .5 - .014, row / 3 + .018, (row + 1) / 3 - .018);
      } else {
        slab(1, 0, 1, 0, 1, lo + .045, hi - .045);
        for (let board = 0; board < 4; board++) slab(0, .003, .997, board * .25 + .009, (board + 1) * .25 - .009);
      }
      // Joinery is cell-owned: mining a wall removes its planks, post segment and pegs together.
      if ((axis === 'x' ? Z : X) % 3 === 0 && id !== BLOCKS.GLASS) {
        slab(1, .04, .25, 0, 1, Math.max(0, lo - .05), Math.min(1, hi + .05));
        slab(6, .105, .145, .21, .25, Math.max(0, lo - .06), Math.min(1, hi + .06));
      }
      if (y === 32) slab(1, 0, 1, .7, .96, Math.max(0, lo - .05), Math.min(1, hi + .05));
    };
    if (west) panel('x', .09, .36);
    if (east) panel('x', .64, .91);
    if (north) panel('z', .09, .36);
    if (south) panel('z', .64, .91);
    if (south && y === 32 && (X === 0 || X === 6)) {
      const left = X === 0;
      parts.push({ material: 1, x0: x + .12, x1: x + .92, z0: z + .54, z1: z + .98,
        b0: y + (left ? .04 : .65), b1: y + (left ? .65 : .04),
        t0: y + (left ? .24 : .85), t1: y + (left ? .85 : .24) });
    }
    if (south && (X === 2 || X === 4)) {
      const a = X === 2 ? .64 : .16, b = X === 2 ? .84 : .36;
      add(1, a, 0, .54, b, 1, .98);
      // The timber door is visibly folded back against the inside jamb; entrance remains open.
      if (X === 2 && y < 32) {
        add(0, .64, .03, .02, .72, .97, .95);
        add(6, .62, .17, .06, .74, .22, .89);
      }
    }
    if (south && X === 3 && y === 32) add(1, 0, 0, .54, 1, .24, .98);
  } else if (id === BLOCKS.PLANKS) {
    add(0, .02, .72, .04, .98, .84, .96);
    for (const a of [.08, .82]) for (const b of [.12, .8]) add(1, a, 0, b, a + .1, .72, b + .1);
    if (X === 1) { add(6, .35, .84, .32, .58, .88, .55); add(7, .39, .88, .36, .54, .99, .51); }
  } else if (id === BLOCKS.WOOD_LOG) {
    add(0, .12, .43, .12, .88, .55, .88);
    for (const a of [.17, .72]) for (const b of [.17, .72]) add(1, a, 0, b, a + .1, .43, b + .1);
  }
  return parts;
}

export function registerCottage(chunk, building) {
  for (let x = building.x - 1; x <= building.x + 7; x++) for (let z = building.z - 1; z <= building.z + 7; z++) {
    const lx = x - chunk.cx * 16, lz = z - chunk.cz * 16;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
    for (let y = 28; y <= 36; y++) {
      let id = chunk.getBlock(lx, y, lz);
      const outside = x < building.x || x > building.x + 6 || z < building.z || z > building.z + 6;
      const roofCell = y >= 33 || (y === 32 && outside);
      if ((outside && y < 32) || (id === BLOCKS.AIR && !roofCell)) continue;
      if (y === 29 && (x === building.x || x === building.x + 6 || z === building.z || z === building.z + 6)) {
        id = BLOCKS.STONE_BRICK; chunk.setBlock(lx, y, lz, id);
      }
      const parts = cottageParts(building, x, y, z, id);
      // Old stair-roof fill is genuinely empty, including host placement checks in the attic.
      if (roofCell) chunk.setBlock(lx, y, lz, parts.length ? BLOCKS.WOOD_LOG : BLOCKS.AIR);
      else if (!parts.length) chunk.setBlock(lx, y, lz, BLOCKS.AIR);
      chunk.buildingBlocks.set(chunk._idx(lx, y, lz), parts);
    }
  }
}

const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
function partGeometry(p) {
  const points = [[p.x0,p.b0,p.z0], [p.x1,p.b1,p.z0], [p.x1,p.b1,p.z1], [p.x0,p.b0,p.z1],
    [p.x0,p.t0,p.z0], [p.x1,p.t1,p.z0], [p.x1,p.t1,p.z1], [p.x0,p.t0,p.z1]];
  const position = [], uv = [], indices = [];
  for (const inward of faces) {
    const face = [...inward].reverse();
    const offset = position.length / 3;
    const a = points[face[0]], b = points[face[1]], d = points[face[3]];
    const normal = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...d), new THREE.Vector3(...a)));
    const axis = Math.abs(normal.x) > Math.abs(normal.y) && Math.abs(normal.x) > Math.abs(normal.z) ? 0
      : Math.abs(normal.y) > Math.abs(normal.z) ? 1 : 2;
    const wood = p.material === 0 || p.material === 1 || p.material === 3;
    for (const i of face) {
      const point = points[i]; position.push(...point);
      let u = point[axis === 0 ? 2 : 0], v = point[axis === 1 ? 2 : 1];
      if (p.material === 1 && p.t0 - p.b0 > Math.max(p.x1 - p.x0, p.z1 - p.z0)) [u, v] = [v, u];
      uv.push(u * (wood ? .5 : 1), v * (wood ? 1 / 3 : 1));
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export class Buildings {
  constructor(terrain) {
    const wood = (name, color) => {
      const material = terrain[9].clone(); material.name = name; material.color.set(color);
      material.roughnessMap = null; material.roughness = .94;
      material.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float grain = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grain) * vec3(1.08, 1.02, .9), .8);`); };
      return material;
    };
    const stone = terrain[3].clone(); stone.color.set(0x9c9789);
    const mortar = terrain[10].clone(); mortar.color.set(0x66635b);
    this.materials = [wood('Weathered wall boards', 0xe1d2b3), wood('Oak joinery', 0xb5a78a), stone,
      wood('Split timber shingles', 0x999380), terrain[11], mortar,
      new THREE.MeshStandardMaterial({ color: 0x3e3930, roughness: .75, metalness: .55 }),
      new THREE.MeshStandardMaterial({ color: 0xffc570, emissive: 0xffb04f, emissiveIntensity: 2 })];
  }
  build(chunk) {
    const group = new THREE.Group(); group.name = `cottages-${chunk.cx},${chunk.cz}`;
    const geometries = this.materials.map(() => []);
    for (const parts of chunk.buildingBlocks.values()) for (const part of parts) {
      geometries[part.material].push(partGeometry(part));
      if (part.material === 7) {
        const light = new THREE.PointLight(0xffcd89, 14, 7, 2);
        light.position.set((part.x0 + part.x1) / 2, part.t0 + .04, (part.z0 + part.z1) / 2); group.add(light);
      }
    }
    geometries.forEach((parts, index) => {
      if (!parts.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(parts, false), this.materials[index]);
      mesh.castShadow = index !== 4 && index !== 7; mesh.receiveShadow = true; group.add(mesh);
      parts.forEach(part => part.dispose());
    });
    return group;
  }
  remove(group) { group.traverse(object => { if (object.isMesh) object.geometry.dispose(); }); }
}

export function buildingBounds(part, min, max) {
  let x0 = Math.max(part.x0, min.x), x1 = Math.min(part.x1, max.x);
  if (x1 - x0 < 1e-7 || max.z - part.z0 < 1e-7 || part.z1 - min.z < 1e-7) return null;
  const lerp = (a, b, x) => a + (b - a) * (x - part.x0) / (part.x1 - part.x0);
  const y0 = Math.min(lerp(part.b0, part.b1, x0), lerp(part.b0, part.b1, x1));
  const y1 = Math.max(lerp(part.t0, part.t1, x0), lerp(part.t0, part.t1, x1));
  if (max.y <= y0 || min.y >= y1) return null;
  return { min: { x: part.x0, y: y0, z: part.z0 }, max: { x: part.x1, y: y1, z: part.z1 }, roof: part.roof };
}

export function raycastBuilding(parts, origin, direction, near, far) {
  let closest = null;
  for (const p of parts) {
    const span = p.x1 - p.x0, bs = (p.b1 - p.b0) / span, ts = (p.t1 - p.t0) / span;
    const planes = [[-1,0,0,p.x0], [1,0,0,-p.x1], [0,0,-1,p.z0], [0,0,1,-p.z1],
      [bs,-1,0,p.b0-bs*p.x0], [-ts,1,0,-p.t0+ts*p.x0]];
    let entry = 0, exit = far, normal = [0, 0, 0];
    for (const [nx, ny, nz, d] of planes) {
      const signed = nx * origin.x + ny * origin.y + nz * origin.z + d;
      const denominator = nx * direction.x + ny * direction.y + nz * direction.z;
      if (Math.abs(denominator) < 1e-9) { if (signed > 0) { exit = -1; break; } continue; }
      const t = -signed / denominator;
      if (denominator < 0 && t > entry) { entry = t; normal = Math.abs(ny) >= Math.abs(nx) ? [0, Math.sign(ny), nz] : [Math.sign(nx), 0, nz]; }
      else if (denominator > 0) exit = Math.min(exit, t);
    }
    if (entry <= exit && entry >= near - 1e-7 && entry <= far && (!closest || entry < closest.distance)) closest = { distance: entry, face: normal };
  }
  return closest;
}
