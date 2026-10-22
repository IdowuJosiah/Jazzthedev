import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { creditsSignLine } from "@/app/field/content/world";
import { ACCENT, FACE_CAMERA_Y, PALETTE } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT, JETTY, PADS, estimateTextWidth, footprintCorners, padFootprint, pointInRect } from "../Layout";
import { registeredAreaIds } from "../Areas";
import * as shapes from "../utils/shapes";
import { Disposal } from "../utils/disposal";
import type { AreaContext, MaterialsApi, TextApi, TextHandle, TextOpts, WorldInteractable } from "../types";
import { POST_SECTION, SIGN_MARGIN, SIGN_TYPE, build, packSeparated } from "./Credits";

type TextCall = { kind: "flat" | "upright" | "onPath"; opts: TextOpts; handle: TextHandle };

function stubCtx(fail: { collider?: boolean } = {}) {
    const texts: TextCall[] = [];
    const interactables: WorldInteractable[] = [];
    const unregistered: WorldInteractable[] = [];
    const bodies: { half: unknown; pos: unknown; quat: THREE.Quaternion; body: object }[] = [];
    const removed: object[] = [];
    const lambert = vi.fn<(hex: string, o?: object) => THREE.MeshLambertMaterial>(() => new THREE.MeshLambertMaterial());
    const basic = vi.fn<(hex: string, o?: object) => THREE.MeshBasicMaterial>(() => new THREE.MeshBasicMaterial());
    const openMenu = vi.fn();
    const makeText =
        (kind: TextCall["kind"]) =>
        (o: TextOpts): TextHandle => {
            const mesh = { renderOrder: 0, textAlign: "left", visible: true };
            const handle = { object: new THREE.Group(), mesh, setText() {}, setColor() {}, dispose: vi.fn() } as unknown as TextHandle;
            texts.push({ kind, opts: o, handle });
            return handle;
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
        text: { flat: makeText("flat"), upright: makeText("upright"), onPath: makeText("onPath") } as unknown as TextApi,
        text3d: {
            word: () => {
                throw new Error("credits has no 3D title");
            },
        },
        assets: {},
        audio: {},
        commands: { openMenu, openUrl: vi.fn(), resetPlayground: vi.fn() },
        disposal: new Disposal(),
        runtime: { carPos: new THREE.Vector3(), carSpeed: 0, reducedMotion: false, muted: true, isTouch: false },
        def: AREA_BY_ID.credits,
        layout: Layout,
        addInteractable: (i: WorldInteractable) => {
            interactables.push(i);
            return () => unregistered.push(i);
        },
    } as unknown as AreaContext;
    return { ctx, texts, interactables, unregistered, bodies, removed, lambert, basic, openMenu };
}

const C = AREA_LAYOUT.credits;
const S = C.sign;
const faceCameraQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
const COPY_WIDTH = S.w - 2 * SIGN_MARGIN;
/** Inter cap height per em, rounded up (the vertical fit check errs on the safe side). */
const INTER_CAP = 0.75;

describe("areas/Credits (§2.2, §2.4, §5.3)", () => {
    it("registers itself as the credits builder", () => {
        expect(registeredAreaIds()).toContain("credits");
    });

    describe("packSeparated", () => {
        it("keeps a line that fits as one line", () => {
            expect(packSeparated("a · b", " · ", 100, 1)).toBe("a · b");
        });

        it("breaks only at separators, drops the separator at each break, and every line fits", () => {
            const packed = packSeparated(creditsSignLine, SIGN_TYPE.line.separator, COPY_WIDTH, SIGN_TYPE.line.size);
            const lines = packed.split("\n");
            expect(lines.length).toBeGreaterThan(1);
            for (const l of lines) {
                expect(l.startsWith("·")).toBe(false);
                expect(l.endsWith("·")).toBe(false);
                expect(l).toBe(l.trim());
                expect(estimateTextWidth(l, SIGN_TYPE.line.size)).toBeLessThanOrEqual(COPY_WIDTH);
            }
            // Nothing lost or reordered: re-joining gives the original line.
            expect(lines.join(SIGN_TYPE.line.separator)).toBe(creditsSignLine);
        });

        it("gives an item wider than maxWidth a line of its own", () => {
            expect(packSeparated("a · a-very-long-name · b", " · ", estimateTextWidth("a · b", 1), 1)).toBe(
                "a\na-very-long-name\nb"
            );
        });
    });

    it("sign: paper RoundedBox(7, 3.6, 0.3) on two ink posts at (0, −196), faceCamera, on the jetty", () => {
        const { ctx, lambert } = stubCtx();
        const h = build(ctx);
        expect(h.sign.parent).toBe(ctx.group);
        expect([h.sign.position.x, h.sign.position.y, h.sign.position.z]).toEqual([S.x, 0, S.z]);
        expect(h.sign.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        const bb = new THREE.Box3().setFromBufferAttribute(h.board.geometry.getAttribute("position") as THREE.BufferAttribute);
        expect(bb.max.x - bb.min.x).toBeCloseTo(S.w, 6);
        expect(bb.max.y - bb.min.y).toBeCloseTo(S.h, 6);
        expect(bb.max.z - bb.min.z).toBeCloseTo(S.d, 6);
        expect(h.board.position.y).toBeCloseTo(S.postH + S.h / 2, 9);
        expect(h.posts).toHaveLength(2);
        for (const post of h.posts) {
            const pb = new THREE.Box3().setFromBufferAttribute(post.geometry.getAttribute("position") as THREE.BufferAttribute);
            expect(pb.max.y - pb.min.y).toBeCloseTo(S.postH, 6);
            expect(pb.max.x - pb.min.x).toBeCloseTo(POST_SECTION, 6);
            expect(post.position.y).toBeCloseTo(S.postH / 2, 9);
            expect(Math.abs(post.position.x) + POST_SECTION / 2).toBeLessThan(S.w / 2);
        }
        expect(h.posts[0].position.x).toBeCloseTo(-h.posts[1].position.x, 12);
        for (const m of [h.board, ...h.posts]) {
            expect(m.castShadow).toBe(true);
            expect(m.receiveShadow).toBe(true);
        }
        expect(lambert).toHaveBeenCalledWith(PALETTE.paper);
        expect(lambert).toHaveBeenCalledWith(PALETTE.ink);
        // The whole sign (rotated) stands on the deck.
        const fp = footprintCorners({ x: S.x, z: S.z, hu: S.w / 2, hv: S.d / 2, rot: FACE_CAMERA_Y });
        for (const c of fp) expect(pointInRect(JETTY.rect, c.x, c.z)).toBe(true);
    });

    it("one fixed cuboid collider covers the board and posts, rotated faceCamera", () => {
        const { ctx, bodies } = stubCtx();
        const h = build(ctx);
        expect(bodies).toHaveLength(1);
        const top = S.postH + S.h;
        expect(bodies[0].half).toEqual({ x: S.w / 2, y: top / 2, z: S.d / 2 });
        expect(bodies[0].pos).toEqual({ x: S.x, y: top / 2, z: S.z });
        expect(bodies[0].quat.angleTo(faceCameraQuat)).toBeCloseTo(0, 9);
        expect(h.collider).toBe(bodies[0].body);
    });

    it("upright copy on the board face: CREDITS Inter Bold 0.9 ink, credit line Inter Medium 0.55 ink2", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        expect(texts).toHaveLength(2);
        expect(texts.every((t) => t.kind === "upright")).toBe(true);
        const heading = texts.find((t) => t.handle === h.heading)!;
        const line = texts.find((t) => t.handle === h.line)!;
        expect(heading.opts).toMatchObject({ text: "CREDITS", font: "bold", size: 0.9, color: PALETTE.ink, anchorX: "center" });
        expect(line.opts).toMatchObject({
            font: "medium",
            size: 0.55,
            color: PALETTE.ink2,
            maxWidth: COPY_WIDTH,
            anchorX: "center",
            anchorY: "middle",
        });
        expect(line.opts.text.replace(/\n/g, SIGN_TYPE.line.separator)).toBe(creditsSignLine);
        expect((h.line.mesh as unknown as { textAlign: string }).textAlign).toBe("center");
        for (const t of [h.heading, h.line]) {
            expect(t.object.parent).toBe(h.sign);
            expect(t.object.position.x).toBe(0);
            expect(t.object.position.z).toBeGreaterThan(S.d / 2); // in front of the face
            expect(t.object.position.y).toBeGreaterThan(S.postH);
            expect(t.object.position.y).toBeLessThan(S.postH + S.h);
        }
        expect(h.heading.object.position.y).toBeGreaterThan(h.line.object.position.y);
    });

    it("the credit-line block fits between the heading and the board's bottom margin", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        const line = texts.find((t) => t.handle === h.line)!;
        const n = line.opts.text.split("\n").length;
        const block = n * SIGN_TYPE.line.size * SIGN_TYPE.line.lineHeight;
        const headingBaseline = h.heading.object.position.y - SIGN_TYPE.title.size * INTER_CAP;
        const blockTop = h.line.object.position.y + block / 2;
        const blockBottom = h.line.object.position.y - block / 2;
        expect(blockTop).toBeLessThan(headingBaseline);
        expect(blockBottom).toBeGreaterThan(S.postH);
        // Heading cap top inside the board.
        expect(h.heading.object.position.y).toBeLessThan(S.postH + S.h);
    });

    it("pad on the deck at (0, −190), 6×5, faceCamera, plates layer; E opens Menu → Credits synchronously", () => {
        const { ctx, interactables, openMenu, basic } = stubCtx();
        const h = build(ctx);
        const spot = PADS.find((p) => p.id === "credits")!;
        expect(spot.pad).toEqual({ x: 0, z: -190, w: 6, d: 5, faceCamera: true });
        expect(h.pad.group.parent).toBe(ctx.group);
        expect([h.pad.group.position.x, h.pad.group.position.z]).toEqual([spot.pad.x, spot.pad.z]);
        expect(h.pad.group.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(h.pad.label).toBeNull();
        for (const c of footprintCorners(padFootprint(spot.pad))) expect(pointInRect(JETTY.rect, c.x, c.z)).toBe(true);
        for (const call of basic.mock.calls) expect(call[1]).toMatchObject({ layer: "plate" });
        expect(basic).toHaveBeenCalledWith(ACCENT.brand, expect.objectContaining({ layer: "plate" }));

        expect(interactables).toHaveLength(1);
        const it = interactables[0];
        expect(it.pad).toBe(spot.pad);
        expect(it.areaId).toBe("credits");
        expect(it.content).toBeUndefined();
        expect(it.prompt.title).toBe("Credits");
        it.onInteract!();
        expect(openMenu).toHaveBeenCalledTimes(1);
        expect(openMenu).toHaveBeenCalledWith("credits");
        it.setActive!(true);
        expect(h.pad.active).toBe(true);
        it.setActive!(false);
        expect(h.pad.active).toBe(false);
    });

    it("the pad and the sign are in the credits rect; the pad sits between the arrival and the sign", () => {
        const r = AREA_BY_ID.credits.rect;
        expect(pointInRect(r, C.pad.x, C.pad.z)).toBe(true);
        expect(pointInRect(r, S.x, S.z)).toBe(true);
        const arrival = AREA_BY_ID.credits.arrival;
        expect(C.pad.z).toBeLessThan(arrival.z);
        expect(S.z).toBeLessThan(C.pad.z);
    });

    it("dispose removes the collider, unregisters the pad, frees texts and geometries, once", () => {
        const { ctx, texts, interactables, unregistered, bodies, removed } = stubCtx();
        const h = build(ctx);
        const padDispose = vi.spyOn(h.pad, "dispose");
        const geoSpies = [h.board.geometry, h.posts[0].geometry].map((g) => vi.spyOn(g, "dispose"));
        h.dispose!();
        h.dispose!();
        expect(removed).toEqual([bodies[0].body]);
        expect(unregistered).toEqual(interactables);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(padDispose).toHaveBeenCalledTimes(1);
        for (const s of geoSpies) expect(s).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
    });

    it("a builder that throws leaves no collider, frees what it built and rethrows", () => {
        const { ctx, texts, interactables, unregistered, bodies } = stubCtx({ collider: true });
        expect(() => build(ctx)).toThrow("physics failed");
        expect(bodies).toHaveLength(0);
        expect(interactables).toHaveLength(1);
        expect(unregistered).toEqual(interactables);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
    });
});
