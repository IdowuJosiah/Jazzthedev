import { CONFIG } from "./Config";
import type { AudioApi, ImpactKind, UiSoundKind } from "./types";
import { clamp } from "./utils/math";

// ─────────────────────────────────────────────────────────────────────────
// Audio (§9.4, §8.2 Keep), ported from v2's raw Web Audio engine:
//
// - The AudioContext is created inside the Start click (`unlock()`), so sound
//   starts only on that gesture and no "not allowed to start" warning appears.
// - Small sounds (engine loop, UI one-shots) are fetched and decoded right
//   after Start; `music.ogg` (3.4 MB) is fetched lazily, after Start and only
//   once sound is on, and starts looping once decoded.
// - A hidden tab suspends the context (rAF stops, so nothing else would).
// - Engine loop: pitch and volume follow the car's speed.
// - The music bus feeds an AnalyserNode for `getBands(n)` (the Music stage's
//   EQ bars). There is NO beat return (nothing in the world pulses to the
//   beat, §5.3 / §9.4) and NO positional market panner (§8.2); `ambient.ogg`
//   is not played (owner decision whether it suits the day look).
// - Impacts (`playImpact`) are short synthesized hits (filtered noise / a low
//   thump), so no impact files are needed; the Kenney impact pack (P1) can
//   replace them later.
// Everything is optional: a missing file or no Web Audio degrades to silence.
// ─────────────────────────────────────────────────────────────────────────

const A = CONFIG.audio;

/** Sound files (public/assets/audio). */
export const AUDIO_FILES = {
    music: "/assets/audio/music.ogg",
    engine: "/assets/audio/engine.wav",
    click: "/assets/audio/ui_click.ogg",
    confirm: "/assets/audio/ui_confirm.ogg",
    hover: "/assets/audio/ui_hover.ogg",
} as const;
type SoundId = keyof typeof AUDIO_FILES;

// ── Stream-local tuning (Config has no slot for these; see DECISIONS.md) ──
/** Master gain ramp time constant (s) for mute / unmute. */
const MUTE_RAMP = 0.2;
/** UI one-shot volume (relative to master). */
const UI_VOLUME = 0.5;
/** Engine: playback rate = base + span × s, gain = engineVolume × (idle + gain × s), s = |speed| / maxSpeed ≤ cap. */
const ENGINE = { rateBase: 0.7, rateSpan: 1.3, idleGain: 0.25, speedGain: 0.9, speedCap: 1.4 } as const;
/** Analyser for getBands (music bus). */
const ANALYSER = { fftSize: 256, smoothing: 0.75 } as const;
/** Impact hits: volume from the relative force (≥ 1), and a per-kind flood guard. */
const IMPACT = {
    /** gain = impactVolume × clamp(base + log2(force) × perDoubling, base, 1). */
    base: 0.25,
    perDoubling: 0.2,
    /** At most one hit per kind per this many seconds. */
    minInterval: 0.06,
    /** Voices alive at once (all kinds). */
    maxVoices: 6,
} as const;
/** Synth recipe per impact kind: noise burst through a filter, plus an optional low thump. */
const IMPACT_SYNTH: Readonly<
    Record<ImpactKind, { filter: BiquadFilterType; freq: number; q: number; decay: number; thumpHz: number; thumpGain: number }>
> = Object.freeze({
    soft: { filter: "lowpass", freq: 900, q: 0.7, decay: 0.09, thumpHz: 0, thumpGain: 0 },
    wood: { filter: "bandpass", freq: 1400, q: 3, decay: 0.07, thumpHz: 180, thumpGain: 0.35 },
    heavy: { filter: "lowpass", freq: 420, q: 0.9, decay: 0.16, thumpHz: 70, thumpGain: 0.8 },
});
/** Seconds of white noise in the shared impact buffer. */
const NOISE_SECONDS = 0.25;

type Ctor = typeof AudioContext;

const audioContextCtor = (): Ctor | null => {
    if (typeof window === "undefined") return null;
    return (
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ??
        null
    );
};

/**
 * Groups the analyser's linear bins into `n` bands on a log scale (low bands
 * get fewer bins), each normalised to [0, 1]. Pure, for tests.
 */
export function binsToBands(bins: ArrayLike<number>, n: number, out: Float32Array, max = 255): Float32Array {
    const count = bins.length;
    if (n <= 0 || count === 0) return out.fill(0);
    let start = 0;
    for (let b = 0; b < n; b++) {
        // Band edges at count^(b/n): 1, …, count (log spacing, at least one bin each).
        const end = Math.max(start + 1, Math.min(count, Math.round(Math.pow(count, (b + 1) / n))));
        let sum = 0;
        for (let i = start; i < end; i++) sum += bins[i];
        out[b] = clamp(sum / ((end - start) * max), 0, 1);
        start = Math.min(end, count - 1);
    }
    return out;
}

/** Impact gain for a relative force (Physics reports force ≥ 1 = at the threshold). */
export function impactGain(force: number): number {
    const f = Math.max(1, Number.isFinite(force) ? force : 1);
    return A.impactVolume * clamp(IMPACT.base + Math.log2(f) * IMPACT.perDoubling, IMPACT.base, 1);
}

export class Audio implements AudioApi {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private analyser: AnalyserNode | null = null;
    private freq: Uint8Array<ArrayBuffer> | null = null;
    private buffers = new Map<SoundId, AudioBuffer>();
    private engineSrc: AudioBufferSourceNode | null = null;
    private engineGain: GainNode | null = null;
    private musicSrc: AudioBufferSourceNode | null = null;
    private noise: AudioBuffer | null = null;
    private bands = new Map<number, Float32Array>();
    private lastImpact: Record<ImpactKind, number> = { soft: -Infinity, wood: -Infinity, heavy: -Infinity };
    private voices = 0;
    private muted = true;
    private musicRequested = false;
    private disposed = false;

    constructor() {
        // A hidden tab stops rAF, so update() would leave the engine droning at
        // its last pitch and the music playing: suspend the context instead.
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
    }

    /** True once unlock() created a context. */
    get started(): boolean {
        return this.ctx !== null;
    }

    /**
     * Call synchronously inside the Start click (user gesture): creates and
     * resumes the context, then loads the sounds in the background.
     */
    unlock(muted: boolean): void {
        this.muted = muted;
        if (this.ctx || this.disposed) {
            this.applyMute();
            return;
        }
        const C = audioContextCtor();
        if (!C) return;
        try {
            this.ctx = new C();
        } catch {
            return; // no audio device: stay silent
        }
        const ctx = this.ctx;
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = ANALYSER.fftSize;
        this.analyser.smoothingTimeConstant = ANALYSER.smoothing;
        this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
        this.analyser.connect(this.master);
        if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
        this.applyMute();
        void this.loadSmall();
        // music.ogg (3.4 MB) only once sound is on: a visitor who keeps it off never downloads it.
        if (!muted) void this.loadMusic();
    }

    setMuted(m: boolean): void {
        this.muted = m;
        this.applyMute();
        if (!m && this.ctx) void this.loadMusic();
    }

    /** Per frame: engine pitch / volume from the signed car speed. */
    update(speed: number): void {
        if (!this.engineSrc || !this.engineGain) return;
        const s = Math.min(Math.abs(speed) / CONFIG.vehicle.maxSpeed, ENGINE.speedCap);
        this.engineSrc.playbackRate.value = ENGINE.rateBase + s * ENGINE.rateSpan;
        this.engineGain.gain.value = this.muted ? 0 : A.engineVolume * (ENGINE.idleGain + s * ENGINE.speedGain);
    }

    // ── AudioApi ─────────────────────────────────────────────────────────
    getBands(n: number): Float32Array | null {
        if (this.muted || !this.analyser || !this.freq || !this.musicSrc || n <= 0) return null;
        let out = this.bands.get(n);
        if (!out) {
            out = new Float32Array(n);
            this.bands.set(n, out);
        }
        this.analyser.getByteFrequencyData(this.freq);
        return binsToBands(this.freq, n, out);
    }

    playImpact(kind: ImpactKind, force: number): void {
        const ctx = this.ctx;
        if (!ctx || !this.master || this.muted || ctx.state !== "running") return;
        const now = ctx.currentTime;
        if (now - this.lastImpact[kind] < IMPACT.minInterval || this.voices >= IMPACT.maxVoices) return;
        this.lastImpact[kind] = now;
        const R = IMPACT_SYNTH[kind];
        const gain = impactGain(force);

        const out = ctx.createGain();
        out.gain.setValueAtTime(gain, now);
        out.gain.exponentialRampToValueAtTime(1e-4, now + R.decay);
        out.connect(this.master);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = R.filter;
        filter.frequency.value = R.freq;
        filter.Q.value = R.q;
        noise.connect(filter).connect(out);
        noise.start(now);
        noise.stop(now + R.decay);
        this.voices++;
        noise.onended = () => {
            this.voices--;
            out.disconnect();
        };

        if (R.thumpHz > 0) {
            const osc = ctx.createOscillator();
            osc.frequency.setValueAtTime(R.thumpHz, now);
            const tg = ctx.createGain();
            tg.gain.setValueAtTime(gain * R.thumpGain, now);
            tg.gain.exponentialRampToValueAtTime(1e-4, now + R.decay);
            osc.connect(tg).connect(this.master);
            osc.start(now);
            osc.stop(now + R.decay);
            osc.onended = () => tg.disconnect();
        }
    }

    playUi(kind: UiSoundKind): void {
        const ctx = this.ctx;
        if (!ctx || !this.master || this.muted) return;
        const buf = this.buffers.get(kind);
        if (!buf) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = UI_VOLUME;
        src.connect(g).connect(this.master);
        src.start();
        src.onended = () => g.disconnect();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
        for (const src of [this.engineSrc, this.musicSrc]) {
            try {
                src?.stop();
            } catch {
                /* never started / already stopped */
            }
        }
        this.engineSrc = null;
        this.musicSrc = null;
        this.buffers.clear();
        void this.ctx?.close().catch(() => undefined);
        this.ctx = null;
    }

    // ── internals ────────────────────────────────────────────────────────
    private onVisibility = () => {
        const ctx = this.ctx;
        if (!ctx || this.disposed) return;
        if (document.hidden) void ctx.suspend().catch(() => undefined);
        else void ctx.resume().catch(() => undefined);
    };

    private applyMute() {
        if (!this.master || !this.ctx) return;
        const target = this.muted ? 0 : A.masterVolume;
        this.master.gain.setTargetAtTime(target, this.ctx.currentTime, MUTE_RAMP);
    }

    private async decode(id: SoundId): Promise<AudioBuffer | null> {
        const ctx = this.ctx;
        if (!ctx) return null;
        try {
            const res = await fetch(AUDIO_FILES[id]);
            if (!res.ok) return null;
            const buf = await ctx.decodeAudioData(await res.arrayBuffer());
            if (this.disposed) return null;
            this.buffers.set(id, buf);
            return buf;
        } catch {
            return null; // optional asset: silence
        }
    }

    private async loadSmall() {
        await Promise.all((["click", "confirm", "hover"] as const).map((id) => this.decode(id)));
        const engine = await this.decode("engine");
        if (!engine || !this.ctx || !this.master || this.disposed) return;
        const loop = this.startLoop(engine, 0, this.master);
        this.engineSrc = loop.src;
        this.engineGain = loop.gain;
    }

    /**
     * music.ogg is fetched only after Start and only while sound is on (§8.2),
     * once per page, then loops on the analysed bus.
     */
    private async loadMusic() {
        if (this.musicRequested) return;
        this.musicRequested = true;
        const music = await this.decode("music");
        if (!music || !this.ctx || !this.analyser || this.disposed) return;
        this.musicSrc = this.startLoop(music, A.musicVolume, this.analyser).src;
    }

    private startLoop(buffer: AudioBuffer, volume: number, dest: AudioNode) {
        const ctx = this.ctx!;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        src.connect(gain).connect(dest);
        src.start();
        return { src, gain };
    }

    private noiseBuffer(ctx: AudioContext): AudioBuffer {
        if (this.noise) return this.noise;
        const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
        const buf = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buf;
        return buf;
    }
}
