import { expect, it } from 'vitest';
import { encodeChunks, decodeChunks } from '../src/network/chunk-codec.js';

it('round trips sparse binary terrain including mined air, negative boundaries and ledger metadata', () => {
  const entries = [-1000000,-17,-16,-1,0,15,16,1000000].map((x,i) => ({ x,y:i*8,z:-x || 0,blockId:i%2?14:0,
    epoch:3,seq:i+1,intentId:`player:${i}`, ...(i%2 ? { kind:'block' } : {}) }));
  const chunks = encodeChunks(entries);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every(c => c.voxel_data.startsWith('\\x42545601'))).toBe(true);
  expect(decodeChunks(chunks.reverse())).toEqual(entries);
  expect(decodeChunks(encodeChunks([]))).toEqual([]);
  expect(() => encodeChunks([...entries, entries[0]])).toThrow();
  expect(() => decodeChunks([...chunks, chunks[0]])).toThrow();
  expect(() => decodeChunks([{...chunks[0],voxel_data:chunks[0].voxel_data.slice(0,-2)}])).toThrow();
  expect(() => decodeChunks([{...chunks[0],voxel_data:chunks[0].voxel_data+'00'}])).toThrow();
  expect(() => decodeChunks([{...chunks[0],voxel_data:'\\x00000000'}])).toThrow();
});
