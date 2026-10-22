import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { musicPillars } from "@/app/field/content/world";
import { ACCENT, ACCENT_INK, CONFIG, FACE_CAMERA_Y, PALETTE, SCREEN_DOWN, SCREEN_RIGHT } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT, PADS, pointInRect } from "../Layout";
import { registeredAreaIds } from "../Areas";
import * as shapes from "../utils/shapes";
import { Disposal } from "../utils/disposal";
import type {
    AreaContext,
    MaterialsApi,
    RuntimeInfo,
    TextApi,
    TextHandle,
    TextOpts,
    Word3D,
    Word3DOptions,
    WorldInteractable,
} from "../types";
import { build, eqTargets, musicPillarContent } from "./Music";

const M = AREA_LAYOUT.music;
const TY = CONFIG.type;
const N = musicPillars.length;
const FACE_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
const STATIC = [1, 2, 3, 4, 3, 2, 3, 2, 1];

type TextCall = { kind: "flat" | "upright"; opts: TextOpts; handle: TextHandle };

function stubCtx(fail: { collider?: boolean; sleeveTitle?: number } = {}) {
    const texts: TextCall[] = [];
    const words: { text: string; opts: Word3DOptions; word: Word3D & { dispose: ReturnType<typeof vi.fn> } }[] = [];
    const bodies: { half: unknown; pos: unknown; quat: THREE.Quaternion; body: object }[] = [];
    const removed: object[] = [];
    const interactables: WorldInteractable[] = [];
    const unregistered: WorldInteractable[] = [];
    const lambert = vi.fn((hex: string) => Object.assign(new THREE.MeshLambertMaterial(), { name: hex }));
    const basic = vi.fn((hex: string) => Object.assign(new THREE.MeshBasicMaterial(), { name: hex }));
    const getBands = vi.fn<(n: number) => Float32Array | null>(() => null);
    let uprights = 0;

    const makeText =
        (kind: TextCall["kind"]) =>
        (o: TextOpts): TextHandle => {
            if (kind === "upright" && fail.sleeveTitle === uprights++) throw new Error("text failed");
            const handle = {
                object: new THREE.Group(),
                mesh: {},
                setText() {},
                setColor() {},
                dispose: vi.fn(),
            } as unknown as TextHandle;
            texts.push({ kind, opts: o, handle });
            return handle;
        };

    const runtime: RuntimeInfo = {
        carPos: new THREE.Vector3(),
        carSpeed: 0,
        reducedMotion: false,
        muted: true,
        isTouch: false,
    };
    const ctx = {
        group: new THREE.Group(),
        physics: {
            addFixedCuboid: (half: unknown, pos: unknown, quat: THREE.Quaternion) => {
                if (fail.collider) throw new Error("physics failed");
                const body = { id: bodies.length };
                bodies.push({ half, pos, quat, body });
                return body;
            },
            removeBody: (b: object) => removed.push(b),
        },
        materials: { lambert, basic } as unknown as MaterialsApi,
        shapes,
        text: { flat: makeText("flat"), upright: makeText("upright"), onPath: makeText("flat") } as unknown as TextApi,
        text3d: {
            word: (text: string, o: Word3DOptions) => {
                const word = { group: new THREE.Group(), letters: [], reset: vi.fn(), dispose: vi.fn() };
                words.push({ text, opts: o, word });
                return word;
            },
        },
        assets: { boards: { register: vi.fn(), request: vi.fn(), get: () => null, onLoaded: () => () => {} } },
        audio: { getBands, playImpact: vi.fn(), playUi: vi.fn() },
        commands: {},
        disposal: new Disposal(),
        runtime,
        def: AREA_BY_ID.music,
        layout: Layout,
        addInteractable: (i: WorldInteractable) => {
            interactables.push(i);
            return () => unregistered.push(i);
        },
    } as unknown as AreaContext;
    return { ctx, texts, words, bodies, removed, interactables, unregistered, lambert, getBands, runtime };
}

/** Screen-axis components (along R, along S) of b − a. */
const rs = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return { r: dx * SCREEN_RIGHT.x + dz * SCREEN_RIGHT.z, s: dx * SCREEN_DOWN.x + dz * SCREEN_DOWN.z };
};

const worldBox = (o: THREE.Object3D) => {
    o.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(o);
};

/** Per-instance (position, height) of the EQ bars. */
const bars = (eq: THREE.InstancedMesh) =>
    Array.from({ length: eq.count }, (_, i) => {
        const m = new THREE.Matrix4();
        eq.getMatrixAt(i, m);
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        m.decompose(p, q, s);
        return { p, q, h: s.y * M.eqBar.h };
    });

const C = M.centre;
const stageC = { x: M.stage.x, z: M.stage.z };

describe("areas/Music (§2.4, §5.2)", () => {
    it("registers itself as the music builder", () => {
        expect(registeredAreaIds()).toContain("music");
    });

    it("the static 3D title MUSIC in ACCENT_INK.music at its Layout point, faceCamera", () => {
        const s = stubCtx();
        const h = build(s.ctx);
        expect(s.words).toHaveLength(1);
        const { text, opts, word } = s.words[0];
        const t3 = AREA_BY_ID.music.title3D!;
        expect(text).toBe("MUSIC");
        expect(opts).toEqual({
            cap: TY.areaTitle.cap,
            depth: TY.areaTitle.depth,
            curveSegments: TY.areaTitle.curveSegments,
            color: ACCENT_INK.music,
            dynamic: false,
        });
        expect(word.group.parent).toBe(s.ctx.group);
        expect(word.group.position.toArray()).toEqual([t3.x, 0, t3.z]);
        expect(word.group.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(h.title).toBe(word);
    });

    it("the ink stage (18 along R × 1 × 8 along S) at C − S·5, faceCamera, with one fixed collider", () => {
        const s = stubCtx();
        const h = build(s.ctx);
        const d = rs(C, stageC);
        expect(d.r).toBeCloseTo(0, 9);
        expect(d.s).toBeCloseTo(-5, 9);
        expect((h.stage.material as THREE.Material).name).toBe(PALETTE.ink);
        expect(h.stage.position.toArray()).toEqual([stageC.x, M.stage.h / 2, stageC.z]);
        expect(h.stage.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(h.stage.castShadow && h.stage.receiveShadow).toBe(true);
        const g = h.stage.geometry;
        g.computeBoundingBox();
        expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(M.stage.w, 6);
        expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(M.stage.h, 6);
        expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(M.stage.d, 6);
        const body = s.bodies[0];
        expect(body.half).toEqual({ x: M.stage.w / 2, y: M.stage.h / 2, z: M.stage.d / 2 });
        expect(body.pos).toEqual({ x: stageC.x, y: M.stage.h / 2, z: stageC.z });
        expect(body.quat.angleTo(FACE_QUAT)).toBeCloseTo(0, 9);
    });

    describe("vinyl", () => {
        it("an ink disc r 3.2 lying on the stage top at stageC + S·0.5, with an ACCENT.music label r 1.1 on top", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const d = rs(stageC, h.vinyl.position);
            expect(d.r).toBeCloseTo(0, 9);
            expect(d.s).toBeCloseTo(0.5, 9);
            expect(h.vinyl.position.y).toBe(M.stage.h);
            const disc = h.vinyl.getObjectByName("vinyl-disc") as THREE.Mesh;
            const label = h.vinyl.getObjectByName("vinyl-label") as THREE.Mesh;
            const mark = h.vinyl.getObjectByName("vinyl-mark") as THREE.Mesh;
            expect((disc.material as THREE.Material).name).toBe(PALETTE.ink);
            expect((label.material as THREE.Material).name).toBe(ACCENT.music);
            const db = worldBox(disc);
            expect(db.min.y).toBeCloseTo(M.stage.h, 6);
            expect(db.max.y).toBeCloseTo(M.stage.h + M.vinyl.height, 6);
            expect(db.max.x - db.min.x).toBeCloseTo(2 * M.vinyl.radius, 6);
            const lb = worldBox(label);
            expect(lb.max.x - lb.min.x).toBeCloseTo(2 * M.vinyl.labelRadius, 6);
            // Stacked solids, never coplanar with the face below them.
            expect(lb.min.y).toBeCloseTo(db.max.y, 6);
            expect(lb.max.y).toBeGreaterThan(db.max.y);
            const mb = worldBox(mark);
            expect(mb.min.y).toBeCloseTo(lb.max.y, 6);
        });

        it("turns about Y at 0.6 rad/s, and stands still under reduced motion", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            expect(M.vinyl.spin).toBe(0.6);
            h.update!(0.5, 0, s.runtime);
            expect(h.vinyl.rotation.y).toBeCloseTo(0.3, 9);
            h.update!(0.5, 0, s.runtime);
            expect(h.vinyl.rotation.y).toBeCloseTo(0.6, 9);
            s.runtime.reducedMotion = true; // a live toggle (Menu / OS) reaches it
            h.update!(1, 0, s.runtime);
            expect(h.vinyl.rotation.y).toBeCloseTo(0.6, 9);
        });
    });

    it("two solid stone speakers on the stage top at stageC ± R·7 − S·1.5, with ink cones facing the camera", () => {
        const s = stubCtx();
        const h = build(s.ctx);
        expect(h.speakers).toHaveLength(2);
        h.speakers.forEach((sp, i) => {
            const d = rs(stageC, sp.position);
            expect(d.r).toBeCloseTo(i === 0 ? -7 : 7, 9);
            expect(d.s).toBeCloseTo(-1.5, 9);
            expect((sp.material as THREE.Material).name).toBe(PALETTE.stone);
            expect(sp.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
            const b = worldBox(sp);
            expect(b.min.y).toBeCloseTo(M.stage.h, 4);
            expect(b.max.y).toBeCloseTo(M.stage.h + M.speaker.h, 4);
            // Solid: one fixed collider per speaker (after the stage's), matching the box.
            const body = s.bodies[1 + i];
            expect(body.half).toEqual({ x: M.speaker.w / 2, y: M.speaker.h / 2, z: M.speaker.d / 2 });
            expect(body.pos).toEqual({ x: M.speakers[i].x, y: M.stage.h + M.speaker.h / 2, z: M.speakers[i].z });
            expect(body.quat.angleTo(FACE_QUAT)).toBeCloseTo(0, 9);
            const cones = sp.children as THREE.Mesh[];
            expect(cones.length).toBeGreaterThan(0);
            for (const c of cones) {
                expect((c.material as THREE.Material).name).toBe(PALETTE.ink);
                // On the front face (+Z local → S), within the box outline.
                expect(c.position.z).toBeCloseTo(M.speaker.d / 2, 9);
                expect(c.scale.x).toBeLessThan(M.speaker.w / 2);
                expect(Math.abs(c.position.y) + c.scale.y).toBeLessThan(M.speaker.h / 2);
            }
        });
    });

    describe("EQ bars", () => {
        it("nine ACCENT.music bars in ONE InstancedMesh on the stage top at stageC + R·(i − 4)·1.3 − S·3.3", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            expect(h.eq).toBeInstanceOf(THREE.InstancedMesh);
            expect(h.eq.count).toBe(9);
            expect((h.eq.material as THREE.Material).name).toBe(ACCENT.music);
            expect(h.eq.parent).toBe(s.ctx.group);
            bars(h.eq).forEach((b, i) => {
                const d = rs(stageC, { x: b.p.x, z: b.p.z });
                // Instance matrices are Float32: compare at single precision.
                expect(d.r).toBeCloseTo((i - 4) * 1.3, 4);
                expect(d.s).toBeCloseTo(-3.3, 4);
                expect(b.p.y).toBeCloseTo(M.stage.h, 6); // base on the stage top
                expect(b.q.angleTo(FACE_QUAT)).toBeCloseTo(0, 6);
            });
            // The unit bar's base sits at its origin, so scale.y is its height.
            const g = h.eq.geometry;
            g.computeBoundingBox();
            expect(g.boundingBox!.min.y).toBeCloseTo(0, 9);
            expect(g.boundingBox!.max.y).toBeCloseTo(M.eqBar.h, 9);
        });

        it("hold the static heights 1 2 3 4 3 2 3 2 1 while muted, without asking for bands", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            expect(M.eqStaticHeights).toEqual(STATIC);
            expect(bars(h.eq).map((b) => b.h)).toEqual(STATIC.map((v) => expect.closeTo(v, 9)));
            h.update!(0.016, 0, s.runtime);
            expect(s.getBands).not.toHaveBeenCalled();
            expect([...h.eqHeights]).toEqual(STATIC);
        });

        it("follow audio.getBands(9) when sound is on, and settle back when the music stops", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            s.runtime.muted = false;
            const bands = new Float32Array([0, 0.25, 0.5, 0.75, 1, 1, 0.5, 0, 0.1]);
            s.getBands.mockReturnValue(bands);
            for (let f = 0; f < 120; f++) h.update!(1 / 60, 0, s.runtime);
            expect(s.getBands).toHaveBeenCalledWith(9);
            const want = eqTargets(bands, STATIC);
            expect([...h.eqHeights]).toEqual(want.map((v) => expect.closeTo(v, 6)));
            expect(bars(h.eq).map((b) => b.h)).toEqual(want.map((v) => expect.closeTo(v, 6)));

            // Unmuted but no music yet (getBands → null): back to the static pose.
            s.getBands.mockReturnValue(null);
            for (let f = 0; f < 120; f++) h.update!(1 / 60, 0, s.runtime);
            expect([...h.eqHeights]).toEqual(STATIC);
        });

        it("smooth toward the bands rather than jumping", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            s.runtime.muted = false;
            s.getBands.mockReturnValue(new Float32Array(9).fill(1));
            h.update!(1 / 60, 0, s.runtime);
            const top = Math.max(...STATIC);
            expect(h.eqHeights[0]).toBeGreaterThan(STATIC[0]);
            expect(h.eqHeights[0]).toBeLessThan(top);
        });

        it("hold the static heights under reduced motion even with sound on", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            s.runtime.muted = false;
            s.getBands.mockReturnValue(new Float32Array(9).fill(1));
            h.update!(1 / 60, 0, s.runtime);
            s.runtime.reducedMotion = true;
            h.update!(1 / 60, 0, s.runtime);
            expect([...h.eqHeights]).toEqual(STATIC);
        });

        it("bounds are computed at the tallest pose, so a driven bar is never culled early", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const top = M.stage.h + Math.max(...STATIC);
            expect(h.eq.boundingBox!.max.y).toBeCloseTo(top, 6);
        });

        it("eqTargets maps bands in [0, 1] onto [min stub, tallest static] and clamps out-of-range values", () => {
            expect(eqTargets(null, STATIC)).toEqual(STATIC);
            const t = eqTargets([0, 1, 2, -1, Number.NaN, 0.5], [1, 2, 3, 4, 3, 2]);
            expect(t[1]).toBe(4);
            expect(t[2]).toBe(4); // clamped
            expect(t[0]).toBe(t[3]); // −1 clamps to 0
            expect(t[4]).toBe(t[0]); // NaN reads as 0, never a NaN bar
            // Missing bands (a shorter array) read as 0 too.
            const short = eqTargets([1], [1, 2, 3]);
            expect(short[0]).toBe(3);
            expect(short[1]).toBe(short[2]);
            expect(short[1]).toBeLessThan(1);
            for (const v of [...t, ...short]) expect(Number.isFinite(v)).toBe(true);
            expect(t[0]).toBeGreaterThan(0);
            expect(t[0]).toBeLessThan(1);
            expect(t[5]).toBeCloseTo((t[0] + 4) / 2, 9);
            const out = new Array<number>(2);
            expect(eqTargets([1, 0], [1, 2], out)).toBe(out);
        });
    });

    describe("record sleeves", () => {
        it("four upright paper sleeves in a row along R (spacing 6.5), centred at C + S·12 − R·2", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            expect(N).toBe(4);
            expect(h.sleeves).toHaveLength(N);
            h.sleeves.forEach((sl, i) => {
                expect(sl.parent).toBe(s.ctx.group);
                expect(sl.position.x).toBe(M.sleeves[i].x);
                expect(sl.position.z).toBe(M.sleeves[i].z);
                expect(sl.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
                const d = rs(C, sl.position);
                expect(d.s).toBeCloseTo(12, 9);
                expect(d.r).toBeCloseTo(-2 + (i - (N - 1) / 2) * 6.5, 9);
                const box = sl.getObjectByName("sleeve-box") as THREE.Mesh;
                expect((box.material as THREE.Material).name).toBe(PALETTE.paper);
                expect(box.castShadow).toBe(true);
                const b = worldBox(box);
                expect(b.min.y).toBeCloseTo(0, 6);
                expect(b.max.y).toBeCloseTo(M.sleeve.h, 6);
            });
        });

        it("they stand 13 in front of the stage's front edge, so they never hide the stage", () => {
            for (const p of M.sleeves) expect(rs(stageC, p).s - M.stage.d / 2).toBeCloseTo(13, 9);
        });

        it("a 5 × 0.8 ACCENT.music strip along the top of each front face", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            for (const sl of h.sleeves) {
                const strip = sl.getObjectByName("sleeve-strip") as THREE.Mesh;
                expect((strip.material as THREE.Material).name).toBe(ACCENT.music);
                const g = strip.geometry;
                g.computeBoundingBox();
                expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(M.sleeve.w, 6);
                expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(M.sleeve.stripH, 6);
                expect(strip.position.y + M.sleeve.stripH / 2).toBeCloseTo(M.sleeve.h, 9);
                expect(strip.position.z).toBeGreaterThan(M.sleeve.d / 2);
                expect(strip.castShadow).toBe(false);
            }
        });

        it("each pillar title in Inter Bold 0.7 ink, upright on the front face below the strip", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const ups = s.texts.filter((t) => t.kind === "upright");
            expect(ups).toHaveLength(N);
            ups.forEach((t, i) => {
                expect(t.opts).toMatchObject({
                    text: musicPillars[i].title,
                    font: TY.sleeveTitle.font,
                    size: TY.sleeveTitle.size,
                    color: PALETTE.ink,
                    maxWidth: M.sleeve.titleMaxWidth,
                });
                expect(t.handle).toBe(h.sleeveTitles[i]);
                const o = t.handle.object;
                expect(o.parent).toBe(h.sleeves[i]);
                expect(o.position.z).toBeGreaterThan(M.sleeve.d / 2);
                expect(o.position.y).toBeLessThan(M.sleeve.h - M.sleeve.stripH);
                expect(M.sleeve.titleMaxWidth).toBeLessThan(M.sleeve.w);
            });
            // No flat copy at all: the sleeve pads carry no label and there are no keycaps.
            expect(s.texts.filter((t) => t.kind === "flat")).toHaveLength(0);
        });

        it("each sleeve has a thin fixed collider, rotated faceCamera", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const sleeveBodies = s.bodies.slice(1 + M.speakers.length); // after the stage and speakers
            expect(sleeveBodies).toHaveLength(N);
            sleeveBodies.forEach((b, i) => {
                expect(b.half).toEqual({ x: M.sleeve.w / 2, y: M.sleeve.h / 2, z: M.sleeve.d / 2 });
                expect(b.pos).toEqual({ x: M.sleeves[i].x, y: M.sleeve.h / 2, z: M.sleeves[i].z });
                expect(b.quat.angleTo(FACE_QUAT)).toBeCloseTo(0, 9);
            });
            expect(h.colliders).toEqual(s.bodies.map((b) => b.body));
        });

        it("one pad per sleeve (Layout's sleeve-i spot, sleeve + S·5) that opens its pillar's panel", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            expect(s.interactables).toHaveLength(N);
            expect(h.pads).toHaveLength(N);
            s.interactables.forEach((i, k) => {
                const spot = PADS.find((p) => p.id === `sleeve-${k}`)!;
                expect(i.pad).toBe(spot.pad);
                expect(spot.label).toBeNull();
                expect(i.areaId).toBe("music");
                expect(i.prompt.title).toBe(musicPillars[k].title);
                expect(i.onInteract).toBeUndefined();
                expect(i.content).toEqual(musicPillarContent(k));
                const d = rs(M.sleeves[k], spot.pad);
                expect(d.r).toBeCloseTo(0, 9);
                expect(d.s).toBeCloseTo(5, 9);
                expect(pointInRect(AREA_BY_ID.music.rect, spot.pad.x, spot.pad.z)).toBe(true);
                expect(h.pads[k].group.parent).toBe(s.ctx.group);
                i.setActive!(true);
                expect(h.pads[k].active).toBe(true);
                i.setActive!(false);
                expect(h.pads[k].active).toBe(false);
            });
        });

        it("panel content carries the pillar copy and its link when it has one", () => {
            const c0 = musicPillarContent(0);
            expect(c0.title).toBe(musicPillars[0].title);
            expect(c0.body).toBe(musicPillars[0].body);
            expect(c0.links).toEqual([{ label: "Visit site", url: musicPillars[0].url }]);
            expect(c0.accent).toBe(parseInt(ACCENT.music.slice(1), 16));
            expect(musicPillarContent(1).links).toBeUndefined();
        });
    });

    describe("teardown", () => {
        it("dispose frees the title, texts, pads, colliders, the EQ instances and every interactable once", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const eqDispose = vi.spyOn(h.eq, "dispose");
            const stageGeo = vi.spyOn(h.stage.geometry, "dispose");
            h.dispose!();
            h.dispose!();
            expect(s.words[0].word.dispose).toHaveBeenCalledTimes(1);
            for (const t of s.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(s.removed).toEqual(s.bodies.map((b) => b.body));
            expect(s.unregistered).toEqual(s.interactables);
            expect(eqDispose).toHaveBeenCalledTimes(1);
            expect(stageGeo).toHaveBeenCalledTimes(1);
            expect(s.ctx.group.children).toHaveLength(0);
            const rot = h.vinyl.rotation.y;
            h.update!(1, 0, s.runtime);
            expect(h.vinyl.rotation.y).toBe(rot);
        });

        it("a builder that throws frees what it built, leaves no collider, and rethrows", () => {
            const a = stubCtx({ sleeveTitle: 2 });
            expect(() => build(a.ctx)).toThrow("text failed");
            expect(a.bodies).toHaveLength(0);
            expect(a.interactables).toHaveLength(2);
            expect(a.unregistered).toEqual(a.interactables);
            expect(a.words[0].word.dispose).toHaveBeenCalledTimes(1);
            for (const t of a.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(a.ctx.group.children).toHaveLength(0);

            const b = stubCtx({ collider: true });
            expect(() => build(b.ctx)).toThrow("physics failed");
            expect(b.unregistered).toEqual(b.interactables);
            expect(b.interactables).toHaveLength(N);
            expect(b.removed).toHaveLength(0);
            expect(b.ctx.group.children).toHaveLength(0);
        });
    });
});
