import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { frontendProjects } from "@/app/field/content/world";
import { ACCENT, ACCENT_INK, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import * as Layout from "../Layout";
import {
    AREA_BY_ID,
    AREA_LAYOUT,
    PADS,
    PATHS,
    PROPS,
    estimateTextWidth,
    footprintCorners,
    footprintsOverlap,
    padFootprint,
    pointInRect,
    type Footprint,
} from "../Layout";
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
import { boardStripLayout, boardTagLine, build, fitTitleSize, projectContent } from "./Projects";

const P = AREA_LAYOUT.projects;
const B = P.board;
const TY = CONFIG.type;
const N = frontendProjects.length;

type TextCall = { kind: "flat" | "upright" | "onPath"; opts: TextOpts; handle: TextHandle };

interface StubMesh {
    fontSize: number;
    maxWidth: number;
    textRenderInfo: { blockBounds: [number, number, number, number] } | null;
    sync: ReturnType<typeof vi.fn>;
}

/** em width troika "measures" per character in the stub (title auto-fit). */
const STUB_EM_PER_CHAR = 0.62;

function stubCtx(fail: { collider?: number; pad?: boolean } = {}) {
    const texts: TextCall[] = [];
    const words: { text: string; opts: Word3DOptions; word: Word3D & { dispose: ReturnType<typeof vi.fn> } }[] = [];
    const bodies: { half: unknown; pos: unknown; quat: unknown; body: object }[] = [];
    const removed: object[] = [];
    const interactables: WorldInteractable[] = [];
    const unregistered: WorldInteractable[] = [];
    const registered: { url: string; x: number; z: number }[] = [];
    const listeners = new Set<(url: string, tex: THREE.Texture) => void>();
    const loaded = new Map<string, THREE.Texture>();
    const lambert = vi.fn<(hex: string, o?: object) => THREE.MeshLambertMaterial>(() => new THREE.MeshLambertMaterial());
    const basic = vi.fn<(hex: string, o?: object) => THREE.MeshBasicMaterial>(() => new THREE.MeshBasicMaterial());

    const makeText =
        (kind: TextCall["kind"]) =>
        (o: TextOpts): TextHandle => {
            if (fail.pad && kind === "flat") throw new Error("pad label failed");
            const mesh: StubMesh = {
                fontSize: o.size,
                maxWidth: o.maxWidth ?? Infinity,
                textRenderInfo: null,
                sync: vi.fn((cb?: () => void) => {
                    const w = Array.from(o.text).length * STUB_EM_PER_CHAR * mesh.fontSize;
                    mesh.textRenderInfo = { blockBounds: [0, -mesh.fontSize, w, 0] };
                    cb?.();
                }),
            };
            const handle = {
                object: new THREE.Group(),
                mesh,
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
            addFixedCuboid: (half: unknown, pos: unknown, quat: unknown) => {
                if (fail.collider !== undefined && bodies.length === fail.collider) throw new Error("physics failed");
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
            word: (text: string, o: Word3DOptions) => {
                const word = {
                    group: new THREE.Group(),
                    letters: [],
                    reset: vi.fn(),
                    dispose: vi.fn(),
                };
                words.push({ text, opts: o, word });
                return word;
            },
        },
        assets: {
            boards: {
                register: (url: string, x: number, z: number) => registered.push({ url, x, z }),
                request: vi.fn(),
                get: (url: string) => loaded.get(url) ?? null,
                onLoaded: (cb: (url: string, tex: THREE.Texture) => void) => {
                    listeners.add(cb);
                    return () => listeners.delete(cb);
                },
            },
        },
        audio: {},
        commands: {},
        disposal: new Disposal(),
        runtime,
        def: AREA_BY_ID.projects,
        layout: Layout,
        addInteractable: (i: WorldInteractable) => {
            interactables.push(i);
            return () => unregistered.push(i);
        },
    } as unknown as AreaContext;

    /** Simulates the board loader finishing `url`. */
    const finish = (url: string, tex = new THREE.Texture()) => {
        loaded.set(url, tex);
        for (const cb of [...listeners]) cb(url, tex);
        return tex;
    };
    return {
        ctx,
        texts,
        words,
        bodies,
        removed,
        interactables,
        unregistered,
        registered,
        listeners,
        loaded,
        lambert,
        basic,
        runtime,
        finish,
    };
}

const uprights = (texts: TextCall[]) => texts.filter((t) => t.kind === "upright");

describe("areas/Projects (§2.4, §5.1)", () => {
    it("registers itself as the projects builder", () => {
        expect(registeredAreaIds()).toContain("projects");
    });

    describe("layout fits every project", () => {
        it("one board and one pad per frontendProjects entry (four, incl. Clay Studio Creations)", () => {
            expect(N).toBe(4);
            expect(frontendProjects.map((p) => p.title)).toContain("Clay Studio Creations");
            expect(P.boards).toHaveLength(N);
            expect(PADS.filter((p) => p.areaId === "projects")).toHaveLength(N);
        });

        it("every board, pad and the title sit inside the projects rect; pads also in the gallery zone", () => {
            const def = AREA_BY_ID.projects;
            const boards = PROPS.filter((p) => p.id.startsWith("board-"));
            expect(boards).toHaveLength(N);
            const title = PROPS.find((p) => p.id === "title-projects")!;
            for (const f of [...boards.map((b) => b.footprint), title.footprint]) {
                for (const c of footprintCorners(f)) expect(pointInRect(def.rect, c.x, c.z)).toBe(true);
            }
            for (const spot of PADS.filter((p) => p.areaId === "projects")) {
                for (const c of footprintCorners(padFootprint(spot.pad))) {
                    expect(pointInRect(def.rect, c.x, c.z)).toBe(true);
                    expect(pointInRect(def.cameraZone!, c.x, c.z)).toBe(true);
                }
            }
        });

        it("boards and pads never overlap each other, and pads stay off the P2 path", () => {
            const boards = PROPS.filter((p) => p.id.startsWith("board-")).map((p) => p.footprint);
            const pads = PADS.filter((p) => p.areaId === "projects").map((p) => padFootprint(p.pad));
            const all = [...boards, ...pads];
            for (let i = 0; i < all.length; i++) {
                for (let j = i + 1; j < all.length; j++) expect(footprintsOverlap(all[i], all[j])).toBe(false);
            }
            const p2 = PATHS.find((p) => p.id === "P2")!;
            const half = Layout.pathHalfWidth(p2);
            const strip: Footprint = {
                x: (p2.from.x + p2.to.x) / 2,
                z: p2.from.z,
                hu: Layout.pathLength(p2) / 2,
                hv: half,
                rot: 0,
            };
            for (const f of pads) expect(footprintsOverlap(f, strip)).toBe(false);
        });

        it("pad i is board i + S·12", () => {
            for (let i = 0; i < N; i++) {
                const want = Layout.offsetRS(P.boards[i], 0, 12);
                expect(P.pads[i].x).toBeCloseTo(want.x, 9);
                expect(P.pads[i].z).toBeCloseTo(want.z, 9);
            }
        });
    });

    describe("pure helpers", () => {
        it("fitTitleSize keeps 0.85 when it fits, shrinks to fit 9.6, never below 0.7", () => {
            const T = TY.boardTitle;
            expect(fitTitleSize(5, T.size)).toBe(T.size);
            expect(fitTitleSize(T.maxWidth * 1.1, T.size)).toBeCloseTo(T.size / 1.1, 9);
            expect(fitTitleSize(100, T.size)).toBe(T.minSize);
            expect(fitTitleSize(0, T.size)).toBe(T.size);
            // Scale-free: measured at another size, the fitted width is maxWidth.
            const fitted = fitTitleSize(10, 0.8);
            expect((10 / 0.8) * fitted).toBeCloseTo(T.maxWidth, 9);
        });

        it("every project title fits 9.6 at the 0.7 minimum (estimate), so it never wraps", () => {
            for (const p of frontendProjects) {
                expect(estimateTextWidth(p.title, TY.boardTitle.minSize)).toBeLessThanOrEqual(TY.boardTitle.maxWidth);
            }
        });

        it("every boardPitch is one line: ≤ 32 characters and narrower than the strip", () => {
            for (const p of frontendProjects) {
                expect(Array.from(p.boardPitch).length).toBeLessThanOrEqual(TY.boardPitch.maxChars);
                expect(estimateTextWidth(p.boardPitch, TY.boardPitch.size)).toBeLessThanOrEqual(TY.boardTitle.maxWidth);
            }
        });

        it("boardTagLine uppercases, joins with ' · ' and drops trailing tags that would overflow", () => {
            expect(boardTagLine(["Next.js", "Motion"])).toBe("NEXT.JS · MOTION");
            expect(boardTagLine([])).toBe("");
            const long = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
            const line = boardTagLine(long);
            expect(long[0].toUpperCase()).toBe(line.split(" · ")[0]);
            expect(line.split(" · ").length).toBeLessThan(long.length);
            for (const p of frontendProjects) {
                const l = boardTagLine(p.tags);
                expect(l.length).toBeGreaterThan(0);
                expect(estimateTextWidth(l, TY.boardTags.size, TY.boardTags.letterSpacing)).toBeLessThanOrEqual(
                    TY.boardTitle.maxWidth
                );
                expect(p.tags.map((t) => t.toUpperCase()).join(" · ").startsWith(l)).toBe(true);
            }
        });

        it("boardStripLayout: image at the top of the frame (0.4 margin), lines stacked with equal gaps", () => {
            const s = boardStripLayout(B);
            const frameTop = B.frame.bottom + B.frame.h;
            expect(s.imageY + B.image.h / 2).toBeCloseTo(frameTop - B.image.margin, 9);
            const imageBottom = s.imageY - B.image.h / 2;
            expect(s.gap).toBeGreaterThan(0);
            expect(s.titleTop).toBeCloseTo(imageBottom - s.gap, 9);
            expect(s.titleTop).toBeGreaterThan(s.pitchTop);
            expect(s.pitchTop).toBeGreaterThan(s.tagsTop);
            // One cap/em ratio for every line (Inter), ≈ 0.73.
            const capEm = (s.titleTop - s.gap - s.pitchTop) / TY.boardTitle.size;
            expect(capEm).toBeCloseTo(0.727, 3);
            expect((s.pitchTop - s.gap - s.tagsTop) / TY.boardPitch.size).toBeCloseTo(capEm, 9);
            // The tags' baseline (cap top − cap height) lands on the frame's bottom margin.
            expect(s.tagsTop - capEm * TY.boardTags.size).toBeCloseTo(B.frame.bottom + B.image.margin, 9);
            // Title and pitch descenders (≈ 0.21 em) stay clear of the next line's cap top.
            expect(s.gap).toBeGreaterThan(0.21 * TY.boardTitle.size);
        });

        it("projectContent carries the full InfoContent: image, pitch, description, tags, Visit site", () => {
            for (const p of frontendProjects) {
                const c = projectContent(p);
                expect(c.title).toBe(p.title);
                expect(c.sub).toBe(p.pitch);
                expect(c.body).toBe(p.description);
                expect(c.image).toBe(p.boardImage);
                expect(c.tags).toEqual(p.tags);
                expect(c.accent).toBe(parseInt(ACCENT.projects.slice(1), 16));
                if (p.liveUrl) expect(c.links).toContainEqual({ label: "Visit site", url: p.liveUrl });
                else expect(c.links).toBeUndefined();
            }
            const withRepo = projectContent({ ...frontendProjects[0], liveUrl: undefined, repoUrl: "https://example.com/r" });
            expect(withRepo.links).toEqual([{ label: "View code", url: "https://example.com/r" }]);
        });
    });

    describe("build", () => {
        it("static PROJECTS title in ACCENT_INK.projects at the Layout point, faceCamera", () => {
            const { ctx, words } = stubCtx();
            const h = build(ctx);
            expect(words).toHaveLength(1);
            const w = words[0];
            const t3 = AREA_BY_ID.projects.title3D!;
            expect(w.text).toBe("PROJECTS");
            expect(w.opts).toMatchObject({
                cap: TY.areaTitle.cap,
                depth: TY.areaTitle.depth,
                curveSegments: TY.areaTitle.curveSegments,
                color: ACCENT_INK.projects,
                dynamic: false,
            });
            expect(w.word.group.parent).toBe(ctx.group);
            expect(w.word.group.position.toArray()).toEqual([t3.x, 0, t3.z]);
            expect(w.word.group.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
            expect(h.title).toBe(w.word);
        });

        it("one faceCamera board per project at its Layout base, legs + paper frame casting and receiving", () => {
            const { ctx, lambert } = stubCtx();
            const h = build(ctx);
            expect(h.boards).toHaveLength(N);
            h.boards.forEach((b, i) => {
                expect(b.project).toBe(frontendProjects[i]);
                expect(b.group.parent).toBe(ctx.group);
                expect(b.group.position.toArray()).toEqual([P.boards[i].x, 0, P.boards[i].z]);
                expect(b.group.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
                expect(b.legs.map((l) => l.position.x).sort((a, c) => a - c)).toEqual([-B.leg.x, B.leg.x]);
                for (const m of [...b.legs, b.frame]) {
                    expect(m.castShadow).toBe(true);
                    expect(m.receiveShadow).toBe(true);
                }
                // Frame bbox in the board frame: 10.8 × 8.4 × 0.35, bottom at 2.0.
                b.frame.geometry.computeBoundingBox();
                const box = b.frame.geometry.boundingBox!.clone().translate(b.frame.position);
                expect(box.min.y).toBeCloseTo(B.frame.bottom, 6);
                expect(box.max.y).toBeCloseTo(B.frame.bottom + B.frame.h, 6);
                expect(box.max.x - box.min.x).toBeCloseTo(B.frame.w, 6);
                expect(box.max.z - box.min.z).toBeCloseTo(B.frame.d, 6);
                // Legs stand on the ground and reach the frame bottom.
                for (const l of b.legs) {
                    l.geometry.computeBoundingBox();
                    const lb = l.geometry.boundingBox!.clone().translate(l.position);
                    expect(lb.min.y).toBeCloseTo(0, 9);
                    expect(lb.max.y).toBeCloseTo(B.frame.bottom, 9);
                }
            });
            expect(lambert).toHaveBeenCalledWith(PALETTE.paper);
            expect(lambert).toHaveBeenCalledWith(PALETTE.ink);
        });

        it("one fixed cuboid per board covering the frame and legs, rotated to face the camera", () => {
            const { ctx, bodies } = stubCtx();
            const h = build(ctx);
            expect(bodies).toHaveLength(N);
            const total = B.frame.bottom + B.frame.h;
            const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
            bodies.forEach((b, i) => {
                expect(b.half).toEqual({ x: B.frame.w / 2, y: total / 2, z: B.frame.d / 2 });
                expect(b.pos).toEqual({ x: P.boards[i].x, y: total / 2, z: P.boards[i].z });
                const bq = b.quat as THREE.Quaternion;
                expect(Math.abs(bq.dot(q))).toBeCloseTo(1, 9);
                expect(h.boards[i].collider).toBe(b.body);
            });
        });

        it("image plane 10 × 5.625 at the frame top, placeholder colour until the lazy texture loads", () => {
            const { ctx, basic, registered } = stubCtx();
            const h = build(ctx);
            const strip = boardStripLayout(B);
            expect(basic).toHaveBeenCalledWith(PALETTE.imagePlaceholder);
            expect(registered).toEqual(
                frontendProjects.map((p, i) => ({ url: p.boardImage, x: P.boards[i].x, z: P.boards[i].z }))
            );
            for (const b of h.boards) {
                const g = b.image.geometry.parameters;
                expect([g.width, g.height]).toEqual([B.image.w, B.image.h]);
                expect(b.placeholder.visible).toBe(true);
                expect(b.image.visible).toBe(false);
                expect(b.image.position.y).toBeCloseTo(strip.imageY, 9);
                expect(b.placeholder.position.z).toBeCloseTo(B.image.z, 9);
                // In front of the placeholder, never coplanar with it.
                expect(b.image.position.z).toBeGreaterThan(b.placeholder.position.z);
                expect(b.image.material.fog).toBe(true);
                expect(b.imageShown).toBe(false);
            }
        });

        it("fades the loaded image in over 0.6 s, then hides the placeholder", () => {
            const { ctx, finish, runtime } = stubCtx();
            const h = build(ctx);
            const b = h.boards[1];
            const tex = finish(b.imageUrl);
            expect(b.image.visible).toBe(true);
            expect(b.image.material.map).toBe(tex);
            expect(b.image.material.transparent).toBe(true);
            expect(b.image.material.opacity).toBe(0);
            // Other boards are untouched.
            expect(h.boards[0].image.visible).toBe(false);

            h.update!(B.fadeIn / 2, 0, runtime);
            expect(b.image.material.opacity).toBeCloseTo(0.5, 9);
            expect(b.placeholder.visible).toBe(true);
            h.update!(B.fadeIn / 2, 0, runtime);
            expect(b.image.material.opacity).toBe(1);
            expect(b.image.material.transparent).toBe(false);
            expect(b.placeholder.visible).toBe(false);
            expect(b.imageShown).toBe(true);
        });

        it("swaps at once under reduced motion (read live), when culled, or when already loaded", () => {
            const a = stubCtx();
            const ha = build(a.ctx);
            a.runtime.reducedMotion = true;
            a.finish(ha.boards[0].imageUrl);
            expect(ha.boards[0].imageShown).toBe(true);
            expect(ha.boards[0].placeholder.visible).toBe(false);

            // Reduced motion switched on mid-fade finishes it on the next update.
            a.runtime.reducedMotion = false;
            a.finish(ha.boards[2].imageUrl);
            expect(ha.boards[2].imageShown).toBe(false);
            a.runtime.reducedMotion = true;
            ha.update!(0.01, 0, a.runtime);
            expect(ha.boards[2].imageShown).toBe(true);

            const c = stubCtx();
            const hc = build(c.ctx);
            c.ctx.group.visible = false; // culled by Areas
            c.finish(hc.boards[3].imageUrl);
            expect(hc.boards[3].imageShown).toBe(true);

            const d = stubCtx();
            const tex = new THREE.Texture();
            d.loaded.set(frontendProjects[0].boardImage, tex);
            const hd = build(d.ctx);
            expect(hd.boards[0].imageShown).toBe(true);
            expect(hd.boards[0].image.material.map).toBe(tex);
            expect(hd.boards[1].imageShown).toBe(false);
        });

        it("text strip: title (auto-fit), pitch and tags, upright, left-aligned at Layout textX", () => {
            const { ctx, texts } = stubCtx();
            const h = build(ctx);
            const up = uprights(texts);
            expect(up).toHaveLength(3 * N);
            expect(texts.filter((t) => t.kind === "onPath")).toHaveLength(0);
            const strip = boardStripLayout(B);
            h.boards.forEach((b, i) => {
                const p = frontendProjects[i];
                const [title, pitch, tags] = [b.title, b.pitch, b.tags].map((hd) => up.find((t) => t.handle === hd)!);
                expect(title.opts).toMatchObject({ text: p.title, font: TY.boardTitle.font, color: PALETTE.ink });
                expect(pitch.opts).toMatchObject({
                    text: p.boardPitch,
                    font: TY.boardPitch.font,
                    size: TY.boardPitch.size,
                    color: PALETTE.ink2,
                });
                expect(tags.opts).toMatchObject({
                    text: boardTagLine(p.tags),
                    font: TY.boardTags.font,
                    size: TY.boardTags.size,
                    letterSpacing: TY.boardTags.letterSpacing,
                    color: PALETTE.ink2,
                });
                for (const t of [title, pitch, tags]) {
                    expect(t.opts).toMatchObject({ anchorX: "left", anchorY: "top-cap" });
                    expect(t.handle.object.parent).toBe(b.group);
                    expect(t.handle.object.position.x).toBe(B.textX);
                    expect(t.handle.object.position.z).toBe(B.image.z);
                }
                expect(title.handle.object.position.y).toBeCloseTo(strip.titleTop, 9);
                expect(pitch.handle.object.position.y).toBeCloseTo(strip.pitchTop, 9);
                expect(tags.handle.object.position.y).toBeCloseTo(strip.tagsTop, 9);

                // Auto-fit with the measured width: fits 9.6, within [0.7, 0.85], then capped.
                const m = title.handle.mesh as unknown as StubMesh;
                const measured = Array.from(p.title).length * STUB_EM_PER_CHAR * m.fontSize;
                expect(m.fontSize).toBeGreaterThanOrEqual(TY.boardTitle.minSize);
                expect(m.fontSize).toBeLessThanOrEqual(TY.boardTitle.size);
                expect(measured).toBeLessThanOrEqual(TY.boardTitle.maxWidth + 1e-9);
                expect(m.maxWidth).toBe(TY.boardTitle.maxWidth);
            });
            // The long Clay Studio Creations title shrinks; a short one keeps 0.85.
            const clay = h.boards.find((b) => b.project.title === "Clay Studio Creations")!;
            expect((clay.title.mesh as unknown as StubMesh).fontSize).toBeLessThan(TY.boardTitle.size);
            const short = h.boards.find((b) => b.project.title === "Mara Mania")!;
            expect((short.title.mesh as unknown as StubMesh).fontSize).toBe(TY.boardTitle.size);
        });

        it("pads at board + S·12 (Pad.ts outline + flat label) open the project's content panel", () => {
            const { ctx, interactables, texts } = stubCtx();
            const h = build(ctx);
            expect(interactables).toHaveLength(N);
            const spots = PADS.filter((p) => p.areaId === "projects");
            interactables.forEach((it, i) => {
                const p = frontendProjects[i];
                expect(it.pad).toEqual(spots[i].pad);
                expect(it.pad).toMatchObject({ x: P.pads[i].x, z: P.pads[i].z, w: P.pad.w, d: P.pad.d, faceCamera: true });
                expect(it.areaId).toBe("projects");
                expect(it.prompt).toEqual({ title: p.title, action: "Open project" });
                expect(it.content).toEqual(projectContent(p));
                expect(it.onInteract).toBeUndefined();

                const pad = h.boards[i].pad;
                expect(pad.group.parent).toBe(ctx.group);
                expect(pad.group.position.x).toBeCloseTo(P.pads[i].x, 9);
                expect(pad.group.position.z).toBeCloseTo(P.pads[i].z, 9);
                expect(pad.active).toBe(false);
                it.setActive!(true);
                expect(pad.active).toBe(true);
                it.setActive!(false);
                expect(pad.active).toBe(false);
            });
            const labels = texts.filter((t) => t.kind === "flat");
            expect(labels).toHaveLength(N);
            for (const l of labels) expect(l.opts.text).toBe(P.padLabel);
            // No keycaps: nothing but the title word and the boards / pads.
            expect(ctx.group.children).toHaveLength(1 + 2 * N);
        });

        it("dispose frees colliders, texts, pads, the title and listeners once (never the textures)", () => {
            const s = stubCtx();
            const h = build(s.ctx);
            const tex = s.finish(h.boards[0].imageUrl);
            const texDispose = vi.spyOn(tex, "dispose");
            const matDispose = h.boards.map((b) => vi.spyOn(b.image.material, "dispose"));
            const geoDispose = vi.spyOn(h.boards[0].frame.geometry, "dispose");
            h.dispose!();
            h.dispose!();
            expect(s.removed).toEqual(s.bodies.map((b) => b.body));
            for (const t of s.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(s.words[0].word.dispose).toHaveBeenCalledTimes(1);
            expect(s.unregistered).toHaveLength(N);
            expect(s.listeners.size).toBe(0);
            for (const m of matDispose) expect(m).toHaveBeenCalledTimes(1);
            expect(geoDispose).toHaveBeenCalledTimes(1);
            expect(texDispose).not.toHaveBeenCalled();
            expect(s.ctx.group.children).toHaveLength(0);
            // A texture arriving after dispose is ignored; update is a no-op.
            expect(() => h.update!(0.1, 0, s.runtime)).not.toThrow();
        });

        it("a builder that throws frees everything it built and rethrows", () => {
            const a = stubCtx({ collider: 2 });
            expect(() => build(a.ctx)).toThrow("physics failed");
            expect(a.bodies).toHaveLength(2);
            expect(a.removed).toEqual(a.bodies.map((b) => b.body));
            for (const t of a.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(a.words[0].word.dispose).toHaveBeenCalledTimes(1);
            expect(a.unregistered).toEqual(a.interactables);
            expect(a.listeners.size).toBe(0);
            expect(a.ctx.group.children).toHaveLength(0);

            const b = stubCtx({ pad: true });
            expect(() => build(b.ctx)).toThrow("pad label failed");
            expect(b.bodies).toHaveLength(0);
            for (const t of b.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
            expect(b.ctx.group.children).toHaveLength(0);
        });
    });
});
