// BTV1 sparse 16³ chunk: uint16 local voxel index, uint8 block, then ledger metadata.
// Untouched voxels stay in deterministic terrain; an explicit AIR byte preserves mining.
const SIZE = 16, MAX_ENTRIES = 20000;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const bad = () => new TypeError('Invalid binary world chunk.');

export function encodeChunks(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw bad();
  const groups = new Map(), seen = new Set();
  entries.forEach(({ x, y, z, blockId, ...metadata }, order) => {
    if (![x,y,z,blockId].every(Number.isInteger) || Math.abs(x) > 1000000 || Math.abs(z) > 1000000
      || y < 0 || y >= 64 || blockId < 0 || blockId > 254 || seen.has(`${x},${y},${z}`)) throw bad();
    seen.add(`${x},${y},${z}`);
    const chunk_x = Math.floor(x / SIZE), chunk_y = Math.floor(y / SIZE), chunk_z = Math.floor(z / SIZE);
    const key = `${chunk_x},${chunk_y},${chunk_z}`;
    if (!groups.has(key)) groups.set(key, { chunk_x, chunk_y, chunk_z, records: [] });
    const index = (x - chunk_x * SIZE) + SIZE * ((z - chunk_z * SIZE) + SIZE * (y - chunk_y * SIZE));
    const raw = encoder.encode(JSON.stringify(metadata));
    if (raw.length > 65535) throw bad();
    groups.get(key).records.push({ index, blockId, order, raw });
  });
  return [...groups.values()].map(({ records, ...coords }) => {
    const bytes = new Uint8Array(6 + records.reduce((n,r) => n + 9 + r.raw.length, 0));
    const view = new DataView(bytes.buffer); bytes.set([66,84,86,1]); view.setUint16(4, records.length);
    let offset = 6;
    for (const r of records) {
      view.setUint16(offset, r.index); view.setUint8(offset + 2, r.blockId);
      view.setUint32(offset + 3, r.order); view.setUint16(offset + 7, r.raw.length);
      bytes.set(r.raw, offset + 9); offset += 9 + r.raw.length;
    }
    return { ...coords, voxel_data: '\\x' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') };
  });
}

export function decodeChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length > MAX_ENTRIES) throw bad();
  const entries = [], seenChunks = new Set(), orders = new Set();
  for (const { chunk_x: cx, chunk_y: cy, chunk_z: cz, voxel_data: hex } of chunks) {
    const key = `${cx},${cy},${cz}`;
    if (![cx,cy,cz].every(Number.isInteger) || cy < 0 || cy > 3 || Math.abs(cx)>62500 || Math.abs(cz)>62500
      || seenChunks.has(key) || typeof hex !== 'string' || !/^\\x(?:[0-9a-f]{2})+$/i.test(hex) || hex.length > 4194306) throw bad();
    seenChunks.add(key);
    const bytes = Uint8Array.from(hex.slice(2).match(/../g), b => parseInt(b,16));
    if (bytes.length < 6 || ![66,84,86,1].every((b,i) => bytes[i] === b)) throw bad();
    const view = new DataView(bytes.buffer), count = view.getUint16(4), seen = new Set();
    if (!count || count > 4096 || entries.length + count > MAX_ENTRIES) throw bad();
    let offset = 6;
    for (let i = 0; i < count; i++) {
      if (offset + 9 > bytes.length) throw bad();
      const index = view.getUint16(offset), blockId = view.getUint8(offset + 2);
      const order = view.getUint32(offset + 3), length = view.getUint16(offset + 7);
      if (index >= 4096 || seen.has(index) || orders.has(order) || order >= MAX_ENTRIES || blockId === 255 || offset + 9 + length > bytes.length) throw bad();
      seen.add(index); orders.add(order);
      const metadata = JSON.parse(decoder.decode(bytes.subarray(offset + 9, offset + 9 + length)));
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw bad();
      const x = cx * SIZE + index % SIZE, z = cz * SIZE + Math.floor(index / SIZE) % SIZE, y = cy * SIZE + Math.floor(index / 256);
      if (Math.abs(x)>1000000 || Math.abs(z)>1000000) throw bad();
      entries.push({ order, value: { ...metadata, x, y, z, blockId } }); offset += 9 + length;
    }
    if (offset !== bytes.length) throw bad();
  }
  entries.sort((a,b) => a.order-b.order);
  if (entries.some((entry,i) => entry.order !== i)) throw bad();
  return entries.map(entry => entry.value);
}
