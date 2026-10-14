import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG, PALETTE, type HexColor, type Vec3Like } from "../Config";
import type { MaterialsApi } from "../types";
import type { Disposal } from "../utils/disposal";

// ─────────────────────────────────────────────────────────────────────────
// Procedural red Cybertruck-STYLE truck (owner decision; no logos, no text).
//
// The body is one convex, planar solid built as a non-indexed BufferGeometry
// with flat (per-face) unit normals:
//   - side profile (z forward, y up): a low front nose, ONE straight line up to
//     a roof apex a little forward of mid-length, ONE straight line down to the
//     tailgate top, a vertical front face over a lower chamfer, a vertical
//     tailgate over a small chamfer, and a flat underside;
//   - cross-section: flat vertical sides up to the beltline crease (the nose
//     top), then a tumblehome plane that leans in so the glass section is 80 %
//     of the body width at the apex. Above the belt the half width depends on y
//     alone, so each upper side is ONE plane and every face stays planar.
// Dark glass panels float just off the body faces and wrap the cabin
// (windshield, side windows, rear glass). Black trapezoid arch flares (with a
// dark well behind each tyre), chunky tyres with flat aero hubcaps, and two
// unlit full-width light bars complete it.
//
// Units: CHASSIS space (Vehicle.chassis). The body is exactly the physics
// chassis' length and width, and the wheels sit on the physics wheel
// connection points (x = ±chassisHalf.x, z = ±(chassisHalf.z − insetZ)) at the
// physics radius. Heights are measured from the ground at rest (`groundY`).
// The real truck is 5.9 : 2.2 : 1.8 (L : W : H); the physics chassis is 3.8
// long and 2.0 wide with 0.84-diameter wheels, so the height (1.55) follows the
// wheels and the real height/width ratio, giving a chunky "toy" Cybertruck.
// ─────────────────────────────────────────────────────────────────────────

const V = CONFIG.vehicle;

/** Body red (owner decision: a RED Cybertruck): the palette token `cyberRed`. */
export const CYBER_RED: HexColor = PALETTE.cyberRed;

/** Truck colours (Lambert, flat) and light-bar colours (unlit basic). */
export const TRUCK_COLORS = Object.freeze({
    body: CYBER_RED,
    /** Dark tinted glass band around the cabin. */
    glass: "#2E2C35",
    /** Wheel-arch flares and the wells behind the tyres. */
    flare: PALETTE.carTrim,
    tyre: PALETTE.carTyre,
    /** Flat aero hubcap disc. */
    hub: "#C9C6CF",
    frontLight: PALETTE.carLight,
    /** Rear bar: dim tail light normally, bright brake red, warm white in reverse. */
    rearDim: "#8E1F17",
    rearBrake: PALETTE.brake,
    rearReverse: PALETTE.carLight,
} as const satisfies Record<string, HexColor>);

/** Body shape: heights above the ground; z positions as fractions of the half length. */
export const TRUCK_SHAPE = Object.freeze({
    /** Flat underside height (≈ the wheel centre, like the real truck's clearance). */
    underside: 0.4,
    /** Nose top = beltline crease: above the tyre tops so the flares fit below it. */
    belt: 0.98,
    /** Roof apex height, and its z (+ = forward of mid-length). */
    apex: 1.55,
    apexZ: 0.12,
    /** Tailgate top height (a little above the nose, like the real truck). */
    tail: 1.04,
    /** Front face bottom, and the lower front chamfer's depth along z. */
    noseLow: 0.62,
    frontChamfer: 0.14,
    /** Tailgate bottom, and the lower rear chamfer's depth along z. */
    tailLow: 0.52,
    rearChamfer: 0.08,
    /** Glass-section half width at the apex, as a fraction of the body half width. */
    upperWidth: 0.8,
});

/** Glass band (fractions along the roof lines; distances in units). */
export const TRUCK_GLASS = Object.freeze({
    /** Panels float this far off the body faces (no z-fighting at camera distance, even on a 16-bit depth buffer). */
    offset: 0.02,
    /** Windshield from / to, as fractions along nose → apex. */
    windshield: { from: 0.42, to: 0.95 },
    /** Windshield / rear-glass inset from each side edge (the pillars). */
    pillar: 0.07,
    /** Rear glass starts this far along apex → tail and ends at the cabin's rear. */
    rearFrom: 0.06,
    /** The cabin ends this fraction of the body length ahead of the tail (the bed behind). */
    cabinRear: 0.33,
    /** Side windows: the top edge runs this far below the roof line; the sill is level with the windshield base. */
    sideRoof: 0.05,
});

/** Trapezoid wheel-arch flares. */
export const TRUCK_FLARE = Object.freeze({
    /** Clearance between the tyre and the arch's inner bottom corners. */
    gap: 0.04,
    /** Inner top half width (the trapezoid's flat top), as a fraction of the wheel radius. */
    topHalfWidth: 0.8,
    /** Band width of the legs (along z) and of the top (along y). */
    band: 0.1,
    /** The flare's top sits this far under the belt crease. */
    topMargin: 0.015,
    /** Stands this far proud of the body side (covers the tyre from above), and sinks this far into it. */
    out: 0.22,
    embed: 0.02,
    /** Hangs this far below the underside. */
    drop: 0.02,
    /** Legs stay this far inside the body ends. */
    endMargin: 0.005,
    /** The dark well behind the tyre floats this far off the body side. */
    wellOffset: 0.01,
});

/** Wheels: physics radius; chunky width; flat aero hubcap with one dark vane (shows the spin). */
export const TRUCK_WHEEL = Object.freeze({
    width: 0.38,
    segments: 16,
    /** Hubcap radius as a fraction of the wheel radius. */
    hubRadius: 0.62,
    hubThickness: 0.03,
    /** Hubcap face stands this far outside the tyre's side wall. */
    hubProud: 0.015,
    /** Vane: thickness (x), length as a fraction of the wheel radius, width (z). */
    vane: { thickness: 0.012, length: 1.1, width: 0.07 },
});

/** Light bars: full width less an inset; thin boxes on the front face / tailgate. */
export const TRUCK_LIGHTS = Object.freeze({
    inset: 0.04,
    depth: 0.02,
    /** Centre this far below the nose crease. */
    front: { height: 0.06, below: 0.05 },
    /** Centre this far below the tailgate top. */
    rear: { height: 0.08, below: 0.07 },
    /**
     * Dark trim strip behind the rear bar (flare colour): frames the dim tail
     * light so it reads as a full-width bar against the red tailgate. It is
     * `pad` taller than the bar on each edge and half the bar's depth proud.
     */
    rearTrim: { pad: 0.025, depth: 0.01 },
});

/** Vertex merge / plane tolerance. */
const EPS = 1e-6;

/** Wheel order matches the controller: FL, FR, RL, RR (left is +X for a truck facing +Z). */
export const WHEEL_NAMES = ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"] as const;

/** A side-profile point: z forward, y up (chassis space). */
export interface ProfilePoint {
    z: number;
    y: number;
}

export interface TruckDims {
    groundY: number;
    halfLength: number;
    /** Body half width below the belt (flat vertical sides). */
    halfWidth: number;
    /** Half width at the apex (glass section). */
    upperHalfWidth: number;
    /** Half width lost per unit of height above the belt (tumblehome). */
    tumble: number;
    zFront: number;
    zRear: number;
    zApex: number;
    /** Where the cabin (and the glass) ends; the bed is behind it. */
    zCabinRear: number;
    yUnder: number;
    yNoseLow: number;
    yBelt: number;
    yApex: number;
    yTail: number;
    yTailLow: number;
    frontChamfer: number;
    rearChamfer: number;
    wheel: {
        radius: number;
        width: number;
        /** Wheel centres at rest, FL, FR, RL, RR. */
        centres: readonly Vec3Like[];
    };
}

/** Every truck dimension, in chassis space, for a ground plane at `groundY`. */
export function cybertruckDims(groundY: number): TruckDims {
    const S = TRUCK_SHAPE;
    const halfLength = V.chassisHalf.z;
    const halfWidth = V.chassisHalf.x;
    const upperHalfWidth = halfWidth * S.upperWidth;
    const yBelt = groundY + S.belt;
    const yApex = groundY + S.apex;
    const zRear = -halfLength;
    const cx = V.chassisHalf.x;
    const cz = V.chassisHalf.z - V.wheelConnection.insetZ;
    const cy = groundY + V.wheelRadius;
    const centres: readonly Vec3Like[] = Object.freeze(
        [
            { x: cx, y: cy, z: cz },
            { x: -cx, y: cy, z: cz },
            { x: cx, y: cy, z: -cz },
            { x: -cx, y: cy, z: -cz },
        ].map((c) => Object.freeze(c))
    );
    return {
        groundY,
        halfLength,
        halfWidth,
        upperHalfWidth,
        tumble: (halfWidth - upperHalfWidth) / (yApex - yBelt),
        zFront: halfLength,
        zRear,
        zApex: halfLength * S.apexZ,
        zCabinRear: zRear + 2 * halfLength * TRUCK_GLASS.cabinRear,
        yUnder: groundY + S.underside,
        yNoseLow: groundY + S.noseLow,
        yBelt,
        yApex,
        yTail: groundY + S.tail,
        yTailLow: groundY + S.tailLow,
        frontChamfer: S.frontChamfer,
        rearChamfer: S.rearChamfer,
        wheel: { radius: V.wheelRadius, width: TRUCK_WHEEL.width, centres },
    };
}

/** Half width at height y: flat sides up to the belt, then the tumblehome plane. */
export function halfWidthAt(d: TruckDims, y: number): number {
    return y <= d.yBelt ? d.halfWidth : d.halfWidth - d.tumble * (y - d.yBelt);
}

/**
 * The side profile, in order around the outline: front bottom chamfer, front
 * face, nose top, apex, tailgate top, tailgate, rear chamfer (the last edge
 * back to the first is the flat underside). The roof is exactly nose → apex →
 * tail: two straight lines.
 */
export function cybertruckProfile(d: TruckDims): ProfilePoint[] {
    return [
        { z: d.zFront - d.frontChamfer, y: d.yUnder },
        { z: d.zFront, y: d.yNoseLow },
        { z: d.zFront, y: d.yBelt },
        { z: d.zApex, y: d.yApex },
        { z: d.zRear, y: d.yTail },
        { z: d.zRear, y: d.yTailLow },
        { z: d.zRear + d.rearChamfer, y: d.yUnder },
    ];
}

/** Roof height at z (nose → apex → tail, two straight lines). */
export function roofY(d: TruckDims, z: number): number {
    if (z >= d.zApex) return THREE.MathUtils.lerp(d.yApex, d.yBelt, (z - d.zApex) / (d.zFront - d.zApex));
    return THREE.MathUtils.lerp(d.yApex, d.yTail, (d.zApex - z) / (d.zApex - d.zRear));
}

/** Inserts a vertex wherever an outline edge strictly crosses y = yCut. */
function withCrossings(ring: readonly ProfilePoint[], yCut: number): ProfilePoint[] {
    const out: ProfilePoint[] = [];
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        out.push(a);
        const da = a.y - yCut;
        const db = b.y - yCut;
        if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
            const t = da / (da - db);
            out.push({ z: a.z + (b.z - a.z) * t, y: yCut });
        }
    }
    return out;
}

// ── Polygon → flat-shaded triangles ──────────────────────────────────────
export type Polygon = THREE.Vector3[];

/** Newell normal of a planar polygon (unnormalised, along the winding). */
function newell(poly: Polygon): THREE.Vector3 {
    const n = new THREE.Vector3();
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n;
}

const centroid = (points: readonly THREE.Vector3[]) =>
    points.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(points.length);

/** Drops consecutive duplicates (a vertex shared by two outline features). */
function dedupe(poly: Polygon): Polygon {
    const out: Polygon = [];
    for (const p of poly) if (!out.length || out[out.length - 1].distanceTo(p) > EPS) out.push(p);
    while (out.length > 1 && out[0].distanceTo(out[out.length - 1]) <= EPS) out.pop();
    return out;
}

/** The polygon wound so its normal points away from `interior` (convex solids only). */
function orientOutward(poly: Polygon, interior: THREE.Vector3): { poly: Polygon; normal: THREE.Vector3 } {
    const n = newell(poly);
    const flip = n.dot(centroid(poly).sub(interior)) < 0;
    return { poly: flip ? [...poly].reverse() : poly, normal: (flip ? n.negate() : n).normalize() };
}

/**
 * Fan-triangulates convex planar polygons into a non-indexed geometry with
 * flat (per-face) unit normals, every face wound outward from `interior`.
 */
export function polygonsToGeometry(polygons: readonly Polygon[], interior: THREE.Vector3): THREE.BufferGeometry {
    const pos: number[] = [];
    const nor: number[] = [];
    for (const raw of polygons) {
        const clean = dedupe(raw);
        if (clean.length < 3) continue;
        const { poly, normal } = orientOutward(clean, interior);
        for (let i = 1; i < poly.length - 1; i++) {
            for (const p of [poly[0], poly[i], poly[i + 1]]) {
                pos.push(p.x, p.y, p.z);
                nor.push(normal.x, normal.y, normal.z);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
}

/** A body-surface point (z, y) on side s (+1 = left, +X; −1 = right), `inset` in from the side. */
const sidePoint = (d: TruckDims, p: ProfilePoint, s: number, inset = 0) =>
    new THREE.Vector3(s * (halfWidthAt(d, p.y) - inset), p.y, p.z);

/** A point inside the (convex) body: the average of its outline, on the centre plane. */
export function bodyInterior(d: TruckDims): THREE.Vector3 {
    const ring = cybertruckProfile(d);
    const c = ring.reduce((acc, p) => ({ z: acc.z + p.z, y: acc.y + p.y }), { z: 0, y: 0 });
    return new THREE.Vector3(0, c.y / ring.length, c.z / ring.length);
}

/** The body: two lower sides, two tumblehome sides and one strip face per outline edge. */
export function buildBodyGeometry(d: TruckDims): THREE.BufferGeometry {
    const ring = withCrossings(cybertruckProfile(d), d.yBelt);
    const lower = ring.filter((p) => p.y <= d.yBelt + EPS);
    const upper = ring.filter((p) => p.y >= d.yBelt - EPS);
    const faces: Polygon[] = [];
    for (const s of [1, -1]) {
        faces.push(lower.map((p) => sidePoint(d, p, s)));
        if (upper.length >= 3) faces.push(upper.map((p) => sidePoint(d, p, s)));
    }
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        faces.push([sidePoint(d, a, 1), sidePoint(d, b, 1), sidePoint(d, b, -1), sidePoint(d, a, -1)]);
    }
    return polygonsToGeometry(faces, bodyInterior(d));
}

/** Moves a planar polygon `dist` along its outward normal. */
function offsetOutward(poly: Polygon, interior: THREE.Vector3, dist: number): Polygon {
    const { normal } = orientOutward(poly, interior);
    return poly.map((p) => p.clone().addScaledVector(normal, dist));
}

const along = (a: ProfilePoint, b: ProfilePoint, t: number): ProfilePoint => ({
    z: a.z + (b.z - a.z) * t,
    y: a.y + (b.y - a.y) * t,
});

/** The side-window outline (on the tumblehome plane): a sharp front tip, the roof line, a short rear edge, a level sill. */
export function sideWindowOutline(d: TruckDims): ProfilePoint[] {
    const G = TRUCK_GLASS;
    const nose: ProfilePoint = { z: d.zFront, y: d.yBelt };
    const apex: ProfilePoint = { z: d.zApex, y: d.yApex };
    const tip = along(nose, apex, G.windshield.from);
    const sill = roofY(d, tip.z) - G.sideRoof;
    return [
        { z: tip.z, y: sill },
        { z: d.zApex, y: d.yApex - G.sideRoof },
        { z: d.zCabinRear, y: roofY(d, d.zCabinRear) - G.sideRoof },
        { z: d.zCabinRear, y: sill },
    ];
}

/**
 * The glass band: windshield (on the nose → apex face), rear glass (on the
 * apex → tail face, ending at the cabin) and one side window per side (on the
 * tumblehome planes). Each panel floats TRUCK_GLASS.offset off its face.
 */
export function buildGlassGeometry(d: TruckDims): THREE.BufferGeometry {
    const G = TRUCK_GLASS;
    const interior = bodyInterior(d);
    const nose: ProfilePoint = { z: d.zFront, y: d.yBelt };
    const apex: ProfilePoint = { z: d.zApex, y: d.yApex };
    const tail: ProfilePoint = { z: d.zRear, y: d.yTail };
    const strip = (a: ProfilePoint, b: ProfilePoint): Polygon => [
        sidePoint(d, a, 1, G.pillar),
        sidePoint(d, b, 1, G.pillar),
        sidePoint(d, b, -1, G.pillar),
        sidePoint(d, a, -1, G.pillar),
    ];
    const panels: Polygon[] = [];
    panels.push(strip(along(nose, apex, G.windshield.from), along(nose, apex, G.windshield.to)));
    const rearTo = (d.zApex - d.zCabinRear) / (d.zApex - d.zRear);
    panels.push(strip(along(apex, tail, G.rearFrom), along(apex, tail, rearTo)));
    const window = sideWindowOutline(d);
    for (const s of [1, -1]) panels.push(window.map((p) => sidePoint(d, p, s)));
    return polygonsToGeometry(
        panels.map((p) => offsetOutward(p, interior, G.offset)),
        interior
    );
}

/**
 * The ∩-shaped arch outline around a wheel centre (z relative to the centre,
 * y absolute): `outer` and `inner` trapezoids (bottom-right, top-right,
 * top-left, bottom-left). Front and rear arches share it, so it fits the
 * shorter overhang.
 */
export function flareOutline(d: TruckDims): { outer: ProfilePoint[]; inner: ProfilePoint[] } {
    const F = TRUCK_FLARE;
    const r = d.wheel.radius;
    const zc = d.wheel.centres[0].z;
    const reach = Math.min(d.zFront - zc, zc - d.zRear) - F.endMargin;
    const yLow = d.yUnder - F.drop;
    const yTopOut = d.yBelt - F.topMargin;
    const yTopIn = yTopOut - F.band;
    const aIn = r + F.gap;
    const bIn = r * F.topHalfWidth;
    const aOut = Math.min(aIn + F.band, reach);
    const bOut = bIn + F.band;
    return {
        outer: [
            { z: aOut, y: yLow },
            { z: bOut, y: yTopOut },
            { z: -bOut, y: yTopOut },
            { z: -aOut, y: yLow },
        ],
        inner: [
            { z: aIn, y: yLow },
            { z: bIn, y: yTopIn },
            { z: -bIn, y: yTopIn },
            { z: -aIn, y: yLow },
        ],
    };
}

/** A convex (z, y) polygon extruded across x ∈ [x0, x1], as outward-wound faces. */
function prism(outline: readonly ProfilePoint[], x0: number, x1: number, zOffset: number): Polygon[] {
    const at = (p: ProfilePoint, x: number) => new THREE.Vector3(x, p.y, p.z + zOffset);
    const faces: Polygon[] = [outline.map((p) => at(p, x0)), outline.map((p) => at(p, x1))];
    for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        faces.push([at(a, x0), at(b, x0), at(b, x1), at(a, x1)]);
    }
    return faces;
}

/**
 * Every flare (and the dark well inside each arch) as ONE geometry. Each ∩ is
 * three convex prisms (top bar and two legs) from the body side − embed to the
 * body side + out; the well is the inner trapezoid just off the body side.
 */
export function buildFlaresGeometry(d: TruckDims): THREE.BufferGeometry {
    const F = TRUCK_FLARE;
    const { outer, inner } = flareOutline(d);
    // Where the outer leg edge crosses the inner top height (splits ∩ into convex parts).
    const yTopIn = inner[1].y;
    const tOut = (yTopIn - outer[0].y) / (outer[1].y - outer[0].y);
    const zo = outer[0].z + (outer[1].z - outer[0].z) * tOut;
    const top: ProfilePoint[] = [outer[1], outer[2], { z: -zo, y: yTopIn }, { z: zo, y: yTopIn }];
    const leg: ProfilePoint[] = [inner[0], outer[0], { z: zo, y: yTopIn }, inner[1]];
    const legMirror = leg.map((p) => ({ z: -p.z, y: p.y }));
    const parts: THREE.BufferGeometry[] = [];
    for (const c of d.wheel.centres) {
        const s = Math.sign(c.x);
        const xIn = s * (d.halfWidth - F.embed);
        const xOut = s * (d.halfWidth + F.out);
        for (const outline of [top, leg, legMirror]) {
            const faces = prism(outline, xIn, xOut, c.z);
            const pts = faces.flat();
            parts.push(polygonsToGeometry(faces, centroid(pts)));
        }
        const xWell = s * (d.halfWidth + F.wellOffset);
        const well = inner.map((p) => new THREE.Vector3(xWell, p.y, p.z + c.z));
        parts.push(polygonsToGeometry([well], new THREE.Vector3(0, well[0].y, c.z)));
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!merged) throw new Error("[world3] Cybertruck flare merge failed");
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}

/** One wheel's dark parts: the tyre (axis along x) plus a vane across the hubcap on side s. */
export function buildTyreGeometry(radius: number, s: number): THREE.BufferGeometry {
    const W = TRUCK_WHEEL;
    const tyre = new THREE.CylinderGeometry(radius, radius, W.width, W.segments);
    tyre.rotateZ(Math.PI / 2);
    const vane = new THREE.BoxGeometry(W.vane.thickness, radius * W.vane.length, W.vane.width);
    vane.translate(s * (W.width / 2 + W.hubProud + W.vane.thickness / 2), 0, 0);
    const merged = mergeGeometries([tyre, vane]);
    tyre.dispose();
    vane.dispose();
    if (!merged) throw new Error("[world3] Cybertruck tyre merge failed");
    return merged;
}

export interface Cybertruck {
    /** Add to the chassis group. Holds every truck mesh. */
    root: THREE.Group;
    body: THREE.Mesh;
    glass: THREE.Mesh;
    flares: THREE.Mesh;
    /** FL, FR, RL, RR groups (rotation.order YXZ: steer about Y, then roll about X). */
    wheels: THREE.Group[];
    frontBar: THREE.Mesh;
    rearBar: THREE.Mesh;
    dims: TruckDims;
    /** Centre of the front light bar's face (headlight origin), chassis space. */
    headlightOrigin: THREE.Vector3;
}

export interface CybertruckDeps {
    materials: MaterialsApi;
    disposal: Disposal;
    /** Ground height in chassis space at rest (−REST_HEIGHT). */
    groundY: number;
}

/**
 * Builds the truck in chassis space. Geometries are tracked on `disposal`;
 * materials come from the shared palette cache (never disposed here). No mesh
 * casts a real shadow (the blob is the truck's shadow, §1.5).
 */
export function buildCybertruck(deps: CybertruckDeps): Cybertruck {
    const { materials: m, disposal } = deps;
    const d = cybertruckDims(deps.groundY);
    const track = <T extends THREE.BufferGeometry>(g: T) => disposal.track(g);
    const flat = (hex: HexColor) => m.lambert(hex, { flat: true });
    const root = new THREE.Group();
    root.name = "cybertruck";

    const body = new THREE.Mesh(track(buildBodyGeometry(d)), flat(TRUCK_COLORS.body));
    body.name = "cybertruck-body";
    const glass = new THREE.Mesh(track(buildGlassGeometry(d)), flat(TRUCK_COLORS.glass));
    glass.name = "cybertruck-glass";
    const flares = new THREE.Mesh(track(buildFlaresGeometry(d)), flat(TRUCK_COLORS.flare));
    flares.name = "cybertruck-flares";
    root.add(body, glass, flares);

    // Wheels: tyre + vane (one dark mesh) and a light hubcap disc.
    const W = TRUCK_WHEEL;
    const r = d.wheel.radius;
    // The vane sits on the outer side, so left and right wheels mirror it.
    const tyreGeo = new Map([1, -1].map((s) => [s, track(buildTyreGeometry(r, s))]));
    const hubR = r * W.hubRadius;
    const hubGeo = track(new THREE.CylinderGeometry(hubR, hubR, W.hubThickness, W.segments));
    hubGeo.rotateZ(Math.PI / 2);
    const hubX = W.width / 2 + W.hubProud - W.hubThickness / 2;
    const wheels = d.wheel.centres.map((c, i) => {
        const s = Math.sign(c.x);
        const w = new THREE.Group();
        w.name = WHEEL_NAMES[i];
        w.rotation.order = "YXZ";
        w.position.set(c.x, c.y, c.z);
        const tyre = new THREE.Mesh(tyreGeo.get(s)!, flat(TRUCK_COLORS.tyre));
        tyre.name = "cybertruck-tyre";
        const hub = new THREE.Mesh(hubGeo, flat(TRUCK_COLORS.hub));
        hub.name = "cybertruck-hub";
        hub.position.x = s * hubX;
        w.add(tyre, hub);
        root.add(w);
        return w;
    });

    // Light bars (unlit): full width less an inset, under the nose crease and the tailgate top.
    const Lb = TRUCK_LIGHTS;
    const barW = 2 * (d.halfWidth - Lb.inset);
    const frontBar = new THREE.Mesh(
        track(new THREE.BoxGeometry(barW, Lb.front.height, Lb.depth)),
        m.basic(TRUCK_COLORS.frontLight)
    );
    frontBar.name = "cybertruck-front-light";
    frontBar.position.set(0, d.yBelt - Lb.front.below, d.zFront + Lb.depth / 2);
    const rearBar = new THREE.Mesh(
        track(new THREE.BoxGeometry(barW, Lb.rear.height, Lb.depth)),
        m.basic(TRUCK_COLORS.rearDim)
    );
    rearBar.name = "cybertruck-rear-light";
    rearBar.position.set(0, d.yTail - Lb.rear.below, d.zRear - Lb.depth / 2);
    const trim = Lb.rearTrim;
    const rearTrim = new THREE.Mesh(
        track(new THREE.BoxGeometry(barW + 2 * trim.pad, Lb.rear.height + 2 * trim.pad, trim.depth)),
        flat(TRUCK_COLORS.flare)
    );
    rearTrim.name = "cybertruck-rear-trim";
    rearTrim.position.set(0, rearBar.position.y, d.zRear - trim.depth / 2);
    root.add(frontBar, rearBar, rearTrim);

    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        // Lit parts take the world's shadows (trees, props); the unlit bars can't show them.
        mesh.receiveShadow = !(mesh.material instanceof THREE.MeshBasicMaterial);
    });

    return {
        root,
        body,
        glass,
        flares,
        wheels,
        frontBar,
        rearBar,
        dims: d,
        headlightOrigin: new THREE.Vector3(0, frontBar.position.y, d.zFront + Lb.depth),
    };
}
