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
    const { data, error } = await this.client.from('saved_expeditions')
      .insert({ ...fields(input, true), user_id: this.userId }).select().single();
    if (error) throw databaseError(error);
    return data;
  }

  async load(id) {
    validId(id);
    const { data, error } = await this.client.from('saved_expeditions').select()
      .eq('id', id).eq('user_id', this.userId).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new Error('This saved expedition is no longer available.');
    fields(data, true);
    return data;
  }

  async save(id, revision, input) {
    validId(id); validRevision(revision);
    const { data, error } = await this.client.from('saved_expeditions').update(fields(input))
      .eq('id', id).eq('user_id', this.userId).eq('revision', revision).select().maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new SaveConflictError();
    return data;
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
