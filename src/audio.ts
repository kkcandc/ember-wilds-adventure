import type { Biome } from './types';

type Cue = 'swing' | 'hit' | 'hurt' | 'gather' | 'craft' | 'drink' | 'beacon' | 'shrine' | 'ui' | 'death' | 'dash' | 'block' | 'boss';

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pad: OscillatorNode | null = null;
  private pad2: OscillatorNode | null = null;
  private padGain: GainNode | null = null;
  private wind: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  muted = false;
  private nextPulse = 0;

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.45;
    master.connect(ctx.destination);

    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const wind = ctx.createGain();
    wind.gain.value = 0.045;
    source.connect(filter);
    filter.connect(wind);
    wind.connect(master);
    source.start();

    const pad = ctx.createOscillator();
    const pad2 = ctx.createOscillator();
    pad.type = 'sine';
    pad2.type = 'triangle';
    pad.frequency.value = 82;
    pad2.frequency.value = 164;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.03;
    pad.connect(padGain);
    pad2.connect(padGain);
    padGain.connect(master);
    pad.start();
    pad2.start();

    this.ctx = ctx;
    this.master = master;
    this.pad = pad;
    this.pad2 = pad2;
    this.padGain = padGain;
    this.wind = wind;
    this.windFilter = filter;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.05);
    }
  }

  update(biome: Biome, night: number, combat: number): void {
    if (!this.ctx || !this.pad || !this.pad2 || !this.padGain || !this.wind || !this.windFilter) return;
    const now = this.ctx.currentTime;
    const base = biome === 'lava' ? 55 : biome === 'coast' ? 98 : biome === 'ruins' ? 72 : 84;
    this.pad.frequency.setTargetAtTime(base, now, 0.8);
    this.pad2.frequency.setTargetAtTime(base * 2.01, now, 0.8);
    this.padGain.gain.setTargetAtTime(0.025 + night * 0.02 + combat * 0.035, now, 0.4);
    this.wind.gain.setTargetAtTime(0.03 + (biome === 'coast' ? 0.03 : 0) + night * 0.02, now, 0.5);
    this.windFilter.frequency.setTargetAtTime(biome === 'lava' ? 280 : 520, now, 0.6);
    if (combat > 0.25 && now > this.nextPulse) {
      this.tone(110 + combat * 40, 0.09, 'square', 0.035);
      this.nextPulse = now + Math.max(0.28, 0.62 - combat * 0.28);
    }
  }

  play(cue: Cue): void {
    if (!this.ctx || this.muted) return;
    if (cue === 'swing') this.tone(220, 0.12, 'sawtooth', 0.05, 90);
    else if (cue === 'hit') {
      this.tone(140, 0.08, 'square', 0.06);
      this.noise(0.09, 900, 0.08);
    } else if (cue === 'hurt') this.tone(90, 0.18, 'sawtooth', 0.07, 50);
    else if (cue === 'gather') this.tone(320, 0.1, 'triangle', 0.05, 180);
    else if (cue === 'craft') {
      this.tone(262, 0.12, 'triangle', 0.05);
      this.tone(392, 0.16, 'triangle', 0.04);
    } else if (cue === 'drink') this.tone(480, 0.14, 'sine', 0.04, 240);
    else if (cue === 'beacon') {
      this.tone(196, 0.3, 'triangle', 0.06);
      this.tone(247, 0.35, 'sine', 0.05);
      this.tone(392, 0.4, 'sine', 0.04);
    } else if (cue === 'shrine') {
      this.tone(174, 0.28, 'sine', 0.05);
      this.tone(262, 0.34, 'sine', 0.04);
    } else if (cue === 'ui') this.tone(520, 0.05, 'sine', 0.03);
    else if (cue === 'death') this.tone(70, 0.45, 'sawtooth', 0.07, 40);
    else if (cue === 'dash') this.noise(0.12, 1400, 0.05);
    else if (cue === 'block') this.tone(180, 0.08, 'square', 0.05);
    else if (cue === 'boss') this.tone(62, 0.5, 'sawtooth', 0.07, 40);
  }

  footsteps(): void {
    if (!this.ctx || this.muted) return;
    this.noise(0.05, 500, 0.03);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + dur);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(amp);
    amp.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private noise(dur: number, freq: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const length = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.001, now + dur);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.master);
    source.start(now);
  }
}
