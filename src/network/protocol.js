import { validCreatureState, CREATURE_ACTIONS } from '../game/creature-state.js';
import { STORY_STAGES, validStory } from '../game/story.js';
import { ITEM_IDS, RECIPES, validSupplies } from '../game/camp.js';

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const MAX_PLAYERS = 8;
export const WORLD_VERSION = 2;
export const INTERPOLATION_DELAY_MS = 100;

export function normalizeRoomCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function isRoomCode(value) {
  const code = normalizeRoomCode(value);
  return code.length === ROOM_CODE_LENGTH && [...code].every((char) => ROOM_ALPHABET.includes(char));
}

export function createRoomCode(random = crypto) {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  random.getRandomValues(bytes);
  return [...bytes].map((byte) => ROOM_ALPHABET[byte & 31]).join('');
}

export function roomSeed(roomCode, worldVersion = WORLD_VERSION) {
  const code = normalizeRoomCode(roomCode);
  if (!isRoomCode(code)) throw new TypeError('Invalid room code');
  let hash = 2166136261;
  for (const char of `${worldVersion}:${code}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function electHost(members) {
  return [...members]
    .filter((member) => typeof member?.playerId === 'string')
    .sort((a, b) => (Number(a.joinOrder) - Number(b.joinOrder)) || a.playerId.localeCompare(b.playerId))[0] ?? null;
}

export function presenceMembers(state) {
  const members = Object.values(state).flat().filter((member) => (
    typeof member?.playerId === 'string' && Number.isFinite(Number(member.joinOrder))
  ));
  return [...new Map(members.map((member) => [member.playerId, {
    playerId: member.playerId,
    joinOrder: Number(member.joinOrder),
  }])).values()];
}

export function admissionDecision(members, reservations, playerId, maxPlayers = MAX_PLAYERS, ownerId) {
  const occupied = new Set(members.map((member) => member.playerId));
  for (const id of reservations.keys()) occupied.add(id);
  if (ownerId) occupied.add(ownerId);
  return occupied.has(playerId) || occupied.size < maxPlayers
    ? { ok: true }
    : { ok: false, reason: 'Room is full' };
}

function lerpAngle(a = 0, b = 0, t) {
  const delta = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + delta * t;
}

export function interpolateSamples(samples, targetAt) {
  if (!samples?.length) return null;
  let next = samples.findIndex((sample) => sample.at >= targetAt);
  if (next <= 0) return { ...samples[next < 0 ? samples.length - 1 : 0], position: [...samples[next < 0 ? samples.length - 1 : 0].position] };
  const a = samples[next - 1];
  const b = samples[next];
  const t = Math.max(0, Math.min(1, (targetAt - a.at) / Math.max(1, b.at - a.at)));
  return {
    at: targetAt,
    position: a.position.map((value, index) => value + (b.position[index] - value) * t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * t,
  };
}

export function validRoomDescriptor({ seed, mode, generation = 1 } = {}) {
  return Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff
    && ['expedition', 'creative'].includes(mode) && [1, 2, 3].includes(generation);
}

export function validateMutationIntent(intent, context) {
  if (!intent || typeof intent.intentId !== 'string' || intent.intentId.length < 1 || intent.intentId.length > 160) {
    return { ok: false, reason: 'Invalid intent id' };
  }
  if (intent.epoch !== context.epoch) return { ok: false, reason: 'Stale epoch' };
  if (context.seenIntentIds.has(intent.intentId)) return { ok: false, reason: 'Duplicate intent' };
  if (intent.kind === 'creature') {
    if (!CREATURE_ACTIONS.includes(intent.action)) return { ok: false, reason: 'Unknown creature action' };
    if (intent.targetId !== undefined && (typeof intent.targetId !== 'string' || intent.targetId.length > 100)) return { ok: false, reason: 'Invalid creature target' };
  } else if (intent.kind === 'story') {
    if (!STORY_STAGES.some(({ npcId }) => npcId === intent.targetId)) return { ok: false, reason: 'Unknown character' };
  } else if (intent.kind === 'craft') {
    if (!RECIPES.some(({ id }) => id === intent.recipeId)) return { ok: false, reason: 'Unknown recipe' };
  } else {
    if (intent.kind !== undefined && intent.kind !== 'block') return { ok: false, reason: 'Unknown action' };
    if (![intent.x, intent.y, intent.z, intent.blockId].every(Number.isInteger)) {
      return { ok: false, reason: 'Coordinates and block id must be integers' };
    }
    if (intent.y < 0 || intent.y >= context.worldHeight) return { ok: false, reason: 'Outside world height' };
    if (!context.allowedBlockIds.has(intent.blockId)) return { ok: false, reason: 'Block id is not allowed' };
    const position = Array.isArray(context.playerPosition)
      ? context.playerPosition
      : [context.playerPosition?.x, context.playerPosition?.y, context.playerPosition?.z];
    if (position.length !== 3 || !position.every(Number.isFinite)) return { ok: false, reason: 'Player position is unavailable' };
    const distanceSquared = (intent.x + 0.5 - position[0]) ** 2
      + (intent.y + 0.5 - (position[1] + 1.6)) ** 2
      + (intent.z + 0.5 - position[2]) ** 2;
    if (distanceSquared > (context.maxDistance ?? 6) ** 2) return { ok: false, reason: 'Block is out of reach' };
  }
  const now = context.now ?? Date.now();
  const recent = context.mutationTimes.filter((time) => time > now - 1000);
  if (recent.length >= (context.maxMutationsPerSecond ?? 12)) return { ok: false, reason: 'Mutation rate exceeded' };
  return { ok: true, mutationTimes: [...recent, now] };
}

export const MAX_SNAPSHOT_ENTRIES = 20000;
export const MAX_INTENT_IDS = 100000;
const allowedBlocks = new Set([0, ...ITEM_IDS]);
function validTreeRemoval(commit) {
  if (commit.treeBlocks === undefined) return true;
  if (commit.blockId !== 0 || !Array.isArray(commit.treeBlocks) || commit.treeBlocks.length > 1024) return false;
  const keys = new Set([`${commit.x},${commit.y},${commit.z}`]);
  return commit.treeBlocks.every((block) => {
    if (!block || ![block.x, block.y, block.z].every(Number.isInteger) || block.blockId !== 0
      || block.y < 0 || block.y >= 64 || Math.abs(block.x - commit.x) > 16
      || Math.abs(block.z - commit.z) > 16) return false;
    const key = `${block.x},${block.y},${block.z}`;
    if (keys.has(key)) return false;
    keys.add(key); return true;
  });
}
function validCommit(commit) {
  if (!commit || !Number.isSafeInteger(commit.epoch) || commit.epoch <= 0
    || !Number.isSafeInteger(commit.seq) || commit.seq <= 0
    || typeof commit.intentId !== 'string' || !commit.intentId.length || commit.intentId.length > 160
    || (commit.supplies !== undefined && !validSupplies(commit.supplies))
    || (commit.story !== undefined && !validStory(commit.story))) return false;
  if (commit.kind === 'creature') return CREATURE_ACTIONS.includes(commit.action) && validCreatureState(commit.creatures) && validSupplies(commit.supplies)
    && !['x', 'y', 'z', 'blockId', 'treeBlocks'].some(key => key in commit);
  if (commit.kind === 'story') return STORY_STAGES.some(({ npcId }) => npcId === commit.targetId)
    && validStory(commit.story) && validSupplies(commit.supplies)
    && !['x', 'y', 'z', 'blockId'].some((key) => key in commit);
  if (commit.kind === 'craft') return RECIPES.some(({ id }) => id === commit.recipeId)
    && validSupplies(commit.supplies) && !['x', 'y', 'z', 'blockId'].some((key) => key in commit);
  return (commit.kind === undefined || commit.kind === 'block')
    && [commit.x, commit.y, commit.z, commit.blockId].every(Number.isInteger)
    && Math.abs(commit.x) <= 1000000 && Math.abs(commit.z) <= 1000000
    && commit.y >= 0 && commit.y < 64 && allowedBlocks.has(commit.blockId) && validTreeRemoval(commit);
}

export function validateSnapshot(snapshot) {
  if (!snapshot || !Number.isSafeInteger(snapshot.epoch) || snapshot.epoch < 1
    || !Number.isSafeInteger(snapshot.lastSeq) || snapshot.lastSeq < 0
    || (snapshot.creatures !== undefined && !validCreatureState(snapshot.creatures))
    || !validSupplies(snapshot.supplies) || (snapshot.story !== undefined && !validStory(snapshot.story))
    || (snapshot.generation !== undefined && ![1, 2, 3].includes(snapshot.generation)) || !Array.isArray(snapshot.entries)
    || snapshot.entries.length > MAX_SNAPSHOT_ENTRIES || !Array.isArray(snapshot.intentIds)
    || snapshot.intentIds.length > MAX_INTENT_IDS) return false;
  const coordinates = new Set();
  for (const entry of snapshot.entries) {
    if (!validCommit(entry) || entry.treeBlocks !== undefined || (entry.kind && entry.kind !== 'block') || entry.epoch > snapshot.epoch
      || (entry.epoch === snapshot.epoch && entry.seq > snapshot.lastSeq)) return false;
    const key = `${entry.x},${entry.y},${entry.z}`;
    if (coordinates.has(key)) return false;
    coordinates.add(key);
  }
  return snapshot.intentIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 160)
    && new Set(snapshot.intentIds).size === snapshot.intentIds.length;
}

export class MutationLedger {
  constructor(onApply = () => {}) {
    this.epoch = 0;
    this.lastSeq = 0;
    this.overrides = new Map();
    this.supplies = {};
    this.creatures = undefined;
    this.story = { stage: 0 };
    this.generation = 1;
    this.seenIntentIds = new Set();
    this._onApply = onApply;
  }

  startEpoch(epoch) {
    if (!Number.isInteger(epoch) || epoch <= this.epoch) return false;
    this.epoch = epoch;
    this.lastSeq = 0;
    return true;
  }

  apply(commit) {
    if (!validCommit(commit) || commit.epoch < this.epoch || this.seenIntentIds.has(commit.intentId)) return false;
    const { treeBlocks = [], ...primary } = commit;
    const blocks = (!commit.kind || commit.kind === 'block')
      ? [primary, ...treeBlocks.map(({ x, y, z }) => ({ ...primary, x, y, z, blockId: 0 }))] : [];
    if (this.overrides.size + blocks.filter(block => !this.overrides.has(`${block.x},${block.y},${block.z}`)).length > MAX_SNAPSHOT_ENTRIES) return false;
    if (commit.epoch > this.epoch) {
      if (commit.seq !== 1) return false;
      this.epoch = commit.epoch;
      this.lastSeq = 0;
    }
    if (commit.seq !== this.lastSeq + 1) return false;
    this.lastSeq = commit.seq;
    this.seenIntentIds.add(commit.intentId);
    if (commit.supplies) this.supplies = { ...commit.supplies };
    if (commit.creatures) this.creatures = structuredClone(commit.creatures);
    if (commit.story) this.story = { ...commit.story };
    for (const block of blocks) this.overrides.set(`${block.x},${block.y},${block.z}`, block);
    if (blocks.length) blocks.forEach((block, index) => this._onApply(index ? { ...block, treeFall: true } : block));
    else this._onApply(commit);
    return true;
  }

  snapshot() {
    return {
      epoch: this.epoch,
      lastSeq: this.lastSeq,
      supplies: { ...this.supplies },
      ...(this.creatures ? { creatures: structuredClone(this.creatures) } : {}),
      story: { ...this.story }, generation: this.generation,
      entries: [...this.overrides.values()].map(({ supplies, story, ...entry }) => ({ ...entry })),
      intentIds: [...this.seenIntentIds],
    };
  }

  loadSnapshot(snapshot) {
    if (!validateSnapshot(snapshot) || snapshot.epoch < this.epoch
      || (snapshot.epoch === this.epoch && snapshot.lastSeq < this.lastSeq)) return false;
    this.epoch = snapshot.epoch;
    this.lastSeq = snapshot.lastSeq;
    this.overrides.clear();
    this.supplies = { ...snapshot.supplies };
    this.creatures = snapshot.creatures ? structuredClone(snapshot.creatures) : undefined;
    this.story = { ...(snapshot.story ?? { stage: 0 }) };
    this.generation = snapshot.generation ?? 1;
    this.seenIntentIds = new Set(snapshot.intentIds.filter((id) => typeof id === 'string'));
    for (const entry of snapshot.entries) {
      this.overrides.set(`${entry.x},${entry.y},${entry.z}`, { ...entry });
      this._onApply(entry);
    }
    return true;
  }
}
