import * as THREE from 'three';
import { BLOCK_DEFS, BLOCKS } from '../constants/blocks.js';
import { CHUNK_W, CHUNK_H, CHUNK_D } from './world.js';

const FACES = [
  { dir:[0,1,0],  norm:[0,1,0],  uvKey:'top',
    corners:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { dir:[0,-1,0], norm:[0,-1,0], uvKey:'bot',
    corners:[[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
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
  const materialIndices = Array.from({ length: 16 }, () => []);

  const ox = chunk.cx * CHUNK_W;
  const oz = chunk.cz * CHUNK_D;

  for (let y = 0; y < CHUNK_H; y++) {
    for (let z = 0; z < CHUNK_D; z++) {
      for (let x = 0; x < CHUNK_W; x++) {
        const id = chunk.getBlock(x, y, z);
        if (id === BLOCKS.AIR) continue;
        if (chunk.naturalBlocks?.has(chunk._idx(x, y, z)) || chunk.buildingBlocks?.has(chunk._idx(x, y, z))) continue;
        const def = BLOCK_DEFS[id];
        if (!def || !def.solid) continue;

        for (const face of FACES) {
          const nx = ox + x + face.dir[0];
          const ny =      y + face.dir[1];
          const nz = oz + z + face.dir[2];
          const neighbor = world.getBlock(nx, ny, nz);
          const nDef = BLOCK_DEFS[neighbor];
          if (nDef && nDef.solid && !nDef.transparent && !world.getNaturalTree?.(nx, ny, nz) && !world.getBuildingParts?.(nx, ny, nz)) continue;
          if (neighbor === id && def.transparent) continue;

          const tile = def[face.uvKey] ?? [0, 0];
          const indices = materialIndices[tile[1] * 4 + tile[0]];

          const base = positions.length / 3;
          for (const [cx, cy, cz] of face.corners) {
            positions.push(ox + x + cx, y + cy, oz + z + cz);
            normals.push(...face.norm);
          }
          // Independent repeating textures: full UV range, with grain upright on walls.
          uvs.push(...(face.uvKey === 'side' ? [1,0, 1,1, 0,1, 0,0] : [0,0, 0,1, 1,1, 1,0]));
          indices.push(base, base+1, base+2, base, base+2, base+3);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  const indices = [];
  materialIndices.forEach((faces, materialIndex) => {
    if (!faces.length) return;
    geo.addGroup(indices.length, faces.length, materialIndex);
    for (const index of faces) indices.push(index);
  });
  geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  geo._posCount = positions.length / 3;
  return geo;
}
