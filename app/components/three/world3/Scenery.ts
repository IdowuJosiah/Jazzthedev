import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, PALETTE, type PaletteToken, type SceneryTier } from "./Config";
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
    padFootprint,
    pathClearance,
    pointInRect,
    sunStrip,
    type BandId,
    type Footprint,
} from "./Layout";
import { FLAT_TOKENS, NATURE_KINDS, type NatureKind } from "./Assets";
import { applyOccluder, hasOccluder } from "./Materials";
import type { BlobSpot, PropBlobRange } from "./Environment";
import type { AssetsApi, MaterialsApi, PhysicsApi, RenderProfile, XZ } from "./types";
import { buildInstances, shuffleInPlace, type InstanceSet } from "./utils/instancing";
import { TAU, clamp, distToSegment2D, mulberry32, poissonDisk, randRange, valueNoise2D } from "./utils/math";

// ─────────────────────────────────────────────────────────────────────────
// Scenery scatter (§2.6). Two halves:
//
// 1. `planScenery(seed)`: pure, deterministic and memoised per seed. Seeded
//    Bridson Poisson-disk runs inside the bounds shrunk by 2 and inside the
//    decorative bands, filtered by the §2.6 acceptance rules (`sceneryReject`)
//    and the zone table (`boundsZone`). Each kind gets a capacity of its HIGH
//    tier count (in bounds) plus its band extras, in a shuffled order, so any
//    prefix is an even subsample: tiers and adaptive quality only lower
//    InstancedMesh.count.
// 2. `Scenery`: turns the plan into instanced meshes (Nature Kit models or the
//    procedural fallback; palm.glb for palms), fixed colliders for in-bounds
//    trees / palms / boulders, and low-profile blob shadows through the
//    Environment. Every material is a palette Lambert with the occluder dither.
//    Heavy models (palms) are split into CHUNK cells so both the camera and
//    the shadow camera can cull them (§9.2).
// ─────────────────────────────────────────────────────────────────────────

const SC = CONFIG.scenery;

export type SceneryKind = "tree" | "palm" | "bush" | "boulder";
export const SCENERY_KINDS: readonly SceneryKind[] = ["tree", "palm", "bush", "boulder"];
/** Kinds allowed where only low props may stand (south / east edges and bands). */
export const LOW_KINDS: ReadonlySet<SceneryKind> = new Set<SceneryKind>(["bush", "boulder"]);

/**
 * Where a candidate sits (§2.6 zone table):
 * - "grove": interior; groves only (noise mask), all props;
 * - "edge": within edgeZone of the west bound; all props, no mask;
 * - "low": within edgeZone of the south or east bound; bushes and boulders only;
 * - "band-all" / "band-low": the decorative bands outside the bounds (no colliders).
 * The north strip (beyond the quay clearance, within edgeZone of the quay) has no
 * row of its own in the table, so it keeps the default grove mask.
 */
export type SceneryZone = "grove" | "edge" | "low" | "band-all" | "band-low";

// ── Tunables (CONFIG.scenery since the Wave 2a integration; aliases kept) ──
/** Procedural fallback props (§2.6). Origins sit on the ground (y = 0). */
export const PROCEDURAL = SC.procedural;
/** Bush cluster members sit this far (min, max) from the cluster's first bush. */
export const BUSH_CLUSTER_SPREAD = SC.bushClusterSpread;
/** Share of trees drawn with the darker foliage token (§1.2 "chosen at random"). */
export const FOLIAGE_DARK_SHARE = SC.foliageDarkShare;
/**
 * palm.glb's widest frond tip from its trunk base, as a fraction of its height
 * (measured from the GLB vertices: 0.78). The model's crown hangs to one side,
 * so with a random yaw the crown can be anywhere in that disc.
 */
export const PALM_CROWN_REACH = SC.palmCrownReach;
/**
 * Spatial chunks (§9.2 triangles, §1.5 shadow box): a model with more triangles
 * than `minTriangles` (palm.glb: 2924) is instanced per `size` × `size` cell, so
 * the camera and the sun's shadow camera cull each cell on its own bounding
 * sphere. Cheaper models (kit trees 50–196, bushes, rocks) stay one set per
 * variant: their whole-world sets cost fewer triangles than chunks cost draw calls.
 */
export const CHUNK = SC.chunk;
/** Seed salts, so every run (sampling, shuffle, attributes) has its own rng stream. */
const RUN_SALT = { tall: 0x7a11, bush: 0xb05, boulder: 0xb01d } as const;
const RUN_STRIDE = 0x1000;
const BAND_SALT = 0xba5d0000;
const SHUFFLE_SALT = 0x5f1e;
const ATTR_SALT = 0xa77;

// ── Acceptance rules (§2.6) ──────────────────────────────────────────────
/** Distance from a point to an oriented footprint (0 inside). */
export function distToFootprint(f: Footprint, x: number, z: number): number {
    const dx = x - f.x;
    const dz = z - f.z;
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    // Local +X = (cos, −sin), local +Z = (sin, cos) (Layout.footprintCorners).
    const u = dx * c - dz * s;
    const v = dx * s + dz * c;
    return Math.hypot(Math.max(0, Math.abs(u) - f.hu), Math.max(0, Math.abs(v) - f.hv));
}

/** Point strictly inside a counter-clockwise convex polygon (Layout.convexHull order). */
export function pointInConvex(poly: readonly XZ[], x: number, z: number): boolean {
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        if ((q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x) <= 0) return false;
    }
    return poly.length >= 3;
}

/** Distance from a point to a counter-clockwise convex polygon (0 inside). */
export function distToConvex(poly: readonly XZ[], x: number, z: number): number {
    if (pointInConvex(poly, x, z)) return 0;
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        best = Math.min(best, distToSegment2D(x, z, p.x, p.z, q.x, q.z));
    }
    return best;
}

/**
 * How far a kind's drawn shape reaches (§1.2, §2.6). The spacing rules treat a
 * prop as its base point; these keep its crown off ground text and its shadow
 * out of the text's sun-side strip.
 * - `reach`: largest horizontal distance from the base to any part of the prop,
 *   at the kind's largest scale (crown / canopy / footprint radius);
 * - `height`: tallest drawn height, which sets the shadow length.
 */
export interface KindExtent {
    reach: number;
    height: number;
}

const tanSunElevation = (() => {
    const d = CONFIG.lights.sunDirection;
    return d.y / Math.hypot(d.x, d.z);
})();

export const KIND_EXTENT: Readonly<Record<SceneryKind, KindExtent>> = (() => {
    const S = SC.scale;
    const P = PROCEDURAL;
    const palmH = S.palmHeight[1];
    return {
        // Crown radius 1.7 (the kit trees are normalised to the procedural height).
        tree: { reach: P.crown.radius * S.tree[1], height: SC.kitNormalize.tree.size * S.tree[1] },
        // Widest frond, plus the lean tipping the crown over.
        palm: {
            reach: palmH * (PALM_CROWN_REACH + Math.sin(THREE.MathUtils.degToRad(S.palmLeanDeg))),
            height: palmH,
        },
        bush: { reach: P.bush.scale.x * S.bush[1], height: SC.tallPropHeight },
        boulder: {
            reach: (SC.kitNormalize.boulder.size / 2) * Math.max(S.boulderX[1], S.boulderZ[1]),
            height: SC.tallPropHeight,
        },
    };
})();

/** Shadow length of a prop of this height on flat ground. */
export const shadowLength = (height: number) => height / tanSunElevation;

/** True when a kind is taller than the low-prop limit (its shadow matters). */
const isTall = (kind: SceneryKind) => KIND_EXTENT[kind].height > SC.tallPropHeight;

interface Strip {
    poly: XZ[];
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

const toStrip = (poly: XZ[]): Strip => ({
    poly,
    minX: Math.min(...poly.map((p) => p.x)),
    maxX: Math.max(...poly.map((p) => p.x)),
    minZ: Math.min(...poly.map((p) => p.z)),
    maxZ: Math.max(...poly.map((p) => p.z)),
});

/**
 * The sun-side strip a kind must keep clear of, per ground text: the §1.2 strip,
 * lengthened to the kind's shadow when that is longer (a 9-high palm casts ≈ 7).
 */
export function kindSunStrip(f: Footprint, kind?: SceneryKind): XZ[] {
    const len = kind && isTall(kind) ? Math.max(SC.sunStripLength, shadowLength(KIND_EXTENT[kind].height)) : SC.sunStripLength;
    return sunStrip(f, len);
}

const POINT_STRIPS: readonly Strip[] = GROUND_TEXTS.map((g) => toStrip(kindSunStrip(g.footprint)));
const stripsFor = (k: SceneryKind) => GROUND_TEXTS.map((g) => toStrip(kindSunStrip(g.footprint, k)));
const KIND_STRIPS: Readonly<Record<SceneryKind, readonly Strip[]>> = {
    tree: stripsFor("tree"),
    palm: stripsFor("palm"),
    bush: stripsFor("bush"),
    boulder: stripsFor("boulder"),
};

/** 3D titles and every hand-placed prop (all inside area rects), plus the ramp. */
const FEATURES: readonly Footprint[] = [...PROPS.map((p) => p.footprint), RAMP_FOOTPRINT];
const PAD_FOOTPRINTS: readonly Footprint[] = PADS.map((p) => padFootprint(p.pad));
const PATH_SEGMENTS = PATHS.map((p) => ({ a: p.from, b: p.to, clear: pathClearance(p) }));

export type SceneryRejectReason =
    | "quay"
    | "jetty"
    | "corridor"
    | "area"
    | "path"
    | "token"
    | "feature"
    | "pad"
    | "groundText"
    | "sunStrip";

/**
 * The first §2.6 acceptance rule a ground point breaks, or null when a prop may
 * stand there (zones and the grove mask are separate: `sceneryZone`).
 *
 * With a `kind`, the prop is its extent rather than a point: no part of it may
 * overhang a ground-text footprint, and a tall prop's crown keeps out of the
 * text's sun-side strip lengthened to its shadow (`kindSunStrip`). Low props
 * keep the point test for the strip (their shadow is ≈ 1.2 long).
 */
export function sceneryReject(x: number, z: number, kind?: SceneryKind): SceneryRejectReason | null {
    // The lagoon is z < QUAY_Z; nothing stands within the quay clearance either.
    if (z < QUAY_Z + CONFIG.world.quay.sceneryClearance) return "quay";
    if (pointInRect(JETTY.rect, x, z)) return "jetty";
    if (pointInRect(RAMP_CORRIDOR, x, z)) return "corridor";
    const ac = SC.areaClearance;
    for (const a of AREAS) {
        if (Math.abs(x - a.rect.x) <= a.rect.w / 2 + ac && Math.abs(z - a.rect.z) <= a.rect.d / 2 + ac) return "area";
    }
    for (const p of PATH_SEGMENTS) {
        if (distToSegment2D(x, z, p.a.x, p.a.z, p.b.x, p.b.z) <= p.clear) return "path";
    }
    const fc = SC.featureClearance;
    for (const t of TOKENS) if (Math.hypot(x - t.x, z - t.z) <= fc) return "token";
    for (const f of FEATURES) if (distToFootprint(f, x, z) <= fc) return "feature";
    for (const f of PAD_FOOTPRINTS) if (distToFootprint(f, x, z) <= fc) return "pad";
    const reach = kind ? KIND_EXTENT[kind].reach : 0;
    for (const g of GROUND_TEXTS) if (distToFootprint(g.footprint, x, z) <= reach) return "groundText";
    const stripReach = kind && isTall(kind) ? reach : 0;
    for (const s of kind ? KIND_STRIPS[kind] : POINT_STRIPS) {
        const r = stripReach;
        if (x < s.minX - r || x > s.maxX + r || z < s.minZ - r || z > s.maxZ + r) continue;
        if (r > 0 ? distToConvex(s.poly, x, z) <= r : pointInConvex(s.poly, x, z)) return "sunStrip";
    }
    return null;
}

/** The grove mask (§2.6): valueNoise(x/45, z/45) > 0.15. */
export function inGrove(x: number, z: number, seed: number = CONFIG.world.seed): boolean {
    return valueNoise2D(x / SC.grove.scale, z / SC.grove.scale, seed) > SC.grove.threshold;
}

/**
 * The zone of a point inside the bounds (§2.6 table). South / east (low props:
 * they sit between the camera and the car) win over west at the corner.
 */
export function boundsZone(x: number, z: number): Extract<SceneryZone, "grove" | "edge" | "low"> {
    const e = SC.edgeZone;
    if (BOUNDS.maxZ - z <= e || BOUNDS.maxX - x <= e) return "low";
    if (x - BOUNDS.minX <= e) return "edge";
    return "grove";
}

const bandZone = (props: "all" | "low"): SceneryZone => (props === "all" ? "band-all" : "band-low");

/** True when the zone admits this kind (§2.6: low zones take bushes and boulders only). */
export function zoneAllows(zone: SceneryZone, kind: SceneryKind): boolean {
    return zone === "low" || zone === "band-low" ? LOW_KINDS.has(kind) : true;
}

/**
 * Full test for one candidate: the acceptance rules, the zone's kind filter
 * and (grove zone only) the noise mask. Returns the zone when accepted.
 */
export function acceptCandidate(
    x: number,
    z: number,
    kind: SceneryKind,
    zone: SceneryZone,
    seed: number = CONFIG.world.seed
): boolean {
    if (!zoneAllows(zone, kind)) return false;
    if (zone === "grove" && !inGrove(x, z, seed)) return false;
    return sceneryReject(x, z, kind) === null;
}

// ── The plan (pure, deterministic) ───────────────────────────────────────
export interface SceneryPlacement {
    kind: SceneryKind;
    x: number;
    z: number;
    /** rotation.y. */
    yaw: number;
    /** Scale: uniform for trees / bushes (x = y = z); per axis for boulders; palms use `height`. */
    sx: number;
    sy: number;
    sz: number;
    /** Palms: target height (7–9). */
    height: number;
    /** Palms: lean angle (radians, ≤ palmLeanDeg) and its azimuth. */
    lean: number;
    leanAzimuth: number;
    /** In [0, 1): picks the model variant (floor(variant · n)) at build time. */
    variant: number;
    /** Trees: darker foliage token. */
    dark: boolean;
    zone: SceneryZone;
    /** Inside the bounds (colliders) or in a decorative band (none). */
    inBounds: boolean;
    /** Bushes: index of the cluster (members are consecutive). −1 otherwise. */
    cluster: number;
}

export type KindLists = Record<SceneryKind, SceneryPlacement[]>;

export interface SceneryPlan {
    seed: number;
    /** Shuffled; capacity = the HIGH tier count. Any prefix is an even subsample. */
    inBounds: KindLists;
    /** Shuffled; capacity = CONFIG.scenery.bandExtras. */
    bands: KindLists;
}

const emptyLists = (): KindLists => ({ tree: [], palm: [], bush: [], boulder: [] });

interface Domain {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    zoneAt(x: number, z: number): SceneryZone;
    inBounds: boolean;
}

const BOUNDS_DOMAIN: Domain = {
    minX: BOUNDS.minX + SC.boundsInset,
    maxX: BOUNDS.maxX - SC.boundsInset,
    minZ: BOUNDS.minZ + SC.boundsInset,
    maxZ: BOUNDS.maxZ - SC.boundsInset,
    zoneAt: boundsZone,
    inBounds: true,
};

const bandDomain = (id: BandId): Domain => {
    const b = BANDS.find((band) => band.id === id)!;
    const zone = bandZone(b.props);
    return {
        minX: b.rect.x - b.rect.w / 2,
        maxX: b.rect.x + b.rect.w / 2,
        minZ: b.rect.z - b.rect.d / 2,
        maxZ: b.rect.z + b.rect.d / 2,
        zoneAt: () => zone,
        inBounds: false,
    };
};

const BAND_DOMAINS: readonly Domain[] = BANDS.map((b) => bandDomain(b.id));

/** Placed props from earlier runs, bucketed for the cross-kind spacing test. */
class Occupancy {
    private cells = new Map<string, XZ[]>();
    constructor(private cell: number) {}
    private key(ix: number, iz: number) {
        return `${ix},${iz}`;
    }
    add(p: XZ) {
        const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
        const list = this.cells.get(k);
        if (list) list.push(p);
        else this.cells.set(k, [p]);
    }
    /** True when no stored point is closer than r (r ≤ cell). */
    clear(x: number, z: number, r: number): boolean {
        const ix = Math.floor(x / this.cell);
        const iz = Math.floor(z / this.cell);
        const r2 = r * r;
        for (let j = iz - 1; j <= iz + 1; j++) {
            for (let i = ix - 1; i <= ix + 1; i++) {
                const list = this.cells.get(this.key(i, j));
                if (!list) continue;
                for (const p of list) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) return false;
            }
        }
        return true;
    }
}

const R = SC.poissonRadius;
const OCC_CELL = Math.max(R.tree, R.palm, R.bush, R.boulder);
/** Cross-kind spacing: the smaller of the two kinds' Poisson radii. */
const crossRadius = (a: SceneryKind, b: SceneryKind) => Math.min(R[a], R[b]);

/** Every candidate in one domain that passes `test` (no capacity cut). */
function sampleDomain(
    d: Domain,
    radius: number,
    rng: () => number,
    test: (x: number, z: number, zone: SceneryZone) => boolean
): { x: number; z: number; zone: SceneryZone }[] {
    const pts = poissonDisk({
        minX: d.minX,
        maxX: d.maxX,
        minZ: d.minZ,
        maxZ: d.maxZ,
        radius,
        rng,
        accept: (x, z) => test(x, z, d.zoneAt(x, z)),
    });
    return pts.map((p) => ({ x: p.x, z: p.z, zone: d.zoneAt(p.x, p.z) }));
}

function makePlacement(
    kind: SceneryKind,
    p: { x: number; z: number; zone: SceneryZone },
    inBounds: boolean,
    rng: () => number,
    cluster = -1
): SceneryPlacement {
    const S = SC.scale;
    const out: SceneryPlacement = {
        kind,
        x: p.x,
        z: p.z,
        yaw: rng() * TAU,
        sx: 1,
        sy: 1,
        sz: 1,
        height: 0,
        lean: 0,
        leanAzimuth: 0,
        variant: rng(),
        dark: false,
        zone: p.zone,
        inBounds,
        cluster,
    };
    if (kind === "tree") {
        out.sx = out.sy = out.sz = randRange(rng, S.tree[0], S.tree[1]);
        out.dark = rng() < FOLIAGE_DARK_SHARE;
    } else if (kind === "palm") {
        out.height = randRange(rng, S.palmHeight[0], S.palmHeight[1]);
        out.lean = THREE.MathUtils.degToRad(rng() * S.palmLeanDeg);
        out.leanAzimuth = rng() * TAU;
    } else if (kind === "bush") {
        out.sx = out.sy = out.sz = randRange(rng, S.bush[0], S.bush[1]);
    } else {
        out.sx = randRange(rng, S.boulderX[0], S.boulderX[1]);
        out.sy = randRange(rng, S.boulderY[0], S.boulderY[1]);
        out.sz = randRange(rng, S.boulderZ[0], S.boulderZ[1]);
    }
    return out;
}

/** A sampled candidate and the domain it came from. */
interface Spot {
    x: number;
    z: number;
    zone: SceneryZone;
    d: Domain;
}

/**
 * The kind of the n-th committed tall prop: trees and palms interleaved so
 * every prefix keeps the capacities' tree : palm ratio. Integer numerators
 * keep the split exact (no float drift past a capacity).
 */
function tallKindAt(n: number, trees: number, palms: number): SceneryKind {
    const total = trees + palms;
    const palmsBefore = (i: number) => (total > 0 ? Math.floor((i * palms) / total) : 0);
    return palmsBefore(n + 1) > palmsBefore(n) ? "palm" : "tree";
}

/**
 * The deterministic scatter (§2.6). Same seed → same plan. Run order: tall
 * props (trees + palms share one radius-6 run), boulders, then bush clusters
 * (radius 3.5); in bounds first, then the bands as one shared budget. Each
 * prop keeps at least the smaller Poisson radius from every prop committed
 * before it, of any kind.
 *
 * Uncached (≈ 0.1 s on a desktop); the Scenery uses the memoised `planScenery`.
 */
export function computeSceneryPlan(seed: number = CONFIG.world.seed): SceneryPlan {
    const plan: SceneryPlan = { seed, inBounds: emptyLists(), bands: emptyLists() };
    const occ = new Map<SceneryKind, Occupancy>();
    const clearOfOthers = (x: number, z: number, kind: SceneryKind) => {
        for (const [k, o] of occ) if (!o.clear(x, z, crossRadius(kind, k))) return false;
        return true;
    };
    const commit = (p: SceneryPlacement) => {
        let o = occ.get(p.kind);
        if (!o) occ.set(p.kind, (o = new Occupancy(OCC_CELL)));
        o.add(p);
        (p.inBounds ? plan.inBounds : plan.bands)[p.kind].push(p);
    };
    const rngFor = (salt: number) => mulberry32((seed ^ salt) >>> 0);

    /** Every accepted candidate of a run over `domains`, shuffled (bands share one list). */
    const candidates = (domains: readonly Domain[], salt: number, kind: SceneryKind): Spot[] => {
        const out: Spot[] = [];
        domains.forEach((d, i) => {
            // Skip a band whose zone can't hold this kind at all.
            if (!d.inBounds && !zoneAllows(d.zoneAt(d.minX, d.minZ), kind)) return;
            const pts = sampleDomain(
                d,
                R[kind],
                rngFor(salt + i * RUN_STRIDE),
                (x, z, zone) => acceptCandidate(x, z, kind, zone, seed) && clearOfOthers(x, z, kind)
            );
            for (const p of pts) out.push({ ...p, d });
        });
        return shuffleInPlace(out, rngFor(salt ^ SHUFFLE_SALT));
    };

    /**
     * Commits spots in order up to `cap`, re-checking spacing against everything
     * committed. Spots were sampled as `sampledAs`; a different kind (palms in the
     * shared tall run) re-checks its own extent, and a failed spot goes to the
     * next spot with the same kind, so the tree : palm interleave holds.
     */
    const fill = (
        spots: readonly Spot[],
        cap: number,
        kindAt: (n: number) => SceneryKind,
        salt: number,
        sampledAs: SceneryKind
    ) => {
        const rng = rngFor(salt ^ ATTR_SALT);
        let n = 0;
        for (const s of spots) {
            if (n >= cap) break;
            const kind = kindAt(n);
            if (kind !== sampledAs && sceneryReject(s.x, s.z, kind) !== null) continue;
            if (!clearOfOthers(s.x, s.z, kind)) continue;
            commit(makePlacement(kind, s, s.d.inBounds, rng));
            n++;
        }
    };

    /** Bush clusters (2–3 bushes each) up to `cap` bushes; members pass the same rules. */
    let cluster = 0;
    const fillBushes = (spots: readonly Spot[], cap: number, salt: number) => {
        const rng = rngFor(salt ^ ATTR_SALT);
        let n = 0;
        for (const s of spots) {
            if (n >= cap) break;
            if (!clearOfOthers(s.x, s.z, "bush")) continue;
            const members = clusterMembers(s, rng, seed, cluster++, (x, z) => clearOfOthers(x, z, "bush"));
            for (const p of members.slice(0, cap - n)) {
                commit(p);
                n++;
            }
        }
    };

    const C = SC.counts;
    const X = SC.bandExtras;
    const IN = [BOUNDS_DOMAIN];
    const S = RUN_SALT;
    const inTall = (n: number) => tallKindAt(n, C.tree.high, C.palm.high);
    const bandTall = (n: number) => tallKindAt(n, X.tree, X.palm);
    fill(candidates(IN, S.tall, "tree"), C.tree.high + C.palm.high, inTall, S.tall, "tree");
    fill(candidates(BAND_DOMAINS, S.tall ^ BAND_SALT, "tree"), X.tree + X.palm, bandTall, S.tall ^ BAND_SALT, "tree");
    fill(candidates(IN, S.boulder, "boulder"), C.boulder.high, () => "boulder", S.boulder, "boulder");
    fill(candidates(BAND_DOMAINS, S.boulder ^ BAND_SALT, "boulder"), X.boulder, () => "boulder", S.boulder ^ BAND_SALT, "boulder");
    fillBushes(candidates(IN, S.bush, "bush"), C.bush.high, S.bush);
    fillBushes(candidates(BAND_DOMAINS, S.bush ^ BAND_SALT, "bush"), X.bush, S.bush ^ BAND_SALT);
    return plan;
}

/** Plans by seed: computed once, frozen (the Scenery never edits a plan). */
const PLAN_CACHE = new Map<number, SceneryPlan>();

function freezePlan(plan: SceneryPlan): SceneryPlan {
    for (const lists of [plan.inBounds, plan.bands]) {
        for (const k of SCENERY_KINDS) {
            for (const p of lists[k]) Object.freeze(p);
            Object.freeze(lists[k]);
        }
        Object.freeze(lists);
    }
    return Object.freeze(plan);
}

/**
 * The plan for a seed, memoised (§10 boot): the integrator can call this during
 * the font / asset wait so the build stage doesn't pay for it on the main thread;
 * the Scenery constructor then reuses the cached plan.
 */
export function planScenery(seed: number = CONFIG.world.seed): SceneryPlan {
    let plan = PLAN_CACHE.get(seed);
    if (!plan) {
        plan = freezePlan(computeSceneryPlan(seed));
        PLAN_CACHE.set(seed, plan);
    }
    return plan;
}

/** A bush cluster: the centre plus 1–2 neighbours that pass the same rules. */
function clusterMembers(
    c: Spot,
    rng: () => number,
    seed: number,
    cluster: number,
    clear: (x: number, z: number) => boolean
): SceneryPlacement[] {
    const { d } = c;
    const [minN, maxN] = SC.scale.bushCluster;
    const n = minN + Math.floor(rng() * (maxN - minN + 1));
    const out = [makePlacement("bush", c, d.inBounds, rng, cluster)];
    const start = rng() * TAU;
    for (let i = 1; i < n; i++) {
        const ang = start + (i / n) * TAU;
        const r = randRange(rng, BUSH_CLUSTER_SPREAD[0], BUSH_CLUSTER_SPREAD[1]);
        const x = c.x + Math.cos(ang) * r;
        const z = c.z + Math.sin(ang) * r;
        if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
        const zone = d.zoneAt(x, z);
        if (!acceptCandidate(x, z, "bush", zone, seed) || !clear(x, z)) continue;
        out.push(makePlacement("bush", { x, z, zone }, d.inBounds, rng, cluster));
    }
    return out;
}

/** Visible instances per kind for a tier and density (in bounds, bands). */
export function visibleCounts(
    plan: SceneryPlan,
    tier: SceneryTier,
    density: number
): Record<SceneryKind, { inBounds: number; bands: number }> {
    const f = clamp(density, 0, 1);
    const out = {} as Record<SceneryKind, { inBounds: number; bands: number }>;
    for (const k of SCENERY_KINDS) {
        out[k] = {
            inBounds: Math.min(plan.inBounds[k].length, Math.round(SC.counts[k][tier] * f)),
            bands: Math.min(plan.bands[k].length, Math.round(SC.bandExtras[k] * f)),
        };
    }
    return out;
}

// ── Build (three.js) ─────────────────────────────────────────────────────
/**
 * The Environment's low-profile blob API (§1.5).
 *
 * TEARDOWN ORDER: dispose the Scenery before the Environment. Scenery.dispose()
 * hides its blob ranges (setCount(0)); on an already disposed Environment that
 * call would rebuild the blob InstancedMesh on freed resources. When the
 * Environment exposes `isDisposed()`, Scenery checks it and skips the call.
 */
export interface SceneryBlobApi {
    addPropBlobs(spots: readonly BlobSpot[]): PropBlobRange;
    isDisposed?(): boolean;
}

export interface SceneryQuality {
    scenery: SceneryTier;
    /** Adaptive multiplier (1, or 0.7 after "scenery-30"). */
    sceneryScale: number;
}

export interface SceneryDeps {
    physics: PhysicsApi;
    materials: MaterialsApi;
    assets: AssetsApi;
    /** Blob shadows under trees, palms and boulders (drawn only without a shadow map). */
    environment?: SceneryBlobApi | null;
    profile: Pick<RenderProfile, "scenery">;
    /** Starting quality (default: the profile's tier at full density). */
    quality?: SceneryQuality;
    /** Default CONFIG.scenery.source. */
    source?: "kit" | "procedural";
    /** Default CONFIG.world.seed. */
    seed?: number;
    /** A precomputed plan; default planScenery(seed) (memoised, so it can be warmed early). */
    plan?: SceneryPlan;
}

/**
 * One instanced set: a model variant of a kind, in or outside the bounds, and
 * (for heavy models) one CHUNK cell of it.
 */
interface VariantSet {
    kind: SceneryKind;
    inBounds: boolean;
    set: InstanceSet;
    /** Kind-order indices of the members (ascending), so prefix cuts apply per chunk. */
    orders: number[];
    /** Triangles per instance (all sub-meshes). */
    triangles: number;
}

/** Triangles of a model (all sub-meshes). */
export function modelTriangles(root: THREE.Object3D): number {
    let n = 0;
    root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry;
        n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return n;
}

interface KindGroup {
    kind: SceneryKind;
    inBounds: boolean;
    placements: SceneryPlacement[];
    sets: VariantSet[];
    bodies: RAPIER.RigidBody[];
    blobs: PropBlobRange | null;
}

/** A prop model plus what Scenery needs to place it. */
interface ModelInfo {
    root: THREE.Object3D;
    box: THREE.Box3;
}

const UP = new THREE.Vector3(0, 1, 0);

const sceneryLambert = (materials: MaterialsApi, token: PaletteToken) =>
    materials.lambert(PALETTE[token], { occluder: true, flat: FLAT_TOKENS.has(token) });

/** Builds the procedural fallback model of a kind (geometries are tracked in `geos`). */
export function proceduralModel(
    kind: Exclude<SceneryKind, "palm">,
    materials: MaterialsApi,
    geos: THREE.BufferGeometry[]
): THREE.Object3D {
    const P = PROCEDURAL;
    const track = <G extends THREE.BufferGeometry>(g: G) => (geos.push(g), g);
    const root = new THREE.Group();
    root.name = `scenery-${kind}`;
    if (kind === "tree") {
        const t = P.trunk;
        const trunk = track(new THREE.CylinderGeometry(t.radiusTop, t.radiusBottom, t.height, t.radialSegments));
        trunk.translate(0, t.height / 2, 0);
        const c = P.crown;
        const crown = track(new THREE.SphereGeometry(c.radius, c.widthSegments, c.heightSegments));
        crown.translate(0, c.y, 0);
        root.add(
            new THREE.Mesh(trunk, sceneryLambert(materials, "trunk")),
            new THREE.Mesh(crown, sceneryLambert(materials, "foliage"))
        );
    } else if (kind === "bush") {
        const b = P.bush;
        const geo = track(
            new THREE.SphereGeometry(b.radius, b.widthSegments, b.heightSegments / 2, 0, TAU, 0, Math.PI / 2)
        );
        geo.scale(b.scale.x, b.scale.y, b.scale.z);
        root.add(new THREE.Mesh(geo, sceneryLambert(materials, "bush")));
    } else {
        const geo = track(new THREE.DodecahedronGeometry(P.boulder.radius, P.boulder.detail));
        root.add(new THREE.Mesh(geo, sceneryLambert(materials, "boulder")));
    }
    return root;
}

const NATURE_KIND: Record<Exclude<SceneryKind, "palm">, NatureKind> = { tree: "tree", bush: "bush", boulder: "boulder" };

/**
 * A single tree from the active scenery source, e.g. for the Hub planter
 * (§2.4). Procedural geometries are pushed to `geos`; the caller frees them.
 */
export function createSceneryTree(
    materials: MaterialsApi,
    assets: AssetsApi,
    geos: THREE.BufferGeometry[],
    source: "kit" | "procedural" = SC.source
): THREE.Object3D {
    if (source === "kit") {
        for (const name of NATURE_KINDS.tree) {
            const m = assets.model(`nature/${name}`);
            if (m) return m;
        }
    }
    return proceduralModel("tree", materials, geos);
}

/** Scenery (§2.6): build once; tiers and adaptive density only change counts. */
export class Scenery {
    readonly group = new THREE.Group();
    readonly plan: SceneryPlan;
    private groups: KindGroup[] = [];
    private geos: THREE.BufferGeometry[] = [];
    private tier: SceneryTier;
    private density: number;
    private disposed = false;
    private tint: THREE.Color;

    constructor(private deps: SceneryDeps) {
        this.group.name = "scenery";
        const seed = deps.seed ?? CONFIG.world.seed;
        this.plan = deps.plan ?? planScenery(seed);
        this.tier = deps.quality?.scenery ?? deps.profile.scenery;
        this.density = deps.quality?.sceneryScale ?? 1;
        // Dark trees: foliage × (foliageDark / foliage) per channel, in linear
        // space, so the instance colour lands exactly on the foliageDark token.
        const light = new THREE.Color(PALETTE.foliage);
        const dark = new THREE.Color(PALETTE.foliageDark);
        this.tint = new THREE.Color(dark.r / light.r, dark.g / light.g, dark.b / light.b);

        const source = deps.source ?? SC.source;
        const models: Record<SceneryKind, ModelInfo[]> = {
            tree: this.kindModels("tree", source),
            palm: this.palmModels(),
            bush: this.kindModels("bush", source),
            boulder: this.kindModels("boulder", source),
        };
        for (const kind of SCENERY_KINDS) {
            for (const inBounds of [true, false]) {
                const list = (inBounds ? this.plan.inBounds : this.plan.bands)[kind];
                this.groups.push(this.buildKind(kind, inBounds, list, models[kind]));
            }
        }
        this.apply();
    }

    /** Adaptive quality (§9.3): fraction of the tier's counts drawn (e.g. 0.7). */
    setDensity(fraction: number): void {
        this.density = clamp(fraction, 0, 1);
        this.apply();
    }

    /** Quality setting: the tier whose counts apply (high / medium / low). */
    setTier(tier: SceneryTier): void {
        this.tier = tier;
        this.apply();
    }

    /** Both at once, straight from the Experience's QualityState. */
    setQuality(q: SceneryQuality): void {
        this.tier = q.scenery;
        this.density = clamp(q.sceneryScale, 0, 1);
        this.apply();
    }

    /** Drawn instances per kind right now (debug / tests). */
    get counts(): Record<SceneryKind, { inBounds: number; bands: number }> {
        return visibleCounts(this.plan, this.tier, this.density);
    }

    /** Every instanced mesh (tests / ?debug). */
    get meshes(): THREE.InstancedMesh[] {
        return this.groups.flatMap((g) => g.sets.flatMap((s) => s.set.meshes));
    }

    /**
     * ?debug: instanced meshes (an upper bound on draw calls per pass, before
     * culling) and drawn triangles per pass before culling, per kind.
     */
    get stats(): { meshes: number; triangles: Record<SceneryKind, number> } {
        const triangles: Record<SceneryKind, number> = { tree: 0, palm: 0, bush: 0, boulder: 0 };
        let meshes = 0;
        for (const g of this.groups) {
            for (const s of g.sets) {
                meshes += s.set.meshes.length;
                triangles[s.kind] += s.triangles * s.set.count;
            }
        }
        return { meshes, triangles };
    }

    /** Collider bodies per kind, in kind order (tests / ?debug). */
    bodies(kind: SceneryKind): readonly RAPIER.RigidBody[] {
        return this.groups.find((g) => g.kind === kind && g.inBounds)?.bodies ?? [];
    }

    /** Call before the Environment's dispose (see SceneryBlobApi). */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        const envGone = this.deps.environment?.isDisposed?.() ?? false;
        for (const g of this.groups) {
            for (const b of g.bodies) {
                try {
                    this.deps.physics.removeBody(b);
                } catch {
                    /* the world may already be freed */
                }
            }
            g.bodies = [];
            // Hides the range (Environment has no release API; the slots stay).
            if (!envGone) g.blobs?.setCount(0);
            g.blobs = null;
            for (const s of g.sets) for (const m of s.set.meshes) m.dispose();
        }
        this.groups = [];
        // Procedural geometries are ours; kit / palm geometries belong to Assets,
        // palette materials to Materials.
        for (const geo of this.geos) geo.dispose();
        this.geos = [];
    }

    // ── internals ────────────────────────────────────────────────────────
    private info(root: THREE.Object3D): ModelInfo {
        root.updateMatrixWorld(true);
        return { root, box: new THREE.Box3().setFromObject(root) };
    }

    /** Kit models of a kind (those that loaded), else the procedural fallback. */
    private kindModels(kind: Exclude<SceneryKind, "palm">, source: "kit" | "procedural"): ModelInfo[] {
        if (source === "kit") {
            const found: ModelInfo[] = [];
            for (const name of NATURE_KINDS[NATURE_KIND[kind]]) {
                const m = this.deps.assets.model(`nature/${name}`);
                if (m) found.push(this.info(m));
            }
            if (found.length) return found;
            console.warn(`[world3] no Nature Kit ${kind} models loaded; using the procedural ${kind}`);
        }
        return [this.info(proceduralModel(kind, this.deps.materials, this.geos))];
    }

    private palmModels(): ModelInfo[] {
        const m = this.deps.assets.model("palm");
        if (!m) {
            console.warn("[world3] palm.glb unavailable; scenery has no palms");
            return [];
        }
        return [this.info(m)];
    }

    /**
     * The material an instanced copy draws with. Kit and procedural meshes
     * already use the shared palette Lambert (occluder on): keep that instance
     * (a clone would drop the dither). The palm keeps its atlas Lambert, which
     * Assets patched with the occluder; anything unpatched gets it here.
     */
    private material(src: THREE.Material): THREE.Material {
        if (!hasOccluder(src)) applyOccluder(src);
        return src;
    }

    private isFoliage(m: THREE.Material): boolean {
        return m === sceneryLambert(this.deps.materials, "foliage");
    }

    /** The instance matrix of a placement on a model variant. */
    private matrix(p: SceneryPlacement, info: ModelInfo, out: THREE.Matrix4): THREE.Matrix4 {
        const q = new THREE.Quaternion().setFromAxisAngle(UP, p.yaw);
        const s = new THREE.Vector3(p.sx, p.sy, p.sz);
        const pos = new THREE.Vector3(p.x, 0, p.z);
        if (p.kind === "palm") {
            const h = Math.max(info.box.max.y - info.box.min.y, Number.EPSILON);
            const k = p.height / h;
            s.set(k, k, k);
            // Lean about a horizontal axis at the leaning azimuth, after the yaw.
            const axis = new THREE.Vector3(Math.cos(p.leanAzimuth), 0, Math.sin(p.leanAzimuth));
            q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, p.lean));
            // Stand the trunk base on the ground.
            pos.y = -info.box.min.y * k;
        } else if (p.kind === "boulder") {
            s.y = Math.min(p.sy, this.maxBoulderScaleY(info));
        }
        return out.compose(pos, q, s);
    }

    /** Boulders stay ≤ tallPropHeight high (§2.6). */
    private maxBoulderScaleY(info: ModelInfo): number {
        return info.box.max.y > 0 ? SC.tallPropHeight / info.box.max.y : Infinity;
    }

    private buildKind(kind: SceneryKind, inBounds: boolean, placements: SceneryPlacement[], models: ModelInfo[]): KindGroup {
        const g: KindGroup = { kind, inBounds, placements, sets: [], bodies: [], blobs: null };
        if (!models.length || !placements.length) return g;
        const tmp = new THREE.Matrix4();
        const variantOf = (p: SceneryPlacement) => Math.min(models.length - 1, Math.floor(p.variant * models.length));
        const casts = kind !== "bush";

        for (const [v, info] of models.entries()) {
            const triangles = modelTriangles(info.root);
            // Heavy models: one set per CHUNK cell, so each culls on its own sphere.
            const chunked = triangles > CHUNK.minTriangles;
            const cellOf = (p: SceneryPlacement) =>
                chunked ? `-c${Math.floor(p.x / CHUNK.size)}_${Math.floor(p.z / CHUNK.size)}` : "";
            // Insertion order (= kind order of each cell's first member) keeps this deterministic.
            const buckets = new Map<string, { orders: number[]; matrices: THREE.Matrix4[] }>();
            placements.forEach((p, i) => {
                if (variantOf(p) !== v) return;
                const key = cellOf(p);
                let b = buckets.get(key);
                if (!b) buckets.set(key, (b = { orders: [], matrices: [] }));
                b.orders.push(i);
                b.matrices.push(this.matrix(p, info, tmp).clone());
            });
            for (const [cell, { orders, matrices }] of buckets) {
                // buildInstances fits each mesh's bounding sphere to its instances.
                const set = buildInstances(info.root, matrices, {
                    material: (m) => this.material(m),
                    castShadow: casts,
                    receiveShadow: true,
                });
                set.group.name = `scenery-${kind}-${inBounds ? "bounds" : "band"}-${v}${cell}`;
                if (kind === "tree") this.tintFoliage(set, orders.map((i) => placements[i].dark));
                this.group.add(set.group);
                g.sets.push({ kind, inBounds, set, orders, triangles });
            }
        }

        if (inBounds) g.bodies = this.colliders(kind, placements, models, variantOf);
        if (kind !== "bush" && this.deps.environment) {
            g.blobs = this.deps.environment.addPropBlobs(
                placements.map((p) => this.blobSpot(p, models[variantOf(p)]))
            );
        }
        return g;
    }

    /** Dark trees: per-instance colour on the foliage sub-mesh only. */
    private tintFoliage(set: InstanceSet, dark: boolean[]) {
        const white = new THREE.Color(1, 1, 1);
        for (const mesh of set.meshes) {
            if (!this.isFoliage(mesh.material as THREE.Material)) continue;
            dark.forEach((d, i) => mesh.setColorAt(i, d ? this.tint : white));
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
    }

    /** Fixed colliders, in bounds only (§2.6): cylinders for trees / palms, bbox cuboids for boulders. */
    private colliders(
        kind: SceneryKind,
        placements: SceneryPlacement[],
        models: ModelInfo[],
        variantOf: (p: SceneryPlacement) => number
    ): RAPIER.RigidBody[] {
        const { physics } = this.deps;
        if (kind === "bush") return [];
        if (kind === "tree" || kind === "palm") {
            const c = SC.colliders[kind];
            return placements.map((p) => physics.addFixedCylinder(c.height / 2, c.radius, { x: p.x, y: c.height / 2, z: p.z }));
        }
        return placements.map((p) => {
            const info = models[variantOf(p)];
            const sy = Math.min(p.sy, this.maxBoulderScaleY(info));
            const size = info.box.getSize(new THREE.Vector3()).multiply(new THREE.Vector3(p.sx, sy, p.sz));
            const centre = info.box.getCenter(new THREE.Vector3()).multiply(new THREE.Vector3(p.sx, sy, p.sz));
            const q = new THREE.Quaternion().setFromAxisAngle(UP, p.yaw);
            return physics.addFixedCuboid(
                { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
                { x: p.x, y: 0, z: p.z },
                { x: q.x, y: q.y, z: q.z, w: q.w },
                { x: centre.x, y: centre.y, z: centre.z }
            );
        });
    }

    /** The blob under a prop: its scaled bbox footprint, turned with its yaw. */
    private blobSpot(p: SceneryPlacement, info: ModelInfo): BlobSpot {
        const size = info.box.getSize(new THREE.Vector3());
        const k = p.kind === "palm" ? p.height / Math.max(size.y, Number.EPSILON) : 1;
        const sx = p.kind === "palm" ? k : p.sx;
        const sz = p.kind === "palm" ? k : p.sz;
        return { x: p.x, z: p.z, w: size.x * sx, d: size.z * sz, rot: p.yaw };
    }

    /** Applies the tier × density counts to meshes, colliders and blobs. */
    private apply(): void {
        if (this.disposed) return;
        const counts = this.counts;
        for (const g of this.groups) {
            const n = g.inBounds ? counts[g.kind].inBounds : counts[g.kind].bands;
            for (const s of g.sets) s.set.setCount(countBelow(s.orders, n));
            g.bodies.forEach((b, i) => b.setEnabled(i < n));
            g.blobs?.setCount(n);
        }
    }
}

/** How many of the ascending `orders` are below n. */
function countBelow(orders: readonly number[], n: number): number {
    let lo = 0;
    let hi = orders.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (orders[mid] < n) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Builds the scenery (§2.6). The integrator adds `group` to the scene. */
export function buildScenery(deps: SceneryDeps): {
    group: THREE.Group;
    scenery: Scenery;
    setDensity(fraction: number): void;
    setTier(tier: SceneryTier): void;
    dispose(): void;
} {
    const scenery = new Scenery(deps);
    return {
        group: scenery.group,
        scenery,
        setDensity: (f) => scenery.setDensity(f),
        setTier: (t) => scenery.setTier(t),
        dispose: () => scenery.dispose(),
    };
}
