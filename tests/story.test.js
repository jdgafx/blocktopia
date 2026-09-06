import { describe, expect, it, vi } from 'vitest';
import { STORY_STAGES, storyAction } from '../src/game/story.js';
import { MutationLedger, validateSnapshot } from '../src/network/protocol.js';
import { MultiplayerSession } from '../src/network/session.js';

function host() {
  const position = [8, 29, 8];
  const session = new MultiplayerSession({ getLocalState: () => ({ position }), onRejected: vi.fn(), getBlock: () => 0 });
  Object.assign(session, { ready: true, snapshotReady: true, role: 'host', playerId: 'host', epoch: 1, generation: 2 });
  session.ledger.startEpoch(1); session.ledger.generation = 2;
  session.transport = { broadcastControl: vi.fn(), sendControl: vi.fn(), closeAll: vi.fn() };
  session.remoteStates.set('guest', { position: [8, 29, 8] });
  return { session, position };
}

describe('shared settlement story', () => {
  it('requires the correct character, proximity, and exact materials through the entire story', () => {
    let story = { stage: 0 }, supplies = { 8: 9, 9: 4, 10: 2 };
    expect(storyAction(story, supplies, 'ivo', [104, 29, 8]).ok).toBe(false);
    expect(storyAction(story, supplies, 'mara', [14.01, 29, 8]).ok).toBe(false);
    expect(storyAction(story, supplies, 'mara', [8, NaN, 8]).ok).toBe(false);
    for (const stage of STORY_STAGES) {
      const result = storyAction(story, supplies, stage.npcId, [stage.x, 29, stage.z]);
      expect(result.ok).toBe(true);
      expect(result.story.stage).toBe(story.stage + 1);
      story = result.story; supplies = result.supplies;
    }
    expect(story).toEqual({ stage: 5 });
    expect(supplies).toEqual({ 8: 1 });
    expect(storyAction(story, supplies, 'sol', [8, 29, 104]).ok).toBe(false);
    expect(storyAction({ stage: 1 }, { 8: 7 }, 'mara', [8, 29, 8]).ok).toBe(false);
    expect(storyAction({ stage: 1 }, {}, 'mara', [8, 29, 8], 'creative')).toMatchObject({ ok: true, supplies: {}, story: { stage: 2 } });
  });

  it('serializes teammates once, carries story with crafting and blocks, and preserves a late join and new host epoch', () => {
    const { session, position } = host();
    session.ledger.supplies = { 8: 8, 4: 1 };
    expect(session.submitStory('mara')).toBe(true);
    const delivery = { kind: 'story', targetId: 'mara', epoch: 1, intentId: 'delivery' };
    expect(session._handleIntent('guest', delivery)).toBe(true);
    expect(session._handleIntent('guest', delivery)).toBe(false);
    expect(session._handleIntent('guest', { ...delivery, intentId: 'again' })).toBe(false);
    expect(session.ledger.story).toEqual({ stage: 2 });
    expect(session.ledger.supplies).toEqual({ 4: 1 });
    expect(session.submitCraft('planks')).toBe(true);
    expect(session.submitMutation({ x: 8, y: 29, z: 8, blockId: 8 })).toBe(true);
    const commits = session.transport.broadcastControl.mock.calls.map(([message]) => message.commit);
    expect(commits.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
    expect(commits.slice(1).every(({ story }) => story.stage === 2)).toBe(true);
    expect(commits[0]).not.toHaveProperty('x');
    const guest = new MutationLedger(); guest.generation = 2;
    expect(guest.apply(commits[1])).toBe(false);
    for (const commit of commits) expect(guest.apply(commit)).toBe(true);
    expect(guest.snapshot()).toEqual(session.ledger.snapshot());
    const late = new MutationLedger(); expect(late.loadSnapshot(session.ledger.snapshot())).toBe(true);
    late.startEpoch(2);
    expect(late.story).toEqual({ stage: 2 }); expect(late.supplies).toEqual({ 8: 3 });
    expect(late.snapshot().generation).toBe(2); expect(late.overrides.size).toBe(1);
    position[0] = 104;
    expect(session.submitStory('ivo')).toBe(false);
    session.ledger.supplies[9] = 4;
    expect(session.submitStory('ivo')).toBe(true);
    expect(session.ledger.story.stage).toBe(3);
  });

  it('rejects legacy-world actions and malformed story commits without changing state', () => {
    const { session } = host();
    session.generation = 1;
    expect(session.submitStory('mara')).toBe(false);
    session.generation = 2;
    const commit = { epoch: 1, seq: 1, intentId: 'a', kind: 'story', targetId: 'mara', story: { stage: 1 }, supplies: {} };
    for (const invalid of [
      { ...commit, targetId: 'unknown' }, { ...commit, x: 8 }, { ...commit, supplies: { 8: -1 } },
      ...[-1, 6, 1.1, '1'].map((stage) => ({ ...commit, story: { stage } })),
    ]) expect(session.ledger.apply(invalid)).toBe(false);
    expect(session.ledger.lastSeq).toBe(0);
    expect(session.submitStory('unknown')).toBe(false);
  });

  it('defaults old saves to legacy terrain and stage zero and rejects metadata corruption', () => {
    const snapshot = { epoch: 1, lastSeq: 0, supplies: {}, entries: [], intentIds: [] };
    const ledger = new MutationLedger();
    expect(ledger.loadSnapshot(snapshot)).toBe(true);
    expect(ledger.generation).toBe(1); expect(ledger.story).toEqual({ stage: 0 });
    for (const invalid of [
      ...[0, 4, '2', null].map((generation) => ({ ...snapshot, generation })),
      ...[{ stage: 6 }, { stage: 1, extra: true }, null].map((story) => ({ ...snapshot, story })),
    ]) expect(validateSnapshot(invalid)).toBe(false);
    const { session } = host(); session.snapshotReady = false; session._status = vi.fn();
    session._receiveSnapshot({ snapshotId: 'old', index: 0, total: 1, data: JSON.stringify(snapshot) });
    expect(session.snapshotReady).toBe(false);
    expect(session._status).toHaveBeenCalledWith('rtc-failure', expect.any(String));
    session._receiveSnapshot({ snapshotId: 'new', index: 0, total: 1,
      data: JSON.stringify({ ...snapshot, generation: 2, story: { stage: 4 } }) });
    expect(session.snapshotReady).toBe(true); expect(session.ledger.story.stage).toBe(4);
  });
});
