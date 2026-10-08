import * as THREE from "three";
import { CONFIG, PALETTE, type HexColor, type Vec3Like } from "../Config";
import type { MaterialsApi } from "../types";
import type { Disposal } from "../utils/disposal";

// ─────────────────────────────────────────────────────────────────────────
// Procedural red Cybertruck-STYLE truck (owner decision; no logos, no text).
//
// The body is one convex, planar solid built as a non-indexed BufferGeometry
// with flat normals:
//   - side profile (z forward, y up): a low front nose, ONE straight line up to
//     a roof apex a little forward of mid-length, ONE straight line down to the
//     tailgate top, vertical front / rear faces, small lower chamfers and a flat
//     underside;
//   - cross-section: flat vertical sides up to the beltline crease (the nose
//     top), then a tumblehome plane that leans in so the glass section is ~80 %
//     of the body width at the apex. Above the belt the half width is linear in
//     y alone, so each upper side is ONE plane and every face stays planar.
// Dark glass panels sit just proud of the body faces and wrap the cabin
// (windshield, side windows, rear glass). Black trapezoid arch flares, chunky
// tyres with flat aero hubcaps, and two unlit light bars complete it.
//
// Units: CHASSIS space (Vehicle.chassis), so the body length equals the physics
// chassis length and the wheels sit on the physics wheel connection points
// (x = ±chassisHalf.x, z = ±(chassisHalf.z − insetZ)) with the physics radius.
// Heights are measured from the ground at rest (`groundY` = −REST_HEIGHT).
// The physics chassis is shorter than a real truck relative to its track and
// wheel size, so heights follow the wheels (a chunky "toy" Cybertruck) rather
// than the 5.9 : 2.2 : 1.8 ratio of the real one.
// ─────────────────────────────────────────────────────────────────────────

const V = CONFIG.vehicle;

/**
 * Body red. Owner decision: a RED Cybertruck. Not in PALETTE yet (Config.ts
 * belongs to the integrator): move it to `PALETTE.cyberRed` and alias it here.
 */
export const CYBER_RED: HexColor = "#D23B2E";

/** Truck colours (Lambert, flat) and light-bar colours (unlit basic). */
export const TRUCK_COLORS = Object.freeze({
    body: CYBER_RED,
    /** Dark tinted glass band around the cabin. */
    glass: "#2E2C35",
    /** Wheel-arch flares. */
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

/** Body shape: heights above the ground, z positions as fractions of the half length. */
export const TRUCK_SHAPE = Object.freeze({
    /** Flat underside height (≈ the wheel centre, like the real truck's clearance). */
    underside: 0.4,
    /** Nose top = beltline crease: above the tyre tops so the flares fit below it. */
    belt: 1.0,
    /** Roof apex height, and its z (+ = forward of mid-length). */
    apex: 1.6,
    apexZ: 0.1,
    /** Tailgate top height. */
    tail: 1.06,
    /** Front face bottom, and the lower front chamfer's depth along z. */
    noseLow: 0.58,
    frontChamfer: 0.14,
    /** Rear face bottom, and the lower rear chamfer's depth along z. */
    tailLow: 0.5,
    rearChamfer: 0.08,
    /** Glass-section half width at the apex, as a fraction of the body half width. */
    upperWidth: 0.8,
});

/** Glass band (fractions along the roof lines; distances in units). */
export const TRUCK_GLASS = Object.freeze({
    /** Panels float this far off the body faces (no z-fighting at camera distance). */
    offset: 0.012,
    /** Windshield from / to, along nose → apex; pillar inset from each side edge. */
    windshield: { from: 0.42, to: 0.96 },
    pillar: 0.06,
    /** Rear glass starts this far along apex → tail and ends at the cabin's rear. */
    rearFrom: 0.05,
    /** The cabin ends this fraction of the body length ahead of the tail (the bed behind). */
    cabinRear: 0.33,
    /** Side windows: inset above the belt and below the roof line. */
    sideBelt: 0.06,
    sideRoof: 0.05,
});

/** Trapezoid wheel-arch flares. */
export const TRUCK_FLARE = Object.freeze({
    /** Clearance between the tyre and the arch's inner bottom corners. */
    gap: 0.03,
    /** Inner top half width (the trapezoid's flat top), as a fraction of the wheel radius. */
    topHalfWidth: 0.8,
    /** Band width of the legs (along z) and of the top (along y). */
    band: 0.1,
    /** Outer top sits this far under the belt crease. */
    topMargin: 0.015,
    /** Stands this far proud of the body side, and sinks this far into it. */
    out: 0.2,
    embed: 0.02,
    /** Hangs this far below the underside. */
    drop: 0.02,
    /** Legs stay this far inside the body ends. */
    endMargin: 0.005,
});

/** Wheels: physics radius; chunky width; flat aero hubcap with one dark vane (shows the spin). */
export const TRUCK_WHEEL = Object.freeze({
    width: 0.38,
    segments: 16,
    hubRadius: 0.66,
    hubThickness: 0.03,
    /** Hubcap face stands this far outside the tyre's side wall. */
    hubProud: 0.02,
    vane: { thickness: 0.012, length: 1.0, width: 0.07 },
});

/** Light bars: full width less an inset; thin. */
export const TRUCK_LIGHTS = Object.freeze({
    inset: 0.04,
    depth: 0.02,
    front: { height: 0.05, below: 0.045 },
    rear: { height: 0.07, below: 0.06 },
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
    const centres: Vec3Like[] = [
        { x: cx, y: cy, z: cz },
        { x: -cx, y: cy, z: cz },
        { x: cx, y: cy, z: -cz },
        { x: -cx, y: cy, z: -cz },
    ].map((c) => Object.freeze(c));
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
        wheel: { radius: V.wheelRadius, width: TRUCK_WHEEL.width, centres: Object.freeze(centres) },
    };
}

/** Half width at height y: flat sides up to the belt, then the tumblehome plane. */
export function halfWidthAt(d: TruckDims, y: number): number {
    return y <= d.yBelt ? d.halfWidth : d.halfWidth - d.tumble * (y - d.yBelt);
}

/**
 * The side profile, in order around the outline: front bottom chamfer, front
 * face, nose top, apex, tailgate top, rear face, rear chamfer (the last edge
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
type Polygon = THREE.Vector3[];

/** Newell normal of a planar polygon (unnormalised winding direction). */
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

const centroid = (poly: Polygon) => poly.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(poly.length);

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
    const out = n.dot(centroid(poly).sub(interior)) < 0;
    return { poly: out ? [...poly].reverse() : poly, normal: (out ? n.negate() : n).normalize() };
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

/** A point inside the (convex) body: the average of its outline. */
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
    const wsFront = along(nose, apex, G.windshield.from);
    panels.push(strip(wsFront, along(nose, apex, G.windshield.to)));
    const rearTo = (d.zApex - d.zCabinRear) / (d.zApex - d.zRear);
    panels.push(strip(along(apex, tail, G.rearFrom), along(apex, tail, rearTo)));

    const bottom = d.yBelt + G.sideBelt;
    const window: ProfilePoint[] = [
        { z: wsFront.z, y: bottom },
        { z: wsFront.z, y: roofY(d, wsFront.z) - G.sideRoof },
        { z: d.zApex, y: d.yApex - G.sideRoof },
        { z: d.zCabinRear, y: roofY(d, d.zCabinRear) - G.sideRoof },
        { z: d.zCabinRear, y: bottom },
    ];
    for (const s of [1, -1]) panels.push(window.map((p) => sidePoint(d, p, s)));
    return polygonsToGeometry(
        panels.map((p) => offsetOutward(p, interior, G.offset)),
        interior
    );
}

/** The ∩-shaped flare outline (local z = shape x, around the wheel centre; y = shape y). */
export function flareOutline(d: TruckDims): { outer: ProfilePoint[]; inner: ProfilePoint[] } {
    const F = TRUCK_FLARE;
    const r = d.wheel.radius;
    const wheelY = d.wheel.centres[0].y;
    const zc = d.wheel.centres[0].z;
    // Front and rear arches share one shape, so it fits the shorter overhang.
    const reach = Math.min(d.zFront - zc, zc + d.zRear * -1 - 2 * zc * 0 - zc) - F.endMargin;
    const yLow = d.yUnder - F.drop;
    const yTopOut = d.yBelt - F.topMargin;
    const yTopIn = yTopOut - F.band;
    const aIn = r + F.gap;
    const bIn = r * F.topHalfWidth;
    const aOut = Math.min(aIn + F.band, reach);
    const bOut = bIn + F.band;
    // Stays relative to the wheel centre height so the band clears the tyre.
    void wheelY;
    return {
        outer: [
            { z: aOut, y: yLow },
            { z: bOut, y: yTopOut },
            { z: -bOut, y: yTopOut },
            { z: -aOut, y: yLow },
        ],
        inner: [
            { z: -aIn, y: yLow },
            { z: -bIn, y: yTopIn },
            { z: bIn, y: yTopIn },
            { z: aIn, y: yLow },
        ],
    };
}

/** One side's flare (s = +1 left, −1 right), extruded along x and centred on z = 0. */
export function buildFlareGeometry(d: TruckDims, s: number): THREE.BufferGeometry {
    const F = TRUCK_FLARE;
    const { outer, inner } = flareOutline(d);
    const shape = new THREE.Shape();
    [...outer, ...inner].forEach((p, i) => (i === 0 ? shape.moveTo(p.z, p.y) : shape.lineTo(p.z, p.y)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: F.out + F.embed, bevelEnabled: false });
    // −90° about Y maps the shape's +X to +Z (forward) and the extrusion to −X.
    geo.rotateY(-Math.PI / 2);
    geo.translate(s > 0 ? d.halfWidth + F.out : -(d.halfWidth - F.embed), 0, 0);
    // ExtrudeGeometry is non-indexed; recompute so every face normal is flat after the rotation.
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
}

export interface Cybertruck {
    /** Add to the chassis group. Holds every truck mesh. */
    root: THREE.Group;
    body: THREE.Mesh;
    glass: THREE.Mesh;
    /** FL, FR, RL, RR groups (rotation.order YXZ: steer about Y, then roll about X). */
    wheels: THREE.Group[];
    frontBar: THREE.Mesh;
    rearBar: THREE.Mesh;
    dims: TruckDims;
    /** Centre of the front light bar (headlight origin), chassis space. */
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
 * materials come from the shared palette cache. No mesh casts a real shadow
 * (the blob is the car's shadow, §1.5).
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
    root.add(body, glass);

    // Flares: one geometry per side, one mesh per wheel.
    const flareGeo = [track(buildFlareGeometry(d, 1)), track(buildFlareGeometry(d, -1))];
    for (const c of d.wheel.centres) {
        const flare = new THREE.Mesh(flareGeo[c.x > 0 ? 0 : 1], flat(TRUCK_COLORS.flare));
        flare.name = "cybertruck-flare";
        flare.position.z = c.z;
        root.add(flare);
    }

    // Wheels: tyre + hubcap disc + one dark vane so the roll reads.
    const W = TRUCK_WHEEL;
    const r = d.wheel.radius;
    const tyreGeo = track(new THREE.CylinderGeometry(r, r, W.width, W.segments));
    tyreGeo.rotateZ(Math.PI / 2);
    const hubR = r * W.hubRadius;
    const hubGeo = track(new THREE.CylinderGeometry(hubR, hubR, W.hubThickness, W.segments));
    hubGeo.rotateZ(Math.PI / 2);
    const vaneGeo = track(new THREE.BoxGeometry(W.vane.thickness, r * W.vane.length, W.vane.width));
    const hubX = W.width / 2 + W.hubProud - W.hubThickness / 2;
    const vaneX = W.width / 2 + W.hubProud + W.vane.thickness / 2;
    const wheels = d.wheel.centres.map((c, i) => {
        const s = Math.sign(c.x);
        const w = new THREE.Group();
        w.name = WHEEL_NAMES[i];
        w.rotation.order = "YXZ";
        w.position.set(c.x, c.y, c.z);
        const tyre = new THREE.Mesh(tyreGeo, flat(TRUCK_COLORS.tyre));
        const hub = new THREE.Mesh(hubGeo, flat(TRUCK_COLORS.hub));
        hub.position.x = s * hubX;
        const vane = new THREE.Mesh(vaneGeo, flat(TRUCK_COLORS.tyre));
        vane.position.x = s * vaneX;
        w.add(tyre, hub, vane);
        root.add(w);
        return w;
    });

    // Light bars (unlit): full width less an inset, on the nose top / tailgate edges.
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
    rearBar.position.set(0, d.yBelt - Lb.rear.below, d.zRear - Lb.depth / 2);
    root.add(frontBar, rearBar);

    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.receiveShadow = !(mesh.material instanceof THREE.MeshBasicMaterial);
    });

    return {
        root,
        body,
        glass,
        wheels,
        frontBar,
        rearBar,
        dims: d,
        headlightOrigin: frontBar.position.clone(),
    };
}
