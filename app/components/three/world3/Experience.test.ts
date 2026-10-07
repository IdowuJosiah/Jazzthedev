import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "./Config";
import {
    AdaptiveQuality,
    adaptiveSteps,
    LoadTracker,
    median,
    NextVisitMonitor,
    pickProfile,
    resolveQuality,
} from "./Experience";
import { WorldStore } from "./State";

const Q = CONFIG.quality;
const FRAME = 1 / 60;

/** Feeds `seconds` of frames at `ms` each, starting at t0. */
function feed(a: AdaptiveQuality, t0: number, seconds: number, ms: number, skip = false): void {
    for (let t = t0; t < t0 + seconds; t += FRAME) a.sample(t, ms, skip);
}

describe("render profile + load contract", () => {
    it("maps GPU tiers to the §9.1 profiles and never caps DPR below 2", () => {
        expect(pickProfile(3, false).id).toBe("desktop-high");
        expect(pickProfile(2, false).id).toBe("desktop-medium");
        expect(pickProfile(1, false, 1).antialias).toBe(true);
        expect(pickProfile(1, false, 2).antialias).toBe(false);
        expect(pickProfile(2, true).dprCap).toBe(3);
        for (const t of [0, 1, 2, 3]) for (const m of [true, false]) expect(pickProfile(t, m).dprCap).toBeGreaterThanOrEqual(2);
    });

    it("load progress follows the §6.2 weights and never decreases", () => {
        const store = new WorldStore();
        const tracker = new LoadTracker(store);
        tracker.complete("fonts");
        expect(store.snapshot.loadProgress).toBeCloseTo(0.15);
        tracker.report("assets", 0.5);
        expect(store.snapshot.loadProgress).toBeCloseTo(0.15 + 0.275);
        expect(store.snapshot.loadLabel).toBe("Loading models");
        tracker.report("assets", 0.1);
        expect(store.snapshot.loadProgress).toBeCloseTo(0.15 + 0.275);
        tracker.complete("warmup");
        expect(store.snapshot.loadProgress).toBeCloseTo(1);
    });
});

describe("quality (§9.3)", () => {
    const high = pickProfile(3, false);
    const low = pickProfile(1, false, 2);

    it("fixed settings change shadows / scenery / dust only", () => {
        expect(resolveQuality("high", low).shadowMapSize).toBe(2048);
        expect(resolveQuality("medium", high).shadowMapSize).toBe(CONFIG.shadow.downgradedMapSize);
        expect(resolveQuality("low", high)).toMatchObject({ shadowMapSize: 0, scenery: "low", dust: false });
        expect(resolveQuality("auto", high)).toEqual({ shadowMapSize: 2048, scenery: "high", sceneryScale: 1, dust: true });
    });

    it("applies the downgrade steps in order; profiles without a shadow map skip shadow1024", () => {
        expect(adaptiveSteps(high)).toEqual(["shadow1024", "scenery-30", "dustOff"]);
        expect(adaptiveSteps(low)).toEqual(["scenery-30", "dustOff"]);
        const all = resolveQuality("auto", high, adaptiveSteps(high));
        expect(all).toEqual({
            shadowMapSize: CONFIG.shadow.downgradedMapSize,
            scenery: "high",
            sceneryScale: 1 - Q.sceneryReduction,
            dust: false,
        });
    });

    it("median", () => {
        expect(median([])).toBe(0);
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 2, 3])).toBe(2.5);
    });

    it("ignores the first 5 s and skipped frames", () => {
        const onChange = vi.fn();
        const a = new AdaptiveQuality(3, onChange);
        feed(a, 0, Q.ignoreFirst - 0.1, 40);
        feed(a, Q.ignoreFirst, 6, 40, true);
        expect(onChange).not.toHaveBeenCalled();
        expect(a.level).toBe(0);
    });

    it("steps down on a slow 4 s median, at most once every 8 s, and back up after 10 s fast", () => {
        let now = 0;
        const changes: { level: number; t: number }[] = [];
        const a = new AdaptiveQuality(3, (level) => changes.push({ level, t: now }));
        const run = (seconds: number, ms: number) => {
            const end = now + seconds;
            for (; now < end; now += FRAME) a.sample(now, ms, false);
        };
        now = Q.ignoreFirst;
        run(Q.downWindow + 1.5, 30);
        expect(changes.map((c) => c.level)).toEqual([1]);
        // A second downgrade needs a fresh full window AND the 8 s spacing.
        run(Q.minInterval + 2, 30);
        expect(changes.map((c) => c.level)).toEqual([1, 2]);
        expect(changes[1].t - changes[0].t).toBeGreaterThanOrEqual(Q.minInterval);
        run(Q.upWindow + 2, 10);
        expect(changes.map((c) => c.level)).toEqual([1, 2, 1]);
        expect(changes[2].t - changes[1].t).toBeGreaterThanOrEqual(Q.upWindow);
        a.reset();
        expect(a.level).toBe(0);
        expect(changes.at(-1)?.level).toBe(0);
    });
});

describe("next-visit DPR fallback (§9.1)", () => {
    afterEach(() => vi.unstubAllGlobals());

    const run = (profileId: "mobile" | "desktop-high", ms: number) => {
        const store = new Map<string, string>();
        vi.stubGlobal("window", {
            localStorage: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null },
        });
        const m = new NextVisitMonitor({ id: profileId });
        let wrote = false;
        for (let t = 0; t < CONFIG.render.nextVisit.windowEnd + 1; t += FRAME) wrote = m.sample(t, ms, false) || wrote;
        return { wrote, value: store.get(CONFIG.render.nextVisit.storageKey) };
    };

    it("saves dprCap 2 for the next visit when a mobile session is slow", () => {
        expect(run("mobile", 40)).toEqual({ wrote: true, value: "2" });
    });

    it("does nothing when fast, or on other profiles", () => {
        expect(run("mobile", 16).wrote).toBe(false);
        expect(run("desktop-high", 40).wrote).toBe(false);
    });
});
