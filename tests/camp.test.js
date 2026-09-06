import { describe, expect, it, vi } from 'vitest';
import { MultiplayerSession } from '../src/network/session.js';
import { MutationLedger } from '../src/network/protocol.js';
import { BLOCKS as B } from '../src/constants/blocks.js';
import { campAction, canCraft, MAX_SUPPLY, RECIPES, validSupplies } from '../src/game/camp.js';

describe('shared camp transactions', () => {
  it('gathers, crafts real blocks, and consumes placement without mutating input', () => {
    const empty = {};
    const gathered = campAction(empty, { blockId: B.AIR }, B.WOOD_LOG);
    expect(gathered).toEqual({ ok: true, supplies: { [B.WOOD_LOG]: 1 } });
    expect(empty).toEqual({});
    expect(canCraft(gathered.supplies, 'planks')).toBe(true);
    const crafted = campAction(gathered.supplies, { kind: 'craft', recipeId: 'planks' });
    expect(crafted.supplies).toEqual({ [B.PLANKS]: 4 });
    expect(campAction(crafted.supplies, { blockId: B.PLANKS }, B.AIR).supplies).toEqual({ [B.PLANKS]: 3 });
    expect(gathered.supplies).toEqual({ [B.WOOD_LOG]: 1 });
  });

  it('uses every displayed recipe exactly and rejects unknown or unaffordable recipes', () => {
    for (const recipe of RECIPES) {
      expect(canCraft(recipe.cost, recipe.id)).toBe(true);
      expect(campAction(recipe.cost, { kind: 'craft', recipeId: recipe.id }).supplies).toEqual(recipe.output);
      expect(canCraft({}, recipe.id)).toBe(false);
      expect(campAction({}, { kind: 'craft', recipeId: recipe.id }).ok).toBe(false);
    }
    expect(campAction({}, { kind: 'craft', recipeId: 'diamond-tool' }).ok).toBe(false);
  });

  it('prevents repeated rewards, bedrock mining, empty placement, and occupied overwrite', () => {
    for (const current of [B.AIR, B.BEDROCK, B.WATER, undefined]) {
      expect(campAction({}, { blockId: B.AIR }, current).ok).toBe(false);
    }
    expect(campAction({}, { blockId: B.PLANKS }, B.AIR).ok).toBe(false);
    expect(campAction({ [B.PLANKS]: 1 }, { blockId: B.PLANKS }, B.STONE).ok).toBe(false);
    expect(campAction({}, { blockId: B.PLANKS }, B.AIR, 'creative')).toEqual({ ok: true, supplies: {} });
    expect(campAction({}, { blockId: B.AIR }, B.IRON_ORE).supplies).toEqual({ [B.IRON_ORE]: 1 });
    expect(campAction({}, { blockId: B.AIR }, B.STONE, 'creative').supplies).toEqual({});
  });

  it('bounds supplies at the input boundary and refuses overflow', () => {
    for (const supplies of [null, [], { 0: 1 }, { 13: 1 }, { 14: 1 }, { 1: -1 }, { 1: 1.5 }, { '01': 1 }, { 1: MAX_SUPPLY + 1 }]) {
      expect(validSupplies(supplies)).toBe(false);
    }
    expect(campAction({ [B.STONE]: MAX_SUPPLY }, { blockId: B.AIR }, B.STONE).ok).toBe(false);
    expect(canCraft({ [B.WOOD_LOG]: 1, [B.PLANKS]: MAX_SUPPLY - 3 }, 'planks')).toBe(false);
  });
});

describe('host serialized camp gameplay', () => {
  function host() {
    const blocks = new Map([['1,20,1', B.WOOD_LOG]]);
    const session = new MultiplayerSession({
      getLocalState: () => ({ position: [1, 19, 1] }),
      getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? B.AIR,
      applyMutation: (commit) => { if (commit.kind !== 'craft') blocks.set(`${commit.x},${commit.y},${commit.z}`, commit.blockId); },
      onRejected: vi.fn(), onSnapshot: vi.fn(),
    });
    Object.assign(session, { ready: true, snapshotReady: true, role: 'host', epoch: 1, playerId: 'host',
      transport: { broadcastControl: vi.fn(), sendControl: vi.fn() } });
    session.ledger.startEpoch(1);
    session.remoteStates.set('guest', { position: [1, 19, 1] });
    return session;
  }

  it('awards one gather for two miners, orders craft/place, and rejects duplicates and overspending', () => {
    const session = host();
    const mine = { kind: 'block', epoch: 1, intentId: 'host-mine', x: 1, y: 20, z: 1, blockId: B.AIR };
    expect(session._handleIntent('host', mine)).toBe(true);
    expect(session._handleIntent('guest', { ...mine, intentId: 'guest-mine' })).toBe(false);
    expect(session.ledger.supplies).toEqual({ 4: 1 });
    expect(session.transport.sendControl).toHaveBeenLastCalledWith('guest', expect.objectContaining({ t: 'intent-rejected' }));
    const craft = { kind: 'craft', recipeId: 'planks', epoch: 1, intentId: 'guest-craft' };
    expect(session._handleIntent('guest', craft)).toBe(true);
    expect(session._handleIntent('guest', craft)).toBe(false);
    expect(session._handleIntent('host', { ...craft, intentId: 'empty-craft' })).toBe(false);
    expect(session.options.onRejected).toHaveBeenCalledWith('Gather the recipe ingredients first');
    expect(session.ledger.supplies).toEqual({ 8: 4 });
    expect(session.submitMutation({ x: 1, y: 20, z: 1, blockId: B.PLANKS })).toBe(true);
    expect(session.submitMutation({ x: 1, y: 20, z: 1, blockId: B.PLANKS })).toBe(false);
    const commits = session.transport.broadcastControl.mock.calls.map(([message]) => message.commit);
    expect(commits.map(({ seq }) => seq)).toEqual([1, 2, 3]);
    expect(commits[1]).not.toHaveProperty('x');
    const guest = new MutationLedger();
    for (const commit of commits) expect(guest.apply(commit)).toBe(true);
    expect(guest.snapshot()).toEqual(session.ledger.snapshot());
    expect(guest.supplies).toEqual({ 8: 3 });
  });

  it('uses the shared rate cap and epoch for crafting and reports guest rejection to the UI', () => {
    const session = host();
    session.ledger.supplies = { 4: 20 };
    for (let i = 0; i < 12; i++) expect(session.submitCraft('planks')).toBe(true);
    expect(session.submitCraft('planks')).toBe(false);
    expect(session.options.onRejected).toHaveBeenLastCalledWith('Mutation rate exceeded');
    expect(session._handleIntent('guest', { kind: 'craft', recipeId: 'planks', epoch: 0, intentId: 'old' })).toBe(false);
    session.role = 'guest'; session.hostId = 'host';
    session._onControl('host', { t: 'intent-rejected', reason: 'Gather stone first' });
    expect(session.options.onRejected).toHaveBeenLastCalledWith('Gather stone first');
  });

  it('assembles multiple snapshot parts completely, restores supplies, and rejects an older sequence', () => {
    const session = host();
    session.role = 'guest'; session.snapshotReady = false;
    const entries = Array.from({ length: 160 }, (_, i) => ({
      epoch: 1, seq: i + 1, intentId: `mine-${i}`, x: i, y: 20, z: 0, blockId: 0,
    }));
    const snapshot = { epoch: 1, lastSeq: 160, generation: session.generation, story: { stage: 0 }, entries, intentIds: entries.map(({ intentId }) => intentId), supplies: { 3: 160 } };
    const source = host(); source.ledger.loadSnapshot(snapshot);
    const messages = [];
    source._sendSnapshot({ send: (raw) => messages.push(JSON.parse(raw)) });
    expect(messages.length).toBeGreaterThan(1);
    session._receiveSnapshot(messages.at(-1));
    expect(session.ledger.lastSeq).toBe(0);
    expect(session.snapshotReady).toBe(false);
    for (const message of messages.slice(0, -1)) session._receiveSnapshot(message);
    expect(session.ledger.snapshot()).toEqual(snapshot);
    expect(session.snapshotReady).toBe(true);
    expect(session.options.onSnapshot).toHaveBeenCalledOnce();
    const advanced = { kind: 'craft', recipeId: 'stone-brick', epoch: 1, seq: 161, intentId: 'craft', supplies: { 3: 156, 9: 4 } };
    session.ledger.apply(advanced);
    for (const message of messages) session._receiveSnapshot(message);
    expect(session.ledger.lastSeq).toBe(161);
    expect(session.ledger.supplies).toEqual({ 3: 156, 9: 4 });
  });
});
