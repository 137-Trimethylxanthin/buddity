// Verity's voice, synthesised live with WebAudio: babbly blips while talking
// (one per letter, coloured by the vowel), sung notes with vibrato, a giggle,
// and an "oof" for hard hits. No audio files.

const VOWEL_FORMANTS: Record<string, number> = { a: 850, e: 1900, i: 2300, o: 600, u: 450, y: 2100 };
const TALK_BASE_HZ = 340;
const SING_BASE_HZ = 523.25; // C5

export class Voice {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  pitch = 1;
  /** Evil mode: deeper, buzzier, darker. */
  creepy = false;

  private audio(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.3;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Webviews only allow audio after a user gesture; call this from one. */
  unlock(): void {
    this.audio();
  }

  private tone(opts: {
    freq: number;
    start?: number;
    dur: number;
    formant: number;
    gain?: number;
    vibrato?: boolean;
    glideTo?: number;
  }): void {
    const ctx = this.audio();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.start ?? 0);
    const t1 = t0 + opts.dur;
    const peak = opts.gain ?? 0.5;
    const drop = this.creepy ? 0.6 : 1;

    const body = ctx.createOscillator();
    body.type = "triangle";
    const buzz = ctx.createOscillator();
    buzz.type = "square";
    for (const osc of [body, buzz]) {
      osc.frequency.setValueAtTime(opts.freq * drop, t0);
      if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo * drop, t1);
    }
    if (this.creepy) buzz.detune.value = 30; // slightly out of tune
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = this.creepy ? 0.45 : 0.12;

    // A boosted band gives each blip a vowel colour.
    const formant = ctx.createBiquadFilter();
    formant.type = "peaking";
    formant.frequency.value = opts.formant;
    formant.Q.value = 2;
    formant.gain.value = 12;
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = this.creepy ? 1800 : 3800;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    env.gain.setValueAtTime(peak * 0.8, Math.max(t0 + 0.013, t1 - 0.04));
    env.gain.linearRampToValueAtTime(0, t1);

    body.connect(formant);
    buzz.connect(buzzGain).connect(formant);
    formant.connect(soften).connect(env).connect(this.master);

    if (opts.vibrato && opts.dur > 0.18) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t0);
      depth.gain.linearRampToValueAtTime(opts.freq * 0.025, t0 + 0.2);
      lfo.connect(depth);
      depth.connect(body.frequency);
      depth.connect(buzz.frequency);
      lfo.start(t0);
      lfo.stop(t1);
    }
    for (const osc of [body, buzz]) {
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
  }

  /** One babble syllable for a typed character. */
  blip(ch: string): void {
    const c = ch.toLowerCase();
    if (!/[a-z]/.test(c)) return;
    const vowel = VOWEL_FORMANTS[c];
    const semis = Math.random() * 5 - 2 + (vowel ? 2 : 0);
    this.tone({
      freq: TALK_BASE_HZ * this.pitch * 2 ** (semis / 12),
      dur: 0.075,
      formant: vowel ?? 1200 + Math.random() * 800,
      gain: 0.35,
    });
  }

  /** A sung note, `semis` above C5 (scaled by the skin's pitch). */
  note(semis: number, dur: number, vowel: string): void {
    this.tone({
      freq: SING_BASE_HZ * this.pitch * 2 ** (semis / 12),
      dur,
      formant: VOWEL_FORMANTS[vowel] ?? 900,
      gain: 0.45,
      vibrato: true,
    });
  }

  giggle(): void {
    const f = 620 * this.pitch;
    [0, 0.09, 0.26, 0.35].forEach((start, i) =>
      this.tone({ freq: f * (i % 2 ? 1.25 : 1.5), start, dur: 0.07, formant: 2300, gain: 0.35 }),
    );
  }

  oof(): void {
    this.tone({ freq: 260 * this.pitch, glideTo: 120 * this.pitch, dur: 0.16, formant: 600, gain: 0.45 });
  }

  /** Being squeezed. */
  squeak(): void {
    this.tone({ freq: 520 * this.pitch, glideTo: 980 * this.pitch, dur: 0.22, formant: 2300, gain: 0.35 });
  }

  /** Springing back after a squeeze. */
  boing(): void {
    this.tone({ freq: 180 * this.pitch, glideTo: 640 * this.pitch, dur: 0.3, formant: 900, gain: 0.4, vibrato: true });
  }

  bleh(): void {
    this.tone({ freq: 300 * this.pitch, glideTo: 85 * this.pitch, dur: 0.7, formant: 500, gain: 0.5, vibrato: true });
  }

  nom(): void {
    [0, 0.14].forEach((start) =>
      this.tone({ freq: 300 * this.pitch, glideTo: 220 * this.pitch, start, dur: 0.1, formant: 450, gain: 0.4 }),
    );
  }

  huff(): void {
    this.tone({ freq: 240 * this.pitch, glideTo: 200 * this.pitch, dur: 0.12, formant: 1800, gain: 0.25 });
  }

  /** Growing (true) or shrinking (false) between Verity and Obesity. */
  morph(grow: boolean): void {
    const [from, to] = grow ? [260, 110] : [110, 380];
    this.tone({ freq: from * this.pitch, glideTo: to * this.pitch, dur: 0.9, formant: 700, gain: 0.45, vibrato: true });
  }

  /** A slow, deep "heh... heh... heh". */
  laugh(): void {
    [0, 0.32, 0.64].forEach((start) =>
      this.tone({ freq: 210 * this.pitch, glideTo: 170 * this.pitch, start, dur: 0.2, formant: 700, gain: 0.45 }),
    );
  }

  /** A burst of radio static (teleporting, glitching). */
  static(seconds = 0.35): void {
    const ctx = this.audio();
    if (!ctx || !this.master) return;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2500;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(band).connect(gain).connect(this.master);
    src.start();
  }
}
