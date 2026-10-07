import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIG, PALETTE, type SceneryTier, type Vec3Like } from "./Config";
import { NATURE_DIR, NATURE_MODELS, natureKind, normalizeNature, prepareNature } from "./Assets";
import type { BlobSpot } from "./Environment";
import {
    AREAS,
    BANDS,
    BOUNDS,
    GROUND_TEXTS,
    JETTY,
    PADS,
    PATHS,
    PROPS,
    QUAY_Z,
    RAMP_CORRIDOR,
    RAMP_FOOTPRINT,
    TOKENS,
    convexPolygonsOverlap,
    footprintCorners,
    padFootprint,
    pathClearance,
    pointInRect,
    sunStrip,
    type Footprint,
} from "./Layout";
import { Materials, applyOccluder, hasOccluder } from "./Materials";
import {
    CHUNK,
    KIND_EXTENT,
    LOW_KINDS,
    SCENERY_KINDS,
    Scenery,
    boundsZone,
    buildScenery,
    computeSceneryPlan,
    distToConvex,
    distToFootprint,
    inGrove,
    modelTriangles,
    planScenery,
    sceneryReject,
    visibleCounts,
    type SceneryKind,
    type SceneryPlacement,
    type SceneryPlan,
} from "./Scenery";
import type { AssetsApi, ModelName, PhysicsApi, QuatLike, XZ } from "./types";
import { distToSegment2D, valueNoise2D } from "./utils/math";

const SC = CONFIG.scenery;
const TIERS: readonly SceneryTier[] = ["high", "medium", "low"];

const all = (plan: SceneryPlan): SceneryPlacement[] =>
    SCENERY_KINDS.flatMap((k) => [...plan.inBounds[k], ...plan.bands[k]]);

// One plan for the read-only tests (planning takes ~0.1 s).
let plan: SceneryPlan;
beforeAll(() => {
    plan = planScenery();
});

// ── Plan: determinism and budgets ────────────────────────────────────────
describe("planScenery (§2.6)", () => {
    it("is deterministic for a fixed seed and changes with the seed", () => {
        expect(computeSceneryPlan(CONFIG.world.seed)).toEqual(plan);
        const other = planScenery(CONFIG.world.seed + 1);
        expect(other.inBounds.tree.map((p) => [p.x, p.z])).not.toEqual(plan.inBounds.tree.map((p) => [p.x, p.z]));
    });

    it("memoises the plan per seed and freezes it", () => {
        expect(planScenery()).toBe(plan);
        expect(planScenery(CONFIG.world.seed)).toBe(plan);
        expect(Object.isFrozen(plan)).toBe(true);
        expect(Object.isFrozen(plan.inBounds.palm)).toBe(true);
        expect(Object.isFrozen(plan.inBounds.palm[0])).toBe(true);
        // A fresh computation is a new, unfrozen object with the same content.
        const fresh = computeSceneryPlan();
        expect(fresh).not.toBe(plan);
        expect(Object.isFrozen(fresh)).toBe(false);
    });

    it("stays within the high-tier counts in bounds and the band extras outside", () => {
        for (const k of SCENERY_KINDS) {
            expect(plan.inBounds[k].length).toBeLessThanOrEqual(SC.counts[k].high);
            expect(plan.bands[k].length).toBeLessThanOrEqual(SC.bandExtras[k]);
            for (const p of plan.inBounds[k]) expect(p.inBounds).toBe(true);
            for (const p of plan.bands[k]) expect(p.inBounds).toBe(false);
        }
        // The current layout fills every high-tier budget, so the tiers differ.
        for (const k of SCENERY_KINDS) expect(plan.inBounds[k].length).toBe(SC.counts[k].high);
    });

    it("visible counts never exceed a tier's budget (plus band extras) at any density", () => {
        for (const tier of TIERS) {
            for (const f of [1, 1 - CONFIG.quality.sceneryReduction, 0.25, 0]) {
                const c = visibleCounts(plan, tier, f);
                for (const k of SCENERY_KINDS) {
                    expect(c[k].inBounds).toBeLessThanOrEqual(Math.round(SC.counts[k][tier] * f));
                    expect(c[k].bands).toBeLessThanOrEqual(Math.round(SC.bandExtras[k] * f));
                }
            }
        }
        const high = visibleCounts(plan, "high", 1);
        const low = visibleCounts(plan, "low", 1);
        for (const k of SCENERY_KINDS) expect(low[k].inBounds).toBe(SC.counts[k].low);
        expect(high.tree.inBounds).toBe(SC.counts.tree.high);
    });

    it("keeps the scale ranges", () => {
        const S = SC.scale;
        const within = (v: number, [a, b]: readonly [number, number]) => v >= a && v <= b;
        for (const p of all(plan)) {
            if (p.kind === "tree") expect(within(p.sx, S.tree)).toBe(true);
            if (p.kind === "bush") expect(within(p.sx, S.bush)).toBe(true);
            if (p.kind === "palm") {
                expect(within(p.height, S.palmHeight)).toBe(true);
                expect(p.lean).toBeLessThanOrEqual(THREE.MathUtils.degToRad(S.palmLeanDeg) + 1e-12);
            }
            if (p.kind === "boulder") {
                expect(within(p.sx, S.boulderX) && within(p.sy, S.boulderY) && within(p.sz, S.boulderZ)).toBe(true);
            }
        }
    });

    it("bush clusters hold 2–3 bushes (members can drop out at a rule edge)", () => {
        const sizes = new Map<number, number>();
        for (const p of [...plan.inBounds.bush, ...plan.bands.bush]) sizes.set(p.cluster, (sizes.get(p.cluster) ?? 0) + 1);
        for (const n of sizes.values()) {
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(SC.scale.bushCluster[1]);
        }
        // Most clusters are full.
        const full = [...sizes.values()].filter((n) => n >= SC.scale.bushCluster[0]).length;
        expect(full / sizes.size).toBeGreaterThan(0.6);
    });
});

// ── Plan: acceptance rules, checked independently of sceneryReject ──────
/** Brute-force distance from a point to an oriented footprint (its polygon). */
function polyDist(f: Footprint, x: number, z: number): number {
    const c = footprintCorners(f);
    const inside = convexPolygonsOverlap(c, tinySquare(x, z));
    if (inside) return 0;
    let best = Infinity;
    for (let i = 0; i < c.length; i++) {
        const a = c[i];
        const b = c[(i + 1) % c.length];
        best = Math.min(best, distToSegment2D(x, z, a.x, a.z, b.x, b.z));
    }
    return best;
}

const EPS = 1e-4;
const tinySquare = (x: number, z: number): XZ[] => [
    { x: x - EPS, z: z - EPS },
    { x: x + EPS, z: z - EPS },
    { x: x + EPS, z: z + EPS },
    { x: x - EPS, z: z + EPS },
];

describe("acceptance rules (§2.6)", () => {
    it("distToFootprint matches the polygon distance", () => {
        const f: Footprint = { x: 3, z: -2, hu: 4, hv: 1.5, rot: Math.PI / 4 };
        for (const [x, z] of [
            [3, -2],
            [10, 4],
            [-6, 1],
            [3, 6],
            [8, -9],
        ]) {
            expect(distToFootprint(f, x, z)).toBeCloseTo(polyDist(f, x, z), 6);
        }
    });

    it("no prop stands in the lagoon, on the jetty or within 4 of the quay", () => {
        for (const p of all(plan)) {
            expect(p.z).toBeGreaterThanOrEqual(QUAY_Z + CONFIG.world.quay.sceneryClearance);
            expect(pointInRect(JETTY.rect, p.x, p.z)).toBe(false);
        }
    });

    it("no prop inside any area rect expanded by 4, or the ramp corridor", () => {
        const c = SC.areaClearance;
        for (const p of all(plan)) {
            expect(pointInRect(RAMP_CORRIDOR, p.x, p.z)).toBe(false);
            for (const a of AREAS) {
                const inside = Math.abs(p.x - a.rect.x) <= a.rect.w / 2 + c && Math.abs(p.z - a.rect.z) <= a.rect.d / 2 + c;
                expect(inside, `${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) in ${a.id}`).toBe(false);
            }
        }
    });

    it("every prop is more than (path half-width + 3) from every path", () => {
        for (const p of all(plan)) {
            for (const path of PATHS) {
                const d = distToSegment2D(p.x, p.z, path.from.x, path.from.z, path.to.x, path.to.z);
                expect(d, `${p.kind} near ${path.id}`).toBeGreaterThan(pathClearance(path));
            }
        }
    });

    it("every prop is more than 4 from tokens, titles / props and pads", () => {
        const c = SC.featureClearance;
        const features = [...PROPS.map((f) => f.footprint), RAMP_FOOTPRINT, ...PADS.map((p) => padFootprint(p.pad))];
        for (const p of all(plan)) {
            for (const t of TOKENS) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThan(c);
            for (const f of features) expect(polyDist(f, p.x, p.z)).toBeGreaterThan(c);
        }
    });

    it("no prop stands in a ground-text sun-side strip", () => {
        const strips = GROUND_TEXTS.map((g) => ({ id: g.id, poly: sunStrip(g.footprint) }));
        for (const p of all(plan)) {
            for (const s of strips) {
                expect(convexPolygonsOverlap(s.poly, tinySquare(p.x, p.z)), `${p.kind} in ${s.id} strip`).toBe(false);
            }
        }
    });

    it("sceneryReject flags each rule", () => {
        expect(sceneryReject(0, QUAY_Z + 1)).toBe("quay");
        expect(sceneryReject(-100, -40)).toBe("corridor");
        expect(sceneryReject(0, 2)).toBe("area");
        expect(sceneryReject(2, -32)).toBe("path");
        expect(sceneryReject(TOKENS[3].x, TOKENS[3].z)).toBe("token");
    });

    it("sceneryReject flags a pad, a ground text, and a sun-side strip (checked independently)", () => {
        const pads = PADS.map((p) => padFootprint(p.pad));
        const pad = scanFor((x, z) => sceneryReject(x, z) === "pad");
        expect(pad).not.toBeNull();
        expect(Math.min(...pads.map((f) => polyDist(f, pad!.x, pad!.z)))).toBeLessThanOrEqual(SC.featureClearance);

        // A tree crown overhanging a ground text where a bare point would pass.
        const reach = KIND_EXTENT.tree.reach;
        const text = scanFor((x, z) => sceneryReject(x, z) === null && sceneryReject(x, z, "tree") === "groundText");
        expect(text).not.toBeNull();
        expect(Math.min(...GROUND_TEXTS.map((g) => polyDist(g.footprint, text!.x, text!.z)))).toBeLessThanOrEqual(reach);

        const strip = scanFor((x, z) => sceneryReject(x, z) === "sunStrip");
        expect(strip).not.toBeNull();
        const inStrip = (q: XZ) =>
            GROUND_TEXTS.some((g) => convexPolygonsOverlap(sunStrip(g.footprint), tinySquare(q.x, q.z)));
        expect(inStrip(strip!)).toBe(true);
        // A palm just outside every strip whose crown or shadow still reaches one.
        const palm = scanFor((x, z) => sceneryReject(x, z) === null && sceneryReject(x, z, "palm") === "sunStrip");
        expect(palm).not.toBeNull();
        expect(inStrip(palm!)).toBe(false);
    });

    it("the jetty and feature rules are backed up: every such point is rejected", () => {
        // The jetty lies inside the quay clearance, and every title / hand-placed
        // prop inside an area: the earlier rules catch them first, but a point
        // there must never be accepted.
        const step = 0.5;
        const r = JETTY.rect;
        for (let x = r.x - r.w / 2; x <= r.x + r.w / 2; x += step) {
            for (let z = r.z - r.d / 2; z <= r.z + r.d / 2; z += step) expect(sceneryReject(x, z)).not.toBeNull();
        }
        const c = SC.featureClearance;
        for (const f of [...PROPS.map((p) => p.footprint), RAMP_FOOTPRINT]) {
            const ext = Math.hypot(f.hu, f.hv) + c;
            for (let x = f.x - ext; x <= f.x + ext; x += step) {
                for (let z = f.z - ext; z <= f.z + ext; z += step) {
                    if (polyDist(f, x, z) <= c) expect(sceneryReject(x, z)).not.toBeNull();
                }
            }
        }
    });

    it("each prop's crown / footprint disc misses every ground-text footprint", () => {
        for (const p of all(plan)) {
            const reach = KIND_EXTENT[p.kind].reach;
            for (const g of GROUND_TEXTS) {
                expect(polyDist(g.footprint, p.x, p.z), `${p.kind} over ${g.id}`).toBeGreaterThan(reach);
            }
        }
    });

    it("tall props keep their crown out of each text's strip, lengthened to their shadow", () => {
        // Shadow length from the sun's elevation, computed here independently.
        const d = CONFIG.lights.sunDirection;
        const tan = d.y / Math.hypot(d.x, d.z);
        expect(KIND_EXTENT.palm.height / tan).toBeGreaterThan(SC.sunStripLength);
        for (const p of all(plan).filter((q) => q.kind === "tree" || q.kind === "palm")) {
            const { reach, height } = KIND_EXTENT[p.kind];
            for (const g of GROUND_TEXTS) {
                const strip = sunStrip(g.footprint, Math.max(SC.sunStripLength, height / tan));
                let dist = Infinity;
                if (convexPolygonsOverlap(strip, tinySquare(p.x, p.z))) dist = 0;
                for (let i = 0; i < strip.length; i++) {
                    const a = strip[i];
                    const b = strip[(i + 1) % strip.length];
                    dist = Math.min(dist, distToSegment2D(p.x, p.z, a.x, a.z, b.x, b.z));
                }
                expect(dist, `${p.kind} shadows ${g.id}`).toBeGreaterThan(reach);
                expect(distToConvex(strip, p.x, p.z)).toBeCloseTo(dist, 9);
            }
        }
    });

    it("a palm's reach covers palm.glb's measured crown and its lean", () => {
        const S = SC.scale;
        const lean = Math.sin(THREE.MathUtils.degToRad(S.palmLeanDeg)) * S.palmHeight[1];
        expect(KIND_EXTENT.palm.reach).toBeGreaterThanOrEqual(S.palmHeight[1] * 0.78 + lean - 1e-9);
        expect(KIND_EXTENT.tree.reach).toBeCloseTo(1.7 * S.tree[1], 9);
    });
});

/** The first grid point over the bounds (step 0.5) that passes `test`. */
function scanFor(test: (x: number, z: number) => boolean): XZ | null {
    for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 0.5) {
        for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 0.5) if (test(x, z)) return { x, z };
    }
    return null;
}

// ── Plan: zones ──────────────────────────────────────────────────────────
describe("zone rules (§2.6)", () => {
    const inset = SC.boundsInset;
    const e = SC.edgeZone;

    it("in-bounds props sit inside the bounds shrunk by 2; band props inside their band", () => {
        for (const k of SCENERY_KINDS) {
            for (const p of plan.inBounds[k]) {
                expect(p.x).toBeGreaterThanOrEqual(BOUNDS.minX + inset);
                expect(p.x).toBeLessThanOrEqual(BOUNDS.maxX - inset);
                expect(p.z).toBeGreaterThanOrEqual(BOUNDS.minZ + inset);
                expect(p.z).toBeLessThanOrEqual(BOUNDS.maxZ - inset);
            }
            for (const p of plan.bands[k]) {
                expect(BANDS.some((b) => pointInRect(b.rect, p.x, p.z))).toBe(true);
            }
        }
    });

    it("within 22 of the south or east bound: bushes and boulders only", () => {
        for (const p of plan.inBounds.tree.concat(plan.inBounds.palm)) {
            expect(BOUNDS.maxZ - p.z).toBeGreaterThan(e);
            expect(BOUNDS.maxX - p.x).toBeGreaterThan(e);
        }
        for (const p of all(plan).filter((q) => q.zone === "low" || q.zone === "band-low")) {
            expect(LOW_KINDS.has(p.kind)).toBe(true);
        }
    });

    it("interior props stand in groves (noise > 0.15); the west edge forest has no mask", () => {
        let westUnmasked = 0;
        for (const p of SCENERY_KINDS.flatMap((k) => plan.inBounds[k])) {
            expect(p.zone).toBe(boundsZone(p.x, p.z));
            const interior =
                p.x - BOUNDS.minX > e && BOUNDS.maxX - p.x > e && BOUNDS.maxZ - p.z > e && p.z - BOUNDS.minZ > e;
            const noise = valueNoise2D(p.x / SC.grove.scale, p.z / SC.grove.scale, CONFIG.world.seed);
            if (interior) expect(noise).toBeGreaterThan(SC.grove.threshold);
            if (p.zone === "grove") expect(inGrove(p.x, p.z)).toBe(true);
            if (p.zone === "edge" && noise <= SC.grove.threshold) westUnmasked++;
        }
        expect(westUnmasked).toBeGreaterThan(0);
    });

    it("the south and east bands hold bushes and boulders only; the west band all kinds", () => {
        const west = BANDS.find((b) => b.id === "west")!;
        for (const p of all(plan).filter((q) => !q.inBounds)) {
            if (!pointInRect(west.rect, p.x, p.z)) expect(LOW_KINDS.has(p.kind)).toBe(true);
        }
        expect(plan.bands.tree.every((p) => pointInRect(west.rect, p.x, p.z))).toBe(true);
        expect(plan.bands.tree.length).toBeGreaterThan(0);
        expect(plan.bands.palm.length).toBeGreaterThan(0);
    });

    it("keeps the Poisson radii: 6 between trees / palms, 3.5 for bush clusters and boulders", () => {
        const minPair = (a: readonly XZ[], b: readonly XZ[], same: boolean) => {
            let m = Infinity;
            for (let i = 0; i < a.length; i++) {
                for (let j = same ? i + 1 : 0; j < b.length; j++) m = Math.min(m, Math.hypot(a[i].x - b[j].x, a[i].z - b[j].z));
            }
            return m;
        };
        const tall = all(plan).filter((p) => p.kind === "tree" || p.kind === "palm");
        expect(minPair(tall, tall, true)).toBeGreaterThanOrEqual(SC.poissonRadius.tree);
        const boulders = [...plan.inBounds.boulder, ...plan.bands.boulder];
        expect(minPair(boulders, boulders, true)).toBeGreaterThanOrEqual(SC.poissonRadius.boulder);
        const bushes = [...plan.inBounds.bush, ...plan.bands.bush];
        const firstOfCluster = bushes.filter((p, i) => i === 0 || bushes[i - 1].cluster !== p.cluster);
        expect(minPair(firstOfCluster, firstOfCluster, true)).toBeGreaterThanOrEqual(SC.poissonRadius.bush);
        // Bushes of different clusters keep the bush radius too.
        let crossCluster = Infinity;
        for (let i = 0; i < bushes.length; i++) {
            for (let j = i + 1; j < bushes.length; j++) {
                if (bushes[i].cluster === bushes[j].cluster) continue;
                crossCluster = Math.min(crossCluster, Math.hypot(bushes[i].x - bushes[j].x, bushes[i].z - bushes[j].z));
            }
        }
        expect(crossCluster).toBeGreaterThanOrEqual(SC.poissonRadius.bush);
        // Later kinds keep the smaller radius from earlier ones.
        expect(minPair(boulders, tall, false)).toBeGreaterThanOrEqual(SC.poissonRadius.boulder);
        expect(minPair(bushes, tall, false)).toBeGreaterThanOrEqual(SC.poissonRadius.bush);
        expect(minPair(bushes, boulders, false)).toBeGreaterThanOrEqual(SC.poissonRadius.bush);
    });
});

// ── Build ────────────────────────────────────────────────────────────────
interface FakeBody {
    enabled: boolean;
    kind: "cylinder" | "cuboid";
    setEnabled(on: boolean): void;
}

function mockPhysics() {
    const bodies: FakeBody[] = [];
    const removed: FakeBody[] = [];
    const make = (kind: FakeBody["kind"]) => {
        const b: FakeBody = {
            enabled: true,
            kind,
            setEnabled(on: boolean) {
                b.enabled = on;
            },
        };
        bodies.push(b);
        return b;
    };
    const cylinders: { halfHeight: number; radius: number; pos: Vec3Like }[] = [];
    const cuboids: { half: Vec3Like; pos: Vec3Like; quat?: QuatLike; offset?: Vec3Like }[] = [];
    const api = {
        addFixedCylinder: (halfHeight: number, radius: number, pos: Vec3Like) => {
            cylinders.push({ halfHeight, radius, pos });
            return make("cylinder");
        },
        addFixedCuboid: (half: Vec3Like, pos: Vec3Like, quat?: QuatLike, offset?: Vec3Like) => {
            cuboids.push({ half, pos, quat, offset });
            return make("cuboid");
        },
        removeBody: (b: FakeBody) => removed.push(b),
    } as unknown as PhysicsApi;
    return { api, bodies, removed, cylinders, cuboids };
}

function mockEnvironment() {
    const ranges: { spots: readonly BlobSpot[]; count: number; calls: number }[] = [];
    const state = { disposed: false };
    return {
        ranges,
        state,
        api: {
            addPropBlobs(spots: readonly BlobSpot[]) {
                const r = { spots, count: spots.length, calls: 0 };
                ranges.push(r);
                return {
                    start: 0,
                    size: spots.length,
                    setCount: (n: number) => {
                        r.count = n;
                        r.calls++;
                    },
                };
            },
            isDisposed: () => state.disposed,
        },
    };
}

const PALM_HEIGHT = 2;
/** A stand-in palm: a textured Lambert patched with the occluder, like Assets.preparePalm. */
function fakePalm(): THREE.Object3D {
    const geo = new THREE.CylinderGeometry(0.2, 0.3, PALM_HEIGHT, 5);
    geo.translate(0, PALM_HEIGHT / 2, 0);
    const mat = applyOccluder(new THREE.MeshLambertMaterial({ map: new THREE.Texture() }));
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, mat));
    return root;
}

function assetsWith(models: Partial<Record<ModelName, THREE.Object3D>>): AssetsApi {
    return {
        model: (name: ModelName) => models[name]?.clone(true) ?? null,
        texture: () => Promise.reject(new Error("no textures in tests")),
        boards: {} as AssetsApi["boards"],
    };
}

const PUBLIC = join(__dirname, "../../../../public");
function parseGLB(file: string): Promise<GLTF> {
    const b = readFileSync(file);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    return new Promise((resolve, reject) => new GLTFLoader().parse(ab, "", resolve, reject));
}

/** World-space top of every drawn instance of a set of meshes. */
function instanceTops(meshes: THREE.InstancedMesh[]): number[] {
    const tops: number[] = [];
    const m = new THREE.Matrix4();
    for (const mesh of meshes) {
        mesh.geometry.computeBoundingBox();
        for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, m);
            tops.push(mesh.geometry.boundingBox!.clone().applyMatrix4(m).max.y);
        }
    }
    return tops;
}

const meshesOf = (s: Scenery, kind: SceneryKind) =>
    s.meshes.filter((m) => m.parent?.name.startsWith(`scenery-${kind}-`));

const drawn = (s: Scenery, kind: SceneryKind) => {
    // Every sub-mesh of a set draws the same count: sum one mesh per set.
    const sets = new Map<THREE.Object3D, number>();
    for (const m of meshesOf(s, kind)) sets.set(m.parent!, m.count);
    return [...sets.values()].reduce((a, b) => a + b, 0);
};

/** World AABB of each drawn in-bounds boulder: the union over its set's sub-meshes. */
function boulderInstanceBoxes(s: Scenery): THREE.Box3[] {
    const bySet = new Map<THREE.Object3D, THREE.InstancedMesh[]>();
    for (const m of meshesOf(s, "boulder")) {
        if (!m.parent!.name.includes("bounds")) continue;
        bySet.set(m.parent!, [...(bySet.get(m.parent!) ?? []), m]);
    }
    const out: THREE.Box3[] = [];
    const mat = new THREE.Matrix4();
    for (const meshes of bySet.values()) {
        for (let i = 0; i < meshes[0].count; i++) {
            const box = new THREE.Box3();
            for (const m of meshes) {
                m.geometry.computeBoundingBox();
                m.getMatrixAt(i, mat);
                box.union(m.geometry.boundingBox!.clone().applyMatrix4(mat));
            }
            out.push(box);
        }
    }
    return out;
}

/** World AABB of a recorded cuboid collider: offset and box turned by quat, at pos. */
function cuboidBox(c: { half: Vec3Like; pos: Vec3Like; quat?: QuatLike; offset?: Vec3Like }): THREE.Box3 {
    const local = new THREE.Box3(
        new THREE.Vector3(-c.half.x, -c.half.y, -c.half.z),
        new THREE.Vector3(c.half.x, c.half.y, c.half.z)
    );
    const o = c.offset ?? { x: 0, y: 0, z: 0 };
    local.translate(new THREE.Vector3(o.x, o.y, o.z));
    const q = c.quat ?? { x: 0, y: 0, z: 0, w: 1 };
    const m = new THREE.Matrix4().compose(
        new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z),
        new THREE.Quaternion(q.x, q.y, q.z, q.w),
        new THREE.Vector3(1, 1, 1)
    );
    return local.applyMatrix4(m);
}

/** Each boulder collider's world AABB equals one drawn boulder's world bbox. */
function expectBoulderCollidersMatch(s: Scenery, cuboids: Parameters<typeof cuboidBox>[0][]) {
    const boxes = boulderInstanceBoxes(s);
    expect(boxes).toHaveLength(cuboids.length);
    for (const c of cuboids) {
        // A pure yaw: the collider stays upright like the drawn rock.
        expect(Math.abs(c.quat!.x) + Math.abs(c.quat!.z)).toBeLessThan(1e-12);
        const want = cuboidBox(c);
        const match = boxes.find((b) => b.min.distanceTo(want.min) < 1e-4);
        expect(match, `boulder collider at (${c.pos.x.toFixed(2)}, ${c.pos.z.toFixed(2)})`).toBeDefined();
        expect(match!.max.distanceTo(want.max)).toBeLessThan(1e-4);
    }
}

/** A stand-in palm with palm.glb's triangle budget (CHUNK applies). */
const HEAVY_PALM_SEGMENTS = { radial: 64, height: 22 } as const;
function heavyPalm(): THREE.Object3D {
    const geo = new THREE.CylinderGeometry(0.2, 0.3, PALM_HEIGHT, HEAVY_PALM_SEGMENTS.radial, HEAVY_PALM_SEGMENTS.height);
    geo.translate(0, PALM_HEIGHT / 2, 0);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, applyOccluder(new THREE.MeshLambertMaterial())));
    return root;
}

describe("Scenery build: procedural source", () => {
    it("draws only occluder Lamberts, colliders in bounds only, blobs under tall props and boulders", () => {
        const materials = new Materials();
        const phys = mockPhysics();
        const env = mockEnvironment();
        const s = new Scenery({
            physics: phys.api,
            materials,
            assets: assetsWith({ palm: fakePalm() }),
            environment: env.api,
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });

        for (const mesh of s.meshes) {
            const mat = mesh.material as THREE.Material;
            expect((mat as THREE.MeshLambertMaterial).isMeshLambertMaterial).toBe(true);
            expect(hasOccluder(mat)).toBe(true);
        }
        // Procedural props use the shared palette materials.
        const trunk = materials.lambert(PALETTE.trunk, { occluder: true });
        expect(s.meshes.some((m) => m.material === trunk)).toBe(true);
        const boulder = materials.lambert(PALETTE.boulder, { occluder: true, flat: true });
        expect(meshesOf(s, "boulder").every((m) => m.material === boulder)).toBe(true);

        // Colliders: trees + palms (cylinders) and boulders (cuboids), in bounds only.
        expect(phys.cylinders).toHaveLength(plan.inBounds.tree.length + plan.inBounds.palm.length);
        expect(phys.cuboids).toHaveLength(plan.inBounds.boulder.length);
        const treeC = SC.colliders.tree;
        expect(phys.cylinders[0]).toMatchObject({ halfHeight: treeC.height / 2, radius: treeC.radius });
        for (const c of phys.cylinders) expect(c.pos.y).toBeCloseTo(c.halfHeight);

        // Blobs: tree, palm and boulder groups (in bounds + bands), never bushes.
        const blobbed = env.ranges.reduce((n, r) => n + r.spots.length, 0);
        const expected = (["tree", "palm", "boulder"] as const).reduce(
            (n, k) => n + plan.inBounds[k].length + plan.bands[k].length,
            0
        );
        expect(blobbed).toBe(expected);
        s.dispose();
    });

    it("tiers and density lower InstancedMesh.count, colliders and blobs together", () => {
        const phys = mockPhysics();
        const env = mockEnvironment();
        const s = new Scenery({
            physics: phys.api,
            materials: new Materials(),
            assets: assetsWith({ palm: fakePalm() }),
            environment: env.api,
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });
        const check = (tier: SceneryTier, f: number) => {
            const c = visibleCounts(plan, tier, f);
            expect(s.counts).toEqual(c);
            for (const k of SCENERY_KINDS) {
                expect(drawn(s, k)).toBe(c[k].inBounds + c[k].bands);
                expect(drawn(s, k)).toBeLessThanOrEqual(SC.counts[k][tier] + SC.bandExtras[k]);
                const bodies = s.bodies(k) as unknown as FakeBody[];
                expect(bodies.filter((b) => b.enabled)).toHaveLength(k === "bush" ? 0 : c[k].inBounds);
                // The enabled colliders are the drawn prefix.
                bodies.forEach((b, i) => expect(b.enabled).toBe(i < c[k].inBounds));
            }
            const shown = env.ranges.reduce((n, r) => n + r.count, 0);
            const want = (["tree", "palm", "boulder"] as const).reduce((n, k) => n + c[k].inBounds + c[k].bands, 0);
            expect(shown).toBe(want);
        };
        check("high", 1);
        s.setDensity(1 - CONFIG.quality.sceneryReduction);
        check("high", 1 - CONFIG.quality.sceneryReduction);
        s.setTier("low");
        check("low", 1 - CONFIG.quality.sceneryReduction);
        s.setQuality({ scenery: "medium", sceneryScale: 1 });
        check("medium", 1);
        s.dispose();
    });

    it("starts at the profile tier, or the given quality", () => {
        const mk = (over: object) =>
            new Scenery({
                physics: mockPhysics().api,
                materials: new Materials(),
                assets: assetsWith({}),
                profile: { scenery: "low" },
                source: "procedural",
                plan,
                ...over,
            });
        const a = mk({});
        expect(a.counts).toEqual(visibleCounts(plan, "low", 1));
        const b = mk({ quality: { scenery: "medium", sceneryScale: 0.7 } });
        expect(b.counts).toEqual(visibleCounts(plan, "medium", 0.7));
        a.dispose();
        b.dispose();
    });

    it("bushes and boulders stay ≤ 1.5 high; palms are 7–9 high", () => {
        const s = new Scenery({
            physics: mockPhysics().api,
            materials: new Materials(),
            assets: assetsWith({ palm: fakePalm() }),
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });
        for (const k of ["bush", "boulder"] as const) {
            const tops = instanceTops(meshesOf(s, k));
            expect(tops.length).toBe(plan.inBounds[k].length + plan.bands[k].length);
            for (const t of tops) expect(t).toBeLessThanOrEqual(SC.tallPropHeight + 1e-6);
        }
        // The palm's trunk axis top: height · cos(lean), standing on the ground.
        const m = new THREE.Matrix4();
        const minTop = SC.scale.palmHeight[0] * Math.cos(THREE.MathUtils.degToRad(SC.scale.palmLeanDeg));
        for (const mesh of meshesOf(s, "palm")) {
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, m);
                const base = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
                const top = new THREE.Vector3(0, PALM_HEIGHT, 0).applyMatrix4(m);
                expect(base.y).toBeCloseTo(0, 6);
                expect(top.y).toBeGreaterThanOrEqual(minTop - 1e-6);
                expect(top.y).toBeLessThanOrEqual(SC.scale.palmHeight[1] + 1e-6);
            }
        }
        s.dispose();
    });

    it("keeps the palm's own occluder material (no clone) and skips palms without palm.glb", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const palm = fakePalm();
        const palmMat = (palm.children[0] as THREE.Mesh).material;
        const phys = mockPhysics();
        const s = new Scenery({
            physics: phys.api,
            materials: new Materials(),
            assets: assetsWith({ palm }),
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });
        expect(meshesOf(s, "palm").every((m) => m.material === palmMat)).toBe(true);
        s.dispose();
        const t = new Scenery({
            physics: mockPhysics().api,
            materials: new Materials(),
            assets: assetsWith({}),
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });
        expect(meshesOf(t, "palm")).toHaveLength(0);
        expect(t.bodies("palm")).toHaveLength(0);
        expect(warn).toHaveBeenCalled();
        t.dispose();
        warn.mockRestore();
    });

    it("dispose removes every body, frees the instanced meshes and detaches the group", () => {
        const phys = mockPhysics();
        const env = mockEnvironment();
        const scene = new THREE.Scene();
        const handle = buildScenery({
            physics: phys.api,
            materials: new Materials(),
            assets: assetsWith({ palm: fakePalm() }),
            environment: env.api,
            profile: { scenery: "medium" },
            source: "procedural",
            plan,
        });
        scene.add(handle.group);
        const meshes = handle.scenery.meshes;
        const spies = meshes.map((m) => vi.spyOn(m, "dispose"));
        handle.dispose();
        expect(handle.group.parent).toBeNull();
        expect(phys.removed).toHaveLength(phys.bodies.length);
        for (const spy of spies) expect(spy).toHaveBeenCalled();
        for (const r of env.ranges) expect(r.count).toBe(0);
        // Idempotent and inert afterwards.
        handle.dispose();
        handle.setDensity(0.5);
        expect(phys.removed).toHaveLength(phys.bodies.length);
    });

    it("dispose leaves the blob ranges alone when the Environment is already gone", () => {
        const env = mockEnvironment();
        const s = new Scenery({
            physics: mockPhysics().api,
            materials: new Materials(),
            assets: assetsWith({ palm: fakePalm() }),
            environment: env.api,
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });
        const before = env.ranges.map((r) => r.calls);
        env.state.disposed = true;
        s.dispose();
        expect(env.ranges.map((r) => r.calls)).toEqual(before);
    });

    it("boulder colliders line up with the drawn boulders (yaw, scaled bbox and its centre)", () => {
        const phys = mockPhysics();
        const s = new Scenery({
            physics: phys.api,
            materials: new Materials(),
            assets: assetsWith({}),
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });
        expectBoulderCollidersMatch(s, phys.cuboids);
        s.dispose();
    });

    it("splits heavy palms into spatial chunks the camera and shadow camera can cull", () => {
        const palm = heavyPalm();
        const tris = modelTriangles(palm);
        expect(tris).toBeGreaterThan(CHUNK.minTriangles);
        const s = new Scenery({
            physics: mockPhysics().api,
            materials: new Materials(),
            assets: assetsWith({ palm }),
            profile: { scenery: "high" },
            source: "procedural",
            plan,
        });
        const palms = meshesOf(s, "palm");
        expect(palms.length).toBeGreaterThan(4);
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        // Light procedural props stay one set per variant (draw calls, §9.2).
        expect(new Set(meshesOf(s, "tree").map((t) => t.parent)).size).toBe(2);
        // Each chunk's instances share one CHUNK cell, and its sphere stays local.
        const cellReach = (CHUNK.size * Math.SQRT2) / 2 + KIND_EXTENT.palm.reach + SC.scale.palmHeight[1];
        for (const mesh of palms) {
            const cells = new Set<string>();
            for (let i = 0; i < mesh.instanceMatrix.count; i++) {
                mesh.getMatrixAt(i, m);
                p.setFromMatrixPosition(m);
                cells.add(`${Math.floor(p.x / CHUNK.size)},${Math.floor(p.z / CHUNK.size)}`);
            }
            expect(cells.size).toBe(1);
            expect(mesh.boundingSphere!.radius).toBeLessThanOrEqual(cellReach);
        }
        // Prefix cuts still apply across chunks.
        for (const tier of TIERS) {
            s.setTier(tier);
            const c = visibleCounts(plan, tier, 1);
            expect(drawn(s, "palm")).toBe(c.palm.inBounds + c.palm.bands);
            expect(s.stats.triangles.palm).toBe(tris * (c.palm.inBounds + c.palm.bands));
        }
        // The default shadow box (±46, §1.5) sees only the chunks it touches: well
        // under the whole field's palm triangles anywhere in the bounds.
        s.setTier("high");
        const all = s.stats.triangles.palm;
        const halfBox = 46;
        let worst = 0;
        for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += CHUNK.size / 4) {
            for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += CHUNK.size / 4) {
                let seen = 0;
                for (const mesh of palms) {
                    const sp = mesh.boundingSphere!;
                    const r = sp.radius + halfBox * Math.SQRT2;
                    if (Math.hypot(sp.center.x - x, sp.center.z - z) <= r) seen += tris * mesh.count;
                }
                worst = Math.max(worst, seen);
            }
        }
        expect(worst).toBeLessThan(all * 0.75);
        s.dispose();
    });
});

describe("Scenery build: Nature Kit source", () => {
    let models: Partial<Record<ModelName, THREE.Object3D>>;
    let materials: Materials;

    beforeAll(async () => {
        materials = new Materials();
        models = { palm: fakePalm() };
        for (const name of NATURE_MODELS) {
            const gltf = await parseGLB(join(PUBLIC, `${NATURE_DIR}${name}.glb`));
            prepareNature(gltf.scene, materials, name);
            normalizeNature(gltf.scene, natureKind(name));
            models[`nature/${name}`] = gltf.scene;
        }
    });

    it("instances every kit model with the shared palette Lamberts (occluder on)", () => {
        const s = new Scenery({
            physics: mockPhysics().api,
            materials,
            assets: assetsWith(models),
            profile: { scenery: "high" },
            source: "kit",
            plan,
        });
        const palette = new Set<THREE.Material>(
            (["foliage", "trunk", "bush"] as const).map((t) => materials.lambert(PALETTE[t], { occluder: true }))
        );
        palette.add(materials.lambert(PALETTE.boulder, { occluder: true, flat: true }));
        for (const k of ["tree", "bush", "boulder"] as const) {
            const meshes = meshesOf(s, k);
            expect(meshes.length).toBeGreaterThan(0);
            for (const m of meshes) {
                expect(palette.has(m.material as THREE.Material)).toBe(true);
                expect(hasOccluder(m.material as THREE.Material)).toBe(true);
            }
        }
        // Each kit model of a kind gets its own set (3 trees, 2 bushes, 3 rocks in bounds).
        const sets = (k: SceneryKind) => new Set(meshesOf(s, k).filter((m) => m.parent!.name.includes("bounds")).map((m) => m.parent));
        expect(sets("tree").size).toBe(3);
        expect(sets("bush").size).toBe(2);
        expect(sets("boulder").size).toBe(3);
        s.dispose();
    });

    it("darker trees tint only the foliage to the foliageDark token", () => {
        const s = new Scenery({
            physics: mockPhysics().api,
            materials,
            assets: assetsWith(models),
            profile: { scenery: "high" },
            source: "kit",
            plan,
        });
        const foliage = materials.lambert(PALETTE.foliage, { occluder: true });
        const want = new THREE.Color(PALETTE.foliageDark);
        const base = new THREE.Color(PALETTE.foliage);
        const c = new THREE.Color();
        let dark = 0;
        for (const m of meshesOf(s, "tree")) {
            if (m.material !== foliage) {
                expect(m.instanceColor).toBeNull();
                continue;
            }
            expect(m.instanceColor).not.toBeNull();
            for (let i = 0; i < m.instanceMatrix.count; i++) {
                m.getColorAt(i, c);
                const tinted = base.clone().multiply(c);
                if (c.r < 1) {
                    dark++;
                    expect(tinted.r).toBeCloseTo(want.r, 6);
                    expect(tinted.g).toBeCloseTo(want.g, 6);
                    expect(tinted.b).toBeCloseTo(want.b, 6);
                } else {
                    expect(c.getHex()).toBe(0xffffff);
                }
            }
        }
        expect(dark).toBeGreaterThan(0);
        s.dispose();
    });

    it("kit rocks and bushes stay ≤ 1.5 high, and boulder colliders follow the rock bbox", () => {
        const phys = mockPhysics();
        const s = new Scenery({
            physics: phys.api,
            materials,
            assets: assetsWith(models),
            profile: { scenery: "high" },
            source: "kit",
            plan,
        });
        for (const k of ["bush", "boulder"] as const) {
            for (const t of instanceTops(meshesOf(s, k))) expect(t).toBeLessThanOrEqual(SC.tallPropHeight + 1e-6);
        }
        expect(phys.cuboids).toHaveLength(plan.inBounds.boulder.length);
        for (const c of phys.cuboids) {
            expect(c.half.y * 2).toBeLessThanOrEqual(SC.tallPropHeight + 1e-6);
            expect(c.half.x).toBeGreaterThan(0);
            expect(c.half.z).toBeGreaterThan(0);
        }
        expectBoulderCollidersMatch(s, phys.cuboids);
        s.dispose();
    });

    it("falls back to procedural props for a kind whose kit models are missing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const noTrees = { ...models };
        for (const n of NATURE_MODELS) if (natureKind(n) === "tree") delete noTrees[`nature/${n}`];
        const s = new Scenery({
            physics: mockPhysics().api,
            materials,
            assets: assetsWith(noTrees),
            profile: { scenery: "high" },
            source: "kit",
            plan,
        });
        const trunk = materials.lambert(PALETTE.trunk, { occluder: true });
        expect(meshesOf(s, "tree").some((m) => m.material === trunk && m.geometry.type === "CylinderGeometry")).toBe(true);
        expect(warn).toHaveBeenCalled();
        s.dispose();
        warn.mockRestore();
    });
});
