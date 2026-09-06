// Authenticated SQL stamps the sender; clients cannot publish to this private topic.
// RTC remains the ordered recovery path for reconnects and Broadcast delivery gaps.
export class VoxelBroadcast {
  constructor(session) {
    this.session = session; this.ready = false; this.closed = false;
    this.room = session.roomCode;
    this.channel = session.supabase.channel(`blocktopia-voxel:${this.room}`, { config: { private: true, broadcast: { ack: true } } })
      .on('broadcast', { event: 'voxel' }, ({ payload }) => this.receive(payload))
      .subscribe(status => { this.ready = !this.closed && status === 'SUBSCRIBED'; });
  }
  receive(payload) {
    const s = this.session;
    if (this.closed || s.roomCode !== this.room || !s.ready || !payload || payload.from === s.playerId
      || !s.members.some(member => member.playerId === payload.from)) return;
    const message = payload.message;
    if ((s.role === 'host' && message?.t === 'intent' && message.intent?.kind === 'block')
      || (s.role === 'guest' && payload.from === s.hostId && message?.t === 'commit' && message.commit?.kind === 'block')) {
      // The existing host validates position, inventory, replay ID, rate and epoch.
      if (message.t === 'intent' && s.ledger.seenIntentIds.has(message.intent.intentId)) return;
      s._onControl(payload.from, message);
    }
  }
  async send(message) {
    if (!this.ready || this.closed || this.session.roomCode !== this.room) return false;
    try {
      const { error } = await this.session.supabase.rpc('broadcast_voxel_event', {
        room: this.room, peer: this.session.playerId, message,
      });
      return !error;
    } catch { return false; }
  }
  close() {
    this.closed = true; this.ready = false;
    this.session.supabase.removeChannel(this.channel).catch(() => {});
  }
}
