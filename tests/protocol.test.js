import { describe, expect, it } from 'vitest';
import {
  MutationLedger,
  admissionDecision,
  createRoomCode,
  electHost,
  interpolateSamples,
  isRoomCode,
  normalizeRoomCode,
  roomSeed,
  validateMutationIntent,
  validRoomDescriptor,
  validateSnapshot,
} from '../src/network/protocol.js';

describe('room protocol', () => {
  it('preserves each supported terrain generation through room admission and saved snapshots', () => {
    for (const generation of [1, 2, 3]) {
      expect(validRoomDescriptor({ seed: 260906, mode: 'expedition', generation })).toBe(true);
      const ledger = new MutationLedger();
      ledger.startEpoch(1); ledger.generation = generation;
      const snapshot = ledger.snapshot();
      const restored = new MutationLedger();
      expect(restored.loadSnapshot(snapshot)).toBe(true);
      expect(restored.generation).toBe(generation);
      expect(validateSnapshot({ ...snapshot, generation: 4 })).toBe(false);
    }
    expect(validRoomDescriptor({ seed: 260906, mode: 'expedition', generation: 4 })).toBe(false);
  });
  it('normalizes canonical codes and deterministically includes the world version in the seed', () => {
    expect(normalizeRoomCode(' abcd-23 ')).toBe('ABCD23');
    expect(isRoomCode('abcd23')).toBe(true);
    expect(isRoomCode('ABCI23')).toBe(false);
    expect(createRoomCode({ getRandomValues: (bytes) => bytes.fill(0) })).toBe('AAAAAA');
    expect(roomSeed('ABCD23', 1)).toBe(roomSeed('abcd23', 1));
    expect(roomSeed('ABCD23', 2)).not.toBe(roomSeed('ABCD23', 1));
  });

  it('elects by join order then id and enforces capacity with stable-id reclaim', () => {
    const members = [{ playerId: 'b', joinOrder: 1 }, { playerId: 'z', joinOrder: 0 }, { playerId: 'a', joinOrder: 1 }];
    expect(electHost(members).playerId).toBe('z');
    const full = Array.from({ length: 8 }, (_, i) => ({ playerId: `p${i}` }));
    expect(admissionDecision(full, new Map(), 'new')).toEqual({ ok: false, reason: 'Room is full' });
    expect(admissionDecision(full, new Map(), 'p2')).toEqual({ ok: true });
  });

  it('reserves the creator slot before Presence sync without blocking reconnects', () => {
    const reservations = new Map(Array.from({ length: 7 }, (_, i) => [`guest-${i}`, {}]));
    expect(admissionDecision([], reservations, 'new', 8, 'host')).toEqual({ ok: false, reason: 'Room is full' });
    expect(admissionDecision([], reservations, 'guest-3', 8, 'host')).toEqual({ ok: true });
  });
});

describe('movement interpolation', () => {
  it('interpolates position and rotation at the render timestamp', () => {
    const state = interpolateSamples([
      { at: 100, position: [0, 1, 2], yaw: 0, pitch: 0 },
      { at: 200, position: [10, 3, 4], yaw: 1, pitch: 0.5 },
    ], 150);
    expect(state.position).toEqual([5, 2, 3]);
    expect(state.yaw).toBeCloseTo(0.5);
    expect(state.pitch).toBeCloseTo(0.25);
  });
});

describe('mutation ledger', () => {
  const commits = [
    { epoch: 1, seq: 1, intentId: 'one', x: 1, y: 2, z: 3, blockId: 0 },
    { epoch: 1, seq: 2, intentId: 'two', x: 1, y: 2, z: 3, blockId: 4 },
  ];

  it('orders, deduplicates, and restores final overrides from a snapshot', () => {
    const applied = [];
    const ledger = new MutationLedger((commit) => applied.push(commit.intentId));
    expect(ledger.apply(commits[1])).toBe(false);
    expect(ledger.apply(commits[0])).toBe(true);
    expect(ledger.apply(commits[0])).toBe(false);
    expect(ledger.apply(commits[1])).toBe(true);
    const restored = new MutationLedger();
    expect(restored.loadSnapshot(ledger.snapshot())).toBe(true);
    expect(restored.lastSeq).toBe(2);
    expect(restored.overrides.get('1,2,3').blockId).toBe(4);
    expect(restored.apply({ ...commits[1], seq: 3 })).toBe(false);
    expect(applied).toEqual(['one', 'two']);
  });
});

describe('host mutation validation', () => {
  const base = {
    epoch: 2,
    worldHeight: 64,
    allowedBlockIds: new Set([0, 4]),
    seenIntentIds: new Set(),
    playerPosition: [1, 2, 3],
    mutationTimes: [],
    now: 1000,
  };

  it('accepts a nearby integer mutation and rejects trust-boundary failures', () => {
    const valid = { epoch: 2, intentId: 'intent', x: 2, y: 3, z: 3, blockId: 4 };
    expect(validateMutationIntent(valid, base).ok).toBe(true);
    expect(validateMutationIntent({ ...valid, epoch: 1 }, base).reason).toBe('Stale epoch');
    expect(validateMutationIntent({ ...valid, x: 2.5 }, base).reason).toContain('integers');
    expect(validateMutationIntent({ ...valid, y: 64 }, base).reason).toBe('Outside world height');
    expect(validateMutationIntent({ ...valid, blockId: 13 }, base).reason).toBe('Block id is not allowed');
    expect(validateMutationIntent({ ...valid, x: 30 }, base).reason).toBe('Block is out of reach');
    expect(validateMutationIntent(valid, { ...base, seenIntentIds: new Set(['intent']) }).reason).toBe('Duplicate intent');
    expect(validateMutationIntent(valid, { ...base, mutationTimes: Array(12).fill(999) }).reason).toBe('Mutation rate exceeded');
  });
});

describe('camp ledger snapshots', () => {
  it('orders craft with blocks, carries supplies, and never invents craft coordinates', () => {
    const seen = [];
    const ledger = new MutationLedger((commit) => seen.push({ commit, supplies: { ...ledger.supplies } }));
    const gather = { epoch: 1, seq: 1, intentId: 'gather', kind: 'block', x: 1, y: 20, z: 1, blockId: 0, supplies: { 4: 1 } };
    const craft = { epoch: 1, seq: 2, intentId: 'craft', kind: 'craft', recipeId: 'planks', supplies: { 8: 4 } };
    expect(ledger.apply(gather)).toBe(true);
    expect(ledger.apply(craft)).toBe(true);
    expect(ledger.apply(craft)).toBe(false);
    expect(ledger.overrides.size).toBe(1);
    expect(ledger.supplies).toEqual({ 8: 4 });
    expect(seen[1].supplies).toEqual({ 8: 4 });
    const snapshot = ledger.snapshot();
    expect(snapshot.entries[0]).not.toHaveProperty('supplies');
    const restoredSeen = [];
    const restored = new MutationLedger(() => restoredSeen.push({ ...restored.supplies }));
    expect(restored.loadSnapshot(snapshot)).toBe(true);
    expect(restoredSeen).toEqual([{ 8: 4 }]);
    expect(restored.apply({ ...craft, seq: 3, x: 0 })).toBe(false);
    expect(restored.apply({ ...craft, seq: 3, intentId: 'craft-again', supplies: { 8: 8 } })).toBe(true);
    expect(restored.loadSnapshot(snapshot)).toBe(false);
    expect(restored.supplies).toEqual({ 8: 8 });
  });

  it('keeps inherited overrides and inventory through host epochs and validates before applying', () => {
    const ledger = new MutationLedger();
    ledger.apply({ epoch: 1, seq: 1, intentId: 'mine', x: 0, y: 10, z: 0, blockId: 0, supplies: { 3: 1 } });
    ledger.startEpoch(2);
    const snapshot = ledger.snapshot();
    const fresh = new MutationLedger();
    expect(fresh.loadSnapshot(snapshot)).toBe(true);
    expect(fresh.supplies).toEqual({ 3: 1 });
    expect(fresh.lastSeq).toBe(0);
    for (const invalid of [
      { ...snapshot, epoch: -1 }, { ...snapshot, lastSeq: -1 }, { ...snapshot, supplies: { 13: 1 } },
      { ...snapshot, intentIds: ['same', 'same'] },
      { ...snapshot, entries: [snapshot.entries[0], snapshot.entries[0]] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], y: 64 }] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], blockId: 13 }] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], epoch: 3 }] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], epoch: 2, seq: 1 }] },
    ]) {
      expect(fresh.loadSnapshot(invalid)).toBe(false);
      expect(fresh.snapshot()).toEqual(snapshot);
    }
  });
});

it('persists every felled cell and never resurrects a tree when its base is replaced', () => {
  const applied = [], ledger = new MutationLedger(block => applied.push(block));
  ledger.startEpoch(1);
  expect(ledger.apply({ kind: 'block', epoch: 1, seq: 1, intentId: 'fell', x: 2, y: 29, z: 2, blockId: 0,
    supplies: { 4: 2 }, treeBlocks: [{ x: 2, y: 30, z: 2, blockId: 0 }, { x: 3, y: 32, z: 2, blockId: 0 }] })).toBe(true);
  expect(applied).toHaveLength(3);
  expect(ledger.apply({ kind: 'block', epoch: 1, seq: 2, intentId: 'replace', x: 2, y: 29, z: 2, blockId: 4 })).toBe(true);
  const restored = new MutationLedger();
  expect(restored.loadSnapshot(ledger.snapshot())).toBe(true);
  expect(restored.overrides.get('2,29,2').blockId).toBe(4);
  expect(restored.overrides.get('2,30,2').blockId).toBe(0);
  expect(restored.overrides.get('3,32,2').blockId).toBe(0);
  expect(restored.snapshot().entries.every(entry => !('treeBlocks' in entry))).toBe(true);
  const invalid = { kind: 'block', epoch: 1, seq: 3, intentId: 'invalid', x: 2, y: 29, z: 2, blockId: 0,
    treeBlocks: [{ x: 999, y: 30, z: 2, blockId: 0 }] };
  expect(restored.apply(invalid)).toBe(false);
  expect(restored.lastSeq).toBe(2);
});
