import { describe, expect, it } from "vitest";
import {
    clampLen,
    damp,
    distToSegment2D,
    mulberry32,
    poissonDisk,
    smoothstep,
    valueNoise2D,
} from "./math";

describe("utils/math", () => {
    it("mulberry32 is deterministic and in [0, 1)", () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        for (let i = 0; i < 1000; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
        expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    });

    it("valueNoise2D is deterministic, continuous and in [−1, 1]", () => {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < 2000; i++) {
            const x = i * 0.137;
            const y = i * 0.071;
            const v = valueNoise2D(x, y, 7);
            expect(v).toBe(valueNoise2D(x, y, 7));
            min = Math.min(min, v);
            max = Math.max(max, v);
            expect(Math.abs(valueNoise2D(x + 1e-4, y, 7) - v)).toBeLessThan(1e-2);
        }
        expect(min).toBeGreaterThanOrEqual(-1);
        expect(max).toBeLessThanOrEqual(1);
        expect(max - min).toBeGreaterThan(0.8);
    });

    it("poissonDisk keeps the minimum distance, stays in bounds and honours accept()", () => {
        const radius = 4;
        const accept = (x: number) => x < 20 || x > 40; // two islands
        const pts = poissonDisk({ minX: 0, maxX: 60, minZ: 0, maxZ: 40, radius, rng: mulberry32(3), accept });
        expect(pts.length).toBeGreaterThan(40);
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            expect(p.x >= 0 && p.x <= 60 && p.z >= 0 && p.z <= 40).toBe(true);
            expect(accept(p.x)).toBe(true);
            for (let j = i + 1; j < pts.length; j++) {
                expect(Math.hypot(p.x - pts[j].x, p.z - pts[j].z)).toBeGreaterThanOrEqual(radius);
            }
        }
        // Both islands get filled (re-seeding crosses the masked gap).
        expect(pts.some((p) => p.x < 20)).toBe(true);
        expect(pts.some((p) => p.x > 40)).toBe(true);
    });

    it("damp, smoothstep, clampLen and distToSegment2D", () => {
        expect(damp(0, 10, 6, 0)).toBe(0);
        expect(damp(0, 10, 6, 100)).toBeCloseTo(10);
        // Frame-rate independent: two 1/120 steps equal one 1/60 step.
        const twoHalfSteps = damp(damp(0, 10, 6, 1 / 120), 10, 6, 1 / 120);
        expect(twoHalfSteps).toBeCloseTo(damp(0, 10, 6, 1 / 60), 10);
        expect(smoothstep(2, 3.5, 1)).toBe(0);
        expect(smoothstep(2, 3.5, 4)).toBe(1);
        expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
        const v = clampLen({ x: 3, y: 0, z: 4 }, 2.5);
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(2.5);
        expect(distToSegment2D(0, 5, -1, 0, 1, 0)).toBeCloseTo(5);
        expect(distToSegment2D(4, 0, -1, 0, 1, 0)).toBeCloseTo(3);
    });
});
