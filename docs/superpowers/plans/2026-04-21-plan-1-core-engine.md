# Blocktopia — Plan 1: Core Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable 3D voxel world in the browser — walk around, place and break blocks, procedurally generated terrain, keyboard + mobile touch controls, deployable to Netlify.

**Architecture:** Three.js renders a chunk-based voxel world (16×16×64 chunks) generated via simplex noise. Custom AABB physics handles player movement and collision. HUD is a DOM overlay on the Three.js canvas. Block textures are procedurally generated colored tiles (no art assets required). This is Plan 1 of 4 — Plans 2–4 extend this with multiplayer, game modes/inventory, full UI, and dinosaurs.

**Tech Stack:** Three.js 0.163, simplex-noise 4.0, Vitest 1.x, Vite 5.x, Netlify (static hosting)

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts |
| `vite.config.js` | Bundler config |
| `netlify.toml` | SPA redirect rule |
| `index.html` | Entry point, canvas + HUD DOM |
| `src/main.js` | Boot: wires all systems, runs game loop |
| `src/constants/blocks.js` | Block ID enum + properties (name, solid, UV tile) |
| `src/engine/world.js` | Chunk class + World class (storage, terrain gen, get/set block) |
| `src/engine/mesher.js` | Builds Three.js BufferGeometry from a chunk |
| `src/engine/renderer.js` | Three.js scene, camera, chunk mesh map, lighting, fog |
| `src/engine/physics.js` | AABB collision, gravity, jump |
| `src/engine/raycast.js` | DDA ray vs voxel world (returns hit block + face) |
| `src/game/player.js` | Player state, desktop input handler, block break/place |
| `src/game/touch.js` | Mobile virtual joystick + touch button overlay |
| `src/ui/hud.js` | Crosshair + minimal hotbar DOM element |
| `src/ui/atlas.js` | Generates block texture atlas on a canvas |
| `tests/world.test.js` | Chunk + World unit tests |
| `tests/physics.test.js` | AABB collision unit tests |
| `tests/mesher.test.js` | Mesher geometry unit tests |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `netlify.toml`
- Create: `index.html`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "blocktopia",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "three": "^0.163.0",
    "@supabase/supabase-js": "^2.43.0",
    "simplex-noise": "^4.0.1"
  },
  "devDependencies": {
    "vite": "^5.2.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 2: Create vite.config.js**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: Create netlify.toml**

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

- [ ] **Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <title>Blocktopia</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; font-family: 'Segoe UI', sans-serif; }
    #canvas { display: block; width: 100vw; height: 100vh; }
    #hud {
      position: fixed; inset: 0; pointer-events: none;
      display: flex; flex-direction: column;
      justify-content: space-between; align-items: center;
    }
    #crosshair {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 20px; height: 20px; pointer-events: none;
    }
    #crosshair::before, #crosshair::after {
      content: ''; position: absolute; background: rgba(255,255,255,0.8);
    }
    #crosshair::before { width: 2px; height: 20px; left: 9px; top: 0; }
    #crosshair::after  { width: 20px; height: 2px; top: 9px; left: 0; }
    #hotbar {
      position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 4px; pointer-events: none;
    }
    .hotbar-slot {
      width: 44px; height: 44px; border: 2px solid #888;
      border-radius: 4px; background: rgba(0,0,0,0.5);
    }
    .hotbar-slot.active { border-color: #fff; }
    #block-name {
      position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%);
      color: #fff; font-size: 13px; text-shadow: 1px 1px 2px #000;
      pointer-events: none;
    }
    #info {
      position: fixed; top: 8px; left: 8px; color: #fff;
      font-size: 12px; text-shadow: 1px 1px 2px #000; pointer-events: none;
    }
    #click-to-play {
      position: fixed; inset: 0; background: rgba(0,0,0,0.7);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: #fff; pointer-events: all; cursor: pointer; z-index: 100;
    }
    #click-to-play h1 { font-size: 3rem; margin-bottom: 1rem; letter-spacing: 2px; }
    #click-to-play p  { font-size: 1.1rem; color: #aaa; }
    #touch-controls {
      display: none;
      position: fixed; inset: 0; pointer-events: none; z-index: 10;
    }
    #joystick-zone {
      position: fixed; bottom: 80px; left: 20px;
      width: 120px; height: 120px;
      border-radius: 50%; background: rgba(255,255,255,0.1);
      border: 2px solid rgba(255,255,255,0.2);
      pointer-events: all; touch-action: none;
    }
    #joystick-knob {
      position: absolute; width: 48px; height: 48px;
      border-radius: 50%; background: rgba(255,255,255,0.4);
      top: 50%; left: 50%; transform: translate(-50%,-50%);
      pointer-events: none;
    }
    .touch-btn {
      position: fixed; width: 56px; height: 56px;
      border-radius: 50%; background: rgba(255,255,255,0.15);
      border: 2px solid rgba(255,255,255,0.3);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 20px; pointer-events: all; touch-action: none;
      user-select: none;
    }
    #btn-jump  { bottom: 100px; right: 90px; }
    #btn-break { bottom: 170px; right: 20px; }
    #btn-place { bottom: 100px; right: 20px; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>

  <div id="click-to-play">
    <h1>BLOCKTOPIA</h1>
    <p>Click to play</p>
  </div>

  <div id="hud">
    <div id="info">WASD move · Space jump · Left click break · Right click place</div>
    <div id="crosshair"></div>
    <div>
      <div id="block-name"></div>
      <div id="hotbar"></div>
    </div>
  </div>

  <div id="touch-controls">
    <div id="joystick-zone"><div id="joystick-knob"></div></div>
    <div class="touch-btn" id="btn-jump">↑</div>
    <div class="touch-btn" id="btn-break">⛏</div>
    <div class="touch-btn" id="btn-place">🧱</div>
  </div>

  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 5: Install dependencies**

```bash
cd /home/chris/dev/minecraft-roblox-clone && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Verify dev server starts**

```bash
npm run dev -- --port 5173 &
sleep 3 && curl -s http://localhost:5173 | head -5
```

Expected: HTML output starting with `<!DOCTYPE html>`. Kill the server after: `kill %1`

- [ ] **Step 7: Commit**

```bash
git init && git add -A && git commit -m "feat: project scaffold — Vite, Three.js, Netlify config"
```

---

## Task 2: Block definitions

**Files:**
- Create: `src/constants/blocks.js`
- Create: `src/ui/atlas.js`

- [ ] **Step 1: Create src/constants/blocks.js**

```js
export const BLOCKS = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD_LOG: 4,
  LEAVES: 5,
  SAND: 6,
  GRAVEL: 7,
  PLANKS: 8,
  STONE_BRICK: 9,
  GLASS: 10,
  COAL_ORE: 11,
  IRON_ORE: 12,
  BEDROCK: 13,
  WATER: 14,
});

// UV tile coords [col, row] in the 16×16 atlas grid
export const BLOCK_DEFS = {
  [BLOCKS.AIR]:        { name: 'Air',         solid: false, transparent: true,  top:[0,0], side:[0,0], bot:[0,0] },
  [BLOCKS.GRASS]:      { name: 'Grass',        solid: true,  transparent: false, top:[0,0], side:[1,0], bot:[2,0] },
  [BLOCKS.DIRT]:       { name: 'Dirt',         solid: true,  transparent: false, top:[2,0], side:[2,0], bot:[2,0] },
  [BLOCKS.STONE]:      { name: 'Stone',        solid: true,  transparent: false, top:[3,0], side:[3,0], bot:[3,0] },
  [BLOCKS.WOOD_LOG]:   { name: 'Wood Log',     solid: true,  transparent: false, top:[4,0], side:[5,0], bot:[4,0] },
  [BLOCKS.LEAVES]:     { name: 'Leaves',       solid: true,  transparent: false, top:[6,0], side:[6,0], bot:[6,0] },
  [BLOCKS.SAND]:       { name: 'Sand',         solid: true,  transparent: false, top:[7,0], side:[7,0], bot:[7,0] },
  [BLOCKS.GRAVEL]:     { name: 'Gravel',       solid: true,  transparent: false, top:[8,0], side:[8,0], bot:[8,0] },
  [BLOCKS.PLANKS]:     { name: 'Planks',       solid: true,  transparent: false, top:[9,0], side:[9,0], bot:[9,0] },
  [BLOCKS.STONE_BRICK]:{ name: 'Stone Brick',  solid: true,  transparent: false, top:[10,0],side:[10,0],bot:[10,0]},
  [BLOCKS.GLASS]:      { name: 'Glass',        solid: true,  transparent: true,  top:[11,0],side:[11,0],bot:[11,0]},
  [BLOCKS.COAL_ORE]:   { name: 'Coal Ore',     solid: true,  transparent: false, top:[12,0],side:[12,0],bot:[12,0]},
  [BLOCKS.IRON_ORE]:   { name: 'Iron Ore',     solid: true,  transparent: false, top:[13,0],side:[13,0],bot:[13,0]},
  [BLOCKS.BEDROCK]:    { name: 'Bedrock',      solid: true,  transparent: false, top:[14,0],side:[14,0],bot:[14,0]},
  [BLOCKS.WATER]:      { name: 'Water',        solid: false, transparent: true,  top:[15,0],side:[15,0],bot:[15,0]},
};

export const HOTBAR_BLOCKS = [
  BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD_LOG,
  BLOCKS.LEAVES, BLOCKS.SAND, BLOCKS.PLANKS, BLOCKS.STONE_BRICK, BLOCKS.GLASS,
];
```

- [ ] **Step 2: Create src/ui/atlas.js**

This generates a 256×256 texture atlas (16 tiles × 16px each) using canvas — no image files needed.

```js
import * as THREE from 'three';

// Colors per tile index [col, row=0] matching BLOCK_DEFS UV tiles
const TILE_COLORS = {
  '0,0': '#5d9e32', // grass top
  '1,0': '#7c5c3a', // grass side (brownish-green, approximate with dirt-ish)
  '2,0': '#8b6040', // dirt
  '3,0': '#7a7a7a', // stone
  '4,0': '#6b4f1e', // log top
  '5,0': '#8c6b2c', // log side
  '6,0': '#3a7a3a', // leaves
  '7,0': '#d4c86e', // sand
  '8,0': '#8a8078', // gravel
  '9,0': '#b8874a', // planks
  '10,0':'#888080', // stone brick
  '11,0':'#c8e8f0', // glass (light blue)
  '12,0':'#666666', // coal ore (dark gray with dots)
  '13,0':'#8a7050', // iron ore (tan-ish)
  '14,0':'#333333', // bedrock
  '15,0':'#3d6bde', // water
};

export function buildAtlas() {
  const TILE = 16;
  const SIZE = 256; // 16 tiles across
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  for (const [key, color] of Object.entries(TILE_COLORS)) {
    const [col, row] = key.split(',').map(Number);
    ctx.fillStyle = color;
    ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
    // Add a subtle darker border to each tile for definition
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(col * TILE + 0.5, row * TILE + 0.5, TILE - 1, TILE - 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/constants/blocks.js src/ui/atlas.js
git commit -m "feat: block definitions and procedural texture atlas"
```

---

## Task 3: Chunk + World data structure

**Files:**
- Create: `src/engine/world.js`
- Create: `tests/world.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/world.test.js
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
    // Force chunk gen by accessing a block
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
    // Find surface height at (8, z=8) in chunk (0,0)
    let surfaceY = -1;
    for (let y = CHUNK_H - 1; y >= 0; y--) {
      if (w.getBlock(8, y, 8) !== BLOCKS.AIR) { surfaceY = y; break; }
    }
    expect(surfaceY).toBeGreaterThan(10);
    expect(w.getBlock(8, surfaceY, 8)).toBe(BLOCKS.GRASS);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/world.test.js 2>&1 | tail -10
```

Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement src/engine/world.js**

```js
import { createNoise2D } from 'simplex-noise';
import { BLOCKS } from '../constants/blocks.js';

export const CHUNK_W = 16;
export const CHUNK_H = 64;
export const CHUNK_D = 16;

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

export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map();
    // simplex-noise createNoise2D takes a PRNG function
    const s = seed / 2147483647;
    this._noise = createNoise2D(() => s);
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

        // Layer noise for varied terrain
        const n1 = this._noise(wx / 80, wz / 80);
        const n2 = this._noise(wx / 30, wz / 30) * 0.3;
        const height = Math.floor(28 + (n1 + n2) * 10);
        const clampedH = Math.max(4, Math.min(CHUNK_H - 2, height));

        // Bedrock floor
        chunk.setBlock(x, 0, z, BLOCKS.BEDROCK);

        for (let y = 1; y <= clampedH; y++) {
          if (y < clampedH - 3) {
            // Ore veins
            const ore = this._noise(wx * 3.1 + y, wz * 2.7 + y);
            if (ore > 0.75 && y < 20)      chunk.setBlock(x, y, z, BLOCKS.COAL_ORE);
            else if (ore > 0.8 && y < 12)  chunk.setBlock(x, y, z, BLOCKS.IRON_ORE);
            else                            chunk.setBlock(x, y, z, BLOCKS.STONE);
          } else if (y < clampedH) {
            chunk.setBlock(x, y, z, BLOCKS.DIRT);
          } else {
            // Surface: sand near low elevations, grass elsewhere
            chunk.setBlock(x, y, z, clampedH < 22 ? BLOCKS.SAND : BLOCKS.GRASS);
          }
        }

        // Trees — sparse, on grass surface
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
    // Trunk (4 blocks)
    for (let i = 0; i < 4; i++) chunk.setBlock(x, y + i, z, BLOCKS.WOOD_LOG);
    // Leaf canopy
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
    const id = this.getBlock(wx, wy, wz);
    return BLOCK_DEFS_SOLID[id] ?? false;
  }
}

// Inline solid lookup for physics hot-path (avoids importing BLOCK_DEFS in world.js)
const BLOCK_DEFS_SOLID = {
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/world.test.js 2>&1 | tail -15
```

Expected: `5 passed` (or similar), no failures.

- [ ] **Step 5: Commit**

```bash
git add src/engine/world.js tests/world.test.js
git commit -m "feat: chunk + world data structure with simplex noise terrain"
```

---

## Task 4: Chunk mesher

**Files:**
- Create: `src/engine/mesher.js`
- Create: `tests/mesher.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/mesher.test.js
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
import { Chunk, World, CHUNK_W, CHUNK_H, CHUNK_D } from '../src/engine/world.js';
import { BLOCKS } from '../src/constants/blocks.js';

function worldWithBlock(bx, by, bz, id) {
  const w = new World(1);
  // Override getBlock to return our single block
  const origGet = w.getBlock.bind(w);
  w.getBlock = (x, y, z) => (x === bx && y === by && z === bz ? id : BLOCKS.AIR);
  return w;
}

describe('buildChunkMesh', () => {
  it('returns a BufferGeometry for an empty chunk', () => {
    const chunk = new Chunk(0, 0);
    const w = new World(1);
    const geo = buildChunkMesh(chunk, w);
    expect(geo).toBeDefined();
  });

  it('produces 4 vertices per exposed face', () => {
    // Single stone block at (0,0,0) in chunk (0,0), surrounded by air
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BLOCKS.STONE);
    const w = new World(1);
    w.getBlock = (x, y, z) => (x === 0 && y === 0 && z === 0 ? BLOCKS.STONE : BLOCKS.AIR);
    const geo = buildChunkMesh(chunk, w);
    // 6 faces × 4 verts × 3 floats = 72 floats in position buffer
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
    // 2 blocks = 12 faces total, minus 2 shared faces = 10 exposed faces → 40 verts
    expect(geo._posCount).toBe(10 * 4);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/mesher.test.js 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/engine/mesher.js**

```js
import * as THREE from 'three';
import { BLOCK_DEFS, BLOCKS } from '../constants/blocks.js';
import { CHUNK_W, CHUNK_H, CHUNK_D } from './world.js';

const ATLAS_COLS = 16;
const TEX = 1 / ATLAS_COLS;

// [dir, corners (local offsets), which UV key in BLOCK_DEFS, normal]
const FACES = [
  { dir:[0,1,0],  norm:[0,1,0],  uvKey:'top',
    corners:[[0,1,0],[1,1,0],[1,1,1],[0,1,1]] },
  { dir:[0,-1,0], norm:[0,-1,0], uvKey:'bot',
    corners:[[0,0,1],[1,0,1],[1,0,0],[0,0,0]] },
  { dir:[1,0,0],  norm:[1,0,0],  uvKey:'side',
    corners:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { dir:[-1,0,0], norm:[-1,0,0], uvKey:'side',
    corners:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { dir:[0,0,1],  norm:[0,0,1],  uvKey:'side',
    corners:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { dir:[0,0,-1], norm:[0,0,-1], uvKey:'side',
    corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
];

export function buildChunkMesh(chunk, world) {
  const positions = [];
  const normals   = [];
  const uvs       = [];
  const indices   = [];

  const ox = chunk.cx * CHUNK_W;
  const oz = chunk.cz * CHUNK_D;

  for (let y = 0; y < CHUNK_H; y++) {
    for (let z = 0; z < CHUNK_D; z++) {
      for (let x = 0; x < CHUNK_W; x++) {
        const id = chunk.getBlock(x, y, z);
        if (id === BLOCKS.AIR) continue;
        const def = BLOCK_DEFS[id];
        if (!def || !def.solid) continue;

        for (const face of FACES) {
          const nx = ox + x + face.dir[0];
          const ny =      y + face.dir[1];
          const nz = oz + z + face.dir[2];
          const neighbor = world.getBlock(nx, ny, nz);
          const nDef = BLOCK_DEFS[neighbor];
          if (nDef && nDef.solid && !nDef.transparent) continue;

          const tile = def[face.uvKey] ?? [0, 0];
          const u0 = tile[0] * TEX;
          const v0 = tile[1] * TEX;
          const u1 = u0 + TEX;
          const v1 = v0 + TEX;

          const base = positions.length / 3;
          for (const [cx, cy, cz] of face.corners) {
            positions.push(ox + x + cx, y + cy, oz + z + cz);
            normals.push(...face.norm);
          }
          uvs.push(u0,v0, u1,v0, u1,v1, u0,v1);
          indices.push(base, base+1, base+2, base, base+2, base+3);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  geo._posCount = positions.length / 3; // test helper
  return geo;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/mesher.test.js 2>&1 | tail -15
```

Expected: `3 passed`, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/engine/mesher.js tests/mesher.test.js
git commit -m "feat: chunk face mesher with atlas UV mapping"
```

---

## Task 5: Three.js renderer

**Files:**
- Create: `src/engine/renderer.js`

No unit tests — visual output. Verified manually in browser.

- [ ] **Step 1: Create src/engine/renderer.js**

```js
import * as THREE from 'three';
import { buildChunkMesh } from './mesher.js';
import { buildAtlas } from '../ui/atlas.js';

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // sky blue

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 40, 0);

    this._setupLighting();
    this._setupFog();
    this._atlas = buildAtlas();
    this._material = new THREE.MeshLambertMaterial({ map: this._atlas, side: THREE.FrontSide });
    this._chunkMeshes = new Map(); // key → THREE.Mesh

    window.addEventListener('resize', () => this._onResize());
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    this.sunLight = new THREE.DirectionalLight(0xfff4d0, 1.0);
    this.sunLight.position.set(50, 80, 30);
    this.scene.add(this.sunLight);
  }

  _setupFog() {
    const isMobile = navigator.maxTouchPoints > 0;
    const fogDist = isMobile ? 48 : 80;
    this.scene.fog = new THREE.Fog(0x87ceeb, fogDist * 0.6, fogDist);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateChunk(chunk, world) {
    const key = `${chunk.cx},${chunk.cz}`;
    // Remove old mesh
    if (this._chunkMeshes.has(key)) {
      const old = this._chunkMeshes.get(key);
      this.scene.remove(old);
      old.geometry.dispose();
    }
    // Build and add new mesh
    const geo = buildChunkMesh(chunk, world);
    if (geo._posCount === 0) { this._chunkMeshes.delete(key); return; }
    const mesh = new THREE.Mesh(geo, this._material);
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    this._chunkMeshes.set(key, mesh);
    chunk.dirty = false;
  }

  removeChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this._chunkMeshes.has(key)) {
      const mesh = this._chunkMeshes.get(key);
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this._chunkMeshes.delete(key);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/renderer.js
git commit -m "feat: Three.js renderer with chunk mesh management"
```

---

## Task 6: AABB physics

**Files:**
- Create: `src/engine/physics.js`
- Create: `tests/physics.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/physics.test.js
import { describe, it, expect } from 'vitest';
import { Physics } from '../src/engine/physics.js';
import { BLOCKS } from '../src/constants/blocks.js';

function solidWorld(solidFn) {
  return { isSolid: solidFn };
}

describe('Physics', () => {
  it('applies gravity when not on ground', () => {
    const world = solidWorld(() => false);
    const phys = new Physics(world);
    const pos = { x: 0, y: 10, z: 0 };
    phys.update(pos, { x: 0, z: 0 }, false, 0.1);
    expect(pos.y).toBeLessThan(10);
  });

  it('stops falling when it hits ground at y=0', () => {
    // floor at y=0 (solid below y=1)
    const world = solidWorld((x, y, z) => y < 0);
    const phys = new Physics(world);
    const pos = { x: 0.3, y: 0.0, z: 0.3 };
    // Give downward velocity
    phys._vy = -5;
    phys.update(pos, { x: 0, z: 0 }, false, 0.1);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(phys.onGround).toBe(true);
  });

  it('cannot move through a solid wall', () => {
    // Wall at x >= 2
    const world = solidWorld((x, y, z) => x >= 2);
    const phys = new Physics(world);
    const pos = { x: 1.1, y: 1, z: 0.3 };
    phys.onGround = true;
    phys._vy = 0;
    for (let i = 0; i < 20; i++) {
      phys.update(pos, { x: 1, z: 0 }, false, 0.1);
    }
    expect(pos.x).toBeLessThan(2);
  });

  it('jumps when on ground', () => {
    const world = solidWorld((x, y, z) => y < 0);
    const phys = new Physics(world);
    const pos = { x: 0.3, y: 0, z: 0.3 };
    phys.onGround = true;
    phys._vy = 0;
    phys.update(pos, { x: 0, z: 0 }, true, 0.1);
    expect(pos.y).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/physics.test.js 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/engine/physics.js**

```js
const GRAVITY      = -28;
const JUMP_VEL     =  9;
const MOVE_SPEED   =  5;
const PLAYER_W     =  0.6;
const PLAYER_H     =  1.8;
const TERMINAL_VEL = -40;

export class Physics {
  constructor(world) {
    this._world = world;
    this._vy = 0;
    this.onGround = false;
  }

  update(pos, moveDir, jump, dt) {
    // Jump
    if (jump && this.onGround) {
      this._vy = JUMP_VEL;
      this.onGround = false;
    }

    // Gravity
    this._vy = Math.max(this._vy + GRAVITY * dt, TERMINAL_VEL);

    // Horizontal velocity
    const vx = moveDir.x * MOVE_SPEED;
    const vz = moveDir.z * MOVE_SPEED;

    // Sweep each axis independently
    pos.x += vx * dt;
    this._resolveX(pos);

    pos.y += this._vy * dt;
    this._resolveY(pos);

    pos.z += vz * dt;
    this._resolveZ(pos);
  }

  _aabbMin(pos) {
    return { x: pos.x - PLAYER_W / 2, y: pos.y,            z: pos.z - PLAYER_W / 2 };
  }
  _aabbMax(pos) {
    return { x: pos.x + PLAYER_W / 2, y: pos.y + PLAYER_H, z: pos.z + PLAYER_W / 2 };
  }

  _resolveX(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          if (!this._world.isSolid(bx, by, bz)) continue;
          if (pos.x > bx + 0.5) pos.x = bx + 1 + PLAYER_W / 2;
          else                   pos.x = bx   - PLAYER_W / 2;
        }
      }
    }
  }

  _resolveY(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    let hitFloor = false;
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          if (!this._world.isSolid(bx, by, bz)) continue;
          if (this._vy < 0) { pos.y = by + 1; hitFloor = true; }
          else               { pos.y = by - PLAYER_H; }
          this._vy = 0;
        }
      }
    }
    this.onGround = hitFloor;
    if (!hitFloor && this._vy <= 0) this.onGround = false;
  }

  _resolveZ(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          if (!this._world.isSolid(bx, by, bz)) continue;
          if (pos.z > bz + 0.5) pos.z = bz + 1 + PLAYER_W / 2;
          else                   pos.z = bz   - PLAYER_W / 2;
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/physics.test.js 2>&1 | tail -15
```

Expected: `4 passed`, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/engine/physics.js tests/physics.test.js
git commit -m "feat: AABB voxel physics with gravity and collision"
```

---

## Task 7: Block raycasting

**Files:**
- Create: `src/engine/raycast.js`

- [ ] **Step 1: Create src/engine/raycast.js**

```js
import { BLOCK_DEFS, BLOCKS } from '../constants/blocks.js';

/**
 * DDA voxel raycast. Returns { x, y, z, face } of first solid block hit,
 * or null if nothing hit within maxDist.
 * face is the normal of the hit face as [dx,dy,dz] pointing away from the block.
 */
export function raycast(world, origin, direction, maxDist = 5) {
  let { x, y, z } = origin;
  const { x: dx, y: dy, z: dz } = direction;

  // Current voxel
  let bx = Math.floor(x);
  let by = Math.floor(y);
  let bz = Math.floor(z);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const tDeltaX = Math.abs(1 / dx) || Infinity;
  const tDeltaY = Math.abs(1 / dy) || Infinity;
  const tDeltaZ = Math.abs(1 / dz) || Infinity;

  let tMaxX = dx > 0 ? (bx + 1 - x) / dx : (x - bx) / -dx;
  let tMaxY = dy > 0 ? (by + 1 - y) / dy : (y - by) / -dy;
  let tMaxZ = dz > 0 ? (bz + 1 - z) / dz : (z - bz) / -dz;
  tMaxX = isFinite(tMaxX) ? Math.abs(tMaxX) : Infinity;
  tMaxY = isFinite(tMaxY) ? Math.abs(tMaxY) : Infinity;
  tMaxZ = isFinite(tMaxZ) ? Math.abs(tMaxZ) : Infinity;

  let face = [0, 0, 0];
  let t = 0;

  while (t < maxDist) {
    const id = world.getBlock(bx, by, bz);
    const def = BLOCK_DEFS[id];
    if (id !== BLOCKS.AIR && def && def.solid) {
      return { x: bx, y: by, z: bz, face };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      bx += stepX;
      face = [-stepX, 0, 0];
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      by += stepY;
      face = [0, -stepY, 0];
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      bz += stepZ;
      face = [0, 0, -stepZ];
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/raycast.js
git commit -m "feat: DDA voxel raycast for block targeting"
```

---

## Task 8: Player + desktop input

**Files:**
- Create: `src/game/player.js`

- [ ] **Step 1: Create src/game/player.js**

```js
import * as THREE from 'three';
import { Physics } from '../engine/physics.js';
import { raycast } from '../engine/raycast.js';
import { BLOCKS, BLOCK_DEFS, HOTBAR_BLOCKS } from '../constants/blocks.js';

const PI2 = Math.PI * 2;
const HALF_PI = Math.PI / 2 - 0.01;

export class Player {
  constructor(world, camera) {
    this._world    = world;
    this._camera   = camera;
    this._physics  = new Physics(world);

    this.position  = new THREE.Vector3(8, 48, 8);
    this._yaw      = 0;
    this._pitch    = 0;

    // Input state
    this._keys     = {};
    this._moveDir  = { x: 0, z: 0 };
    this._jump     = false;
    this._breaking = false;
    this._placing  = false;
    this._breakTimer = 0;

    // Inventory
    this.hotbar    = [...HOTBAR_BLOCKS];
    this.hotbarIdx = 0;

    // External move input (set by touch.js on mobile)
    this.touchMove = { x: 0, z: 0 };
    this.touchJump = false;

    // Block name display
    this.targetBlock = null;

    this._bindEvents();
  }

  _bindEvents() {
    // Pointer lock
    document.addEventListener('click', () => {
      if (!document.pointerLockElement) {
        document.getElementById('click-to-play')?.remove();
        document.body.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      const tc = document.getElementById('touch-controls');
      if (tc) tc.style.display = 'none'; // desktop: no touch UI
    });

    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this._yaw   -= e.movementX * 0.002;
      this._pitch -= e.movementY * 0.002;
      this._pitch  = Math.max(-HALF_PI, Math.min(HALF_PI, this._pitch));
    });

    document.addEventListener('keydown', (e) => { this._keys[e.code] = true; });
    document.addEventListener('keyup',   (e) => { this._keys[e.code] = false; });

    document.addEventListener('mousedown', (e) => {
      if (!document.pointerLockElement) return;
      if (e.button === 0) this._breaking = true;
      if (e.button === 2) this._placing  = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this._breaking = false; this._breakTimer = 0; }
      if (e.button === 2) this._placing = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      this.hotbarIdx = (this.hotbarIdx + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      this._updateHotbarUI();
    });
  }

  update(dt) {
    this._computeMoveDir();
    this._physics.update(this.position, this._moveDir, this._jump || this.touchJump, dt);
    this._updateCamera();
    this._handleBlockInteraction(dt);
    this._updateHotbarUI();
  }

  _computeMoveDir() {
    const fwd = new THREE.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
    const rgt = new THREE.Vector3( Math.cos(this._yaw), 0, -Math.sin(this._yaw));

    let mx = 0, mz = 0;

    // Keyboard
    if (this._keys['KeyW'] || this._keys['ArrowUp'])    { mx += fwd.x; mz += fwd.z; }
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  { mx -= fwd.x; mz -= fwd.z; }
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  { mx -= rgt.x; mz -= rgt.z; }
    if (this._keys['KeyD'] || this._keys['ArrowRight']) { mx += rgt.x; mz += rgt.z; }

    // Touch joystick (added by touch.js)
    if (this.touchMove.x !== 0 || this.touchMove.z !== 0) {
      mx += fwd.x * -this.touchMove.z + rgt.x * this.touchMove.x;
      mz += fwd.z * -this.touchMove.z + rgt.z * this.touchMove.x;
    }

    this._jump = this._keys['Space'] === true;

    const len = Math.sqrt(mx * mx + mz * mz);
    this._moveDir = len > 0 ? { x: mx / len, z: mz / len } : { x: 0, z: 0 };
  }

  _updateCamera() {
    this._camera.position.copy(this.position).add(new THREE.Vector3(0, 1.6, 0));
    this._camera.rotation.order = 'YXZ';
    this._camera.rotation.y = this._yaw;
    this._camera.rotation.x = this._pitch;
  }

  _handleBlockInteraction(dt) {
    // Get look direction from camera
    const dir = new THREE.Vector3();
    this._camera.getWorldDirection(dir);
    const eyePos = this._camera.position;

    const hit = raycast(this._world, eyePos, dir);
    this.targetBlock = hit;

    // Update block name display
    const nameEl = document.getElementById('block-name');
    if (nameEl) {
      if (hit) {
        const id = this._world.getBlock(hit.x, hit.y, hit.z);
        nameEl.textContent = BLOCK_DEFS[id]?.name ?? '';
      } else {
        nameEl.textContent = '';
      }
    }

    // Break block (hold)
    if ((this._breaking || this.touchBreak) && hit) {
      this._breakTimer += dt;
      if (this._breakTimer >= 0.3) {
        this._world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
        this._breakTimer = 0;
        this._onBlockChanged(hit.x, hit.y, hit.z);
      }
    } else {
      this._breakTimer = 0;
    }

    // Place block (single press)
    if (this._placing && !this._lastPlacing && hit) {
      const px = hit.x + hit.face[0];
      const py = hit.y + hit.face[1];
      const pz = hit.z + hit.face[2];
      // Don't place inside player
      const pp = this.position;
      const dx = Math.abs(px + 0.5 - pp.x);
      const dz = Math.abs(pz + 0.5 - pp.z);
      const dy = py - pp.y;
      if (!(dx < 0.4 && dz < 0.4 && dy >= -0.1 && dy < 1.9)) {
        this._world.setBlock(px, py, pz, this.hotbar[this.hotbarIdx]);
        this._onBlockChanged(px, py, pz);
      }
    }
    this._lastPlacing = this._placing || !!this.touchPlace;
  }

  _updateHotbarUI() {
    const slots = document.querySelectorAll('.hotbar-slot');
    slots.forEach((el, i) => {
      el.classList.toggle('active', i === this.hotbarIdx);
    });
  }

  // Overridden by main.js to trigger chunk remesh
  _onBlockChanged(x, y, z) {}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/game/player.js
git commit -m "feat: player controller with desktop keyboard/mouse input"
```

---

## Task 9: Mobile touch controls

**Files:**
- Create: `src/game/touch.js`

- [ ] **Step 1: Create src/game/touch.js**

```js
export function initTouchControls(player) {
  // Only show touch UI on touch devices
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;

  const tc = document.getElementById('touch-controls');
  if (tc) tc.style.display = 'block';

  // Virtual joystick
  const zone  = document.getElementById('joystick-zone');
  const knob  = document.getElementById('joystick-knob');
  const RADIUS = 40;
  let joystickId = null;
  let joystickOrigin = { x: 0, y: 0 };

  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joystickId = t.identifier;
    const r = zone.getBoundingClientRect();
    joystickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joystickId) continue;
      let dx = t.clientX - joystickOrigin.x;
      let dy = t.clientY - joystickOrigin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) { dx = dx / dist * RADIUS; dy = dy / dist * RADIUS; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      player.touchMove.x =  dx / RADIUS;
      player.touchMove.z =  dy / RADIUS;
    }
  }, { passive: false });

  const endJoystick = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joystickId) continue;
      joystickId = null;
      knob.style.transform = 'translate(-50%, -50%)';
      player.touchMove.x = 0;
      player.touchMove.z = 0;
    }
  };
  zone.addEventListener('touchend',    endJoystick);
  zone.addEventListener('touchcancel', endJoystick);

  // Look area — right side of screen
  let lookId = null;
  let lastLook = { x: 0, y: 0 };

  document.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.4) continue; // left side = joystick
      if (lookId !== null) continue;
      lookId = t.identifier;
      lastLook = { x: t.clientX, y: t.clientY };
    }
  });

  document.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      const dx = t.clientX - lastLook.x;
      const dy = t.clientY - lastLook.y;
      player._yaw   -= dx * 0.004;
      player._pitch -= dy * 0.004;
      const HALF_PI = Math.PI / 2 - 0.01;
      player._pitch  = Math.max(-HALF_PI, Math.min(HALF_PI, player._pitch));
      lastLook = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookId) lookId = null;
    }
  });

  // Jump / Break / Place buttons
  const btnJump  = document.getElementById('btn-jump');
  const btnBreak = document.getElementById('btn-break');
  const btnPlace = document.getElementById('btn-place');

  btnJump.addEventListener('touchstart',  (e) => { e.preventDefault(); player.touchJump = true;  }, { passive: false });
  btnJump.addEventListener('touchend',    (e) => { e.preventDefault(); player.touchJump = false; }, { passive: false });
  btnBreak.addEventListener('touchstart', (e) => { e.preventDefault(); player.touchBreak = true;  }, { passive: false });
  btnBreak.addEventListener('touchend',   (e) => { e.preventDefault(); player.touchBreak = false; }, { passive: false });
  btnPlace.addEventListener('touchstart', (e) => { e.preventDefault(); player.touchPlace = true;  player._placing = true;  }, { passive: false });
  btnPlace.addEventListener('touchend',   (e) => { e.preventDefault(); player.touchPlace = false; player._placing = false; }, { passive: false });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/game/touch.js
git commit -m "feat: mobile touch controls — virtual joystick, look area, action buttons"
```

---

## Task 10: HUD

**Files:**
- Create: `src/ui/hud.js`

- [ ] **Step 1: Create src/ui/hud.js**

```js
import { HOTBAR_BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';

export function initHUD() {
  const hotbar = document.getElementById('hotbar');
  if (!hotbar) return;

  HOTBAR_BLOCKS.forEach((blockId, i) => {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot' + (i === 0 ? ' active' : '');
    slot.title = BLOCK_DEFS[blockId]?.name ?? '';

    // Color swatch from block def (matches atlas tile 0,0 column)
    const colors = [
      '#5d9e32','#8b6040','#7a7a7a','#8c6b2c',
      '#3a7a3a','#d4c86e','#b8874a','#888080','#c8e8f0',
    ];
    slot.style.background = colors[i] ?? '#555';
    slot.style.border = '2px solid #888';
    hotbar.appendChild(slot);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/hud.js
git commit -m "feat: minimal HUD — hotbar with block color swatches"
```

---

## Task 11: Main boot + game loop

**Files:**
- Create: `src/main.js`

- [ ] **Step 1: Create src/main.js**

```js
import { World } from './engine/world.js';
import { Renderer } from './engine/renderer.js';
import { Player } from './game/player.js';
import { initTouchControls } from './game/touch.js';
import { initHUD } from './ui/hud.js';

const RENDER_DIST = navigator.maxTouchPoints > 0 ? 2 : 4;
const SEED = 42; // Phase 2 will derive this from room code

function init() {
  const canvas   = document.getElementById('canvas');
  const world    = new World(SEED);
  const renderer = new Renderer(canvas);
  const player   = new Player(world, renderer.camera);

  initHUD();
  initTouchControls(player);

  // Wire block-changed callback to trigger remesh
  player._onBlockChanged = (wx, wy, wz) => {
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    remeshChunk(cx, cz);
    // Remesh adjacent chunks if block is on a border
    if ((wx % 16) === 0)  remeshChunk(cx - 1, cz);
    if ((wx % 16) === 15) remeshChunk(cx + 1, cz);
    if ((wz % 16) === 0)  remeshChunk(cx, cz - 1);
    if ((wz % 16) === 15) remeshChunk(cx, cz + 1);
  };

  function remeshChunk(cx, cz) {
    const chunk = world.getChunk(cx, cz);
    renderer.updateChunk(chunk, world);
  }

  // Initial chunk load around spawn
  function loadChunksAround(px, pz) {
    const cx = Math.floor(px / 16);
    const cz = Math.floor(pz / 16);
    for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
      for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
        const chunk = world.getChunk(cx + dx, cz + dz);
        if (chunk.dirty) remeshChunk(cx + dx, cz + dz);
      }
    }
  }

  // Find safe spawn Y
  let spawnY = 50;
  for (let y = 60; y > 0; y--) {
    if (world.getBlock(8, y, 8) !== 0) { spawnY = y + 2; break; }
  }
  player.position.set(8, spawnY, 8);

  loadChunksAround(player.position.x, player.position.z);

  let lastCX = Math.floor(player.position.x / 16);
  let lastCZ = Math.floor(player.position.z / 16);
  let lastTime = performance.now();

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime  = now;

    player.update(dt);

    // Lazy-load new chunks as player moves
    const cx = Math.floor(player.position.x / 16);
    const cz = Math.floor(player.position.z / 16);
    if (cx !== lastCX || cz !== lastCZ) {
      loadChunksAround(player.position.x, player.position.z);
      lastCX = cx; lastCZ = cz;
    }

    // Update info overlay
    const info = document.getElementById('info');
    if (info) {
      const p = player.position;
      info.textContent = `XYZ: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  FPS: ${Math.round(1/dt)}`;
    }

    renderer.render();
  }

  loop();
}

init();
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass (world, physics, mesher).

- [ ] **Step 3: Start dev server and verify in browser**

```bash
npm run dev -- --port 5173
```

Open `http://localhost:5173`. Verify:
- 3D world renders with colored blocks
- WASD + mouse moves the player
- Left-click breaks blocks
- Right-click places blocks
- Info overlay shows XYZ + FPS
- Hotbar visible at bottom

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: main game loop — world, renderer, player, HUD wired together"
```

---

## Task 12: Production build + Netlify deploy

**Files:**
- Modify: `netlify.toml` (already correct)

- [ ] **Step 1: Production build**

```bash
npm run build 2>&1 | tail -20
```

Expected: `dist/` folder created, no errors. Output should show bundle sizes. Three.js chunk should be ~600KB.

- [ ] **Step 2: Preview build locally**

```bash
npm run preview -- --port 4173 &
sleep 2 && curl -s http://localhost:4173 | head -3
```

Expected: HTML. Kill with `kill %1`.

- [ ] **Step 3: Push to GitHub**

```bash
git remote add origin https://github.com/jdgafx/blocktopia.git
git push -u origin main
```

If repo doesn't exist yet, create it first:

```bash
gh repo create blocktopia --public --source=. --remote=origin --push
```

- [ ] **Step 4: Connect Netlify**

Go to https://app.netlify.com → "Add new site" → "Import an existing project" → GitHub → select `blocktopia` repo.

Build settings (auto-detected from `netlify.toml`):
- Build command: `npm run build`
- Publish directory: `dist`

Click "Deploy site". Wait ~2 minutes.

- [ ] **Step 5: Verify live URL**

Visit the Netlify URL (e.g. `https://blocktopia.netlify.app`). Verify game loads and is playable.

- [ ] **Step 6: Commit final state**

```bash
git add -A && git commit -m "chore: verify production build and Netlify deploy"
```

---

## Self-Review

Spec coverage check:
- ✅ Voxel world + terrain gen — Tasks 3, 11
- ✅ Block placement/destruction — Task 8
- ✅ Chunk meshing + Three.js renderer — Tasks 4, 5
- ✅ AABB physics — Task 6
- ✅ Desktop keyboard/mouse controls — Task 8
- ✅ Mobile touch controls — Task 9
- ✅ Basic HUD (hotbar, crosshair, XYZ) — Task 10
- ✅ Netlify deploy — Task 12
- ✅ Block atlas (no art assets required) — Task 2
- ✅ TDD for all testable units — Tasks 3, 4, 6

Not in this plan (covered in Plans 2–4):
- Multiplayer (Plan 2)
- Creative/survival modes, inventory, crafting (Plan 2)
- Day/night cycle, chat, character customization (Plan 3)
- Dinosaur system (Plan 4)
