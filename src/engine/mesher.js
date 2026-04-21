import * as THREE from 'three';
import { BLOCK_DEFS, BLOCKS } from '../constants/blocks.js';
import { CHUNK_W, CHUNK_H, CHUNK_D } from './world.js';

const ATLAS_COLS = 16;
const TEX = 1 / ATLAS_COLS;

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
  geo._posCount = positions.length / 3;
  return geo;
}
