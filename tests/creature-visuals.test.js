import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildCreature, CreatureVisuals } from '../src/game/creature-visuals.js';
import { CreatureAudio } from '../src/game/creature-audio.js';

const species = ['raptor', 'stegosaur', 'mammoth', 'griffin', 'forest-dragon', 'moonstag', 'sauropod', 'triceratops'];
const materials = Object.fromEntries(['skin', 'bone', 'dark', 'eye'].map(key => [key, new THREE.MeshStandardMaterial()]));

it('builds eight grounded articulated silhouettes and cheaper distance meshes for the six new species', () => {
  for (const name of species) {
    const counts = [];
    for (const detailed of [true, false]) {
      const model = buildCreature(name, materials, detailed); let triangles = 0, draws = 0;
      model.traverse(p => {
        if (!p.isMesh) return; draws++; triangles += p.geometry.index.count / 3;
        expect([...p.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
        expect([...p.geometry.attributes.normal.array].every(Number.isFinite)).toBe(true);
      });
      const bounds = new THREE.Box3().setFromObject(model);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.02);
      expect(bounds.max.y).toBeGreaterThan(1.3);
      expect(model.children.filter(p => p.name.startsWith('leg-')).length).toBe(name === 'raptor' ? 2 : 4);
      expect(model.getObjectByName('head')).toBeTruthy(); expect(model.getObjectByName('tail')).toBeTruthy();
      if (['griffin', 'forest-dragon'].includes(name)) expect(bounds.max.x - bounds.min.x).toBeGreaterThan(5);
      expect(draws).toBeLessThan(28); expect(triangles).toBeLessThan(25000); counts.push(triangles);
      model.traverse(p => p.geometry?.dispose());
    }
    if (!['sauropod', 'triceratops'].includes(name)) expect(counts[1]).toBeLessThan(counts[0] * .6);
  }
});

it('loads actual texture paths, selects visible geometry, removes harvested animals and disposes resources', async () => {
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(new THREE.Texture());
  const scene = new THREE.Scene(), visuals = new CreatureVisuals({}, scene); await visuals.ready;
  expect(load.mock.calls.map(call => call[0])).toEqual(species.map(name => `/textures/${['sauropod', 'triceratops'].includes(name) ? 'animals' : 'creatures'}/${name}-color.webp`));
  const c = { species: 'mammoth', x: 0, y: 0, z: -4, yaw: 0, health: 10, active: true, speed: 1, behavior: 'wandering' };
  visuals.update(.1, new THREE.Vector3(0, 1.6, 0), { creatures: { a: c } });
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.6, 0); camera.updateMatrixWorld();
  expect(visuals.target(camera)).toBe('a');
  expect(visuals.lastTargetDistance).toBeGreaterThan(0); expect(visuals.lastTargetDistance).toBeLessThan(6);
  const r = visuals.records.get('a'); expect(r.joints[0].legs.some(p => p.rotation.x !== 0)).toBe(true);
  visuals.update(.1, new THREE.Vector3(0, 1.6, 45), { creatures: { a: c } });
  expect(r.models[0].visible).toBe(false); expect(r.models[1].visible).toBe(true);
  expect(r.shadows).toBe(false);
  visuals.update(.1, camera.position, { creatures: { a: { ...c, health: 0, behavior: 'dead' } } });
  expect(r.models[0].rotation.z).toBeGreaterThan(0);
  visuals.update(.1, camera.position, { creatures: { a: { ...c, harvested: true } } });
  expect(scene.children).toHaveLength(0);
  expect(visuals.target(camera)).toBe(null); expect(visuals.lastTargetDistance).toBe(Infinity);
  const roster = Object.fromEntries(species.map((name, i) => [name, { ...c, species: name, x: i * 4, z: -8 }]));
  visuals.update(.1, camera.position, { creatures: roster });
  expect(visuals.records.size).toBe(8);
  for (const record of visuals.records.values()) expect(record.joints.flatMap(j => j.legs).every(leg => Number.isFinite(leg.rotation.x))).toBe(true);
  visuals.dispose(); expect(visuals.records.size).toBe(0); load.mockRestore();
});

it('keeps sound silent before a gesture and safely handles an unavailable audio context', async () => {
  const audio = new CreatureAudio(); audio.update(.1, { x: 0, y: 0, z: 0 }, { creatures: {} });
  expect(audio.context).toBe(null); expect(await audio.unlock()).toBe(false); audio.dispose();
  expect(await audio.unlock()).toBe(false);
});

it('synthesizes distinct calls only nearby, respects cooldowns, and disconnects on disposal', async () => {
  const nodes = [], param = () => ({ value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = () => { const n = { frequency: param(), gain: param(), pan: param(), Q: param(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; nodes.push(n); return n; };
  class Context {
    state = 'suspended'; currentTime = 0; sampleRate = 100; destination = {};
    resume = async () => { this.state = 'running'; };
    close = async () => { this.state = 'closed'; };
    createBuffer = () => ({ getChannelData: () => new Float32Array(200) });
    createOscillator = node; createGain = node; createBufferSource = node; createBiquadFilter = node; createStereoPanner = node;
  }
  vi.stubGlobal('AudioContext', Context);
  try {
    const audio = new CreatureAudio(); expect(await audio.unlock()).toBe(true);
    const observer = { x: 0, y: 1, z: 0 }, c = { species: 'raptor', x: 0, y: 0, z: 40, health: 10, behavior: 'wandering' };
    audio.update(.1, observer, { creatures: { a: c } }); expect(audio.voices.size).toBe(0);
    c.z = 4; audio.update(.1, observer, { creatures: { a: c } }); expect(audio.voices.size).toBe(1);
    expect(nodes[0].frequency.setValueAtTime).toHaveBeenCalledWith(520, 0);
    for (let i = 0; i < 20; i++) audio.update(.1, observer, { creatures: { a: c } });
    expect(audio.voices.size).toBe(1); expect(audio.cooldowns.get('a')).toBeGreaterThan(audio.time);
    audio.dispose(); expect(nodes.every(n => n.disconnect.mock.calls.length > 0)).toBe(true);
    expect(audio.context.state).toBe('closed');
  } finally { vi.unstubAllGlobals(); }
});
