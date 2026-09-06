import { it, expect } from 'vitest';
import { MutationLedger, validateSnapshot } from '../src/network/protocol.js';
import { initialCreatureState, newCreaturePlayer, creatureAction } from '../src/game/creature-state.js';
import { campAction } from '../src/game/camp.js';

it('atomically stores, cooks, withdraws and consumes real provisions across snapshot restoration', () => {
  const actorId = 'keeper-one', position = { x: 8, y: 29, z: 8 };
  let state = initialCreatureState(72); state.players[actorId] = newCreaturePlayer();
  state.players[actorId].health = 40; state.players[actorId].hunger = 30; state.players[actorId].bag[100] = 1;
  const ledger = new MutationLedger(); ledger.startEpoch(1);
  const stored = creatureAction(state, { 4: 1 }, { action: 'deposit', itemId: 100, count: 1 }, { actorId, position, now: 1000 });
  expect(stored.ok).toBe(true);
  const commit = { kind: 'creature', action: 'deposit', epoch: 1, seq: 1, intentId: 'store-one', creatures: stored.state, supplies: stored.supplies };
  expect(ledger.apply(commit)).toBe(true); expect(ledger.apply(commit)).toBe(false);
  expect(ledger.supplies).toEqual({ 4: 1, 100: 1 });
  const cooked = campAction(ledger.supplies, { kind: 'craft', recipeId: 'cook-meat' });
  expect(cooked).toEqual({ ok: true, supplies: { 101: 1 } });
  expect(ledger.apply({ kind: 'craft', recipeId: 'cook-meat', epoch: 1, seq: 2, intentId: 'cook-one', supplies: cooked.supplies })).toBe(true);
  const snapshot = JSON.parse(JSON.stringify(ledger.snapshot()));
  expect(validateSnapshot(snapshot)).toBe(true);
  const resumed = new MutationLedger(); expect(resumed.loadSnapshot(snapshot)).toBe(true);
  expect(resumed.creatures.players[actorId].bag).toEqual({});
  const taken = creatureAction(resumed.creatures, resumed.supplies, { action: 'withdraw', itemId: 101, count: 1 }, { actorId, position, now: 2000 });
  const eaten = creatureAction(taken.state, taken.supplies, { action: 'eat', itemId: 101 }, { actorId, position, now: 3000 });
  expect(eaten.ok).toBe(true); expect(eaten.state.players[actorId].health).toBe(64);
  expect(eaten.state.players[actorId].hunger).toBe(70); expect(eaten.state.players[actorId].bag).toEqual({});
  snapshot.creatures.players[actorId].bag[101] = -1;
  expect(resumed.loadSnapshot(snapshot)).toBe(false);
});
