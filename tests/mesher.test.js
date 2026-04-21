import { describe, it, expect, vi } from 'vitest';

// Mock THREE so tests run in Node (no WebGL)
vi.mock('three', () => ({
  BufferGeometry: class {
    setAttribute() {}
    setIndex() {}
  },
  Float32BufferAttribute: class {
    constructor(arr) { this.array = arr; this.count = arr.length; }
  },
  Uint32BufferAttribute: class {
    constructor(arr) { this.array = arr; }
  },
}));

import { buildChunkMesh } from '../src/engine/mesher.js';
import { Chunk, World } from '../src/engine/world.js';
import { BLOCKS } from '../src/constants/blocks.js';

describe('buildChunkMesh', () => {
  it('returns a BufferGeometry for an empty chunk', () => {
    const chunk = new Chunk(0, 0);
    const w = new World(1);
    const geo = buildChunkMesh(chunk, w);
    expect(geo).toBeDefined();
  });

  it('produces 4 vertices per exposed face', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BLOCKS.STONE);
    const w = new World(1);
    w.getBlock = (x, y, z) => (x === 0 && y === 0 && z === 0 ? BLOCKS.STONE : BLOCKS.AIR);
    const geo = buildChunkMesh(chunk, w);
    // 6 faces × 4 verts = 24 verts
    expect(geo._posCount).toBe(6 * 4);
  });

  it('hides face between two adjacent solid blocks', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BLOCKS.STONE);
    chunk.setBlock(1, 0, 0, BLOCKS.STONE);
    const w = new World(1);
    w.getBlock = (x, y, z) => {
      if ((x === 0 || x === 1) && y === 0 && z === 0) return BLOCKS.STONE;
      return BLOCKS.AIR;
    };
    const geo = buildChunkMesh(chunk, w);
    // 2 blocks × 6 faces = 12 total, minus 2 shared internal faces = 10 exposed → 40 verts
    expect(geo._posCount).toBe(10 * 4);
  });
});
