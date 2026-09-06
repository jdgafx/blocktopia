import { VoxelBroadcast } from './voxel-broadcast.js';
import { raycast } from '../engine/raycast.js';
import { creatureAction, initialCreatureState, validCreatureState } from '../game/creature-state.js';
import { stepCreatures } from '../game/creature-simulation.js';
import { validateMutationIntent, MAX_INTENT_IDS } from './protocol.js';

const STEP_SECONDS = .2;
const TABLE = 'blocktopia_room_actors';

// Room peer IDs are ephemeral. Database RLS binds them to the signed-in account
// without disclosing a player's bearer token to another browser.
export class CreatureSession {
  constructor(session, world, actorId) {
    this.session = session; this.world = world; this.actorId = actorId;
    this.actors = new Map(); this.elapsed = 0; this.identityAt = 0;
    this.resyncAt = 0; this.ready = false; this.pendingIdentity = false; this.disposed = false;
    this.readyPromise = this.register();
  }
  async register() {
    const s = this.session;
    const { data: existing, error: readError } = await s.supabase.from(TABLE).select('user_id')
      .eq('room_code', s.roomCode).eq('peer_id', s.playerId).maybeSingle();
    if (readError) throw new Error('Creature ownership is unavailable. Apply the creature room identity migration.');
    if (existing && existing.user_id !== this.actorId) throw new Error('This room identity belongs to another account. Rejoin in a new tab.');
    if (!existing) {
      const { error } = await s.supabase.from(TABLE).insert({ room_code: s.roomCode, peer_id: s.playerId, user_id: this.actorId });
      if (error) throw new Error('Could not register creature ownership. Rejoin to retry.');
    }
    if (this.disposed) return;
    this.actors.set(s.playerId, this.actorId); this.ready = true;
    await this.resolveActors();
    if (!this.disposed) {
      s.voxelBroadcast?.close();
      s.voxelBroadcast = new VoxelBroadcast(s);
    }
  }
  async resolveActors() {
    if (this.pendingIdentity || this.disposed) return;
    const s = this.session;
    const ids = [...new Set([s.playerId, ...s.members.map(m => m.playerId)])];
    this.pendingIdentity = true;
    try {
      const { data, error } = await s.supabase.rpc('blocktopia_room_identities', { room: s.roomCode, peers: ids.slice(0,8) });
      if (error || !Array.isArray(data)) throw new Error('Creature identities could not synchronize. Check the creature identity migration and reconnect.');
      if (!this.disposed) this.actors = new Map(data.map(row => [row.peer_id, row.user_id]));
    } finally { this.pendingIdentity = false; }
  }
  canReach(from, to) {
    const origin = { x: from.x, y: from.y + 1, z: from.z };
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    return distance < .1 || !raycast(this.world, origin, { x: dx / distance, y: dy / distance, z: dz / distance }, Math.max(0, distance - .3));
  }
  players() {
    const s = this.session, result = new Map();
    for (const peerId of [s.playerId, ...s.members.map(m => m.playerId)]) {
      const id = this.actors.get(peerId);
      const local = peerId === s.playerId;
      const sample = local ? s.options.getLocalState?.() : s.remoteStates.get(peerId);
      if (!id || !sample?.position || (!local && performance.now() - sample.at > 5000)) continue;
      if (!result.has(id)) result.set(id, { id, position: { x: sample.position[0], y: sample.position[1], z: sample.position[2] }, active: local ? s.options.isPlaying?.() !== false : sample.active !== false });
    }
    return [...result.values()];
  }
  tick(dt) {
    const s = this.session;
    if (!this.ready || !s.ready || !s.snapshotReady || this.disposed) return;
    this.elapsed += dt; this.identityAt += dt;
    if (this.identityAt > 2) { this.identityAt = 0; this.resolveActors().catch(() => {}); }
    if (s.role !== 'host' || this.elapsed < STEP_SECONDS) return;
    const elapsed = Math.min(this.elapsed, .5); this.elapsed = 0;
    const before = s.ledger.creatures ?? initialCreatureState(s.seed);
    const state = stepCreatures(before, { players: this.players(), dt: elapsed, now: Date.now(),
      canReach: (from,to) => this.canReach(from,to),
      surfaceHeight: (x,z) => this.world.surfaceHeight(Math.floor(x),Math.floor(z)),
      isSolid: (x,y,z) => this.world.isSolid(Math.floor(x),Math.floor(y),Math.floor(z)),
      getBlock: (x,y,z) => this.world.getBlock(Math.floor(x),Math.floor(y),Math.floor(z)),
    });
    state.revision = before.revision + 1;
    if (!validCreatureState(state)) return;
    s.ledger.creatures = state;
    const updates = Object.fromEntries(Object.entries(state.creatures).filter(([id, c]) => JSON.stringify(c) !== JSON.stringify(before.creatures[id])));
    const removed = Object.keys(before.creatures).filter(id => !state.creatures[id]);
    s.transport.broadcastControl({ t: 'creatures', epoch: s.epoch, baseSeq: s.ledger.lastSeq, previousRevision: before.revision,
      revision: state.revision, seed: state.seed, lastStepAt: state.lastStepAt, updates, removed, players: Object.fromEntries(Object.entries(state.players).filter(([id,p]) => JSON.stringify(p) !== JSON.stringify(before.players[id]))) });
    s.options.onCreatures?.();
  }
  receive(from, message) {
    const s = this.session;
    if (message?.t === 'creatures-resync') {
      if (s.role === 'host' && s.members.some(m => m.playerId === from) && Date.now() - this.resyncAt > 1000) {
        this.resyncAt = Date.now(); s._sendSnapshot({ send: raw => s.transport.sendControl(from, JSON.parse(raw)) });
      }
      return true;
    }
    if (message?.t !== 'creatures') return false;
    if (s.role === 'guest' && from === s.hostId && s.ready && s.snapshotReady && message.epoch === s.epoch
      && message.previousRevision !== (s.ledger.creatures?.revision ?? 0) && Date.now() - this.resyncAt > 1000) {
      this.resyncAt = Date.now(); s.transport.sendControl(s.hostId, { t: 'creatures-resync' });
    }
    if (s.role !== 'guest' || from !== s.hostId || !s.ready || !s.snapshotReady
      || message.epoch !== s.epoch || message.baseSeq !== s.ledger.lastSeq
      || message.previousRevision !== (s.ledger.creatures?.revision ?? 0)
      || !Number.isSafeInteger(message.revision) || message.revision <= message.previousRevision
      || !message.updates || typeof message.updates !== 'object' || Array.isArray(message.updates)
      || !Array.isArray(message.removed) || message.removed.length > 256) return true;
    const state = { version: 1, seed: message.seed, revision: message.revision, lastStepAt: message.lastStepAt,
      creatures: { ...s.ledger.creatures?.creatures, ...message.updates }, players: { ...s.ledger.creatures?.players, ...message.players } };
    for (const id of message.removed) { if (typeof id !== 'string') return true; delete state.creatures[id]; }
    if (!validCreatureState(state)) return true;
    s.ledger.creatures = state; s.options.onCreatures?.(); return true;
  }
  handle(from, intent) {
    const s = this.session;
    const reject = reason => {
      if (from === s.playerId) s.options.onRejected?.(reason);
      else s.transport.sendControl(from, { t: 'intent-rejected', reason });
      return false;
    };
    if (!this.ready || !s.ready || !s.snapshotReady) return reject('Creature interactions are still connecting');
    const actorId = this.actors.get(from);
    if (!actorId) { this.resolveActors().catch(() => {}); return reject('Verifying your creature ownership. Try again shortly.'); }
    const coordinates = from === s.playerId ? s.options.getLocalState?.()?.position : s.remoteStates.get(from)?.position;
    const position = coordinates && { x: coordinates[0], y: coordinates[1], z: coordinates[2] };
    if (s.ledger.seenIntentIds.size >= MAX_INTENT_IDS) return reject('This expedition has reached its action limit');
    const check = validateMutationIntent(intent, { epoch: s.epoch, seenIntentIds: s.ledger.seenIntentIds,
      playerPosition: position, mutationTimes: s.mutationTimes.get(from) ?? [] });
    if (!check.ok) return reject(check.reason);
    const before = s.ledger.creatures ?? initialCreatureState(s.seed);
    const action = creatureAction(before, s.ledger.supplies, intent, { actorId, position, now: Date.now(), tool: 'axe',
      canReach: (from,to) => this.canReach(from,to),
      surfaceHeight: (x,z) => this.world.surfaceHeight(Math.floor(x),Math.floor(z)),
      getBlock: (x,y,z) => this.world.getBlock(Math.floor(x),Math.floor(y),Math.floor(z)),
      isSolid: (x,y,z) => this.world.isSolid(Math.floor(x),Math.floor(y),Math.floor(z)),
    });
    if (!action.ok) return reject(action.reason);
    action.state.revision = before.revision + 1;
    const commit = { kind: 'creature', epoch: s.epoch, seq: s.ledger.lastSeq + 1, intentId: intent.intentId,
      creatures: action.state, supplies: action.supplies, action: intent.action };
    if (!s.ledger.apply(commit)) return reject('Creature action could not be saved');
    s.mutationTimes.set(from, check.mutationTimes);
    s.options.onSupplies?.(s.ledger.supplies);
    const message = { t: 'commit', commit };
    if (JSON.stringify(message).length < 48000) s.transport.broadcastControl(message);
    else for (const member of s.members) if (member.playerId !== s.playerId) s._sendSnapshot({ send: raw => s.transport.sendControl(member.playerId, JSON.parse(raw)) });
    return true;
  }
  dispose() { this.disposed = true; }
}
