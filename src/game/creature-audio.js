// Intentionally synthesized creature calls, not animal field recordings.
const CALLS = {
  sauropod: { pitch: 48, end: 29, duration: 1.8, type: 'triangle', filter: 310, noise: .2, vibrato: 5 },
  triceratops: { pitch: 105, end: 55, duration: 1.1, type: 'sawtooth', filter: 560, noise: .25, vibrato: 13 },
  raptor: { pitch: 520, end: 190, duration: .65, type: 'triangle', filter: 1500, noise: .18, vibrato: 21 },
  stegosaur: { pitch: 85, end: 48, duration: 1.3, type: 'triangle', filter: 480, noise: .24, vibrato: 11 },
  mammoth: { pitch: 165, end: 90, duration: 1.6, type: 'sawtooth', filter: 940, noise: .09, vibrato: 7 },
  griffin: { pitch: 780, end: 270, duration: 1.05, type: 'sawtooth', filter: 2100, noise: .13, vibrato: 28 },
  'forest-dragon': { pitch: 61, end: 32, duration: 1.7, type: 'sawtooth', filter: 420, noise: .35, vibrato: 15 },
  moonstag: { pitch: 290, end: 205, duration: .95, type: 'sine', filter: 950, noise: .035, vibrato: 6 },
};

export class CreatureAudio {
  constructor() {
    this.context = null; this.voices = new Set(); this.cooldowns = new Map(); this.time = 0; this.nextCall = 0; this.disposed = false;
  }

  async unlock() {
    if (this.disposed) return false;
    try {
      const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioContext) return false;
      this.context ??= new AudioContext();
      await this.context.resume();
      if (this.disposed) { await this.context.close(); return false; }
      if (!this.noise) {
        this.noise = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      return this.context.state === 'running';
    } catch { return false; }
  }

  update(dt, observer, state) {
    if (this.disposed) return;
    this.time += Math.max(0, Math.min(.25, dt || 0));
    const creatures = state?.creatures ?? {};
    for (const id of this.cooldowns.keys()) if (!creatures[id]) this.cooldowns.delete(id);
    if (!this.context || this.context.state !== 'running') return;
    for (const voice of this.voices) {
      const c = creatures[voice.id];
      if (!c || c.health <= 0 || c.harvested || c.active === false) voice.gain.gain.setTargetAtTime(0, this.context.currentTime, .06);
      else this._position(voice, observer, c);
    }
    if (this.time < this.nextCall || this.voices.size >= 2) return;
    let selected, distance = 30;
    for (const [id, c] of Object.entries(creatures)) {
      if (!CALLS[c.species] || c.active === false || c.harvested || c.health <= 0 || c.behavior === 'dead' || c.behavior === 'resting' || (this.cooldowns.get(id) ?? 0) > this.time) continue;
      const d = Math.hypot(c.x - observer.x, c.y - observer.y, c.z - observer.z);
      if (d < distance) { selected = [id, c]; distance = d; }
    }
    if (!selected) return;
    const [id, creature] = selected;
    try {
      this._call(id, creature, observer);
      this.cooldowns.set(id, this.time + 10 + Math.random() * 12);
      this.nextCall = this.time + 2.5 + Math.random() * 2;
    } catch { this.nextCall = this.time + 5; }
  }

  _position(voice, observer, c) {
    const dx = c.x - observer.x, dz = c.z - observer.z;
    const distance = Math.hypot(dx, c.y - observer.y, dz), yaw = observer.yaw || 0;
    voice.gain.gain.setTargetAtTime(.16 / (1 + distance * distance / 36), this.context.currentTime, .08);
    voice.pan.pan.setTargetAtTime(Math.sin(Math.atan2(dx, dz) - yaw) * Math.min(1, distance / 3), this.context.currentTime, .08);
  }

  _call(id, creature, observer) {
    const ctx = this.context, p = CALLS[creature.species], now = ctx.currentTime;
    const osc = ctx.createOscillator(), vibrato = ctx.createOscillator(), depth = ctx.createGain();
    const breath = ctx.createBufferSource(), breathGain = ctx.createGain(), filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
    const nodes = [osc, vibrato, depth, breath, breathGain, filter, envelope, gain, pan];
    const voice = { id, gain, pan, nodes, sources: [osc, breath, vibrato] };
    const alarm = ['fleeing', 'defending', 'hunting'].includes(creature.behavior), pitch = alarm ? 1.18 : 1;
    osc.type = p.type; osc.frequency.setValueAtTime(p.pitch * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(p.pitch * 1.22 * pitch, now + p.duration * .18);
    osc.frequency.exponentialRampToValueAtTime(p.end * pitch, now + p.duration);
    vibrato.frequency.value = p.vibrato; depth.gain.value = p.pitch * .075;
    vibrato.connect(depth); depth.connect(osc.frequency);
    breath.buffer = this.noise; breathGain.gain.value = p.noise;
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(p.filter, now); filter.frequency.exponentialRampToValueAtTime(p.filter * .48, now + p.duration); filter.Q.value = creature.species === 'mammoth' ? 2.8 : .8;
    envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(.55, now + .08);
    envelope.gain.setTargetAtTime(.25, now + p.duration * .28, .14); envelope.gain.linearRampToValueAtTime(0, now + p.duration);
    osc.connect(filter); breath.connect(breathGain); breathGain.connect(filter); filter.connect(envelope); envelope.connect(gain); gain.connect(pan); pan.connect(ctx.destination);
    this._position(voice, observer, creature); this.voices.add(voice);
    osc.onended = () => { nodes.forEach(node => node.disconnect()); this.voices.delete(voice); };
    for (const source of voice.sources) { source.start(now); source.stop(now + p.duration + .03); }
  }

  dispose() {
    this.disposed = true;
    for (const voice of this.voices) {
      for (const source of voice.sources) { try { source.stop(); } catch { /* Already ended. */ } }
      voice.nodes.forEach(node => node.disconnect());
    }
    this.voices.clear(); this.cooldowns.clear(); this.noise = null;
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
  }
}
