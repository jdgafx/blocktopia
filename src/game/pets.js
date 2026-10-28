import { CREATURE_SPECIES } from './creature-species.js';

// Pets: one egg per player, hatched by walking over new ground, then a Pip that follows its owner.
export const PET_SPECIES = 'pip';
export const PET_NAMES = Object.freeze(['Pip', 'Pebble', 'Biscuit', 'Mochi', 'Clover', 'Nugget', 'Pickle', 'Waffles']);
export const PET_START_TRUST = 10;
export const PET_PAT_TRUST = 2;
export const WALK_CELLS = 26;   // 6-block steps away from where the player has been that hatch an egg: 52 s at the fastest, about 75 s typical
const STEP = 6, MEMORY = 12, JUMP = 8, MAX_RATE = .5;  // MAX_RATE: steps per second, so a fast runner cannot hatch before about 50 s
// shortcut: the headless/phone speed varies 2x, so slow walkers take up to ~95 s; fine for "about 60-90 s".  // MEMORY: recent anchor points; JUMP: blocks between two host steps that count as a teleport

export const petId = ownerId => `pet:${ownerId}`;
export const isPet = c => CREATURE_SPECIES[c?.species]?.kind === 'pet';

// A step counts when the player stands STEP blocks from every one of its last MEMORY anchor points, then becomes
// an anchor. Circles and back-and-forth stay near old anchors and teleports reset them, so they add (almost)
// nothing; path length never counts.
export function walkGain(walk, id, pos, now = 0) {
  const w = walk.get(id) ?? { at: null, anchors: [], credit: 0, t: now, path: 0 };
  walk.set(id, w);
  w.credit = Math.min(2, w.credit + Math.max(0, now - w.t) / 1000 * MAX_RATE); w.t = now;
  const stride = w.at ? Math.hypot(pos.x - w.at.x, pos.z - w.at.z) : 0, jumped = stride > JUMP;
  w.at = { x: pos.x, z: pos.z };
  if (jumped || !w.anchors.length) { w.anchors = [w.at]; w.path = 0; return 0; }
  w.path += stride;
  if (w.credit < 1 || w.anchors.some(a => Math.hypot(pos.x - a.x, pos.z - a.z) < STEP)) return 0;
  const straight = w.path <= 1.6 * Math.hypot(pos.x - w.anchors.at(-1).x, pos.z - w.anchors.at(-1).z); // back-and-forth piles up path, not distance
  if (straight) w.credit -= 1;
  w.path = 0; w.anchors.push(w.at);
  if (w.anchors.length > MEMORY) w.anchors.shift();
  return straight ? 1 : 0;
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
