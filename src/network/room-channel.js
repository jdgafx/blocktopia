import { WORLD_VERSION } from './protocol.js';

export function createRoomChannel(session, generation) {
  const channel = session.supabase.channel(`blocktopia:${WORLD_VERSION}:${session.roomCode}`, {
    config: { private: true, presence: { key: session.playerId }, broadcast: { self: false, ack: true } },
  });
  const active = () => session.channel === channel && session.channelGeneration === generation;
  channel
    .on('broadcast', { event: 'admission-request' }, ({ payload }) => active() && session._onAdmissionRequest(payload))
    .on('broadcast', { event: 'admission-response' }, ({ payload }) => active() && session._onAdmissionResponse(payload))
    .on('broadcast', { event: 'host-announcement' }, ({ payload }) => active() && session._onHostAnnouncement(payload))
    .on('broadcast', { event: 'signal' }, ({ payload }) => active() && session._onSignal(payload))
    .on('presence', { event: 'sync' }, () => active() && session._onPresenceSync());
  return channel;
}

function canPush(channel) {
  try { return channel.state === 'joined' && channel.channelAdapter?.canPush() === true; } catch { return false; }
}

export async function pauseRoomSignal(session, id, attempt) {
  if (!Number.isInteger(attempt)) return false;
  const peer = session.transport.peers.get(id);
  if (session.role === 'host') {
    if (id === session.playerId || peer || !session.channelHealthy
      || !session.members.some((member) => member.playerId === id)) return false;
    return session.transport.ensureGuest(id);
  }
  if (session.role !== 'guest' || id !== session.hostId) return false;
  const saved = session.pausedSignal;
  if (saved?.id === id && (saved.attempt > attempt || saved.sending)) return false;
  if (!saved || saved.id !== id || saved.attempt < attempt) session.pausedSignal = { id, attempt };
  const pending = session.pausedSignal, current = session.transport.peers.get(id);
  if (current) {
    if (current.attempt > attempt) session.pausedSignal = null;
    return false;
  }
  if (!session.channelHealthy || session.channel?.state !== 'joined') return false;
  pending.sending = true;
  const sent = await session._signal(id, { kind: 'restart', attempt });
  if (session.pausedSignal === pending) {
    if (sent !== false) session.pausedSignal = null;
    else delete pending.sending;
  }
  return sent;
}

export async function sendRoomMessage(session, event, payload, critical = false) {
  const channel = session.channel, generation = session.channelGeneration;
  const active = () => channel && session.channel === channel && session.channelGeneration === generation;
  if (!active() || !session.channelHealthy) return false;
  if (!canPush(channel)) {
    session.channelHealthy = false;
    recoverRoomChannel(session, generation);
    return false;
  }
  let result;
  try { result = await channel.send({ type: 'broadcast', event, payload }, { timeout: 2500 }); } catch {}
  if (result === 'ok') return true;
  if (!active() || canPush(channel)) return null;
  session.channelHealthy = false;
  recoverRoomChannel(session, generation);
  return false;
}

export function subscribeRoomChannel(session, channel, generation) {
  return new Promise((resolve) => {
    let subscribed = false;
    let settled = false;
    let timeout;
    const active = () => session.channel === channel && session.channelGeneration === generation;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      session._timers.delete(timeout);
      resolve(value);
    };
    timeout = session._timer(() => finish(false), 8000);
    channel.subscribe((status) => {
      if (!active()) return;
      if (status === 'SUBSCRIBED') {
        const rejoined = subscribed && !session.channelHealthy;
        subscribed = true;
        session.channelHealthy = true;
        finish(true);
        if (rejoined) session._resumeChannel(generation);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        session.channelHealthy = false;
        if (!subscribed) finish(false);
        else recoverRoomChannel(session, generation);
      }
    });
  });
}

export async function connectRoomChannel(session) {
  const retirement = session.channelRetirement;
  if (retirement) {
    const result = retirement.removed ? 'ok' : await retirement.promise;
    if (result !== 'ok') throw new Error('Room channel retirement failed');
    retirement.removed = true;
    if (session.channelRetirement === retirement) session.channelRetirement = null;
  }
  const generation = ++session.channelGeneration;
  const channel = createRoomChannel(session, generation);
  if (channel === retirement?.channel) throw new Error('Room channel was not retired');
  session.channel = channel;
  return subscribeRoomChannel(session, channel, generation);
}

export async function recoverRoomChannel(session, generation) {
  if (generation !== session.channelGeneration || session.channelRecoveryInFlight) return;
  let retirement = session.channelRetirement;
  if (!retirement) {
    if (!session.channel) return;
    retirement = { channel: session.channel, removed: false, promise: null };
    session.channelRetirement = retirement;
    session.channel = null;
    session.tracked = false;
    generation = ++session.channelGeneration;
  }
  session.channelRecoveryInFlight = true;
  session._status('connecting', 'Room service reconnecting...');
  let connected = false;
  try {
    if (!retirement.removed) {
      retirement.promise ||= session.supabase.removeChannel(retirement.channel);
      const removed = await retirement.promise;
      retirement.promise = null;
      if (removed !== 'ok') throw new Error('Room channel retirement failed');
      retirement.removed = true;
    }
    if (generation !== session.channelGeneration || session.channelRetirement !== retirement) return;
    const replacement = createRoomChannel(session, generation);
    if (replacement === retirement.channel) throw new Error('Room channel was not retired');
    session.channel = replacement;
    session.channelRetirement = null;
    connected = await subscribeRoomChannel(session, replacement, generation);
  } catch { retirement.promise = null; }
  if (generation !== session.channelGeneration) return;
  session.channelRecoveryInFlight = false;
  if (connected) {
    session.channelRecoveryAttempts = 0;
    await session._resumeChannel(generation);
    return;
  }
  const delay = Math.min(1000 * (2 ** session.channelRecoveryAttempts++), 5000);
  session.channelRecoveryTimer = session._timer(() => {
    session.channelRecoveryTimer = null;
    recoverRoomChannel(session, generation);
  }, delay);
}
