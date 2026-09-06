import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildAnimal } from './animals.js';

const SPECIES = ['raptor', 'stegosaur', 'mammoth', 'griffin', 'forest-dragon', 'moonstag', 'sauropod', 'triceratops'];
const SHAPES = {
  sauropod: { leg: 1.4 },
  triceratops: { leg: 1.4 },
  raptor: { body: [.36, .48, .82], height: 1.25, leg: 1.08, neck: [0, 1.65, .65], head: [.24, .25, .48] },
  stegosaur: { body: [.72, .76, 1.35], height: 1.22, leg: .85, neck: [0, .95, 1.5], head: [.23, .25, .45] },
  mammoth: { body: [.88, 1.05, 1.4], height: 1.65, leg: 1.25, neck: [0, 2.0, 1.12], head: [.62, .73, .63] },
  griffin: { body: [.53, .65, 1.05], height: 1.25, leg: .98, neck: [0, 1.85, .92], head: [.29, .35, .39] },
  'forest-dragon': { body: [.66, .65, 1.22], height: 1.2, leg: .92, neck: [0, 1.75, 1.14], head: [.34, .36, .56] },
  moonstag: { body: [.39, .58, .86], height: 1.37, leg: 1.13, neck: [0, 2, .8], head: [.2, .25, .4] },
};

function mesh(parent, geometry, material, position = [0, 0, 0], name = '') {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(...position); part.name = name; parent.add(part);
  part.castShadow = part.receiveShadow = true;
  return part;
}

function oval(parent, material, size, position, detail) {
  const g = new THREE.SphereGeometry(1, detail ? 14 : 8, detail ? 10 : 6);
  g.scale(...size);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(.3, Math.PI * (size[0] + size[2])), uv.getY(i) * Math.max(.3, Math.PI * size[1]));
  return mesh(parent, g, material, position);
}

function tube(parent, material, points, radii, detail = true) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const segments = detail ? 16 : 8, sides = detail ? 8 : 5;
  const geometry = new THREE.TubeGeometry(curve, segments, 1, sides, false);
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, center = curve.getPointAt(t), slot = t * (radii.length - 1);
    const low = Math.min(radii.length - 2, Math.floor(slot));
    const radius = THREE.MathUtils.lerp(radii[low], radii[low + 1], slot - low);
    for (let j = 0; j <= sides; j++) {
      const n = i * (sides + 1) + j;
      p.setXYZ(n, center.x + (p.getX(n) - center.x) * radius, center.y + (p.getY(n) - center.y) * radius, center.z + (p.getZ(n) - center.z) * radius);
      uv.setXY(n, j / sides * Math.max(.2, radii[0] * Math.PI * 2), t * curve.getLength());
    }
  }
  geometry.computeVertexNormals();
  return mesh(parent, geometry, material);
}

function joint(parent, name, position) {
  const group = new THREE.Group(); group.name = name; group.position.set(...position); parent.add(group); return group;
}

// Each articulated joint is one draw call per material, sharing template buffers across animals.
function consolidate(group) {
  const batches = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) { consolidate(child); continue; }
    child.updateMatrix();
    const list = batches.get(child.material) ?? [];
    list.push(child.geometry.clone().applyMatrix4(child.matrix)); batches.set(child.material, list);
    group.remove(child); child.geometry.dispose();
  }
  for (const [material, parts] of batches) {
    mesh(group, mergeGeometries(parts, false), material);
    parts.forEach(g => g.dispose());
  }
}

function wing(parent, side, skin, bone, feathered, detail) {
  const w = joint(parent, `wing-${side}`, [side * .42, 1.58, .35]);
  const points = [[0, 0, 0], [side * .85, .45, .08], [side * 1.7, .6, -.35], [side * 2.65, .12, -1.1], [side * 1.95, -.18, -1], [side * 1.1, -.35, -.85], [side * .4, -.35, -.65]];
  const positions = [], uv = [], indices = [];
  for (const p of points) { positions.push(...p); uv.push(Math.abs(p[0]) / 2.7, (p[2] + 1.2) / 1.4); }
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals();
  mesh(w, g, skin);
  tube(w, feathered ? skin : bone, points.slice(0, 4), [.12, .1, .055, .003], detail);
  for (let i = 0; i < (detail ? 10 : 5); i++) {
    const t = i / (detail ? 9 : 4), x = side * (.48 + t * 1.75);
    if (feathered) {
      const f = oval(w, skin, [.11, .035, .55 + t * .16], [x, .25 - t * .12, -.65 - t * .35], detail);
      f.rotation.y = side * (.18 + .5 * t);
    } else if (i % 2 === 0) tube(w, skin, [[side * .85, .45, .08], [x, .1, -.48], [x * 1.08, -.24, -.98]], [.035, .025, .004], detail);
  }
  return w;
}

/** Textured procedural anatomy; a render adapter, never authoritative simulation state. */
export function buildCreature(species, materials, detail = true) {
  const s = SHAPES[species]; if (!s) throw new Error(`Unknown creature species: ${species}`);
  if (species === 'sauropod' || species === 'triceratops') {
    const animal = buildAnimal(species === 'sauropod', [materials.skin, materials.skin]);
    // The existing builder exposes live joint references; our adapter resolves joints by name.
    animal.userData = {};
    return animal;
  }
  const skin = materials.skin, bone = materials.bone, dark = materials.dark, eye = materials.eye;
  const root = new THREE.Group(); root.name = species;
  oval(root, skin, s.body, [0, s.height, 0], detail);
  oval(root, skin, [s.body[0] * .93, s.body[1] * .92, s.body[2] * .58], [0, s.height + .05, -.55], detail);
  const biped = species === 'raptor', thin = biped || species === 'moonstag';
  for (const side of [-1, 1]) for (const front of biped ? [false] : [false, true]) {
    const z = front ? s.body[2] * .63 : -s.body[2] * .59;
    const leg = joint(root, `leg-${side}-${front}`, [side * s.body[0] * .76, s.leg, z]);
    leg.userData.phase = (side < 0) === front ? 0 : Math.PI;
    const r = thin ? .105 : species === 'mammoth' ? .26 : .17;
    oval(leg, skin, [r * 1.6, s.leg * .39, r * 1.9], [0, -.03, 0], detail);
    tube(leg, skin, [[0, 0, 0], [side * .05, -s.leg * .48, front ? -.12 : .18], [0, -s.leg + .12, .04]], [r, r * .75, r * .62], detail);
    oval(leg, species === 'moonstag' ? dark : skin, [r * 1.15, .11, r * 1.8], [0, -s.leg + .11, .13], detail);
    if (detail && species !== 'moonstag') for (let toe = -1; toe <= 1; toe++) {
      tube(leg, bone, [[toe * r * .65, -s.leg + .12, .2], [toe * r * .8, -s.leg + .075, .35], [toe * r * .8, -s.leg + .035, .4]], [.035, .028, .002], false);
    }
  }
  const tail = joint(root, 'tail', [0, s.height, -s.body[2] * .78]);
  const tailLength = species === 'mammoth' ? .65 : species === 'moonstag' ? .32 : species === 'griffin' ? 1.55 : 2.1;
  tube(tail, skin, [[0, 0, 0], [0, -.13, -tailLength * .35], [.13, -.3, -tailLength * .75], [.23, -.15, -tailLength]], [s.body[0] * .48, .17, .075, .002], detail);
  if (species === 'griffin' || species === 'mammoth') oval(tail, skin, [.12, .14, .23], [.23, -.15, -tailLength + .09], detail);
  tube(root, skin, [[0, s.height, s.body[2] * .55], [0, (s.height + s.neck[1]) / 2, s.neck[2] * .9], s.neck], [s.body[0] * .65, s.head[0] * 1.05, s.head[0] * .9], detail);
  const head = joint(root, 'head', s.neck);
  oval(head, skin, s.head, [0, 0, .1], detail);
  oval(head, skin, [s.head[0] * .78, s.head[1] * .5, s.head[2] * .75], [0, -.12, s.head[2] * .6], detail);
  for (const side of [-1, 1]) {
    oval(head, bone, [.036, .064, .066], [side * s.head[0] * .93, .08, .25], detail);
    oval(head, eye, [.019, .038, .045], [side * (s.head[0] * .93 + .029), .08, .26], detail);
    if (detail) oval(head, dark, [.021, .025, .038], [side * s.head[0] * .53, -.035, s.head[2] * 1.13], false);
  }
  if (biped) {
    for (const side of [-1, 1]) {
      const arm = joint(root, `arm-${side}`, [side * .3, 1.45, .48]);
      tube(arm, skin, [[0, 0, 0], [side * .1, -.27, -.1], [side * .15, -.32, .2]], [.095, .055, .02], detail);
      for (let i = 0; i < (detail ? 5 : 2); i++) oval(arm, skin, [.055, .025, .29], [side * i * .06, -.27, -.12 - i * .035], detail).rotation.y = side * .45;
    }
  }
  if (species === 'stegosaur') {
    for (const side of [-1, 1]) for (let i = 0; i < (detail ? 7 : 5); i++) {
      const z = -1.12 + i * (detail ? .35 : .5), h = .3 + .48 * Math.sin((i + 1) / (detail ? 8 : 6) * Math.PI);
      const plate = mesh(root, new THREE.ConeGeometry(h * .53, h, 4), skin, [side * .16, s.height + .59 + h * .4, z + side * .09]);
      plate.scale.z = .25; plate.rotation.z = side * -.16;
    }
    for (const side of [-1, 1]) for (const z of [-1.25, -1.65]) tube(tail, bone, [[side * .05, -.23, z], [side * .35, -.08, z - .13], [side * .65, .08, z - .28]], [.09, .05, .002], detail);
  }
  if (species === 'mammoth') {
    const trunk = joint(head, 'trunk', [0, -.28, .54]);
    tube(trunk, skin, [[0, 0, 0], [0, -.65, .22], [.08, -1.15, .3], [.22, -1.45, .66]], [.24, .18, .105, .07], detail);
    for (const side of [-1, 1]) {
      oval(head, skin, [.17, .44, .3], [side * .62, .02, -.06], detail);
      tube(head, bone, [[side * .35, -.35, .47], [side * .59, -.65, .95], [side * .62, -.51, 1.35], [side * .46, -.05, 1.54]], [.12, .09, .052, .002], detail);
    }
    if (detail) for (let i = 0; i < 12; i++) tube(root, skin, [[Math.sin(i * 2.4) * .65, 1.2, Math.cos(i * 2.4)], [Math.sin(i * 2.4) * .71, .95, Math.cos(i * 2.4)], [Math.sin(i * 2.4) * .74, .65, Math.cos(i * 2.4) + .12]], [.1, .06, .002], false);
  }
  if (species === 'griffin' || species === 'forest-dragon') {
    for (const side of [-1, 1]) wing(root, side, skin, bone, species === 'griffin', detail);
    if (species === 'griffin') tube(head, bone, [[0, .03, .34], [0, 0, .68], [0, -.23, .68]], [.17, .12, .002], detail);
    else {
      for (const side of [-1, 1]) tube(head, bone, [[side * .23, .23, -.1], [side * .38, .54, -.35], [side * .5, .64, -.7]], [.115, .07, .002], detail);
      for (let i = 0; i < (detail ? 10 : 5); i++) mesh(root, new THREE.ConeGeometry(.11, .28, 5), bone, [0, s.height + .63, -.95 + i * (detail ? .22 : .44)]);
    }
  }
  if (species === 'moonstag') for (const side of [-1, 1]) {
    oval(head, skin, [.105, .1, .3], [side * .24, .19, -.1], detail).rotation.y = side * -.6;
    tube(head, bone, [[side * .13, .2, -.1], [side * .29, .65, -.24], [side * .5, 1.04, -.4], [side * .69, 1.26, -.3]], [.06, .045, .03, .002], detail);
    for (let i = 0; i < (detail ? 4 : 2); i++) tube(head, bone, [[side * (.24 + i * .1), .55 + i * .16, -.25], [side * (.15 + i * .1), .83 + i * .17, .03], [side * (.2 + i * .1), 1 + i * .17, .08]], [.035, .022, .002], detail);
  }
  consolidate(root);
  return root;
}

export class CreatureVisuals {
  constructor(world, scene) {
    this.world = world; this.scene = scene; this.records = new Map(); this.templates = new Map(); this.materials = new Map(); this.disposed = false;
    this.raycaster = new THREE.Raycaster(); this.time = 0; this._lastTargetDistance = Infinity;
    const loader = new THREE.TextureLoader(), pending = [];
    this.common = { bone: new THREE.MeshStandardMaterial({ color: 0xc6b38b, roughness: .68 }), dark: new THREE.MeshStandardMaterial({ color: 0x2e2721, roughness: .85 }), eye: new THREE.MeshStandardMaterial({ color: 0x151c12, roughness: .16 }) };
    for (const species of SPECIES) {
      const map = new THREE.Texture(); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping; map.anisotropy = 4;
      if (species === 'triceratops') map.repeat.set(2, 2);
      const skin = new THREE.MeshStandardMaterial({ name: `${species} generated color`, map, roughness: .88, side: THREE.DoubleSide });
      this.materials.set(species, { ...this.common, skin });
      const directory = ['sauropod', 'triceratops'].includes(species) ? 'animals' : 'creatures';
      pending.push(loader.loadAsync(`/textures/${directory}/${species}-color.webp`).then(loaded => {
        if (this.disposed) { loaded.dispose(); return; }
        map.image = loaded.image; map.needsUpdate = true; loaded.dispose();
      }));
    }
    this.ready = Promise.all(pending);
  }

  _create(id, species) {
    let templates = this.templates.get(species);
    if (!templates) {
      templates = [true, false].map(detail => buildCreature(species, this.materials.get(species), detail)); this.templates.set(species, templates);
    }
    const root = new THREE.Group(); root.name = `creature-${id}`; root.userData.creatureId = id;
    const models = templates.map(template => template.clone(true)); models.forEach(model => root.add(model));
    const joints = models.map(model => {
      const result = { legs: [], wings: [], arms: [] };
      model.traverse(p => { if (p.name.startsWith('leg-')) { p.userData.phase ??= p.userData.gaitPhase ?? 0; result.legs.push(p); } else if (p.name.startsWith('wing-')) result.wings.push(p); else if (p.name.startsWith('arm-')) result.arms.push(p); });
      for (const name of ['head', 'tail', 'trunk']) result[name] = model.getObjectByName(name);
      return result;
    });
    const record = { root, models, joints, species, phase: 0, alive: true };
    this.records.set(id, record); this.scene.add(root); return record;
  }

  update(dt, observer, authoritativeState) {
    if (this.disposed) return;
    this.time += Math.min(.1, Math.max(0, dt || 0));
    const creatures = authoritativeState?.creatures ?? {};
    for (const [id, record] of this.records) if (!creatures[id] || creatures[id].harvested || creatures[id].species !== record.species) { this.scene.remove(record.root); this.records.delete(id); }
    for (const [id, c] of Object.entries(creatures)) {
      if (!SHAPES[c.species] || c.harvested || ![c.x, c.y, c.z].every(Number.isFinite)) continue;
      const distance = Math.hypot(c.x - observer.x, c.y - observer.y, c.z - observer.z);
      let r = this.records.get(id);
      if (!r && (c.active === false || distance > 100)) continue;
      r ??= this._create(id, c.species);
      r.root.visible = c.active !== false && distance <= 100;
      if (!r.root.visible) continue;
      const detail = distance < 24 ? 0 : 1, alive = c.health > 0 && c.behavior !== 'dead';
      r.alive = alive; r.models.forEach((m, i) => { m.visible = i === detail; });
      const yaw = Number.isFinite(c.yaw) ? c.yaw : 0;
      const blend = 1 - Math.exp(-Math.min(.1, Math.max(0, dt || 0)) * 14);
      if (!r.initialized || Math.hypot(r.root.position.x - c.x, r.root.position.y - c.y, r.root.position.z - c.z) > 6) {
        r.root.position.set(c.x, c.y, c.z); r.root.rotation.y = yaw; r.initialized = true;
      } else {
        r.root.position.x += (c.x - r.root.position.x) * blend;
        r.root.position.y += (c.y - r.root.position.y) * blend;
        r.root.position.z += (c.z - r.root.position.z) * blend;
        r.root.rotation.y += Math.atan2(Math.sin(yaw - r.root.rotation.y), Math.cos(yaw - r.root.rotation.y)) * blend;
      }
      r.root.scale.setScalar(THREE.MathUtils.clamp(c.scale || 1, .25, 3));
      const model = r.models[detail], j = r.joints[detail], moving = alive && Number.isFinite(c.speed) && c.speed > .05;
      const rest = !alive || c.behavior === 'resting';
      r.phase += Math.min(.1, Math.max(0, dt || 0)) * (moving ? Math.min(12, 3 + c.speed * 2) : 1);
      model.position.y = rest ? -SHAPES[c.species].leg * .5 : moving ? Math.sin(r.phase * 2) * .025 : Math.sin(this.time * 1.5) * .009;
      model.rotation.z = !alive ? .25 : 0;
      for (const leg of j.legs) leg.rotation.x = rest ? -.95 : moving ? Math.sin(r.phase + leg.userData.phase) * (leg.userData.stride ?? .28) * (c.behavior === 'fleeing' ? 1.7 : 1) : 0;
      j.head.rotation.x = rest ? .24 : c.behavior === 'grazing' ? .34 + Math.sin(this.time * 2) * .07 : Math.sin(this.time * .8) * .04;
      j.head.rotation.y = rest ? 0 : Math.sin(this.time * .43) * .1;
      j.tail.rotation.y = rest ? .28 : Math.sin(r.phase * .7) * .13;
      if (j.trunk) j.trunk.rotation.x = Math.sin(this.time) * .13;
      for (const w of j.wings) { const side = w.position.x < 0 ? -1 : 1; w.rotation.z = side * (rest ? -.75 : -.45 + Math.sin(r.phase * .6) * (moving ? .19 : .035)); }
      for (const arm of j.arms) arm.rotation.x = moving ? Math.sin(r.phase) * .16 : 0;
      const shadows = distance < 22;
      if (r.shadows !== shadows) { r.root.traverse(p => { if (p.isMesh) p.castShadow = shadows; }); r.shadows = shadows; }
    }
  }

  get lastTargetDistance() { return this._lastTargetDistance; }

  target(camera, maxDistance = 6) {
    this._lastTargetDistance = Infinity;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); this.raycaster.far = maxDistance;
    const roots = [...this.records.values()].filter(r => r.root.visible).map(r => r.root);
    roots.forEach(root => root.updateMatrixWorld(true));
    for (const hit of this.raycaster.intersectObjects(roots, true)) {
      let p = hit.object, visible = true, id;
      while (p) { visible &&= p.visible; id ??= p.userData.creatureId; p = p.parent; }
      if (visible && id) { this._lastTargetDistance = hit.distance; return id; }
    }
    return null;
  }

  dispose() {
    this.disposed = true;
    for (const r of this.records.values()) this.scene.remove(r.root);
    const geometries = new Set(); for (const templates of this.templates.values()) for (const model of templates) model.traverse(p => { if (p.isMesh) geometries.add(p.geometry); });
    geometries.forEach(g => g.dispose());
    for (const { skin } of this.materials.values()) { skin.map.dispose(); skin.dispose(); }
    Object.values(this.common).forEach(m => m.dispose());
    this.records.clear(); this.templates.clear(); this.materials.clear();
  }
}
