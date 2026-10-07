import { describe, expect, it } from "vitest";
import { Audio, binsToBands, impactGain } from "./Audio";
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
});
