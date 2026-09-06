import * as THREE from 'three';
import { meshChunkData, snapshotChunk } from './mesh-data.js';

export function geometryFromMesh(data) {
  const geo = new THREE.BufferGeometry();
  for (const [name, values, size] of [['position',data.positions,3],['normal',data.normals,3],['uv',data.uv,2],['color',data.colors,3],['voxelAO',data.ao,1],['wetness',data.wetness,1]]) geo.setAttribute(name, new THREE.BufferAttribute(values,size));
  geo.setIndex(new THREE.BufferAttribute(data.indices,1));
  data.groups.forEach(g => geo.addGroup(g.start,g.count,g.materialIndex));
  geo._posCount = data.positions.length / 3;
  geo.userData = { quads: data.quads, exposedFaces: data.exposedFaces };
  geo.computeBoundingSphere();
  return geo;
}
export function buildChunkMesh(chunk, world) { return geometryFromMesh(meshChunkData(snapshotChunk(chunk,world))); }
