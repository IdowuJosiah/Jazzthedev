import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CONFIG } from "../Config";
import { Materials } from "../Materials";
import { Disposal } from "../utils/disposal";
import {
    bodyInterior,
    buildBodyGeometry,
    buildCybertruck,
    buildFlaresGeometry,
    buildGlassGeometry,
    buildTyreGeometry,
    CYBER_RED,
    cybertruckDims,
    cybertruckProfile,
    flareOutline,
    halfWidthAt,
    roofY,
    sideWindowOutline,
    TRUCK_COLORS,
    TRUCK_FLARE,
    TRUCK_GLASS,
    TRUCK_SHAPE,
    TRUCK_WHEEL,
    WHEEL_NAMES,
    type ProfilePoint,
} from "./Cybertruck";

const V = CONFIG.vehicle;
/** Any ground height works; this is the Vehicle's (−REST_HEIGHT ≈ −0.81). */
const GROUND = -0.806;
const d = cybertruckDims(GROUND);

/** Triangles of a non-indexed geometry with their stored normals. */
function triangles(geo: THREE.BufferGeometry) {
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const out: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let i = 0; i < pos.count; i += 3) {
        out.push({
            a: new THREE.Vector3().fromBufferAttribute(pos, i),
            b: new THREE.Vector3().fromBufferAttribute(pos, i + 1),
            c: new THREE.Vector3().fromBufferAttribute(pos, i + 2),
            n: new THREE.Vector3().fromBufferAttribute(nor, i),
        });
    }
    return out;
}

/** Non-indexed, finite, unit normals, flat per triangle and matching each triangle's winding. */
function expectFlatClean(geo: THREE.BufferGeometry) {
    expect(geo.index).toBeNull();
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    expect(pos.count % 3).toBe(0);
    expect(pos.count).toBeGreaterThan(0);
    for (const v of [...(pos.array as Float32Array), ...(nor.array as Float32Array)]) expect(Number.isFinite(v)).toBe(true);
    for (let i = 0; i < nor.count; i++) {
        expect(new THREE.Vector3().fromBufferAttribute(nor, i).length()).toBeCloseTo(1, 5);
    }
    for (const t of triangles(geo)) {
        const cross = new THREE.Vector3().subVectors(t.b, t.a).cross(new THREE.Vector3().subVectors(t.c, t.a));
        expect(cross.length()).toBeGreaterThan(1e-8); // no degenerate slivers
        expect(cross.normalize().dot(t.n)).toBeCloseTo(1, 4);
    }
    for (let i = 0; i < nor.count; i += 3) {
        const n0 = new THREE.Vector3().fromBufferAttribute(nor, i);
        expect(new THREE.Vector3().fromBufferAttribute(nor, i + 1).distanceTo(n0)).toBeLessThan(1e-6);
        expect(new THREE.Vector3().fromBufferAttribute(nor, i + 2).distanceTo(n0)).toBeLessThan(1e-6);
    }
}

/** Distance from point p to the infinite line through a, b (z/y plane). */
function lineDistance(p: ProfilePoint, a: ProfilePoint, b: ProfilePoint): number {
    const dz = b.z - a.z;
    const dy = b.y - a.y;
    return Math.abs((p.z - a.z) * dy - (p.y - a.y) * dz) / Math.hypot(dz, dy);
}

describe("Cybertruck dimensions and profile", () => {
    it("matches the physics chassis length / width and the wheel connection points / radius", () => {
        expect(d.zFront - d.zRear).toBeCloseTo(V.chassisHalf.z * 2, 9);
        expect(d.halfWidth).toBe(V.chassisHalf.x);
        expect(d.wheel.radius).toBe(V.wheelRadius);
        const cz = V.chassisHalf.z - V.wheelConnection.insetZ;
        expect(d.wheel.centres.map((c) => [c.x, c.z])).toEqual([
            [V.chassisHalf.x, cz],
            [-V.chassisHalf.x, cz],
            [V.chassisHalf.x, -cz],
            [-V.chassisHalf.x, -cz],
        ]);
        for (const c of d.wheel.centres) expect(c.y).toBeCloseTo(GROUND + V.wheelRadius, 9);
    });

    it("side profile: low nose, ONE line up to an apex a little forward of mid-length, ONE line down to the tailgate", () => {
        const ring = cybertruckProfile(d);
        const nose = ring.find((p) => p.z === d.zFront && p.y === d.yBelt)!;
        const apex = ring.find((p) => p.y === d.yApex)!;
        const tail = ring.find((p) => p.z === d.zRear && p.y === d.yTail)!;
        // Consecutive outline points: the roof is exactly two edges.
        const i = ring.indexOf(nose);
        expect(ring[i + 1]).toBe(apex);
        expect(ring[i + 2]).toBe(tail);
        expect(apex.z).toBeGreaterThan(0);
        expect(apex.z).toBeLessThan(d.halfLength * 0.3);
        expect(nose.y).toBeLessThan(tail.y);
        expect(tail.y).toBeLessThan(apex.y);
        expect(roofY(d, d.zFront)).toBeCloseTo(d.yBelt, 9);
        expect(roofY(d, d.zApex)).toBeCloseTo(d.yApex, 9);
        expect(roofY(d, d.zRear)).toBeCloseTo(d.yTail, 9);
        // The flat underside is the lowest edge.
        expect(Math.min(...ring.map((p) => p.y))).toBe(d.yUnder);
        expect(d.yUnder - GROUND).toBe(TRUCK_SHAPE.underside);
    });

    it("roughly real proportions: height between the real ratios to length and to width", () => {
        const L = d.zFront - d.zRear;
        const W = d.halfWidth * 2;
        const H = d.yApex - GROUND;
        // Real: L / H ≈ 3.3, W / H ≈ 1.2. The chassis is short for its width, so H sits between.
        expect(L / H).toBeGreaterThan(2);
        expect(L / H).toBeLessThan(3.3);
        expect(W / H).toBeGreaterThan(1.1);
        expect(W / H).toBeLessThan(1.6);
    });

    it("tumblehome: flat sides below the belt, glass section 80 % of the body width at the apex", () => {
        expect(halfWidthAt(d, d.yUnder)).toBe(d.halfWidth);
        expect(halfWidthAt(d, d.yBelt)).toBe(d.halfWidth);
        expect(halfWidthAt(d, d.yApex) / d.halfWidth).toBeCloseTo(TRUCK_SHAPE.upperWidth, 9);
        expect(halfWidthAt(d, (d.yBelt + d.yApex) / 2)).toBeLessThan(d.halfWidth);
    });

    it("the nose crease clears the tyre tops with room for the flare band", () => {
        const tyreTop = d.wheel.centres[0].y + d.wheel.radius;
        const { inner } = flareOutline(d);
        expect(inner[1].y).toBeGreaterThan(tyreTop);
        expect(d.yBelt).toBeGreaterThan(inner[1].y);
    });
});

describe("Cybertruck body geometry", () => {
    const geo = buildBodyGeometry(d);

    it("is a non-indexed, flat-shaded, NaN-free mesh with unit outward normals", () => {
        expectFlatClean(geo);
        const interior = bodyInterior(d);
        for (const t of triangles(geo)) {
            const c = t.a.clone().add(t.b).add(t.c).divideScalar(3);
            expect(t.n.dot(c.sub(interior))).toBeGreaterThan(0);
        }
    });

    it("bounding box = the chassis length × width, from the underside to the apex", () => {
        geo.computeBoundingBox();
        const b = geo.boundingBox!;
        expect(b.min.z).toBeCloseTo(-V.chassisHalf.z, 6);
        expect(b.max.z).toBeCloseTo(V.chassisHalf.z, 6);
        expect(b.min.x).toBeCloseTo(-V.chassisHalf.x, 6);
        expect(b.max.x).toBeCloseTo(V.chassisHalf.x, 6);
        expect(b.min.y).toBeCloseTo(d.yUnder, 6);
        expect(b.max.y).toBeCloseTo(d.yApex, 6);
    });

    it("is a closed solid: the area-weighted normals sum to zero and the volume is positive", () => {
        const sum = new THREE.Vector3();
        let volume = 0;
        for (const t of triangles(geo)) {
            const cross = new THREE.Vector3().subVectors(t.b, t.a).cross(new THREE.Vector3().subVectors(t.c, t.a));
            sum.add(cross);
            volume += t.a.dot(new THREE.Vector3().crossVectors(t.b, t.c)) / 6;
        }
        expect(sum.length()).toBeLessThan(1e-4);
        expect(volume).toBeGreaterThan(0);
        // Less than its bounding box, more than half of it (a chunky truck, not a sliver).
        const box = (d.zFront - d.zRear) * 2 * d.halfWidth * (d.yApex - d.yUnder);
        expect(volume).toBeLessThan(box);
        expect(volume).toBeGreaterThan(box * 0.5);
    });

    it("the flat underside faces straight down and the tumblehome planes lean in", () => {
        const normals = triangles(geo).map((t) => t.n);
        expect(normals.some((n) => n.y < -0.999)).toBe(true);
        const lean = normals.filter((n) => Math.abs(n.x) > 0.5 && n.y > 0.05);
        expect(lean.length).toBeGreaterThan(0);
        for (const n of lean) expect(n.y / Math.abs(n.x)).toBeCloseTo(d.tumble, 5);
    });
});

describe("Cybertruck glass and flares", () => {
    it("glass: flat, clean, outside the body faces by the offset, wrapping the cabin", () => {
        const geo = buildGlassGeometry(d);
        expectFlatClean(geo);
        const interior = bodyInterior(d);
        geo.computeBoundingBox();
        const b = geo.boundingBox!;
        // Windshield toward the nose, rear glass behind the apex, and nothing over the bed.
        expect(b.max.z).toBeGreaterThan(d.zApex + 0.5);
        expect(b.min.z).toBeGreaterThan(d.zCabinRear - TRUCK_GLASS.offset * 2);
        expect(b.max.y).toBeLessThan(d.yApex + TRUCK_GLASS.offset * 2);
        for (const t of triangles(geo)) {
            const c = t.a.clone().add(t.b).add(t.c).divideScalar(3);
            expect(t.n.dot(c.clone().sub(interior))).toBeGreaterThan(0);
        }
        // Panels facing ±x (side windows), up-forward (windshield) and up-back (rear glass).
        const n = triangles(geo).map((t) => t.n);
        expect(n.some((v) => v.x > 0.9)).toBe(true);
        expect(n.some((v) => v.x < -0.9)).toBe(true);
        expect(n.some((v) => v.y > 0.5 && v.z > 0.2)).toBe(true);
        expect(n.some((v) => v.y > 0.5 && v.z < -0.1)).toBe(true);
    });

    it("side window: convex, tip level with the windshield base, under the roof line", () => {
        const w = sideWindowOutline(d);
        expect(w[0].y).toBeCloseTo(w[3].y, 9); // level sill
        expect(w[2].y).toBeGreaterThan(w[3].y); // a real rear edge
        for (const p of w) expect(p.y).toBeLessThanOrEqual(roofY(d, p.z) - TRUCK_GLASS.sideRoof + 1e-9);
        expect(w[0].y).toBeGreaterThan(d.yBelt);
    });

    it("flares: flat, clean, one merged geometry around all four wheels", () => {
        const geo = buildFlaresGeometry(d);
        expectFlatClean(geo);
        geo.computeBoundingBox();
        const b = geo.boundingBox!;
        expect(b.max.x).toBeCloseTo(d.halfWidth + TRUCK_FLARE.out, 6);
        expect(b.min.x).toBeCloseTo(-(d.halfWidth + TRUCK_FLARE.out), 6);
        // Within the body ends, and covering the tyre's outer side from above.
        expect(b.max.z).toBeLessThanOrEqual(d.zFront);
        expect(b.min.z).toBeGreaterThanOrEqual(d.zRear);
        expect(d.halfWidth + TRUCK_FLARE.out).toBeGreaterThan(d.halfWidth + TRUCK_WHEEL.width / 2);
    });

    it("the tyre fits inside every arch edge (trapezoid opening clears the wheel)", () => {
        const { inner } = flareOutline(d);
        const c: ProfilePoint = { z: 0, y: d.wheel.centres[0].y };
        // Right leg, top, left leg (the bottom is open).
        for (let i = 0; i < 3; i++) {
            expect(lineDistance(c, inner[i], inner[i + 1])).toBeGreaterThan(d.wheel.radius);
        }
    });
});

describe("buildCybertruck", () => {
    const mats = new Materials();
    const disposal = new Disposal();
    const truck = buildCybertruck({ materials: mats, disposal, groundY: GROUND });
    const hex = (m: THREE.Mesh) => "#" + (m.material as THREE.MeshLambertMaterial).color.getHexString().toUpperCase();

    it("wheels: named FL, FR, RL, RR at the connection points, YXZ, physics radius, chunky", () => {
        expect(truck.wheels.map((w) => w.name)).toEqual([...WHEEL_NAMES]);
        truck.wheels.forEach((w, i) => {
            const c = d.wheel.centres[i];
            expect(w.position.toArray()).toEqual([c.x, c.y, c.z]);
            expect(w.rotation.order).toBe("YXZ");
            const tyre = w.getObjectByName("cybertruck-tyre") as THREE.Mesh;
            tyre.geometry.computeBoundingBox();
            const tb = tyre.geometry.boundingBox!;
            expect(tb.max.y).toBeCloseTo(V.wheelRadius, 6);
            expect(tb.max.z).toBeCloseTo(V.wheelRadius, 2);
            // Hubcap + vane on the OUTER side (left wheels +x, right wheels −x).
            const hub = w.getObjectByName("cybertruck-hub") as THREE.Mesh;
            expect(Math.sign(hub.position.x)).toBe(Math.sign(c.x));
            expect(Math.sign(tb.max.x + tb.min.x)).toBe(Math.sign(c.x));
        });
        // Bottom of the tyres on the ground at rest.
        for (const c of d.wheel.centres) expect(c.y - V.wheelRadius).toBeCloseTo(GROUND, 9);
    });

    it("tyre geometry: radius r, axis along x, finite", () => {
        const g = buildTyreGeometry(V.wheelRadius, 1);
        const pos = g.getAttribute("position");
        for (const v of pos.array as Float32Array) expect(Number.isFinite(v)).toBe(true);
        g.computeBoundingBox();
        expect(g.boundingBox!.min.x).toBeCloseTo(-TRUCK_WHEEL.width / 2, 6);
    });

    it("palette materials: red body, dark glass, black flares, light hubcaps; unlit light bars", () => {
        expect(hex(truck.body)).toBe(CYBER_RED);
        expect(TRUCK_COLORS.body).toBe(CYBER_RED);
        expect(hex(truck.glass)).toBe(TRUCK_COLORS.glass.toUpperCase());
        expect(hex(truck.flares)).toBe(TRUCK_COLORS.flare.toUpperCase());
        for (const m of [truck.body, truck.glass, truck.flares]) {
            expect(m.material).toBeInstanceOf(THREE.MeshLambertMaterial);
            expect((m.material as THREE.MeshLambertMaterial).flatShading).toBe(true);
        }
        expect(truck.frontBar.material).toBeInstanceOf(THREE.MeshBasicMaterial);
        expect(truck.rearBar.material).toBeInstanceOf(THREE.MeshBasicMaterial);
        expect(hex(truck.frontBar)).toBe(TRUCK_COLORS.frontLight.toUpperCase());
        expect(hex(truck.rearBar)).toBe(TRUCK_COLORS.rearDim.toUpperCase());
    });

    it("light bars: thin, nearly full width, on the front face and the tailgate", () => {
        const box = (m: THREE.Mesh) => {
            m.geometry.computeBoundingBox();
            return m.geometry.boundingBox!.clone().translate(m.position);
        };
        const f = box(truck.frontBar);
        const r = box(truck.rearBar);
        expect(f.min.z).toBeCloseTo(d.zFront, 6);
        expect(r.max.z).toBeCloseTo(d.zRear, 6);
        for (const b of [f, r]) {
            expect(b.max.x - b.min.x).toBeGreaterThan(d.halfWidth * 1.8);
            expect(b.max.y - b.min.y).toBeLessThan(0.1);
        }
        // Front bar on the front face (below the crease); rear bar on the tailgate.
        expect(f.max.y).toBeLessThan(d.yBelt);
        expect(f.min.y).toBeGreaterThan(d.yNoseLow);
        expect(r.max.y).toBeLessThan(d.yTail);
        expect(r.min.y).toBeGreaterThan(d.yTailLow);
        // A dark trim frames the rear bar: behind it, on the tailgate, under its top edge, within the body width.
        const trimMesh = truck.root.getObjectByName("cybertruck-rear-trim") as THREE.Mesh;
        const t = box(trimMesh);
        expect(hex(trimMesh)).toBe(TRUCK_COLORS.flare.toUpperCase());
        expect(t.max.z).toBeCloseTo(d.zRear, 6);
        expect(t.min.z).toBeGreaterThan(r.min.z);
        expect(t.max.y).toBeGreaterThan(r.max.y);
        expect(t.min.y).toBeLessThan(r.min.y);
        expect(t.max.y).toBeLessThan(d.yTail);
        expect(t.max.x).toBeLessThan(d.halfWidth);
        // Headlight origin: centre of the front bar's face.
        expect(truck.headlightOrigin.z).toBeCloseTo(f.max.z, 6);
        expect(truck.headlightOrigin.y).toBeCloseTo(truck.frontBar.position.y, 9);
    });

    it("casts no real shadow; every geometry is tracked for disposal", () => {
        const geos = new Set<THREE.BufferGeometry>();
        truck.root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            expect(m.castShadow).toBe(false);
            geos.add(m.geometry);
        });
        const spies = [...geos].map((g) => {
            let called = false;
            g.addEventListener("dispose", () => (called = true));
            return () => called;
        });
        disposal.dispose();
        for (const called of spies) expect(called()).toBe(true);
    });

    it("has no text or logo meshes (only the named truck parts)", () => {
        const names = new Set<string>();
        truck.root.traverse((o) => names.add(o.name));
        for (const n of names) expect(n === "" || /^(cybertruck|wheel-)/.test(n)).toBe(true);
    });
});
