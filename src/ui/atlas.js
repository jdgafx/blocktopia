import * as THREE from 'three';

// Procedural 16x16 Minecraft-style textures painted into a 256x256 atlas.
// Deterministic: seeded RNG so every build renders identical textures.
const TILE = 16;
const SIZE = 256;
const ATLAS_SEED = 1337;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-pixel painters. Each returns [r,g,b,a] for pixel (x,y) in 0..15.
function shade([r, g, b], f, a = 255) {
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f), a];
}

function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

const GRASS_GREEN = [106, 170, 64];
const DIRT_BROWN  = [134, 96, 67];
const STONE_GRAY  = [125, 125, 125];

function grassTop(x, y, rand) {
  return shade(GRASS_GREEN, pick(rand, [0.86, 0.93, 1.0, 1.06]));
}
function dirt(x, y, rand) {
  return shade(DIRT_BROWN, pick(rand, [0.8, 0.9, 1.0, 1.08]));
}
function grassSide(x, y, rand) {
  const lip = 2 + Math.floor(rand() * 2); // jagged grass lip 2-3px
  if (y < lip) return shade(GRASS_GREEN, pick(rand, [0.8, 0.9, 1.0]));
  return dirt(x, y, rand);
}
function stone(x, y, rand) {
  const f = pick(rand, [0.85, 0.92, 1.0, 1.0, 1.06]);
  return shade(STONE_GRAY, f);
}
function logTop(x, y, rand) {
  const dx = x - 7.5, dy = y - 7.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  const ring = Math.floor(r) % 2 === 0 ? 1.0 : 0.78;
  return shade([160, 128, 74], ring * (0.95 + rand() * 0.1));
}
function logSide(x, y, rand) {
  const stripe = x % 4 === 0 ? 0.7 : x % 4 === 2 ? 1.05 : 0.9;
  return shade([104, 82, 49], stripe * (0.92 + rand() * 0.16));
}
function leaves(x, y, rand) {
  const r = rand();
  if (r > 0.86) return [0, 0, 0, 0]; // see-through holes (alphaTest)
  return shade([58, 122, 44], pick(rand, [0.7, 0.85, 1.0, 1.15]));
}
function sand(x, y, rand) {
  return shade([219, 207, 160], pick(rand, [0.9, 0.96, 1.0, 1.05]));
}
function gravel(x, y, rand) {
  const f = pick(rand, [0.7, 0.82, 0.95, 1.05, 1.12]);
  return shade([136, 126, 120], f);
}
function planks(x, y, rand) {
  const board = y % 4 === 0 ? 0.68 : 1.0; // horizontal seams
  const grain = (x * 7 + y * 3) % 11 === 0 ? 0.85 : 1.0;
  return shade([176, 143, 87], board * grain * (0.95 + rand() * 0.08));
}
function stoneBrick(x, y, rand) {
  const my = y % 8 === 7;
  const row = Math.floor(y / 8);
  const mx = (x + (row % 2 ? 4 : 0)) % 8 === 7;
  if (mx || my) return shade([70, 70, 70], 0.95 + rand() * 0.1); // mortar
  return shade([130, 130, 130], pick(rand, [0.88, 0.95, 1.0, 1.05]));
}
function glass(x, y, rand) {
  const frame = x === 0 || y === 0 || x === 15 || y === 15;
  if (frame) return [200, 220, 228, 255];
  if (x + y === 18 || x + y === 19) return [235, 245, 250, 255]; // streak
  return [0, 0, 0, 0]; // transparent pane
}
function oreIn(base) {
  return (x, y, rand) => {
    // clustered ore blobs on stone
    const cx = ((x & 12) + 2), cy = ((y & 12) + 2);
    const inBlob = Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1 && rand() > 0.45;
    if (inBlob) return shade(base, 0.9 + rand() * 0.25);
    return stone(x, y, rand);
  };
}
function bedrock(x, y, rand) {
  return shade([70, 70, 70], pick(rand, [0.5, 0.75, 1.0, 1.25]));
}
function water(x, y, rand) {
  const wave = (y + Math.floor(x / 4)) % 5 === 0 ? 1.2 : 1.0;
  return shade([52, 95, 218], wave * (0.92 + rand() * 0.12));
}

function cobble(x, y, rand) {
  // rounded stone lumps on darker joints
  const lump = ((x >> 2) * 5 + (y >> 2) * 3) % 4;
  const edge = x % 4 === 0 || y % 4 === 0;
  if (edge) return shade([90, 90, 90], 0.9 + rand() * 0.15);
  return shade([120 + lump * 8, 120 + lump * 8, 120 + lump * 8], 0.9 + rand() * 0.18);
}
function brick(x, y, rand) {
  const my = y % 4 === 3;
  const row = Math.floor(y / 4);
  const mx = (x + (row % 2 ? 4 : 0)) % 8 === 7;
  if (mx || my) return shade([190, 180, 170], 0.92 + rand() * 0.12); // mortar
  return shade([158, 66, 48], pick(rand, [0.88, 0.95, 1.0, 1.06]));
}
function snow(x, y, rand) {
  return shade([240, 246, 250], pick(rand, [0.94, 0.97, 1.0]));
}
function ice(x, y, rand) {
  const streak = (x + y * 2) % 7 === 0 ? 1.12 : 1.0;
  return shade([160, 205, 235], streak * (0.92 + rand() * 0.1));
}
function obsidian(x, y, rand) {
  const fleck = rand() > 0.9;
  if (fleck) return shade([90, 60, 130], 1.0);
  return shade([28, 22, 40], 0.85 + rand() * 0.3);
}
function plastic(base) {
  return (x, y, rand) => {
    // Roblox-style stud: raised circle, light from top-left
    const dx = x - 7.5, dy = y - 7.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    let f = 1.0;
    if (r < 4.5) f = dx + dy < 0 ? 1.25 : 0.85;      // stud highlight/shadow
    else if (r < 5.5) f = 0.75;                       // stud rim
    if (x === 0 || y === 0) f *= 1.12;                // top/left bevel
    if (x === 15 || y === 15) f *= 0.8;               // bottom/right bevel
    return shade(base, f * (0.98 + rand() * 0.04));
  };
}

function tntSide(x, y, rand) {
  if (y >= 5 && y <= 10) {
    // white band with dark TNT letters
    const letter = (y >= 6 && y <= 9) && (x % 5 === 1 || (x % 5 === 2 && (y === 6 || y === 9)));
    return letter ? [40, 30, 30, 255] : shade([235, 230, 220], 0.95 + rand() * 0.08);
  }
  return shade([200, 48, 40], pick(rand, [0.85, 0.95, 1.0, 1.05]));
}
function tntTop(x, y, rand) {
  const cx = Math.abs(x - 7.5), cy = Math.abs(y - 7.5);
  if (cx < 2 && cy < 2) return shade([80, 70, 60], 0.9 + rand() * 0.2); // fuse
  return shade([200, 48, 40], pick(rand, [0.88, 0.96, 1.04]));
}

// tile key 'col,row' -> painter, matching BLOCK_DEFS UV coords
const TILE_PAINTERS = {
  '0,0':  grassTop,
  '1,0':  grassSide,
  '2,0':  dirt,
  '3,0':  stone,
  '4,0':  logTop,
  '5,0':  logSide,
  '6,0':  leaves,
  '7,0':  sand,
  '8,0':  gravel,
  '9,0':  planks,
  '10,0': stoneBrick,
  '11,0': glass,
  '12,0': oreIn([28, 28, 28]),   // coal
  '13,0': oreIn([196, 160, 120]),// iron
  '14,0': bedrock,
  '15,0': water,
  '0,1':  cobble,
  '1,1':  brick,
  '2,1':  snow,
  '3,1':  ice,
  '4,1':  oreIn([235, 190, 52]), // gold
  '5,1':  oreIn([92, 220, 230]), // diamond
  '6,1':  obsidian,
  '7,1':  plastic([214, 45, 48]),  // red
  '8,1':  plastic([13, 105, 208]), // blue
  '9,1':  plastic([245, 205, 48]), // yellow
  '10,1': plastic([76, 175, 80]),  // green
  '11,1': tntSide,
  '12,1': tntTop,
};

let _canvas = null;

export function getAtlasCanvas() {
  if (_canvas) return _canvas;
  _canvas = document.createElement('canvas');
  _canvas.width = SIZE;
  _canvas.height = SIZE;
  const ctx = _canvas.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);

  for (const [key, paint] of Object.entries(TILE_PAINTERS)) {
    const [col, row] = key.split(',').map(Number);
    const rand = mulberry32(ATLAS_SEED + col * 31 + row * 7);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b, a] = paint(x, y, rand);
        const i = (y * TILE + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, col * TILE, row * TILE);
  }
  return _canvas;
}

// 32x32 pixelated crop of one tile, for hotbar slot backgrounds
export function tileDataURL(col, row) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(getAtlasCanvas(), col * TILE, row * TILE, TILE, TILE, 0, 0, 32, 32);
  return c.toDataURL();
}

export function buildAtlas() {
  const texture = new THREE.CanvasTexture(getAtlasCanvas());
  texture.flipY = false; // canvas y=0 is top; with flipY=true UV v=0 maps to canvas bottom (empty)
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
