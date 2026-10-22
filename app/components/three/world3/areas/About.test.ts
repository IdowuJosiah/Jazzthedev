import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { about, contactLinks, type ContactLink } from "@/app/field/content/world";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import * as Layout from "../Layout";
import { AREA_BY_ID, AREA_LAYOUT, PADS, pointInRect } from "../Layout";
import { registeredAreaIds } from "../Areas";
import * as shapes from "../utils/shapes";
import { Disposal } from "../utils/disposal";
import type {
    AreaContext,
    Letter3D,
    LayoutApi,
    MaterialsApi,
    ModelName,
    RuntimeInfo,
    TextApi,
    TextHandle,
    TextOpts,
    Word3D,
    Word3DOptions,
    WorldInteractable,
} from "../types";
import { AVATAR, build } from "./About";

type TextCall = { kind: "flat" | "upright" | "onPath"; opts: TextOpts; handle: TextHandle };

interface StubOptions {
    avatar?: THREE.Object3D | null;
    texture?: () => Promise<THREE.Texture>;
    failCollider?: boolean;
    layout?: LayoutApi;
}

function stubCtx(o: StubOptions = {}) {
    const layout = o.layout ?? Layout;
    const texts: TextCall[] = [];
    const words: { text: string; opts: Word3DOptions; word: Word3D & { dispose: ReturnType<typeof vi.fn> } }[] = [];
    const interactables: WorldInteractable[] = [];
    const unregistered: WorldInteractable[] = [];
    const bodies: { kind: "cuboid" | "cylinder"; args: unknown[]; body: object }[] = [];
    const removed: object[] = [];
    const lambert = vi.fn<(hex: string, opts?: object) => THREE.MeshLambertMaterial>(() => new THREE.MeshLambertMaterial());
    const basic = vi.fn<(hex: string, opts?: object) => THREE.MeshBasicMaterial>(() => new THREE.MeshBasicMaterial());
    const openUrl = vi.fn();
    const makeText =
        (kind: TextCall["kind"]) =>
        (opts: TextOpts): TextHandle => {
            const mesh = { renderOrder: 0, textAlign: "left", visible: true };
            const handle = { object: new THREE.Group(), mesh, setText() {}, setColor() {}, dispose: vi.fn() } as unknown as TextHandle;
            texts.push({ kind, opts, handle });
            return handle;
        };
    const addBody = (kind: "cuboid" | "cylinder") => (...args: unknown[]) => {
        if (o.failCollider) throw new Error("physics failed");
        const body = { id: bodies.length };
        bodies.push({ kind, args, body });
        return body;
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
            addFixedCuboid: addBody("cuboid"),
            addFixedCylinder: addBody("cylinder"),
            removeBody: (b: object) => removed.push(b),
        },
        materials: { lambert, basic } as unknown as MaterialsApi,
        shapes,
        text: { flat: makeText("flat"), upright: makeText("upright"), onPath: makeText("onPath") } as unknown as TextApi,
        text3d: {
            word: (text: string, opts: Word3DOptions) => {
                const group = new THREE.Group();
                const letters: Letter3D[] = Array.from(text).map(() => ({
                    mesh: new THREE.Mesh(),
                    home: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
                }));
                const word = { group, letters, reset: vi.fn(), dispose: vi.fn() };
                words.push({ text, opts, word });
                return word;
            },
        },
        assets: {
            model: vi.fn((name: ModelName) => (name === "avatar" ? (o.avatar ?? null) : null)),
            texture: vi.fn(o.texture ?? (() => Promise.resolve(new THREE.Texture()))),
        },
        audio: {},
        commands: { openUrl, openMenu: vi.fn(), resetPlayground: vi.fn() },
        disposal: new Disposal(),
        runtime,
        def: layout.AREA_BY_ID.about,
        layout,
        addInteractable: (i: WorldInteractable) => {
            interactables.push(i);
            return () => unregistered.push(i);
        },
    } as unknown as AreaContext;
    return { ctx, texts, words, interactables, unregistered, bodies, removed, lambert, basic, openUrl, runtime };
}

const A = AREA_LAYOUT.about;
const P = A.portrait;
const TY = CONFIG.type;
const faceCameraQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);

const rt = (x: number, z: number, reducedMotion = false): RuntimeInfo => ({
    carPos: new THREE.Vector3(x, 0, z),
    carSpeed: 0,
    reducedMotion,
    muted: true,
    isTouch: false,
});

/** The stand-in body's rest (bind) height: no clip keyframe ever reaches it. */
const REST_Y = 0.9;
/** The stand-in Idle clip's first-frame body height (the rest pose is 0.9). */
const IDLE_FIRST_Y = 0.92;
/** The stand-in Wave clip's first / last frame body heights. */
const WAVE_FIRST_Y = 1.0;
const WAVE_LAST_Y = 1.1;
/** Lowest keyframe of either stand-in clip: a correct blend never dips below it. */
const CLIP_MIN_Y = IDLE_FIRST_Y;
/** Float32 keyframes and float blending: comparison slack. */
const Y_EPS = 1e-4;
/** Mixer step for the bind-pose sweep, seconds. */
const SWEEP_STEP = 0.05;

/** A 1.8-tall stand-in figure (feet at y 0) with optional Idle / Wave clips. */
function figure(withClips: boolean) {
    const fig = new THREE.Group();
    const geometry = new THREE.BoxGeometry(0.8, 1.8, 0.4);
    const body = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial());
    body.name = "body";
    body.position.y = REST_Y;
    fig.add(body);
    const track = (from: number, to: number) =>
        new THREE.VectorKeyframeTrack("body.position", [0, 1], [0, from, 0, 0, to, 0]);
    // Idle's first frame differs from the rest pose, so applying it is observable.
    const idle = new THREE.AnimationClip("Armature|Idle", 1, [track(IDLE_FIRST_Y, 0.95)]);
    const wave = new THREE.AnimationClip("Armature|Wave", 1, [track(WAVE_FIRST_Y, WAVE_LAST_Y)]);
    if (withClips) fig.animations = [idle, wave];
    return { fig, geometry, idle, wave };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("areas/About (§2.4, §5.2, §5.3, §8.3)", () => {
    it("registers itself as the about builder", () => {
        expect(registeredAreaIds()).toContain("about");
    });

    it("plaza plate covers the about rect on the plaza layer", () => {
        const { ctx } = stubCtx();
        build(ctx);
        const plaza = ctx.group.getObjectByName("about-plaza") as THREE.Mesh;
        ctx.group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(plaza);
        const r = AREA_BY_ID.about.rect;
        expect(b.min.x).toBeCloseTo(r.x - r.w / 2, 6);
        expect(b.max.x).toBeCloseTo(r.x + r.w / 2, 6);
        expect(b.min.z).toBeCloseTo(r.z - r.d / 2, 6);
        expect(b.max.z).toBeCloseTo(r.z + r.d / 2, 6);
        expect(b.max.y).toBeCloseTo(shapes.LAYERS.plaza.y, 6);
    });

    it("builds the static ABOUT title in ACCENT_INK.brand at its Layout point, faceCamera", () => {
        const { ctx, words } = stubCtx();
        const h = build(ctx);
        const t3 = AREA_BY_ID.about.title3D!;
        expect(words).toHaveLength(1);
        expect(words[0].text).toBe("ABOUT");
        expect(words[0].opts).toMatchObject({
            cap: TY.areaTitle.cap,
            depth: TY.areaTitle.depth,
            color: AREA_BY_ID.about.accentInk,
            dynamic: false,
        });
        const g = words[0].word.group;
        expect([g.position.x, g.position.y, g.position.z]).toEqual([t3.x, 0, t3.z]);
        expect(g.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(h.title).toBe(words[0].word);
    });

    it("portrait board: paper frame on two ink legs, faceCamera, one fixed cuboid over frame + legs", () => {
        const { ctx, bodies, lambert } = stubCtx();
        const h = build(ctx);
        expect(h.avatar).toBeNull();
        const board = h.portrait!;
        expect(board.parent).toBe(ctx.group);
        expect([board.position.x, board.position.z]).toEqual([P.x, P.z]);
        expect(board.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        const frame = board.getObjectByName("about-portrait-frame") as THREE.Mesh;
        const fb = new THREE.Box3().setFromBufferAttribute(frame.geometry.getAttribute("position") as THREE.BufferAttribute);
        expect(fb.max.x - fb.min.x).toBeCloseTo(P.frame.w, 6);
        expect(fb.max.y - fb.min.y).toBeCloseTo(P.frame.h, 6);
        expect(fb.max.z - fb.min.z).toBeCloseTo(P.frame.d, 6);
        expect(frame.position.y).toBeCloseTo(P.leg.h + P.frame.h / 2, 9);
        const legs: THREE.Mesh[] = [];
        board.traverse((o) => {
            if (o.name === "about-portrait-leg") legs.push(o as THREE.Mesh);
        });
        expect(legs).toHaveLength(2);
        for (const leg of legs) {
            expect(leg.position.y).toBeCloseTo(P.leg.h / 2, 9);
            expect(Math.abs(leg.position.x)).toBeLessThan(P.frame.w / 2);
            expect(leg.castShadow).toBe(true);
        }
        expect(lambert).toHaveBeenCalledWith(PALETTE.paper);
        expect(lambert).toHaveBeenCalledWith(PALETTE.ink);
        // One collider: frame + legs, rotated faceCamera.
        expect(bodies).toHaveLength(1);
        const totalH = P.leg.h + P.frame.h;
        const [half, pos, quat] = bodies[0].args as [object, object, THREE.Quaternion];
        expect(bodies[0].kind).toBe("cuboid");
        expect(half).toEqual({ x: P.frame.w / 2, y: totalH / 2, z: P.frame.d / 2 });
        expect(pos).toEqual({ x: P.x, y: totalH / 2, z: P.z });
        expect(quat.angleTo(faceCameraQuat)).toBeCloseTo(0, 9);
        expect(h.collider).toBe(bodies[0].body);
    });

    it("portrait image: 4.4 square on the frame face, placeholder until profile.webp arrives", async () => {
        const tex = new THREE.Texture();
        const { ctx } = stubCtx({ texture: () => Promise.resolve(tex) });
        const h = build(ctx);
        expect(ctx.assets.texture).toHaveBeenCalledWith(about.portrait);
        const image = h.portrait!.getObjectByName("about-portrait-image") as THREE.Mesh;
        const ib = new THREE.Box3().setFromBufferAttribute(image.geometry.getAttribute("position") as THREE.BufferAttribute);
        expect(ib.max.x - ib.min.x).toBeCloseTo(P.image, 6);
        expect(ib.max.y - ib.min.y).toBeCloseTo(P.image, 6);
        // In front of the face, inside the frame, top margin = side margin.
        expect(image.position.z).toBeGreaterThan(P.frame.d / 2);
        const top = image.position.y + P.image / 2;
        expect(P.leg.h + P.frame.h - top).toBeCloseTo((P.frame.w - P.image) / 2, 9);
        expect(image.position.y - P.image / 2).toBeGreaterThan(P.leg.h);
        const mat = h.portraitImage!;
        expect(mat.fog).toBe(true);
        expect(mat.map).toBeNull();
        expect(`#${mat.color.getHexString().toUpperCase()}`).toBe(PALETTE.imagePlaceholder);
        await expect(h.portraitReady).resolves.toBe(true);
        expect(mat.map).toBe(tex);
        expect(mat.color.getHex()).toBe(0xffffff);
    });

    it("a missing portrait keeps the placeholder; a texture arriving after dispose is not applied", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const failing = stubCtx({ texture: () => Promise.reject(new Error("404")) });
        const a = build(failing.ctx);
        await expect(a.portraitReady).resolves.toBe(false);
        expect(a.portraitImage!.map).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);

        let resolve!: (t: THREE.Texture) => void;
        const late = stubCtx({ texture: () => new Promise<THREE.Texture>((r) => (resolve = r)) });
        const b = build(late.ctx);
        const mat = b.portraitImage!;
        b.dispose!();
        resolve(new THREE.Texture());
        await expect(b.portraitReady).resolves.toBe(false);
        expect(mat.map).toBeNull();
    });

    it("bio: about.bioShort flat on the plaza (ground text), Inter Medium 0.85 ink, maxWidth 16, lh 1.35", () => {
        const { ctx, texts } = stubCtx();
        const h = build(ctx);
        const bio = texts.find((t) => t.opts.text === about.bioShort)!;
        expect(bio.kind).toBe("flat");
        expect(bio.opts).toMatchObject({
            font: "medium",
            size: 0.85,
            color: PALETTE.ink,
            maxWidth: 16,
            lineHeight: 1.35,
            layer: "groundText",
            anchorX: "center",
        });
        expect(about.bioShort.length).toBeLessThanOrEqual(100);
        expect(h.bio).toBe(bio.handle);
        const o = bio.handle.object;
        expect(o.parent).toBe(ctx.group);
        expect([o.position.x, o.position.y, o.position.z]).toEqual([A.bio.x, 0, A.bio.z]);
        expect(o.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(pointInRect(AREA_BY_ID.about.rect, A.bio.x, A.bio.z)).toBe(true);
        expect((bio.handle.mesh as unknown as { textAlign: string }).textAlign).toBe("center");
    });

    it("contact pads: one flush paper plate per link with its label, in Layout's row (no CV without a CV URL)", () => {
        const { ctx, texts, interactables, basic } = stubCtx();
        const h = build(ctx);
        expect(contactLinks.some((l) => l.id === "cv")).toBe(false);
        expect(h.contacts.map((c) => c.link.id)).toEqual(["email", "github", "linkedin"]);
        h.contacts.forEach((c, i) => {
            const spot = PADS.find((p) => p.id === `contact-${c.link.id}`)!;
            expect(spot.pad).toEqual({ ...A.contactPads[i], w: A.contactPad.w, d: A.contactPad.d, faceCamera: true });
            expect([c.root.position.x, c.root.position.z]).toEqual([spot.pad.x, spot.pad.z]);
            expect(c.root.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
            const pb = new THREE.Box3().setFromBufferAttribute(c.plate.geometry.getAttribute("position") as THREE.BufferAttribute);
            expect(pb.max.x - pb.min.x).toBeCloseTo(A.contactPad.w, 6);
            expect(pb.max.z - pb.min.z).toBeCloseTo(A.contactPad.d, 6);
            const label = texts.find((t) => t.handle === c.label)!;
            expect(label.opts).toMatchObject({
                text: c.link.label,
                font: TY.padLabel.font,
                size: TY.padLabel.size,
                color: PALETTE.ink,
                layer: "padOnPlate",
            });
            expect(c.label.object.parent).toBe(c.root);
            expect(c.label.mesh.renderOrder).toBe(shapes.LAYERS.groundText.renderOrder);
            expect(c.pad.label).toBeNull();
            expect(interactables[i].pad).toBe(spot.pad);
            expect(interactables[i].prompt.title).toBe(c.link.display);
        });
        expect(basic).toHaveBeenCalledWith(ACCENT.brand, expect.objectContaining({ layer: "padOnPlate" }));
    });

    it("interacting with a contact pad calls commands.openUrl(url) synchronously (Safari popup rule)", () => {
        const { ctx, interactables, openUrl } = stubCtx();
        build(ctx);
        contactLinks.forEach((link, i) => {
            const it = interactables[i];
            expect(it.content).toBeUndefined();
            openUrl.mockClear();
            it.onInteract!();
            expect(openUrl).toHaveBeenCalledTimes(1);
            expect(openUrl).toHaveBeenCalledWith(link.url);
        });
    });

    it("pad highlight toggles through the interactable", () => {
        const { ctx, interactables } = stubCtx();
        const h = build(ctx);
        h.contacts.forEach((c, i) => {
            interactables[i].setActive!(true);
            expect(c.pad.active).toBe(true);
            interactables[i].setActive!(false);
            expect(c.pad.active).toBe(false);
        });
    });

    it("builds a CV pad (4 in the row) once a CV link exists", async () => {
        const cv: ContactLink = { id: "cv", label: "CV", url: "https://example.com/cv.pdf", display: "CV (PDF)" };
        vi.resetModules();
        vi.doMock("@/app/field/content/world", async (importOriginal) => {
            const orig = await importOriginal<typeof import("@/app/field/content/world")>();
            return { ...orig, contactLinks: [...orig.contactLinks, cv] };
        });
        try {
            const LayoutCv = await import("../Layout");
            const { build: buildCv } = await import("./About");
            const { ctx, interactables, openUrl } = stubCtx({ layout: LayoutCv });
            const h = buildCv(ctx);
            expect(h.contacts.map((c) => c.link.id)).toEqual(["email", "github", "linkedin", "cv"]);
            const cvPad = h.contacts[3];
            const spot = LayoutCv.PADS.find((p) => p.id === "contact-cv")!;
            expect([cvPad.root.position.x, cvPad.root.position.z]).toEqual([spot.pad.x, spot.pad.z]);
            // The row stays centred on (−52, 12).
            const xs = h.contacts.map((c) => c.root.position.x);
            const zs = h.contacts.map((c) => c.root.position.z);
            expect(xs.reduce((s, v) => s + v, 0) / xs.length).toBeCloseTo(A.contactRow.x, 9);
            expect(zs.reduce((s, v) => s + v, 0) / zs.length).toBeCloseTo(A.contactRow.z, 9);
            interactables[3].onInteract!();
            expect(openUrl).toHaveBeenCalledWith(cv.url);
        } finally {
            vi.doUnmock("@/app/field/content/world");
            vi.resetModules();
        }
    });

    it("swaps the board for avatar.glb when Assets provides it: 5.5 tall, feet down, faceCamera, cylinder collider", () => {
        const { fig } = figure(false);
        const { ctx, bodies } = stubCtx({ avatar: fig });
        const h = build(ctx);
        expect(ctx.assets.model).toHaveBeenCalledWith("avatar");
        expect(h.portrait).toBeNull();
        expect(h.portraitImage).toBeNull();
        expect(ctx.group.getObjectByName("about-portrait")).toBeUndefined();
        expect(ctx.assets.texture).not.toHaveBeenCalled();
        expect(h.avatar).toBe(fig);
        expect(fig.parent).toBe(ctx.group);
        ctx.group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(fig);
        expect(b.min.y).toBeCloseTo(0, 6);
        expect(b.max.y).toBeCloseTo(AVATAR.height, 6);
        expect([fig.position.x, fig.position.z]).toEqual([P.x, P.z]);
        expect(fig.rotation.y).toBeCloseTo(FACE_CAMERA_Y, 12);
        expect(h.mixer).toBeNull(); // no clips, no mixer
        expect(bodies).toHaveLength(1);
        expect(bodies[0].kind).toBe("cylinder");
        const [halfHeight, radius, pos] = bodies[0].args as [number, number, { x: number; y: number; z: number }];
        expect(halfHeight).toBeCloseTo(AVATAR.height / 2, 9);
        expect(radius).toBeGreaterThan(0);
        expect(pos).toEqual({ x: P.x, y: AVATAR.height / 2, z: P.z });
    });

    it("avatar: Idle loops; Wave plays once when the car comes within 12, and again only after leaving", () => {
        const { fig, wave, idle } = figure(true);
        const { ctx } = stubCtx({ avatar: fig });
        const h = build(ctx);
        const mixer = h.mixer!;
        const waveA = mixer.existingAction(wave)!;
        const idleA = mixer.existingAction(idle)!;
        expect(idleA.isRunning()).toBe(true);
        expect(waveA.isRunning()).toBe(false);
        const far = AVATAR.waveDistance + 5;
        h.update!(0.1, 0, rt(P.x + far, P.z));
        expect(waveA.isRunning()).toBe(false);
        h.update!(0.1, 0, rt(P.x + AVATAR.waveDistance - 1, P.z)); // enters
        expect(waveA.isRunning()).toBe(true);
        h.update!(0.2, 0, rt(P.x + 2, P.z)); // stays near: no restart
        expect(waveA.time).toBeCloseTo(0.3, 6);
        h.update!(1, 0, rt(P.x + 2, P.z)); // the wave finishes, idle fades back in
        expect(waveA.isRunning()).toBe(false);
        expect(idleA.isRunning()).toBe(true);
        h.update!(0.1, 0, rt(P.x + far, P.z)); // leaves
        h.update!(0.1, 0, rt(P.x, P.z + 3)); // comes back: waves again
        expect(waveA.isRunning()).toBe(true);
    });

    it("avatar: the wave → idle hand-off never blends in the bind pose (weights always sum to 1)", () => {
        const { fig, wave } = figure(true);
        const { ctx } = stubCtx({ avatar: fig });
        const h = build(ctx);
        const body = fig.getObjectByName("body")!;
        const waveA = h.mixer!.existingAction(wave)!;
        const far = rt(P.x + AVATAR.waveDistance + 5, P.z);
        const near = rt(P.x + 2, P.z);
        const sweep = (seconds: number, at: RuntimeInfo) => {
            for (let t = 0; t < seconds; t += SWEEP_STEP) {
                h.update!(SWEEP_STEP, 0, at);
                expect(body.position.y).toBeGreaterThan(CLIP_MIN_Y - Y_EPS);
                expect(body.position.y).not.toBeCloseTo(REST_Y, 3);
            }
        };
        sweep(0.5, far);
        // Two full cycles: wave, finish, cross-fade back to Idle, leave, return.
        for (let cycle = 0; cycle < 2; cycle++) {
            sweep(wave.duration + AVATAR.fade + 0.5, near);
            expect(waveA.isRunning()).toBe(false);
            sweep(0.2, far);
        }
        // Re-entering mid-wave (left and came straight back) also stays on the clips.
        sweep(0.3, near);
        sweep(0.1, far);
        sweep(wave.duration + AVATAR.fade + 0.5, near);
    });

    it("avatar with a Wave but no Idle clip rests on Wave's first frame and holds its last after waving", () => {
        const { fig, wave } = figure(false);
        fig.animations = [wave];
        const { ctx } = stubCtx({ avatar: fig });
        const h = build(ctx);
        const body = fig.getObjectByName("body")!;
        const waveA = h.mixer!.existingAction(wave)!;
        expect(body.position.y).toBeCloseTo(WAVE_FIRST_Y, 5);
        expect(waveA.isRunning()).toBe(false);
        h.update!(0.5, 0, rt(P.x + AVATAR.waveDistance + 5, P.z)); // far: still resting
        expect(body.position.y).toBeCloseTo(WAVE_FIRST_Y, 5);
        h.update!(SWEEP_STEP, 0, rt(P.x + 2, P.z)); // enters: waves
        expect(waveA.isRunning()).toBe(true);
        for (let t = 0; t < wave.duration + 1; t += SWEEP_STEP) {
            h.update!(SWEEP_STEP, 0, rt(P.x + 2, P.z));
            expect(body.position.y).toBeGreaterThan(WAVE_FIRST_Y - Y_EPS);
        }
        expect(waveA.isRunning()).toBe(false);
        expect(body.position.y).toBeCloseTo(WAVE_LAST_Y, 5);
    });

    it("avatar under reduced motion holds its pose: no wave, the mixer never advances", () => {
        const { fig, wave } = figure(true);
        const { ctx } = stubCtx({ avatar: fig });
        const h = build(ctx);
        h.update!(0.1, 0, rt(P.x, P.z + 2, true));
        h.update!(0.5, 0, rt(P.x, P.z + 2, true));
        expect(h.mixer!.existingAction(wave)!.isRunning()).toBe(false);
        expect(h.mixer!.time).toBe(0);
        // It holds Idle's first frame, never the rig's bind pose.
        expect(fig.getObjectByName("body")!.position.y).toBeCloseTo(IDLE_FIRST_Y, 6); // keyframes are Float32
    });

    it("draws no upright copy, no desktopOnly copy and no keycap", () => {
        const { ctx, texts } = stubCtx();
        build(ctx);
        expect(texts.every((t) => t.kind === "flat")).toBe(true);
        expect(texts.some((t) => t.opts.desktopOnly)).toBe(false);
        expect(texts).toHaveLength(1 + contactLinks.length); // bio + one label per pad
    });

    it("dispose removes the collider, unregisters pads and frees texts, title, image material and geometries, once", () => {
        const { ctx, texts, words, interactables, unregistered, bodies, removed } = stubCtx();
        const h = build(ctx);
        const imageDispose = vi.spyOn(h.portraitImage!, "dispose");
        const padSpies = h.contacts.map((c) => vi.spyOn(c.pad, "dispose"));
        h.dispose!();
        h.dispose!();
        expect(removed).toEqual([bodies[0].body]);
        expect(unregistered).toHaveLength(interactables.length);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(words[0].word.dispose).toHaveBeenCalledTimes(1);
        expect(imageDispose).toHaveBeenCalledTimes(1);
        for (const s of padSpies) expect(s).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
    });

    it("dispose never frees the avatar's shared geometry (Assets owns it); a disposed area ignores updates", () => {
        const { fig, geometry } = figure(true);
        const geoDispose = vi.spyOn(geometry, "dispose");
        const { ctx, removed, bodies } = stubCtx({ avatar: fig });
        const h = build(ctx);
        h.dispose!();
        expect(geoDispose).not.toHaveBeenCalled();
        expect(removed).toEqual([bodies[0].body]);
        expect(() => h.update!(0.1, 0, rt(P.x, P.z))).not.toThrow();
    });

    it("a builder that throws leaves no collider, frees what it built and rethrows", () => {
        const { ctx, texts, words, interactables, unregistered, bodies } = stubCtx({ failCollider: true });
        expect(() => build(ctx)).toThrow("physics failed");
        expect(bodies).toHaveLength(0);
        expect(unregistered).toHaveLength(interactables.length);
        expect(interactables.length).toBe(contactLinks.length);
        for (const t of texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(words[0].word.dispose).toHaveBeenCalledTimes(1);
        expect(ctx.group.children).toHaveLength(0);
    });
});
