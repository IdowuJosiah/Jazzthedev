import * as THREE from "three";
import { CONFIG } from "./Config";

const FILES = {
    ambient: "/assets/audio/ambient.ogg",
    music: "/assets/audio/music.ogg",
    engine: "/assets/audio/engine.wav",
    ui_click: "/assets/audio/ui_click.ogg",
    ui_confirm: "/assets/audio/ui_confirm.ogg",
    ui_hover: "/assets/audio/ui_hover.ogg",
} as const;
type Sfx = "ui_click" | "ui_confirm" | "ui_hover";

/**
 * Web Audio engine: a 2D music bed (with a beat analyser that drives the
 * world's neon pulse), positional market ambience, a speed-reactive engine
 * loop, and UI one-shots. Starts only after a user gesture (the Enter click).
 */
export class AudioEngine {
    private ctx?: AudioContext;
    private master?: GainNode;
    private buffers = new Map<string, AudioBuffer>();
    private analyser?: AnalyserNode;
    private freq?: Uint8Array;
    private engineSrc?: AudioBufferSourceNode;
    private engineGain?: GainNode;
    private ambientPanner?: PannerNode;
    private started = false;
    private muted = true;
    private beatSmooth = 0;
    private marketPos = new THREE.Vector3(-36, 2, 24);

    async load() {
        const entries = Object.entries(FILES);
        const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        await Promise.all(
            entries.map(async ([key, url]) => {
                try {
                    const res = await fetch(url);
                    const arr = await res.arrayBuffer();
                    const buf = await this.ctx!.decodeAudioData(arr);
                    this.buffers.set(key, buf);
                } catch {
                    /* missing audio → silent */
                }
            })
        );
        // start suspended until a gesture
        if (this.ctx.state === "running") await this.ctx.suspend();
    }

    private loop(key: string, gain: number, dest: AudioNode) {
        const buf = this.buffers.get(key);
        if (!buf || !this.ctx) return undefined;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        src.connect(g).connect(dest);
        src.start();
        return { src, g };
    }

    async start() {
        if (this.started || !this.ctx || !this.master) return;
        this.started = true;
        if (this.ctx.state === "suspended") await this.ctx.resume();

        // Music bed → analyser → master
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.freq = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.connect(this.master);
        this.loop("music", CONFIG.audio.musicVolume, this.analyser);

        // Positional market ambience
        const panner = this.ctx.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.refDistance = 8;
        panner.maxDistance = 120;
        panner.rolloffFactor = 1.2;
        panner.positionX.value = this.marketPos.x;
        panner.positionY.value = this.marketPos.y + 2;
        panner.positionZ.value = this.marketPos.z;
        panner.connect(this.master);
        this.ambientPanner = panner;
        this.loop("ambient", 0.9, panner);

        // Engine loop (speed-reactive)
        const eng = this.loop("engine", 0, this.master);
        if (eng) {
            this.engineSrc = eng.src;
            this.engineGain = eng.g;
        }

        this.applyMute();
    }

    setMuted(m: boolean) {
        this.muted = m;
        this.applyMute();
    }

    private applyMute() {
        if (!this.master || !this.ctx) return;
        const target = this.muted ? 0 : CONFIG.audio.masterVolume;
        this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }

    playUi(name: Sfx, volume = 0.5) {
        if (!this.ctx || !this.master || this.muted) return;
        const buf = this.buffers.get(name);
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.value = volume;
        src.connect(g).connect(this.master);
        src.start();
    }

    /** @returns beat energy 0..1 for reactive visuals */
    update(dt: number, speed: number, camPos: THREE.Vector3, camFwd: THREE.Vector3): number {
        if (!this.ctx) return 0;
        // listener follows the camera (for the positional market ambience)
        const l = this.ctx.listener;
        if (l.positionX) {
            l.positionX.value = camPos.x;
            l.positionY.value = camPos.y;
            l.positionZ.value = camPos.z;
            l.forwardX.value = camFwd.x;
            l.forwardY.value = camFwd.y;
            l.forwardZ.value = camFwd.z;
            l.upX.value = 0;
            l.upY.value = 1;
            l.upZ.value = 0;
        }

        // engine pitch + volume from speed
        if (this.engineSrc && this.engineGain) {
            const s = Math.min(Math.abs(speed) / CONFIG.vehicle.maxSpeed, 1.4);
            this.engineSrc.playbackRate.value = 0.7 + s * 1.3;
            this.engineGain.gain.value = this.muted ? 0 : CONFIG.audio.engineVolume * (0.25 + s * 0.9);
        }

        // beat from low-frequency energy
        if (this.analyser && this.freq) {
            this.analyser.getByteFrequencyData(this.freq as Uint8Array<ArrayBuffer>);
            let sum = 0;
            const bands = 8;
            for (let i = 0; i < bands; i++) sum += this.freq[i];
            const energy = sum / (bands * 255);
            this.beatSmooth += (energy - this.beatSmooth) * 0.2;
            return Math.max(0, energy - this.beatSmooth * 0.8);
        }
        return 0;
    }

    dispose() {
        try {
            this.engineSrc?.stop();
        } catch {
            /* already stopped */
        }
        this.ctx?.close();
    }
}
