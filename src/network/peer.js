function parseMessage(event) {
  try {
    return typeof event.data === 'string' && event.data.length < 1_000_000 ? JSON.parse(event.data) : null;
  } catch {
    return null;
  }
}

export const ICE_GATHER_TIMEOUT_MS = 10000;
export const FIRST_OFFER_DELAY_MS = 1200;
export const OFFER_CADENCE_MS = 2100;
export const PEER_OPEN_TIMEOUT_MS = 12000;
export const CHANNEL_OPEN_TIMEOUT_MS = 10000;
const PATH_POLL_WINDOW_MS = 6000;

export class WebRTCStar {
  constructor(options) {
    this.options = options;
    this.peers = new Map();
    this.offerAttempts = new Map();
    this.acceptedAttempts = new Map();
    this.offerQueue = [];
    this.queuedOffers = new Set();
    this.offerRunning = false;
    this.offerTimer = null;
    this.offerDelayStarted = false;
    this.lastOfferAt = -Infinity;
    this.reportedPath = '';
  }

  _newPeer(id, attempt = 1) {
    const peer = {
      id,
      attempt,
      pc: new RTCPeerConnection({ iceServers: this.options.iceServers }),
      movement: null,
      control: null,
      path: 'connecting',
      closing: false,
      connected: false,
      watchdog: null,
      iceCleanup: null,
      statsTimer: null,
      statsDeadline: 0,
      statsPoll: 0,
      answerPending: false,
      answerApplied: false,
    };
    peer.pc.onconnectionstatechange = () => {
      if (peer.pc.connectionState === 'connected' && this.peers.get(id) === peer
        && peer.attempt === attempt && !peer.closing) {
        if (!peer.connected) { peer.connected = true; this._armWatchdog(peer, CHANNEL_OPEN_TIMEOUT_MS); }
        this._peerReady(peer); this.refreshPath();
      }
      if (peer.pc.connectionState === 'failed' && this.peers.get(id) === peer
        && peer.attempt === attempt && !peer.closing) this._fail(id, attempt);
      if (peer.pc.connectionState === 'disconnected') {
        this.options.timer(() => {
          if (this.peers.get(id) === peer && peer.attempt === attempt && !peer.closing
            && peer.pc.connectionState === 'disconnected') this._fail(id, attempt);
        }, 5000);
      }
    };
    this.peers.set(id, peer);
    this._armWatchdog(peer, PEER_OPEN_TIMEOUT_MS);
    this.refreshPath();
    return peer;
  }

  ensureGuest(id) {
    if (this.options.role() !== 'host' || this.peers.has(id) || this.queuedOffers.has(id)) return false;
    this.queuedOffers.add(id);
    this.offerQueue.push(id);
    this.refreshPath();
    this._drainOffers();
    return true;
  }

  async _drainOffers() {
    if (this.offerRunning || this.offerTimer || this.options.role() !== 'host' || !this.offerQueue.length) return;
    if (!this.offerDelayStarted) {
      this.offerDelayStarted = true;
      this.offerTimer = setTimeout(() => { this.offerTimer = null; this._drainOffers(); }, FIRST_OFFER_DELAY_MS);
      return;
    }
    const wait = Math.max(0, this.lastOfferAt + OFFER_CADENCE_MS - Date.now());
    if (wait) {
      this.offerTimer = setTimeout(() => { this.offerTimer = null; this._drainOffers(); }, wait);
      return;
    }
    this.lastOfferAt = Date.now();
    const id = this.offerQueue.shift();
    const attempt = (this.offerAttempts.get(id) ?? 0) + 1;
    this.offerAttempts.set(id, attempt);
    this.queuedOffers.delete(id);
    this.offerRunning = true;
    const peer = this._newPeer(id, attempt);
    this._bindMovement(peer, peer.pc.createDataChannel('movement', { ordered: false, maxRetransmits: 0 }));
    this._bindControl(peer, peer.pc.createDataChannel('control', { ordered: true }));
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      if (this.options.role() === 'host' && this._isCurrent(peer, attempt)) {
        this._signalAfterIce(peer, 'offer');
      }
    } catch {
      if (this.peers.get(id) === peer && peer.attempt === attempt && !peer.closing) this._fail(id, attempt);
    } finally {
      this.offerRunning = false;
      this._drainOffers();
    }
  }

  async handleSignal(payload) {
    const id = payload?.from, attempt = payload?.attempt;
    if (typeof id !== 'string') return;
    if (this.options.role() === 'host') {
      const peer = this.peers.get(id);
      if (payload.kind === 'restart') {
        if (attempt == null) { if (!peer) this.ensureGuest(id); return; }
        if (!Number.isInteger(attempt) || attempt < 1 || !peer || peer.attempt !== attempt) return;
        this.closePeer(id); this.ensureGuest(id); return;
      }
      if (payload.kind !== 'answer' || !peer || attempt !== peer.attempt || peer.answerPending
        || peer.answerApplied || peer.pc.signalingState !== 'have-local-offer') return;
      peer.answerPending = true;
      try {
        await peer.pc.setRemoteDescription(payload.description);
        peer.answerPending = false;
        if (this._isCurrent(peer, attempt)) {
          peer.answerApplied = true;
          if (peer.pc.connectionState !== 'connected') this._armWatchdog(peer, PEER_OPEN_TIMEOUT_MS);
        }
      } catch {
        peer.answerPending = false;
        if (this.peers.get(id) === peer && peer.attempt === attempt && !peer.closing) this._fail(id, attempt);
      }
      return;
    }
    if (this.options.role() !== 'guest' || id !== this.options.hostId() || payload.kind !== 'offer'
      || !Number.isInteger(attempt) || attempt < 1 || attempt <= (this.acceptedAttempts.get(id) ?? 0)) return;
    this.acceptedAttempts.set(id, attempt);
    await this._acceptOffer(id, attempt, payload.description);
  }

  async _acceptOffer(id, attempt, description) {
    this.closeAll();
    const peer = this._newPeer(id, attempt);
    peer.pc.ondatachannel = ({ channel }) => {
      if (channel.label === 'movement') this._bindMovement(peer, channel);
      if (channel.label === 'control') this._bindControl(peer, channel);
    };
    try {
      await peer.pc.setRemoteDescription(description);
      if (!this._isCurrent(peer, attempt)) return;
      if (peer.pc.connectionState !== 'connected') this._armWatchdog(peer, PEER_OPEN_TIMEOUT_MS);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      if (this._isCurrent(peer, attempt) && this.options.role() !== 'host') {
        await this._signalAfterIce(peer, 'answer');
      }
    } catch {
      if (this.peers.get(id) === peer && peer.attempt === attempt && !peer.closing) this._fail(id, attempt);
    }
  }

  async _signalAfterIce(peer, kind) {
    const attempt = peer.attempt;
    try {
      if (!await this._waitForIce(peer) || !this._isCurrent(peer, attempt)) return false;
      return await this._deliverSignal(peer, { kind, attempt, description: peer.pc.localDescription });
    } catch {
      if (this._isCurrent(peer, attempt)) this._fail(peer.id, attempt);
      return false;
    }
  }

  _waitForIce(peer) {
    const { pc, attempt } = peer;
    return new Promise((resolve) => {
      let done = false;
      const finish = (ready = false, fail = false) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', check);
        if (peer.iceCleanup === finish) peer.iceCleanup = null;
        if (fail && this._isCurrent(peer, attempt)) this._fail(peer.id, attempt);
        resolve(ready);
      };
      const check = () => {
        if (!this._isCurrent(peer, attempt)) finish();
        else if (pc.iceGatheringState === 'complete') {
          const ready = pc.localDescription?.sdp?.includes('a=candidate:') === true;
          finish(ready, !ready);
        }
      };
      const timeout = setTimeout(() => {
        const ready = pc.localDescription?.sdp?.includes('a=candidate:') === true;
        finish(ready, !ready);
      }, ICE_GATHER_TIMEOUT_MS);
      peer.iceCleanup?.(); peer.iceCleanup = finish;
      pc.addEventListener('icegatheringstatechange', check);
      check();
    });
  }

  _isCurrent(peer, attempt) {
    return this.peers.get(peer.id) === peer && peer.attempt === attempt && !peer.closing;
  }

  async _deliverSignal(peer, payload) {
    const attempt = peer.attempt;
    if (!this._isCurrent(peer, attempt)) return false;
    this._armWatchdog(peer, PEER_OPEN_TIMEOUT_MS); this._peerReady(peer);
    let sent = false;
    try { sent = await this.options.signal(peer.id, payload); } catch {}
    if (!this._isCurrent(peer, attempt)) return false;
    if (sent !== false) return sent;
    this.closePeer(peer.id);
    this.options.onSignalPaused?.(peer.id, attempt);
    return false;
  }

  _bindMovement(peer, channel) {
    const attempt = peer.attempt;
    peer.movement = channel;
    channel.onmessage = (event) => {
      if (this._isCurrent(peer, attempt)) this.options.onMovement(peer.id, parseMessage(event));
    };
    channel.onopen = () => {
      if (!this._isCurrent(peer, attempt)) return;
      this._peerReady(peer); this.refreshPath();
    };
    channel.onclose = () => {
      if (this._isCurrent(peer, attempt)) this._fail(peer.id, attempt);
    };
    this._peerReady(peer);
    this.refreshPath();
  }

  _bindControl(peer, channel) {
    const attempt = peer.attempt;
    peer.control = channel;
    channel.onmessage = (event) => {
      if (this._isCurrent(peer, attempt)) this.options.onControl(peer.id, parseMessage(event));
    };
    channel.onopen = () => {
      if (!this._isCurrent(peer, attempt)) return;
      this.options.onControlOpen(peer.id, channel); this._peerReady(peer); this.refreshPath();
    };
    channel.onclose = () => {
      if (this._isCurrent(peer, attempt)) this._fail(peer.id, attempt);
    };
    this._peerReady(peer);
    this.refreshPath();
  }

  sendMovement(message) {
    if (this.options.role() === 'host') {
      for (const peer of this.peers.values()) this._send(peer.movement, message);
    } else {
      this._send(this.peers.get(this.options.hostId())?.movement, message);
    }
  }

  relayMovement(from, message) {
    for (const [id, peer] of this.peers) {
      if (id !== from) this._send(peer.movement, message);
    }
  }

  sendControl(id, message) {
    const channel = this.peers.get(id)?.control;
    if (channel?.readyState !== 'open') return false;
    channel.send(typeof message === 'string' ? message : JSON.stringify(message));
    return true;
  }

  broadcastControl(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const peer of this.peers.values()) this._send(peer.control, data);
  }

  _send(channel, data) {
    if (channel?.readyState === 'open') channel.send(data);
  }

  async _inspectIce(peer, retry = 0) {
    const attempt = peer.attempt, poll = ++peer.statsPoll;
    clearTimeout(peer.statsTimer); peer.statsTimer = null;
    if (!this._isCurrent(peer, attempt) || peer.pc.connectionState !== 'connected'
      || peer.movement?.readyState !== 'open' || peer.control?.readyState !== 'open') return;
    try {
      const stats = await peer.pc.getStats();
      let selected;
      stats.forEach((stat) => {
        const pair = stat.type === 'transport' && stats.get(stat.selectedCandidatePairId);
        if (!selected && pair?.type === 'candidate-pair' && pair.state === 'succeeded') selected = pair;
      });
      if (!selected) stats.forEach((stat) => {
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.selected || stat.nominated)) selected = stat;
      });
      const local = selected && stats.get(selected.localCandidateId);
      const remote = selected && stats.get(selected.remoteCandidateId);
      if (!this._isCurrent(peer, attempt) || peer.statsPoll !== poll) return;
      const types = [local?.candidateType, remote?.candidateType];
      peer.path = types.includes('relay') ? 'relay'
        : types.every((type) => ['host', 'srflx', 'prflx'].includes(type)) ? 'direct' : 'unknown';
    } catch {
      if (!this._isCurrent(peer, attempt) || peer.statsPoll !== poll) return;
      peer.path = 'unknown';
    }
    this.refreshPath();
    const remaining = peer.statsDeadline - Date.now();
    if (peer.path === 'unknown' && remaining > 0) peer.statsTimer = setTimeout(() => {
      if (this._isCurrent(peer, attempt) && peer.statsPoll === poll
        && peer.pc.connectionState === 'connected' && this._peerReady(peer)) this._inspectIce(peer, retry + 1);
    }, Math.min(retry === 0 ? 250 : retry === 1 ? 500 : 1000, remaining));
  }

  _peerReady(peer) {
    const ready = peer.pc.connectionState === 'connected'
      && peer.movement?.readyState === 'open' && peer.control?.readyState === 'open';
    if (ready && peer.watchdog != null) {
      clearTimeout(peer.watchdog); peer.watchdog = null;
      peer.statsDeadline = Date.now() + PATH_POLL_WINDOW_MS; this._inspectIce(peer);
    }
    return ready;
  }

  _armWatchdog(peer, delay) {
    clearTimeout(peer.watchdog);
    const { id, attempt } = peer;
    const watchdog = setTimeout(() => {
      if (peer.watchdog === watchdog && this._isCurrent(peer, attempt) && !this._peerReady(peer)) this._fail(id, attempt);
    }, delay);
    peer.watchdog = watchdog;
  }

  refreshPath() {
    const expected = this.options.expectedPeers?.() ?? [...this.peers.keys()];
    const peers = expected.map((id) => this.peers.get(id));
    const usable = peers.every((peer) => peer && peer.pc.connectionState === 'connected'
      && peer.movement?.readyState === 'open' && peer.control?.readyState === 'open');
    const path = !usable ? 'connecting' : peers.some((peer) => peer.path === 'relay') ? 'relay'
      : peers.every((peer) => peer.path === 'direct') ? 'direct' : 'connected';
    if (path !== this.reportedPath) { this.reportedPath = path; this.options.onPath(path); }
    return path;
  }

  _fail(id, attempt) {
    const peer = this.peers.get(id);
    if (!peer || peer.closing || (attempt != null && peer.attempt !== attempt)) return;
    const failedAttempt = peer.attempt;
    this.closePeer(id);
    this.options.onFailure(id, failedAttempt);
  }

  closePeer(id) {
    this.queuedOffers.delete(id);
    this.offerQueue = this.offerQueue.filter((queuedId) => queuedId !== id);
    const peer = this.peers.get(id);
    if (!peer) { this.refreshPath(); return; }
    peer.closing = true;
    this.peers.delete(id);
    clearTimeout(peer.watchdog);
    clearTimeout(peer.statsTimer);
    peer.iceCleanup?.();
    peer.statsPoll++;
    peer.movement?.close();
    peer.control?.close();
    peer.pc.close();
    this.options.onPeerLeft(id);
    this.refreshPath();
  }

  closeAll() {
    clearTimeout(this.offerTimer);
    this.offerTimer = null;
    this.offerQueue.length = 0;
    this.queuedOffers.clear();
    this.offerDelayStarted = false;
    this.lastOfferAt = -Infinity;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }
}
