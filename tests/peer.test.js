import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_OPEN_TIMEOUT_MS, FIRST_OFFER_DELAY_MS, ICE_GATHER_TIMEOUT_MS,
  OFFER_CADENCE_MS, PEER_OPEN_TIMEOUT_MS, WebRTCStar } from '../src/network/peer.js';
function pathStats(candidateType = 'host', transport = false) {
  const pair = { type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' };
  if (!transport) pair.selected = true;
  const entries = [['pair', pair], ['local', { candidateType }], ['remote', { candidateType: 'host' }]];
  if (transport) entries.unshift(['transport', { type: 'transport', selectedCandidatePairId: 'pair' }]);
  return new Map(entries);
}
class FakeChannel {
  constructor(label, options, readyState = 'open') { this.label = label; this.options = options; this.readyState = readyState; }
  open() { this.readyState = 'open'; this.onopen?.(); } send() {}
  close() { if (this.readyState !== 'closed') { this.readyState = 'closed'; this.onclose?.(); } }
}
class FakePeerConnection {
  static instances = []; static channelState = 'open';
  static autoConnect = false; static localDescriptionGate = null; static remoteDescriptionGate = null;
  constructor() {
    this.createdAt = Date.now();
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.iceGatheringState = 'gathering';
    this.listeners = new Map();
    FakePeerConnection.instances.push(this);
  }
  createDataChannel(label, options) { return new FakeChannel(label, options, FakePeerConnection.channelState); }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
  async setLocalDescription(description) {
    this.localDescription = { ...description };
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    if (FakePeerConnection.autoConnect) { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
    await FakePeerConnection.localDescriptionGate?.(this);
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    await FakePeerConnection.remoteDescriptionGate?.(this);
    this.signalingState = description.type === 'answer' ? 'stable' : 'have-remote-offer';
  }
  async addIceCandidate() {}
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  completeIce(withCandidate = false) {
    if (withCandidate && this.localDescription) this.localDescription.sdp += '\r\na=candidate:1 1 udp 1 127.0.0.1 9 typ host';
    this.iceGatheringState = 'complete';
    this.listeners.get('icegatheringstatechange')?.();
  }
  async getStats() { return this.stats ?? new Map(); }
  selectPath(candidateType = 'host') {
    this.stats = pathStats(candidateType);
    this.connectionState = 'connected';
    this.onconnectionstatechange?.();
  }
  close() { this.connectionState = 'closed'; }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function transport(role, signals, options = {}) {
  return new WebRTCStar({
    iceServers: [], role: () => role, hostId: () => 'host',
    expectedPeers: options.expectedPeers,
    signal: (to, payload) => { signals.push({ to, ...payload }); return options.signal?.(to, payload) ?? true; },
    timer: (fn, delay) => setTimeout(fn, delay),
    onMovement: options.onMovement ?? (() => {}),
    onControl: options.onControl ?? (() => {}),
    onControlOpen: options.onControlOpen ?? (() => {}),
    onPath: options.onPath ?? (() => {}), onFailure: options.onFailure ?? (() => {}),
    onSignalPaused: options.onSignalPaused ?? (() => {}),
    onPeerLeft: options.onPeerLeft ?? (() => {}),
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  FakePeerConnection.instances = [];
  FakePeerConnection.channelState = 'open'; FakePeerConnection.autoConnect = false;
  FakePeerConnection.localDescriptionGate = null;
  FakePeerConnection.remoteDescriptionGate = null;
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('serialized non-trickle WebRTC signaling', () => {
  it('deduplicates enrollment while pending gathers do not stall offer starts', async () => {
    const signals = [];
    const star = transport('host', signals);
    star.ensureGuest('guest-a');
    star.ensureGuest('guest-a');
    star.ensureGuest('guest-b');
    await flush();
    await vi.advanceTimersByTimeAsync(FIRST_OFFER_DELAY_MS); await flush();
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(signals).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(OFFER_CADENCE_MS - 1);
    expect(FakePeerConnection.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(signals).toHaveLength(0);
    FakePeerConnection.instances.forEach((pc) => pc.completeIce(true));
    await flush();
    expect(signals.filter((signal) => signal.kind === 'offer')).toHaveLength(2);
    expect(signals.every(({ description }) => description.sdp.includes('a=candidate:'))).toBe(true);
    expect(signals.some((signal) => signal.kind === 'candidate')).toBe(false);
    star.closeAll();
  });
  it('sends a candidate-bearing answer at deadline when gathering stays open', async () => {
    const signals = [];
    const star = transport('guest', signals, { signal: () => null });
    const handling = star.handleSignal({ from: 'host', kind: 'offer', attempt: 1, description: { type: 'offer', sdp: 'remote' } });
    await flush();
    expect(signals).toHaveLength(0);
    FakePeerConnection.instances[0].localDescription.sdp += '\r\na=candidate:deadline';
    await vi.advanceTimersByTimeAsync(ICE_GATHER_TIMEOUT_MS);
    await handling;

    expect(signals[0].description.sdp).toContain('a=candidate:');
    expect(signals.some((signal) => signal.kind === 'candidate')).toBe(false);
    expect(star.peers.get('host')?.attempt).toBe(1);
    star.closeAll();
  });
  it('pauses failed offer and answer delivery without peer-failure churn', async () => {
    const signals = [], paused = [], failures = [];
    const options = {
      signal: vi.fn().mockResolvedValue(false),
      onSignalPaused: (id, attempt) => paused.push({ id, attempt }), onFailure: (id) => failures.push(id),
    };
    const host = transport('host', signals, options);
    host.ensureGuest('guest'); await vi.advanceTimersByTimeAsync(FIRST_OFFER_DELAY_MS); await flush();
    FakePeerConnection.instances.at(-1).completeIce(true); await flush();
    expect(host.peers.has('guest')).toBe(false);
    host.ensureGuest('guest'); await vi.advanceTimersByTimeAsync(OFFER_CADENCE_MS); await flush();
    FakePeerConnection.instances.at(-1).completeIce(true); await flush();
    expect(signals.filter(({ kind }) => kind === 'offer').map(({ attempt }) => attempt)).toEqual([1, 2]);
    const guest = transport('guest', signals, options);
    const handling = guest.handleSignal({ from: 'host', kind: 'offer', attempt: 5, description: { type: 'offer' } });
    await flush(); FakePeerConnection.instances.at(-1).completeIce(true); await handling;
    expect(guest.peers.has('host')).toBe(false);
    expect(paused).toEqual([{ id: 'guest', attempt: 1 }, { id: 'guest', attempt: 2 }, { id: 'host', attempt: 5 }]);
    await vi.runOnlyPendingTimersAsync();
    expect(failures).toEqual([]);
  });
  it('increments per-player attempts and ignores stale or duplicate answers and restarts', async () => {
    const signals = [], failures = [];
    const star = transport('host', signals, { onFailure: (id) => failures.push(id) });
    star.ensureGuest('guest');
    await vi.advanceTimersByTimeAsync(FIRST_OFFER_DELAY_MS);
    await flush();
    const first = star.peers.get('guest');
    first.pc.completeIce(true);
    await flush();
    expect(first.attempt).toBe(1);

    await star.handleSignal({ from: 'guest', kind: 'restart' });
    await star.handleSignal({ from: 'guest', kind: 'restart', attempt: 2 });
    expect(star.peers.get('guest')).toBe(first);
    await star.handleSignal({ from: 'guest', kind: 'restart', attempt: 1 });
    await star.handleSignal({ from: 'guest', kind: 'restart', attempt: 1 });
    await vi.advanceTimersByTimeAsync(OFFER_CADENCE_MS);
    await flush();
    const second = star.peers.get('guest');
    second.pc.completeIce(true);
    await flush();
    expect(second.attempt).toBe(2);

    const remote = vi.spyOn(second.pc, 'setRemoteDescription');
    let resolveAnswer;
    FakePeerConnection.remoteDescriptionGate = () => new Promise((resolve) => { resolveAnswer = resolve; });
    await star.handleSignal({ from: 'guest', kind: 'answer', attempt: 1, description: { type: 'answer' } });
    await star.handleSignal({ from: 'guest', kind: 'answer', attempt: 3, description: { type: 'answer' } });
    const applying = star.handleSignal({ from: 'guest', kind: 'answer', attempt: 2, description: { type: 'answer' } });
    await flush();
    await star.handleSignal({ from: 'guest', kind: 'answer', attempt: 2, description: { type: 'answer' } });
    expect(remote).toHaveBeenCalledOnce();
    resolveAnswer();
    await applying;
    await star.handleSignal({ from: 'guest', kind: 'answer', attempt: 2, description: { type: 'answer' } });
    expect(remote).toHaveBeenCalledOnce();
    expect(second.answerApplied).toBe(true);

    FakePeerConnection.remoteDescriptionGate = null;
    await star.handleSignal({ from: 'guest', kind: 'restart', attempt: 1 });
    await star.handleSignal({ from: 'guest', kind: 'restart' });
    expect(star.peers.get('guest')).toBe(second);
    await star.handleSignal({ from: 'guest', kind: 'restart', attempt: 2 });
    await star.handleSignal({ from: 'guest', kind: 'restart', attempt: 2 });
    await vi.advanceTimersByTimeAsync(OFFER_CADENCE_MS);
    await flush();
    expect(star.peers.get('guest').attempt).toBe(3);
    expect(star.offerAttempts.get('guest')).toBe(3);
    expect(failures).toEqual([]);
    star.closeAll();
  });
  it('accepts only increasing guest offers and makes stale gather completion inert', async () => {
    const signals = [], failures = [];
    const star = transport('guest', signals, { onFailure: (id) => failures.push(id) });
    const first = star.handleSignal({ from: 'host', kind: 'offer', attempt: 2, description: { type: 'offer' } });
    await flush();
    const stale = FakePeerConnection.instances[0];
    const next = star.handleSignal({ from: 'host', kind: 'offer', attempt: 3, description: { type: 'offer' } });
    await flush();
    stale.completeIce(true); await first;
    expect(signals).toHaveLength(0);
    FakePeerConnection.instances[1].completeIce(true);
    await next;
    await star.handleSignal({ from: 'host', kind: 'offer', attempt: 2, description: { type: 'offer' } });
    await star.handleSignal({ from: 'host', kind: 'offer', description: { type: 'offer' } });
    await vi.advanceTimersByTimeAsync(ICE_GATHER_TIMEOUT_MS);
    expect(signals.map(({ attempt }) => attempt)).toEqual([3]);
    expect(star.peers.get('host').attempt).toBe(3);
    expect(failures).toEqual([]);
    star.closeAll();
  });
  it('signals timeout candidates but fails candidate-free completion and deadline once', async () => {
    const signals = [], failures = [];
    const star = transport('host', signals, { onFailure: (id, attempt) => failures.push({ id, attempt }) });
    star.ensureGuest('candidate-free');
    await vi.advanceTimersByTimeAsync(FIRST_OFFER_DELAY_MS); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(signals).toEqual([]); expect(failures).toEqual([]);
    star.peers.get('candidate-free').pc.completeIce(); await flush();
    expect(failures).toEqual([{ id: 'candidate-free', attempt: 1 }]);
    star.ensureGuest('timeout-candidate');
    await vi.advanceTimersByTimeAsync(OFFER_CADENCE_MS - 1000); await flush();
    star.peers.get('timeout-candidate').pc.localDescription.sdp += '\r\na=candidate:deadline';
    await vi.advanceTimersByTimeAsync(ICE_GATHER_TIMEOUT_MS);
    expect(signals.map(({ to }) => to)).toEqual(['timeout-candidate']);
    star.ensureGuest('timeout-empty'); await flush();
    await vi.advanceTimersByTimeAsync(ICE_GATHER_TIMEOUT_MS);
    expect(signals).toHaveLength(1);
    expect(failures).toEqual([{ id: 'candidate-free', attempt: 1 }, { id: 'timeout-empty', attempt: 1 }]);
  });
  it('starts seven offers on cadence without waiting for slow acknowledgements', async () => {
    FakePeerConnection.autoConnect = true;
    const acknowledgements = [];
    const star = transport('host', [], {
      signal: vi.fn(() => new Promise((resolve) => acknowledgements.push(resolve))),
    });
    for (let index = 0; index < 7; index++) star.ensureGuest(`guest-${index}`);
    let now = 0;
    for (const start of [1200, 3300, 5400, 7500, 9600, 11700, 13800]) {
      await vi.advanceTimersByTimeAsync(start - now); await flush();
      FakePeerConnection.instances.at(-1).completeIce(true); await flush(); now = start;
    }
    expect(FakePeerConnection.instances.map(({ createdAt }) => createdAt))
      .toEqual([1200, 3300, 5400, 7500, 9600, 11700, 13800]);
    expect(acknowledgements).toHaveLength(7);
    expect([...star.peers.values()].map(({ attempt }) => attempt)).toEqual(Array(7).fill(1));
    acknowledgements.forEach((resolve) => resolve(null)); await flush();
    expect(star.peers.size).toBe(7);
    star.closeAll();
  });
  it('aggregates usable legacy paths without treating unknown as direct', async () => {
    const ids = Array.from({ length: 7 }, (_, index) => `guest-${index}`);
    const paths = [], failures = [];
    const star = transport('host', [], {
      expectedPeers: () => ids, onPath: (path) => paths.push(path), onFailure: (id) => failures.push(id),
    });
    const peers = ids.map((id, index) => {
      const peer = star._newPeer(id);
      star._bindMovement(peer, new FakeChannel('movement', {}, index < 5 ? 'open' : 'connecting'));
      star._bindControl(peer, new FakeChannel('control', {}, index < 5 ? 'open' : 'connecting'));
      peer.pc.selectPath('host');
      return peer;
    });
    await flush();
    star.refreshPath();
    expect(peers.slice(0, 5).every(({ watchdog }) => watchdog === null)).toBe(true);
    expect(paths.at(-1)).toBe('connecting');
    for (const peer of peers.slice(5)) { peer.movement.open(); peer.control.open(); }
    await flush();
    expect(peers.every(({ watchdog }) => watchdog === null)).toBe(true);
    expect(paths.at(-1)).toBe('direct');
    peers[6].path = 'unknown'; star.refreshPath();
    expect(paths.at(-1)).toBe('connected');
    peers[3].path = 'relay'; star.refreshPath();
    expect(paths.at(-1)).toBe('relay');
    expect(failures).toEqual([]);
    star.closeAll();
  });
  it('prefers the transport-selected candidate pair for direct and relay paths', async () => {
    const paths = [];
    const star = transport('host', [], { expectedPeers: () => ['stats'], onPath: (path) => paths.push(path) });
    const peer = star._newPeer('stats', 3);
    star._bindMovement(peer, new FakeChannel('movement', {}));
    star._bindControl(peer, new FakeChannel('control', {}));
    peer.pc.stats = pathStats('host', true);
    peer.pc.connectionState = 'connected'; peer.pc.onconnectionstatechange();
    await flush();
    expect(paths.at(-1)).toBe('direct');
    peer.pc.stats = pathStats('relay', true);
    await star._inspectIce(peer);
    expect(paths.at(-1)).toBe('relay');
    star.closeAll();
  });
  it('rearms host answer, connection, and channel phases without firing stale deadlines', async () => {
    FakePeerConnection.channelState = 'connecting';
    const failures = [], signals = [], timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const star = transport('host', signals, { onFailure: (id) => failures.push(id) });
    star.ensureGuest('late');
    await vi.advanceTimersByTimeAsync(FIRST_OFFER_DELAY_MS); await flush();
    const peer = star.peers.get('late'); peer.pc.completeIce(true); await flush();
    const phaseTimers = timeoutSpy.mock.calls.filter(([, delay]) => delay === PEER_OPEN_TIMEOUT_MS).map(([fn]) => fn);
    phaseTimers[0]();
    await vi.advanceTimersByTimeAsync(11000); await star.handleSignal({ from: 'late', kind: 'answer', attempt: 1, description: { type: 'answer' } });
    phaseTimers[1]();
    await vi.advanceTimersByTimeAsync(11999);
    peer.pc.connectionState = 'connected'; peer.pc.onconnectionstatechange();
    const channelTimer = timeoutSpy.mock.calls.filter(([, delay]) => delay === CHANNEL_OPEN_TIMEOUT_MS).at(-1)[0];
    await vi.advanceTimersByTimeAsync(9999);
    peer.movement.readyState = 'open'; peer.control.readyState = 'open'; channelTimer();
    expect(star.peers.get('late')).toBe(peer); expect(failures).toEqual([]);
    star.closeAll(); timeoutSpy.mockRestore();
  });
  it('gives guest offer, answer, connection, and channel phases fresh deadlines', async () => {
    let releaseLocal;
    FakePeerConnection.localDescriptionGate = () => new Promise((resolve) => { releaseLocal = resolve; });
    const failures = [], signals = [], star = transport('guest', signals, { onFailure: (id) => failures.push(id) });
    const handling = star.handleSignal({ from: 'host', kind: 'offer', attempt: 4, description: { type: 'offer' } });
    await flush();
    const peer = star.peers.get('host');
    await vi.advanceTimersByTimeAsync(11000);
    peer.pc.completeIce(true); releaseLocal(); await handling;
    await vi.advanceTimersByTimeAsync(11999);
    peer.pc.ondatachannel({ channel: new FakeChannel('movement', {}, 'connecting') });
    peer.pc.ondatachannel({ channel: new FakeChannel('control', {}, 'connecting') });
    peer.pc.connectionState = 'connected'; peer.pc.onconnectionstatechange();
    await vi.advanceTimersByTimeAsync(5999);
    peer.movement.open(); peer.control.open(); await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].attempt).toBe(4); expect(star.peers.get('host')).toBe(peer); expect(failures).toEqual([]);
    star.closeAll();
  });

  it.each([['construction', PEER_OPEN_TIMEOUT_MS], ['host offer', PEER_OPEN_TIMEOUT_MS],
    ['host answer', PEER_OPEN_TIMEOUT_MS], ['guest offer', PEER_OPEN_TIMEOUT_MS],
    ['guest answer', PEER_OPEN_TIMEOUT_MS], ['channels', CHANNEL_OPEN_TIMEOUT_MS]])(
    'fails once when the %s phase makes no progress', async (_phase, delay) => {
    const failures = [];
    const star = transport('host', [], { onFailure: (id, attempt) => failures.push({ id, attempt }) });
    const peer = star._newPeer('never', 7);
    if (_phase === 'channels') { peer.pc.connectionState = 'connected'; peer.movement = new FakeChannel('movement', {}); }
    if (delay !== PEER_OPEN_TIMEOUT_MS || _phase !== 'construction') star._armWatchdog(star.peers.get('never'), delay);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(star.peers.has('never')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(failures).toEqual([{ id: 'never', attempt: 7 }]);
    },
  );
  it('polls unknown path stats through the bounded six-second window', async () => {
    const paths = [], failures = [];
    const star = transport('host', [], {
      expectedPeers: () => ['stats'], onPath: (path) => paths.push(path),
      onFailure: (id) => failures.push(id),
    });
    const peer = star._newPeer('stats', 5);
    star._bindMovement(peer, new FakeChannel('movement', {}));
    star._bindControl(peer, new FakeChannel('control', {}));
    peer.pc.getStats = vi.fn(async () => {
      if (peer.pc.getStats.mock.calls.length === 1) throw new Error('stats unavailable');
      return peer.pc.getStats.mock.calls.length < 9 ? new Map() : pathStats();
    });
    peer.pc.connectionState = 'connected';
    peer.pc.onconnectionstatechange();
    await flush();
    expect(peer.pc.getStats).toHaveBeenCalledTimes(1);
    expect(paths.at(-1)).toBe('connected');
    await vi.advanceTimersByTimeAsync(5999);
    expect(peer.pc.getStats).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(peer.pc.getStats).toHaveBeenCalledTimes(9);
    expect(paths.at(-1)).toBe('direct');
    expect(failures).toEqual([]);
    star.closeAll();
  });
  it('cancels stale path polling when a same-id peer is replaced', async () => {
    const paths = [];
    const star = transport('host', [], { onPath: (path) => paths.push(path) });
    const stale = star._newPeer('same-id', 4);
    star._bindMovement(stale, new FakeChannel('movement', {}));
    star._bindControl(stale, new FakeChannel('control', {}));
    stale.pc.getStats = vi.fn(async () => new Map());
    stale.pc.connectionState = 'connected'; stale.pc.onconnectionstatechange();
    await flush();
    expect(stale.pc.getStats).toHaveBeenCalledOnce();
    star.closePeer('same-id');
    const replacement = star._newPeer('same-id', 5), pathCount = paths.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(star.peers.get('same-id')).toBe(replacement);
    expect(stale.pc.getStats).toHaveBeenCalledOnce();
    expect(paths).toHaveLength(pathCount);
    star.closeAll();
  });
  it('fails once on channel loss and never fails during intentional teardown', () => {
    const failures = [];
    const star = transport('host', [], { onFailure: (id) => failures.push(id) });
    const lost = star._newPeer('lost');
    star._bindMovement(lost, new FakeChannel('movement', {}));
    star._bindControl(lost, new FakeChannel('control', {}));
    lost.movement.close();
    lost.control.close();
    expect(failures).toEqual(['lost']);

    const lostControl = star._newPeer('lost-control');
    star._bindMovement(lostControl, new FakeChannel('movement', {}));
    star._bindControl(lostControl, new FakeChannel('control', {}));
    lostControl.control.close();
    expect(failures).toEqual(['lost', 'lost-control']);

    const intentional = star._newPeer('intentional');
    star._bindMovement(intentional, new FakeChannel('movement', {}));
    star._bindControl(intentional, new FakeChannel('control', {}));
    star.closeAll();
    expect(failures).toEqual(['lost', 'lost-control']);
  });
  it('ignores stale channel messages and opens after a same-id attempt replacement', () => {
    const movement = vi.fn(), control = vi.fn(), controlOpen = vi.fn(), paths = [], failures = [];
    const star = transport('host', [], {
      onMovement: movement, onControl: control, onControlOpen: controlOpen,
      onPath: (path) => paths.push(path), onFailure: (id) => failures.push(id),
    });
    const stale = star._newPeer('same-id', 4);
    star._bindMovement(stale, new FakeChannel('movement', {}));
    star._bindControl(stale, new FakeChannel('control', {}));
    const callbacks = [
      () => stale.movement.onmessage({ data: '{"x":1}' }),
      () => stale.control.onmessage({ data: '{"kind":"snapshot"}' }),
      stale.movement.onopen,
      stale.control.onopen,
      stale.movement.onclose,
    ];
    star.closePeer('same-id');
    const replacement = star._newPeer('same-id', 5);
    star._bindMovement(replacement, new FakeChannel('movement', {}));
    star._bindControl(replacement, new FakeChannel('control', {}));
    const ready = vi.spyOn(star, '_peerReady'), refresh = vi.spyOn(star, 'refreshPath');
    const pathCount = paths.length;
    callbacks.forEach((callback) => callback());
    expect(star.peers.get('same-id')).toBe(replacement);
    expect(movement).not.toHaveBeenCalled();
    expect(control).not.toHaveBeenCalled();
    expect(controlOpen).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(paths).toHaveLength(pathCount);
    expect(failures).toEqual([]);
    star.closeAll();
  });
  it('ignores a late host answer rejection after restart replaces the same peer id', async () => {
    const failures = [];
    let rejectOld;
    FakePeerConnection.remoteDescriptionGate = () => new Promise((_, reject) => { rejectOld = reject; });
    const star = transport('host', [], { onFailure: (id) => failures.push(id) });
    star.ensureGuest('same-id');
    await vi.advanceTimersByTimeAsync(FIRST_OFFER_DELAY_MS);
    await flush();
    const stale = star.peers.get('same-id');
    stale.pc.completeIce(true);
    await flush();
    const handling = star.handleSignal({ from: 'same-id', kind: 'answer', attempt: 1, description: { type: 'answer' } });
    await flush();

    FakePeerConnection.remoteDescriptionGate = null;
    await star.handleSignal({ from: 'same-id', kind: 'restart', attempt: 1 });
    await vi.advanceTimersByTimeAsync(OFFER_CADENCE_MS);
    await flush();
    const replacement = star.peers.get('same-id');
    expect(replacement).not.toBe(stale);
    expect(replacement.attempt).toBe(2);
    rejectOld(new Error('late old answer'));
    await handling;

    expect(star.peers.get('same-id')).toBe(replacement);
    expect(failures).toEqual([]);
    star.closeAll();
  });

  it('ignores a late guest offer rejection after the host peer is replaced', async () => {
    const failures = [];
    let rejectOld;
    FakePeerConnection.remoteDescriptionGate = () => new Promise((_, reject) => { rejectOld = reject; });
    const star = transport('guest', [], { onFailure: (id) => failures.push(id) });
    const handling = star.handleSignal({ from: 'host', kind: 'offer', attempt: 1, description: { type: 'offer' } });
    await flush();
    const stale = star.peers.get('host');

    FakePeerConnection.remoteDescriptionGate = null;
    star.closePeer('host');
    const replacement = star._newPeer('host');
    rejectOld(new Error('late old offer'));
    await handling;

    expect(replacement).not.toBe(stale);
    expect(star.peers.get('host')).toBe(replacement);
    expect(failures).toEqual([]);
    star.closeAll();
  });
});
