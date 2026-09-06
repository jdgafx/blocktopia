export const ADMISSION_RESPONSE_CADENCE_MS = 1001;
export const ADMISSION_TICKET_MS = 18000;

export function stablePlayerId(storage, random = crypto) {
  const key = 'blocktopia-player-id';
  try {
    storage ??= sessionStorage;
    let id = storage.getItem(key);
    if (!id) {
      id = random.randomUUID();
      storage.setItem(key, id);
    }
    return id;
  } catch {
    return random.randomUUID();
  }
}

function ticketKey(playerId, admissionId) {
  return `${playerId}\0${admissionId}`;
}

export class AdmissionControl {
  constructor(send, options = {}) {
    this.send = send;
    this.now = options.now ?? Date.now;
    this.cadence = options.cadence ?? ADMISSION_RESPONSE_CADENCE_MS;
    this.ttl = options.ttl ?? ADMISSION_TICKET_MS;
    this.cache = new Map();
    this.queue = [];
    this.pending = new Set();
    this.lastSentAt = -Infinity;
    this.timer = null;
  }

  ticket(playerId, admissionId, decide) {
    this.purge();
    const key = ticketKey(playerId, admissionId);
    let ticket = this.cache.get(key);
    if (!ticket) {
      const now = this.now();
      ticket = {
        key,
        playerId,
        admissionId,
        expires: now + this.ttl,
        response: decide(now, now + this.ttl),
        lastSentAt: -Infinity,
      };
      this.cache.set(key, ticket);
    }
    return ticket;
  }

  respond(ticket) {
    if (ticket.expires <= this.now() || this.pending.has(ticket.key)
      || this.now() - ticket.lastSentAt < this.cadence) return false;
    this.pending.add(ticket.key);
    this.queue.push(ticket);
    this._drain();
    return true;
  }

  purge() {
    const now = this.now();
    for (const [key, ticket] of this.cache) {
      if (ticket.expires <= now) this.cache.delete(key);
    }
  }

  _drain() {
    if (this.timer || !this.queue.length) return;
    if (this.lastSentAt === -Infinity) this.lastSentAt = this.now();
    const wait = Math.max(0, this.lastSentAt + this.cadence - this.now());
    if (wait) {
      this.timer = setTimeout(() => { this.timer = null; this._drain(); }, wait);
      return;
    }
    const ticket = this.queue.shift();
    this.pending.delete(ticket.key);
    if (ticket.expires > this.now()) {
      ticket.lastSentAt = this.lastSentAt = this.now();
      this.send(ticket.response);
    }
    if (this.queue.length) {
      this.timer = setTimeout(() => { this.timer = null; this._drain(); }, this.cadence);
    }
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    this.pending.clear();
    this.cache.clear();
    this.lastSentAt = -Infinity;
  }
}
