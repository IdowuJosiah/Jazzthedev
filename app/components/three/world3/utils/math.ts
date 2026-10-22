// Small, pure math helpers (no three.js), so Layout/tests stay engine-free.

export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const invlerp = (a: number, b: number, v: number) => (a === b ? 0 : (v - a) / (b - a));

/** Hermite smoothstep: 0 below e0, 1 above e1. */
export function smoothstep(e0: number, e1: number, x: number): number {
    const t = clamp(invlerp(e0, e1, x), 0, 1);
    return t * t * (3 - 2 * t);
}

/** Frame-rate independent damping: approaches `target` at `lambda` per second. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
    lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Shortest signed angle from a to b, in radians. */
export function angleDelta(a: number, b: number): number {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
}

/** Clamps a vector's length to `max`, in place; returns the same vector. */
export function clampLen<T extends { x: number; y: number; z: number }>(v: T, max: number): T {
    const l = Math.hypot(v.x, v.y, v.z);
    if (l > max && l > 0) {
        const k = max / l;
        v.x *= k;
        v.y *= k;
        v.z *= k;
    }
    return v;
}

/** Parameter t ∈ [0, 1] of the closest point on segment AB to P (2D). */
export function projectOnSegment2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 === 0) return 0;
    return clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
}

/** Distance from point P to segment AB in the XZ plane. */
export function distToSegment2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const t = projectOnSegment2D(px, pz, ax, az, bx, bz);
    return Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
}

/** Deterministic, seedable PRNG (mulberry32): returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const randRange = (rng: () => number, min: number, max: number) => min + rng() * (max - min);

/** Integer lattice hash → [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * Smooth 2D value noise in [−1, 1] (bilinear lattice values, quintic fade).
 * Stateless and deterministic per `seed`. Scenery groves use
 * `valueNoise2D(x / 45, z / 45, seed) > 0.15`.
 */
export function valueNoise2D(x: number, y: number, seed = 0): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash2(x0, y0, seed);
    const b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed);
    const d = hash2(x0 + 1, y0 + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}

export interface PoissonOptions {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** Minimum distance between samples. */
    radius: number;
    rng: () => number;
    /** Candidates tried per active sample (Bridson's k). Default 30. */
    k?: number;
    /** Extra acceptance test (masks, clearances). Rejected points never spawn. */
    accept?: (x: number, z: number) => boolean;
    /** Stop after this many accepted points. */
    maxPoints?: number;
}

/**
 * Bridson's Poisson-disk sampling in a rectangle. Deterministic for a given rng.
 * Points failing `accept` are discarded; seeding retries random starts until an
 * accepted one is found (bounded), so masked regions don't starve the sampler.
 */
export function poissonDisk(o: PoissonOptions): XZPoint[] {
    const { minX, maxX, minZ, maxZ, radius, rng } = o;
    const k = o.k ?? 30;
    const maxPoints = o.maxPoints ?? Infinity;
    const accept = o.accept ?? (() => true);
    const w = maxX - minX;
    const h = maxZ - minZ;
    if (w <= 0 || h <= 0 || radius <= 0) return [];

    const cell = radius / Math.SQRT2;
    const gw = Math.ceil(w / cell);
    const gh = Math.ceil(h / cell);
    const grid = new Int32Array(gw * gh).fill(-1);
    const pts: XZPoint[] = [];
    const active: number[] = [];
    const r2 = radius * radius;

    const gridIndex = (x: number, z: number) => {
        const gx = Math.min(gw - 1, Math.floor((x - minX) / cell));
        const gz = Math.min(gh - 1, Math.floor((z - minZ) / cell));
        return gz * gw + gx;
    };
    const fits = (x: number, z: number) => {
        if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
        const gx = Math.floor((x - minX) / cell);
        const gz = Math.floor((z - minZ) / cell);
        for (let j = Math.max(0, gz - 2); j <= Math.min(gh - 1, gz + 2); j++) {
            for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
                const p = grid[j * gw + i];
                if (p < 0) continue;
                const dx = pts[p].x - x;
                const dz = pts[p].z - z;
                if (dx * dx + dz * dz < r2) return false;
            }
        }
        return true;
    };
    const add = (x: number, z: number) => {
        pts.push({ x, z });
        grid[gridIndex(x, z)] = pts.length - 1;
        active.push(pts.length - 1);
    };

    const grow = () => {
        while (active.length > 0 && pts.length < maxPoints) {
            const ai = Math.floor(rng() * active.length);
            const p = pts[active[ai]];
            let found = false;
            for (let n = 0; n < k && pts.length < maxPoints; n++) {
                const ang = rng() * TAU;
                const dist = radius * (1 + rng());
                const x = p.x + Math.cos(ang) * dist;
                const z = p.z + Math.sin(ang) * dist;
                if (fits(x, z) && accept(x, z)) {
                    add(x, z);
                    found = true;
                }
            }
            if (!found) {
                active[ai] = active[active.length - 1];
                active.pop();
            }
        }
    };

    // A mask can split the domain into islands the frontier can't cross, so
    // re-seed at random points (about one try per grid cell) and grow again.
    const seedTries = Math.max(k, gw * gh);
    for (let s = 0; s < seedTries && pts.length < maxPoints; s++) {
        const x = minX + rng() * w;
        const z = minZ + rng() * h;
        if (fits(x, z) && accept(x, z)) {
            add(x, z);
            grow();
        }
    }
    return pts;
}

export interface XZPoint {
    x: number;
    z: number;
}
