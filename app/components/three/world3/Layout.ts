// ─────────────────────────────────────────────────────────────────────────
// World layout (§2): every coordinate in the v3 world lives here. Area modules
// use only these values plus R/S offsets — no magic numbers.
//
// Conventions (§2.1): Y up, ground at y = 0, north = −Z, east = +X.
// R (screen-right) = (0.7071, 0, −0.7071), S (screen-down) = (0.7071, 0, 0.7071).
// Pure data + geometry (no three.js) so Layout.test.ts runs in plain Node.
// ─────────────────────────────────────────────────────────────────────────

import { ACCENT, ACCENT_INK, CAMERA_YAW, CONFIG, SCREEN_DOWN, SCREEN_RIGHT, type AccentKey } from "./Config";
import type { AreaDef, AreaId, PadDef, PathDef, PathLabel, Rect, XZ } from "./types";
import { mulberry32 } from "./utils/math";
import {
    about as aboutContent,
    contactLinks,
    frontendProjects,
    journeyStops,
    meta,
    musicPillars,
    skillTotems,
    ekoMilestones,
} from "@/app/field/content/world";

const R = SCREEN_RIGHT;
const S = SCREEN_DOWN;

// ── Geometry helpers ─────────────────────────────────────────────────────
export const rect = (x: number, z: number, w: number, d: number): Rect => ({ x, z, w, d });

/** Rect from world bounds (min/max X, min/max Z). */
export const rectFromBounds = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    w: maxX - minX,
    d: maxZ - minZ,
});

export interface RectBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export const rectBounds = (r: Rect): RectBounds => ({
    minX: r.x - r.w / 2,
    maxX: r.x + r.w / 2,
    minZ: r.z - r.d / 2,
    maxZ: r.z + r.d / 2,
});

/** Inclusive containment (points on the edge count as inside). */
export function pointInRect(r: Rect, x: number, z: number, eps = 1e-9): boolean {
    return Math.abs(x - r.x) <= r.w / 2 + eps && Math.abs(z - r.z) <= r.d / 2 + eps;
}

/** Interior overlap (shared edges don't count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
    return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
}

/** Distance from a point to a rect (0 inside). */
export function distToRect(r: Rect, x: number, z: number): number {
    const dx = Math.max(0, Math.abs(x - r.x) - r.w / 2);
    const dz = Math.max(0, Math.abs(z - r.z) - r.d / 2);
    return Math.hypot(dx, dz);
}

/** True when the point lies on the rect's boundary. */
export function pointOnRectEdge(r: Rect, x: number, z: number, eps = 1e-6): boolean {
    if (!pointInRect(r, x, z, eps)) return false;
    const b = rectBounds(r);
    return (
        Math.abs(x - b.minX) <= eps ||
        Math.abs(x - b.maxX) <= eps ||
        Math.abs(z - b.minZ) <= eps ||
        Math.abs(z - b.maxZ) <= eps
    );
}

/** p + R·r + S·s (the "offset along screen axes" used throughout §2.4). */
export function offsetRS(p: XZ, r: number, s: number): XZ {
    return { x: p.x + R.x * r + S.x * s, z: p.z + R.z * r + S.z * s };
}

/** Row along R (§2.1): item i sits at c + R·(i − (n−1)/2)·spacing. */
export function rowAlongR(c: XZ, n: number, spacing: number): XZ[] {
    return Array.from({ length: n }, (_, i) => offsetRS(c, (i - (n - 1) / 2) * spacing, 0));
}

/** A point in a pad's local frame (lx along its width axis, lz along its depth axis). */
export function padLocal(pad: PadDef, x: number, z: number): { lx: number; lz: number } {
    const dx = x - pad.x;
    const dz = z - pad.z;
    if (!pad.faceCamera) return { lx: dx, lz: dz };
    return { lx: dx * R.x + dz * R.z, lz: dx * S.x + dz * S.z };
}

/** Rect test in the pad's local frame (§5.3). */
export function pointInPad(pad: PadDef, x: number, z: number): boolean {
    const { lx, lz } = padLocal(pad, x, z);
    return Math.abs(lx) <= pad.w / 2 && Math.abs(lz) <= pad.d / 2;
}

// ── Oriented footprints (for clearances / sun-strip tests / scenery) ─────
/**
 * Oriented rectangle on the ground: centre, half extents along its local X (hu)
 * and Z (hv) axes, and a yaw `rot` (three's rotation.y): local +X maps to
 * (cos rot, −sin rot), local +Z to (sin rot, cos rot). faceCamera ⇒ rot = CAMERA_YAW.
 */
export interface Footprint {
    x: number;
    z: number;
    hu: number;
    hv: number;
    rot: number;
}

export function footprintCorners(f: Footprint): XZ[] {
    const ux = Math.cos(f.rot);
    const uz = -Math.sin(f.rot);
    const vx = Math.sin(f.rot);
    const vz = Math.cos(f.rot);
    const out: XZ[] = [];
    for (const [a, b] of [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
    ] as const) {
        out.push({ x: f.x + ux * f.hu * a + vx * f.hv * b, z: f.z + uz * f.hu * a + vz * f.hv * b });
    }
    return out;
}

export const padFootprint = (p: PadDef): Footprint => ({
    x: p.x,
    z: p.z,
    hu: p.w / 2,
    hv: p.d / 2,
    rot: p.faceCamera ? CAMERA_YAW : 0,
});

// ── Bounds, bands, quay, jetty, spawn (§2.2) ─────────────────────────────
export const BOUNDS: RectBounds = { ...CONFIG.world.bounds };
export const BOUNDS_RECT: Rect = rectFromBounds(BOUNDS.minX, BOUNDS.maxX, BOUNDS.minZ, BOUNDS.maxZ);
export const QUAY_Z = CONFIG.world.quayZ;

export type BandId = "west" | "south" | "east";
export interface BandDef {
    id: BandId;
    rect: Rect;
    /** "all" = every prop type; "low" = bushes and boulders only (≤ 1.5 high). */
    props: "all" | "low";
}

/** Decorative bands outside the bounds (no colliders). Nothing past the lagoon. */
export const BANDS: readonly BandDef[] = [
    { id: "west", rect: rectFromBounds(-210, -150, -176, 40), props: "all" },
    { id: "south", rect: rectFromBounds(-210, 210, 40, 80), props: "low" },
    { id: "east", rect: rectFromBounds(170, 210, -176, 40), props: "low" },
];

/** Credits jetty: deck x −4..4, z −176..−200 (top at y = 0). */
export const JETTY = {
    rect: rectFromBounds(-4, 4, -200, -176),
    deckTopY: 0,
} as const;

/** Spawn (§2.4): faces north toward P1; drops from y + CONFIG.vehicle.spawnDrop on Start. */
export const SPAWN = { x: 0, z: 12, yaw: Math.PI } as const;

/** Ramp run-up + landing (§2.4): no props, scenery or tokens inside. */
export const RAMP_CORRIDOR: Rect = rectFromBounds(-145, -40, -46, -34);

// ── Areas (§2.3) ─────────────────────────────────────────────────────────
const accents = (k: AccentKey) => ({ accent: ACCENT[k], accentInk: ACCENT_INK[k] });

/**
 * Area table. The current area is the FIRST rect containing the car centre.
 * NOTE (Step 0 deviation): projects is (85, −66) 134×40 (x 18..152) instead of
 * the spec's (83, −66) 138×40 (x 14..152): the spec rect overlapped journey's
 * (x −18..18) over x 14..18, z −86..−70, and Layout.test.ts forbids overlaps.
 */
export const AREAS: readonly AreaDef[] = [
    {
        id: "welcome",
        name: "Welcome",
        ...accents("brand"),
        rect: rect(0, 2, 44, 36),
        arrival: { x: 0, z: 12, yaw: Math.PI },
        cameraShot: "default",
        title3D: { text: meta.heroWord, x: -11, z: 4, dynamic: true },
    },
    {
        id: "hub",
        name: "Crossroads",
        ...accents("brand"),
        rect: rect(0, -56, 26, 26),
        arrival: { x: 0, z: -46, yaw: Math.PI },
        cameraShot: "default",
    },
    {
        id: "projects",
        name: "Frontend Projects",
        ...accents("projects"),
        rect: rect(85, -66, 134, 40),
        arrival: { x: 22, z: -56, yaw: Math.PI / 2 },
        cameraShot: "gallery",
        cameraZone: rectFromBounds(28, 152, -92, -44),
        // Step 0 deviation: x 29 (spec 24) so the title's footprint stays inside the
        // projects rect (x ≥ 18) and the gallery camera zone (x ≥ 28) — see DECISIONS.md.
        title3D: { text: "PROJECTS", x: 29, z: -78, dynamic: false },
    },
    {
        id: "journey",
        name: "Journey & Skills",
        ...accents("journey"),
        rect: rect(0, -119, 36, 98),
        arrival: { x: 0, z: -74, yaw: Math.PI },
        cameraShot: "default",
        // Step 0 deviation: z −77.5 (spec −76) so the title's footprint stays inside the
        // journey rect (z ≤ −70) — see DECISIONS.md.
        title3D: { text: "JOURNEY", x: -11, z: -77.5, dynamic: false },
    },
    {
        id: "eko",
        name: "Eko",
        ...accents("eko"),
        rect: rect(64, -122, 48, 44),
        arrival: { x: 44, z: -120, yaw: Math.PI / 2 },
        cameraShot: "default",
        title3D: { text: "EKO", x: 50, z: -138, dynamic: false },
    },
    {
        id: "music",
        name: "Music & Culture",
        ...accents("music"),
        rect: rect(-64, -122, 48, 44),
        arrival: { x: -44, z: -124, yaw: -Math.PI / 2 },
        cameraShot: "gallery",
        cameraZone: rect(-64, -122, 48, 44),
        title3D: { text: "MUSIC", x: -80, z: -110, dynamic: false },
    },
    {
        id: "about",
        name: "About & Contact",
        ...accents("brand"),
        rect: rect(-56, 4, 44, 32),
        arrival: { x: -38, z: 4, yaw: -Math.PI / 2 },
        cameraShot: "default",
        title3D: { text: "ABOUT", x: -64, z: -6, dynamic: false },
    },
    {
        id: "playground",
        name: "Playground",
        ...accents("play"),
        rect: rect(-106, -56, 56, 44),
        arrival: { x: -82, z: -56, yaw: -Math.PI / 2 },
        cameraShot: "default",
        title3D: { text: "PLAY", x: -90, z: -70, dynamic: true },
    },
    {
        id: "credits",
        name: "Credits",
        ...accents("brand"),
        rect: rect(0, -188, 8, 24),
        arrival: { x: 0, z: -180, yaw: Math.PI },
        cameraShot: "default",
    },
];

export const AREA_BY_ID: Readonly<Record<AreaId, AreaDef>> = Object.fromEntries(
    AREAS.map((a) => [a.id, a])
) as Record<AreaId, AreaDef>;

/** The first area (table order) whose rect contains (x, z), or null. */
export function areaAt(x: number, z: number): AreaDef | null {
    for (const a of AREAS) if (pointInRect(a.rect, x, z)) return a;
    return null;
}

/** The area nearest to (x, z) by rect distance (R respawn, §4.2). */
export function nearestArea(x: number, z: number): AreaDef {
    let best = AREAS[0];
    let bestD = Infinity;
    for (const a of AREAS) {
        const d = distToRect(a.rect, x, z);
        if (d < bestD) {
            bestD = d;
            best = a;
        }
    }
    return best;
}

// ── Paths (§2.5) ─────────────────────────────────────────────────────────
export const TILE = {
    size: 1.6,
    height: 0.08,
    radius: 0.4,
    /** First tile centre at from + t·firstOffset; then every `step`. */
    firstOffset: 1.1,
    step: 2.2,
    lateral: { 2: [-0.95, 0.95], 3: [-1.9, 0, 1.9] } as const,
    zigzag: 0.3,
    /** Along-path position jitter (±). */
    jitter: 0.15,
    /**
     * Across-path jitter (±). Smaller than `jitter` so neighbouring lanes (1.9
     * apart) keep a ≥ 1.7 centre gap — more than a yaw-jittered tile's 2 × 0.8465 reach.
     */
    lateralJitter: 0.1,
    yawJitter: 0.06,
    /** Outer tile edge from the centre line (labels sit beyond it). */
    outerEdge: { 2: 1.75, 3: 2.7 } as const,
    /** Gap between the outer tile edge and a path label. */
    labelGap: 0.9,
    /**
     * A path endpoint "lies on another path" when within that path's outer edge
     * plus this tolerance (P5/P6 start 0.3 beyond P4's tiles so they never overlap).
     */
    joinTolerance: 0.5,
} as const;

const HUB_LABEL_OUTSIDE = 6;

export const PATHS: readonly PathDef[] = [
    {
        id: "P1",
        from: { x: 0, z: -16 },
        to: { x: 0, z: -43 },
        width: 2,
        // START sits 6 outside the hub edge (path length 27 → d 21).
        labels: [
            { text: "CROSSROADS", d: 4 },
            { text: "START", d: 27 - HUB_LABEL_OUTSIDE },
        ],
    },
    { id: "P2", from: { x: 13, z: -56 }, to: { x: 152, z: -56 }, width: 2, labels: [{ text: "PROJECTS", d: 6 }] },
    { id: "P3", from: { x: -13, z: -56 }, to: { x: -78, z: -56 }, width: 2, labels: [{ text: "PLAYGROUND", d: 6 }] },
    {
        id: "P4",
        from: { x: 0, z: -69 },
        to: { x: 0, z: -176 },
        width: 3,
        // Step 0 deviation: d 4.5 (spec d 6). The centred ≈15.2-long label at d 6
        // clipped milestone-0's plate corner; at d 4.5 it ends ≈ 0.5 short of it
        // (side gap 0.9 unchanged). Its sun strip still clears the hub planter.
        labels: [{ text: "JOURNEY · EKO · MUSIC", d: 4.5 }],
    },
    { id: "P5", from: { x: -3, z: -120 }, to: { x: -40, z: -120 }, width: 2, labels: [{ text: "MUSIC", d: 6 }] },
    { id: "P6", from: { x: 3, z: -120 }, to: { x: 40, z: -120 }, width: 2, labels: [{ text: "EKO", d: 6 }] },
    { id: "P7", from: { x: -22, z: 4 }, to: { x: -34, z: 4 }, width: 2, labels: [{ text: "ABOUT & CONTACT", d: 4 }] },
];

export const pathLength = (p: PathDef) => Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z);

/** Unit tangent from → to. */
export function pathTangent(p: PathDef): XZ {
    const l = pathLength(p);
    return { x: (p.to.x - p.from.x) / l, z: (p.to.z - p.from.z) / l };
}

/** Outer tile edge from the centre line. */
export const pathHalfWidth = (p: PathDef) => TILE.outerEdge[p.width];

/** Clearance half-width used by scenery (half-width + CONFIG.scenery.pathClearance). */
export const pathClearance = (p: PathDef) => pathHalfWidth(p) + CONFIG.scenery.pathClearance;

export interface PathTile {
    x: number;
    z: number;
    /** rotation.y of the tile. */
    yaw: number;
}

function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

/**
 * Deterministic tile placement for one path (§2.5): first centre at from + t·1.1,
 * then every 2.2; lateral ±0.95 (2-wide) or −1.9/0/1.9 (3-wide); a ±0.3 zigzag
 * along the tangent alternating per LANE (so same-lane tiles stay 2.2 ± 0.3 apart
 * and never overlap); ±0.15 along-path, ±0.1 across-path and ±0.06 rad yaw
 * jitter, all seeded from CONFIG.world.seed. Tiles are clamped along the
 * tangent so they never pass the path's endpoints. No two tiles overlap.
 */
export function pathTiles(p: PathDef, seed: number = CONFIG.world.seed): PathTile[] {
    const rng = mulberry32((seed ^ hashString(p.id)) >>> 0);
    const L = pathLength(p);
    const t = pathTangent(p);
    const n = { x: -t.z, z: t.x };
    const baseYaw = Math.atan2(-t.z, t.x);
    const half = TILE.size / 2;
    // Farthest reach of a jittered-yaw tile along its own axes.
    const reach = half * (Math.cos(TILE.yawJitter) + Math.sin(TILE.yawJitter));
    const lanes = TILE.lateral[p.width];
    const tiles: PathTile[] = [];
    const rows = L < TILE.firstOffset * 2 ? 0 : Math.floor((L - 2 * TILE.firstOffset) / TILE.step) + 1;
    for (let row = 0; row < rows; row++) {
        for (let lane = 0; lane < lanes.length; lane++) {
            const zig = lane % 2 === 0 ? TILE.zigzag : -TILE.zigzag;
            const jA = (rng() * 2 - 1) * TILE.jitter;
            const jL = (rng() * 2 - 1) * TILE.lateralJitter;
            const jY = (rng() * 2 - 1) * TILE.yawJitter;
            let along = TILE.firstOffset + row * TILE.step + zig + jA;
            along = Math.min(L - reach, Math.max(reach, along));
            const lat = lanes[lane] + jL;
            tiles.push({
                x: p.from.x + t.x * along + n.x * lat,
                z: p.from.z + t.z * along + n.z * lat,
                yaw: baseYaw + jY,
            });
        }
    }
    return tiles;
}

export const tileFootprint = (tile: PathTile): Footprint => ({
    x: tile.x,
    z: tile.z,
    hu: TILE.size / 2,
    hv: TILE.size / 2,
    rot: tile.yaw,
});

export interface PathLabelPlacement {
    text: string;
    /** Label centre (anchorX/anchorY "center"/"middle"). */
    x: number;
    z: number;
    /** rotation.y = atan2(−t.z, t.x) with t flipped so dot(t, R) > 0 (§2.1). */
    angle: number;
}

/**
 * Path labels sit BESIDE the path (never on tiles): offset = outer tile edge +
 * 0.9 (2.65 / 3.6) on the camera side (dot(normal, S) > 0); baseline along the tangent.
 */
export function pathLabelPlacement(p: PathDef, label: PathLabel): PathLabelPlacement {
    const t = pathTangent(p);
    let nx = -t.z;
    let nz = t.x;
    if (nx * S.x + nz * S.z < 0) {
        nx = -nx;
        nz = -nz;
    }
    const off = pathHalfWidth(p) + TILE.labelGap;
    let tx = t.x;
    let tz = t.z;
    if (tx * R.x + tz * R.z < 0) {
        tx = -tx;
        tz = -tz;
    }
    return {
        text: label.text,
        x: p.from.x + t.x * label.d + nx * off,
        z: p.from.z + t.z * label.d + nz * off,
        angle: Math.atan2(-tz, tx),
    };
}

export const PATH_LABELS: readonly PathLabelPlacement[] = PATHS.flatMap((p) =>
    p.labels.map((l) => pathLabelPlacement(p, l))
);

// ── Yoruba-word tokens (§2.7) ────────────────────────────────────────────
export const TOKENS: readonly XZ[] = [
    { x: 16, z: -30 },
    { x: -30, z: -26 },
    { x: 90, z: -40 },
    { x: 160, z: -80 },
    { x: -30, z: -150 },
    { x: 30, z: -152 },
    { x: -140, z: -60 },
    { x: -20, z: 30 },
];

/** Coin geometry + pickup (§5.2). */
export const TOKEN = {
    radius: 1.1,
    thickness: 0.28,
    segments: 40,
    pickupRadius: 2.8,
    bob: 0.3,
    bobHz: 1.2,
    wobbleDeg: 20,
    wordZ: 0.15,
    /** Coin centre height above the ground. */
    y: 1.6,
} as const;

// ── Area contents (§2.4) ─────────────────────────────────────────────────
const welcomeHero: XZ = { x: -11, z: 4 };
const musicC: XZ = { x: -64, z: -122 };
const musicStage = offsetRS(musicC, 0, -5);
const aboutC: XZ = { x: -56, z: 4 };
const projectBoards = Array.from({ length: frontendProjects.length }, (_, i) => ({ x: 44 + 30 * i, z: -76 }));
const ekoPhone: XZ = { x: 80, z: -112 };
const sleeveRow = rowAlongR(offsetRS(musicC, -2, 12), musicPillars.length, 6.5);

const PIN_ROWS = 4;
const pinPositions = (() => {
    const apex = { x: -110, z: -56 };
    const out: XZ[] = [];
    for (let r = 0; r < PIN_ROWS; r++) {
        for (let j = 0; j <= r; j++) out.push({ x: apex.x - 1.3 * r, z: apex.z + (j - r / 2) * 1.5 });
    }
    return out;
})();

export interface BrickSpot {
    x: number;
    y: number;
    z: number;
    /** Half brick (1 × 1 × 1) at the ends of odd rows. */
    half: boolean;
}

const WALL = { centre: { x: -112, z: -70 }, columns: 6, rows: 5, brick: { w: 2, h: 1, d: 1 }, halfBrickW: 1 };
const brickSpots = (() => {
    const out: BrickSpot[] = [];
    const { columns, rows, brick, halfBrickW } = WALL;
    for (let row = 0; row < rows; row++) {
        const y = brick.h / 2 + row * brick.h;
        const odd = row % 2 === 1;
        const fulls = odd ? columns - 1 : columns;
        for (let i = 0; i < fulls; i++) {
            const lx = (i - (fulls - 1) / 2) * brick.w;
            const p = offsetRS(WALL.centre, lx, 0);
            out.push({ x: p.x, y, z: p.z, half: false });
        }
        if (odd) {
            const edge = (columns * brick.w) / 2 - halfBrickW / 2;
            for (const sgn of [-1, 1]) {
                const p = offsetRS(WALL.centre, sgn * edge, 0);
                out.push({ x: p.x, y, z: p.z, half: true });
            }
        }
    }
    return out;
})();

/** Contact pads present (CV only when a cv link exists). */
const contactPadSpots = rowAlongR({ x: -52, z: 12 }, contactLinks.length, 6);

export const AREA_LAYOUT = {
    welcome: {
        spawn: SPAWN,
        heroWord: welcomeHero,
        roleLine: offsetRS(welcomeHero, 0, 5.5),
        greeting: offsetRS(welcomeHero, 0, 7.6),
        plazaRadius: 3,
    },
    hub: {
        /** Paper planter holding one tree; `treeTop` bounds the tree for clearance checks. */
        planter: { x: 0, z: -56, w: 6, h: 1, d: 6, segments: 3, radius: 0.3, treeTop: 6 },
        plazaRadius: 3,
        labelOutsideEdge: HUB_LABEL_OUTSIDE,
    },
    projects: {
        title: { x: 29, z: -78 },
        /** Board base centres (§5.1 builds the board). */
        boards: projectBoards,
        board: {
            leg: { w: 0.35, h: 2.0, d: 0.35, x: 3.6 },
            frame: { w: 10.8, h: 8.4, d: 0.35, segments: 4, radius: 0.17, bottom: 2.0 },
            image: { w: 10, h: 5.625, margin: 0.4, z: 0.18 },
            textX: -4.8,
            lazyLoadDistance: 120,
            fadeIn: 0.6,
        },
        pads: projectBoards.map((b) => offsetRS(b, 0, 12)),
        pad: { w: 8, d: 5 },
        padLabel: "E  OPEN PROJECT",
    },
    journey: {
        title: { x: -11, z: -77.5 },
        trailX: 0,
        milestones: [-84, -97, -110, -130, -143, -156].slice(0, journeyStops.length).map((z) => ({ x: 8, z })),
        milestonePlate: { w: 9, d: 4.6, titleMaxWidth: 8 },
        skills: [-92, -106, -146].slice(0, skillTotems.length).map((z) => ({ x: -9, z })),
        skillPlate: { w: 10, d: 6 },
        now: { x: 0, z: -168, size: 1.8 },
    },
    eko: {
        title: { x: 50, z: -138 },
        tiles: Array.from({ length: ekoMilestones.length }, (_, k) => ({ x: 52 + 6 * k, z: -110 - 6 * k })),
        tile: { w: 7, d: 7, numeralSize: 2.4 },
        phone: {
            position: ekoPhone,
            plinth: { w: 6, h: 0.8, d: 6, segments: 3, radius: 0.3 },
            body: { w: 4.4, h: 8.8, radius: 0.5, depth: 0.5 },
            screen: { w: 3.9, h: 8.2, inset: 0.01 },
        },
        pad: { ...offsetRS(ekoPhone, 0, 8), w: 6, d: 5 },
        padLabel: "E  OPEN EKO",
    },
    music: {
        centre: musicC,
        title: { x: -80, z: -110 },
        stage: { ...musicStage, w: 18, h: 1, d: 8, segments: 3, radius: 0.3 },
        vinyl: { ...offsetRS(musicStage, 0, 0.5), radius: 3.2, height: 0.3, segments: 48, labelRadius: 1.1, spin: 0.6 },
        speakers: [offsetRS(musicStage, -7, -1.5), offsetRS(musicStage, 7, -1.5)],
        speaker: { w: 2.4, h: 4.4, d: 2 },
        eqBars: Array.from({ length: 9 }, (_, i) => offsetRS(musicStage, (i - 4) * 1.3, -3.3)),
        eqBar: { w: 0.9, h: 1, d: 0.9 },
        eqStaticHeights: [1, 2, 3, 4, 3, 2, 3, 2, 1],
        sleeves: sleeveRow,
        sleeve: { w: 5, h: 5, d: 0.3, segments: 2, radius: 0.12, stripH: 0.8, titleMaxWidth: 4.4 },
        sleevePads: sleeveRow.map((p) => offsetRS(p, 0, 5)),
        sleevePad: { w: 6, d: 4.4 },
    },
    about: {
        centre: aboutC,
        title: { x: -64, z: -6 },
        portrait: {
            x: -52,
            z: -4,
            frame: { w: 5, h: 6.2, d: 0.3, segments: 2, radius: 0.14 },
            leg: { w: 0.3, h: 1.2, d: 0.3 },
            image: 4.4,
        },
        bio: { ...offsetRS(aboutC, 0, 2), size: 0.85, maxWidth: 16, lineHeight: 1.35, maxLines: 3 },
        contactRow: { x: -52, z: 12, spacing: 6 },
        contactPads: contactPadSpots,
        contactPad: { w: 5, d: 3.6 },
    },
    playground: {
        title: { x: -90, z: -70 },
        ramp: {
            x: -84,
            z: -40,
            length: 10,
            width: 8,
            height: 2.4,
            /** Rises toward −X: low edge at x −79, lip at x −89. */
            lowEdgeX: -79,
            lipX: -89,
            chevrons: 3,
        },
        lane: { fromX: -86, toX: -116, z: -56, width: 4 },
        ball: { x: -90, z: -56, radius: 1.3, mass: 140 },
        pins: pinPositions,
        pin: { height: 2.2, radius: 0.42, mass: 8 },
        wall: { ...WALL, mass: 25, halfMass: 12.5, segments: 2, radius: 0.06 },
        bricks: brickSpots,
        resetPad: { x: -84, z: -63, w: 5, d: 5 },
        resetLabel: "RESET",
    },
    credits: {
        sign: { x: 0, z: -196, w: 7, h: 3.6, d: 0.3, segments: 2, radius: 0.14, postH: 1.2 },
        pad: { x: 0, z: -190, w: 6, d: 5 },
    },
} as const;

// ── Pads registry ────────────────────────────────────────────────────────
export interface PadSpot {
    id: string;
    areaId: AreaId;
    pad: PadDef;
    /** Flat pad label, or null when the plate carries its own copy. */
    label: string | null;
}

const fc = (p: XZ, w: number, d: number): PadDef => ({ x: p.x, z: p.z, w, d, faceCamera: true });
const A = AREA_LAYOUT;

export const PADS: readonly PadSpot[] = [
    ...A.projects.pads.map((p, i) => ({
        id: `project-${i}`,
        areaId: "projects" as const,
        pad: fc(p, A.projects.pad.w, A.projects.pad.d),
        label: A.projects.padLabel,
    })),
    { id: "eko", areaId: "eko", pad: fc(A.eko.pad, A.eko.pad.w, A.eko.pad.d), label: A.eko.padLabel },
    ...A.music.sleevePads.map((p, i) => ({
        id: `sleeve-${i}`,
        areaId: "music" as const,
        pad: fc(p, A.music.sleevePad.w, A.music.sleevePad.d),
        label: null,
    })),
    ...A.journey.milestones.map((p, i) => ({
        id: `milestone-${i}`,
        areaId: "journey" as const,
        pad: fc(p, A.journey.milestonePlate.w, A.journey.milestonePlate.d),
        label: null,
    })),
    ...A.journey.skills.map((p, i) => ({
        id: `skill-${i}`,
        areaId: "journey" as const,
        pad: fc(p, A.journey.skillPlate.w, A.journey.skillPlate.d),
        label: null,
    })),
    ...A.about.contactPads.map((p, i) => ({
        id: `contact-${contactLinks[i].id}`,
        areaId: "about" as const,
        pad: fc(p, A.about.contactPad.w, A.about.contactPad.d),
        label: contactLinks[i].label,
    })),
    {
        id: "reset",
        areaId: "playground",
        pad: fc(A.playground.resetPad, A.playground.resetPad.w, A.playground.resetPad.d),
        label: A.playground.resetLabel,
    },
    { id: "credits", areaId: "credits", pad: fc(A.credits.pad, A.credits.pad.w, A.credits.pad.d), label: null },
];

// ── Text width estimate (layout checks only; real metrics come from troika) ──
/**
 * Conservative advance estimate in em for Inter/Bricolage bold: wide for caps
 * and digits so clearance checks err on the safe side.
 */
export function estimateTextWidth(text: string, size: number, letterSpacing = 0): number {
    let em = 0;
    const chars = Array.from(text.normalize("NFC"));
    for (const ch of chars) {
        if (ch === " ") em += 0.3;
        else if (/[A-Z0-9À-ÞẸỌṢ]/.test(ch)) em += 0.72;
        else if (/[a-zß-ÿẹọṣ]/.test(ch)) em += 0.58;
        else em += 0.4;
    }
    return (em + letterSpacing * Math.max(0, chars.length - 1)) * size;
}

// ── Static footprints: ground text and props ─────────────────────────────
export interface GroundTextSpot {
    id: string;
    footprint: Footprint;
}

const flatText = (id: string, p: XZ, width: number, height: number, rot = CAMERA_YAW): GroundTextSpot => ({
    id,
    footprint: { x: p.x, z: p.z, hu: width / 2, hv: height / 2, rot },
});
const T = CONFIG.type;

/**
 * Every piece of ground text (flat on ground, plaza, plates or tiles), as an
 * oriented footprint. Plate copy is approximated by the whole plate.
 */
export const GROUND_TEXTS: readonly GroundTextSpot[] = [
    flatText(
        "role",
        A.welcome.roleLine,
        estimateTextWidth(meta.role, T.roleLine.size, T.roleLine.letterSpacing),
        T.roleLine.size
    ),
    flatText("greeting", A.welcome.greeting, estimateTextWidth(meta.greeting, T.greeting.size), T.greeting.size),
    ...PATH_LABELS.map((l) =>
        flatText(
            `path-${l.text}`,
            l,
            estimateTextWidth(l.text, T.pathLabel.size, T.pathLabel.letterSpacing),
            T.pathLabel.size,
            l.angle
        )
    ),
    flatText("now", A.journey.now, estimateTextWidth("NOW", A.journey.now.size), A.journey.now.size),
    ...A.journey.milestones.map((p, i) =>
        flatText(`milestone-${i}`, p, A.journey.milestonePlate.w, A.journey.milestonePlate.d)
    ),
    ...A.journey.skills.map((p, i) => flatText(`skill-${i}`, p, A.journey.skillPlate.w, A.journey.skillPlate.d)),
    ...A.eko.tiles.map((p, i) => flatText(`eko-tile-${i}`, p, A.eko.tile.w, A.eko.tile.d)),
    flatText(
        "bio",
        A.about.bio,
        Math.min(A.about.bio.maxWidth, estimateTextWidth(aboutContent.bioShort, A.about.bio.size)),
        A.about.bio.size * A.about.bio.lineHeight * A.about.bio.maxLines
    ),
    ...PADS.filter((p) => p.label !== null).map((p) =>
        flatText(`pad-${p.id}`, p.pad, estimateTextWidth(p.label ?? "", T.padLabel.size), T.padLabel.size)
    ),
];

export interface PropSpot {
    id: string;
    footprint: Footprint;
    /** Top height above the ground. */
    height: number;
    /** Dynamic bodies (letters, ball, pins, bricks) start at this footprint. */
    dynamic?: boolean;
}

const prop = (id: string, p: XZ, w: number, d: number, height: number, rot = CAMERA_YAW, dynamic = false): PropSpot => ({
    id,
    footprint: { x: p.x, z: p.z, hu: w / 2, hv: d / 2, rot },
    height,
    dynamic,
});

/** Display-font word width for a 3D title (size = cap / capRatio, tracking in em). */
export function estimateTitleWidth(text: string, cap: number): number {
    const size = cap / T.capRatioFallback;
    return estimateTextWidth(text, size, T.tracking);
}

const titleProps: PropSpot[] = AREAS.filter((a) => a.title3D).map((a) => {
    const t = a.title3D!;
    const isHero = a.id === "welcome";
    const s = isHero ? T.heroWord : T.areaTitle;
    return prop(
        `title-${a.id}`,
        t,
        estimateTitleWidth(t.text, s.cap),
        s.depth + 2 * T.bevel.thickness,
        s.cap,
        CAMERA_YAW,
        t.dynamic
    );
});

const board = A.projects.board;
const pg = A.playground;
const pinsMinX = Math.min(...pg.pins.map((p) => p.x));
const pinsMaxX = Math.max(...pg.pins.map((p) => p.x));
const pinsMinZ = Math.min(...pg.pins.map((p) => p.z));
const pinsMaxZ = Math.max(...pg.pins.map((p) => p.z));

/** Hand-placed static props (and dynamic props' start footprints). */
export const PROPS: readonly PropSpot[] = [
    ...titleProps,
    prop("hub-planter", A.hub.planter, A.hub.planter.w, A.hub.planter.d, A.hub.planter.treeTop, 0),
    ...A.projects.boards.map((b, i) =>
        prop(`board-${i}`, b, board.frame.w, board.frame.d, board.frame.bottom + board.frame.h)
    ),
    prop("eko-phone", A.eko.phone.position, A.eko.phone.plinth.w, A.eko.phone.plinth.d, A.eko.phone.plinth.h + A.eko.phone.body.h),
    prop("music-stage", A.music.stage, A.music.stage.w, A.music.stage.d, A.music.stage.h),
    ...A.music.speakers.map((p, i) =>
        prop(`speaker-${i}`, p, A.music.speaker.w, A.music.speaker.d, A.music.stage.h + A.music.speaker.h)
    ),
    prop(
        "eq-bars",
        offsetRS(A.music.stage, 0, -3.3),
        8 * 1.3 + A.music.eqBar.w,
        A.music.eqBar.d,
        A.music.stage.h + Math.max(...A.music.eqStaticHeights)
    ),
    ...A.music.sleeves.map((p, i) => prop(`sleeve-${i}`, p, A.music.sleeve.w, A.music.sleeve.d, A.music.sleeve.h)),
    prop(
        "portrait",
        A.about.portrait,
        A.about.portrait.frame.w,
        A.about.portrait.frame.d,
        A.about.portrait.leg.h + A.about.portrait.frame.h
    ),
    prop("ball", pg.ball, pg.ball.radius * 2, pg.ball.radius * 2, pg.ball.radius * 2, 0, true),
    prop(
        "pins",
        { x: (pinsMinX + pinsMaxX) / 2, z: (pinsMinZ + pinsMaxZ) / 2 },
        pinsMaxX - pinsMinX + 2 * pg.pin.radius,
        pinsMaxZ - pinsMinZ + 2 * pg.pin.radius,
        pg.pin.height,
        0,
        true
    ),
    prop("brick-wall", pg.wall.centre, pg.wall.columns * pg.wall.brick.w, pg.wall.brick.d, pg.wall.rows * pg.wall.brick.h, CAMERA_YAW, true),
    prop(
        "credits-sign",
        A.credits.sign,
        A.credits.sign.w,
        A.credits.sign.d,
        A.credits.sign.postH + A.credits.sign.h
    ),
];

/** The ramp itself (the only prop allowed inside RAMP_CORRIDOR). */
export const RAMP_FOOTPRINT: Footprint = {
    x: pg.ramp.x,
    z: pg.ramp.z,
    hu: pg.ramp.length / 2,
    hv: pg.ramp.width / 2,
    rot: 0,
};

/** Horizontal unit direction toward the sun, ≈ (−0.42, 0, 0.91) (§1.2). */
export const SUN_GROUND_DIR: XZ = (() => {
    const d = CONFIG.lights.sunDirection;
    const l = Math.hypot(d.x, d.z);
    return { x: d.x / l, z: d.z / l };
})();

/**
 * The sun-side strip of a ground-text footprint: the convex hull of its corners
 * and the same corners moved `length` toward the sun (§1.2). No prop taller than
 * CONFIG.scenery.tallPropHeight may stand in it.
 */
export function sunStrip(f: Footprint, length: number = CONFIG.scenery.sunStripLength): XZ[] {
    const c = footprintCorners(f);
    const moved = c.map((p) => ({ x: p.x + SUN_GROUND_DIR.x * length, z: p.z + SUN_GROUND_DIR.z * length }));
    return convexHull([...c, ...moved]);
}

/** Monotone-chain convex hull (counter-clockwise in x/z). */
export function convexHull(points: XZ[]): XZ[] {
    const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
    if (pts.length <= 2) return pts;
    const cross = (o: XZ, a: XZ, b: XZ) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    const lower: XZ[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: XZ[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

/** Separating-axis test for two convex polygons (touching counts as no overlap). */
export function convexPolygonsOverlap(a: XZ[], b: XZ[], eps = 1e-9): boolean {
    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
            const p = poly[i];
            const q = poly[(i + 1) % poly.length];
            const ax = -(q.z - p.z);
            const az = q.x - p.x;
            let minA = Infinity;
            let maxA = -Infinity;
            for (const v of a) {
                const d = v.x * ax + v.z * az;
                minA = Math.min(minA, d);
                maxA = Math.max(maxA, d);
            }
            let minB = Infinity;
            let maxB = -Infinity;
            for (const v of b) {
                const d = v.x * ax + v.z * az;
                minB = Math.min(minB, d);
                maxB = Math.max(maxB, d);
            }
            if (maxA <= minB + eps || maxB <= minA + eps) return false;
        }
    }
    return true;
}

export const footprintsOverlap = (a: Footprint, b: Footprint) =>
    convexPolygonsOverlap(footprintCorners(a), footprintCorners(b));

export const footprintOverlapsRect = (f: Footprint, r: Rect) =>
    convexPolygonsOverlap(footprintCorners(f), footprintCorners({ x: r.x, z: r.z, hu: r.w / 2, hv: r.d / 2, rot: 0 }));
