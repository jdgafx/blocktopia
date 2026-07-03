import { createNoise2D } from 'simplex-noise';
import { BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';

export const CHUNK_W = 16;
export const CHUNK_H = 64;
export const CHUNK_D = 16;
export const SEA_LEVEL = 21; // sand shoreline generates just above (clampedH < 22)

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D);
    this.dirty = true;
  }

  _idx(x, y, z) {
    return y * CHUNK_W * CHUNK_D + z * CHUNK_W + x;
  }

  getBlock(x, y, z) {
    if (x < 0 || x >= CHUNK_W || y < 0 || y >= CHUNK_H || z < 0 || z >= CHUNK_D) return BLOCKS.AIR;
    return this.data[this._idx(x, y, z)];
  }

  setBlock(x, y, z, id) {
    if (x < 0 || x >= CHUNK_W || y < 0 || y >= CHUNK_H || z < 0 || z >= CHUNK_D) return;
    this.data[this._idx(x, y, z)] = id;
    this.dirty = true;
  }
}

function sfc32(a) {
  let b = a ^ 0xdeadbeef, c = a ^ 0x12345678, d = 1;
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) >>> 0;
    a = b ^ b >>> 9;
    b = (c + (c << 3)) >>> 0;
    c = (c << 21 | c >>> 11);
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
}

export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map();
    this._noise = createNoise2D(sfc32(seed));
  }

  _key(cx, cz) { return `${cx},${cz}`; }

  getChunk(cx, cz) {
    const key = this._key(cx, cz);
    if (!this.chunks.has(key)) {
      this.chunks.set(key, this._generateChunk(cx, cz));
    }
    return this.chunks.get(key);
  }

  _generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_W; x++) {
      for (let z = 0; z < CHUNK_D; z++) {
        const wx = cx * CHUNK_W + x;
        const wz = cz * CHUNK_D + z;

        const n1 = this._noise(wx / 80, wz / 80);
        const n2 = this._noise(wx / 30, wz / 30) * 0.3;
        const height = Math.floor(28 + (n1 + n2) * 10);
        const clampedH = Math.max(4, Math.min(CHUNK_H - 2, height));

        chunk.setBlock(x, 0, z, BLOCKS.BEDROCK);

        for (let y = 1; y <= clampedH; y++) {
          if (y < clampedH - 3) {
            const ore = this._noise(wx * 3.1 + y, wz * 2.7 + y);
            // rarest + deepest first, or shallow branches shadow the deep ones
            if (ore > 0.88 && y < 7)        chunk.setBlock(x, y, z, BLOCKS.DIAMOND_ORE);
            else if (ore > 0.84 && y < 11)  chunk.setBlock(x, y, z, BLOCKS.GOLD_ORE);
            else if (ore > 0.8 && y < 16)   chunk.setBlock(x, y, z, BLOCKS.IRON_ORE);
            else if (ore > 0.75 && y < 24)  chunk.setBlock(x, y, z, BLOCKS.COAL_ORE);
            else                            chunk.setBlock(x, y, z, BLOCKS.STONE);
          } else if (y < clampedH) {
            chunk.setBlock(x, y, z, BLOCKS.DIRT);
          } else {
            chunk.setBlock(x, y, z, clampedH < 22 ? BLOCKS.SAND : BLOCKS.GRASS);
          }
        }

        // Fill oceans/lakes up to sea level
        for (let y = clampedH + 1; y <= SEA_LEVEL; y++) {
          chunk.setBlock(x, y, z, BLOCKS.WATER);
        }

        if (clampedH >= 22) {
          const treeNoise = this._noise(wx * 7.3 + 100, wz * 7.3 + 100);
          if (treeNoise > 0.85 && clampedH + 7 < CHUNK_H) {
            this._placeTree(chunk, x, clampedH + 1, z);
          }
        }
      }
    }
    chunk.dirty = true;
    return chunk;
  }

  _placeTree(chunk, x, y, z) {
    for (let i = 0; i < 4; i++) chunk.setBlock(x, y + i, z, BLOCKS.WOOD_LOG);
    for (let lx = -2; lx <= 2; lx++) {
      for (let lz = -2; lz <= 2; lz++) {
        for (let ly = 3; ly <= 5; ly++) {
          if (Math.abs(lx) === 2 && Math.abs(lz) === 2) continue;
          chunk.setBlock(x + lx, y + ly, z + lz, BLOCKS.LEAVES);
        }
      }
    }
    chunk.setBlock(x, y + 5, z, BLOCKS.LEAVES);
  }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_H) return BLOCKS.AIR;
    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_D);
    const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
    return this.getChunk(cx, cz).getBlock(lx, wy, lz);
  }

  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= CHUNK_H) return null;
    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_D);
    const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
    this.getChunk(cx, cz).setBlock(lx, wy, lz, id);
    return { cx, cz };
  }

  isSolid(wx, wy, wz) {
    // single source of truth: solidity comes from BLOCK_DEFS
    return BLOCK_DEFS[this.getBlock(wx, wy, wz)]?.solid ?? false;
  }
}
