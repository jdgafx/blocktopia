import { it, expect } from 'vitest';
import { CreatureSession } from '../src/network/creature-session.js';
import { MutationLedger } from '../src/network/protocol.js';
import { initialCreatureState, newCreaturePlayer } from '../src/game/creature-state.js';

it('accepts only current host creature revisions and requests a snapshot after a missing update', () => {
  const sent = [], ledger = new MutationLedger(); ledger.startEpoch(3); ledger.creatures = initialCreatureState(99);
  const runtime = Object.create(CreatureSession.prototype);
  runtime.resyncAt = 0;
  runtime.session = { role: 'guest', hostId: 'host', ready: true, snapshotReady: true, epoch: 3, ledger,
    options: {}, transport: { sendControl: (...message) => sent.push(message) } };
  const player = newCreaturePlayer(); player.bag[101] = 2;
  const update = { t: 'creatures', epoch: 3, baseSeq: 0, previousRevision: 0, revision: 1,
    seed: 99, lastStepAt: 1000, updates: {}, removed: [], players: { keeper: player } };
  runtime.receive('intruder', update); expect(ledger.creatures.revision).toBe(0);
  runtime.receive('host', update); expect(ledger.creatures.players.keeper.bag[101]).toBe(2);
  runtime.receive('host', { ...update, previousRevision: 1, revision: 2, players: {} });
  expect(ledger.creatures.players.keeper.bag[101]).toBe(2);
  runtime.receive('host', { ...update, previousRevision: 4, revision: 5 });
  expect(ledger.creatures.revision).toBe(2); expect(sent).toEqual([['host', { t: 'creatures-resync' }]]);
  runtime.receive('host', { ...update, previousRevision: 2, revision: 3, players: { keeper: { ...player, health: -1 } } });
  expect(ledger.creatures.revision).toBe(2);
});
