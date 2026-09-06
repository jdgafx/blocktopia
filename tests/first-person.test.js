import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { FirstPerson } from '../src/game/first-person.js';

afterEach(() => vi.unstubAllGlobals());
it('uses the struck face material, outward fragments and four progressing crack stages', () => {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => ({ beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }) }),
    addEventListener() {}, getElementById: () => null,
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1, 3);
  const materials = Array.from({ length: 16 }, () => new THREE.MeshStandardMaterial());
  const view = new FirstPerson(camera, new THREE.Scene(), materials);
  const player = { active: true, interactionSwing: 0, breakProgress: .05,
    targetBlock: { x: 0, y: 0, z: 0 },
    blockHit: { x: 0, y: 0, z: 0, blockId: 4, face: [0, 0, 1], sequence: 1 } };
  view.update(.016, player);
  expect(view.fragments).toHaveLength(4);
  for (const fragment of view.fragments) {
    expect(fragment.mesh.material).toBe(materials[5]); // Log bark side, not end grain.
    expect(fragment.velocity.z).toBeGreaterThan(0);
    expect(fragment.mesh.position.z).toBeGreaterThan(1);
  }
  expect(view.cracks.material.map).toBe(view.crackStages[0]);
  for (const [progress, index] of [[.3, 1], [.55, 2], [.8, 3]]) {
    player.breakProgress = progress; view.update(.016, player);
    expect(view.cracks.material.map).toBe(view.crackStages[index]);
  }
  expect(view.fragments).toHaveLength(4); // Same hit cannot emit again.
  player.breakProgress = 0; player.active = false; view.update(.016, player);
  expect(view.cracks.visible).toBe(false);
  expect(view.shake).toBe(0);
});
