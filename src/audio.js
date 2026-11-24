// Efectos de sonido sintetizados con WebAudio: no hay archivos de audio.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      // búfer de ruido blanco reutilizable
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.buildSiren();
    } catch (e) {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
    return this.muted;
  }

  noise(dur, freq, vol, type = 'lowpass') {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  tone(freq, dur, vol, type = 'sine', endFreq = null, delay = 0) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot() {
    if (!this.ctx) return;
    this.noise(0.22, 3200, 0.9);
    this.tone(150, 0.12, 0.6, 'triangle', 40);
  }

  copShot(dist) {
    if (!this.ctx) return;
    const v = Math.max(0.05, 1 - dist / 70) * 0.6;
    this.noise(0.2, 1800, v);
    this.tone(120, 0.1, v * 0.6, 'triangle', 40);
  }

  click() {
    if (!this.ctx) return;
    this.tone(900, 0.04, 0.2, 'square');
  }

  reload() {
    if (!this.ctx) return;
    this.tone(500, 0.05, 0.15, 'square');
    this.tone(700, 0.05, 0.15, 'square', null, 0.25);
  }

  cash() {
    if (!this.ctx) return;
    this.tone(880, 0.12, 0.25, 'sine');
    this.tone(1320, 0.25, 0.25, 'sine', null, 0.08);
  }

  bank() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 0.22, 'triangle', null, i * 0.09));
  }

  alarm() {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) this.tone(1400, 0.12, 0.18, 'square', null, i * 0.2);
  }

  hurt() {
    if (!this.ctx) return;
    this.tone(180, 0.18, 0.35, 'sawtooth', 70);
  }

  hit(head) {
    if (!this.ctx) return;
    this.tone(head ? 1800 : 1100, 0.06, 0.2, 'square');
  }

  buy() {
    if (!this.ctx) return;
    this.tone(660, 0.08, 0.2, 'triangle');
    this.tone(990, 0.15, 0.2, 'triangle', null, 0.07);
  }

  buildSiren() {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 700;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.9;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1600;
    this.sirenGain = c.createGain();
    this.sirenGain.gain.value = 0;
    o.connect(f).connect(this.sirenGain).connect(this.master);
    o.start();
    lfo.start();
  }

  setSiren(level) {
    if (!this.ctx || !this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(level * 0.05, this.ctx.currentTime, 0.4);
  }
}
