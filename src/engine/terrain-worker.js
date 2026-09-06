import { World } from './world.js';
import { meshChunkData } from './mesh-data.js';

self.onmessage = ({ data: { id, type, payload } }) => {
  try {
    const start = performance.now();
    let result;
    if (type === 'mesh') result = meshChunkData(payload);
    else if (type === 'generate') {
      const world = new World(payload.seed,payload.generation);
      world.edits = new Map(payload.edits.map(([key, edits]) => [key,new Map(edits)]));
      // Generate a halo for collision, vegetation and AO without synchronous main-thread generation.
      for (let z = payload.cz-1; z <= payload.cz+1; z++) for (let x = payload.cx-1; x <= payload.cx+1; x++) world.getChunk(x,z);
      result = [...world.chunks.values()].map(c => ({cx:c.cx,cz:c.cz,data:c.data,naturalBlocks:c.naturalBlocks,buildingBlocks:c.buildingBlocks,trees:c.trees}));
    } else throw new Error('Unknown terrain worker operation');
    const buffers = type === 'mesh' ? [result.positions,result.normals,result.uv,result.colors,result.ao,result.wetness,result.indices].map(a=>a.buffer) : result.map(c=>c.data.buffer);
    self.postMessage({ id, result, milliseconds: performance.now()-start },buffers);
  } catch (error) { self.postMessage({id,error:error.message}); }
};
