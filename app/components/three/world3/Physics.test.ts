import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIG, LOOK } from "./Config";
import { Physics, bboxOf, loadRapier } from "./Physics";
import { checkProbe, linearToSrgbHex, srgbHexToLinear } from "./utils/probe";
import { computeBufferSize } from "./utils/sizes";

// Physics interpolation (§4.4) plus the render core's pure helpers (W1-A):
// device-pixel buffer sizing (§3.4 item 2) and the calibration probe rule (§1.4).

const H = CONFIG.physics.fixedStep;
const SPEED = 6; // units/s along +X for the interpolation body
const CLOSE = 6; // toBeCloseTo digits
/** Playground brick (§2.4): 2 × 1 × 1, mass 25. */
const BRICK = { x: 1, y: 0.5, z: 0.5 };
const BRICK_MASS = 25;
const BRICK_ROWS = 5;
const BRICK_COLS = 6;
/** Allowed stray reports while a freshly spawned wall settles (unfiltered: ~1300). */
const MAX_RESTING_EVENTS = 5;

let physics: Physics | null = null;

beforeAll(async () => {
    await loadRapier();
});

afterEach(() => {
    physics?.dispose();
    physics = null;
    vi.restoreAllMocks();
});

/** A gravity-free body sliding at constant speed, linked to an Object3D. */
function slider(p: Physics) {
    const body = p.addDynamicBall(0.5, { x: 0, y: 10, z: 0 }, {
        mass: 1,
        linearDamping: 0,
        angularDamping: 0,
        impact: null,
        canSleep: false,
    });
    body.setGravityScale(0, true);
    body.setLinvel({ x: SPEED, y: 0, z: 0 }, true);
    const obj = new THREE.Object3D();
    p.link(body, obj);
    return { body, obj };
}

describe("Physics.step — fixed-step accumulator", () => {
    it("at a simulated 120 Hz alternates 0 / 1 substeps with alpha 0.5 / 0", () => {
        physics = new Physics();
        const counts: number[] = [];
        const alphas: number[] = [];
        for (let i = 0; i < 8; i++) {
            let n = 0;
            alphas.push(physics.step(1 / 120, () => n++));
            counts.push(n);
        }
        expect(counts).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
        alphas.forEach((a, i) => expect(a).toBeCloseTo(i % 2 === 0 ? 0.5 : 0, CLOSE));
    });

    it("interpolated motion at 120 Hz advances by exactly speed·dt every frame (no judder)", () => {
        physics = new Physics();
        const { obj } = slider(physics);
        const dt = 1 / 120;
        const xs: number[] = [];
        for (let i = 0; i < 24; i++) {
            const alpha = physics.step(dt, () => {});
            physics.interpolate(alpha);
            xs.push(obj.position.x);
        }
        // After the first full step, every frame moves the same distance.
        for (let i = 2; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(SPEED * dt, 4);
        // Rendered state lags the simulation by exactly one step: x = v·(T − h).
        const T = xs.length * dt;
        expect(xs[xs.length - 1]).toBeCloseTo(SPEED * (T - H), 4);
    });

    it("runs beforeEachStep once per substep with h, before the world steps", () => {
        physics = new Physics();
        const { body } = slider(physics);
        const seen: number[] = [];
        physics.step(3 * H + H / 2, (h) => {
            seen.push(h);
            // A velocity set here must affect this very substep.
            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        });
        expect(seen).toEqual([H, H, H]);
        expect(body.translation().x).toBeCloseTo(0, CLOSE);
    });

    it("caps substeps at maxSubSteps and resets alpha into [0, 1) on dropped time", () => {
        physics = new Physics();
        const max = CONFIG.physics.maxSubSteps;
        for (const dt of [0.1, 0.25, 10]) {
            let n = 0;
            const alpha = physics.step(dt, () => n++);
            expect(n).toBe(max);
            expect(alpha).toBeGreaterThanOrEqual(0);
            expect(alpha).toBeLessThan(1);
        }
        // 0.09 s owes 5.4 steps: 4 run, the whole step owed is dropped, phase kept (0.4).
        physics.dispose();
        physics = new Physics();
        let n = 0;
        const alpha = physics.step(0.09, () => n++);
        expect(n).toBe(max);
        expect(alpha).toBeCloseTo(0.4, 4);
        // The next 120 Hz frame continues from that phase, not from a backlog.
        let m = 0;
        expect(physics.step(1 / 120, () => m++)).toBeCloseTo(0.9, 4);
        expect(m).toBe(0);
    });

    it("ignores negative / NaN dt", () => {
        physics = new Physics();
        let n = 0;
        expect(physics.step(-1, () => n++)).toBe(0);
        expect(physics.step(Number.NaN, () => n++)).toBe(0);
        expect(n).toBe(0);
    });
});

describe("Physics link / interpolate / snap", () => {
    it("snap() makes a teleport appear instantly (prev = curr)", () => {
        physics = new Physics();
        const { body, obj } = slider(physics);
        physics.interpolate(physics.step(1 / 30, () => {}));
        body.setTranslation({ x: 50, y: 10, z: -20 }, true);
        physics.snap(body);
        expect(obj.position.x).toBeCloseTo(50, CLOSE);
        physics.interpolate(0.37);
        expect(obj.position.x).toBeCloseTo(50, CLOSE);
        expect(obj.position.z).toBeCloseTo(-20, CLOSE);
    });

    it("writes into the parent's frame when the parent group is offset", () => {
        physics = new Physics();
        const { body, obj } = slider(physics);
        const group = new THREE.Group();
        group.position.set(10, 0, 5);
        group.rotation.y = Math.PI / 2;
        group.add(obj);
        physics.snap(body);
        const world = obj.getWorldPosition(new THREE.Vector3());
        const t = body.translation();
        expect(world.x).toBeCloseTo(t.x, CLOSE);
        expect(world.y).toBeCloseTo(t.y, CLOSE);
        expect(world.z).toBeCloseTo(t.z, CLOSE);
    });

    it("unlink() stops updating the object", () => {
        physics = new Physics();
        const { body, obj } = slider(physics);
        physics.unlink(body);
        const x0 = obj.position.x;
        physics.interpolate(physics.step(0.05, () => {}));
        expect(obj.position.x).toBe(x0);
    });
});

describe("Physics colliders", () => {
    it("addFixedConvexHull falls back to a bbox cuboid (with a warning) when convexHull returns null", () => {
        physics = new Physics();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(RAPIER.ColliderDesc, "convexHull").mockReturnValue(null);
        const pts = new Float32Array([0, 0, 0, 10, 0, 0, 10, 2.4, 0, 0, 0, 8, 10, 0, 8, 10, 2.4, 8]);
        const body = physics.addFixedConvexHull(pts, { x: -84, y: 0, z: -40 }, { x: 0, y: 0, z: 0, w: 1 });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(body.numColliders()).toBe(1);
        const c = body.collider(0);
        expect(c.shape.type).toBe(RAPIER.ShapeType.Cuboid);
        const half = c.halfExtents()!;
        expect([half.x, half.y, half.z]).toEqual([5, expect.closeTo(1.2, 5), 4]);
        const t = c.translation();
        expect([t.x, t.y, t.z].map((v) => +v.toFixed(5))).toEqual([-79, 1.2, -36]);
    });

    it("falls back too when the points are degenerate (Rapier rejects the hull)", () => {
        physics = new Physics();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const collinear = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
        const body = physics.addFixedConvexHull(collinear, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(body.collider(0).shape.type).toBe(RAPIER.ShapeType.Cuboid);
    });

    it("builds a real convex hull for a valid wedge", () => {
        physics = new Physics();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const wedge = new Float32Array([5, 0, -4, 5, 0, 4, -5, 0, -4, -5, 0, 4, -5, 2.4, -4, -5, 2.4, 4]);
        const body = physics.addFixedConvexHull(wedge, { x: -84, y: 0, z: -40 }, { x: 0, y: 0, z: 0, w: 1 });
        expect(warn).not.toHaveBeenCalled();
        expect(body.collider(0).shape.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
    });

    it("bboxOf never returns a zero half-extent", () => {
        const b = bboxOf(new Float32Array([0, 0, 0, 2, 0, 4]));
        expect(b.center).toEqual({ x: 1, y: 0, z: 2 });
        expect(b.half.y).toBeGreaterThan(0);
    });

    it("ground slab top sits at y = 0", () => {
        physics = new Physics();
        const body = physics.addGroundSlab();
        const G = CONFIG.world.groundSlab;
        expect(body.translation().y + body.collider(0).halfExtents()!.y).toBeCloseTo(G.center.y + G.halfExtents.y);
        expect(G.center.y + G.halfExtents.y).toBe(0);
    });

    it("letters keep the body origin at the baseline and offset the collider", () => {
        physics = new Physics();
        const body = physics.addDynamicLetter({ x: 1, y: 2, z: 0.6 }, { x: -11, y: 0, z: 4 }, { offset: { x: 0, y: 2, z: 0 } });
        expect(body.translation().y).toBeCloseTo(0, CLOSE);
        expect(body.collider(0).translation().y).toBeCloseTo(2, CLOSE);
        expect(body.mass()).toBeCloseTo(CONFIG.physics.dynamicLetter.mass, 3);
    });
});

describe("Physics impacts", () => {
    it("onImpact reports a dropped brick with its kind and a force ≥ its threshold", () => {
        physics = new Physics();
        physics.addGroundSlab();
        const box = physics.addDynamicBox({ x: 1, y: 0.5, z: 0.5 }, { x: 0, y: 6, z: 0 }, { mass: 25 });
        const hits: { kind: string; force: number }[] = [];
        const off = physics.onImpact((kind, force) => hits.push({ kind, force }));
        for (let i = 0; i < 120; i++) physics.step(H, () => {});
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].kind).toBe("wood");
        expect(hits[0].force).toBeGreaterThanOrEqual(1);
        // At rest the brick stays below threshold: no further flood of events.
        off();
        const count = hits.length;
        for (let i = 0; i < 60; i++) physics.step(H, () => {});
        expect(hits.length).toBe(count);
        expect(box.translation().y).toBeCloseTo(0.5, 1);
    });

    it("silent bodies (impact: null) never report", () => {
        physics = new Physics();
        physics.addGroundSlab();
        physics.addDynamicBox({ x: 1, y: 0.5, z: 0.5 }, { x: 0, y: 6, z: 0 }, { mass: 25, impact: null });
        const cb = vi.fn();
        physics.onImpact(cb);
        for (let i = 0; i < 120; i++) physics.step(H, () => {});
        expect(cb).not.toHaveBeenCalled();
    });

    it("a stacked wall spawned at rest does not flood impacts (resting contacts are filtered)", () => {
        physics = new Physics();
        physics.addGroundSlab();
        // 6 × 5 running-bond wall of mass-25 bricks, each row resting on the one below:
        // the bottom rows carry 2–4× a single brick's threshold.
        for (let row = 0; row < BRICK_ROWS; row++) {
            for (let col = 0; col < BRICK_COLS; col++) {
                const x = (col - BRICK_COLS / 2) * 2 * BRICK.x + (row % 2) * BRICK.x;
                physics.addDynamicBox(BRICK, { x, y: BRICK.y + row * 2 * BRICK.y, z: 0 }, { mass: BRICK_MASS });
            }
        }
        const cb = vi.fn();
        physics.onImpact(cb);
        for (let i = 0; i < 1 / H; i++) physics.step(H, () => {});
        expect(cb.mock.calls.length).toBeLessThanOrEqual(MAX_RESTING_EVENTS);
    });

    it("a 3-brick column at rest stays silent", () => {
        physics = new Physics();
        physics.addGroundSlab();
        for (let i = 0; i < 3; i++) {
            physics.addDynamicBox(BRICK, { x: 0, y: BRICK.y + i * 2 * BRICK.y, z: 0 }, { mass: BRICK_MASS });
        }
        const cb = vi.fn();
        physics.onImpact(cb);
        for (let i = 0; i < 1 / H; i++) physics.step(H, () => {});
        expect(cb).not.toHaveBeenCalled();
    });

    it("still reports a landing with no bounce (moving before the step counts)", () => {
        physics = new Physics();
        physics.addGroundSlab();
        physics.addDynamicBox(BRICK, { x: 0, y: 6, z: 0 }, { mass: BRICK_MASS, restitution: 0 });
        const cb = vi.fn();
        physics.onImpact(cb);
        for (let i = 0; i < 1 / H; i++) physics.step(H, () => {});
        expect(cb).toHaveBeenCalled();
        expect(cb.mock.calls[0][0]).toBe("wood");
    });

    it("reports a resting brick struck by a silent body (moving after the step counts)", () => {
        physics = new Physics();
        physics.addGroundSlab();
        physics.addDynamicBox(BRICK, { x: 0, y: BRICK.y, z: 0 }, { mass: BRICK_MASS });
        const cb = vi.fn();
        physics.onImpact(cb);
        for (let i = 0; i < 30; i++) physics.step(H, () => {});
        expect(cb).not.toHaveBeenCalled();
        // A heavy silent "car" slides into the brick along +X.
        const ram = physics.addDynamicBox({ x: 1, y: 0.4, z: 0.6 }, { x: -4, y: 0.4, z: 0 }, {
            mass: 900,
            impact: null,
            linearDamping: 0,
        });
        ram.setLinvel({ x: 15, y: 0, z: 0 }, true);
        for (let i = 0; i < 30; i++) physics.step(H, () => {});
        expect(cb).toHaveBeenCalled();
    });
});

describe("utils/sizes computeBufferSize (§3.4 item 2)", () => {
    it("uses the device-pixel box as-is when the device DPR is within the cap", () => {
        const s = computeBufferSize({ cssWidth: 1000.5, cssHeight: 600.25, devWidth: 2001, devHeight: 1201, dpr: 2, dprCap: 2 });
        expect([s.width, s.height, s.dpr, s.devicePixelExact]).toEqual([2001, 1201, 2, true]);
    });

    it("caps at round(css × cap) above the cap (DPR 3 on a cap-2 profile)", () => {
        const s = computeBufferSize({ cssWidth: 390, cssHeight: 844, devWidth: 1170, devHeight: 2532, dpr: 3, dprCap: 2 });
        expect([s.width, s.height, s.dpr]).toEqual([780, 1688, 2]);
    });

    it("phones on the mobile profile render at native DPR 3", () => {
        const s = computeBufferSize({ cssWidth: 390, cssHeight: 844, devWidth: 1170, devHeight: 2532, dpr: 3, dprCap: 3 });
        expect([s.width, s.height, s.dpr]).toEqual([1170, 2532, 3]);
    });

    it("Safari fallback: round(contentRect × min(dpr, cap))", () => {
        const s = computeBufferSize({ cssWidth: 1440.4, cssHeight: 900.6, dpr: 2, dprCap: 2 });
        expect([s.width, s.height, s.dpr, s.devicePixelExact]).toEqual([2881, 1801, 2, false]);
    });

    it("DPR does not depend on the CSS size (resize / devtools never change it)", () => {
        const a = computeBufferSize({ cssWidth: 1440, cssHeight: 900, dpr: 2, dprCap: 2 });
        const b = computeBufferSize({ cssWidth: 900, cssHeight: 900, dpr: 2, dprCap: 2 });
        expect(a.dpr).toBe(b.dpr);
    });

    it("never returns a zero-sized buffer", () => {
        const s = computeBufferSize({ cssWidth: 0.2, cssHeight: 0.1, dpr: 1, dprCap: 2 });
        expect([s.width, s.height]).toEqual([1, 1]);
    });
});

describe("utils/probe (§1.4 calibration rule)", () => {
    it("lit paper top #F9F7F6 decodes near the calibrated linear 0.952 / 0.927 / 0.919 and passes day", () => {
        const lin = srgbHexToLinear("#F9F7F6");
        expect(lin.r).toBeCloseTo(0.947, 2);
        expect(lin.g).toBeCloseTo(0.93, 2);
        expect(lin.b).toBeCloseTo(0.922, 2);
        expect(checkProbe(lin, LOOK.day.probe).pass).toBe(true);
        expect(linearToSrgbHex(lin.r, lin.g, lin.b)).toBe("#f9f7f6");
    });

    it("day fails per channel when any channel clips", () => {
        const v = checkProbe({ r: 0.99, g: 0.93, b: 0.92 }, LOOK.day.probe);
        expect(v.pass).toBe(false);
        expect(v.channels).toEqual({ r: false, g: true, b: true });
    });

    it("dusk checks only the highest channel", () => {
        expect(checkProbe({ r: 0.85, g: 0.6, b: 0.58 }, LOOK.dusk.probe).pass).toBe(true);
        expect(checkProbe({ r: 0.95, g: 0.6, b: 0.58 }, LOOK.dusk.probe).pass).toBe(false);
    });
});
