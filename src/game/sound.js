/**
 * All game audio, synthesised with the Web Audio API: no sound files.
 *
 * Continuous layers (wind, city hum, waves) follow the flight and the surroundings every frame;
 * birdsong and crickets are scheduled randomly; one-shot effects are small synth recipes.
 * Browsers only allow audio after a user gesture, so call unlock() from a click or key press.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
    this.nextSong = 0;
    this.nextCricket = 0;
  }

  /** Creates or resumes the audio context; must run inside a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // Two seconds of white noise, reused by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Brown noise for low rumbles (integrated white noise).
    this.brown = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }

    this.wind = this.loop(this.noise, 'bandpass', 600, 0.8);
    this.rumble = this.loop(this.brown, 'lowpass', 180, 0.7);
    this.city = this.loop(this.brown, 'lowpass', 320, 0.5);
    this.waves = this.loop(this.brown, 'lowpass', 900, 0.4);
    this.wavePhase = 0;
  }

  /** A looping noise source through a filter and a gain that starts silent. */
  loop(buffer, type, frequency, q) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(0, Math.random() * 2);
    return { source, filter, gain };
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : volume, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  setPaused(paused) {
    if (!this.ctx) return;
    if (paused) this.ctx.suspend();
    else this.ctx.resume();
  }

  /**
   * Called every frame.
   * @param s { speed m/s, flapping, beat (a wing beat started this frame), diving, perched, height above
   *            ground in m, surroundings { water, green, built, trees }, night 0..1 }
   */
  update(dt, s) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const set = (param, value, smooth = 0.15) => param.setTargetAtTime(value, t, smooth);

    // Wind: louder and brighter with speed; a deep rumble joins in steep dives.
    const v = Math.min(s.speed / 30, 2.5);
    set(this.wind.gain.gain, s.perched ? 0.01 : 0.015 + 0.09 * v * v);
    set(this.wind.filter.frequency, 350 + 650 * v);
    set(this.rumble.gain.gain, s.diving ? 0.08 + 0.12 * Math.max(0, v - 1) : 0.0);

    // Ground sounds fade out with height.
    const near = Math.max(0, 1 - s.height / 220);
    const env = s.surroundings ?? { water: 0, green: 0, built: 0, trees: 0 };
    set(this.city.gain.gain, 0.16 * env.built * near * (1 - 0.5 * s.night), 0.6);
    this.wavePhase += dt * 0.9;
    const swell = 0.55 + 0.45 * Math.sin(this.wavePhase) * Math.sin(this.wavePhase * 0.37 + 1);
    set(this.waves.gain.gain, 0.22 * env.water * near * swell, 0.3);

    if (s.beat) this.wingBeat(s.perched ? 0.3 : 1);

    // Birdsong by day near trees and parks; crickets at night over green.
    const now = performance.now();
    const leafy = Math.min(1, env.trees / 8 + env.green);
    if (s.night < 0.5 && leafy > 0.25 && near > 0.3 && now > this.nextSong) {
      this.chirp(leafy * near);
      this.nextSong = now + 600 + Math.random() * 3200 / leafy;
    }
    if (s.night > 0.5 && env.green > 0.2 && near > 0.3 && now > this.nextCricket) {
      this.crickets(env.green * near);
      this.nextCricket = now + 900 + Math.random() * 1600;
    }
  }

  // ---- One-shot sounds ----

  play(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const recipe = {
      eat: () => this.tones([[660, 0], [990, 0.06]], 'sine', 0.09, 0.18),
      branch: () => this.burst(2400, 6, 0.06, 0.35, 'highpass'),
      land: () => this.burst(220, 1, 0.14, 0.3, 'lowpass'),
      bump: () => this.burst(140, 1, 0.25, 0.5, 'lowpass'),
      discover: () => this.tones([[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3]], 'triangle', 0.35, 0.16),
      level: () => this.tones([[392, 0], [523, 0.12], [659, 0.24], [784, 0.36], [1047, 0.5]], 'triangle', 0.45, 0.2),
      ring: () => this.tones([[880, 0], [1320, 0.05]], 'sine', 0.2, 0.18),
      success: () => this.tones([[523, 0], [784, 0.15], [1047, 0.3], [1568, 0.45]], 'triangle', 0.6, 0.2),
      fail: () => this.tones([[392, 0], [311, 0.2], [233, 0.4]], 'triangle', 0.4, 0.16),
      warning: () => this.tones([[880, 0], [660, 0.15], [880, 0.3]], 'square', 0.12, 0.06),
      hawk: () => this.screech(),
      hit: () => { this.burst(160, 1, 0.3, 0.5, 'lowpass'); this.burst(1800, 2, 0.15, 0.25, 'bandpass'); },
    }[name];
    recipe?.();
  }

  /** A short filtered noise burst. */
  burst(frequency, q, duration, level, type = 'bandpass') {
    const ctx = this.ctx, t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t, Math.random() * 1.5);
    source.stop(t + duration + 0.05);
  }

  /** A sequence of notes: [[frequency, start offset], ...], each `length` seconds long. */
  tones(notes, type, length, level) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [frequency, offset] of notes) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime(level, t + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + length);
      osc.connect(gain).connect(this.master);
      osc.start(t + offset);
      osc.stop(t + offset + length + 0.05);
    }
  }

  /** The "whup" of one wing beat. */
  wingBeat(strength) {
    this.burst(500 + Math.random() * 200, 0.9, 0.16, 0.12 * strength);
  }

  /** A little songbird phrase: a few quick upward sweeps. */
  chirp(level) {
    const ctx = this.ctx, t = ctx.currentTime;
    const base = 2200 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master);
    for (let i = 0; i < notes; i++) {
      const start = t + i * (0.09 + Math.random() * 0.05);
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), start);
      osc.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), start + 0.06);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.05 * level, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
      osc.connect(gain).connect(pan);
      osc.start(start);
      osc.stop(start + 0.1);
    }
  }

  /** A train of short high pulses. */
  crickets(level) {
    const ctx = this.ctx, t = ctx.currentTime;
    const frequency = 4200 + Math.random() * 800;
    for (let i = 0; i < 6; i++) {
      const start = t + i * 0.045;
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.02 * level, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.03);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.04);
    }
  }

  /** A raptor's descending scream with a little vibrato. */
  screech() {
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(3200, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.9);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 28;
    const depth = ctx.createGain();
    depth.gain.value = 90;
    vibrato.connect(depth).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + 1);
    vibrato.stop(t + 1);
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
  }
}
