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
    this._breakTarget = null;
    this._breakQueued = false; this._placeQueued = 0;
    this.breakProgress = 0; this.isSwinging = false; this.interactionSwing = 0;

    this.hotbar    = [...HOTBAR_BLOCKS];
    this.hotbarIdx = 0;

    // Set by touch.js on mobile
    this.touchMove  = { x: 0, z: 0 };
    this.touchJump  = false;
    this.touchBreak = false;
    this.touchPlace = false;

    this.active = false;
    this.mouseMode = document.querySelector?.('[data-mouse-mode]')?.value ?? 'capture';
    this._cursorLook = null;
    this._captureRequest = 0; this._capturePending = 0;
    this.targetBlock = null;
    this._onBlockIntent = null;

    this._bindEvents();
  }

  _bindEvents() {
    const canvas = document.getElementById('canvas');
    const play = document.getElementById('click-to-play');
    let playPointer = '';
    play.addEventListener('pointerdown', (event) => { playPointer = event.pointerType; });
    play.addEventListener('click', (event) => {
      const pointer = event.pointerType || playPointer;
      playPointer = '';
      const touch = pointer === 'touch' || event.sourceCapabilities?.firesTouchEvents
        || (!pointer && window.matchMedia?.('(pointer: coarse)').matches);
      if (touch || this.mouseMode === 'cursor') this.setActive(true);
      else this._requestMouseCapture();
    });
    document.addEventListener('pointerlockchange', () => {
      const active = document.pointerLockElement === canvas;
      if (active && this._capturePending !== this._captureRequest) { document.exitPointerLock?.(); return; }
      if (active) {
        const hint = document.getElementById('input-hint');
        if (hint) hint.textContent = '';
      }
      if (active !== this.active) this.setActive(active);
    });
    document.getElementById('game-menu').addEventListener('click', () => {
      document.exitPointerLock?.();
      this.setActive(false);
    });
    window.addEventListener('game-mouse-mode', event => {
      this.mouseMode = event.detail;
      if (this.active) { document.exitPointerLock?.(); this.setActive(false); }
    });
    window.addEventListener('blur', () => {
      document.exitPointerLock?.();
      this.setActive(false);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.active && this._cursorLook && !document.pointerLockElement) {
        this._cursorLook.distance += Math.hypot(e.movementX || 0, e.movementY || 0);
        if (this._cursorLook.distance > 3) {
          this._yaw -= (e.movementX || 0) * .002;
          this._pitch = Math.max(-HALF_PI, Math.min(HALF_PI, this._pitch - (e.movementY || 0) * .002));
        }
        return;
      }
      if (this.mouseMode === 'cursor' && !document.pointerLockElement) return;
      if (!this.active || (document.pointerLockElement !== canvas
        && !(e.target === canvas && (this._breaking || this._placing)))) return;
      this._yaw   -= e.movementX * 0.002;
      this._pitch -= e.movementY * 0.002;
      this._pitch  = Math.max(-HALF_PI, Math.min(HALF_PI, this._pitch));
    });

    document.addEventListener('keydown', (e) => {
      if (this.active && (e.code === 'Escape' || (e.code === 'KeyM' && !e.target.closest?.('input, textarea, select')))) {
        e.preventDefault(); document.exitPointerLock?.(); this.setActive(false); return;
      }
      if (e.code === 'Escape' && !document.pointerLockElement) { this.setActive(false); return; }
      if (!this.active || e.target.closest?.('input, textarea')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyE') { e.preventDefault(); this._onInventory?.(); return; }
      this._keys[e.code] = true;
      if (/^Digit[1-9]$/.test(e.code)) this.selectBlock(Number(e.code.slice(-1)) - 1);
    });
    document.addEventListener('keyup',   (e) => { this._keys[e.code] = false; });

    document.addEventListener('mousedown', (e) => {
      if (!this.active || e.target !== canvas || e.sourceCapabilities?.firesTouchEvents) return;
      if (e.button !== 0 && e.button !== 2) return;
      if (this.mouseMode === 'cursor' && !document.pointerLockElement && e.button === 2) {
        this._cursorLook = { distance: 0 }; return;
      }
      if (document.pointerLockElement !== canvas && this.mouseMode !== 'cursor') this._requestMouseCapture();
      this.beginInteraction(e.button === 0 ? 'break' : 'place');
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 2 && this._cursorLook) {
        if (this._cursorLook.distance <= 3 && e.target === canvas) this.beginInteraction('place');
        this._cursorLook = null; this.endInteraction('place'); return;
      }
      if (e.button === 0 || e.button === 2) this.endInteraction(e.button === 0 ? 'break' : 'place');
    });
    document.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });

    document.addEventListener('wheel', (e) => {
      if (this.active) this.selectBlock((this.hotbarIdx + (e.deltaY > 0 ? 1 : -1) + this.hotbar.length) % this.hotbar.length);
    });
  }

  async _requestMouseCapture() {
    const request = ++this._captureRequest;
    this._capturePending = request;
    try {
      const canvas = document.getElementById('canvas');
      if (!canvas.requestPointerLock) throw new Error('Pointer lock unavailable');
      await canvas.requestPointerLock();
    } catch {
      if (request !== this._captureRequest) return;
      if (!this.active) this.setActive(true);
      const hint = document.getElementById('input-hint');
      if (hint) hint.textContent = 'Mouse capture unavailable. Hold a mouse button and drag to look; hold left click to chop.';
    }
  }

  beginInteraction(kind, touch = false) {
    if (!this.active) return;
    if (kind === 'break') {
      this[touch ? 'touchBreak' : '_breaking'] = true;
      this._breakQueued = true;
    } else if (kind === 'place') {
      this[touch ? 'touchPlace' : '_placing'] = true;
      this._placeQueued = Math.min(12, this._placeQueued + 1);
    } else return;
    this.interactionSwing++;
  }

  endInteraction(kind, touch = false) {
    if (kind === 'break') {
      this[touch ? 'touchBreak' : '_breaking'] = false;
      if (!this._breaking && !this.touchBreak) this._breakTimer = this.breakProgress = 0;
    } else if (kind === 'place') this[touch ? 'touchPlace' : '_placing'] = false;
  }

  setActive(active) {
    if (!active) this._captureRequest = (this._captureRequest ?? 0) + 1;
    this.active = active;
    this._cursorLook = null;
    this._keys = {};
    this._breaking = this._placing = this._lastPlacing = false;
    this._breakTimer = this.breakProgress = 0;
    this._breakTarget = null; this._breakQueued = false; this._placeQueued = 0;
    this.isSwinging = false;
    this.touchMove = { x: 0, z: 0 };
    this.touchJump = this.touchBreak = this.touchPlace = false;
    document.getElementById('room-gate').hidden = active;
    if (active) document.getElementById('menu-status').textContent = '';
    document.getElementById('touch-controls').hidden = !active;
    if (!active) {
      document.getElementById('play-title').textContent = 'World menu';
      document.getElementById('play-instruction').textContent = 'Resume playing';
      document.getElementById('click-to-play').focus();
    }
  }

  selectBlock(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.hotbar.length) return;
    this.hotbarIdx = index;
    this._updateHotbarUI();
  }

  update(dt) {
    if (!this.active) { this._updateCamera(); return; }
    this._computeMoveDir();
    this._physics.update(this.position, this._moveDir, this._jump || this.touchJump, dt);
    this._updateCamera();
    this._handleBlockInteraction(dt);
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

    const target = hit ? `${hit.x},${hit.y},${hit.z}:${this._world.getBlock(hit.x, hit.y, hit.z)}` : null;
    if (target !== this._breakTarget) this._breakTimer = 0;
    this._breakTarget = target;
    const breaking = this._breaking || this.touchBreak || this._breakQueued;
    const placingNow = this._placing || this.touchPlace;
    const place = this._placeQueued > 0 || (placingNow && !this._lastPlacing);
    this._breakQueued = false;
    if (this._placeQueued > 0) this._placeQueued--;
    this.isSwinging = breaking || place;
    if (this._creatureInteraction?.(dt, breaking)) { this._breakTimer = 0; this._lastPlacing = placingNow; return; }
    if (breaking && hit && this._world.getBlock(hit.x, hit.y, hit.z) !== BLOCKS.BEDROCK) {
      this._breakTimer += dt;
      if (this._breakTimer >= 0.3) {
        this._requestBlockChange(hit.x, hit.y, hit.z, BLOCKS.AIR);
        this._breakTimer = 0;
      }
    } else this._breakTimer = 0;
    this.breakProgress = Math.min(1, this._breakTimer / 0.3);

    if (place && hit) {
      const px = hit.x + hit.face[0];
      const py = hit.y + hit.face[1];
      const pz = hit.z + hit.face[2];
      const pp = this.position;
      const ddx = Math.abs(px + 0.5 - pp.x);
      const ddz = Math.abs(pz + 0.5 - pp.z);
      const ddy = py - pp.y;
      if (!(ddx < 0.4 && ddz < 0.4 && ddy >= -0.1 && ddy < 1.9)) {
        this._requestBlockChange(px, py, pz, this.hotbar[this.hotbarIdx]);
      }
    }
    this._lastPlacing = placingNow;
  }

  _updateHotbarUI() {
    const slots = document.querySelectorAll('.hotbar-slot');
    slots.forEach((el, i) => {
      el.classList.toggle('active', i === this.hotbarIdx);
      el.setAttribute('aria-pressed', String(i === this.hotbarIdx));
    });
  }

  _requestBlockChange(x, y, z, blockId) {
    this.interactionSwing++;
    if (this._onBlockIntent) {
      this._onBlockIntent({ x, y, z, blockId });
      return;
    }
    this._world.setBlock(x, y, z, blockId);
    this._onBlockChanged(x, y, z);
  }

  // Overridden by main.js to trigger chunk remesh
  _onBlockChanged(x, y, z) {}
}
