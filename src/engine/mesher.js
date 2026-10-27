import * as THREE from 'three';
import { meshChunkData, snapshotChunk } from './mesh-data.js';

export function geometryFromMesh(data) {
  const geo = new THREE.BufferGeometry();
  for (const [name, values, size] of [['position',data.positions,3],['normal',data.normals,3],['uv',data.uv,2],['color',data.colors,3],['voxelAO',data.ao,1],['wetness',data.wetness,1],['tile',data.tiles,1]]) geo.setAttribute(name, new THREE.BufferAttribute(values,size));
  geo.setIndex(new THREE.BufferAttribute(data.indices,1));
  // Draw buckets: 0 all opaque tiles, 1 glass, 2 water (see Renderer's chunk material list).
  for (const g of data.groups) {
    const bucket = g.materialIndex === 11 ? 1 : g.materialIndex === 15 ? 2 : 0, last = geo.groups.at(-1);
    if (last?.materialIndex === bucket) last.count += g.count; else geo.addGroup(g.start,g.count,bucket);
  }
  geo._posCount = data.positions.length / 3;
  geo.userData = { quads: data.quads, exposedFaces: data.exposedFaces };
  geo.computeBoundingSphere();
  return geo;
}
export function buildChunkMesh(chunk, world) { return geometryFromMesh(meshChunkData(snapshotChunk(chunk,world))); }
