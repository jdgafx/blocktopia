import * as THREE from 'three';
import { characterLoader } from './character-loader.js';
import { groundFeet, groundBiped } from './character-grounding.js';
import { REGIONS } from './regions.js';
import { createAnimalSkins } from './animal-materials.js';
import { buildAnimal } from './animals.js';
import { animalMotion, GRAZING_LANES, ANIMAL_ORBIT_RADIUS } from './animal-motion.js';

// Authored low-poly inhabitants; simulation positions stay independent of their meshes.
export class Characters {
  constructor(world, scene, { ambientAnimals = true } = {}) {
    this.world = world; this.scene = scene; this.time = 0;
    this.materials = new Map(); this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.animalSkins = ambientAnimals ? createAnimalSkins() : { ready: Promise.resolve() };
    this.animalSkins.ready.catch(error => {
      console.warn(error.message);
      const status = document.getElementById('menu-status');
      if (status) status.textContent = 'Animal skins could not load. Reload to retry.';
    });
    this.loader = characterLoader();
    this.personLoads = [];
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
    this.ready = Promise.all(this.personLoads);
    this.ready.catch(error => {
      console.error('Village characters could not load', error);
      const status = document.getElementById('menu-status');
      if (status) status.textContent = 'Village characters could not load. Reload to retry.';
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
    const root = new THREE.Group();
    const id = ['mara', 'ivo', 'neri', 'sol'][index];
    this.personLoads.push(this.loader.loadAsync(`/models/characters/${id}.glb`).then(gltf => {
      root.add(gltf.scene);
      gltf.scene.traverse(part => { if (part.isMesh) part.castShadow = part.receiveShadow = true; });
      root.userData.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) root.userData.mixer.clipAction(clip).play();
      root.userData.mixer.setTime(index / 1.7);
      root.userData.feet = ['left_leg', 'right_leg'].map(name => {
        const joint = gltf.scene.getObjectByName(name);
        if (!joint) throw new Error(`Missing ${id} foot joint: ${name}`);
        const side = name.split('_')[0];
        return { joint, knee: gltf.scene.getObjectByName(`${side}_knee`), ankle: gltf.scene.getObjectByName(`${side}_ankle`),
          point: new THREE.Vector3(0, -.17, .07) };
      });
    }));
    return root;
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
      mesh.userData.mixer?.update(dt);
      if (mesh.userData.feet) groundBiped(mesh, mesh.userData.feet, this.world, dt);
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
      if (!mesh.userData.feet) mesh.userData.feet = mesh.userData.legs.map(joint => ({
        joint, restY: joint.position.y, point: new THREE.Vector3(Math.sign(joint.position.x) * .08, -1.475, .14),
      }));
      groundBiped(mesh, mesh.userData.feet, this.world, dt);
      const { head, tail } = mesh.userData;
      head.rotation.x = head.userData.restRotation.x + motion.resting * .14 + Math.sin(this.time * 1.3 + phase) * .018;
      tail.rotation.y = tail.userData.restRotation.y + Math.sin(this.time * .7 + phase) * .08;
    }
  }
}
