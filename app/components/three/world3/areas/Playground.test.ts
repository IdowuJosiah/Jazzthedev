import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT, PADS, RAMP_CORRIDOR, pointInRect, rectBounds } from "../Layout";
import { Physics, loadRapier } from "../Physics";
import { Materials } from "../Materials";
import { registeredAreaIds } from "../Areas";
import * as shapes from "../utils/shapes";
import { Disposal } from "../utils/disposal";
import type {
    AreaContext,
    Letter3D,
    RuntimeInfo,
    TextApi,
    TextHandle,
    TextOpts,
    Word3D,
    Word3DOptions,
    WorldInteractable,
} from "../types";
import { CHEVRON, LANE_MATERIAL, build, chevronGeometry, pinGeometries, wedgeGeometry, wedgeVertices, type PlaygroundHandle } from "./Playground";

// Playground (§2.4) against REAL Rapier: the convex-hull ramp, the dynamic
// ball / pins / bricks, reset + snap, and the instanced visuals. Text, 3D
// words and the store commands are stubs.

const PG = AREA_LAYOUT.playground;
const RAMP = PG.ramp;
const H = CONFIG.physics.fixedStep;
const EPS = 1e-6;
/** Rapier stores poses in float32. */
const F32_EPS = 1e-4;
/** Settling tolerance for the untouched props after a few seconds (units). */
const SETTLE_TOL = 0.05;
/** Seconds of simulation for the settling / impact checks. */
const SETTLE_S = 3;
/** Ball speed (u/s, toward −X) for the strike test. */
const STRIKE_SPEED = 18;

let physics: Physics | null = null;
let handle: PlaygroundHandle | null = null;

beforeAll(async () => {
    await loadRapier();
});

afterEach(() => {
    handle?.dispose?.();
    handle = null;
    physics?.dispose();
    physics = null;
    vi.restoreAllMocks();
});

type TextCall = { kind: "flat" | "upright" | "onPath"; opts: TextOpts; handle: TextHandle };

function stubCtx(fail: { interactable?: boolean } = {}) {
    physics = new Physics();
    physics.addGroundSlab();
    const p = physics;
    const texts: TextCall[] = [];
    const words: { text: string; opts: Word3DOptions; word: Word3D & { dispose: ReturnType<typeof vi.fn> } }[] = [];
    const interactables: WorldInteractable[] = [];
    const unregistered: WorldInteractable[] = [];
    const resetPlayground = vi.fn();
    const materials = new Materials();
    const lambert = vi.spyOn(materials, "lambert");
    const makeText =
        (kind: TextCall["kind"]) =>
        (o: TextOpts): TextHandle => {
            const h = { object: new THREE.Group(), mesh: {}, setText() {}, setColor() {}, dispose: vi.fn() } as unknown as TextHandle;
            texts.push({ kind, opts: o, handle: h });
            return h;
        };
    const runtime: RuntimeInfo = {
        carPos: new THREE.Vector3(PG.resetPad.x, 0, PG.resetPad.z),
        carSpeed: 0,
        reducedMotion: false,
        muted: true,
        isTouch: false,
    };
    const ctx = {
        group: new THREE.Group(),
        physics: p,
        materials,
        shapes,
        text: { flat: makeText("flat"), upright: makeText("upright"), onPath: makeText("onPath") } as unknown as TextApi,
        text3d: {
            word: (text: string, o: Word3DOptions) => {
                const group = new THREE.Group();
                const letters: Letter3D[] = Array.from(text).map(() => ({
                    mesh: new THREE.Mesh(),
                    home: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
                }));
                const word = { group, letters, reset: vi.fn(), dispose: vi.fn() };
                words.push({ text, opts: o, word });
                return word;
            },
        },
        assets: {},
        audio: { playImpact: vi.fn(), playUi: vi.fn(), getBands: () => null },
        commands: { openMenu: vi.fn(), openUrl: vi.fn(), resetPlayground },
        disposal: new Disposal(),
        runtime,
        def: AREA_BY_ID.playground,
        layout: Layout,
        addInteractable: (i: WorldInteractable) => {
            if (fail.interactable) throw new Error("registry failed");
            interactables.push(i);
            return () => unregistered.push(i);
        },
    } as unknown as AreaContext;
    return { ctx, physics: p, texts, words, interactables, unregistered, resetPlayground, lambert, runtime };
}

/** Steps the world `seconds` at 60 Hz and interpolates, like the Experience tick. */
function run(p: Physics, seconds: number, h: PlaygroundHandle) {
    const n = Math.round(seconds / H);
    for (let i = 0; i < n; i++) {
        p.interpolate(p.step(H, () => {}));
        h.update?.(H, i * H, {} as RuntimeInfo);
    }
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** World-space bbox of an object (after updating matrices). */
const worldBox = (o: THREE.Object3D) => {
    o.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(o);
};

describe("areas/Playground — geometry helpers", () => {
    it("the wedge's 6 vertices put the low edge at x −79 and the 2.4 lip at x −89 (rises toward −X)", () => {
        const v = wedgeVertices(RAMP.length, RAMP.width, RAMP.height);
        expect(v).toHaveLength(18);
        const pts = Array.from({ length: 6 }, (_, i) => ({ x: v[i * 3] + RAMP.x, y: v[i * 3 + 1], z: v[i * 3 + 2] + RAMP.z }));
        const low = pts.filter((q) => Math.abs(q.x - RAMP.lowEdgeX) < EPS);
        const lip = pts.filter((q) => Math.abs(q.x - RAMP.lipX) < EPS);
        expect(low).toHaveLength(2);
        expect(lip).toHaveLength(4);
        for (const q of low) expect(q.y).toBe(0);
        expect(Math.max(...lip.map((q) => q.y))).toBeCloseTo(RAMP.height, 6);
        for (const q of pts) expect(Math.abs(q.z - RAMP.z)).toBeCloseTo(RAMP.width / 2, 6);
    });

    it("wedge geometry: 8 triangles, every face normal points away from the prism's centroid", () => {
        const g = wedgeGeometry(RAMP.length, RAMP.width, RAMP.height);
        const pos = g.getAttribute("position");
        expect(pos.count).toBe(24);
        const centroid = new THREE.Vector3(-RAMP.length / 6, RAMP.height / 3, 0);
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const n = new THREE.Vector3();
        let slopeFaces = 0;
        for (let i = 0; i < pos.count; i += 3) {
            a.fromBufferAttribute(pos, i);
            b.fromBufferAttribute(pos, i + 1);
            c.fromBufferAttribute(pos, i + 2);
            n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
            const mid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
            expect(n.dot(mid.sub(centroid))).toBeGreaterThan(0);
            if (n.x > 0 && n.y > 0) slopeFaces++;
        }
        expect(slopeFaces).toBe(2); // the slope faces up and back toward the run-up (+X)
        g.dispose();
    });

    it("chevrons lie just above the slope, inside the ramp, and point up the slope (−X)", () => {
        const g = chevronGeometry(RAMP.length, RAMP.height, RAMP.chevrons);
        const pos = g.getAttribute("position");
        const slopeN = new THREE.Vector3(RAMP.height, RAMP.length, 0).normalize();
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            // Height above the slope plane (it passes through (0, h/2, 0)).
            expect(v.clone().sub(new THREE.Vector3(0, RAMP.height / 2, 0)).dot(slopeN)).toBeCloseTo(CHEVRON.lift, 6);
            expect(Math.abs(v.x)).toBeLessThan(RAMP.length / 2);
            expect(Math.abs(v.z)).toBeLessThanOrEqual(CHEVRON.halfSpan + EPS);
        }
        g.dispose();
        // One chevron: its tips (z = 0) are further −X than its arm ends (|z| = halfSpan).
        const one = chevronGeometry(RAMP.length, RAMP.height, 1).getAttribute("position");
        const tipsX: number[] = [];
        const endsX: number[] = [];
        for (let i = 0; i < one.count; i++) {
            v.fromBufferAttribute(one, i);
            if (Math.abs(v.z) < EPS) tipsX.push(v.x);
            else if (Math.abs(Math.abs(v.z) - CHEVRON.halfSpan) < EPS) endsX.push(v.x);
        }
        expect(tipsX.length).toBeGreaterThan(0);
        expect(Math.max(...tipsX)).toBeLessThan(Math.min(...endsX));
    });

    it("pin lathe: 2.2 high, centred on its origin, widest exactly at the collider radius", () => {
        const { body, band } = pinGeometries(PG.pin.height, PG.pin.radius);
        const box = new THREE.Box3().setFromBufferAttribute(body.getAttribute("position") as THREE.BufferAttribute);
        box.union(new THREE.Box3().setFromBufferAttribute(band.getAttribute("position") as THREE.BufferAttribute));
        expect(box.min.y).toBeCloseTo(-PG.pin.height / 2, 6);
        expect(box.max.y).toBeCloseTo(PG.pin.height / 2, 6);
        expect(box.max.x).toBeCloseTo(PG.pin.radius, 2);
        expect(box.max.x).toBeLessThanOrEqual(PG.pin.radius + EPS);
        body.dispose();
        band.dispose();
    });
});

describe("areas/Playground — build (§2.4)", () => {
    it("registers itself as the playground builder", () => {
        expect(registeredAreaIds()).toContain("playground");
    });

    it("PLAY: dynamic ink letters at area-title size, placed once at the title point, faceCamera", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        expect(s.words).toHaveLength(1);
        const w = s.words[0];
        const t = AREA_BY_ID.playground.title3D!;
        expect(w.text).toBe("PLAY");
        expect(w.opts).toEqual({
            cap: CONFIG.type.areaTitle.cap,
            depth: CONFIG.type.areaTitle.depth,
            curveSegments: CONFIG.type.areaTitle.curveSegments,
            color: PALETTE.ink,
            dynamic: true,
        });
        expect(w.word.group.parent).toBe(s.ctx.group);
        expect(w.word.group.position.toArray()).toEqual([t.x, 0, t.z]);
        expect(w.word.group.rotation.y).toBe(FACE_CAMERA_Y);
    });

    it("ramp: yellow flat-shaded wedge + ink chevrons on the plate layer + ONE convex-hull collider", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const r = handle.ramp;
        expect(s.lambert).toHaveBeenCalledWith(ACCENT.play, { flat: true });
        expect(s.lambert).toHaveBeenCalledWith(PALETTE.ink, { layer: "plate" });
        expect(r.mesh.castShadow).toBe(true);
        const box = worldBox(r.mesh);
        expect(box.min.x).toBeCloseTo(RAMP.lipX, 6);
        expect(box.max.x).toBeCloseTo(RAMP.lowEdgeX, 6);
        expect(box.max.y).toBeCloseTo(RAMP.height, 6);
        expect(r.chevrons.geometry.getAttribute("position").count).toBeGreaterThan(0);
        // The collider is a convex polyhedron (not the bbox fallback) at the ramp centre.
        expect(r.collider.isFixed()).toBe(true);
        expect(r.collider.numColliders()).toBe(1);
        expect(r.collider.collider(0).shape.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
        expect(r.collider.translation()).toEqual({ x: RAMP.x, y: 0, z: RAMP.z });
    });

    it("the ramp collider is a slope: a car-sized drop lands at the slope height, not the lip or the ground", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        s.physics.step(H, () => {}); // one step builds the broad phase the ray query reads
        const castAt = (x: number) => {
            const ray = new RAPIER.Ray({ x, y: 10, z: RAMP.z }, { x: 0, y: -1, z: 0 });
            const hit = s.physics.world.castRay(ray, 20, true, undefined, undefined, undefined, undefined, (c) =>
                c.parent()?.handle === handle!.ramp.collider.handle
            );
            return hit ? 10 - hit.timeOfImpact : null;
        };
        // Rises linearly from 0 at the low edge to 2.4 at the lip.
        for (const f of [0.25, 0.5, 0.75]) {
            const x = RAMP.lowEdgeX - f * RAMP.length;
            expect(castAt(x)).toBeCloseTo(f * RAMP.height, 3);
        }
    });

    it("lane: a 30 × 4 plaza strip on the plates layer from x −86 to −116 along z −56", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        // The shared plaza variant DayNight remaps, so the strip follows the night albedo.
        expect(LANE_MATERIAL).toEqual({ layer: "plaza" });
        expect(CONFIG.dayNight.albedoMaterials.plaza).toContainEqual(LANE_MATERIAL);
        expect(handle.lane.material).toBe(s.ctx.materials.lambert(PALETTE.plaza, { layer: "plaza" }));
        const box = worldBox(handle.lane);
        expect(box.min.x).toBeCloseTo(Math.min(PG.lane.fromX, PG.lane.toX), 6);
        expect(box.max.x).toBeCloseTo(Math.max(PG.lane.fromX, PG.lane.toX), 6);
        expect(box.min.z).toBeCloseTo(PG.lane.z - PG.lane.width / 2, 6);
        expect(box.max.z).toBeCloseTo(PG.lane.z + PG.lane.width / 2, 6);
        expect(box.max.y).toBeCloseTo(shapes.LAYERS.plate.y, 6);
        expect(handle.lane.castShadow).toBe(false);
        expect(handle.lane.renderOrder).toBe(shapes.LAYERS.plate.renderOrder);
    });

    it("ball: ink sphere r 1.3, mass 140, resting on the lane at (−90, −56), linked to its mesh", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const b = handle.ball;
        expect(s.lambert).toHaveBeenCalledWith(PALETTE.ink);
        expect(b.body.mass()).toBeCloseTo(PG.ball.mass, 3);
        expect(b.body.collider(0).shape.type).toBe(RAPIER.ShapeType.Ball);
        expect((b.body.collider(0).shape as RAPIER.Ball).radius).toBeCloseTo(PG.ball.radius, 6);
        const want = new THREE.Vector3(PG.ball.x, PG.ball.radius, PG.ball.z);
        expect(dist(b.body.translation(), want)).toBeLessThan(F32_EPS);
        expect(dist(b.object.position, want)).toBeLessThan(F32_EPS);
        expect(b.object.parent).toBe(s.ctx.group);
    });

    it("pins: 10 cylinder bodies (r 0.42, mass 8) in the apex-east triangle, standing on the ground", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        expect(handle.pins).toHaveLength(10);
        expect(PG.pins[0]).toEqual({ x: -110, z: -56 });
        handle.pins.forEach((pin, i) => {
            const c = pin.body.collider(0);
            expect(c.shape.type).toBe(RAPIER.ShapeType.Cylinder);
            expect((c.shape as RAPIER.Cylinder).radius).toBeCloseTo(PG.pin.radius, 6);
            expect((c.shape as RAPIER.Cylinder).halfHeight).toBeCloseTo(PG.pin.height / 2, 6);
            expect(pin.body.mass()).toBeCloseTo(PG.pin.mass, 4);
            expect(dist(pin.body.translation(), { x: PG.pins[i].x, y: PG.pin.height / 2, z: PG.pins[i].z })).toBeLessThan(F32_EPS);
            // Apex east: every other pin is further −X, rows 1.3 apart.
            if (i > 0) expect(PG.pins[i].x).toBeLessThan(PG.pins[0].x);
        });
        expect(new Set(PG.pins.map((q) => q.x)).size).toBe(4);
        // Paper bodies + brand band, both instanced (one draw call each).
        expect(handle.instanced.pinBodies.count).toBe(10);
        expect(handle.instanced.pinBands.count).toBe(10);
        expect(s.lambert).toHaveBeenCalledWith(ACCENT.brand);
        expect(ACCENT.brand).toBe("#E2553F");
    });

    it("brick wall: running bond of 28 full + 4 half dynamic bricks (32 bodies), faceCamera, instanced", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        expect(handle.bricks).toHaveLength(32);
        expect(handle.instanced.fullBricks.count).toBe(28);
        expect(handle.instanced.halfBricks.count).toBe(4);
        const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
        const full = handle.bricks.filter((b) => b.body.mass() > PG.wall.halfMass + EPS);
        const half = handle.bricks.filter((b) => Math.abs(b.body.mass() - PG.wall.halfMass) < 1e-3);
        expect(full).toHaveLength(28);
        expect(half).toHaveLength(4);
        for (const b of handle.bricks) {
            const q = b.body.rotation();
            expect(Math.abs(new THREE.Quaternion(q.x, q.y, q.z, q.w).dot(face))).toBeCloseTo(1, 6);
            const he = (b.body.collider(0).shape as RAPIER.Cuboid).halfExtents;
            const wantW = (b.body.mass() > PG.wall.halfMass + EPS ? PG.wall.brick.w : PG.wall.halfBrickW) / 2;
            expect(he.x).toBeCloseTo(wantW, 6);
            expect(he.y).toBeCloseTo(PG.wall.brick.h / 2, 6);
            expect(he.z).toBeCloseTo(PG.wall.brick.d / 2, 6);
        }
        expect(full[0].body.mass()).toBeCloseTo(PG.wall.mass, 3);
        // Rows of 6 full / 5 full + a half brick at each end, 5 high (§2.4: 32 bodies).
        const rows = new Map<number, number>();
        for (const b of handle.bricks) {
            const y = Math.round(b.body.translation().y * 10) / 10;
            rows.set(y, (rows.get(y) ?? 0) + 1);
        }
        expect([...rows.values()]).toEqual([6, 7, 6, 7, 6]);
    });

    it("everything except the ramp keeps RAMP_CORRIDOR clear, and the ramp lies inside it", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const c = rectBounds(RAMP_CORRIDOR);
        const intersectsCorridor = (b: THREE.Box3) => b.max.x > c.minX && b.min.x < c.maxX && b.max.z > c.minZ && b.min.z < c.maxZ;
        const rampGroup = handle.ramp.mesh.parent!;
        for (const child of s.ctx.group.children) {
            if (child === rampGroup) continue;
            if ((child as THREE.InstancedMesh).isInstancedMesh) continue; // checked through their bodies below
            const box = worldBox(child);
            if (box.isEmpty()) continue;
            expect(intersectsCorridor(box), child.name).toBe(false);
        }
        for (const p of [handle.ball, ...handle.pins, ...handle.bricks]) {
            const t = p.body.translation();
            expect(pointInRect(RAMP_CORRIDOR, t.x, t.z)).toBe(false);
        }
        const ramp = worldBox(rampGroup);
        expect(ramp.min.x).toBeGreaterThanOrEqual(c.minX);
        expect(ramp.max.x).toBeLessThanOrEqual(c.maxX);
        expect(ramp.min.z).toBeGreaterThanOrEqual(c.minZ);
        expect(ramp.max.z).toBeLessThanOrEqual(c.maxZ);
    });

    it("every prop body starts inside the playground rect", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const r = AREA_BY_ID.playground.rect;
        for (const p of [handle.ball, ...handle.pins, ...handle.bricks]) {
            const t = p.body.translation();
            expect(pointInRect(r, t.x, t.z)).toBe(true);
        }
    });

    it("left alone, the wall, pins and ball stay standing (no explosion, no slow collapse)", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        run(s.physics, SETTLE_S, handle);
        for (const p of [handle.ball, ...handle.pins, ...handle.bricks]) {
            expect(dist(p.body.translation(), p.home.position)).toBeLessThan(SETTLE_TOL);
        }
    });

    it("RESET pad: Layout's faceCamera pad + flat RESET label; interact runs resetPlayground; setActive drives the pad", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const spot = PADS.find((q) => q.id === "reset")!;
        expect(s.interactables).toHaveLength(1);
        const i = s.interactables[0];
        expect(i.pad).toEqual(spot.pad);
        expect(i.pad.faceCamera).toBe(true);
        expect(i.areaId).toBe("playground");
        expect(i.prompt).toEqual({ title: "Playground", action: "Reset" });
        expect(handle.resetPad.group.position.toArray()).toEqual([spot.pad.x, 0, spot.pad.z]);
        const label = s.texts.find((t) => t.opts.text === PG.resetLabel)!;
        expect(label.kind).toBe("flat");
        expect(label.opts).toMatchObject({ font: CONFIG.type.padLabel.font, size: CONFIG.type.padLabel.size, color: PALETTE.ink, layer: "groundText" });
        i.onInteract!();
        expect(s.resetPlayground).toHaveBeenCalledTimes(1);
        i.setActive!(true);
        expect(handle.resetPad.active).toBe(true);
        i.setActive!(false);
        expect(handle.resetPad.active).toBe(false);
        // No other text: Hub owns the P3 PLAYGROUND label.
        expect(s.texts).toHaveLength(1);
        expect(handle.pathLabels).toHaveLength(0);
    });

    it("update() copies interpolated body poses into the instance matrices and refits the bounds", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const brick = handle.bricks[0];
        const mesh = handle.instanced.fullBricks;
        brick.body.setTranslation({ x: -120, y: 6, z: -66 }, true);
        s.physics.snap(brick.body);
        handle.update!(0, 0, s.ctx.runtime as RuntimeInfo);
        const m = new THREE.Matrix4();
        mesh.getMatrixAt(0, m);
        const pos = new THREE.Vector3().setFromMatrixPosition(m);
        expect(pos.x).toBeCloseTo(-120, 6);
        expect(pos.y).toBeCloseTo(6, 6);
        expect(pos.z).toBeCloseTo(-66, 6);
        expect(mesh.boundingSphere!.containsPoint(pos)).toBe(true);
        expect(mesh.frustumCulled).toBe(true);
    });

    it("a sleeping wall is not re-uploaded every frame; one more sync lands after it falls asleep", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const mesh = handle.instanced.fullBricks;
        for (const b of handle.bricks) b.body.sleep();
        handle.update!(0, 0, s.ctx.runtime as RuntimeInfo); // the settling sync (awake at build)
        const v = mesh.instanceMatrix.version;
        handle.update!(0, 0, s.ctx.runtime as RuntimeInfo);
        handle.update!(0, 0, s.ctx.runtime as RuntimeInfo);
        expect(mesh.instanceMatrix.version).toBe(v);
        handle.bricks[3].body.wakeUp();
        handle.update!(0, 0, s.ctx.runtime as RuntimeInfo);
        expect(mesh.instanceMatrix.version).toBeGreaterThan(v);
    });

    it("the ball rolling into the pins knocks them over and reports impacts through physics.onImpact", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        const onImpact = vi.spyOn(s.physics, "onImpact");
        const hits: string[] = [];
        s.physics.onImpact((kind) => hits.push(kind));
        handle.ball.body.setLinvel({ x: -STRIKE_SPEED, y: 0, z: 0 }, true);
        run(s.physics, SETTLE_S, handle);
        const moved = handle.pins.filter((p) => dist(p.body.translation(), p.home.position) > PG.pin.radius);
        expect(moved.length).toBeGreaterThan(0);
        expect(hits).toContain("heavy");
        // The area never subscribes itself (the Experience routes onImpact → audio once).
        expect(onImpact).toHaveBeenCalledTimes(1);
        expect(s.ctx.audio.playImpact).not.toHaveBeenCalled();
    });

    it("reset(): bricks, pins and ball go home at rest, snapped (no interpolation across the jump), and PLAY resets", () => {
        const s = stubCtx();
        handle = build(s.ctx);
        handle.ball.body.setLinvel({ x: -STRIKE_SPEED, y: 0, z: 0 }, true);
        for (const b of handle.bricks.slice(0, 6)) b.body.setLinvel({ x: 4, y: 3, z: 4 }, true);
        run(s.physics, 1, handle);
        handle.reset!();
        expect(s.words[0].word.reset).toHaveBeenCalledTimes(1);
        for (const p of [handle.ball, ...handle.pins, ...handle.bricks]) {
            expect(dist(p.body.translation(), p.home.position)).toBeLessThan(EPS);
            const v = p.body.linvel();
            expect(Math.hypot(v.x, v.y, v.z)).toBe(0);
            // Snapped: interpolating at any alpha draws the home pose.
            s.physics.interpolate(0.5);
            expect(dist(p.object.position, p.home.position)).toBeLessThan(EPS);
        }
        const m = new THREE.Matrix4();
        handle.instanced.pinBodies.getMatrixAt(0, m);
        expect(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(handle.pins[0].home.position)).toBeLessThan(EPS);
        // And they stay put afterwards.
        run(s.physics, 1, handle);
        for (const p of [handle.ball, ...handle.pins, ...handle.bricks]) {
            expect(dist(p.body.translation(), p.home.position)).toBeLessThan(SETTLE_TOL);
        }
    });

    it("dispose removes every body, unregisters the pad, frees text and geometry, once", () => {
        const s = stubCtx();
        const before = s.physics.world.bodies.len();
        handle = build(s.ctx);
        expect(s.physics.world.bodies.len()).toBe(before + 1 + 1 + 10 + 32); // ramp, ball, pins, bricks
        const geos: ReturnType<typeof vi.spyOn>[] = [];
        s.ctx.group.traverse((o) => {
            const g = (o as THREE.Mesh).geometry;
            if (g) geos.push(vi.spyOn(g, "dispose"));
        });
        handle.dispose!();
        handle.dispose!();
        expect(s.physics.world.bodies.len()).toBe(before);
        expect(s.unregistered).toEqual(s.interactables);
        expect(s.words[0].word.dispose).toHaveBeenCalledTimes(1);
        for (const t of s.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        for (const g of geos) expect(g).toHaveBeenCalled();
        expect(s.ctx.group.children).toHaveLength(0);
        // reset / update after dispose are no-ops.
        expect(() => {
            handle!.reset!();
            handle!.update!(0, 0, s.ctx.runtime as RuntimeInfo);
        }).not.toThrow();
        handle = null;
    });

    it("a builder that throws frees every body and word it made, and rethrows", () => {
        const s = stubCtx({ interactable: true });
        const before = s.physics.world.bodies.len();
        expect(() => build(s.ctx)).toThrow("registry failed");
        expect(s.physics.world.bodies.len()).toBe(before);
        expect(s.words[0].word.dispose).toHaveBeenCalledTimes(1);
        expect(s.ctx.group.children).toHaveLength(0);
    });
});
