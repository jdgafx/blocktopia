import { CREATURE_SPECIES } from './creature-species.js';

// Pets: one egg per player, hatched by walking over new ground, then a Pip that follows its owner.
export const PET_SPECIES = 'pip';
export const PET_NAMES = Object.freeze(['Pip', 'Pebble', 'Biscuit', 'Mochi', 'Clover', 'Nugget', 'Pickle', 'Waffles']);
export const PET_START_TRUST = 10;
export const PET_PAT_TRUST = 2;
export const WALK_CELLS = 60;   // new 4x4-block cells that hatch an egg: about 75 s of walking
const CELL = 4, MEMORY = 96, JUMP = 8;  // JUMP: blocks between two host steps that count as a teleport

export const petId = ownerId => `pet:${ownerId}`;
export const isPet = c => CREATURE_SPECIES[c?.species]?.kind === 'pet';

// Counts cells the player enters that are not among the last MEMORY cells it visited. Circles, back-and-forth
// and teleports revisit or skip cells, so they add (almost) nothing; path length never counts.
export function walkGain(walk, id, pos) {
  const w = walk.get(id) ?? { at: null, key: '', seen: new Set() };
  walk.set(id, w);
  const key = `${Math.floor(pos.x / CELL)},${Math.floor(pos.z / CELL)}`;
  const jumped = w.at && Math.hypot(pos.x - w.at.x, pos.z - w.at.z) > JUMP;
  w.at = { x: pos.x, z: pos.z };
  if (!w.key) { w.key = key; w.seen.add(key); return 0; }
  if (jumped) { w.key = key; return 0; }
  if (key === w.key) return 0;
  w.key = key;
  if (w.seen.has(key)) return 0;
  w.seen.add(key);
  if (w.seen.size > MEMORY) w.seen.delete(w.seen.values().next().value);
  return 1;
}

export function newPet(ownerId, { name = PET_NAMES[0], trust = PET_START_TRUST } = {}, at, now) {
  return { id: petId(ownerId), species: PET_SPECIES, name, x: at.x, y: at.y, z: at.z, homeX: at.x, homeZ: at.z, yaw: 0,
    health: CREATURE_SPECIES[PET_SPECIES].health, hunger: 100, fear: 0, boldness: .5, temperament: 'calm',
    trust: { [ownerId]: trust }, ownerId, behavior: 'resting', command: 'follow', active: true, harvested: false, touched: true,
    lastPositiveAt: 0, lastAttackAt: 0, lastHurtAt: 0, lastSimAt: now, threatId: null, speed: 0, scale: 1, age: 'adult', bag: {} };
}

// The account-level record (what is saved with the player): { stage:'egg', egg } or { stage:'pet', name, trust }.
export function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.stage === 'pet') {
    const trust = Number.isFinite(r.trust) ? Math.max(0, Math.min(100, Math.round(r.trust))) : PET_START_TRUST;
    return { stage: 'pet', name: PET_NAMES.includes(r.name) ? r.name : PET_NAMES[0], trust };
  }
  if (r.stage === 'egg') return { stage: 'egg', egg: Number.isFinite(r.egg) ? Math.max(0, Math.min(1, r.egg)) : 0 };
  return null;
}

// What this player owns now, read from the shared creature state (also the diagnostics shape).
export function petView(state, actorId) {
  const c = state?.creatures?.[petId(actorId)];
  if (c) return { stage: 'pet', name: c.name, species: c.species, trust: c.trust[actorId] ?? 0, position: [c.x, c.y, c.z] };
  return { stage: 'egg', progress: state?.players?.[actorId]?.egg ?? 0 };
}
export const petRecord = view => view.stage === 'pet' ? { stage: 'pet', name: view.name, trust: view.trust } : { stage: 'egg', egg: view.progress };
