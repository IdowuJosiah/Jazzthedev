import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ekoMilestones } from "@/app/field/content/world";
import { ACCENT, ACCENT_INK, CONFIG, FACE_CAMERA_Y, PALETTE, SCREEN_DOWN, SCREEN_RIGHT } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT, PADS, pointInPad } from "../Layout";
import { registeredAreaIds } from "../Areas";
import { boardUrl } from "../Assets";
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
import {
    EKO_BOARD,
    HAS_PHONE_SHOT,
    PHONE_SCREEN_SOURCES,
    PHONE_SHOT,
    build,
    buildEko,
    containSize,
    ekoPanelContent,
    milestoneNumber,
    phoneScreenSources,
    roundedPlane,
} from "./Eko";

const E = AREA_LAYOUT.eko;
const BOARD = AREA_LAYOUT.projects.board;
const TY = CONFIG.type;
const FACE_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
/** troika's "normal" line height is about 1.2 em; a conservative bound for layout checks. */
const LINE_HEIGHT = 1.2;
/** The screen's corner radius: the body's, inset by the side bezel. */
const SCREEN_RADIUS = E.phone.body.radius - (E.phone.body.w - E.phone.screen.w) / 2;
/** roundedRectShape corners are quadratic curves: they bulge to 0.75·√2·r at the midpoint, never to the square corner (√2·r). */
const CORNER_REACH = 0.75 * Math.SQRT2;

/** Lines a greedy word wrap at `maxWidth` produces (Layout's width estimate). */
function wrapLines(text: string, size: number, maxWidth: number): number {
    let lines = 1;
    let line = "";
    for (const word of text.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (line && Layout.estimateTextWidth(next, size) > maxWidth) {
            lines++;
            line = word;
        } else line = next;
    }
    return lines;
}

/** Geometry bounds size (x, y) in its own frame. */
const geoSize = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    return { w: b.max.x - b.min.x, h: b.max.y - b.min.y };
};

type TextCall = { kind: "flat" | "upright"; opts: TextOpts; handle: TextHandle };

/** A texture whose image reports a size (what containSize reads). */
const texture = (width: number, height: number) => {
    const t = new THREE.Texture();
    t.image = { width, height };
    return t;
};

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function stubCtx(fail: { collider?: boolean; label?: boolean } = {}) {
    const texts: TextCall[] = [];
    const words: { text: string; opts: Word3DOptions; word: Word3D & { dispose: ReturnType<typeof vi.fn> } }[] = [];
    const bodies: { half: unknown; pos: unknown; quat: THREE.Quaternion; body: object }[] = [];
    const removed: object[] = [];
    const interactables: WorldInteractable[] = [];
    const unregistered: WorldInteractable[] = [];
    // Materials remember their palette hex (name) so tests can tell them apart.
    const lambert = vi.fn((hex: string) => Object.assign(new THREE.MeshLambertMaterial(), { name: hex }));
    const basic = vi.fn((hex: string) => Object.assign(new THREE.MeshBasicMaterial(), { name: hex }));
    const sources = new Map<string, THREE.Texture | null>();
    const request = vi.fn(async (name: string) => sources.get(name) ?? null);

    const makeText =
        (kind: TextCall["kind"]) =>
        (o: TextOpts): TextHandle => {
            if (fail.label && texts.length > 2) throw new Error("text failed");
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
        carPos: new THREE.Vector3(0, 0, 12),
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
        assets: { boards: { register: vi.fn(), request, get: () => null, onLoaded: () => () => {} } },
        audio: { getBands: () => null },
        commands: {},
        disposal: new Disposal(),
        runtime,
        def: AREA_BY_ID.eko,
        layout: Layout,
        addInteractable: (i: WorldInteractable) => {
            interactables.push(i);
            return () => unregistered.push(i);
        },
    } as unknown as AreaContext;
    return { ctx, texts, words, bodies, removed, interactables, unregistered, lambert, basic, sources, request, runtime };
}

/** Drives the car next to the phone and lets the async screen load settle. */
async function driveToPhone(s: ReturnType<typeof stubCtx>, h: ReturnType<typeof build>) {
    s.runtime.carPos.set(E.phone.position.x, 0, E.phone.position.z);
    h.update!(0, 0, s.runtime);
    await flush();
}

const worldBox = (o: THREE.Object3D) => {
    o.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(o);
};

describe("areas/Eko (§2.4, §5.2)", () => {
    it("registers itself as the eko builder", () => {
        expect(registeredAreaIds()).toContain("eko");
    });

    it("the static 3D title EKO in ACCENT_INK.eko, placed once at its Layout point, faceCamera", () => {
        const s = stubCtx();
        const h = build(s.ctx);
        expect(s.words).toHaveLength(1);
        const { text, opts, word } = s.words[0];
        const t3 = AREA_BY_ID.eko.title3D!;
        expect(text).toBe("EKO");
        expect(opts).toEqual({
            cap: TY.areaTitle.cap,
            depth: TY.areaTitle.depth,
            curveSegments: TY.areaTitle.curveSegments,
            color: ACCENT_INK.eko,
            dynamic: false,
        });
        expect(word.group.parent).toBe(s.ctx.group);
        expect(word.group.position.toArray()).toEqual([t3.x, 0, t3.z]);
        expect(word.group.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(h.title).toBe(word);
    });

    describe("milestone tiles", () => {
        it("five flush paper tiles (plate layer) at the Layout points, in a row along R", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            expect(ekoMilestones).toHaveLength(5);
            expect(h.tiles).toHaveLength(5);
            expect(s.lambert).toHaveBeenCalledWith(PALETTE.paper, { layer: "plate" });
            h.tiles.forEach((plate, k) => {
                const tile = plate.parent!;
                expect(tile.parent).toBe(s.ctx.group);
                expect(tile.position.x).toBe(E.tiles[k].x);
                expect(tile.position.z).toBe(E.tiles[k].z);
                expect(tile.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
                // Flush: a flat plate at the plate layer, receiving but never casting shadows.
                const b = worldBox(plate);
                expect(b.min.y).toBeCloseTo(shapes.LAYERS.plate.y, 6);
                expect(b.max.y).toBeCloseTo(shapes.LAYERS.plate.y, 6);
                expect(plate.castShadow).toBe(false);
                expect(plate.receiveShadow).toBe(true);
                expect(plate.renderOrder).toBe(shapes.LAYERS.plate.renderOrder);
                // 7 × 7 in its own (faceCamera) frame.
                const g = plate.geometry;
                g.computeBoundingBox();
                expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(E.tile.w, 6);
                expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(E.tile.d, 6);
            });
            // Consecutive tiles step 6 along X and −6 along Z: purely along R.
            for (let k = 1; k < E.tiles.length; k++) {
                const dx = E.tiles[k].x - E.tiles[k - 1].x;
                const dz = E.tiles[k].z - E.tiles[k - 1].z;
                expect(dx * SCREEN_DOWN.x + dz * SCREEN_DOWN.z).toBeCloseTo(0, 9);
                expect(dx * SCREEN_RIGHT.x + dz * SCREEN_RIGHT.z).toBeGreaterThan(0);
            }
        });

        it("numbers 01–05 in Bricolage 2.4 ACCENT_INK.eko and the titles in Inter Bold 0.8 ink, on the padOnPlate layer", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            expect(h.numerals.map((n) => s.texts.find((t) => t.handle === n)!.opts.text)).toEqual([
                "01",
                "02",
                "03",
                "04",
                "05",
            ]);
            expect([0, 4].map(milestoneNumber)).toEqual(["01", "05"]);
            h.numerals.forEach((n, k) => {
                const call = s.texts.find((t) => t.handle === n)!;
                expect(call.kind).toBe("flat");
                expect(call.opts).toMatchObject({
                    font: "display",
                    size: E.tile.numeralSize,
                    color: ACCENT_INK.eko,
                    layer: "padOnPlate",
                });
                expect(E.tile.numeralSize).toBe(TY.numerals.max);
                const title = h.tileTitles[k];
                const tc = s.texts.find((t) => t.handle === title)!;
                expect(tc.kind).toBe("flat");
                expect(tc.opts).toMatchObject({
                    text: ekoMilestones[k].title,
                    font: "bold",
                    size: TY.minFlatSize,
                    color: PALETTE.ink,
                    layer: "padOnPlate",
                });
                expect(tc.opts.maxWidth).toBeLessThan(E.tile.w);
                // Both on the tile; the numeral above the title on screen (−S is up).
                expect(n.object.parent).toBe(h.tiles[k].parent);
                expect(title.object.parent).toBe(h.tiles[k].parent);
                expect(n.object.position.z).toBeLessThan(0);
                expect(title.object.position.z).toBeGreaterThan(0);
                // Both line boxes stay inside the tile, the title's at however
                // many lines it wraps to, and the numeral stays clear of the title.
                const lines = wrapLines(ekoMilestones[k].title, TY.minFlatSize, tc.opts.maxWidth!);
                const titleHalf = (lines * TY.minFlatSize * LINE_HEIGHT) / 2;
                const numeralHalf = (E.tile.numeralSize * LINE_HEIGHT) / 2;
                expect(Math.abs(n.object.position.z) + numeralHalf).toBeLessThan(E.tile.d / 2);
                expect(title.object.position.z + titleHalf).toBeLessThan(E.tile.d / 2);
                expect(n.object.position.z + numeralHalf).toBeLessThan(title.object.position.z - titleHalf);
                // Flat text keeps object y = 0 (the layer height lives on the inner mesh).
                expect(n.object.position.y).toBe(0);
                expect(title.object.position.y).toBe(0);
            });
        });

        it("copy uses only the text-safe accent, never below 1.5 units, and never ink2 (§1.2 colour rules)", () => {
            const s = stubCtx();
            build(s.ctx);
            expect(s.texts.some((t) => t.opts.color === ACCENT_INK.eko)).toBe(true);
            for (const t of s.texts) {
                // ACCENT is for shapes; text on (night-lit) paper takes ACCENT_INK.
                expect(t.opts.color).not.toBe(ACCENT.eko);
                if (t.opts.color === ACCENT_INK.eko) expect(t.opts.size).toBeGreaterThanOrEqual(TY.numerals.min);
                expect(t.opts.color).not.toBe(PALETTE.ink2);
            }
        });
    });

    describe("the hero phone", () => {
        it("paper plinth RoundedBox(6, 0.8, 6) at the Layout point; the ink phone stands on it, faceCamera", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const P = E.phone;
            expect(h.plinth.position.toArray()).toEqual([P.position.x, P.plinth.h / 2, P.position.z]);
            expect(h.plinth.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
            expect((h.plinth.material as THREE.Material).name).toBe(PALETTE.paper);
            expect(h.plinth.castShadow && h.plinth.receiveShadow).toBe(true);
            const pb = worldBox(h.plinth);
            expect(pb.min.y).toBeCloseTo(0, 6);
            expect(pb.max.y).toBeCloseTo(P.plinth.h, 6);

            expect(h.phone.position.toArray()).toEqual([P.position.x, P.plinth.h, P.position.z]);
            expect(h.phone.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
            expect((h.body.material as THREE.Material).name).toBe(PALETTE.ink);
            expect(h.body.castShadow).toBe(true);
            // In the phone's frame: 4.4 wide, 8.8 tall from the plinth top, 0.5 deep, centred on z.
            const g = h.body.geometry;
            g.computeBoundingBox();
            const b = g.boundingBox!;
            expect(b.max.x - b.min.x).toBeCloseTo(P.body.w, 4);
            expect(b.min.y).toBeCloseTo(0, 4);
            expect(b.max.y).toBeCloseTo(P.body.h, 4);
            expect(b.min.z).toBeCloseTo(-P.body.depth / 2, 4);
            expect(b.max.z).toBeCloseTo(P.body.depth / 2, 4);
        });

        it("the 3.9 × 8.2 screen sits just in front of the face, centred, with the placeholder colour", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const P = E.phone;
            const size = geoSize(h.screen.geometry);
            expect(size.w).toBeCloseTo(P.screen.w, 6);
            expect(size.h).toBeCloseTo(P.screen.h, 6);
            expect(h.screen.position.toArray()).toEqual([0, P.body.h / 2, P.body.depth / 2 + P.screen.inset]);
            expect((h.screen.material as THREE.Material).name).toBe(PALETTE.imagePlaceholder);
            expect(P.screen.w).toBeLessThan(P.body.w);
            expect(P.screen.h).toBeLessThan(P.body.h);
            // The image (hidden until it loads) is in front of the screen.
            expect(h.image.visible).toBe(false);
            expect(h.image.position.z).toBeGreaterThan(h.screen.position.z);
            expect(h.screenSource).toBeNull();
        });

        it("the screen's corners are rounded, parallel to the body's (inset by the side bezel)", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const { w, h: sh } = E.phone.screen;
            const r = SCREEN_RADIUS;
            expect(r).toBeGreaterThan(0);
            const pos = h.screen.geometry.getAttribute("position");
            let onArc = 0;
            for (let i = 0; i < pos.count; i++) {
                const ax = Math.abs(pos.getX(i)) - (w / 2 - r);
                const ay = Math.abs(pos.getY(i)) - (sh / 2 - r);
                expect(pos.getZ(i)).toBe(0);
                if (ax > 1e-6 && ay > 1e-6) {
                    // Inside a corner square: on (or inside) the curve, never the square corner.
                    expect(Math.hypot(ax, ay)).toBeLessThanOrEqual(r * CORNER_REACH + 1e-6);
                    onArc++;
                }
            }
            expect(onArc).toBeGreaterThan(0);
        });

        it("roundedPlane maps UVs 0..1 over its bounds (an image fills it like a PlaneGeometry)", () => {
            const g = roundedPlane(shapes, 4, 2, 0.25);
            const pos = g.getAttribute("position");
            const uv = g.getAttribute("uv");
            for (let i = 0; i < pos.count; i++) {
                // Float32 attributes: ~7 significant digits.
                expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / 4 + 0.5, 6);
                expect(uv.getY(i)).toBeCloseTo(pos.getY(i) / 2 + 0.5, 6);
                expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-9);
                expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-9);
            }
            expect(geoSize(g)).toEqual({ w: expect.closeTo(4, 9), h: expect.closeTo(2, 9) });
            g.dispose();
        });

        it("two fixed colliders (plinth, phone body), rotated faceCamera", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const P = E.phone;
            expect(s.bodies).toHaveLength(2);
            expect(s.bodies[0].half).toEqual({ x: P.plinth.w / 2, y: P.plinth.h / 2, z: P.plinth.d / 2 });
            expect(s.bodies[0].pos).toEqual({ x: P.position.x, y: P.plinth.h / 2, z: P.position.z });
            expect(s.bodies[1].half).toEqual({ x: P.body.w / 2, y: P.body.h / 2, z: P.body.depth / 2 });
            expect(s.bodies[1].pos).toEqual({ x: P.position.x, y: P.plinth.h + P.body.h / 2, z: P.position.z });
            for (const b of s.bodies) expect(b.quat.angleTo(FACE_QUAT)).toBeCloseTo(0, 9);
            expect(h.colliders).toEqual(s.bodies.map((b) => b.body));
        });
    });

    describe("lazy screen image", () => {
        it("nothing is requested until the car is within the boards' lazy-load distance", async () => {
            const s = stubCtx();
            const h = build(s.ctx);
            h.update!(0.016, 0, s.runtime); // at the spawn
            await flush();
            expect(s.request).not.toHaveBeenCalled();
            const P = E.phone.position;
            s.runtime.carPos.set(P.x + BOARD.lazyLoadDistance + 1, 0, P.z);
            h.update!(0.016, 0, s.runtime);
            expect(s.request).not.toHaveBeenCalled();
            s.runtime.carPos.set(P.x + BOARD.lazyLoadDistance - 1, 0, P.z);
            h.update!(0.016, 0, s.runtime);
            h.update!(0.016, 0, s.runtime);
            await flush();
            expect(s.request).toHaveBeenCalledTimes(PHONE_SCREEN_SOURCES.length); // both tried once, never repeated
        });

        it("never probes for eko-phone.webp while the owner has not supplied it (no guaranteed 404)", async () => {
            expect(HAS_PHONE_SHOT).toBe(false);
            expect(PHONE_SCREEN_SOURCES).toEqual([EKO_BOARD]);
            expect(phoneScreenSources(true)).toEqual([PHONE_SHOT, EKO_BOARD]);
            const s = stubCtx();
            s.sources.set(PHONE_SHOT, texture(720, 1500));
            s.sources.set(EKO_BOARD, texture(1600, 900));
            const h = build(s.ctx);
            await driveToPhone(s, h);
            expect(s.request.mock.calls.map((c) => c[0])).toEqual([EKO_BOARD]);
            expect(h.screenSource).toBe(EKO_BOARD);
        });

        it("with the phone shot enabled it is preferred; a portrait screenshot fills the screen", async () => {
            const s = stubCtx();
            // A screenshot with the screen's own aspect (3.9 : 8.2).
            const shotW = 780;
            const shotH = 1640;
            const phoneShot = texture(shotW, shotH);
            s.sources.set(PHONE_SHOT, phoneShot);
            const h = buildEko(s.ctx, { screenSources: phoneScreenSources(true) });
            await driveToPhone(s, h);
            expect(s.request.mock.calls.map((c) => c[0])).toEqual([PHONE_SHOT]);
            expect(h.screenSource).toBe(PHONE_SHOT);
            expect(h.image.visible).toBe(true);
            expect((h.image.material as THREE.MeshBasicMaterial).map).toBe(phoneShot);
            const fit = containSize(shotW, shotH, E.phone.screen.w, E.phone.screen.h);
            const size = geoSize(h.image.geometry);
            expect(size.w).toBeCloseTo(fit.w, 6);
            expect(size.h).toBeCloseTo(fit.h, 6);
            expect(size.w).toBeCloseTo(E.phone.screen.w, 6);
            expect(h.image.scale.toArray()).toEqual([1, 1, 1]);
            // Fills the screen: no letterbox bars, the placeholder stays behind it.
            expect((h.screen.material as THREE.Material).name).toBe(PALETTE.imagePlaceholder);
        });

        it("with the phone shot enabled but missing, falls back to the board image", async () => {
            const s = stubCtx();
            s.sources.set(EKO_BOARD, texture(1600, 900));
            const h = buildEko(s.ctx, { screenSources: phoneScreenSources(true) });
            await driveToPhone(s, h);
            expect(s.request.mock.calls.map((c) => c[0])).toEqual([PHONE_SHOT, EKO_BOARD]);
            expect(h.screenSource).toBe(EKO_BOARD);
        });

        it("shows the eko board image as a rounded card, letterboxed on ink bars", async () => {
            const s = stubCtx();
            const board = texture(1600, 900);
            s.sources.set(EKO_BOARD, board);
            const h = build(s.ctx);
            const firstImageGeo = h.image.geometry;
            const firstDispose = vi.spyOn(firstImageGeo, "dispose");
            await driveToPhone(s, h);
            expect(s.request.mock.calls.map((c) => c[0])).toEqual([...PHONE_SCREEN_SOURCES]);
            expect(h.screenSource).toBe(EKO_BOARD);
            expect((h.image.material as THREE.MeshBasicMaterial).map).toBe(board);
            // Contained: full width, 16:9 height, never stretched; centred on the screen.
            const size = geoSize(h.image.geometry);
            expect(size.w).toBeCloseTo(E.phone.screen.w, 6);
            expect(size.h).toBeCloseTo((E.phone.screen.w * 900) / 1600, 6);
            expect(h.image.position.y).toBe(h.screen.position.y);
            // The placeholder-sized geometry was swapped out and freed.
            expect(h.image.geometry).not.toBe(firstImageGeo);
            expect(firstDispose).toHaveBeenCalledTimes(1);
            // Rounded like the screen: no vertex in the square corner.
            const pos = h.image.geometry.getAttribute("position");
            for (let i = 0; i < pos.count; i++) {
                const ax = Math.abs(pos.getX(i)) - (size.w / 2 - SCREEN_RADIUS);
                const ay = Math.abs(pos.getY(i)) - (size.h / 2 - SCREEN_RADIUS);
                if (ax > 1e-6 && ay > 1e-6) expect(Math.hypot(ax, ay)).toBeLessThanOrEqual(SCREEN_RADIUS * CORNER_REACH + 1e-6);
            }
            // The bars are LIT ink (they follow the look like the body, never glow).
            expect(h.screen.material).toBeInstanceOf(THREE.MeshLambertMaterial);
            expect((h.screen.material as THREE.Material).name).toBe(PALETTE.ink);
        });

        it("keeps the placeholder when every source fails", async () => {
            const s = stubCtx();
            const h = build(s.ctx);
            await driveToPhone(s, h);
            expect(h.screenSource).toBeNull();
            expect(h.image.visible).toBe(false);
            expect((h.screen.material as THREE.Material).name).toBe(PALETTE.imagePlaceholder);
        });

        it("fades in over the boards' fade time; instantly under reduced motion", async () => {
            const s = stubCtx();
            s.sources.set(EKO_BOARD, texture(1600, 900));
            const h = build(s.ctx);
            await driveToPhone(s, h);
            const m = h.image.material as THREE.MeshBasicMaterial;
            expect(m.fog).toBe(true);
            expect(m.transparent).toBe(true);
            expect(m.opacity).toBe(0);
            h.update!(BOARD.fadeIn / 2, 0, s.runtime);
            expect(m.opacity).toBeCloseTo(0.5, 9);
            h.update!(BOARD.fadeIn, 0, s.runtime);
            expect(m.opacity).toBe(1);
            expect(m.transparent).toBe(false);

            const r = stubCtx();
            r.sources.set(EKO_BOARD, texture(1600, 900));
            r.runtime.reducedMotion = true;
            const rh = build(r.ctx);
            await driveToPhone(r, rh);
            const rm = rh.image.material as THREE.MeshBasicMaterial;
            expect(rm.opacity).toBe(1);
            expect(rm.transparent).toBe(false);
        });

        it("an image that arrives after dispose is never shown", async () => {
            const s = stubCtx();
            let resolve!: (t: THREE.Texture | null) => void;
            s.request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
            const h = build(s.ctx);
            s.runtime.carPos.set(E.phone.position.x, 0, E.phone.position.z);
            h.update!(0, 0, s.runtime);
            h.dispose!();
            resolve(texture(720, 1500));
            await flush();
            expect(h.screenSource).toBeNull();
            expect(s.request).toHaveBeenCalledTimes(1);
        });

        it("containSize keeps the aspect inside the box, and passes unknown sizes through", () => {
            expect(containSize(1600, 900, 3.9, 8.2)).toEqual({ w: 3.9, h: (3.9 * 900) / 1600 });
            const tall = containSize(100, 1000, 3.9, 8.2);
            expect(tall.h).toBeCloseTo(8.2, 12);
            expect(tall.w).toBeCloseTo(0.82, 12);
            expect(containSize(0, 900, 3.9, 8.2)).toEqual({ w: 3.9, h: 8.2 });
            expect(containSize(Number.NaN, 900, 3.9, 8.2)).toEqual({ w: 3.9, h: 8.2 });
        });
    });

    describe("pad", () => {
        it("one pad (Layout's eko spot, labelled, no keycap) that opens the Eko panel", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const spot = PADS.find((p) => p.id === "eko")!;
            expect(s.interactables).toHaveLength(1);
            const i = s.interactables[0];
            expect(i.pad).toBe(spot.pad);
            expect(i.areaId).toBe("eko");
            expect(i.prompt.title).toBe("Eko");
            expect(i.onInteract).toBeUndefined();
            expect(i.content).toEqual(ekoPanelContent());
            // The pad sits in front of the phone (phone + S·8) and inside the area.
            const P = E.phone.position;
            const ds = (spot.pad.x - P.x) * SCREEN_DOWN.x + (spot.pad.z - P.z) * SCREEN_DOWN.z;
            expect(ds).toBeCloseTo(8, 9);
            expect(Layout.pointInRect(AREA_BY_ID.eko.rect, spot.pad.x, spot.pad.z)).toBe(true);
            // The flat pad label on the ground-text layer; the visual follows setActive.
            const label = s.texts.find((t) => t.opts.text === spot.label)!;
            expect(label.kind).toBe("flat");
            expect(label.opts.layer).toBe("groundText");
            expect(h.pad.group.parent).toBe(s.ctx.group);
            expect(h.pad.active).toBe(false);
            i.setActive!(true);
            expect(h.pad.active).toBe(true);
            i.setActive!(false);
            expect(h.pad.active).toBe(false);
            // No keycap / extra upright text anywhere in the area.
            expect(s.texts.filter((t) => t.kind === "upright")).toHaveLength(0);
            // The car standing on the pad centre is inside it.
            expect(pointInPad(spot.pad, spot.pad.x, spot.pad.z)).toBe(true);
        });

        it("the panel lists the five milestones and links eeko.site", () => {
            const c = ekoPanelContent();
            expect(c.title).toBe("Eko");
            expect(c.image).toBe(boardUrl(EKO_BOARD));
            expect(c.sections).toHaveLength(5);
            c.sections!.forEach((sec, k) => {
                expect(sec.heading).toContain(ekoMilestones[k].title);
                expect(sec.text).toBe(ekoMilestones[k].body);
            });
            expect(c.links).toEqual([{ label: "Visit eeko.site", url: "https://eeko.site" }]);
            expect(c.accent).toBe(parseInt(ACCENT.eko.slice(1), 16));
        });
    });

    describe("teardown", () => {
        it("dispose frees the title, texts, pad, colliders, image material and interactable once", async () => {
            const s = stubCtx();
            s.sources.set(EKO_BOARD, texture(1600, 900));
            const h = build(s.ctx);
            await driveToPhone(s, h);
            const imageMat = h.image.material as THREE.MeshBasicMaterial;
            const matDispose = vi.spyOn(imageMat, "dispose");
            const tileGeoDispose = vi.spyOn(h.tiles[0].geometry, "dispose");
            const imageGeoDispose = vi.spyOn(h.image.geometry, "dispose");
            h.dispose!();
            h.dispose!();
            expect(s.words[0].word.dispose).toHaveBeenCalledTimes(1);
            for (const t of s.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(s.removed).toEqual(s.bodies.map((b) => b.body));
            expect(s.unregistered).toEqual(s.interactables);
            expect(matDispose).toHaveBeenCalledTimes(1);
            expect(tileGeoDispose).toHaveBeenCalledTimes(1);
            expect(imageGeoDispose).toHaveBeenCalledTimes(1);
            expect(s.ctx.group.children).toHaveLength(0);
            // Updates after dispose are inert.
            expect(() => h.update!(1, 0, s.runtime)).not.toThrow();
        });

        it("a builder that throws frees what it built, leaves no collider or interactable, and rethrows", () => {
            const a = stubCtx({ label: true });
            expect(() => build(a.ctx)).toThrow("text failed");
            expect(a.bodies).toHaveLength(0);
            expect(a.words[0].word.dispose).toHaveBeenCalledTimes(1);
            for (const t of a.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(a.ctx.group.children).toHaveLength(0);

            const b = stubCtx({ collider: true });
            expect(() => build(b.ctx)).toThrow("physics failed");
            expect(b.unregistered).toEqual(b.interactables);
            expect(b.interactables).toHaveLength(1);
            for (const t of b.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(b.removed).toHaveLength(0);
            expect(b.ctx.group.children).toHaveLength(0);
        });
    });
});
