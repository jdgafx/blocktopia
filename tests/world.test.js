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
