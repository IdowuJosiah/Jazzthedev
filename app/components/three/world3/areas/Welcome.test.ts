import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { meta } from "@/app/field/content/world";
import { CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT } from "../Layout";
import { labelsOwnedBy } from "../Paths";
import { registeredAreaIds } from "../Areas";
import * as shapes from "../utils/shapes";
import { Disposal } from "../utils/disposal";
import type {
    AreaContext,
    Letter3D,
    MaterialsApi,
    RuntimeInfo,
    TextApi,
    TextHandle,
    TextOpts,
    Word3D,
    Word3DOptions,
} from "../types";
import { CARD_STYLE, CONTROLS_ROWS, build, controlsCardLayout } from "./Welcome";

type TextCall = { kind: "flat" | "upright" | "onPath"; opts: TextOpts & { angle?: number }; handle: TextHandle };

function stubCtx(opts: { desktopVisible?: boolean; failOnPath?: boolean } = {}) {
    const texts: TextCall[] = [];
    const words: { text: string; opts: Word3DOptions; word: Word3D & { dispose: ReturnType<typeof vi.fn> } }[] = [];
    const makeText =
        (kind: TextCall["kind"]) =>
        (o: TextOpts & { angle?: number }): TextHandle => {
            if (kind === "onPath" && opts.failOnPath) throw new Error("text failed");
            const object = new THREE.Group();
            if (kind === "onPath") object.rotation.y = o.angle ?? 0;
            const mesh = { visible: o.desktopOnly ? (opts.desktopVisible ?? true) : true };
            const handle = { object, mesh, setText() {}, setColor() {}, dispose: vi.fn() } as unknown as TextHandle;
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
        physics: {},
        materials: {
            lambert: () => new THREE.MeshLambertMaterial(),
            basic: () => new THREE.MeshBasicMaterial(),
        } as unknown as MaterialsApi,
        shapes,
        text: { flat: makeText("flat"), upright: makeText("upright"), onPath: makeText("onPath") } as unknown as TextApi,
        text3d: {
            word: (text: string, o: Word3DOptions) => {
                const group = new THREE.Group();
                const letters: Letter3D[] = Array.from(text).map((ch) => {
                    const mesh = new THREE.Mesh();
                    mesh.name = `letter:${ch}`;
                    group.add(mesh);
                    return { mesh, home: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() } };
                });
                const word = { group, letters, reset: vi.fn(), dispose: vi.fn() };
                words.push({ text, opts: o, word });
                return word;
            },
        },
        assets: {},
        audio: {},
        commands: {},
        disposal: new Disposal(),
        runtime,
        def: AREA_BY_ID.welcome,
        layout: Layout,
        addInteractable: () => () => {},
    } as unknown as AreaContext;
    return { ctx, texts, words, runtime };
}

const rt = (x: number, z: number): RuntimeInfo => ({
    carPos: new THREE.Vector3(x, 0, z),
    carSpeed: 0,
    reducedMotion: false,
    muted: true,
    isTouch: false,
});

const W = AREA_LAYOUT.welcome;
/** Float slack for edge comparisons (the SPACE row sits exactly at minGap). */
const FLOAT_EPS = 1e-9;
const hero = AREA_BY_ID.welcome.title3D!;
const RESET = CONFIG.physics.heroLetterResetDistance;

describe("areas/Welcome (§2.4)", () => {
    it("registers itself as the welcome builder (replacing the interim hero + role line)", () => {
        expect(registeredAreaIds()).toContain("welcome");
    });

    it("builds the dynamic ink hero word at its Layout point, faceCamera, one letter per character", () => {
        const { ctx, words } = stubCtx();
        const h = build(ctx);
        expect(words).toHaveLength(1);
        const w = words[0];
        expect(w.text).toBe(meta.heroWord);
        expect(w.opts).toMatchObject({
            cap: CONFIG.type.heroWord.cap,
            depth: CONFIG.type.heroWord.depth,
            curveSegments: CONFIG.type.heroWord.curveSegments,
            color: PALETTE.ink,
            dynamic: true,
        });
        expect(h.hero).toBe(w.word);
        expect(h.hero!.letters).toHaveLength(Array.from(meta.heroWord).length);
        expect(h.hero!.letters).toHaveLength(4); // JAZZ
        expect(w.word.group.parent).toBe(ctx.group);
        expect(w.word.group.position.x).toBe(hero.x);
        expect(w.word.group.position.y).toBe(0);
        expect(w.word.group.position.z).toBe(hero.z);
        expect(w.word.group.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        // Areas arms the word after build(): the builder itself never resets it.
        expect(w.word.reset).not.toHaveBeenCalled();
    });

    it("reset() returns the letters home (Travel, R, respawn, Start drop)", () => {
        const { ctx, words } = stubCtx();
        const h = build(ctx);
        h.reset!();
        h.reset!();
        expect(words[0].word.reset).toHaveBeenCalledTimes(2);
    });

    it("auto-resets once on the near → far change (> 60 units), not every frame", () => {
        const { ctx, words } = stubCtx();
        const h = build(ctx);
        const reset = words[0].word.reset;
        h.update!(1 / 60, 0, rt(0, 12)); // spawn: near
        expect(reset).not.toHaveBeenCalled();
        h.update!(1 / 60, 0, rt(hero.x + RESET - 1, hero.z)); // still within 60
        expect(reset).not.toHaveBeenCalled();
        h.update!(1 / 60, 0, rt(hero.x + RESET + 1, hero.z)); // crosses out
        expect(reset).toHaveBeenCalledTimes(1);
        h.update!(1 / 60, 0, rt(hero.x + RESET + 30, hero.z)); // stays far
        expect(reset).toHaveBeenCalledTimes(1);
        h.update!(1 / 60, 0, rt(hero.x, hero.z + 5)); // back near
        h.update!(1 / 60, 0, rt(hero.x, hero.z - RESET - 1)); // leaves again
        expect(reset).toHaveBeenCalledTimes(2);
    });

    it("role line (Inter Bold 1.1, ink) and greeting (Inter Medium 0.9, ink2) lie flat, faceCamera, at Layout", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        const role = texts.find((t) => t.opts.text === meta.role)!;
        const greet = texts.find((t) => t.opts.text === meta.greeting)!;
        expect(role.kind).toBe("flat");
        expect(role.opts).toMatchObject({
            font: "bold",
            size: CONFIG.type.roleLine.size,
            letterSpacing: CONFIG.type.roleLine.letterSpacing,
            color: PALETTE.ink,
        });
        expect(greet.kind).toBe("flat");
        expect(greet.opts).toMatchObject({ font: "medium", size: CONFIG.type.floorCaption.size, color: PALETTE.ink2 });
        for (const [t, p] of [
            [role, W.roleLine],
            [greet, W.greeting],
        ] as const) {
            expect(t.handle.object.position.x).toBeCloseTo(p.x, 9);
            expect(t.handle.object.position.y).toBe(0);
            expect(t.handle.object.position.z).toBeCloseTo(p.z, 9);
            expect(t.handle.object.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
            expect(t.handle.object.parent).toBe(ctx.group);
        }
        expect(h.roleLine).toBe(role.handle);
        expect(h.greeting).toBe(greet.handle);
        // ink2 only on plaza or paper: the greeting sits on the welcome plaza.
        expect(Layout.pointInRect(AREA_BY_ID.welcome.rect, W.greeting.x, W.greeting.z)).toBe(true);
    });

    it("controls card: paper plate + 4 keycap outlines, 8 desktopOnly SemiBold 0.8 ink2 labels", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        expect(CONTROLS_ROWS).toHaveLength(W.controlsCard.rows);
        const card = h.controls.group;
        expect(card.position.x).toBe(W.controlsCard.x);
        expect(card.position.z).toBe(W.controlsCard.z);
        expect(card.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        const cardTexts = texts.filter((t) => t.opts.desktopOnly);
        expect(cardTexts).toHaveLength(2 * W.controlsCard.rows);
        expect(h.controls.texts).toHaveLength(cardTexts.length);
        for (const t of cardTexts) {
            expect(t.kind).toBe("flat");
            expect(t.opts).toMatchObject({
                font: CONFIG.type.floorDetail.font,
                size: CONFIG.type.floorDetail.size,
                color: PALETTE.ink2,
            });
            expect(t.handle.object.parent).toBe(card);
        }
        expect(cardTexts.map((t) => t.opts.text)).toEqual(CONTROLS_ROWS.flatMap((r) => [r.keys, r.action]));

        // Plate on the plate layer, outlines just above it (padOnPlate), all inside the card.
        const meshes = h.controls.chrome.children as THREE.Mesh[];
        expect(meshes).toHaveLength(1 + W.controlsCard.rows);
        card.updateMatrixWorld(true);
        const plateBox = new THREE.Box3().setFromObject(meshes[0]);
        expect(plateBox.max.y).toBeCloseTo(shapes.LAYERS.plate.y, 6);
        for (const m of meshes.slice(1)) {
            m.geometry.computeBoundingBox();
            const b = m.geometry.boundingBox!.clone().translate(m.position);
            expect(b.max.y).toBeCloseTo(shapes.LAYERS.padOnPlate.y, 6);
            expect(b.min.x).toBeGreaterThanOrEqual(-W.controlsCard.w / 2);
            expect(b.max.x).toBeLessThanOrEqual(W.controlsCard.w / 2);
            expect(b.min.z).toBeGreaterThanOrEqual(-W.controlsCard.d / 2);
            expect(b.max.z).toBeLessThanOrEqual(W.controlsCard.d / 2);
            expect(m.renderOrder).toBe(shapes.LAYERS.padOnPlate.renderOrder);
        }
        // Rows stack down the screen (+S = local +Z) in reading order.
        const keyZ = cardTexts.filter((_, i) => i % 2 === 0).map((t) => t.handle.object.position.z);
        expect(keyZ).toEqual([...keyZ].sort((a, b) => a - b));
    });

    it("controls card rows: every keycap outline stays clear of its action text", () => {
        const C = W.controlsCard;
        const D = CONFIG.type.floorDetail;
        const rows = controlsCardLayout(C, D.size, Layout.estimateTextWidth);
        expect(rows.map((r) => r.keys)).toEqual(CONTROLS_ROWS.map((r) => r.keys));
        for (const r of rows) {
            // Both edges from the same conservative estimate the card is built with.
            const keyRight = r.keyX + r.keyW / 2;
            expect(r.actionLeft - keyRight).toBeGreaterThanOrEqual(CARD_STYLE.minGap - FLOAT_EPS);
            expect(r.keyX - r.keyW / 2).toBeGreaterThanOrEqual(-C.w / 2);
            expect(r.actionRight).toBeLessThanOrEqual(C.w / 2);
        }
        // The built card uses exactly this layout.
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        const outlines = (h.controls.chrome.children as THREE.Mesh[]).slice(1);
        rows.forEach((r, i) => {
            expect(outlines[i].position.x).toBeCloseTo(r.keyX, 9);
            expect(outlines[i].position.z).toBeCloseTo(r.z, 9);
            const action = texts.find((t) => t.opts.text === r.action)!;
            expect(action.opts.anchorX).toBe("right");
            expect(action.handle.object.position.x).toBeCloseTo(r.actionRight, 9);
        });
    });

    it("a builder that throws frees the hero word, texts and geometries, then rethrows", () => {
        const { ctx, texts, words } = stubCtx({ failOnPath: true });
        const geoDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
        expect(() => build(ctx)).toThrow("text failed");
        expect(words[0].word.dispose).toHaveBeenCalledTimes(1);
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        // Plaza plate + card plate + one keycap outline per row.
        expect(geoDispose).toHaveBeenCalledTimes(2 + W.controlsCard.rows);
        geoDispose.mockRestore();
        expect(ctx.group.children).toHaveLength(0);
    });

    it("the card's plate and outlines follow the desktopOnly rule of its text", () => {
        const shown = build(stubCtx({ desktopVisible: true }).ctx);
        expect(shown.controls.chrome.visible).toBe(true);
        const { ctx } = stubCtx({ desktopVisible: false });
        const hidden = build(ctx);
        expect(hidden.controls.chrome.visible).toBe(false);
        // A runtime change (resize to landscape) is mirrored on the next update.
        (hidden.controls.texts[0].mesh as unknown as { visible: boolean }).visible = true;
        hidden.update!(1 / 60, 0, rt(0, 12));
        expect(hidden.controls.chrome.visible).toBe(true);
    });

    it("plaza plate covers the rect on the plaza layer", () => {
        const { ctx } = stubCtx();
        build(ctx);
        const plaza = ctx.group.getObjectByName("welcome-plaza") as THREE.Mesh;
        expect(plaza).toBeDefined();
        ctx.group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(plaza);
        const r = AREA_BY_ID.welcome.rect;
        expect(b.min.x).toBeCloseTo(r.x - r.w / 2, 6);
        expect(b.max.x).toBeCloseTo(r.x + r.w / 2, 6);
        expect(b.min.z).toBeCloseTo(r.z - r.d / 2, 6);
        expect(b.max.z).toBeCloseTo(r.z + r.d / 2, 6);
        expect(b.max.y).toBeCloseTo(shapes.LAYERS.plaza.y, 6);
        expect(plaza.receiveShadow).toBe(true);
        expect(plaza.castShadow).toBe(false);
    });

    it("draws its two path labels (P1 CROSSROADS, P7 ABOUT & CONTACT) beside their paths", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        const labels = texts.filter((t) => t.kind === "onPath");
        expect(labels.map((t) => t.opts.text).sort()).toEqual(["ABOUT & CONTACT", "CROSSROADS"]);
        expect(h.pathLabels).toHaveLength(2);
        const want = labelsOwnedBy("welcome");
        for (const t of labels) {
            const p = want.find((w) => w.text === t.opts.text)!;
            expect(t.handle.object.position.x).toBeCloseTo(p.x, 9);
            expect(t.handle.object.position.z).toBeCloseTo(p.z, 9);
            expect(t.opts.angle).toBeCloseTo(p.angle, 12);
            expect(t.handle.object.parent).toBe(ctx.group);
        }
    });

    it("dispose frees every text and the hero word (its bodies), once", () => {
        const { ctx, texts, words } = stubCtx();
        const h = build(ctx);
        h.dispose!();
        h.dispose!();
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(words[0].word.dispose).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
        // A disposed area ignores late updates / resets.
        h.update!(1 / 60, 0, rt(500, 500));
        h.reset!();
        expect(words[0].word.reset).not.toHaveBeenCalled();
    });
});
