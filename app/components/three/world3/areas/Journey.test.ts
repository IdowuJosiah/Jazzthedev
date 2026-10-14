import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { journeyStops, skillTotems } from "@/app/field/content/world";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT, PADS, PATHS, estimateTextWidth, pathHalfWidth } from "../Layout";
import { registeredAreaIds } from "../Areas";
import * as shapes from "../utils/shapes";
import { Disposal } from "../utils/disposal";
import type {
    AreaContext,
    Letter3D,
    MaterialsApi,
    TextApi,
    TextHandle,
    TextOpts,
    Word3D,
    Word3DOptions,
    WorldInteractable,
} from "../types";
import {
    NOW_TEXT,
    PLATE_COPY_INSET,
    PLATE_LINE_HEIGHT,     PLATE_TEXT_LAYER,
    PLATE_TEXT_RENDER_ORDER,
    build,
    skillsContent,
} from "./Journey";

type TextCall = { kind: "flat" | "upright" | "onPath"; opts: TextOpts; handle: TextHandle };

function stubCtx(fail: { interactableAt?: number } = {}) {
    const texts: TextCall[] = [];
    const words: { text: string; opts: Word3DOptions; word: Word3D & { dispose: ReturnType<typeof vi.fn> } }[] = [];
    const interactables: WorldInteractable[] = [];
    const unregistered: WorldInteractable[] = [];
    const lambert = vi.fn<(hex: string, o?: object) => THREE.MeshLambertMaterial>(() => new THREE.MeshLambertMaterial());
    const basic = vi.fn<(hex: string, o?: object) => THREE.MeshBasicMaterial>(() => new THREE.MeshBasicMaterial());
    const makeText =
        (kind: TextCall["kind"]) =>
        (o: TextOpts): TextHandle => {
            const object = new THREE.Group();
            const mesh = { renderOrder: 0, visible: true };
            const handle = { object, mesh, setText() {}, setColor() {}, dispose: vi.fn() } as unknown as TextHandle;
            texts.push({ kind, opts: o, handle });
            return handle;
        };
    const ctx = {
        group: new THREE.Group(),
        physics: {},
        materials: { lambert, basic } as unknown as MaterialsApi,
        shapes,
        text: { flat: makeText("flat"), upright: makeText("upright"), onPath: makeText("onPath") } as unknown as TextApi,
        text3d: {
            word: (text: string, o: Word3DOptions) => {
                const group = new THREE.Group();
                const letters: Letter3D[] = Array.from(text).map(() => ({
                    mesh: new THREE.Mesh(),
                    home: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
                }));
                const word = { group, letters, reset: vi.fn(), dispose: vi.fn() };
                words.push({ text, opts: o, word });
                return word;
            },
        },
        assets: {},
        audio: {},
        commands: {},
        disposal: new Disposal(),
        runtime: { carPos: new THREE.Vector3(), carSpeed: 0, reducedMotion: false, muted: true, isTouch: false },
        def: AREA_BY_ID.journey,
        layout: Layout,
        addInteractable: (i: WorldInteractable) => {
            if (fail.interactableAt !== undefined && interactables.length === fail.interactableAt) {
                throw new Error("registry failed");
            }
            interactables.push(i);
            return () => unregistered.push(i);
        },
    } as unknown as AreaContext;
    return { ctx, texts, words, interactables, unregistered, lambert, basic };
}

const J = AREA_LAYOUT.journey;
const TY = CONFIG.type;
const N_MILESTONES = J.milestones.length;
const N_SKILLS = J.skills.length;
const accentNumber = parseInt(ACCENT.journey.slice(1), 16);

/** World position of an object (after its parents' transforms). */
function worldOf(obj: THREE.Object3D): THREE.Vector3 {
    obj.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
}

/**
 * Greedy word wrap with Layout's conservative width estimate: an upper bound
 * on the lines troika will set (Inter is narrower than the estimate).
 */
function estimateLines(text: string, size: number, maxWidth: number): number {
    let lines = 1;
    let current = "";
    for (const word of text.split(" ")) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && estimateTextWidth(candidate, size) > maxWidth) {
            lines++;
            current = word;
        } else current = candidate;
    }
    return lines;
}

/** Glyph ratios (per em) for the vertical fit check: generous on purpose. */
const INTER_CAP = 0.75;
const DISPLAY_CAP = TY.capRatioFallback;
const DESCENDER = 0.25;
/** Milestone title wrap width: Layout's titleMaxWidth, capped by the copy inset. */
const TITLE_MAX_WIDTH = Math.min(J.milestonePlate.titleMaxWidth, J.milestonePlate.w - 2 * PLATE_COPY_INSET);

describe("areas/Journey (§2.4, §5.2, §5.3)", () => {
    it("registers itself as the journey builder", () => {
        expect(registeredAreaIds()).toContain("journey");
    });

    it("builds the static JOURNEY title in ACCENT_INK.journey at its Layout point, faceCamera", () => {
        const { ctx, words } = stubCtx();
        const h = build(ctx);
        const t3 = AREA_BY_ID.journey.title3D!;
        expect(words).toHaveLength(1);
        expect(words[0].text).toBe("JOURNEY");
        expect(words[0].opts).toMatchObject({
            cap: TY.areaTitle.cap,
            depth: TY.areaTitle.depth,
            curveSegments: TY.areaTitle.curveSegments,
            color: AREA_BY_ID.journey.accentInk,
            dynamic: false,
        });
        const g = words[0].word.group;
        expect(g.parent).toBe(ctx.group);
        expect([g.position.x, g.position.y, g.position.z]).toEqual([t3.x, 0, t3.z]);
        expect(g.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(h.title).toBe(words[0].word);
        // Areas arms the word after build().
        expect(words[0].word.reset).not.toHaveBeenCalled();
    });

    it("lays one paper plate per journey stop at the Layout points, faceCamera, on the plate layer", () => {
        const { ctx, lambert } = stubCtx();
        const h = build(ctx);
        expect(N_MILESTONES).toBe(journeyStops.length);
        expect(h.milestones).toHaveLength(N_MILESTONES);
        h.milestones.forEach((m, i) => {
            const p = J.milestones[i];
            expect(m.group.parent).toBe(ctx.group);
            expect([m.group.position.x, m.group.position.z]).toEqual([p.x, p.z]);
            expect(m.group.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
            const b = new THREE.Box3().setFromBufferAttribute(
                m.plate.geometry.getAttribute("position") as THREE.BufferAttribute
            );
            expect(b.max.x - b.min.x).toBeCloseTo(J.milestonePlate.w, 6);
            expect(b.max.z - b.min.z).toBeCloseTo(J.milestonePlate.d, 6);
            expect(b.max.y).toBeCloseTo(shapes.LAYERS.plate.y, 9);
            expect(m.plate.receiveShadow).toBe(true);
            expect(m.plate.castShadow).toBe(false);
        });
        expect(lambert).toHaveBeenCalledWith(PALETTE.paper, { layer: "plate" });
    });

    it("milestone copy: year in Bricolage 1.5 ACCENT_INK, title in Inter Bold 0.8 ink, maxWidth ≤ 8, on the plate", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        h.milestones.forEach((m, i) => {
            const [year, title] = m.texts;
            const yc = texts.find((t) => t.handle === year)!;
            const tc = texts.find((t) => t.handle === title)!;
            expect(yc.kind).toBe("flat");
            expect(yc.opts).toMatchObject({
                text: journeyStops[i].year,
                font: "display",
                size: TY.numerals.min,
                color: AREA_BY_ID.journey.accentInk,
                layer: PLATE_TEXT_LAYER,
                anchorY: "top-cap",
            });
            expect(tc.opts).toMatchObject({
                text: journeyStops[i].title,
                font: "bold",
                size: 0.8,
                color: PALETTE.ink,
                maxWidth: TITLE_MAX_WIDTH,
                layer: PLATE_TEXT_LAYER,
                anchorY: "bottom-baseline",
            });
            for (const t of [year, title]) {
                expect(t.object.parent).toBe(m.group);
                expect(t.object.position.y).toBe(0); // flat text sits at its layer height already
                expect(Math.abs(t.object.position.x)).toBeLessThan(J.milestonePlate.w / 2);
                expect(Math.abs(t.object.position.z)).toBeLessThan(J.milestonePlate.d / 2);
                // Drawn after the active pad fill, so the fill never veils it.
                expect(t.mesh.renderOrder).toBe(PLATE_TEXT_RENDER_ORDER);
            }
            // Same left inset for both lines; year above (−S), title below.
            expect(year.object.position.x).toBeCloseTo(title.object.position.x, 12);
            expect(year.object.position.z).toBeLessThan(title.object.position.z);
        });
    });

    it("plate copy text is the plate layer the look system reads (padOnPlate, above the plate and its pad)", () => {
        expect(PLATE_TEXT_LAYER).toBe("padOnPlate");
        expect(shapes.LAYERS[PLATE_TEXT_LAYER].y).toBeGreaterThan(shapes.LAYERS.plate.y);
        expect(PLATE_TEXT_RENDER_ORDER).toBeGreaterThan(shapes.LAYERS.padOnPlate.renderOrder);
    });

    it("plate copy keeps clear of the active pad outline on every side", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        // The active outline lies inside the plate edge; the copy starts past it with clear space.
        const clear = PLATE_COPY_INSET - CONFIG.pad.activeLineWidth;
        expect(clear).toBeGreaterThanOrEqual(DESCENDER * TY.minFlatSize + 0.1);
        expect(TITLE_MAX_WIDTH).toBeLessThanOrEqual(J.milestonePlate.titleMaxWidth);
        const check = (plates: typeof h.milestones, w: number, d: number) => {
            for (const p of plates) {
                const [head, body] = p.texts;
                expect(head.object.position.x).toBeCloseTo(-w / 2 + PLATE_COPY_INSET, 12);
                expect(head.object.position.z).toBeCloseTo(-d / 2 + PLATE_COPY_INSET, 12);
                expect(body.object.position.z).toBeCloseTo(d / 2 - PLATE_COPY_INSET, 12);
                // The body's descenders (below its baseline) stay off the outline.
                const bodyOpts = texts.find((t) => t.handle === body)!.opts;
                const descBottom = body.object.position.z + bodyOpts.size * DESCENDER;
                expect(descBottom).toBeLessThan(d / 2 - CONFIG.pad.activeLineWidth);
                // Wrapped copy stays inside the outline on the right too.
                for (const t of [head, body]) {
                    const o = texts.find((c) => c.handle === t)!.opts;
                    if (o.maxWidth !== undefined) {
                        expect(t.object.position.x + o.maxWidth).toBeLessThanOrEqual(w / 2 - PLATE_COPY_INSET + 1e-9);
                    }
                }
            }
        };
        check(h.milestones, J.milestonePlate.w, J.milestonePlate.d);
        check(h.skills, J.skillPlate.w, J.skillPlate.d);
    });

    it("heading and body never collide on a plate (conservative line estimate)", () => {
        const MP = J.milestonePlate;
        const inset = PLATE_COPY_INSET;
        const lh = PLATE_LINE_HEIGHT;
        for (const stop of journeyStops) {
            const yearBottom = -MP.d / 2 + inset + TY.numerals.min * DISPLAY_CAP + TY.numerals.min * DESCENDER;
            const n = estimateLines(stop.title, TY.minFlatSize, TITLE_MAX_WIDTH);
            const titleTop = MP.d / 2 - inset - (n - 1) * TY.minFlatSize * lh - TY.minFlatSize * INTER_CAP;
            expect(n).toBeLessThanOrEqual(2);
            expect(yearBottom).toBeLessThan(titleTop);
        }
        const SP = J.skillPlate;
        const maxW = SP.w - 2 * inset;
        for (const s of skillTotems) {
            const nc = estimateLines(s.category, TY.floorCaption.size, maxW);
            const np = estimateLines(s.proof, TY.minFlatSize, maxW);
            const catBottom =
                -SP.d / 2 +
                inset +
                TY.floorCaption.size * INTER_CAP +
                (nc - 1) * TY.floorCaption.size * lh +
                TY.floorCaption.size * DESCENDER;
            const proofTop = SP.d / 2 - inset - (np - 1) * TY.minFlatSize * lh - TY.minFlatSize * INTER_CAP;
            expect(catBottom).toBeLessThan(proofTop);
        }
    });

    it("every plate is its own pad: outline + fill on padOnPlate, no label, Layout's pad", () => {
        const { ctx, interactables, basic } = stubCtx();
        const h = build(ctx);
        expect(interactables).toHaveLength(N_MILESTONES + N_SKILLS);
        const plates = [...h.milestones, ...h.skills];
        const ids = [
            ...J.milestones.map((_, i) => `milestone-${i}`),
            ...J.skills.map((_, i) => `skill-${i}`),
        ];
        plates.forEach((p, k) => {
            const spot = PADS.find((s) => s.id === ids[k])!;
            const it = interactables[k];
            expect(it.pad).toBe(spot.pad);
            expect(it.areaId).toBe("journey");
            expect(p.pad.label).toBeNull();
            expect(p.pad.group.parent).toBe(ctx.group);
            expect([p.pad.group.position.x, p.pad.group.position.z]).toEqual([spot.pad.x, spot.pad.z]);
            // The highlight toggles through the interactable.
            expect(p.pad.active).toBe(false);
            it.setActive!(true);
            expect(p.pad.active).toBe(true);
            it.setActive!(false);
            expect(p.pad.active).toBe(false);
        });
        for (const call of basic.mock.calls) expect(call[1]).toMatchObject({ layer: "padOnPlate" });
        // Pad outlines use the area accent (shapes), never ACCENT_INK.
        expect(basic).toHaveBeenCalledWith(ACCENT.journey, expect.objectContaining({ layer: "padOnPlate" }));
    });

    it("a milestone pad opens that stop's panel; a skill pad opens the full skills list", () => {
        const { ctx, interactables } = stubCtx();
        build(ctx);
        journeyStops.forEach((stop, i) => {
            const it = interactables[i];
            expect(it.onInteract).toBeUndefined();
            expect(it.content).toEqual({ title: stop.title, sub: stop.year, body: stop.body, accent: accentNumber });
            expect(it.prompt.title).toBe(stop.title);
        });
        const all = skillsContent(accentNumber);
        expect(all.sections).toHaveLength(skillTotems.length);
        skillTotems.forEach((s, i) => {
            const it = interactables[N_MILESTONES + i];
            expect(it.onInteract).toBeUndefined();
            expect(it.content).toEqual(all);
            expect(it.prompt.title).toBe(s.category);
            expect(all.sections![i].heading).toBe(s.category);
            expect(all.sections![i].text).toContain(s.proof);
            for (const skill of s.skills) expect(all.sections![i].text).toContain(skill);
        });
    });

    it("skill copy: category Inter Bold 0.9 ink, proof Inter Medium 0.8 ink2, at the west plates", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        expect(h.skills).toHaveLength(skillTotems.length);
        h.skills.forEach((s, i) => {
            expect([s.group.position.x, s.group.position.z]).toEqual([J.skills[i].x, J.skills[i].z]);
            expect(J.skills[i].x).toBeLessThan(J.trailX); // west of the trail
            const [cat, proof] = s.texts.map((h2) => texts.find((t) => t.handle === h2)!);
            expect(cat.opts).toMatchObject({
                text: skillTotems[i].category,
                font: "bold",
                size: 0.9,
                color: PALETTE.ink,
                layer: PLATE_TEXT_LAYER,
            });
            expect(proof.opts).toMatchObject({
                text: skillTotems[i].proof,
                font: "medium",
                size: 0.8,
                color: PALETTE.ink2,
                layer: PLATE_TEXT_LAYER,
            });
            for (const t of [cat, proof]) {
                expect(t.opts.maxWidth).toBeLessThan(J.skillPlate.w);
                expect(t.handle.object.parent).toBe(s.group);
            }
        });
    });

    it("NOW is flat Bricolage 1.8 ink on the trail tiles (tileText layer), faceCamera", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        const now = texts.find((t) => t.opts.text === NOW_TEXT)!;
        expect(now.kind).toBe("flat");
        expect(now.opts).toMatchObject({ font: "display", size: J.now.size, color: PALETTE.ink, layer: "tileText" });
        expect(J.now.size).toBe(1.8);
        expect(h.now).toBe(now.handle);
        const p = worldOf(now.handle.object);
        expect([p.x, p.y, p.z]).toEqual([J.now.x, 0, J.now.z]);
        expect(now.handle.object.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        // On P4's tiles: within its tile band and before its end.
        const p4 = PATHS.find((q) => q.id === "P4")!;
        expect(Math.abs(J.now.x - p4.from.x)).toBeLessThan(pathHalfWidth(p4));
        expect(J.now.z).toBeLessThan(p4.from.z);
        expect(J.now.z).toBeGreaterThan(p4.to.z);
    });

    it("draws only flat text (no upright copy, no desktopOnly copy, no keycap)", () => {
        const { ctx, texts } = stubCtx();
        build(ctx);
        expect(texts.every((t) => t.kind === "flat")).toBe(true);
        expect(texts.some((t) => t.opts.desktopOnly)).toBe(false);
        expect(texts).toHaveLength(2 * N_MILESTONES + 2 * N_SKILLS + 1);
        // Title, 9 plate roots, 9 pads, NOW.
        expect(ctx.group.children).toHaveLength(1 + 2 * (N_MILESTONES + N_SKILLS) + 1);
    });

    it("dispose unregisters every pad and frees texts, the title and geometries, once", () => {
        const { ctx, texts, words, interactables, unregistered } = stubCtx();
        const h = build(ctx);
        const padSpies = [...h.milestones, ...h.skills].map((p) => vi.spyOn(p.pad, "dispose"));
        const plateGeos = new Set([h.milestones[0].plate.geometry, h.skills[0].plate.geometry]);
        const geoSpies = [...plateGeos].map((g) => vi.spyOn(g, "dispose"));
        h.dispose!();
        h.dispose!();
        expect(unregistered).toHaveLength(interactables.length);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(words[0].word.dispose).toHaveBeenCalledTimes(1);
        for (const s of padSpies) expect(s).toHaveBeenCalledTimes(1);
        for (const s of geoSpies) expect(s).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
    });

    it("a builder that throws frees what it built and rethrows", () => {
        const { ctx, texts, words, interactables, unregistered } = stubCtx({ interactableAt: N_MILESTONES + 1 });
        expect(() => build(ctx)).toThrow("registry failed");
        expect(unregistered).toHaveLength(interactables.length);
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(words[0].word.dispose).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
    });
});
