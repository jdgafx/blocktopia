import { describe, it, expect } from 'vitest';
import { initialCreatureState, validCreatureState, creatureAction, allowedActions, newCreaturePlayer } from '../src/game/creature-state.js';
import { stepCreatures } from '../src/game/creature-simulation.js';
import { walkGain, WALK_CELLS, petId, petView, newPet } from '../src/game/pets.js';
import { PetSaves } from '../src/game/saves.js';

const land = { surfaceHeight: () => 28, isSolid: (x, y) => y <= 28, getBlock: (x, y) => y === 28 ? 1 : y < 28 ? 3 : 0 };
const lake = { surfaceHeight: () => 20, isSolid: (x, y) => y <= 20, getBlock: (x, y) => y <= 20 ? 3 : y <= 27 ? 14 : 0 }; // water to y 27
const at = (x, z, y = 29) => ({ x, y, z });
const step = (state, now, players, terrain = land, walk) => stepCreatures(state, { ...terrain, now, dt: .2, players, walk });

describe('walking hatches the egg, cheating does not', () => {
  const run = path => { const walk = new Map(); let n = 0; for (const p of path) n += walkGain(walk, 'a', p); return n; };
  it('counts a straight walk, not circles, back-and-forth or teleports', () => {
    expect(run(Array.from({ length: 200 }, (_, i) => ({ x: i * .5, z: 0 })))).toBeGreaterThanOrEqual(24); // 100 blocks
    expect(run(Array.from({ length: 400 }, (_, i) => ({ x: Math.cos(i / 6) * 2, z: Math.sin(i / 6) * 2 })))).toBeLessThanOrEqual(4);
    expect(run(Array.from({ length: 400 }, (_, i) => ({ x: Math.abs(((i * .5) % 30) - 15), z: 0 })))).toBeLessThanOrEqual(5);
    expect(run(Array.from({ length: 10 }, (_, i) => ({ x: i * 150, z: 0 })))).toBe(0);
  });
  it('the host hatches Pip beside its owner once enough new ground is walked', () => {
    let state = initialCreatureState(1), now = 1000; const walk = new Map();
    for (let i = 0; i < WALK_CELLS * 8 && !state.creatures[petId('alice')]; i++) { now += 200; state = step(state, now, [{ id: 'alice', position: at(i * .8, 0) }], land, walk); }
    expect(validCreatureState(state)).toBe(true);
    expect(state.creatures[petId('alice')]).toMatchObject({ species: 'pip', name: 'Pip', ownerId: 'alice' });
    expect(petView(state, 'alice')).toMatchObject({ stage: 'pet', name: 'Pip', trust: 10 });
  });
});

describe('a pet follows, swims, and cannot be harmed', () => {
  const pet = (x, z, y = 29) => { const s = initialCreatureState(1); s.players.alice = newCreaturePlayer(); s.players.alice.egg = 1; s.creatures[petId('alice')] = newPet('alice', {}, at(x, z, y), 1); return s; };
  it('stays within a few blocks while its owner walks away and jumps far', () => {
    let s = pet(0, 0), now = 1000;
    for (let i = 0; i < 100; i++) { now += 200; s = step(s, now, [{ id: 'alice', position: at(i * .9, 0) }]); }
    expect(Math.hypot(s.creatures[petId('alice')].x - 89.1, s.creatures[petId('alice')].z)).toBeLessThanOrEqual(6);
    now += 200; s = step(s, now, [{ id: 'alice', position: at(900, 40) }]);
    expect(Math.hypot(s.creatures[petId('alice')].x - 900, s.creatures[petId('alice')].z - 40)).toBeLessThanOrEqual(6);
  });
  it('follows onto the water and floats on it', () => {
    let s = pet(0, 0, 21), now = 1000;
    for (let i = 0; i < 40; i++) { now += 200; s = step(s, now, [{ id: 'alice', position: at(i * .5, 3, 28) }], lake); }
    const c = s.creatures[petId('alice')];
    expect(Math.hypot(c.x - 19.5, c.z - 3)).toBeLessThanOrEqual(6); expect(c.y).toBeGreaterThan(27); expect(c.y).toBeLessThan(29);
  });
  const act = (s, action, who = 'bob', extra = {}) => creatureAction(s, {}, { action, targetId: petId('alice'), ...extra }, { ...land, actorId: who, position: at(1, 0), tool: 'axe', now: 5000 });
  it('offers and accepts only pat, follow, stay and rename; a friend pat raises the owner trust', () => {
    const s = pet(0, 0);
    expect(allowedActions(s.creatures[petId('alice')])).toEqual(['pat', 'follow', 'stay', 'rename']);
    for (const who of ['bob', 'alice']) for (const action of ['fight', 'harvest', 'release', 'feed', 'care', 'load']) {
      expect(act(s, action, who, { confirm: true, itemId: 100, count: 1 }).ok, `${who} ${action}`).toBe(false);
    }
    const patted = act(s, 'pat'); expect(patted.ok).toBe(true);
    expect(patted.state.creatures[petId('alice')].trust.alice).toBe(12);
    expect(validCreatureState(patted.state)).toBe(true);
    expect(act(s, 'follow', 'bob').ok).toBe(false); expect(act(s, 'rename', 'bob', { name: 'Mochi' }).ok).toBe(false);
    expect(act(s, 'rename', 'alice', { name: 'Mochi' }).state.creatures[petId('alice')].name).toBe('Mochi');
    expect(act(s, 'rename', 'alice', { name: 'Rex the Terrible' }).ok).toBe(false);
    expect(creatureAction(s, {}, { action: 'pat', targetId: petId('alice') }, { ...land, actorId: 'bob', position: at(40, 0), now: 5000 }).ok).toBe(false);
  });
  it('petsync restores an account pet or egg and never lowers progress or trust', () => {
    const ctx = { ...land, actorId: 'carol', position: at(3, 3), now: 7000 }, sync = (s, r, c = ctx) => creatureAction(s, {}, { action: 'petsync', ...r }, c);
    const hatched = sync(initialCreatureState(1), { stage: 'pet', name: 'Mochi', trust: 40 });
    expect(hatched.ok).toBe(true); expect(petView(hatched.state, 'carol')).toMatchObject({ stage: 'pet', name: 'Mochi', trust: 40 });
    expect(hatched.state.players.carol.syncs).toBe(1); expect(validCreatureState(hatched.state)).toBe(true);
    expect(petView(sync(hatched.state, { stage: 'pet', name: 'Pip', trust: 5 }, { ...ctx, now: 9000 }).state, 'carol').trust).toBe(40);
    expect(petView(sync(initialCreatureState(1), { stage: 'egg', egg: 0.4 }).state, 'carol')).toEqual({ stage: 'egg', progress: 0.4 });
    expect(sync(initialCreatureState(1), { stage: 'pet', name: 'x', trust: 1e9 }).state.creatures[petId('carol')]).toMatchObject({ name: 'Pip', trust: { carol: 100 } });
    expect(sync(initialCreatureState(1), { stage: 'banana' }).ok).toBe(false);
  });
});

describe('PetSaves', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('loads a cleaned record and upserts only valid ones', async () => {
    const calls = [];
    const client = { from: table => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { pet: { stage: 'pet', name: 'Nope', trust: 400 } }, error: null }) }) }),
      upsert: async (row, opt) => { calls.push([table, row, opt]); return { error: null }; } }) };
    const saves = new PetSaves(client, id);
    expect(await saves.load()).toEqual({ stage: 'pet', name: 'Pip', trust: 100 });
    await saves.save({ stage: 'egg', egg: 0.5 });
    expect(calls).toEqual([['player_pets', { user_id: id, pet: { stage: 'egg', egg: 0.5 } }, { onConflict: 'user_id' }]]);
    await expect(saves.save({ stage: 'dragon' })).rejects.toThrow('pet');
    expect(() => new PetSaves(client, 'bad')).toThrow('ID');
  });
});
