import { it, expect } from 'vitest';
import { handleIntent } from '../src/network/session-gameplay.js';
import { MutationLedger } from '../src/network/protocol.js';

it('host gathers all timber in one action and sends the same persistent removal to peers', () => {
  const broadcast = [], ledger = new MutationLedger(); ledger.startEpoch(1);
  const blocks = new Map([['2,29,2', 4], ['2,30,2', 4], ['3,32,2', 5]]);
  const session = { ready: true, playerId: 'host', epoch: 1, generation: 2, mode: 'expedition', ledger,
    mutationTimes: new Map(), options: {
      getLocalState: () => ({ position: [2, 29, 3] }),
      getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0,
      getTreeBlocks: () => [...blocks.keys()].map(key => {
        const [x, y, z] = key.split(',').map(Number); return { x, y, z, blockId: 0 };
      }),
    }, transport: { broadcastControl: message => broadcast.push(message) } };
  expect(handleIntent(session, 'host', { epoch: 1, intentId: 'chop', x: 2, y: 29, z: 2, blockId: 0 })).toBe(true);
  expect(ledger.supplies).toEqual({ 4: 2 });
  const peer = new MutationLedger(); peer.startEpoch(1);
  expect(peer.apply(broadcast[0].commit)).toBe(true);
  expect(peer.snapshot()).toEqual(ledger.snapshot());
  expect(peer.overrides.size).toBe(3);
});

it('fells the generated signal oak while preserving a player replacement through reload', async () => {
  const { World } = await import('../src/engine/world.js');
  const world = new World(19, 2);
  world.setBlock(18, 30, 18, 4);
  const cells = world.getTreeBlocks(18, 29, 18);
  expect(cells.length).toBeGreaterThan(30);
  expect(cells.length).toBeLessThanOrEqual(1024);
  expect(cells.some(cell => cell.x === 18 && cell.y === 30 && cell.z === 18)).toBe(false);
  const ledger = new MutationLedger(cell => world.setBlock(cell.x, cell.y, cell.z, cell.blockId));
  ledger.startEpoch(1);
  expect(ledger.apply({ kind: 'block', epoch: 1, seq: 1, intentId: 'oak', x: 18, y: 29, z: 18, blockId: 0,
    treeBlocks: cells.filter(cell => cell.x !== 18 || cell.y !== 29 || cell.z !== 18) })).toBe(true);
  expect(world.getBlock(18, 30, 18)).toBe(4);
  for (const cell of cells) expect(world.getBlock(cell.x, cell.y, cell.z)).toBe(0);
  const restored = new World(19, 2);
  const reload = new MutationLedger(cell => restored.setBlock(cell.x, cell.y, cell.z, cell.blockId));
  expect(reload.loadSnapshot(ledger.snapshot())).toBe(true);
  for (const cell of cells) expect(restored.getBlock(cell.x, cell.y, cell.z)).toBe(0);
});
