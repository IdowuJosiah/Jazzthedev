// Small math helpers — no magic numbers scattered through the engine.

export const clamp = (v: number, min: number, max: number) =>
    v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent damping (approaches `target` at `lambda` per second). */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
    lerp(current, target, 1 - Math.exp(-lambda * dt));

export const invlerp = (a: number, b: number, v: number) =>
    a === b ? 0 : (v - a) / (b - a);

export const map = (v: number, inA: number, inB: number, outA: number, outB: number) =>
    lerp(outA, outB, invlerp(inA, inB, v));

export const TAU = Math.PI * 2;

/** Shortest signed angle from a to b, in radians. */
export const angleDelta = (a: number, b: number) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
};

/** Deterministic, seedable PRNG (mulberry32) so layouts are stable across reloads. */
export function makeRng(seed: number) {
    let s = seed >>> 0;
    return () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const randRange = (rng: () => number, min: number, max: number) =>
    min + rng() * (max - min);
