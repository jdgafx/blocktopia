import { describe, it, expect } from 'vitest';
import { CHUNK_W, CHUNK_H, CHUNK_D, Chunk, World } from '../src/engine/world.js';
import { BLOCKS } from '../src/constants/blocks.js';

describe('Chunk', () => {
  it('initialises all blocks to AIR', () => {
    const c = new Chunk(0, 0);
    expect(c.getBlock(0, 0, 0)).toBe(BLOCKS.AIR);
    expect(c.getBlock(15, 63, 15)).toBe(BLOCKS.AIR);
  });

  it('stores and retrieves a block', () => {
    const c = new Chunk(0, 0);
    c.setBlock(5, 10, 7, BLOCKS.STONE);
    expect(c.getBlock(5, 10, 7)).toBe(BLOCKS.STONE);
  });

  it('ignores out-of-bounds writes without throwing', () => {
    const c = new Chunk(0, 0);
    expect(() => c.setBlock(-1, 0, 0, BLOCKS.STONE)).not.toThrow();
    expect(() => c.setBlock(0, CHUNK_H, 0, BLOCKS.STONE)).not.toThrow();
  });

  it('returns AIR for out-of-bounds reads', () => {
    const c = new Chunk(0, 0);
    expect(c.getBlock(-1, 0, 0)).toBe(BLOCKS.AIR);
    expect(c.getBlock(0, CHUNK_H, 0)).toBe(BLOCKS.AIR);
  });
});

describe('World', () => {
  it('getBlock returns AIR before any chunk is generated', () => {
    const w = new World(12345);
    const b = w.getBlock(0, 100, 0); // above terrain height → air
    expect(b).toBe(BLOCKS.AIR);
  });

  it('setBlock then getBlock round-trips across chunk boundary', () => {
    const w = new World(42);
    w.setBlock(0, 5, 0, BLOCKS.STONE);
    expect(w.getBlock(0, 5, 0)).toBe(BLOCKS.STONE);
  });

  it('setBlock returns the chunk coords of the modified chunk', () => {
    const w = new World(1);
    const result = w.setBlock(16, 5, 0, BLOCKS.DIRT);
    expect(result).toEqual({ cx: 1, cz: 0 });
  });

  it('terrain generates grass at surface', () => {
    const w = new World(99);
    let surfaceY = -1;
    for (let y = CHUNK_H - 1; y >= 0; y--) {
      if (w.getBlock(8, y, 8) !== BLOCKS.AIR) { surfaceY = y; break; }
    }
    expect(surfaceY).toBeGreaterThan(10);
    expect(w.getBlock(8, surfaceY, 8)).toBe(BLOCKS.GRASS);
  });
});

describe('versioned adventure terrain', () => {
  it('keeps legacy saves byte-for-byte compatible', async () => {
    const { createHash } = await import('node:crypto');
    const fixtures = [
      [99, 0, 0, '55bb23819a010dc41723fed8895efaa50c7fab599a1c910c67be2f32cf6709d9'],
      [42, -2, 3, 'dfb3dd9b45e4f4b2c2f29d5d65a0a60b8eb8d7683a39a992a3855e40a0585e01'],
      [1, 6, 6, '8f17af99959d75335b75a19fecba3de19df4a190c8b34e37181da793de0dd941'],
    ];
    for (const [seed, cx, cz, hash] of fixtures) for (const generation of [undefined, 1]) {
      const data = new World(seed, generation).getChunk(cx, cz).data;
      expect(createHash('sha256').update(data).digest('hex')).toBe(hash);
    }
  });

  it('generates the same chunks regardless of generation order', () => {
    const a = new World(1234, 2), b = new World(1234, 2);
    const coords = [[0, 0], [-2, -2], [6, 0], [6, 6], [0, 6]];
    for (const [x, z] of coords) a.getChunk(x, z);
    for (const [x, z] of [...coords].reverse()) b.getChunk(x, z);
    for (const [x, z] of coords) expect(a.getChunk(x, z).data).toEqual(b.getChunk(x, z).data);
    expect(a.getChunk(-2, -2).data).not.toEqual(new World(4321, 2).getChunk(-2, -2).data);
  });

  it('keeps settlement centers and all connecting roads clear and level', async () => {
    const { REGIONS, getRegion } = await import('../src/game/regions.js');
    const w = new World(29, 2);
    for (const region of REGIONS) {
      expect(getRegion(region.x, region.z)).toBe(region);
      for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
        expect(w.surfaceHeight(region.x + x, region.z + z)).toBe(28);
        expect(w.isSolid(region.x + x, 28, region.z + z)).toBe(true);
        expect(w.getBlock(region.x + x, 29, region.z + z)).toBe(BLOCKS.AIR);
        expect(w.getBlock(region.x + x, 30, region.z + z)).toBe(BLOCKS.AIR);
      }
    }
    for (let t = 8; t <= 104; t++) for (const [x, z] of [[t, 8], [t, 104], [8, t], [104, t]]) {
      expect(w.surfaceHeight(x, z)).toBe(28);
      expect(w.isSolid(x, 28, z)).toBe(true);
      expect(w.getBlock(x, 29, z)).toBe(BLOCKS.AIR);
    }
  });

  it('has distinct biomes, enterable buildings, landmarks, water, and caves', async () => {
    const { REGIONS } = await import('../src/game/regions.js');
    const w = new World(29, 2);
    expect(w.getBlock(150, w.surfaceHeight(150, -38), -38)).toBe(BLOCKS.SAND);
    expect(w.getBlock(150, w.surfaceHeight(150, 150), 150)).toBe(BLOCKS.STONE);
    expect(w.surfaceHeight(150, 150)).toBeGreaterThan(33);
    expect(w.getBlock(-38, w.surfaceHeight(-38, 150), 150)).toBe(BLOCKS.SAND);
    expect(w.getBlock(18, 36, 18)).toBe(BLOCKS.LEAVES);
    expect(w.getBlock(114, 30, 19)).toBe(BLOCKS.GLASS);
    expect(w.getBlock(114, 42, 118)).toBe(BLOCKS.STONE_BRICK);
    expect(w.getBlock(18, 43, 114)).toBe(BLOCKS.GLASS);
    for (const r of REGIONS) {
      expect(w.getBlock(r.x - 10, 29, r.z - 9)).toBe(BLOCKS.AIR);
      expect(w.getBlock(r.x - 10, 30, r.z - 12)).toBe(BLOCKS.AIR);
      expect(w.getBlock(r.x - 13, 30, r.z - 12)).toBe(BLOCKS.GLASS);
    }
    let water = 0, caves = 0, iron = 0;
    for (let x = -60; x < -28; x++) for (let z = 135; z < 167; z++) {
      const height = w.surfaceHeight(x, z);
      for (let y = 4; y < 22; y++) {
        const id = w.getBlock(x, y, z);
        if (id === BLOCKS.WATER) water++;
        if (id === BLOCKS.AIR && y < height - 4) caves++;
        if (id === BLOCKS.IRON_ORE) iron++;
      }
    }
    expect(water).toBeGreaterThan(0);
    expect(caves).toBeGreaterThan(0);
    expect(iron).toBeGreaterThan(0);
  });
});


it('evicts distant terrain while preserving edits on regeneration', () => {
  const world = new World(42, 2);
  world.setBlock(8, 29, 8, 8);
  world.getChunk(30, 30);
  world.retainAround(30, 30, 3);
  expect(world.chunks.has('0,0')).toBe(false);
  expect(world.chunks.size).toBe(1);
  expect(world.getBlock(8, 29, 8)).toBe(8);
});
