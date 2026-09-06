import {it,expect} from 'vitest';
import {Chunk,World} from '../src/engine/world.js';
import {snapshotChunk,meshChunkData} from '../src/engine/mesh-data.js';
import {AutoQuality} from '../src/engine/auto-quality.js';
it('greedily collapses a solid cuboid without changing its surface area or density',()=>{
 const c=new Chunk(0,0);for(let x=2;x<10;x++)for(let y=2;y<10;y++)for(let z=2;z<10;z++)c.setBlock(x,y,z,3);
 const w={getBlock:()=>0};const m=meshChunkData(snapshotChunk(c,w));
 expect(m.quads).toBe(6);expect(m.exposedFaces).toBe(384);expect(m.indices.length).toBe(36);
 expect(Math.max(...m.uv)-Math.min(...m.uv)).toBe(8);expect([...m.ao].every(v=>v===3)).toBe(true);
});
it('occludes concave corners and marks surfaces adjoining actual water',()=>{
 const c=new Chunk(0,0);c.setBlock(3,3,3,3);c.setBlock(4,4,3,3);c.setBlock(3,3,4,14);
 const m=meshChunkData(snapshotChunk(c,{getBlock:()=>0}));
 expect(Math.min(...m.ao)).toBeLessThan(3);expect(Math.max(...m.wetness)).toBe(1);expect(m.groups.some(g=>g.materialIndex===15)).toBe(true);
});
it('keeps cross-chunk opaque neighbours hidden and supports shared snapshots',()=>{
 const w=new World(1);w.getBlock=(x,y,z)=>y===3&&z===3&&x===16?3:0;
 const c=new Chunk(0,0);c.setBlock(15,3,3,3);
 const snapshot=snapshotChunk(c,w,true);expect(snapshot.data.buffer).toBeInstanceOf(SharedArrayBuffer);
 expect(meshChunkData(snapshot).quads).toBe(5);
});
it('adapts sustained frame pressure with hysteresis and honors manual mode',()=>{
 const q=new AutoQuality({cores:8,memory:8});let changes=[];
 for(let i=0;i<400;i++){const v=q.sample(.05);if(v)changes.push(v);}
 expect(changes).toEqual(['low']);q.enabled=false;
 for(let i=0;i<6000;i++)expect(q.sample(.01)).toBeNull();
 q.enabled=true;for(let i=0;i<6000;i++)q.sample(.01);expect(q.level).toBe(2);
});

it('downgrades severe foreground stalls but ignores hidden or paused frames',()=>{
 const q=new AutoQuality({cores:8,memory:8});
 for(let i=0;i<40;i++)q.sample(1,false);expect(q.level).toBe(1);
 for(let i=0;i<40;i++)q.sample(1,true);expect(q.level).toBe(0);
});
