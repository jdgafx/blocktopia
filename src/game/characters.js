import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REGIONS } from './regions.js';
import { createAnimalSkins } from './animal-materials.js';
import { buildAnimal } from './animals.js';
import { animalMotion, GRAZING_LANES, ANIMAL_ORBIT_RADIUS } from './animal-motion.js';

import mara from '../../public/models/characters/mara.bbmodel?raw';
import ivo from '../../public/models/characters/ivo.bbmodel?raw';
import neri from '../../public/models/characters/neri.bbmodel?raw';
import sol from '../../public/models/characters/sol.bbmodel?raw';

const PERSON_MODELS = [mara, ivo, neri, sol].map(source => JSON.parse(source));

// Blockbench generic cube models: 16 authoring units = one world block.
// Keep geometry and named joint pivots in the editable source, not duplicated in code.
export function buildBlockbenchCharacter(model, material) {
  const root = new THREE.Group(); root.name = model.name;
  const elements = new Map(model.elements.map(element => [element.uuid, element]));
  const scale = 1 / 16;
  function add(nodes, parent, parentOrigin = [0, 0, 0]) {
    const parts = [];
    for (const node of nodes) {
      if (typeof node !== 'string') {
        const joint = new THREE.Group(); joint.name = node.name;
        joint.position.fromArray(node.origin.map((v, i) => (v - parentOrigin[i]) * scale));
        if (node.rotation) joint.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad));
        parent.add(joint); add(node.children, joint, node.origin);
        continue;
      }
      const element = elements.get(node);
      if (!element || element.type !== 'cube') throw new Error(`Unsupported Blockbench element: ${node}`);
      const geometry = new THREE.BoxGeometry(...element.to.map((v, i) => (v - element.from[i]) * scale));
      const uv = geometry.attributes.uv;
      ['east', 'west', 'up', 'down', 'south', 'north'].forEach((face, faceIndex) => {
        const [u0, v0, u1, v1] = element.faces[face].uv;
        const corners = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
        const turns = (element.faces[face].rotation || 0) / 90;
        const order = [0, 1, 3, 2];
        for (let i = 0; i < 4; i++) {
          const [u, v] = corners[order[(order.indexOf(i) + turns) % 4]];
          uv.setXY(faceIndex * 4 + i, u / model.resolution.width, 1 - v / model.resolution.height);
        }
      });
      const pivot = new THREE.Group();
      const origin = element.origin || [0, 0, 0];
      pivot.position.fromArray(origin.map((v, i) => (v - parentOrigin[i]) * scale));
      if (element.rotation) pivot.rotation.set(...element.rotation.map(THREE.MathUtils.degToRad));
      const mesh = new THREE.Mesh(geometry, material); mesh.name = element.name;
      mesh.position.fromArray(element.to.map((v, i) => ((v + element.from[i]) / 2 - origin[i]) * scale));
      pivot.updateMatrix(); mesh.updateMatrix();
      geometry.applyMatrix4(pivot.matrix.multiply(mesh.matrix)); parts.push(geometry);
    }
    // One draw call per named joint; cube detail stays editable in Blockbench.
    if (parts.length) {
      const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
      mesh.name = `${parent.name}_geometry`; parent.add(mesh);
      parts.forEach(geometry => geometry.dispose());
    }
  }
  add(model.outliner, root);
  root.userData.head = root.getObjectByName('head');
  root.userData.leftArm = root.getObjectByName('left_arm');
  root.userData.rightArm = root.getObjectByName('right_arm');
  return root;
}

// Authored low-poly inhabitants; simulation positions stay independent of their meshes.
export class Characters {
  constructor(world, scene, { ambientAnimals = true } = {}) {
    this.world = world; this.scene = scene; this.time = 0;
    this.materials = new Map(); this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.animalSkins = createAnimalSkins();
    this.animalSkins.ready.catch(error => {
      console.warn(error.message);
      const status = document.getElementById('menu-status');
      if (status) status.textContent = 'Animal skins could not load. Reload to retry.';
    });
    this.people = REGIONS.map((region, index) => {
      const mesh = this.person(index); mesh.position.set(region.x, 29, region.z);
      const label = this.label(region.npc.name);
      label.position.y = 2.65; mesh.add(label); mesh.traverse(part => { if (part.isMesh) part.castShadow = part.receiveShadow = true; }); scene.add(mesh);
      const beacon = new THREE.Group();
      this.box(beacon, 0x41505b, [1.5, .5, 1.5], [0, .25, 0]);
      this.box(beacon, 0xada68d, [.5, 2.5, .5], [0, 1.5, 0]);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.65), new THREE.MeshLambertMaterial({ color: 0x6de7da, emissive: 0x000000 }));
      crystal.position.y = 3.2; beacon.add(crystal); beacon.position.set(region.x + 4, 29, region.z);
      scene.add(beacon);
      return { region, mesh, label, beacon, crystal, index };
    });
    this.animals = !ambientAnimals ? [] : REGIONS.flatMap((region, index) => [0, 1].map(n => {
      const mesh = buildAnimal((index + n) % 2 === 0, this.animalSkins);
      mesh.traverse(part => { if (part.isMesh) part.castShadow = part.receiveShadow = true; }); scene.add(mesh);
      return { mesh, region, lane: GRAZING_LANES[n], phase: index * 2 + n * Math.PI, longneck: (index + n) % 2 === 0 };
    }));
  }
  material(color) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshLambertMaterial({ color }));
    return this.materials.get(color);
  }
  box(parent, color, size, position, rotation = 0) {
    const part = new THREE.Mesh(this.geometry, this.material(color));
    part.scale.set(...size); part.position.set(...position); part.rotation.z = rotation; parent.add(part); return part;
  }
  person(index) {
    const model = PERSON_MODELS[index];
    const texture = new THREE.TextureLoader().load(model.textures[0].source, undefined, undefined, error => {
      console.error(`Character texture failed: ${model.name}`, error);
      const status = document.getElementById('menu-status');
      if (status) status.textContent = 'Character textures could not load. Reload to retry.';
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    return buildBlockbenchCharacter(model, new THREE.MeshLambertMaterial({ map: texture }));
  }
  label(text) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff3cf'; ctx.font = 'bold 42px system-ui'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#17231c'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.strokeText(text, 256, 48, 490); ctx.fillText(text, 256, 48, 490);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true })); sprite.scale.set(1.8, .225, 1); return sprite;
  }
  nearest(position) {
    return this.people.find(({ region }) => Math.hypot(position.x - region.x, position.z - region.z) <= 5.5 && Math.abs(position.y - 29) < 4)?.region;
  }
  update(dt, position, stage) {
    this.time += dt;
    for (const person of this.people) {
      const { region, mesh, label, beacon, crystal, index } = person;
      label.visible = Math.hypot(position.x - region.x, position.z - region.z) < 8;
      mesh.visible = beacon.visible = Math.hypot(position.x - region.x, position.z - region.z) < 65;
      if (!mesh.visible) continue;
      if (Math.hypot(position.x - region.x, position.z - region.z) < 12) mesh.rotation.y = Math.atan2(position.x - region.x, position.z - region.z);
      const breath = Math.sin(this.time * 1.7 + index);
      mesh.userData.head.rotation.x = breath * .018;
      mesh.userData.leftArm.rotation.z = breath * .025;
      mesh.userData.rightArm.rotation.z = -breath * .02;
      crystal.rotation.y = this.time * .6; crystal.position.y = 3.2 + Math.sin(this.time * 2) * .1;
      crystal.material.emissive.setHex(stage >= index + 2 ? 0x359b82 : 0x000000);
    }
    // ponytail: ambient fauna follows seeded paths; interactive combat needs host-owned AI state.
    for (const animal of this.animals) {
      const { mesh, region, phase, lane } = animal;
      mesh.visible = Math.hypot(position.x - region.x, position.z - region.z) < 65;
      if (!mesh.visible) continue;
      const motion = animalMotion(Date.now() / 1000, phase);
      const x = region.x + lane[0] + Math.cos(motion.angle) * ANIMAL_ORBIT_RADIUS;
      const z = region.z + lane[1] + Math.sin(motion.angle) * ANIMAL_ORBIT_RADIUS;
      const y = this.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1;
      mesh.position.set(x, y, z); mesh.rotation.y = -motion.angle;
      mesh.userData.legs.forEach(leg => {
        leg.rotation.x = Math.sin(motion.stride + leg.userData.gaitPhase) * leg.userData.stride * motion.moving;
      });
      const { head, tail } = mesh.userData;
      head.rotation.x = head.userData.restRotation.x + motion.resting * .14 + Math.sin(this.time * 1.3 + phase) * .018;
      tail.rotation.y = tail.userData.restRotation.y + Math.sin(this.time * .7 + phase) * .08;
    }
  }
}
