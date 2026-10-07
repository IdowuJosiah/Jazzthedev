import { describe, expect, it, vi } from "vitest";
import { AUDIO_FILES, Audio, binsToBands, impactGain } from "./Audio";
import { CONFIG } from "./Config";

describe("Audio (ported from v2, no beat return / market panner)", () => {
    it("groups analyser bins into n bands in [0, 1]", () => {
        const bins = new Uint8Array(128).fill(255);
        const out = binsToBands(bins, 9, new Float32Array(9));
        expect(Array.from(out)).toEqual(new Array(9).fill(1));
        const half = binsToBands(new Uint8Array(128).fill(128), 9, new Float32Array(9));
        for (const v of half) expect(v).toBeCloseTo(128 / 255);
        expect(Array.from(binsToBands(new Uint8Array(0), 3, new Float32Array(3)))).toEqual([0, 0, 0]);
    });

    it("low bands use fewer bins than high bands (log spacing)", () => {
        // Energy only in the top half of the spectrum: the low bands stay silent.
        const bins = new Uint8Array(128);
        bins.fill(255, 64);
        const out = binsToBands(bins, 9, new Float32Array(9));
        expect(out[0]).toBe(0);
        expect(out[8]).toBe(1);
    });

    it("impact gain grows with the relative force and is capped", () => {
        const V = CONFIG.audio.impactVolume;
        expect(impactGain(1)).toBeGreaterThan(0);
        expect(impactGain(4)).toBeGreaterThan(impactGain(1));
        expect(impactGain(1e9)).toBeCloseTo(V);
        expect(impactGain(Number.NaN)).toBe(impactGain(1));
    });

    it("is silent and inert before Start (no context, getBands null)", () => {
        const a = new Audio();
        expect(a.started).toBe(false);
        expect(a.getBands(9)).toBeNull();
        a.playImpact("wood", 3);
        a.playUi("click");
        a.update(10);
        // No Web Audio in node: unlock() degrades to silence.
        a.unlock(false);
        expect(a.getBands(9)).toBeNull();
        a.dispose();
    });

    it("suspends on a hidden tab, and fetches music.ogg only once sound is on", async () => {
        const listeners = new Map<string, () => void>();
        const doc = {
            hidden: false,
            addEventListener: (t: string, fn: () => void) => listeners.set(t, fn),
            removeEventListener: (t: string) => listeners.delete(t),
        };
        const ctx = {
            state: "running",
            currentTime: 0,
            destination: {},
            suspend: vi.fn(async () => undefined),
            resume: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
            createGain: () => ({ gain: { value: 0, setTargetAtTime() {} }, connect() {} }),
            createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, connect() {} }),
            decodeAudioData: vi.fn(async () => null),
        };
        const fetchSpy = vi.fn(async () => ({ ok: false }));
        vi.stubGlobal("document", doc);
        vi.stubGlobal("window", { AudioContext: function () { return ctx; } });
        vi.stubGlobal("fetch", fetchSpy);
        try {
            const a = new Audio();
            a.unlock(true);
            await Promise.resolve();
            const urls = () => fetchSpy.mock.calls.map((c) => (c as unknown[])[0]);
            expect(urls()).not.toContain(AUDIO_FILES.music);
            a.setMuted(false);
            a.setMuted(true);
            a.setMuted(false);
            expect(urls().filter((u) => u === AUDIO_FILES.music)).toHaveLength(1);

            doc.hidden = true;
            listeners.get("visibilitychange")!();
            expect(ctx.suspend).toHaveBeenCalledTimes(1);
            doc.hidden = false;
            listeners.get("visibilitychange")!();
            expect(ctx.resume).toHaveBeenCalled();
            a.dispose();
            expect(listeners.size).toBe(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
