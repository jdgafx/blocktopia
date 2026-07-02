import * as THREE from 'three';
import { BLOCK_DEFS, BLOCKS } from '../constants/blocks.js';
import { CHUNK_W, CHUNK_H, CHUNK_D } from './world.js';

const ATLAS_COLS = 16;
const TEX = 1 / ATLAS_COLS;

// uv: per-corner [cu, cv] tile offsets; cv=0 is the tile's TOP image row
// (flipY=false), so side faces map block-top -> tile-top (cv = 1 - cornerY).
const FACES = [
  { dir:[0,1,0],  norm:[0,1,0],  uvKey:'top',  shade: 1.0,
    corners:[[0,1,0],[1,1,0],[1,1,1],[0,1,1]],
    uv:[[0,0],[1,0],[1,1],[0,1]] },
  { dir:[0,-1,0], norm:[0,-1,0], uvKey:'bot',  shade: 0.55,
    corners:[[0,0,1],[1,0,1],[1,0,0],[0,0,0]],
    uv:[[0,1],[1,1],[1,0],[0,0]] },
  { dir:[1,0,0],  norm:[1,0,0],  uvKey:'side', shade: 0.75,
    corners:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
    uv:[[0,1],[0,0],[1,0],[1,1]] },
  { dir:[-1,0,0], norm:[-1,0,0], uvKey:'side', shade: 0.75,
    corners:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
    uv:[[1,1],[1,0],[0,0],[0,1]] },
  { dir:[0,0,1],  norm:[0,0,1],  uvKey:'side', shade: 0.88,
    corners:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]],
    uv:[[1,1],[1,0],[0,0],[0,1]] },
  { dir:[0,0,-1], norm:[0,0,-1], uvKey:'side', shade: 0.88,
    corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
    uv:[[0,1],[0,0],[1,0],[1,1]] },
];

// Precompute tangent axes per face (the two axes perpendicular to the normal)
for (const f of FACES) {
  const n = f.dir.findIndex(v => v !== 0);
  f.axisN = n;
  f.axisU = (n + 1) % 3;
  f.axisV = (n + 2) % 3;
}

function isOccluder(id) {
  const def = BLOCK_DEFS[id];
  return !!(def && def.solid && !def.transparent);
}

// Classic 3-neighbor vertex AO: 0 (open) .. 3 (fully cornered)
const AO_LEVELS = [1.0, 0.82, 0.68, 0.55];

function vertexAO(world, air, face, corner) {
  const du = corner[face.axisU] === 1 ? 1 : -1;
  const dv = corner[face.axisV] === 1 ? 1 : -1;
  const s1 = [...air]; s1[face.axisU] += du;
  const s2 = [...air]; s2[face.axisV] += dv;
  const c  = [...air]; c[face.axisU] += du; c[face.axisV] += dv;
  const side1 = isOccluder(world.getBlock(s1[0], s1[1], s1[2])) ? 1 : 0;
  const side2 = isOccluder(world.getBlock(s2[0], s2[1], s2[2])) ? 1 : 0;
  const corn  = isOccluder(world.getBlock(c[0], c[1], c[2])) ? 1 : 0;
  const occ = side1 && side2 ? 3 : side1 + side2 + corn;
  return AO_LEVELS[occ];
}

const UV_EPS = TEX / 32; // half-texel inset stops atlas bleed at tile edges

function pushFace(buf, face, wx, y, wz, tile, brightness) {
  const u0 = tile[0] * TEX;
  const v0 = tile[1] * TEX;
  const base = buf.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    const [cx, cy, cz] = face.corners[i];
    buf.positions.push(wx + cx, y + cy, wz + cz);
    buf.normals.push(...face.norm);
    const b = brightness[i];
    buf.colors.push(b, b, b);
    const [cu, cv] = face.uv[i];
    buf.uvs.push(
      u0 + (cu ? TEX - UV_EPS : UV_EPS),
      v0 + (cv ? TEX - UV_EPS : UV_EPS),
    );
  }
  buf.indices.push(base, base+1, base+2, base, base+2, base+3);
}

function toGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(buf.normals, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(buf.colors, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(buf.uvs, 2));
  geo.setIndex(new THREE.Uint32BufferAttribute(buf.indices, 1));
  geo._posCount = buf.positions.length / 3;
  return geo;
}

export function buildChunkMesh(chunk, world) {
  const solid = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const water = { positions: [], normals: [], colors: [], uvs: [], indices: [] };

  const ox = chunk.cx * CHUNK_W;
  const oz = chunk.cz * CHUNK_D;

  for (let y = 0; y < CHUNK_H; y++) {
    for (let z = 0; z < CHUNK_D; z++) {
      for (let x = 0; x < CHUNK_W; x++) {
        const id = chunk.getBlock(x, y, z);
        if (id === BLOCKS.AIR) continue;
        const def = BLOCK_DEFS[id];
        if (!def) continue;

        const wx = ox + x;
        const wz = oz + z;

        if (id === BLOCKS.WATER) {
          for (const face of FACES) {
            const neighbor = world.getBlock(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
            if (neighbor !== BLOCKS.AIR) continue; // only water<->air surfaces
            const s = face.shade;
            pushFace(water, face, wx, y, wz, def[face.uvKey], [s, s, s, s]);
          }
          continue;
        }

        if (!def.solid) continue;

        for (const face of FACES) {
          const air = [wx + face.dir[0], y + face.dir[1], wz + face.dir[2]];
          const neighbor = world.getBlock(air[0], air[1], air[2]);
          const nDef = BLOCK_DEFS[neighbor];
          if (nDef && nDef.solid && !nDef.transparent) continue;
          if (neighbor === id && def.transparent) continue; // glass/leaves against itself

          const brightness = [];
          for (let i = 0; i < 4; i++) {
            brightness.push(face.shade * vertexAO(world, air, face, face.corners[i]));
          }
          pushFace(solid, face, wx, y, wz, def[face.uvKey] ?? [0, 0], brightness);
        }
      }
    }
  }

  const geo = toGeometry(solid);
  geo.water = water.positions.length > 0 ? toGeometry(water) : null;
  return geo;
}
