import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isPet } from './pets.js';

const MAX_PETS = 32, SEE = 100;
// Pip faces +z. Coloured per vertex, so every Pip in the world is ONE draw call (one InstancedMesh per pet type).
function buildPip() {
  const parts = [];
  const blob = (size, at, color) => {
    const g = new THREE.SphereGeometry(1, 12, 8); g.scale(...size); g.translate(...at);
    const c = new THREE.Color(color), n = g.attributes.position.count, rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3)); parts.push(g);
  };
  blob([.34, .3, .42], [0, .42, 0], 0xf2c27a);          // body
  blob([.26, .25, .26], [0, .66, .38], 0xf7d08f);       // head
  blob([.14, .1, .12], [0, .6, .6], 0xe39a5b);          // snout
  blob([.07, .13, .05], [-.16, .93, .34], 0xd9843f);    // ears
  blob([.07, .13, .05], [.16, .93, .34], 0xd9843f);
  blob([.04, .05, .03], [-.1, .71, .6], 0x241a14);      // eyes
  blob([.04, .05, .03], [.1, .71, .6], 0x241a14);
  blob([.09, .09, .22], [0, .46, -.5], 0xe39a5b);       // tail
  for (const x of [-.18, .18]) for (const z of [-.22, .24]) blob([.1, .13, .12], [x, .13, z], 0xd9843f); // feet
  const geometry = mergeGeometries(parts, false); parts.forEach(g => g.dispose());
  return geometry;
}

export class PetVisuals {
  constructor(scene) {
    this.scene = scene; this.poses = new Map(); this.time = 0;
    this.geometry = buildPip(); this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8 });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_PETS);
    this.mesh.name = 'pets-pip'; this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false;
    scene.add(this.mesh); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._up = new THREE.Vector3(0, 1, 0); this._at = new THREE.Vector3(); this._one = new THREE.Vector3(1, 1, 1);
  }

  // creatures: the shared creature state map. Returns the ids drawn.
  update(dt, observer, creatures) {
    this.time += Math.min(.1, Math.max(0, dt || 0));
    const blend = 1 - Math.exp(-Math.min(.1, Math.max(0, dt || 0)) * 14), drawn = [];
    for (const [id, c] of Object.entries(creatures ?? {})) {
      if (!isPet(c) || c.active === false || ![c.x, c.y, c.z].every(Number.isFinite)
        || Math.hypot(c.x - observer.x, c.y - observer.y, c.z - observer.z) > SEE || drawn.length >= MAX_PETS) continue;
      let p = this.poses.get(id);
      if (!p) this.poses.set(id, p = { x: c.x, y: c.y, z: c.z, yaw: c.yaw || 0, phase: 0 });
      if (Math.hypot(p.x - c.x, p.z - c.z) > 6) { p.x = c.x; p.y = c.y; p.z = c.z; } // a teleport, not a glide
      p.x += (c.x - p.x) * blend; p.y += (c.y - p.y) * blend; p.z += (c.z - p.z) * blend;
      p.yaw += Math.atan2(Math.sin((c.yaw || 0) - p.yaw), Math.cos((c.yaw || 0) - p.yaw)) * blend;
      const moving = c.speed > .05; p.phase += Math.min(.1, dt || 0) * (moving ? 12 : 1.5);
      const hop = moving ? Math.abs(Math.sin(p.phase)) * .12 : Math.sin(p.phase) * .012;
      this._q.setFromAxisAngle(this._up, p.yaw);
      this._m.compose(this._at.set(p.x, p.y + hop, p.z), this._q, this._one);
      this.mesh.setMatrixAt(drawn.length, this._m); drawn.push(id);
    }
    for (const id of this.poses.keys()) if (!creatures?.[id]) this.poses.delete(id);
    this.mesh.count = drawn.length; this.mesh.visible = drawn.length > 0; this.mesh.instanceMatrix.needsUpdate = true;
    return drawn;
  }

  dispose() { this.scene.remove(this.mesh); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); this.poses.clear(); }
}
