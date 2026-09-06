import { createClient } from '@supabase/supabase-js';
import {
  MutationLedger, WORLD_VERSION, admissionDecision, createRoomCode, electHost,
  isRoomCode, normalizeRoomCode, presenceMembers, roomSeed, validRoomDescriptor, validateSnapshot,
} from './protocol.js';
import { handleIntent, receiveSnapshot, sendSnapshot } from './session-gameplay.js';
import { WebRTCStar } from './peer.js';
import { AdmissionControl, stablePlayerId } from './admission.js';
import { connectRoomChannel, pauseRoomSignal, recoverRoomChannel, sendRoomMessage } from './room-channel.js';

const ADMISSION_RETRY_MS = 9100;
const ADMISSION_TIMEOUT_MS = 16500;
const MOVEMENT_INTERVAL_MS = 1000 / 15;

export class MultiplayerSession {
  constructor(options = {}) {
    this.options = options;
    const env = import.meta.env;
    const url = env.VITE_SUPABASE_URL;
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
    this.configurationError = !url || !key
      ? 'Multiplayer is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
      : '';
    this.supabase = null;
    if (!this.configurationError) {
      try {
        this.supabase = createClient(url, key);
      } catch {
        this.configurationError = 'Multiplayer configuration is invalid. Check the Supabase URL and publishable key.';
      }
    }
    this.playerId = stablePlayerId();
    this.roomCode = '';
    this.seed = 0; this.mode = 'expedition'; this.generation = 3;
    this.initialSnapshot = null;
    this.snapshotReady = false; this.pendingCommits = [];
    this.role = '';
    this.hostId = '';
    this.epoch = 0;
    this.joinOrder = -1;
    this.members = [];
    this.reservations = new Map();
    this.memberOrders = new Map();
    this.remoteStates = new Map();
    this.mutationTimes = new Map();
    this.snapshotParts = new Map();
    this.tracked = false;
    this.channelHealthy = false;
    this.channelGeneration = 0;
    this.channelRecoveryAttempts = 0;
    this.channelRecoveryInFlight = false;
    this.channelRecoveryTimer = null;
    this.channelRetirement = null;
    this.admitting = false;
    this.ready = false;
    this.pausedSignal = null;
    this.admissionId = '';
    this.intentCounter = 0; this.runToken = crypto.randomUUID();
    this.icePath = 'connecting';
    this.ledger = new MutationLedger((commit) => this.options.applyMutation?.(commit));
    this._timers = new Set();
    this.admissions = new AdmissionControl((response) => this._broadcast('admission-response', response));
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (env.VITE_TURN_URL) {
      iceServers.push({
        urls: env.VITE_TURN_URL,
        username: env.VITE_TURN_USERNAME || '',
        credential: env.VITE_TURN_CREDENTIAL || '',
      });
    }
    this.transport = new WebRTCStar({
      iceServers,
      role: () => this.role,
      hostId: () => this.hostId,
      expectedPeers: () => this.role === 'host' ? this.members.filter(({ playerId }) => playerId !== this.playerId).map(({ playerId }) => playerId)
        : this.hostId ? [this.hostId] : [],
      signal: (to, payload) => this._signal(to, payload),
      timer: (fn, delay) => this._timer(fn, delay),
      onMovement: (from, message) => this._onMovement(from, message),
      onControl: (from, message) => this._onControl(from, message),
      onControlOpen: (_id, channel) => {
        if (this.role === 'host') this._sendSnapshot(channel);
      },
      onPath: (path) => {
        this.icePath = path;
        if (this.ready) this._status('ready', path === 'connecting' ? 'Establishing peer links...' : 'All peer connections ready.');
      },
      onFailure: (id, attempt) => this._peerFailed(id, attempt),
      onSignalPaused: (id, attempt) => this._pauseSignal(id, attempt),
      onPeerLeft: (id) => this.options.onPeerLeft?.(id),
    });
  }
  createRoom({ seed, mode = 'expedition', snapshot, generation = snapshot ? (snapshot.generation ?? 1) : 3 } = {}) {
    const code = createRoomCode();
    const descriptor = { seed: seed ?? roomSeed(code), mode, generation };
    if (!validRoomDescriptor(descriptor) || (snapshot !== undefined && (!validateSnapshot(snapshot) || (snapshot.generation ?? 1) !== generation))) {
      this._status('invalid-world', 'This saved world is invalid and could not be opened.');
      return Promise.resolve(false);
    }
    return this._open(code, true, { ...descriptor, snapshot });
  }
  joinRoom(value) {
    const code = normalizeRoomCode(value);
    if (!isRoomCode(code)) {
      this._status('invalid-room', 'Enter a valid six-character room code.');
      return Promise.resolve(false);
    }
    return this._open(code, false);
  }
  async _open(code, creating, descriptor = {}) {
    if (this.opening) return false;
    this.opening = true;
    try { return await this._openRoom(code, creating, descriptor); }
    finally { this.opening = false; }
  }
  async _openRoom(code, creating, descriptor) {
    if (this.configurationError) {
      this._status('config-missing', this.configurationError);
      return false;
    }
    this._status('connecting', creating ? 'Creating room...' : 'Looking for the room host...');
    await this._leaveRoom();
    this.ledger = new MutationLedger((commit) => this.options.applyMutation?.(commit));
    this.remoteStates.clear(); this.mutationTimes.clear(); this.snapshotParts.clear();
    this.initialSnapshot = descriptor.snapshot ?? null;
    this.snapshotReady = false; this.pendingCommits = [];
    this.seed = creating ? (descriptor.seed ?? roomSeed(code)) : 0;
    this.mode = creating ? (descriptor.mode ?? 'expedition') : 'expedition';
    this.ledger.generation = this.generation = creating ? (descriptor.generation ?? 3) : 1;
    this.admissionId = crypto.randomUUID();
    this.roomCode = code;
    this.role = creating ? 'host' : 'guest';
    this.hostId = creating ? this.playerId : '';
    this.epoch = creating ? (this.initialSnapshot?.epoch ?? 1) : 0;
    this.joinOrder = creating ? 0 : -1;
    if (creating) this.ledger.startEpoch(this.epoch);
    this.members = [];
    this.reservations.clear();
    this.memberOrders.clear();
    const subscribed = await connectRoomChannel(this);
    if (!subscribed) {
      this._status('connection-error', 'Could not connect to the room service.');
      return false;
    }
    if (creating) {
      this.memberOrders.set(this.playerId, 0);
      await this._trackMembership();
      this._markReady();
      this._startHostAnnouncements();
    } else {
      this._requestAdmission();
    }
    return true;
  }
  async _resumeChannel(generation) {
    if (generation !== this.channelGeneration) return;
    if (!this.ready) {
      if (this.role === 'guest' && this.admissionId) this._requestAdmission();
      return;
    }
    this.tracked = false;
    try { await this._trackMembership(); } catch {
      recoverRoomChannel(this, generation);
      return;
    }
    if (generation !== this.channelGeneration) return;
    if (this.role === 'host') {
      this._startHostAnnouncements();
      for (const member of this.members) if (member.playerId !== this.playerId) this.transport.ensureGuest(member.playerId);
    } else if (this.pausedSignal?.id === this.hostId) {
      await this._pauseSignal(this.hostId, this.pausedSignal.attempt);
      if (!this.channelHealthy) return;
    }
    this._status('ready', 'Room service reconnected.');
  }
  _requestAdmission() {
    const admissionId = this.admissionId;
    if (!admissionId) return;
    this._clearAdmissionTimers();
    const request = () => {
      if (this.ready || !this.channel || this.admissionId !== admissionId) return;
      this._broadcast('admission-request', {
        roomCode: this.roomCode,
        playerId: this.playerId,
        admissionId,
        worldVersion: WORLD_VERSION,
      });
    };
    request();
    this.admissionRetry = this._timer(request, ADMISSION_RETRY_MS);
    this.admissionTimeout = this._timer(() => {
      if (this.ready || this.admitting || this.admissionId !== admissionId) return;
      this.admissionId = '';
      this._clearAdmissionTimers();
      this._status(this.channelHealthy ? 'not-found' : 'connection-error', this.channelHealthy
        ? 'Room not found. Check the code and try again.'
        : 'Room service connection was interrupted. Try again.');
    }, ADMISSION_TIMEOUT_MS);
  }
  _onAdmissionRequest(payload) {
    if (this.role !== 'host' || !this.ready || payload?.roomCode !== this.roomCode
      || payload?.worldVersion !== WORLD_VERSION || typeof payload?.playerId !== 'string'
      || typeof payload?.admissionId !== 'string' || payload.admissionId.length < 8
      || payload.admissionId.length > 128) return;
    const now = Date.now();
    for (const [id, reservation] of this.reservations) {
      if (reservation.expires <= now) this.reservations.delete(id);
    }
    const ticket = this.admissions.ticket(payload.playerId, payload.admissionId, (_created, expires) => {
      const base = { to: payload.playerId, admissionId: payload.admissionId, worldVersion: WORLD_VERSION };
      const decision = admissionDecision(this.members, this.reservations, payload.playerId, undefined, this.playerId);
      if (!decision.ok) return { ...base, ok: false, reason: decision.reason };
      if (this.members.some((member) => member.playerId === payload.playerId)
        && !this.reservations.has(payload.playerId)) this.transport.closePeer(payload.playerId);
      let joinOrder = this.memberOrders.get(payload.playerId) ?? this.reservations.get(payload.playerId)?.joinOrder;
      if (!Number.isFinite(joinOrder)) {
        joinOrder = Math.max(0, ...this.memberOrders.values()) + 1;
        this.memberOrders.set(payload.playerId, joinOrder);
      }
      this.reservations.set(payload.playerId, { joinOrder, expires });
      return { ...base, ok: true, hostId: this.playerId, epoch: this.epoch, joinOrder, seed: this.seed, mode: this.mode, generation: this.generation };
    });
    this.admissions.respond(ticket);
  }
  async _onAdmissionResponse(payload) {
    if (this.role !== 'guest' || this.ready || this.admitting || payload?.to !== this.playerId
      || payload?.admissionId !== this.admissionId) return;
    if (!payload.ok) {
      this.admissionId = '';
      this._clearAdmissionTimers();
      this._status('full', payload.reason || 'Room is full.');
      return;
    }
    if (payload.worldVersion !== WORLD_VERSION || !validRoomDescriptor(payload)
      || !Number.isSafeInteger(payload.epoch) || payload.epoch < 1
      || !Number.isFinite(Number(payload.joinOrder)) || typeof payload.hostId !== 'string') return;
    this.admitting = true;
    this._clearAdmissionTimers();
    this.hostId = payload.hostId;
    this.seed = payload.seed; this.mode = payload.mode;
    this.ledger.generation = this.generation = payload.generation ?? 1;
    this.epoch = payload.epoch;
    this.joinOrder = Number(payload.joinOrder);
    this.ledger.startEpoch(this.epoch);
    try {
      await this._trackMembership();
      this.admissionId = '';
      this._markReady();
    } catch {
      this._status('connection-error', 'Could not register room membership. Try again.');
    } finally {
      this.admitting = false;
    }
  }
  async _trackMembership() {
    if (this.tracked) return;
    const result = await this.channel.track({
      playerId: this.playerId,
      joinOrder: this.joinOrder,
      worldVersion: WORLD_VERSION,
    });
    if (result !== 'ok') throw new Error('Presence membership failed');
    this.tracked = true;
  }
  _markReady() {
    this.options.onReady?.({
      roomCode: this.roomCode,
      seed: this.seed,
      mode: this.mode, generation: this.generation,
      role: this.role,
    });
    if (this.initialSnapshot) {
      this.ledger.loadSnapshot(this.initialSnapshot);
      this.initialSnapshot = null;
      this.snapshotReady = true;
      this.options.onSupplies?.(this.ledger.supplies);
    }
    if (this.role === 'host') this.snapshotReady = true;
    this.ready = true;
    for (const commit of this.pendingCommits) this.ledger.apply(commit);
    this.pendingCommits = [];
    if (this.snapshotReady) this.options.onSnapshot?.();
    this._status('ready', 'Room ready.');
    this._timer(() => this._sendMovement(), MOVEMENT_INTERVAL_MS, true);
  }
  _onPresenceSync() {
    if (!this.channel) return;
    this.members = presenceMembers(this.channel.presenceState());
    for (const member of this.members) this.memberOrders.set(member.playerId, member.joinOrder);
    this.options.onPlayers?.(this.members);
    if (!this.ready) return;
    this.transport.refreshPath();
    if (this.role === 'host') {
      for (const member of this.members) {
        if (member.playerId !== this.playerId) {
          this.reservations.delete(member.playerId);
          this.transport.ensureGuest(member.playerId);
        }
      }
      for (const id of this.transport.peers.keys()) {
        if (!this.members.some((member) => member.playerId === id)) this.transport.closePeer(id);
      }
      return;
    }
    if (this.hostId && !this.members.some((member) => member.playerId === this.hostId)) {
      const elected = electHost(this.members);
      if (elected?.playerId === this.playerId) this._becomeHost();
      else if (elected) this._selectHost(elected.playerId, this.epoch + 1);
    }
  }
  _becomeHost() {
    this.role = 'host'; this.icePath = 'connecting';
    this.hostId = this.playerId;
    this.epoch = Math.max(this.epoch, this.ledger.epoch) + 1;
    this.ledger.startEpoch(this.epoch);
    this.admissions.clear();
    this.transport.closeAll();
    this._startHostAnnouncements();
    for (const member of this.members) {
      if (member.playerId !== this.playerId) this.transport.ensureGuest(member.playerId);
    }
    this._status('ready', 'Host recovered.');
  }
  _announceHost() {
    if (this.role === 'host' && this.ready) this._broadcast('host-announcement', { hostId: this.playerId, epoch: this.epoch });
  }
  _startHostAnnouncements() {
    clearInterval(this.hostAnnouncementInterval);
    this._timers.delete(this.hostAnnouncementInterval);
    this._announceHost();
    this.hostAnnouncementInterval = this._timer(() => this._announceHost(), 2000, true);
  }

  _onHostAnnouncement(payload) {
    if (!this.ready || typeof payload?.hostId !== 'string' || !Number.isInteger(payload.epoch)) return;
    const elected = electHost(this.members);
    if (payload.epoch < this.epoch || (elected && elected.playerId !== payload.hostId)) return;
    if (payload.hostId !== this.playerId) this._selectHost(payload.hostId, payload.epoch);
  }

  _selectHost(hostId, epoch) {
    const changed = this.hostId !== hostId || this.role !== 'guest' || this.epoch !== epoch;
    this.role = 'guest';
    this.hostId = hostId;
    this.epoch = epoch;
    this.ledger.startEpoch(epoch);
    if (changed) { this.icePath = 'connecting'; this.admissions.clear(); this.transport.closeAll(); this._signal(hostId, { kind: 'restart' }); }
    this._status('ready', 'Host connected.');
  }

  _onSignal(payload) {
    if ((!this.ready && !this.admitting) || payload?.to !== this.playerId || typeof payload?.from !== 'string'
      || payload.epoch !== this.epoch) return;
    this.transport.handleSignal(payload);
  }

  _sendMovement() {
    if (!this.ready) return;
    const local = this.options.getLocalState?.();
    if (!local || !Array.isArray(local.position) || !local.position.every(Number.isFinite)) return;
    const message = JSON.stringify({ t: 'movement', id: this.playerId, position: local.position, yaw: local.yaw, pitch: local.pitch, active: this.options.isPlaying?.() !== false });
    this.transport.sendMovement(message);
  }

  _onMovement(from, message) {
    if (message?.t !== 'movement' || !Array.isArray(message.position) || message.position.length !== 3
      || !message.position.every(Number.isFinite) || !Number.isFinite(message.yaw) || !Number.isFinite(message.pitch)) return;
    const id = this.role === 'host' ? from : message.id;
    if (typeof id !== 'string' || id === this.playerId) return;
    const sample = { at: performance.now(), position: [...message.position], yaw: message.yaw, pitch: message.pitch, active: message.active !== false };
    this.remoteStates.set(id, sample);
    this.options.onMovement?.(id, sample);
    if (this.role === 'host') {
      const relayed = JSON.stringify({ ...message, id });
      this.transport.relayMovement(from, relayed);
    }
  }

  submitStory(targetId) { return this.submitMutation({ kind: 'story', targetId }); }
  submitCraft(recipeId) { return this.submitMutation({ kind: 'craft', recipeId }); }

  submitMutation(mutation) {
    if (!this.ready) return false;
    if (!this.snapshotReady) {
      this.options.onRejected?.('Waiting for the host to synchronize the world');
      return false;
    }
    const intent = {
      ...mutation,
      kind: mutation.kind ?? 'block',
      epoch: this.epoch,
      intentId: `${this.playerId}:${this.runToken}:${this.epoch}:${++this.intentCounter}`,
    };
    if (this.role === 'host') return this._handleIntent(this.playerId, intent);
    if (!this.transport.sendControl(this.hostId, { t: 'intent', intent })) {
      this.options.onRejected?.('Peer connection is not ready. Try again in a moment.');
      this._status('rtc-failure', 'Peer connection is not ready. Action was not applied.');
      return false;
    }
    return true;
  }

  _onControl(from, message) {
    if (!message) return;
    if (this.creatureSystem?.receive(from, message)) return;
    if (this.role === 'host' && message.t === 'intent') {
      this._handleIntent(from, message.intent);
    } else if (this.role === 'guest' && from === this.hostId) {
      if (message.t === 'commit') {
        if (!this.ready) { if (this.pendingCommits.length < 1000) this.pendingCommits.push(message.commit); }
        else if (this.ledger.apply(message.commit)) this.options.onSupplies?.(this.ledger.supplies);
      }
      if (message.t === 'snapshot') this._receiveSnapshot(message);
      if (message.t === 'intent-rejected' && typeof message.reason === 'string') this.options.onRejected?.(message.reason);
    }
  }

  _handleIntent(from, intent) { return handleIntent(this, from, intent); }
  _sendSnapshot(channel) { return sendSnapshot(this, channel); }
  _receiveSnapshot(message) { return receiveSnapshot(this, message); }

  _peerFailed(id, attempt) {
    this.icePath = 'connecting'; this._status('rtc-failure', 'Peer connection failed. Retrying...');
    this._timer(() => {
      if (!this.ready) return;
      let launched = this.role === 'host' && this.members.some((member) => member.playerId === id) && this.transport.ensureGuest(id);
      if (this.role === 'guest' && id === this.hostId && !this.transport.peers.has(id)) { this._signal(id, { kind: 'restart', attempt }); launched = true; }
      if (launched) this._status('ready', 'Establishing peer links...');
    }, Math.min(1500 * 2 ** Math.max(0, (attempt ?? 1) - 1), 6000));
  }

  _pauseSignal(id, attempt) {
    return pauseRoomSignal(this, id, attempt);
  }
  _signal(to, payload) { return this._broadcast('signal', { ...payload, to, from: this.playerId, epoch: this.epoch }, true); }
  _broadcast(event, payload, critical = false) { return sendRoomMessage(this, event, payload, critical); }
  _status(state, message) {
    this.options.onStatus?.({
      state,
      message,
      roomCode: this.roomCode,
      role: this.role,
      playerCount: this.members.length || (this.ready ? 1 : 0),
      icePath: this.icePath,
    });
  }
  _timer(fn, delay, interval = false) {
    const id = interval ? setInterval(fn, delay) : setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, delay);
    this._timers.add(id);
    return id;
  }
  _clearAdmissionTimers() {
    for (const timer of [this.admissionRetry, this.admissionTimeout]) {
      clearInterval(timer); clearTimeout(timer); this._timers.delete(timer);
    }
  }
  async _leaveRoom() {
    const oldChannel = this.channel, wasTracked = this.tracked;
    this.channel = null;
    this.channelGeneration++;
    this.ready = false; this.snapshotReady = false;
    this.tracked = false;
    this.admitting = false;
    this.pausedSignal = null;
    this.channelHealthy = false;
    this.channelRecoveryAttempts = 0;
    this.channelRecoveryInFlight = false;
    this.channelRecoveryTimer = null;
    this._clearAdmissionTimers();
    for (const timer of this._timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this._timers.clear();
    this.admissions.clear();
    this.transport.closeAll();
    if (!oldChannel) return;
    let timeout;
    try {
      const cleanup = [Promise.resolve().then(() => this.supabase?.removeChannel(oldChannel))];
      if (wasTracked) cleanup.push(Promise.resolve().then(() => oldChannel.untrack()));
      await Promise.race([
        Promise.allSettled(cleanup),
        new Promise((resolve) => { timeout = setTimeout(resolve, 1000); }),
      ]);
    } catch {} finally {
      clearTimeout(timeout);
      try { oldChannel.teardown(); } catch {}
    }
  }
  destroy() { return this._leaveRoom(); }
}
