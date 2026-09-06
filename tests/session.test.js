import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MultiplayerSession } from '../src/network/session.js';
import {
  ADMISSION_RESPONSE_CADENCE_MS,
  ADMISSION_TICKET_MS,
  AdmissionControl,
} from '../src/network/admission.js';
import { FIRST_OFFER_DELAY_MS, OFFER_CADENCE_MS } from '../src/network/peer.js';
import { connectRoomChannel, sendRoomMessage } from '../src/network/room-channel.js';

afterEach(() => vi.useRealTimers());

function fakeSession(channel, tracked = true) {
  return Object.assign(Object.create(MultiplayerSession.prototype), {
    channel,
    tracked,
    ready: true,
    admitting: false,
    _timers: new Set(),
    admissions: { clear: vi.fn() },
    transport: { closeAll: vi.fn() },
    supabase: { removeChannel: vi.fn(() => new Promise(() => {})) },
  });
}

describe('offline room cleanup', () => {
  it('detaches immediately and tears down a hanging old channel within one second', async () => {
    vi.useFakeTimers();
    const channel = {
      untrack: vi.fn(() => new Promise(() => {})),
      teardown: vi.fn(),
    };
    const session = fakeSession(channel);
    const leaving = session._leaveRoom();
    expect(session.channel).toBeNull();
    const replacement = {};
    session.channel = replacement;

    await vi.advanceTimersByTimeAsync(1000);
    await leaving;

    expect(channel.untrack).toHaveBeenCalledOnce();
    expect(session.supabase.removeChannel).toHaveBeenCalledWith(channel);
    expect(channel.teardown).toHaveBeenCalledOnce();
    expect(session.channel).toBe(replacement);
  });

  it('does not untrack a channel that never had Presence membership', async () => {
    const channel = { untrack: vi.fn(), teardown: vi.fn() };
    const session = fakeSession(channel, false);
    session.supabase.removeChannel.mockResolvedValue('ok');
    await session._leaveRoom();
    expect(channel.untrack).not.toHaveBeenCalled();
    expect(channel.teardown).toHaveBeenCalledOnce();
  });
});

describe('session race recovery', () => {
  it.each(['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'])(
    'rebuilds after %s, retracks membership, and ignores stale callbacks and acknowledgements', async (failure) => {
    const channels = [];
    const makeChannel = () => {
      const handlers = [];
      const channel = {
        state: 'joining',
        channelAdapter: { canPush: () => channel.state === 'joined' },
        on: vi.fn((type, filter, callback) => {
          handlers.push({ type, event: filter.event, callback });
          return channel;
        }),
        subscribe: vi.fn((callback) => {
          channel.subscription = (status) => { channel.state = status === 'SUBSCRIBED' ? 'joined' : 'closed'; callback(status); };
          return channel;
        }),
        send: vi.fn(() => new Promise((resolve) => { channel.sendResolvers.push(resolve); })),
        sendResolvers: [],
        track: vi.fn().mockResolvedValue('ok'),
        teardown: vi.fn(),
        emit(event, payload) {
          handlers.find((handler) => handler.event === event)?.callback({ payload });
        },
      };
      channels.push(channel);
      return channel;
    };
    const session = Object.assign(Object.create(MultiplayerSession.prototype), {
      supabase: { channel: vi.fn(makeChannel), removeChannel: vi.fn(async (channel) => {
        channel.teardown(); return 'ok';
      }) }, channel: null, channelGeneration: 0, channelRetirement: null,
      channelHealthy: false, channelRecoveryAttempts: 0, channelRecoveryInFlight: false,
      channelRecoveryTimer: null, tracked: true, ready: true, role: 'host', roomCode: 'ZDU8Z6',
      playerId: 'host', joinOrder: 0, members: [], transport: { peers: new Map(), ensureGuest: vi.fn() },
      _timers: new Set(), _status: vi.fn(),
      _startHostAnnouncements: vi.fn(), _onAdmissionRequest: vi.fn(),
      _onAdmissionResponse: vi.fn(), _onHostAnnouncement: vi.fn(), _onSignal: vi.fn(),
      _onPresenceSync: vi.fn(),
    });

    const opening = connectRoomChannel(session);
    channels[0].subscription('SUBSCRIBED');
    await expect(opening).resolves.toBe(true);
    const staleAck = sendRoomMessage(session, 'signal', { to: 'guest', attempt: 1 }, true);
    const staleAmbiguous = sendRoomMessage(session, 'signal', { to: 'guest', attempt: 1 }, true);
    channels[0].subscription(failure);
    channels[0].subscription(failure);
    expect(session.supabase.removeChannel).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(channels).toHaveLength(2));
    expect(session.supabase.removeChannel.mock.invocationCallOrder[0])
      .toBeLessThan(session.supabase.channel.mock.invocationCallOrder[1]);
    channels[0].sendResolvers[0]('ok'); channels[0].sendResolvers[1]('timed out');
    await expect(staleAck).resolves.toBe(true);
    await expect(staleAmbiguous).resolves.toBeNull();
    channels[1].subscription('SUBSCRIBED');
    await vi.waitFor(() => expect(session._startHostAnnouncements).toHaveBeenCalledOnce());

    expect(session.supabase.channel.mock.calls[0][1].config.broadcast).toEqual({ self: false, ack: true });
    expect(channels[1].track).toHaveBeenCalledWith({ playerId: 'host', joinOrder: 0, worldVersion: 2 });
    channels[0].emit('admission-request', { playerId: 'late' });
    channels[0].subscription('SUBSCRIBED');
    expect(session._onAdmissionRequest).not.toHaveBeenCalled();
    expect(session.channel).toBe(channels[1]);
    },
  );

  it('gates broadcasts until joined and returns only a current acknowledgement', async () => {
    const channel = {
      state: 'joining', channelAdapter: { canPush: () => true }, send: vi.fn().mockResolvedValue('ok'),
    };
    const session = Object.assign(Object.create(MultiplayerSession.prototype), {
      channel, channelGeneration: 2, channelHealthy: false, role: 'guest', hostId: 'host',
      playerId: 'guest', epoch: 1, pausedSignal: null, transport: { peers: new Map() },
    });
    await expect(Promise.all(Array.from({ length: 8 }, () => sendRoomMessage(session, 'event', {}))))
      .resolves.toEqual(Array(8).fill(false));
    await expect(session._signal('host', { kind: 'restart', attempt: 4 })).resolves.toBe(false);
    expect(session.pausedSignal).toBeNull();
    expect(channel.send).not.toHaveBeenCalled();
    channel.state = 'joined'; session.channelHealthy = true;
    await expect(sendRoomMessage(session, 'event', { value: 1 })).resolves.toBe(true);
    expect(channel.send).toHaveBeenCalledWith(
      { type: 'broadcast', event: 'event', payload: { value: 1 } }, { timeout: 2500 },
    );
  });

  it.each(['error', 'timed out', 'rejection'])('keeps a pushable channel after an ambiguous %s result', async (result) => {
    const send = result === 'rejection' ? Promise.reject(new Error('offline')) : Promise.resolve(result);
    const old = {
      state: 'joined', channelAdapter: { canPush: () => true }, send: vi.fn(() => send), teardown: vi.fn(),
    };
    const replacement = { on: vi.fn(() => replacement), subscribe: vi.fn(() => replacement) };
    const session = {
      channel: old, channelGeneration: 1, channelHealthy: true, channelRecoveryInFlight: false,
      channelRecoveryAttempts: 0, tracked: true, roomCode: 'ZDU8Z6', playerId: 'host',
      supabase: { channel: vi.fn(() => replacement), removeChannel: vi.fn() }, _timer: vi.fn(() => 1), _status: vi.fn(),
    };
    await expect(sendRoomMessage(session, 'event', {})).resolves.toBeNull();
    expect(session.channel).toBe(old);
    expect(session.channelHealthy).toBe(true);
    expect(session.supabase.removeChannel).not.toHaveBeenCalled();
    expect(old.teardown).not.toHaveBeenCalled();
  });

  it('retires once before replacing and subscribing a joined channel that cannot push', async () => {
    const old = {
      state: 'joined', channelAdapter: { canPush: () => false }, send: vi.fn(), teardown: vi.fn(),
    };
    const replacement = {
      state: 'joining', on: vi.fn(() => replacement),
      subscribe: vi.fn((callback) => { replacement.subscription = callback; return replacement; }),
    };
    const session = {
      channel: old, channelGeneration: 1, channelHealthy: true, channelRecoveryInFlight: false,
      channelRecoveryAttempts: 0, channelRetirement: null, tracked: true,
      roomCode: 'ZDU8Z6', playerId: 'host', _timers: new Set(),
      supabase: { channel: vi.fn(() => replacement), removeChannel: vi.fn().mockResolvedValue('ok') },
      _timer: vi.fn(() => 1), _status: vi.fn(), _resumeChannel: vi.fn(),
    };
    await expect(sendRoomMessage(session, 'event', {})).resolves.toBe(false);
    expect(old.send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(replacement.subscribe).toHaveBeenCalledOnce());
    expect(session.supabase.removeChannel).toHaveBeenCalledOnce();
    expect(session.supabase.removeChannel).toHaveBeenCalledWith(old);
    expect(session.supabase.channel).toHaveBeenCalledOnce();
    expect(session.channel).toBe(replacement);
    expect(session._resumeChannel).not.toHaveBeenCalled();
    replacement.subscription('SUBSCRIBED');
    await vi.waitFor(() => expect(session._resumeChannel).toHaveBeenCalledWith(2));
  });

  it('resumes host enrollment and one exact guest restart only after retracking', async () => {
    const host = Object.assign(Object.create(MultiplayerSession.prototype), {
      channelGeneration: 2, ready: true, tracked: true, role: 'host', playerId: 'host',
      members: [{ playerId: 'host' }, { playerId: 'guest' }], transport: { ensureGuest: vi.fn() },
      _trackMembership: vi.fn(), _startHostAnnouncements: vi.fn(), _status: vi.fn(),
    });
    await host._resumeChannel(2);
    expect(host.transport.ensureGuest).toHaveBeenCalledOnce();
    const guest = Object.assign(Object.create(MultiplayerSession.prototype), {
      channelGeneration: 3, ready: true, tracked: true, role: 'guest', hostId: 'host',
      pausedSignal: { id: 'host', attempt: 7 }, transport: { peers: new Map() },
      channelHealthy: true, channel: { state: 'joined' },
      _trackMembership: vi.fn(), _signal: vi.fn().mockResolvedValue(null), _status: vi.fn(),
    });
    await guest._resumeChannel(3); await guest._resumeChannel(3);
    expect(guest._signal).toHaveBeenCalledOnce();
    expect(guest._signal).toHaveBeenCalledWith('host', { kind: 'restart', attempt: 7 });
    expect(guest.pausedSignal).toBeNull();
  });

  it('requests one re-offer after selecting a changed host and not on repeated announcements', () => {
    const session = Object.assign(Object.create(MultiplayerSession.prototype), {
      hostId: 'old-host',
      role: 'guest',
      epoch: 1,
      icePath: 'direct',
      ledger: { startEpoch: vi.fn() },
      admissions: { clear: vi.fn() },
      transport: { closeAll: vi.fn() },
      _signal: vi.fn(),
      _status: vi.fn(),
    });

    session._selectHost('new-host', 2);
    expect(session.transport.closeAll).toHaveBeenCalledOnce();
    expect(session._signal).toHaveBeenCalledWith('new-host', { kind: 'restart' });
    expect(session.transport.closeAll.mock.invocationCallOrder[0])
      .toBeLessThan(session._signal.mock.invocationCallOrder[0]);

    session._selectHost('new-host', 2);
    expect(session._signal).toHaveBeenCalledOnce();
  });

  it('states that an admitted room may still be connecting peer links', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('Room joined');
    expect(html).toContain('Enter your expedition when the world is ready.');
  });

  it('keeps first intent ids unique across fresh sessions for the same stable player and epoch', () => {
    const sessions = [new MultiplayerSession(), new MultiplayerSession()];
    for (const session of sessions) {
      Object.assign(session, {
        ready: true, snapshotReady: true,
        playerId: 'stable-player',
        role: 'guest',
        hostId: 'host',
        epoch: 2,
        transport: { sendControl: vi.fn(() => true) },
      });
      session.submitMutation({ x: 1, y: 2, z: 3, blockId: 0 });
    }
    const ids = sessions.map((session) => session.transport.sendControl.mock.calls[0][1].intent.intentId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.every((id) => id.endsWith(':2:1'))).toBe(true);
  });

  it('reports truthful paths and backs retries off at 1.5, 3, and capped 6 seconds', async () => {
    vi.useFakeTimers();
    const session = new MultiplayerSession();
    session._status = vi.fn();
    session.ready = true;
    session.transport.options.onPath('connecting');
    expect(session._status).toHaveBeenLastCalledWith('ready', 'Establishing peer links...');
    session.transport.options.onPath('direct');
    expect(session._status).toHaveBeenLastCalledWith('ready', 'All peer connections ready.');

    const peers = new Map(), launches = [];
    Object.assign(session, {
      ready: true, role: 'host', playerId: 'host', members: [{ playerId: 'host' }, { playerId: 'guest' }],
      transport: { peers, ensureGuest: vi.fn((id) => {
        if (peers.has(id)) return false;
        peers.set(id, {}); launches.push(id); return true;
      }) },
    });
    for (const [attempt, delay] of [[1, 1500], [2, 3000], [3, 6000], [9, 6000]]) {
      peers.clear(); const before = launches.length;
      session._peerFailed('guest', attempt); session._peerFailed('guest', attempt);
      await vi.advanceTimersByTimeAsync(delay - 1); expect(launches).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1); expect(launches).toHaveLength(before + 1);
    }
    expect(session._status).toHaveBeenLastCalledWith('ready', 'Establishing peer links...');
  });

  it('restarts a missing guest host but preserves failure status if a peer returned', async () => {
    vi.useFakeTimers();
    const session = Object.assign(Object.create(MultiplayerSession.prototype), {
      ready: true, role: 'guest', hostId: 'host', icePath: 'direct', _timers: new Set(),
      transport: { peers: new Map() }, _signal: vi.fn(), _status: vi.fn(),
    });
    session._peerFailed('host', 6);
    await vi.advanceTimersByTimeAsync(5999);
    expect(session._signal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(session._signal).toHaveBeenCalledWith('host', { kind: 'restart', attempt: 6 });
    expect(session._status).toHaveBeenLastCalledWith('ready', 'Establishing peer links...');
    session._signal.mockClear(); session._status.mockClear();
    session._peerFailed('host', 7);
    session.transport.peers.set('host', {});
    await vi.advanceTimersByTimeAsync(6000);
    expect(session._signal).not.toHaveBeenCalled();
    expect(session._status).toHaveBeenLastCalledWith('rtc-failure', 'Peer connection failed. Retrying...');
  });
});

describe('serialized admission control', () => {
  function hostSession(sent) {
    const session = Object.assign(Object.create(MultiplayerSession.prototype), {
      role: 'host', ready: true, roomCode: 'ZDU8Z6', playerId: 'host', epoch: 1, seed: 55, mode: 'expedition', generation: 2,
      members: [], reservations: new Map(), memberOrders: new Map([['host', 0]]),
      transport: { closePeer: vi.fn() },
    });
    session.admissions = new AdmissionControl((response) => sent.push({ at: Date.now(), ...response }));
    return session;
  }

  it('uses one immediate request, one sparse retry, and a bounded admission timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = Object.assign(Object.create(MultiplayerSession.prototype), {
      role: 'guest', ready: false, admitting: false, channel: {}, channelHealthy: true,
      roomCode: 'ZDU8Z6', playerId: 'guest', admissionId: 'attempt-1',
      _timers: new Set(), _broadcast: vi.fn(), _status: vi.fn(),
      _trackMembership: vi.fn(), _markReady: vi.fn(),
    });

    session._requestAdmission();
    expect(session._broadcast).toHaveBeenCalledOnce();
    expect(session._broadcast.mock.calls[0][1].admissionId).toBe('attempt-1');
    await vi.advanceTimersByTimeAsync(9099);
    expect(session._broadcast).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(session._broadcast).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7400);
    expect(session._status).toHaveBeenCalledWith('not-found', expect.any(String));
    expect(session.admissionId).toBe('');

    await session._onAdmissionResponse({
      to: 'guest', admissionId: 'attempt-1', ok: true, worldVersion: 2,
      epoch: 1, joinOrder: 1, hostId: 'host',
    });
    await session._onAdmissionResponse({
      to: 'guest', admissionId: 'attempt-1', ok: false, reason: 'Room is full',
    });
    expect(session._trackMembership).not.toHaveBeenCalled();
    expect(session._status).toHaveBeenCalledOnce();
  });

  it('caches tickets, paces eight responses, and explicitly rejects the ninth participant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sent = [];
    const session = hostSession(sent);
    const requests = Array.from({ length: 8 }, (_, index) => ({
      roomCode: 'ZDU8Z6', worldVersion: 2, playerId: `guest-${index}`,
      admissionId: `admission-${index}`,
    }));
    session._onAdmissionRequest({ ...requests[0], worldVersion: 1 });
    expect(session.reservations.size).toBe(0);
    requests.forEach((request) => session._onAdmissionRequest(request));

    expect(sent).toHaveLength(0);
    expect(session.reservations.size).toBe(7);
    const firstReservation = session.reservations.get('guest-0');
    session._onAdmissionRequest(requests[0]);
    expect(session.reservations.get('guest-0')).toBe(firstReservation);
    await vi.advanceTimersByTimeAsync(ADMISSION_RESPONSE_CADENCE_MS - 1);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(7 * ADMISSION_RESPONSE_CADENCE_MS);

    expect(sent).toHaveLength(8);
    expect(sent.slice(0, 7).every((response) => response.ok && response.seed === 55 && response.mode === 'expedition' && response.generation === 2)).toBe(true);
    expect(sent[7]).toMatchObject({ to: 'guest-7', admissionId: 'admission-7', ok: false, reason: 'Room is full' });
    expect(sent[7].at).toBe(8 * ADMISSION_RESPONSE_CADENCE_MS);
    expect(firstReservation.expires).toBe(ADMISSION_TICKET_MS);

    await vi.advanceTimersByTimeAsync(ADMISSION_RESPONSE_CADENCE_MS);
    session._onAdmissionRequest(requests[0]);
    expect(sent.at(-1)).toMatchObject({ to: 'guest-0', admissionId: 'admission-0', ok: true, joinOrder: 1 });
    expect(session.reservations.get('guest-0')).toBe(firstReservation);
    session.reservations.delete('guest-6');
    await vi.advanceTimersByTimeAsync(ADMISSION_RESPONSE_CADENCE_MS);
    session._onAdmissionRequest(requests[7]);
    expect(sent.at(-1)).toMatchObject({ to: 'guest-7', admissionId: 'admission-7', ok: false, reason: 'Room is full' });

    vi.setSystemTime(ADMISSION_TICKET_MS);
    session._onAdmissionRequest(requests[7]);
    expect(sent.at(-1)).toMatchObject({ to: 'guest-7', admissionId: 'admission-7', ok: true, joinOrder: 8 });
  });

  it('ignores stale admission responses and keeps the worst burst below the free-tier rate', async () => {
    const session = Object.assign(Object.create(MultiplayerSession.prototype), {
      role: 'guest', ready: false, admitting: false, playerId: 'guest', admissionId: 'current',
      _clearAdmissionTimers: vi.fn(), _status: vi.fn(),
    });
    await session._onAdmissionResponse({ to: 'guest', admissionId: 'stale', ok: false, reason: 'Room is full' });
    expect(session._status).not.toHaveBeenCalled();

    expect(ADMISSION_RESPONSE_CADENCE_MS).toBeGreaterThan(1000);
    expect(FIRST_OFFER_DELAY_MS).toBeGreaterThan(1000);
    expect(OFFER_CADENCE_MS).toBeGreaterThan(2000);
    const initialBurstDeliveries = (8 + 1) * 9;
    const steadyControlDeliveries = (1 + 1 + 1 + 1 + 1) * 9;
    expect(initialBurstDeliveries).toBe(81);
    expect(steadyControlDeliveries).toBe(45);
    expect(Math.max(initialBurstDeliveries, steadyControlDeliveries)).toBeLessThan(100);
  });
});

describe('saved expedition room admission', () => {
  it('creates fresh codes, resets prior ledger, restores after world construction, and keeps seed/mode', async () => {
    vi.useFakeTimers();
    const events = [];
    const session = new MultiplayerSession({
      onReady: (room) => events.push(['world', room]),
      applyMutation: (commit) => events.push(['block', commit.blockId]),
      onSnapshot: () => events.push(['snapshot']),
    });
    session.configurationError = '';
    session.supabase = { removeChannel: async () => 'ok', channel: () => {
      const channel = { on: () => channel, subscribe: (callback) => callback('SUBSCRIBED'),
        track: async () => 'ok', untrack: async () => 'ok', teardown: () => {} };
      return channel;
    } };
    session._startHostAnnouncements = vi.fn();
    const snapshot = { epoch: 3, lastSeq: 1, entries: [
      { epoch: 3, seq: 1, intentId: 'saved', x: 0, y: 12, z: 0, blockId: 0 },
    ], intentIds: ['saved'], supplies: { 4: 1 } };
    const opening = session.createRoom({ seed: 1234, mode: 'expedition', snapshot });
    expect(await session.createRoom({ seed: 9876 })).toBe(false);
    expect(await opening).toBe(true);
    const firstCode = session.roomCode;
    expect(events.map(([kind]) => kind)).toEqual(['world', 'block', 'snapshot']);
    expect(events[0][1]).toMatchObject({ seed: 1234, mode: 'expedition' });
    expect(session.ledger.epoch).toBe(3);
    expect(session.generation).toBe(1);
    expect(session.ledger.generation).toBe(1);
    expect(session.ledger.supplies).toEqual({ 4: 1 });
    expect(session.snapshotReady).toBe(true);
    expect(await session.createRoom({ seed: 1234, mode: 'creative' })).toBe(true);
    expect(session.roomCode).not.toBe(firstCode);
    expect(session.ledger.snapshot()).toMatchObject({ epoch: 1, lastSeq: 0, entries: [], supplies: {}, intentIds: [] });
    expect(session.seed).toBe(1234);
    expect(session.generation).toBe(3);
    expect(session.ledger.generation).toBe(3);
    expect(await session.createRoom({ generation: 4 })).toBe(false);
    expect(await session.createRoom({ generation: 2, snapshot })).toBe(false);
    expect(await session.createRoom({ seed: -1 })).toBe(false);
    expect(await session.createRoom({ snapshot: { ...snapshot, supplies: { 13: 1 } } })).toBe(false);
    await session.destroy();
  });

  it('rejects missing or invalid room descriptors before admission and propagates valid seeds', async () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const session = new MultiplayerSession({ onReady: ready });
    Object.assign(session, { role: 'guest', playerId: 'guest', admissionId: 'join-attempt',
      channel: { track: async () => 'ok' }, _status: vi.fn() });
    const response = { to: 'guest', admissionId: 'join-attempt', ok: true, worldVersion: 2,
      epoch: 2, joinOrder: 1, hostId: 'host' };
    for (const descriptor of [{}, { seed: -1, mode: 'expedition' }, { seed: 1, mode: 'invalid' }, { seed: 1, mode: 'creative', generation: 4 }]) {
      await session._onAdmissionResponse({ ...response, ...descriptor });
      expect(ready).not.toHaveBeenCalled();
    }
    await session._onAdmissionResponse({ ...response, seed: 4294967295, mode: 'creative', generation: 2 });
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ seed: 4294967295, mode: 'creative', generation: 2 }));
    expect(session.snapshotReady).toBe(false);
    expect(session.submitCraft('planks')).toBe(false);
    await session.destroy();
  });
});
