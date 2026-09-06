import * as THREE from 'three';
import { BLOCK_DEFS } from '../constants/blocks.js';

export class FirstPerson {
  constructor(camera, scene, terrainMaterials = []) {
    this.terrainMaterials = terrainMaterials;
    this.lastHit = 0; this.shake = 0;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.scene = scene; this.camera = camera; this.time = 0; this.swing = 0; this.lastAction = 0;
    this.hand = new THREE.Group(); camera.add(this.hand); scene.add(camera);
    this.hand.scale.setScalar(0.8);
    const skin = new THREE.MeshStandardMaterial({ color: 0xba8966, roughness: .8, depthTest: false });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d5348, roughness: .95, depthTest: false });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4930, roughness: .8, depthTest: false });
    const steel = new THREE.MeshStandardMaterial({ color: 0x858e90, metalness: .55, roughness: .4, depthTest: false });
    // Draw the held tool after transparent atmosphere and world surfaces.
    for (const material of [skin, sleeve, wood, steel]) material.transparent = true;
    const part = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.renderOrder = 1000; this.hand.add(mesh); return mesh;
    };
    part(new THREE.CylinderGeometry(.075, .11, .45, 10), sleeve, 0, -.26, 0).rotation.x = -.3;
    part(new THREE.BoxGeometry(.145, .19, .1), skin, 0, 0, 0);
    for (let i = 0; i < 4; i++) part(new THREE.CapsuleGeometry(.022, .07, 3, 6), skin, -.052 + i * .034, .045, -.05).rotation.x = Math.PI / 2;
    part(new THREE.CapsuleGeometry(.026, .06, 3, 6), skin, -.08, -.01, -.02).rotation.z = -.5;
    part(new THREE.CylinderGeometry(.025, .032, .68, 8), wood, .005, .21, -.095);
    const blade = new THREE.Shape(); blade.moveTo(-.04, -.09); blade.lineTo(.13, -.14); blade.lineTo(.25, -.1); blade.quadraticCurveTo(.3, .02, .25, .14); blade.lineTo(.12, .1); blade.lineTo(-.04, .09); blade.closePath();
    const head = part(new THREE.ExtrudeGeometry(blade, { depth: .045, bevelEnabled: true, bevelSize: .009, bevelThickness: .009, bevelSegments: 1, steps: 1 }), steel, -.01, .48, -.12);
    head.rotation.y = -.2;
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)), new THREE.LineBasicMaterial({ color: 0xffe6a5, transparent: true, opacity: .85 }));
    scene.add(this.outline);
    this.crackStages = Array.from({ length: 4 }, (_, stage) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.strokeStyle = '#171310'; ctx.lineWidth = 2 + stage;
      for (let n = 0; n < 3 + stage * 2; n++) {
        const angle = n * 2.399; ctx.beginPath(); ctx.moveTo(64, 64);
        for (let j = 1; j <= 2 + stage; j++) ctx.lineTo(64 + Math.cos(angle + Math.sin(j * 7 + n) * .2) * j * 14, 64 + Math.sin(angle) * j * 14);
        ctx.stroke();
      }
      return new THREE.CanvasTexture(canvas);
    });
    this.cracks = new THREE.Mesh(new THREE.BoxGeometry(1.009, 1.009, 1.009), new THREE.MeshBasicMaterial({ map: this.crackStages[0], transparent: true, opacity: .9, depthWrite: false })); scene.add(this.cracks);
    this.fragments = []; this.fragmentGeometry = new THREE.BoxGeometry(.075, .075, .075);
    this.fragmentMaterials = [0x798267, 0x725844, 0x777b7a, 0x98734c].map(color => new THREE.MeshLambertMaterial({ color }));
    document.addEventListener('pointerdown', () => {
      try { this.audio ??= new (window.AudioContext || window.webkitAudioContext)(); this.audio.resume().catch(() => {}); } catch {}
    });
  }
  impact(x, y, z, blockId, face = [0, 1, 0], count = 10) {
    if (Math.hypot(this.camera.position.x - x, this.camera.position.y - y, this.camera.position.z - z) > 24) return;
    const tile = BLOCK_DEFS[blockId]?.[face[1] > 0 ? 'top' : face[1] < 0 ? 'bot' : 'side'];
    const material = tile && this.terrainMaterials[tile[1] * 4 + tile[0]];
    for (let i = 0; i < count; i++) {
      if (this.fragments.length >= 80) { const old = this.fragments.shift(); this.scene.remove(old.mesh); }
      const mesh = new THREE.Mesh(this.fragmentGeometry, material ?? this.fragmentMaterials[[4, 8].includes(blockId) ? 3 : blockId === 1 || blockId === 5 ? 0 : blockId === 2 ? 1 : 2]);
      mesh.position.set(x + .5 + face[0] * .52, y + .5 + face[1] * .52, z + .5 + face[2] * .52); this.scene.add(mesh);
      this.fragments.push({ mesh, life: .65, velocity: new THREE.Vector3(face[0] * 2 + Math.sin(i * 2.399) * .8, face[1] * 2 + .8 + Math.sin(i * 4.13) * .6, face[2] * 2 + Math.cos(i * 2.399) * .8) });
    }
    this.sound();
  }
  sound() {
    const audio = this.audio; if (!audio || audio.state !== 'running') return;
    const length = Math.floor(audio.sampleRate * .09), buffer = audio.createBuffer(1, length, audio.sampleRate);
    const values = buffer.getChannelData(0); for (let i = 0; i < length; i++) values[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 1300; gain.gain.value = .13;
    source.connect(filter).connect(gain).connect(audio.destination); source.start(); source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  update(dt, player) {
    this.time += dt;
    if (player.active && player.blockHit && player.blockHit.sequence !== this.lastHit) {
      const hit = player.blockHit; this.lastHit = hit.sequence;
      this.impact(hit.x, hit.y, hit.z, hit.blockId, hit.face, 4);
      this.shake = .1;
    }
    this.shake = player.active ? Math.max(0, this.shake - dt) : 0;
    if (!this.reducedMotion?.matches) {
      this.camera.rotation.x += Math.sin(this.time * 85) * this.shake * .035;
      this.camera.rotation.z += Math.sin(this.time * 67) * this.shake * .025;
    }
    if (player.interactionSwing !== this.lastAction) { this.lastAction = player.interactionSwing; this.swing = 1; }
    if (player.isSwinging) this.swing = Math.max(this.swing, .6 + Math.sin(this.time * 22) * .4);
    else this.swing = Math.max(0, this.swing - dt * 6);
    const moving = Math.hypot(player._moveDir?.x ?? 0, player._moveDir?.z ?? 0) > .1;
    this.hand.visible = player.active;
    this.hand.position.set(.34 - this.swing * .1, -.36 - this.swing * .04 + (moving ? Math.sin(this.time * 9) * .012 : 0), -.62 - this.swing * .12);
    this.hand.rotation.set(-.2 - this.swing * .7, -.35, -.22 + this.swing * .3);
    const progress = document.getElementById('break-progress');
    if (progress) { progress.value = player.breakProgress ?? 0; progress.hidden = !player.active || !progress.value; }
    const hit = player.targetBlock;
    this.outline.visible = player.active && Boolean(hit);
    this.cracks.visible = this.outline.visible && player.breakProgress > 0;
    if (hit) {
      this.outline.position.set(hit.x + .5, hit.y + .5, hit.z + .5);
      this.cracks.position.copy(this.outline.position);
      this.cracks.material.map = this.crackStages[Math.min(3, Math.floor((player.breakProgress ?? 0) * 4))];
    }
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i]; f.life -= dt; f.velocity.y -= 9 * dt; f.mesh.position.addScaledVector(f.velocity, dt); f.mesh.rotation.x += dt * 4;
      f.mesh.scale.setScalar(Math.min(1, f.life * 4));
      if (f.life <= 0) { this.scene.remove(f.mesh); this.fragments.splice(i, 1); }
    }
  }
}
