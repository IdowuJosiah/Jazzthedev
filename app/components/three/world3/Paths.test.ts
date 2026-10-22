import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CONFIG, PALETTE, SCREEN_DOWN } from "./Config";
import {
    PATHS,
    TILE,
    estimateTextWidth,
    footprintsOverlap,
    pathLabelPlacement,
    pathTiles,
    tileFootprint,
    type Footprint,
} from "./Layout";
import { build, buildOwnedPathLabels, labelOwner, labelsOwnedBy, tileGeometry } from "./Paths";
import { LAYERS } from "./utils/shapes";
import type { MaterialsApi, TextApi, TextHandle, TextOpts } from "./types";

type OnPathCall = TextOpts & { angle: number };

function stubDeps() {
    const calls: OnPathCall[] = [];
    const handles: (TextHandle & { dispose: ReturnType<typeof vi.fn> })[] = [];
    const make = (o: OnPathCall) => {
        calls.push(o);
        const object = new THREE.Group();
        object.rotation.y = o.angle;
        const h = { object, mesh: { visible: true }, setText() {}, setColor() {}, dispose: vi.fn() };
        handles.push(h as unknown as TextHandle & { dispose: ReturnType<typeof vi.fn> });
        return h as unknown as TextHandle;
    };
    const lambert = vi.fn(() => new THREE.MeshLambertMaterial());
    const deps = {
        materials: { lambert, basic: () => new THREE.MeshBasicMaterial() } as unknown as MaterialsApi,
        text: {
            flat: () => {
                throw new Error("path labels use onPath");
            },
            upright: () => {
                throw new Error("path labels use onPath");
            },
            onPath: make,
        } as unknown as TextApi,
    };
    return { deps, calls, handles, lambert };
}

const allTiles = () => PATHS.flatMap((p) => pathTiles(p));
const totalLabels = PATHS.reduce((n, p) => n + p.labels.length, 0);
const T = CONFIG.type.pathLabel;
/** Instance matrices are Float32: ~7 significant digits at coordinates up to 152. */
const F32_DIGITS = 4;
/** §9.2: triangles in view ≤ 350k. */
const IN_VIEW_TRIANGLE_BUDGET = 350_000;
/** The one world-spanning tile mesh may take at most this share of it. */
const TILE_BUDGET_SHARE = 0.1;
/** Unbevelled roundedSlab with four segments per corner. */
const TILE_SLAB_MAX_TRIANGLES = 76;

/** A label's ground footprint from the conservative Layout width estimate. */
const labelFootprint = (o: OnPathCall, x: number, z: number): Footprint => ({
    x,
    z,
    hu: estimateTextWidth(o.text, o.size, o.letterSpacing ?? 0) / 2,
    hv: o.size / 2,
    rot: o.angle,
});

describe("Paths (§2.5)", () => {
    it("draws every tile of every path in ONE InstancedMesh at the Layout placements", () => {
        const { deps, lambert } = stubDeps();
        const h = build(deps);
        const tiles = allTiles();
        expect(h.tiles).toBeInstanceOf(THREE.InstancedMesh);
        expect(h.tiles.count).toBe(tiles.length);
        expect(h.group.children.filter((c) => c instanceof THREE.InstancedMesh)).toHaveLength(1);
        expect(lambert).toHaveBeenCalledWith(PALETTE.path);

        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        const e = new THREE.Euler();
        tiles.forEach((t, i) => {
            h.tiles.getMatrixAt(i, m);
            m.decompose(p, q, s);
            expect(p.x).toBeCloseTo(t.x, F32_DIGITS);
            expect(p.y).toBeCloseTo(CONFIG.text.layers.tileBottom, F32_DIGITS);
            expect(p.z).toBeCloseTo(t.z, F32_DIGITS);
            e.setFromQuaternion(q, "YXZ");
            expect(Math.cos(e.y)).toBeCloseTo(Math.cos(t.yaw), F32_DIGITS);
            expect(Math.sin(e.y)).toBeCloseTo(Math.sin(t.yaw), F32_DIGITS);
        });
        h.dispose();
    });

    it("tile counts per path follow the 1.1 / 2.2 stepping rule (× lanes)", () => {
        for (const p of PATHS) {
            const L = Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z);
            const rows = Math.floor((L - 2 * TILE.firstOffset) / TILE.step) + 1;
            expect(pathTiles(p)).toHaveLength(rows * p.width);
        }
    });

    it("tiles are solid slabs from y 0 to 0.08, 1.6 square, receiving (never casting) shadows", () => {
        const g = tileGeometry();
        g.computeBoundingBox();
        const b = g.boundingBox!;
        expect(b.min.y).toBeCloseTo(CONFIG.text.layers.tileBottom, 6);
        expect(b.max.y).toBeCloseTo(CONFIG.text.layers.tileTop, 6);
        expect(b.max.x - b.min.x).toBeCloseTo(TILE.size, 6);
        expect(b.max.z - b.min.z).toBeCloseTo(TILE.size, 6);
        g.dispose();
        const { deps } = stubDeps();
        const h = build(deps);
        expect(h.tiles.receiveShadow).toBe(true);
        expect(h.tiles.castShadow).toBe(false);
        expect(LAYERS.tile.y).toBeCloseTo(TILE.height, 6);
        h.dispose();
    });

    it("the never-culled tile mesh stays a small share of the §9.2 in-view triangle budget", () => {
        const g = tileGeometry();
        const perTile = (g.index ? g.index.count : g.attributes.position.count) / 3;
        g.dispose();
        const total = perTile * allTiles().length;
        // The bevelled default was 236 a tile (~100k for every tile).
        expect(perTile).toBeLessThanOrEqual(TILE_SLAB_MAX_TRIANGLES);
        expect(total / IN_VIEW_TRIANGLE_BUDGET).toBeLessThan(TILE_BUDGET_SHARE);
    });

    it("label ownership: Welcome 2, Hub 4 (6 outside the hub edge), P5/P6 unowned", () => {
        expect(labelsOwnedBy("welcome").map((l) => l.text).sort()).toEqual(["ABOUT & CONTACT", "CROSSROADS"]);
        expect(labelsOwnedBy("hub").map((l) => l.text).sort()).toEqual(
            ["JOURNEY · EKO · MUSIC", "PLAYGROUND", "PROJECTS", "START"].sort()
        );
        expect(labelsOwnedBy(null).map((l) => l.text).sort()).toEqual(["EKO", "MUSIC"]);
        const p1 = PATHS.find((p) => p.id === "P1")!;
        expect(labelOwner(p1, p1.labels[0])).toBe("welcome");
        expect(labelOwner(p1, p1.labels[1])).toBe("hub");
    });

    it("builds all 8 labels by default and skips the labels of areas that draw their own", () => {
        const all = stubDeps();
        const h = build(all.deps);
        expect(h.labels).toHaveLength(totalLabels);
        expect(totalLabels).toBe(8);
        h.dispose();

        const some = stubDeps();
        const h2 = build(some.deps, { skipOwners: ["welcome", "hub"] });
        expect(some.calls.map((c) => c.text).sort()).toEqual(["EKO", "MUSIC"]);
        // Areas + Paths together draw every label exactly once.
        const owned = stubDeps();
        const areaLabels = [
            ...buildOwnedPathLabels(owned.deps.text, "welcome"),
            ...buildOwnedPathLabels(owned.deps.text, "hub"),
        ];
        expect(areaLabels.length + h2.labels.length).toBe(totalLabels);
        h2.dispose();
    });

    it("labels: Inter Bold 1.0, spacing 0.12, ink, at pathLabelPlacement (camera side, along the tangent)", () => {
        const { deps, calls, handles } = stubDeps();
        const h = build(deps);
        let i = 0;
        for (const p of PATHS) {
            for (const l of p.labels) {
                const want = pathLabelPlacement(p, l);
                const c = calls[i];
                const obj = handles[i].object;
                expect(c.text).toBe(l.text);
                expect(c.font).toBe(T.font);
                expect(c.size).toBe(T.size);
                expect(c.letterSpacing).toBe(T.letterSpacing);
                expect(c.color).toBe(PALETTE.ink);
                expect(c.angle).toBeCloseTo(want.angle, 9);
                expect(obj.position.x).toBeCloseTo(want.x, 9);
                expect(obj.position.y).toBe(0); // layer height lives on the inner mesh
                expect(obj.position.z).toBeCloseTo(want.z, 9);
                expect(obj.parent).toBe(h.group);
                // Camera side: the offset from the path points along +S.
                const t = { x: p.to.x - p.from.x, z: p.to.z - p.from.z };
                const len = Math.hypot(t.x, t.z);
                const base = { x: p.from.x + (t.x / len) * l.d, z: p.from.z + (t.z / len) * l.d };
                expect((want.x - base.x) * SCREEN_DOWN.x + (want.z - base.z) * SCREEN_DOWN.z).toBeGreaterThan(0);
                i++;
            }
        }
        h.dispose();
    });

    it("no label ever lies on a tile (labels sit beside the path)", () => {
        const { deps, calls, handles } = stubDeps();
        const h = build(deps);
        const tiles = allTiles().map(tileFootprint);
        calls.forEach((c, i) => {
            const o = handles[i].object.position;
            const f = labelFootprint(c, o.x, o.z);
            for (const t of tiles) expect(footprintsOverlap(f, t)).toBe(false);
        });
        h.dispose();
    });

    it("a label that throws frees the labels (and tiles) built before it, then rethrows", () => {
        const { deps, handles } = stubDeps();
        const onPath = deps.text.onPath;
        deps.text.onPath = (o) => {
            if (handles.length > 0) throw new Error("text failed");
            return onPath(o);
        };
        expect(() => buildOwnedPathLabels(deps.text, "hub")).toThrow("text failed");
        expect(handles).toHaveLength(1);
        expect(handles[0].dispose).toHaveBeenCalledTimes(1);

        handles.length = 0;
        const geoDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
        expect(() => build(deps)).toThrow("text failed");
        expect(handles[0].dispose).toHaveBeenCalledTimes(1);
        expect(geoDispose).toHaveBeenCalled(); // the tile slab
        geoDispose.mockRestore();
    });

    it("dispose frees the tile slab and every label, and detaches the group", () => {
        const { deps, handles } = stubDeps();
        const parent = new THREE.Group();
        const h = build(deps);
        parent.add(h.group);
        const geoDispose = vi.spyOn(h.tiles.geometry, "dispose");
        h.dispose();
        h.dispose(); // idempotent
        expect(geoDispose).toHaveBeenCalledTimes(1);
        for (const l of handles) expect(l.dispose).toHaveBeenCalledTimes(1);
        expect(h.group.parent).toBeNull();
    });
});
