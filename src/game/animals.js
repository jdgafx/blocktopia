import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const templates = new WeakMap();
const horn = new THREE.MeshStandardMaterial({ color: 0xb8a987, roughness: .73 });
const hoof = new THREE.MeshStandardMaterial({ color: 0x514d40, roughness: .84 });
const eye = new THREE.MeshStandardMaterial({ color: 0x21190c, roughness: .22 });
const iris = new THREE.MeshStandardMaterial({ color: 0x9b6d30, roughness: .48 });
const crease = new THREE.MeshStandardMaterial({ color: 0x3a3d31, roughness: .95 });
const spheres = new Map();

function oval(size, coarse = false) {
  const key = `${size.join(',')}:${coarse}`;
  if (spheres.has(key)) return spheres.get(key);
  const geometry = new THREE.SphereGeometry(1, coarse ? 10 : 20, coarse ? 6 : 12);
  geometry.scale(...size);
  const uv = geometry.attributes.uv;
  // Scale UVs with the physical surface, keeping the hide pattern consistent between parts.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * (size[0] + size[2]), uv.getY(i) * Math.PI * size[1]);
  spheres.set(key, geometry);
  return geometry;
}

function tapered(points, radii, segments = 20, sides = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const frames = curve.computeFrenetFrames(segments, false), positions = [], uvs = [], indices = [];
  const length = curve.getLength();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, center = curve.getPointAt(t);
    const slot = t * (radii.length - 1), low = Math.min(radii.length - 2, Math.floor(slot));
    const radius = THREE.MathUtils.lerp(radii[low], radii[low + 1], slot - low);
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const offset = frames.normals[i].clone().multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(frames.binormals[i], Math.sin(angle) * radius);
      positions.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      uvs.push(j / sides * Math.PI * radii[0] * 2, t * length);
      if (i < segments && j < sides) {
        const a = i * (sides + 1) + j, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  // Closed ends prevent a joint or a moving neck from exposing a hollow tube.
  for (const end of [0, segments]) {
    const center = curve.getPointAt(end / segments), centerIndex = positions.length / 3;
    positions.push(center.x, center.y, center.z); uvs.push(.5, end / segments * length);
    const ring = end * (sides + 1);
    for (let j = 0; j < sides; j++) {
      indices.push(centerIndex, ring + j + (end === 0 ? 1 : 0), ring + j + (end === 0 ? 0 : 1));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function frillGeometry() {
  const geometry = new THREE.SphereGeometry(1, 32, 16);
  const positions = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const rim = 1 + .025 * Math.cos(Math.atan2(y, x) * 14);
    positions.setXYZ(i, x * .93 * rim, y * .82 * rim, z * .11 - y * .23);
    uv.setXY(i, x * .9 + .5, y * .8 + .5);
  }
  geometry.computeVertexNormals(); return geometry;
}

function part(parent, geometry, material, position, name = '', rotation = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position); mesh.name = name;
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function volume(parent, skin, size, position, name = '', coarse = false) {
  return part(parent, oval(size, coarse), skin, position, name);
}

// Merge static overlapping forms inside each joint, preserving only the animated pivots.
function consolidate(group) {
  const batches = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) { consolidate(child); continue; }
    if (child.name.includes('horn')) continue;
    child.updateMatrix();
    const batch = batches.get(child.material) ?? [];
    batch.push(child.geometry.clone().applyMatrix4(child.matrix)); batches.set(child.material, batch);
    group.remove(child);
  }
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    part(group, merged, material, [0, 0, 0]);
    geometries.forEach(geometry => geometry.dispose());
  }
}

function createTemplate(longneck, skin) {
  const animal = new THREE.Group(); animal.name = longneck ? 'sauropod' : 'triceratops';
  volume(animal, skin, longneck ? [.82, .88, 1.55] : [.86, .8, 1.4], [0, longneck ? 1.7 : 1.54, -.12]);
  // Shoulder and haunch lie mostly within the torso; their exposed contours carry weight.
  volume(animal, skin, [.7, .74, .76], [0, 1.55, .67]);
  volume(animal, skin, [.76, .81, .76], [0, 1.55, -.85]);
  for (const x of [-.62, .62]) for (const z of [-.86, .78]) {
    const leg = new THREE.Group(); leg.name = `leg-${x < 0 ? 'left' : 'right'}-${z < 0 ? 'back' : 'front'}`;
    leg.userData.gaitPhase = (x < 0) === (z < 0) ? 0 : Math.PI;
    leg.userData.stride = longneck ? .14 : .11;
    leg.position.set(x, 1.5, z); animal.add(leg);
    const outward = Math.sign(x) * .08, kneeZ = z < 0 ? .14 : -.13;
    part(leg, tapered([[-Math.sign(x) * .16, .2, 0], [outward, -.46, kneeZ], [outward, -.94, -.03], [outward, -1.32, .1]],
      [.28, .29, .20, .19], 14, 10), skin, [0, 0, 0]);
    // The shoulder/haunch overlaps the inset root throughout the walking hinge range.
    volume(leg, skin, [.37, .43, .40], [-Math.sign(x) * .08, -.04, 0]);
    volume(leg, skin, [.245, .17, .33], [outward, -1.32, .14]);
    for (const toe of [-1, 0, 1]) volume(leg, hoof, [.068, .075, .12], [outward + toe * .12, -1.40, .39], '', true);
  }
  const tail = new THREE.Group(); tail.name = 'tail'; tail.position.set(0, 1.65, -1.17); animal.add(tail);
  part(tail, tapered(longneck
    ? [[0, 0, 0], [0, -.15, -.8], [.12, -.58, -1.65], [.32, -.88, -2.85]]
    : [[0, 0, 0], [0, -.16, -.7], [.12, -.43, -1.4], [.2, -.42, -2.05]],
  [.44, .29, .12, .008], 24, 12), skin, [0, 0, 0]);
  const head = new THREE.Group(); head.name = 'head'; animal.add(head);
  if (longneck) {
    part(animal, tapered([[0, 1.65, .88], [0, 2.25, 1.24], [0, 3.2, 1.55], [0, 4.1, 1.96], [0, 4.35, 2.46]],
      [.48, .40, .29, .21, .18], 32, 14), skin, [0, 0, 0]);
    head.position.set(0, 4.35, 2.48);
    volume(head, skin, [.28, .24, .48], [0, 0, .1]);
    volume(head, skin, [.25, .15, .32], [0, -.09, .38]);
    for (const side of [-1, 1]) {
      volume(head, iris, [.032, .058, .067], [side * .266, .065, .14], '', true);
      volume(head, eye, [.018, .039, .043], [side * .293, .065, .15], '', true);
      volume(head, crease, [.024, .025, .04], [side * .194, .03, .55], '', true);
      part(head, tapered([[side * .23, -.13, .25], [side * .235, -.14, .47], [side * .15, -.13, .63]], [.008, .008, .004], 8, 4), crease, [0, 0, 0]);
    }
  } else {
    head.position.set(0, 1.5, 1.23);
    part(head, frillGeometry(), skin, [0, .38, -.03], 'frill');
    for (let i = 0; i <= 12; i++) {
      const angle = i / 12 * Math.PI;
      volume(head, skin, [.075, .07, .055], [Math.cos(angle) * .92, .38 + Math.sin(angle) * .83, -.02 - Math.sin(angle) * .23], '', true);
    }
    volume(head, skin, [.54, .48, .81], [0, -.04, .48]);
    volume(head, skin, [.36, .29, .53], [0, -.16, 1.05]);
    part(head, tapered([[0, -.13, 1.35], [0, -.25, 1.50], [0, -.44, 1.52]], [.24, .18, .006], 12, 12), hoof, [0, 0, 0]);
    volume(head, skin, [.36, .18, .64], [0, -.38, .76]);
    for (const side of [-1, 1]) {
      part(head, tapered([[side * .34, .27, .52], [side * .37, .65, .85], [side * .39, .96, 1.26], [side * .37, 1.13, 1.55]], [.13, .10, .05, .002], 18, 10), horn, [0, 0, 0], `brow-horn-${side}`);
      volume(head, skin, [.13, .11, .18], [side * .48, .09, .54], '', true);
      volume(head, iris, [.032, .071, .079], [side * .574, .085, .59], '', true);
      volume(head, eye, [.018, .043, .051], [side * .601, .085, .6], '', true);
      volume(head, crease, [.024, .04, .06], [side * .299, -.065, 1.28], '', true);
      part(head, tapered([[side * .4, -.33, .51], [side * .34, -.34, .97], [side * .24, -.35, 1.42]], [.01, .012, .006], 10, 4), crease, [0, 0, 0]);
    }
    part(head, tapered([[0, .045, 1.26], [0, .31, 1.43], [0, .50, 1.49]], [.13, .075, .002], 14, 10), horn, [0, 0, 0], 'nose-horn');
  }
  consolidate(animal); return animal;
}

export function buildAnimal(longneck, skins) {
  const skin = skins[longneck ? 0 : 1];
  let species = templates.get(skin);
  if (!species) { species = new Map(); templates.set(skin, species); }
  if (!species.has(longneck)) species.set(longneck, createTemplate(longneck, skin));
  const animal = species.get(longneck).clone(true);
  animal.userData.legs = animal.children.filter(child => child.name.startsWith('leg-'));
  animal.userData.head = animal.getObjectByName('head');
  animal.userData.tail = animal.getObjectByName('tail');
  for (const joint of [animal.userData.head, animal.userData.tail]) joint.userData.restRotation = { x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z };
  return animal;
}
