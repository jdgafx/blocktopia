import { encodeChunks, decodeChunks } from '../network/chunk-codec.js';
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;
const METADATA = 'id,user_id,name,seed,mode,revision,updated_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SaveConflictError extends Error {
  constructor() {
    super('This expedition changed in another tab or was deleted. Reload your saves before saving again.');
    this.name = 'SaveConflictError';
    this.code = 'SAVE_CONFLICT';
  }
}

function validId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('Invalid expedition or account ID.');
}

function validRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Invalid save revision.');
}

function fields({ name, seed, mode, snapshot } = {}, requireName = false) {
  if ((requireName || name !== undefined)
    && (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 48)) {
    throw new TypeError('Name your expedition using 1–48 characters.');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Invalid world seed.');
  if (!['creative', 'expedition'].includes(mode)) throw new TypeError('Invalid world mode.');
  if (!snapshot || !Number.isSafeInteger(snapshot.epoch) || snapshot.epoch < 0
    || !Number.isSafeInteger(snapshot.lastSeq) || snapshot.lastSeq < 0
    || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.intentIds)
    || !snapshot.supplies || typeof snapshot.supplies !== 'object' || Array.isArray(snapshot.supplies)) {
    throw new TypeError('Invalid expedition snapshot.');
  }
  let serialized;
  try { serialized = JSON.stringify(snapshot); } catch { throw new TypeError('Invalid expedition snapshot.'); }
  if (new TextEncoder().encode(serialized).length > MAX_SAVE_BYTES) {
    throw new RangeError('This expedition exceeds the 2 MB save limit.');
  }
  return { ...(name === undefined ? {} : { name: name.trim() }), seed, mode, snapshot: JSON.parse(serialized) };
}

function databaseError(error) {
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return new Error('Saved expeditions are not configured on this server yet.');
  }
  return new Error(error.message || 'Could not reach your saved expeditions. Try again.', { cause: error });
}

export class ExpeditionSaves {
  constructor(client, userId) {
    validId(userId);
    this.client = client;
    this.userId = userId;
  }

  async list() {
    const { data, error } = await this.client.from('saved_expeditions').select(METADATA)
      .eq('user_id', this.userId).order('updated_at', { ascending: false });
    if (error) throw databaseError(error);
    return data;
  }

  async create(input) {
    return this._write(null, null, fields(input, true));
  }

  async load(id) {
    validId(id);
    // One SQL statement reads the metadata and blobs from the same MVCC snapshot.
    const { data, error } = await this.client.rpc('load_binary_expedition', { expedition_id: id });
    if (error) throw databaseError(error);
    if (!data) throw new Error('This saved expedition is no longer available.');
    const { chunks, ...row } = data;
    if (row.snapshot.chunkFormat === 'BTV1') {
      const { chunkFormat, chunkCount, entryCount, ...snapshot } = row.snapshot;
      const entries = decodeChunks(chunks);
      if (chunks.length !== chunkCount || entries.length !== entryCount) throw new Error('Saved terrain is incomplete. Keep your open world and retry.');
      row.snapshot = { ...snapshot, entries };
    }
    fields(row, true);
    return row;
  }

  async save(id, revision, input) {
    validId(id); validRevision(revision);
    return this._write(id, revision, fields(input));
  }

  async _write(id, revision, input) {
    const chunks = encodeChunks(input.snapshot.entries);
    const { data, error } = await this.client.rpc('save_binary_expedition', {
      expedition_id: id, expected_revision: revision, expedition_name: input.name ?? null,
      world_seed: input.seed, world_mode: input.mode,
      world_snapshot: { ...input.snapshot, entries: [], chunkFormat: 'BTV1', chunkCount: chunks.length, entryCount: input.snapshot.entries.length }, chunks,
    });
    if (error) throw databaseError(error);
    if (!data) throw new SaveConflictError();
    // The transaction returns metadata; preserve the exact captured live snapshot.
    return { ...data, snapshot: input.snapshot };
  }

  async remove(id, revision) {
    validId(id); validRevision(revision);
    const { data, error } = await this.client.from('saved_expeditions').delete()
      .eq('id', id).eq('user_id', this.userId).eq('revision', revision).select(METADATA).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new SaveConflictError();
    return data;
  }
}
