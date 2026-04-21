import * as THREE from 'three';
import { Physics } from '../engine/physics.js';
import { raycast } from '../engine/raycast.js';
import { BLOCKS, BLOCK_DEFS, HOTBAR_BLOCKS } from '../constants/blocks.js';

const HALF_PI = Math.PI / 2 - 0.01;

export class Player {
  constructor(world, camera) {
    this._world    = world;
    this._camera   = camera;
    this._physics  = new Physics(world);

    this.position  = new THREE.Vector3(8, 48, 8);
    this._yaw      = 0;
    this._pitch    = 0;

    this._keys     = {};
    this._moveDir  = { x: 0, z: 0 };
    this._jump     = false;
    this._breaking = false;
    this._placing  = false;
    this._lastPlacing = false;
    this._breakTimer = 0;

    this.hotbar    = [...HOTBAR_BLOCKS];
    this.hotbarIdx = 0;

    // Set by touch.js on mobile
    this.touchMove  = { x: 0, z: 0 };
    this.touchJump  = false;
    this.touchBreak = false;
    this.touchPlace = false;

    this.targetBlock = null;

    this._bindEvents();
  }

  _bindEvents() {
    document.addEventListener('click', () => {
      if (!document.pointerLockElement) {
        document.getElementById('click-to-play')?.remove();
        document.body.requestPointerLock();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this._yaw   -= e.movementX * 0.002;
      this._pitch -= e.movementY * 0.002;
      this._pitch  = Math.max(-HALF_PI, Math.min(HALF_PI, this._pitch));
    });

    document.addEventListener('keydown', (e) => { this._keys[e.code] = true; });
    document.addEventListener('keyup',   (e) => { this._keys[e.code] = false; });

    document.addEventListener('mousedown', (e) => {
      if (!document.pointerLockElement) return;
      if (e.button === 0) this._breaking = true;
      if (e.button === 2) this._placing  = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this._breaking = false; this._breakTimer = 0; }
      if (e.button === 2) this._placing = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      this.hotbarIdx = (this.hotbarIdx + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      this._updateHotbarUI();
    });
  }

  update(dt) {
    this._computeMoveDir();
    this._physics.update(this.position, this._moveDir, this._jump || this.touchJump, dt);
    this._updateCamera();
    this._handleBlockInteraction(dt);
    this._updateHotbarUI();
  }

  _computeMoveDir() {
    const fwd = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
    const rgt = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw));

    let mx = 0, mz = 0;

    if (this._keys['KeyW'] || this._keys['ArrowUp'])    { mx += fwd.x; mz += fwd.z; }
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  { mx -= fwd.x; mz -= fwd.z; }
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  { mx -= rgt.x; mz -= rgt.z; }
    if (this._keys['KeyD'] || this._keys['ArrowRight']) { mx += rgt.x; mz += rgt.z; }

    if (this.touchMove.x !== 0 || this.touchMove.z !== 0) {
      mx += fwd.x * -this.touchMove.z + rgt.x * this.touchMove.x;
      mz += fwd.z * -this.touchMove.z + rgt.z * this.touchMove.x;
    }

    this._jump = this._keys['Space'] === true;

    const len = Math.sqrt(mx * mx + mz * mz);
    this._moveDir = len > 0 ? { x: mx / len, z: mz / len } : { x: 0, z: 0 };
  }

  _updateCamera() {
    this._camera.position.copy(this.position).add(new THREE.Vector3(0, 1.6, 0));
    this._camera.rotation.order = 'YXZ';
    this._camera.rotation.y = this._yaw;
    this._camera.rotation.x = this._pitch;
  }

  _handleBlockInteraction(dt) {
    const dir = new THREE.Vector3();
    this._camera.getWorldDirection(dir);
    const eyePos = this._camera.position;

    const hit = raycast(this._world, eyePos, dir);
    this.targetBlock = hit;

    const nameEl = document.getElementById('block-name');
    if (nameEl) {
      if (hit) {
        const id = this._world.getBlock(hit.x, hit.y, hit.z);
        nameEl.textContent = BLOCK_DEFS[id]?.name ?? '';
      } else {
        nameEl.textContent = '';
      }
    }

    if ((this._breaking || this.touchBreak) && hit) {
      this._breakTimer += dt;
      if (this._breakTimer >= 0.3) {
        this._world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
        this._breakTimer = 0;
        this._onBlockChanged(hit.x, hit.y, hit.z);
      }
    } else {
      this._breakTimer = 0;
    }

    const placingNow = this._placing || this.touchPlace;
    if (placingNow && !this._lastPlacing && hit) {
      const px = hit.x + hit.face[0];
      const py = hit.y + hit.face[1];
      const pz = hit.z + hit.face[2];
      const pp = this.position;
      const ddx = Math.abs(px + 0.5 - pp.x);
      const ddz = Math.abs(pz + 0.5 - pp.z);
      const ddy = py - pp.y;
      if (!(ddx < 0.4 && ddz < 0.4 && ddy >= -0.1 && ddy < 1.9)) {
        this._world.setBlock(px, py, pz, this.hotbar[this.hotbarIdx]);
        this._onBlockChanged(px, py, pz);
      }
    }
    this._lastPlacing = placingNow;
  }

  _updateHotbarUI() {
    const slots = document.querySelectorAll('.hotbar-slot');
    slots.forEach((el, i) => {
      el.classList.toggle('active', i === this.hotbarIdx);
    });
  }

  // Overridden by main.js to trigger chunk remesh
  _onBlockChanged(x, y, z) {}
}
