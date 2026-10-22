// Camada de áudio procedural (Web Audio API). Não depende de arquivos externos;
// se o navegador não suportar áudio, todas as chamadas viram operações nulas.
import { CONFIG } from './config.js';
import { clamp, relativeYaw } from './utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.volume = CONFIG.audio.masterVolume;
    this.listener = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
    this.lastPlayed = new Map();
  }

  /** Deve ser chamado a partir de um gesto do usuário (clique em JOGAR). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.enabled;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.15;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.enabled = true;
    } catch (err) {
      console.warn('[audio] indisponível:', err);
      this.enabled = false;
      this.ctx = null;
    }
    return this.enabled;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  setListener(position, yaw) {
    this.listener.position = position;
    this.listener.yaw = yaw;
  }

  // ---- blocos de síntese ----------------------------------------------------
  _out(gain, pan) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  _noise(dest, t, dur, { type = 'lowpass', freq = 1000, freqEnd = null, q = 0.8, gain = 1, attack = 0.002 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  _tone(dest, t, dur, { type = 'sine', freq = 440, freqEnd = null, gain = 0.5, attack = 0.002 } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _spatial(at, baseGain, rolloff = 0.06) {
    if (!at) return { gain: baseGain, pan: 0 };
    const p = this.listener.position;
    const d = Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z);
    const gain = baseGain / (1 + d * rolloff);
    const pan = Math.sin(relativeYaw(p, this.listener.yaw, at)) * 0.8;
    return { gain, pan };
  }

  /** Toca um som pelo nome. Opções: { at: Vector3 } para posicionamento estéreo simples. */
  play(name, opts = {}) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    // limita repetições muito próximas do mesmo som (ex.: vários impactos no mesmo quadro)
    const now = this.ctx.currentTime;
    const minGap = { impact: 0.03, footstep: 0.12, hitBody: 0.02 }[name] || 0;
    if (minGap && now - (this.lastPlayed.get(name) || 0) < minGap) return;
    this.lastPlayed.set(name, now);
    const fn = this.sounds[name];
    if (fn) {
      try { fn.call(this, now, opts); } catch (err) { console.warn('[audio]', name, err); }
    }
  }

  sounds = {
    rifleShot(t) {
      const o = this._out(0.55);
      this._noise(o, t, 0.16, { type: 'lowpass', freq: 5200, freqEnd: 700, gain: 0.9 });
      this._noise(o, t, 0.05, { type: 'highpass', freq: 3000, gain: 0.35 });
      this._tone(o, t, 0.12, { freq: 150, freqEnd: 45, gain: 0.8 });
      this._noise(o, t + 0.02, 0.35, { type: 'bandpass', freq: 600, freqEnd: 200, q: 0.6, gain: 0.12, attack: 0.02 });
    },
    pistolShot(t) {
      const o = this._out(0.5);
      this._noise(o, t, 0.12, { type: 'lowpass', freq: 6500, freqEnd: 900, gain: 0.85 });
      this._tone(o, t, 0.08, { freq: 210, freqEnd: 70, gain: 0.6 });
      this._noise(o, t + 0.015, 0.25, { type: 'bandpass', freq: 900, freqEnd: 300, q: 0.7, gain: 0.1, attack: 0.02 });
    },
    empty(t) {
      const o = this._out(0.3);
      this._tone(o, t, 0.03, { type: 'square', freq: 2200, gain: 0.25 });
      this._noise(o, t, 0.04, { type: 'highpass', freq: 4000, gain: 0.2 });
    },
    magOut(t) {
      const o = this._out(0.35);
      this._noise(o, t, 0.05, { type: 'bandpass', freq: 2500, q: 2, gain: 0.5 });
      this._noise(o, t + 0.06, 0.12, { type: 'bandpass', freq: 900, freqEnd: 500, q: 1.5, gain: 0.3 });
    },
    magIn(t) {
      const o = this._out(0.4);
      this._noise(o, t, 0.04, { type: 'bandpass', freq: 1800, q: 2, gain: 0.6 });
      this._tone(o, t, 0.06, { type: 'triangle', freq: 300, freqEnd: 150, gain: 0.4 });
    },
    rack(t) {
      const o = this._out(0.4);
      this._noise(o, t, 0.05, { type: 'bandpass', freq: 3000, q: 3, gain: 0.6 });
      this._noise(o, t + 0.09, 0.05, { type: 'bandpass', freq: 2200, q: 3, gain: 0.7 });
    },
    switchWeapon(t) {
      const o = this._out(0.25);
      this._noise(o, t, 0.08, { type: 'bandpass', freq: 1400, q: 2, gain: 0.5 });
    },
    hitBody(t) {
      const o = this._out(0.32);
      this._tone(o, t, 0.07, { type: 'triangle', freq: 1500, freqEnd: 900, gain: 0.5 });
    },
    hitHead(t) {
      const o = this._out(0.36);
      this._tone(o, t, 0.22, { freq: 2350, gain: 0.45 });
      this._tone(o, t, 0.18, { freq: 3520, gain: 0.2 });
      this._noise(o, t, 0.04, { type: 'highpass', freq: 5000, gain: 0.25 });
    },
    kill(t) {
      const o = this._out(0.32);
      this._tone(o, t, 0.12, { type: 'triangle', freq: 660, gain: 0.5 });
      this._tone(o, t + 0.07, 0.22, { type: 'triangle', freq: 990, gain: 0.45 });
      this._tone(o, t + 0.07, 0.22, { freq: 1980, gain: 0.12 });
    },
    impact(t, { at, surface }) {
      const { gain, pan } = this._spatial(at, 0.22, 0.09);
      const o = this._out(gain, pan);
      const f = surface === 'metal' ? 3800 : surface === 'wood' ? 1200 : 2200;
      this._noise(o, t, 0.06, { type: 'bandpass', freq: f, q: surface === 'metal' ? 4 : 1.2, gain: 0.8 });
      if (surface === 'metal') this._tone(o, t, 0.12, { freq: 2600 + Math.random() * 1600, gain: 0.12 });
    },
    footstep(t) {
      const o = this._out(0.22);
      this._noise(o, t, 0.09, { type: 'lowpass', freq: 520, gain: 0.8 });
      this._noise(o, t, 0.03, { type: 'highpass', freq: 3500, gain: 0.08 });
    },
    land(t, { intensity = 1 }) {
      const o = this._out(0.3 * clamp(intensity, 0.4, 1.4));
      this._noise(o, t, 0.16, { type: 'lowpass', freq: 380, gain: 0.9 });
      this._tone(o, t, 0.1, { freq: 90, freqEnd: 50, gain: 0.5 });
    },
    jump(t) {
      const o = this._out(0.12);
      this._noise(o, t, 0.1, { type: 'bandpass', freq: 900, q: 0.8, gain: 0.6 });
    },
    smokeThrow(t) {
      const o = this._out(0.25);
      this._noise(o, t, 0.3, { type: 'bandpass', freq: 600, freqEnd: 2400, q: 1.2, gain: 0.6, attack: 0.05 });
    },
    smokeDeploy(t, { at }) {
      const { gain, pan } = this._spatial(at, 0.35, 0.05);
      const o = this._out(gain, pan);
      this._tone(o, t, 0.12, { type: 'triangle', freq: 180, freqEnd: 90, gain: 0.5 });
      this._noise(o, t, 1.6, { type: 'highpass', freq: 2600, freqEnd: 1200, gain: 0.35, attack: 0.04 });
      this._noise(o, t, 1.2, { type: 'lowpass', freq: 700, gain: 0.25, attack: 0.05 });
    },
    smokeDenied(t) {
      const o = this._out(0.2);
      this._tone(o, t, 0.09, { type: 'square', freq: 220, gain: 0.25 });
      this._tone(o, t + 0.1, 0.09, { type: 'square', freq: 180, gain: 0.25 });
    },
    abilityReady(t) {
      const o = this._out(0.18);
      this._tone(o, t, 0.12, { freq: 880, gain: 0.35 });
      this._tone(o, t + 0.08, 0.2, { freq: 1320, gain: 0.3 });
    },
    enemyShot(t, { at }) {
      const { gain, pan } = this._spatial(at, 0.5, 0.05);
      const o = this._out(gain, pan);
      this._noise(o, t, 0.14, { type: 'lowpass', freq: 2600, freqEnd: 500, gain: 0.8 });
      this._tone(o, t, 0.1, { type: 'sawtooth', freq: 520, freqEnd: 180, gain: 0.12 });
    },
    enemyTelegraph(t, { at }) {
      const { gain, pan } = this._spatial(at, 0.16, 0.04);
      const o = this._out(gain, pan);
      this._tone(o, t, 0.08, { type: 'square', freq: 1240, gain: 0.25 });
      this._tone(o, t + 0.12, 0.08, { type: 'square', freq: 1240, gain: 0.25 });
    },
    spikeBeep(t, { at }) {
      const { gain, pan } = this._spatial(at, 0.22, 0.05);
      this._tone(this._out(gain, pan), t, 0.06, { type: 'square', freq: 1680, gain: 0.25 });
    },
    bulletPass(t, { at }) {
      const { pan } = this._spatial(at, 1, 0);
      const o = this._out(0.12, pan);
      this._noise(o, t, 0.12, { type: 'bandpass', freq: 3200, freqEnd: 1400, q: 1.5, gain: 0.7 });
    },
    hurt(t) {
      const o = this._out(0.4);
      this._tone(o, t, 0.16, { freq: 110, freqEnd: 60, gain: 0.7 });
      this._noise(o, t, 0.12, { type: 'lowpass', freq: 900, gain: 0.5 });
    },
    spawnIn(t, { at }) {
      const { gain, pan } = this._spatial(at, 0.18, 0.06);
      const o = this._out(gain, pan);
      this._tone(o, t, 0.4, { type: 'sawtooth', freq: 140, freqEnd: 420, gain: 0.15, attack: 0.05 });
    },
    ammoPickup(t) {
      const o = this._out(0.25);
      [740, 988, 1318].forEach((f, i) => this._tone(o, t + i * 0.06, 0.1, { type: 'triangle', freq: f, gain: 0.35 }));
    },
    uiClick(t) {
      const o = this._out(0.18);
      this._tone(o, t, 0.05, { type: 'triangle', freq: 1400, gain: 0.35 });
    },
    victory(t) {
      const o = this._out(0.3);
      [523, 659, 784, 1046].forEach((f, i) => this._tone(o, t + i * 0.11, 0.35, { type: 'triangle', freq: f, gain: 0.35 }));
    },
    defeat(t) {
      const o = this._out(0.3);
      [392, 330, 262].forEach((f, i) => this._tone(o, t + i * 0.16, 0.4, { type: 'triangle', freq: f, gain: 0.35 }));
    },
  };

  dispose() {
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.enabled = false;
  }
}
