import { createNoise2D } from 'simplex-noise';
import { BLOCKS } from '../constants/blocks.js';
import { REGIONS, getRegion } from '../game/regions.js';
import { registerCottage, buildingBounds } from './buildings.js';
import hearthwoodRoads from '../../scripts/maps/hearthwood-roads.js';

export const CHUNK_W = 16;
export const CHUNK_H = 64;
export const CHUNK_D = 16;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D);
    this.naturalBlocks = new Map();
    this.buildingBlocks = new Map();
    this.trees = [];
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
    this.naturalBlocks.delete(this._idx(x, y, z));
    this.buildingBlocks.delete(this._idx(x, y, z));
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
  constructor(seed, generation = 1) {
    this.seed = seed;
    this.generation = generation;
    this.chunks = new Map();
    this.edits = new Map();
    this._noise = createNoise2D(sfc32(seed));
  }

  _key(cx, cz) { return `${cx},${cz}`; }

  getChunk(cx, cz) {
    const key = this._key(cx, cz);
    if (!this.chunks.has(key)) {
      const chunk = this._generateChunk(cx, cz);
      for (const [index, id] of this.edits.get(key) ?? []) {
        chunk.data[index] = id; chunk.naturalBlocks.delete(index); chunk.buildingBlocks.delete(index);
      }
      this.chunks.set(key, chunk);
    }
    return this.chunks.get(key);
  }

  _generateChunk(cx, cz) {
    if (this.generation >= 2) return this._generateAdventureChunk(cx, cz);
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
            if (ore > 0.75 && y < 20)      chunk.setBlock(x, y, z, BLOCKS.COAL_ORE);
            else if (ore > 0.8 && y < 12)  chunk.setBlock(x, y, z, BLOCKS.IRON_ORE);
            else                            chunk.setBlock(x, y, z, BLOCKS.STONE);
          } else if (y < clampedH) {
            chunk.setBlock(x, y, z, BLOCKS.DIRT);
          } else {
            chunk.setBlock(x, y, z, clampedH < 22 ? BLOCKS.SAND : BLOCKS.GRASS);
          }
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

  getRegion(x, z) { return getRegion(x, z); }

  _roadDistance(x, z) {
    // Four connected, level roads let every settlement be reached on foot.
    const segment = (a, b) => Math.hypot(a - Math.max(8, Math.min(104, a)), b);
    let distance = Math.min(segment(x, z - 8), segment(x, z - 104),
      segment(z, x - 8), segment(z, x - 104));
    // Version 3 adds the exported woodland approaches without changing old saves.
    if (this.generation >= 3) {
      for (const road of hearthwoodRoads) for (let i = 1; i < road.length; i++) {
        const [ax, az] = road[i - 1], [bx, bz] = road[i];
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
      }
    }
    return distance;
  }

  surfaceHeight(x, z) {
    const n = this._noise(x / 80, z / 80) + this._noise(x / 30, z / 30) * 0.3;
    if (this.generation < 2) return Math.max(4, Math.min(CHUNK_H - 2, Math.floor(28 + n * 10)));
    const region = getRegion(x, z);
    const distance = Math.hypot(x - region.x, z - region.z);
    const road = this._roadDistance(x, z);
    const blend = Math.max(0, Math.min(1, (distance - 20) / 20, (road - 3) / 9));
    const terrain = region.id === 'frostspine' ? 34 + Math.abs(n) * 19
      : region.id === 'amber-dunes' ? 26 + n * 8
        : region.id === 'tideglass' ? 19 + n * 7 : 27 + n * 10;
    return Math.max(5, Math.min(55, Math.floor(28 + (terrain - 28) * blend)));
  }

  _treeAt(x, z) {
    const region = getRegion(x, z);
    return region.id === 'hearthwood' && Math.hypot(x - region.x, z - region.z) > 21
      && this._roadDistance(x, z) > 6 && this._noise(x * 7.3 + 100, z * 7.3 + 100) > 0.83;
  }

  _generateAdventureChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_W; x++) for (let z = 0; z < CHUNK_D; z++) {
      const wx = cx * CHUNK_W + x, wz = cz * CHUNK_D + z;
      const region = getRegion(wx, wz), height = this.surfaceHeight(wx, wz);
      const distance = Math.hypot(wx - region.x, wz - region.z);
      const road = this._roadDistance(wx, wz);
      const desert = region.id === 'amber-dunes', mountain = region.id === 'frostspine';
      const coast = region.id === 'tideglass';
      chunk.setBlock(x, 0, z, BLOCKS.BEDROCK);
      for (let y = 1; y <= height; y++) {
        const cave = distance > 23 && road > 5 && y > 3 && y < height - 4
          && this._noise(wx / 17 + y / 11, wz / 17) > 0.39
          && this._noise(wx / 21, wz / 21 + y / 9) > 0.35;
        if (cave) continue;
        let id = BLOCKS.STONE;
        if (y < height - 3) {
          const ore = this._noise(wx * 3.1 + y, wz * 2.7 + y);
          if (ore > 0.8 && y < 18) id = BLOCKS.IRON_ORE;
          else if (ore > 0.72 && y < 26) id = BLOCKS.COAL_ORE;
        } else if (y < height) id = desert || coast ? BLOCKS.SAND : mountain ? BLOCKS.STONE : BLOCKS.DIRT;
        else id = distance <= 5 ? BLOCKS.STONE_BRICK : road <= 2 ? BLOCKS.GRAVEL
          : desert || coast ? BLOCKS.SAND : mountain ? BLOCKS.STONE : BLOCKS.GRASS;
        chunk.setBlock(x, y, z, id);
      }
      for (let y = height + 1; y <= 21; y++) chunk.setBlock(x, y, z, BLOCKS.WATER);
    }
    // Roots in adjacent chunks contribute their canopy here, independent of load order.
    for (let x = -2; x < CHUNK_W + 2; x++) for (let z = -2; z < CHUNK_D + 2; z++) {
      const wx = cx * CHUNK_W + x, wz = cz * CHUNK_D + z;
      if (this._treeAt(wx, wz)) this._placeTree(chunk, x, this.surfaceHeight(wx, wz) + 1, z);
    }
    for (const region of REGIONS) {
      if (Math.abs(region.x - (cx * 16 + 8)) > 32 || Math.abs(region.z - (cz * 16 + 8)) > 32) continue;
      this._settlement(chunk, region);
    }
    return chunk;
  }

  _settlement(chunk, region) {
    const put = (x, y, z, id) => chunk.setBlock(region.x + x - chunk.cx * CHUNK_W,
      y, region.z + z - chunk.cz * CHUNK_D, id);
    const box = (x1, y1, z1, x2, y2, z2, id) => {
      for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++)
        for (let y = y1; y <= y2; y++) put(x, y, z, id);
    };
    const desert = region.id === 'amber-dunes', mountain = region.id === 'frostspine';
    const wall = desert ? BLOCKS.SAND : mountain ? BLOCKS.STONE_BRICK : BLOCKS.PLANKS;
    // Two usable houses: open south doors, glass windows, pitched roofs and furnishings.
    for (const hx of [-13, 7]) {
      box(hx, 28, -15, hx + 6, 28, -9, BLOCKS.STONE_BRICK);
      for (let x = hx; x <= hx + 6; x++) for (let z = -15; z <= -9; z++) {
        if (x !== hx && x !== hx + 6 && z !== -15 && z !== -9) continue;
        box(x, 29, z, x, 32, z, wall);
      }
      box(hx + 3, 29, -9, hx + 3, 31, -9, BLOCKS.AIR);
      for (const wx of [hx, hx + 6]) box(wx, 30, -13, wx, 31, -12, BLOCKS.GLASS);
      for (let step = 0; step <= 3; step++)
        box(hx - 1 + step, 33 + step, -16, hx + 7 - step, 33 + step, -8,
          desert ? BLOCKS.STONE_BRICK : BLOCKS.WOOD_LOG);
      box(hx + 1, 29, -14, hx + 2, 29, -14, BLOCKS.PLANKS);
      put(hx + 4, 29, -14, BLOCKS.WOOD_LOG);
      for (let z = -8; z <= -3; z++) put(hx + 3, 28, z, BLOCKS.GRAVEL);
      if (region.id === 'hearthwood') registerCottage(chunk, { x: region.x + hx, z: region.z - 15 });
    }
    // Market stalls give each square a shared, walkable gathering place.
    for (const x of [-8, -5]) box(x, 29, 6, x, 32, 6, BLOCKS.WOOD_LOG);
    box(-8, 32, 5, -5, 32, 8, BLOCKS.PLANKS);
    box(-8, 29, 7, -5, 29, 7, BLOCKS.PLANKS);
    if (region.id === 'hearthwood') {
      const tree = { x: region.x + 10, y: 29, z: region.z + 10, width: 2, height: 8, radius: 4, crown: 12 };
      this._registerTree(chunk, tree);
      const treeBox = (x1, y1, z1, x2, y2, z2, id) => {
        for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) for (let y = y1; y <= y2; y++)
          this._treeBlock(chunk, tree, region.x + x - chunk.cx * CHUNK_W, y, region.z + z - chunk.cz * CHUNK_D, id);
      };
      treeBox(10, 29, 10, 11, 36, 11, BLOCKS.WOOD_LOG);
      treeBox(7, 35, 7, 14, 38, 14, BLOCKS.LEAVES);
      treeBox(9, 39, 9, 12, 40, 12, BLOCKS.LEAVES);
      box(8, 29, 14, 13, 29, 14, BLOCKS.PLANKS);
    } else if (desert) {
      // Broken observatory: stepped foundation and uneven stone pillars.
      box(6, 28, 7, 15, 29, 15, BLOCKS.STONE_BRICK);
      for (const [x, z, h] of [[7, 8, 36], [14, 8, 34], [7, 14, 32], [14, 14, 37]])
        box(x, 30, z, x + 1, h, z + 1, BLOCKS.STONE_BRICK);
      box(7, 37, 8, 11, 37, 9, BLOCKS.STONE_BRICK);
      box(10, 30, 11, 11, 30, 12, BLOCKS.GLASS);
    } else {
      // Hollow towers with an open entrance and a glass beacon in the coastal village.
      for (let x = 8; x <= 14; x++) for (let z = 8; z <= 14; z++)
        if (x === 8 || x === 14 || z === 8 || z === 14)
          box(x, 29, z, x, 40, z, BLOCKS.STONE_BRICK);
      box(11, 29, 8, 11, 31, 8, BLOCKS.AIR);
      box(8, 41, 8, 14, 41, 14, BLOCKS.PLANKS);
      if (!mountain) {
        box(9, 42, 9, 13, 44, 13, BLOCKS.GLASS);
        box(8, 45, 8, 14, 45, 14, BLOCKS.STONE_BRICK);
        box(-3, 28, 14, 3, 28, 27, BLOCKS.PLANKS);
        for (const z of [16, 22, 27]) for (const x of [-3, 3]) box(x, 18, z, x, 30, z, BLOCKS.WOOD_LOG);
      } else for (const x of [8, 10, 12, 14]) for (const z of [8, 14]) put(x, 42, z, BLOCKS.STONE_BRICK);
    }
  }

  _placeTree(chunk, x, y, z) {
    const tree = { x: chunk.cx * CHUNK_W + x, y, z: chunk.cz * CHUNK_D + z, width: 1, height: 3, radius: 2, crown: 6 };
    this._registerTree(chunk, tree);
    for (let i = 0; i < 4; i++) this._treeBlock(chunk, tree, x, y + i, z, BLOCKS.WOOD_LOG);
    for (let lx = -2; lx <= 2; lx++) {
      for (let lz = -2; lz <= 2; lz++) {
        for (let ly = 3; ly <= 5; ly++) {
          if (Math.abs(lx) === 2 && Math.abs(lz) === 2) continue;
          this._treeBlock(chunk, tree, x + lx, y + ly, z + lz, BLOCKS.LEAVES);
        }
      }
    }
    this._treeBlock(chunk, tree, x, y + 5, z, BLOCKS.LEAVES);
  }

  _registerTree(chunk, tree) {
    tree.id = `${tree.x},${tree.y},${tree.z}`;
    if (Math.floor(tree.x / CHUNK_W) === chunk.cx && Math.floor(tree.z / CHUNK_D) === chunk.cz) chunk.trees.push(tree);
  }

  _treeBlock(chunk, tree, x, y, z, id) {
    if (x < 0 || x >= CHUNK_W || z < 0 || z >= CHUNK_D || y < 0 || y >= CHUNK_H) return;
    chunk.setBlock(x, y, z, id); chunk.naturalBlocks.set(chunk._idx(x, y, z), tree);
  }

  getNaturalTree(x, y, z) {
    if (y < 0 || y >= CHUNK_H) return null;
    const chunk = this.getChunk(Math.floor(x / CHUNK_W), Math.floor(z / CHUNK_D));
    return chunk.naturalBlocks.get(chunk._idx((x % CHUNK_W + CHUNK_W) % CHUNK_W, y, (z % CHUNK_D + CHUNK_D) % CHUNK_D)) ?? null;
  }

  getBuildingParts(x, y, z) {
    if (y < 0 || y >= CHUNK_H) return null;
    const chunk = this.getChunk(Math.floor(x / CHUNK_W), Math.floor(z / CHUNK_D));
    return chunk.buildingBlocks.get(chunk._idx((x % CHUNK_W + CHUNK_W) % CHUNK_W, y, (z % CHUNK_D + CHUNK_D) % CHUNK_D)) ?? null;
  }

  getCollisionBoxes(x, y, z, min, max) {
    const parts = this.getBuildingParts(x, y, z);
    if (parts) return parts.map(part => buildingBounds(part, min, max)).filter(Boolean);
    return this.isSolid(x, y, z) ? [{ min: { x, y, z }, max: { x: x + 1, y: y + 1, z: z + 1 } }] : [];
  }

  isNaturalLeaf(x, y, z) { return this.getBlock(x, y, z) === BLOCKS.LEAVES && Boolean(this.getNaturalTree(x, y, z)); }

  getTreeBlocks(x, y, z) {
    const tree = this.getNaturalTree(x, y, z);
    if (!tree || this.getBlock(x, y, z) !== BLOCKS.WOOD_LOG) return [];
    const blocks = [];
    for (let wx = tree.x - tree.radius; wx <= tree.x + tree.radius; wx++)
      for (let wz = tree.z - tree.radius; wz <= tree.z + tree.radius; wz++)
        for (let wy = tree.y; wy < tree.y + tree.crown; wy++) {
          if (this.getNaturalTree(wx, wy, wz)?.id !== tree.id) continue;
          blocks.push({ x: wx, y: wy, z: wz, blockId: BLOCKS.AIR });
        }
    return blocks;
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
    const key = this._key(cx, cz);
    if (!this.edits.has(key)) this.edits.set(key, new Map());
    this.edits.get(key).set(wy * CHUNK_W * CHUNK_D + lz * CHUNK_W + lx, id);
    const chunk = this.getChunk(cx, cz), tree = chunk.naturalBlocks.get(chunk._idx(lx, wy, lz));
    chunk.setBlock(lx, wy, lz, id);
    if (tree) this.getChunk(Math.floor(tree.x / CHUNK_W), Math.floor(tree.z / CHUNK_D)).dirty = true;
    return { cx, cz };
  }

  isSolid(wx, wy, wz) {
    const id = this.getBlock(wx, wy, wz);
    if (id === BLOCKS.LEAVES && this.getNaturalTree(wx, wy, wz)) return false;
    const building = this.getBuildingParts(wx, wy, wz);
    if (building) return building.length > 0;
    return BLOCK_SOLID[id] ?? false;
  }

  retainAround(cx, cz, radius) {
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - cx) > radius || Math.abs(chunk.cz - cz) > radius) this.chunks.delete(key);
    }
  }
}

const BLOCK_SOLID = {
  0: false,  // AIR
  1: true,   // GRASS
  2: true,   // DIRT
  3: true,   // STONE
  4: true,   // WOOD_LOG
  5: true,   // LEAVES
  6: true,   // SAND
  7: true,   // GRAVEL
  8: true,   // PLANKS
  9: true,   // STONE_BRICK
  10: true,  // GLASS
  11: true,  // COAL_ORE
  12: true,  // IRON_ORE
  13: true,  // BEDROCK
  14: false, // WATER
};
