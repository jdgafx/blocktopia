import { BLOCK_DEFS, BLOCKS } from '../constants/blocks.js';

// Padded snapshots keep worker meshing independent of world mutation/generation.
export function snapshotChunk(chunk, world, shared = false) {
  const width = 16, height = 64, depth = 16;
  const data = new Uint8Array(shared ? new SharedArrayBuffer(18 * 66 * 18) : new ArrayBuffer(18 * 66 * 18));
  for (let z = -1; z <= depth; z++) for (let x = -1; x <= width; x++) {
    const wx = chunk.cx * width + x, wz = chunk.cz * depth + z;
    for (let y = 0; y < height; y++) {
      let id;
      if (x >= 0 && x < width && z >= 0 && z < depth) {
        const index = chunk._idx(x, y, z);
        id = chunk.naturalBlocks?.has(index) || chunk.buildingBlocks?.has(index) ? 0 : chunk.data[index];
      } else {
        id = world.getBlock(wx, y, wz);
        if (id && (world.getNaturalTree?.(wx, y, wz) || world.getBuildingParts?.(wx, y, wz))) id = 0;
      }
      data[(x + 1) + 18 * ((y + 1) + 66 * (z + 1))] = id;
    }
  }
  return { data, cx: chunk.cx, cz: chunk.cz, width, height, depth };
}

export function meshChunkData({ data, cx, cz, width, height, depth }) {
  const size = [width, height, depth], strideY = width + 2, strideZ = strideY * (height + 2);
  const strides=[1,strideY,strideZ];
  const occluders=new Uint8Array(data.length);
  for(let i=0;i<data.length;i++)occluders[i]=BLOCK_DEFS[data[i]]?.solid&&!BLOCK_DEFS[data[i]].transparent?1:0;
  const positions = [], normals = [], uv = [], colors = [], ao = [], wetness = [], groups = [], indices = [], materialIndices = Array.from({ length: 16 }, () => []);
  let quads = 0, exposedFaces = 0;
  // Order preserves the existing top/bottom/side material contract.
  for (const [d, sign] of [[1,1],[1,-1],[0,1],[0,-1],[2,1],[2,-1]]) {
    const u = (d + 1) % 3, v = (d + 2) % 3, mask = new Array(size[u] * size[v]);
    for (let slice = 0; slice < size[d]; slice++) {
      for (let j = 0; j < size[v]; j++) for (let i = 0; i < size[u]; i++) {
        const at=i+j*size[u];mask[at]=null;
        const x=d===0?slice:u===0?i:j,y=d===1?slice:u===1?i:j,z=d===2?slice:u===2?i:j;
        const index=x+1+strideY*(y+1)+strideZ*(z+1),id=data[index],def=BLOCK_DEFS[id];
        if(!def||(!def.solid&&id!==BLOCKS.WATER))continue;
        const neighborIndex=index+sign*strides[d],neighbor=data[neighborIndex];
        if(neighbor===id&&(def.transparent||id===BLOCKS.WATER))continue;
        if(occluders[neighborIndex])continue;
        const tile=def[d===1?sign>0?'top':'bot':'side']??[3,3],material=tile[0]+tile[1]*4;
        const levels=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([su,sv])=>{
          const a=occluders[neighborIndex+su*strides[u]],b=occluders[neighborIndex+sv*strides[v]];
          return a&&b?0:3-a-b-occluders[neighborIndex+su*strides[u]+sv*strides[v]];
        });
        const wet=id===BLOCKS.WATER||data[index-1]===14||data[index+1]===14||data[index-strideY]===14||data[index+strideY]===14||data[index-strideZ]===14||data[index+strideZ]===14?1:0;
        const uniform = levels.every(value => value === levels[0]);
        mask[at] = { material, levels, key: `${material}:${levels.join('')}:${wet}`, wet, merge: uniform };
        exposedFaces++;
      }
      for (let j = 0; j < size[v]; j++) for (let i = 0; i < size[u];) {
        const cell = mask[i + j * size[u]];
        if (!cell) { i++; continue; }
        let w = 1, h = 1;
        if (cell.merge) {
          while (i + w < size[u] && mask[i + w + j * size[u]]?.key === cell.key) w++;
          outer: while (j + h < size[v]) {
            for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * size[u]]?.key !== cell.key) break outer;
            h++;
          }
        }
        const base = positions.length / 3, normal = [0,0,0]; normal[d] = sign;
        // u cross v points along +d. Reverse for negative-facing quads.
        const corners = sign > 0 ? [[0,0],[w,0],[w,h],[0,h]] : [[0,0],[0,h],[w,h],[w,0]];
        const order = sign > 0 ? [0,1,2,3] : [0,3,2,1];
        corners.forEach(([du,dv], c) => {
          const p = [0,0,0]; p[d] = slice + (sign > 0 ? 1 : 0); p[u] = i + du; p[v] = j + dv;
          positions.push(p[0] + cx * width, p[1], p[2] + cz * depth); normals.push(...normal);
          // World-aligned UVs keep texture density constant after greedy merging.
          uv.push(d === 1 ? p[0] : d === 0 ? p[2] : p[0], d === 1 ? p[2] : p[1]);
          const level = cell.levels[order[c]], shade = .52 + level * .16;
          ao.push(level); wetness.push(cell.wet); colors.push(shade, shade, shade);
        });
        const out = materialIndices[cell.material];
        if (cell.levels[0] + cell.levels[2] > cell.levels[1] + cell.levels[3]) out.push(base,base+1,base+3,base+1,base+2,base+3);
        else out.push(base,base+1,base+2,base,base+2,base+3);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[i+x+(j+y)*size[u]] = null;
        quads++; i += w;
      }
    }
  }
  materialIndices.forEach((values, materialIndex) => {
    if (!values.length) return;
    groups.push({ start: indices.length, count: values.length, materialIndex });
    for (const value of values) indices.push(value);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uv: new Float32Array(uv), colors: new Float32Array(colors), ao: new Uint8Array(ao), wetness:new Float32Array(wetness), indices: new Uint32Array(indices), groups, quads, exposedFaces };
}
