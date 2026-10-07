import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CONFIG, PALETTE } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT, PROPS, footprintsOverlap, type Footprint } from "../Layout";
import { labelsOwnedBy } from "../Paths";
import { NATURE_KINDS } from "../Assets";
import { registeredAreaIds } from "../Areas";
import * as shapes from "../utils/shapes";
import { Disposal } from "../utils/disposal";
import type { AreaContext, MaterialsApi, ModelName, TextApi, TextHandle, TextOpts } from "../types";
import { PROCEDURAL } from "../Scenery";
import { build } from "./Hub";

type TextCall = { opts: TextOpts & { angle?: number }; handle: TextHandle };

function stubCtx(
    model: (name: ModelName) => THREE.Object3D | null = () => null,
    fail: { labels?: boolean; collider?: boolean } = {}
) {
    const texts: TextCall[] = [];
    const bodies: { half: unknown; pos: unknown; body: object }[] = [];
    const removed: object[] = [];
    const lambert = vi.fn<(hex: string, o?: object) => THREE.MeshLambertMaterial>(() => new THREE.MeshLambertMaterial());
    const onPath = (o: TextOpts & { angle?: number }): TextHandle => {
        if (fail.labels && texts.length > 0) throw new Error("text failed");
        const handle = { object: new THREE.Group(), mesh: { visible: true }, dispose: vi.fn() } as unknown as TextHandle;
        texts.push({ opts: o, handle });
        return handle;
    };
    const notUsed = () => {
        throw new Error("the hub only draws path labels");
    };
    const ctx = {
        group: new THREE.Group(),
        physics: {
            addFixedCuboid: (half: unknown, pos: unknown) => {
                if (fail.collider) throw new Error("physics failed");
                const body = { id: bodies.length };
                bodies.push({ half, pos, body });
                return body;
            },
            removeBody: (b: object) => removed.push(b),
        },
        materials: { lambert, basic: () => new THREE.MeshBasicMaterial() } as unknown as MaterialsApi,
        shapes,
        text: { flat: notUsed, upright: notUsed, onPath } as unknown as TextApi,
        text3d: { word: notUsed },
        assets: { model: vi.fn(model) },
        audio: {},
        commands: {},
        disposal: new Disposal(),
        runtime: { carPos: new THREE.Vector3(), carSpeed: 0, reducedMotion: false, muted: true, isTouch: false },
        def: AREA_BY_ID.hub,
        layout: Layout,
        addInteractable: () => () => {},
    } as unknown as AreaContext;
    return { ctx, texts, bodies, removed, lambert };
}

const P = AREA_LAYOUT.hub.planter;

describe("areas/Hub (§2.4)", () => {
    it("registers itself as the hub builder", () => {
        expect(registeredAreaIds()).toContain("hub");
    });

    it("paper planter RoundedBox(6, 1, 6) at the hub centre with one fixed cuboid collider", () => {
        const { ctx, bodies, lambert } = stubCtx();
        const h = build(ctx);
        ctx.group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(h.planter);
        expect(b.min.x).toBeCloseTo(P.x - P.w / 2, 6);
        expect(b.max.x).toBeCloseTo(P.x + P.w / 2, 6);
        expect(b.min.y).toBeCloseTo(0, 6);
        expect(b.max.y).toBeCloseTo(P.h, 6);
        expect(b.min.z).toBeCloseTo(P.z - P.d / 2, 6);
        expect(b.max.z).toBeCloseTo(P.z + P.d / 2, 6);
        expect(h.planter.castShadow).toBe(true);
        expect(h.planter.receiveShadow).toBe(true);
        expect(lambert).toHaveBeenCalledWith(PALETTE.paper);
        expect(bodies).toHaveLength(1);
        expect(bodies[0].half).toEqual({ x: P.w / 2, y: P.h / 2, z: P.d / 2 });
        expect(bodies[0].pos).toEqual({ x: P.x, y: P.h / 2, z: P.z });
        expect(h.collider).toBe(bodies[0].body);
    });

    it("the planter is the hub-planter prop of the Layout (centred in the hub rect)", () => {
        const prop = PROPS.find((p) => p.id === "hub-planter")!;
        expect(prop.footprint.x).toBe(P.x);
        expect(prop.footprint.z).toBe(P.z);
        const r = AREA_BY_ID.hub.rect;
        expect([P.x, P.z]).toEqual([r.x, r.z]);
    });

    it("falls back to Scenery's procedural tree (occluder Lamberts, 4.9 tall) standing on the planter top", () => {
        const { ctx, lambert } = stubCtx(() => null);
        const h = build(ctx);
        expect(h.treeSource).toBe("procedural");
        expect(h.tree.parent).toBe(ctx.group);
        expect(h.tree.position.toArray()).toEqual([P.x, P.h, P.z]);
        ctx.group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(h.tree);
        expect(b.min.y).toBeCloseTo(P.h, 6);
        expect(b.max.y).toBeCloseTo(P.h + PROCEDURAL.crown.y + PROCEDURAL.crown.radius, 6);
        // Within the Layout's clearance height for the planter + tree.
        expect(b.max.y).toBeLessThanOrEqual(P.treeTop);
        expect(lambert).toHaveBeenCalledWith(PALETTE.trunk, expect.objectContaining({ occluder: true }));
        expect(lambert).toHaveBeenCalledWith(PALETTE.foliage, expect.objectContaining({ occluder: true }));
        let casters = 0;
        h.tree.traverse((o) => {
            if ((o as THREE.Mesh).isMesh && o.castShadow && o.receiveShadow) casters++;
        });
        expect(casters).toBe(2);
    });

    it("the procedural tree's geometries are freed with the area; a kit clone's never are", () => {
        const { ctx } = stubCtx(() => null);
        const h = build(ctx);
        const spies: ReturnType<typeof vi.spyOn>[] = [];
        h.tree.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) spies.push(vi.spyOn((o as THREE.Mesh).geometry, "dispose"));
        });
        expect(spies).toHaveLength(2);
        h.dispose!();
        for (const s of spies) expect(s).toHaveBeenCalledTimes(1);

        const kitGeo = new THREE.BoxGeometry();
        const kit = new THREE.Group().add(new THREE.Mesh(kitGeo));
        const kitDispose = vi.spyOn(kitGeo, "dispose");
        const k = build(stubCtx(() => kit).ctx);
        k.dispose!();
        if (k.treeSource === "kit") expect(kitDispose).not.toHaveBeenCalled();
    });

    it("uses the Nature Kit tree when the source is the kit and the model is loaded", () => {
        const kit = new THREE.Group();
        const { ctx } = stubCtx(() => kit);
        const h = build(ctx);
        if (CONFIG.scenery.source === "kit") {
            expect(ctx.assets.model).toHaveBeenCalledWith(`nature/${NATURE_KINDS.tree[0]}`);
            expect(h.treeSource).toBe("kit");
            expect(h.tree).toBe(kit);
            expect(kit.position.toArray()).toEqual([P.x, P.h, P.z]);
        } else {
            expect(h.treeSource).toBe("procedural");
        }
    });

    it("plaza plate covers the hub rect on the plaza layer", () => {
        const { ctx } = stubCtx();
        build(ctx);
        const plaza = ctx.group.getObjectByName("hub-plaza") as THREE.Mesh;
        ctx.group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(plaza);
        const r = AREA_BY_ID.hub.rect;
        expect(b.min.x).toBeCloseTo(r.x - r.w / 2, 6);
        expect(b.max.x).toBeCloseTo(r.x + r.w / 2, 6);
        expect(b.min.z).toBeCloseTo(r.z - r.d / 2, 6);
        expect(b.max.z).toBeCloseTo(r.z + r.d / 2, 6);
        expect(b.max.y).toBeCloseTo(shapes.LAYERS.plaza.y, 6);
    });

    it("draws the four spoke labels, each 6 outside the hub edge, never under the planter", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        expect(texts.map((t) => t.opts.text).sort()).toEqual(
            ["JOURNEY · EKO · MUSIC", "PLAYGROUND", "PROJECTS", "START"].sort()
        );
        expect(h.pathLabels).toHaveLength(4);
        const want = labelsOwnedBy("hub");
        const r = AREA_BY_ID.hub.rect;
        const T = CONFIG.type.pathLabel;
        for (const t of texts) {
            const p = want.find((w) => w.text === t.opts.text)!;
            const o = t.handle.object;
            expect(o.parent).toBe(ctx.group);
            expect(o.position.x).toBeCloseTo(p.x, 9);
            expect(o.position.z).toBeCloseTo(p.z, 9);
            expect(t.opts.angle).toBeCloseTo(p.angle, 12);
            expect(t.opts).toMatchObject({ font: T.font, size: T.size, letterSpacing: T.letterSpacing, color: PALETTE.ink });
            // Along its spoke the label centre sits labelOutsideEdge (6) beyond the hub
            // rect; P4's sits at d 4.5 (Step 0 deviation, DECISIONS.md).
            const alongX = Math.abs(p.x - r.x) - r.w / 2;
            const alongZ = Math.abs(p.z - r.z) - r.d / 2;
            const p4 = Layout.PATHS.find((q) => q.id === "P4")!.labels[0];
            const outside = p.text === p4.text ? p4.d : AREA_LAYOUT.hub.labelOutsideEdge;
            expect(Math.max(alongX, alongZ)).toBeCloseTo(outside, 9);
            // Never under the planter (its sun-side shadow would also fall on the text).
            const f: Footprint = {
                x: p.x,
                z: p.z,
                hu: Layout.estimateTextWidth(p.text, T.size, T.letterSpacing) / 2,
                hv: T.size / 2,
                rot: p.angle,
            };
            const planter = PROPS.find((q) => q.id === "hub-planter")!.footprint;
            expect(footprintsOverlap(f, planter)).toBe(false);
        }
    });

    it("dispose removes the collider and the labels once", () => {
        const { ctx, texts, bodies, removed } = stubCtx();
        const h = build(ctx);
        h.dispose!();
        h.dispose!();
        expect(removed).toEqual([bodies[0].body]);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
    });

    it("a builder that throws leaves no collider, frees what it built, and rethrows", () => {
        // A label throws: the collider (created last) never exists.
        const a = stubCtx(() => null, { labels: true });
        expect(() => build(a.ctx)).toThrow("text failed");
        expect(a.bodies).toHaveLength(0);
        expect(a.texts).toHaveLength(1);
        expect(a.texts[0].handle.dispose).toHaveBeenCalledTimes(1);
        expect(a.ctx.group.children).toHaveLength(0);

        // The collider itself throws: every label is freed, nothing is left behind.
        const b = stubCtx(() => null, { collider: true });
        expect(() => build(b.ctx)).toThrow("physics failed");
        expect(b.texts).toHaveLength(4);
        for (const t of b.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(b.removed).toHaveLength(0);
        expect(b.ctx.group.children).toHaveLength(0);
    });
});
