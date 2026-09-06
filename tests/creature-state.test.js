import { describe, it, expect } from 'vitest';
import { SPECIES, SPECIES_IDS } from '../src/game/creature-species.js';
import { initialCreatureState, validCreatureState, creatureAction } from '../src/game/creature-state.js';
import { stepCreatures } from '../src/game/creature-simulation.js';

const position = { x: 0, y: 29, z: 2 };
const terrain = { surfaceHeight: () => 28, isSolid: (x, y) => y <= 28,
  getBlock: (x, y) => y === 28 ? 1 : y < 28 ? 3 : 0 };
const simulation = (now = 100000, extra = {}) => ({ ...terrain, now, dt: .2,
  players: [{ id: 'alice', position, active: true }], ...extra });
function fixture(species = 'stegosaur') {
  const state = stepCreatures(initialCreatureState(29), simulation());
  const c = { ...Object.values(state.creatures)[0], id: 'subject', species,
    x: 0, y: 29, z: 0, homeX: 0, homeZ: 0, health: SPECIES[species].health,
    hunger: 40, boldness: .5, temperament: SPECIES[species].temperament };
  state.creatures = { subject: c };
  return state;
}
const act = (state, action, now, extra = {}, context = {}, stock = {}) => creatureAction(state, stock,
  { action, targetId: 'subject', ...extra }, { ...terrain, actorId: 'alice', position, tool: 'axe', now, ...context });

describe('authoritative creature transactions', () => {
  it('validates all eight species and rejects corrupted nested save data', () => {
    expect(SPECIES_IDS).toHaveLength(8);
    for (const id of SPECIES_IDS) {
      expect(validCreatureState(fixture(id))).toBe(true);
      expect(SPECIES[id].texture).toMatch(/-color.webp$/);
    }
    for (const mutate of [
      s => { s.creatures.subject.health = NaN; },
      s => { s.creatures.subject.ownerId = '__proto__'; },
      s => { s.players.alice.bag = { 105: 41 }; },
      s => { s.players.alice.bag = { 999: 1 }; },
      s => { s.creatures.subject.trust = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`keeper${i}`, 1])); },
      s => { s.creatures.subject.untrustedDamage = 1000; },
      s => { for (let i = 0; i < 25; i++) s.creatures[`extra${i}`] = { ...s.creatures.subject, id: `extra${i}` }; },
    ]) { const state = fixture(); mutate(state); expect(validCreatureState(state)).toBe(false); }
  });

  it('spends real provisions and requires separated positive visits to earn ownership', () => {
    const original = fixture(), before = structuredClone(original);
    let result = act(original, 'withdraw', 110000, { itemId: 105, count: 4 }, {}, { 105: 4 });
    expect(result.ok).toBe(true); expect(original).toEqual(before); expect(result.supplies).toEqual({});
    for (const [time, trust] of [[111000, 20], [119000, 40], [127000, 60]]) {
      result = act(result.state, 'feed', time, { itemId: 105 });
      expect(result.ok).toBe(true); expect(result.state.creatures.subject.trust.alice).toBe(trust);
      if (trust < 60) expect(result.state.creatures.subject.ownerId).toBeNull();
      const blocked = act(result.state, 'care', time + 500);
      expect(blocked.ok).toBe(false); expect(blocked.state).toBe(result.state);
    }
    expect(result.state.creatures.subject.ownerId).toBe('alice');
    result = act(result.state, 'care', 135000);
    expect(result.ok).toBe(true); expect(result.state.creatures.subject.trust.alice).toBe(70);
    expect(result.state.players.alice.bag).toEqual({});
    expect(act(result.state, 'fight', 136000).ok).toBe(false);
    expect(act(result.state, 'fight', 136000, {}, { actorId: 'bob' }).ok).toBe(false);
    expect(validCreatureState(result.state)).toBe(true);
  });

  it('allows six paid healthy grooming visits without harming a creature', () => {
    let state = fixture(); state.creatures.subject.hunger = 100;
    state.players.alice.bag = { 105: 6 };
    for (let i = 0; i < 6; i++) {
      const result = act(state, 'care', 110000 + i * 8000);
      expect(result.ok).toBe(true); state = result.state;
      expect(state.creatures.subject.trust.alice).toBe((i + 1) * 10);
      expect(state.creatures.subject.health).toBe(SPECIES.stegosaur.health);
    }
    expect(state.creatures.subject.ownerId).toBe('alice');
    expect(state.players.alice.bag).toEqual({});
    state.players.alice.bag = { 105: 1 }; state.creatures.subject.health -= 30;
    const healed = act(state, 'care', 158000);
    expect(healed.state.creatures.subject.health).toBe(SPECIES.stegosaur.health - 12);
    expect(healed.state.creatures.subject.trust.alice).toBe(80);
  });

  it('uses fixed axe damage, rejects blocked reaches, and harvests exactly once', () => {
    let state = fixture('raptor');
    expect(act(state, 'fight', 110000, {}, { canReach: () => false }).ok).toBe(false);
    for (let i = 0; i < 4; i++) {
      const result = act(state, 'fight', 110000 + i * 750, { damage: 10000 });
      expect(result.ok).toBe(true); state = result.state;
      expect(state.creatures.subject.health).toBe(Math.max(0, 70 - (i + 1) * 18));
    }
    expect(act(state, 'harvest', 113000, {}, { tool: 'hand' }).ok).toBe(false);
    const full = structuredClone(state); full.players.alice.bag = { 105: 40 };
    expect(act(full, 'harvest', 113000).state).toBe(full);
    const result = act(state, 'harvest', 113000);
    expect(result.ok).toBe(true); expect(result.state.players.alice.bag).toEqual({ 100: 3, 102: 1, 103: 1 });
    expect(act(result.state, 'harvest', 114000).ok).toBe(false);
    expect(validCreatureState(result.state)).toBe(true);
  });

  it('recovers cargo from a dead owned companion with explicit bounded transfers', () => {
    const state = fixture(); const c = state.creatures.subject;
    Object.assign(c, { health: 0, behavior: 'dead', ownerId: 'alice', touched: true, bag: { 105: 50 } });
    expect(act(state, 'harvest', 110000, { confirm: true }).ok).toBe(false);
    const unloaded = act(state, 'unload', 110000, { itemId: 105, count: 40 });
    expect(unloaded.ok).toBe(true); expect(unloaded.state.players.alice.bag[105]).toBe(40);
    expect(unloaded.state.creatures.subject.bag[105]).toBe(10);
    expect(act(unloaded.state, 'unload', 111000, { itemId: 105, count: 1 }).ok).toBe(false);
    expect(validCreatureState(unloaded.state)).toBe(true);
  });

  it('forages only beside real woodland foliage and consumes food for real health and hunger', () => {
    const state = fixture();
    const leaves = { getBlock: (x, y, z) => x === 1 && z === 2 && y === 32 ? 5 : terrain.getBlock(x, y, z) };
    expect(act(state, 'forage', 110000).ok).toBe(false);
    let result = act(state, 'forage', 110000, {}, leaves);
    expect(result.ok).toBe(true); expect(result.state.players.alice.bag[105]).toBe(2);
    expect(act(result.state, 'forage', 111000, {}, leaves).ok).toBe(false);
    result.state.players.alice.health = 50; result.state.players.alice.hunger = 50;
    result = act(result.state, 'eat', 112000, { itemId: 105 });
    expect(result.state.players.alice.health).toBe(54); expect(result.state.players.alice.hunger).toBe(62);
    expect(result.state.players.alice.bag[105]).toBe(1);
    const companion = result.state.creatures.subject;
    Object.assign(companion, { species: 'moonstag', health: 60, ownerId: 'alice', touched: true });
    result = act(result.state, 'forage', 125000, {}, leaves);
    expect(result.ok).toBe(true); expect(result.state.players.alice.bag[105]).toBe(4);
  });
});

describe('persistent host creature simulation', () => {
  it('spawns deterministic bounded individuals and retains defeated IDs across exploration', () => {
    let state = stepCreatures(initialCreatureState(29), simulation());
    expect(state).toEqual(stepCreatures(initialCreatureState(29), simulation()));
    expect(Object.keys(state.creatures).length).toBeGreaterThan(3);
    expect(Object.values(state.creatures).filter(c => c.active).length).toBeLessThanOrEqual(24);
    const subject = Object.values(state.creatures)[0], id = subject.id;
    Object.assign(subject, { health: 0, behavior: 'dead', touched: true, harvested: true, active: false });
    state = stepCreatures(state, simulation(110000, { players: [{ id: 'alice', position: { x: 500, y: 29, z: 500 } }] }));
    state = stepCreatures(state, simulation(120000));
    expect(state.creatures[id].harvested).toBe(true); expect(state.creatures[id].health).toBe(0);
    expect(state.creatures[id].active).toBe(false); expect(validCreatureState(state)).toBe(true);
    expect(stepCreatures(state, simulation(119000))).toBe(state);
  });

  it('does not strike through walls or harm a player while their menu is open', () => {
    let state = fixture('raptor');
    Object.assign(state.creatures.subject, { z: 1, threatId: 'p:alice', lastHurtAt: 100000, behavior: 'defending', temperament: 'bold' });
    state = stepCreatures(state, simulation(100200, { canReach: () => false }));
    expect(state.players.alice.health).toBe(100);
    state = stepCreatures(state, simulation(100400, { canReach: () => true }));
    expect(state.players.alice.health).toBe(91);
    const before = structuredClone(state.players.alice);
    state = stepCreatures(state, simulation(102000, { players: [{ id: 'alice', position, active: false }] }));
    expect(state.players.alice).toEqual(before);
    expect(validCreatureState(state)).toBe(true);
  });

  it('makes an owned companion defend its attacked keeper', () => {
    const state = fixture('stegosaur'); const companion = state.creatures.subject;
    Object.assign(companion, { ownerId: 'alice', touched: true });
    state.creatures.attacker = { ...companion, id: 'attacker', species: 'raptor', health: 70,
      x: 1, ownerId: null, threatId: null, trust: {}, bag: {}, hunger: 100 };
    Object.assign(state.players.alice, { attackerId: 'attacker', lastHurtAt: 100000 });
    const next = stepCreatures(state, simulation(100200));
    expect(next.creatures.subject.behavior).toBe('defending');
    expect(next.creatures.attacker.health).toBe(55);
    expect(state.creatures.attacker.health).toBe(70);
  });

  it('keeps a following companion outside a newly built solid wall', () => {
    let state = fixture('moonstag'); Object.assign(state.creatures.subject, { ownerId: 'alice', touched: true });
    const wall = { isSolid: (x, y) => y <= 28 || (x >= 2 && x <= 3 && y < 40),
      getBlock: (x, y) => y <= 28 ? terrain.getBlock(x, y) : x >= 2 && x <= 3 && y < 40 ? 3 : 0,
      players: [{ id: 'alice', position: { x: 12, y: 29, z: 0 }, active: true }] };
    for (let i = 1; i <= 30; i++) state = stepCreatures(state, simulation(100000 + i * 200, wall));
    expect(state.creatures.subject.x).toBeLessThan(2 - SPECIES.moonstag.radius);
    expect(validCreatureState(state)).toBe(true);
  });
});
