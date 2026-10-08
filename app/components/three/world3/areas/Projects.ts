import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { frontendProjects, type InfoContent, type Terminal } from "@/app/field/content/world";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { boardUrl } from "../Assets";
import { estimateTextWidth, type AREA_LAYOUT } from "../Layout";
import { buildPad, type PadVisual } from "../ui3d/Pad";
import { clamp } from "../utils/math";
import type { AreaContext, AreaHandle, PadDef, RuntimeInfo, TextHandle, Word3D } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Frontend Projects gallery (§2.4 Projects, §5.1 board, §5.3 pads). From
// Layout (AREA_LAYOUT.projects, PADS, the projects AreaDef):
//
// - 3D title `PROJECTS`: static Bricolage letters in ACCENT_INK.projects (cap
//   2.4), fixed cuboid colliders (Text3D). Areas arms it when build() returns.
// - One board per frontendProjects[i] at AREA_LAYOUT.projects.boards[i],
//   faceCamera: two ink legs, a paper RoundedBox frame (casts + receives
//   shadows), ONE fixed cuboid collider over frame + legs, a 16:9 image plane
//   and a text strip (title auto-fit, boardPitch, tags), all upright troika
//   text through ctx.text so the look's colour swap reaches it.
// - Lazy image (§5.1): the board registers its image with ctx.assets.boards
//   (the Experience loads it after Start, within 120 units of the focus). The
//   placeholder colour shows until then; the image fades in over 0.6 s (an
//   instant swap under reduced motion, or while the area is culled).
// - Pads at board + S·12 (Pad.ts outline / fill + flat label, no keycap). E
//   opens the project's content panel (image, pitch, description, tags,
//   Visit site).
// The gallery camera shot / zone is the Experience's (AreaDef.cameraZone).
// ─────────────────────────────────────────────────────────────────────────

type BoardLayout = (typeof AREA_LAYOUT)["projects"]["board"];

const TY = CONFIG.type;

/** Inter's cap height in em (1490 / 2048 UPM): stacks the strip on cap tops. */
const INTER_CAP_EM = 0.727;
/** The image sits this far in front of its placeholder, so the two never z-fight. */
const IMAGE_LIFT = 0.004;
/** Tags are joined with a middle dot; the full list lives in the panel. */
const TAG_SEPARATOR = " · ";
/** Ignore auto-fit changes smaller than this (troika re-layout is not free). */
const FIT_EPSILON = 1e-3;
/** Prompt card action (§5.3: `E  Clay Studio Creations — Open project`). */
const PROMPT_ACTION = "Open project";
const LINK_VISIT = "Visit site";
const LINK_CODE = "View code";

// ── Pure helpers (unit-tested) ───────────────────────────────────────────
/** The project's full panel content (Tier C, §3.1): the board copy is decorative. */
export function projectContent(p: Terminal): InfoContent {
    const links: { label: string; url: string }[] = [];
    if (p.liveUrl) links.push({ label: LINK_VISIT, url: p.liveUrl });
    if (p.repoUrl) links.push({ label: LINK_CODE, url: p.repoUrl });
    return {
        title: p.title,
        sub: p.pitch,
        body: p.description,
        // The 1600×900 board WebP (same source, centre-cropped): light, and
        // already in the HTTP cache once the board has loaded.
        image: p.boardImage,
        tags: [...p.tags],
        links: links.length > 0 ? links : undefined,
        accent: parseInt(ACCENT.projects.slice(1), 16),
    };
}

/**
 * Board title size (§3.3 auto-fit): `size` (0.85) shrinks so the title fits
 * `maxWidth` (9.6), never below `minSize` (0.7). `width` was measured at `at`.
 */
export function fitTitleSize(width: number, at: number): number {
    const T = TY.boardTitle;
    if (!(width > 0) || !(at > 0)) return T.size;
    return clamp((T.maxWidth * at) / width, T.minSize, T.size);
}

/**
 * The board's tag line: uppercase tags joined by " · ", keeping the longest
 * prefix whose conservative width estimate fits the title width (at least one
 * tag). The panel always lists every tag.
 */
export function boardTagLine(tags: readonly string[]): string {
    const T = TY.boardTags;
    const up = tags.map((t) => t.toUpperCase());
    let line = up[0] ?? "";
    for (let i = 1; i < up.length; i++) {
        const next = line + TAG_SEPARATOR + up[i];
        if (estimateTextWidth(next, T.size, T.letterSpacing) > TY.boardTitle.maxWidth) break;
        line = next;
    }
    return line;
}

export interface BoardStripLayout {
    /** Image plane centre (local y). */
    imageY: number;
    /** Cap-top heights (anchorY "top-cap") of the title, pitch and tags lines. */
    titleTop: number;
    pitchTop: number;
    tagsTop: number;
    /** Equal gap above the title and between the lines. */
    gap: number;
}

/**
 * Board-local layout (§5.1): the image at the top of the frame (margin from
 * Layout), and the text strip below it. The three lines are stacked on their
 * cap tops with equal gaps, so the tags' baseline lands on the frame's bottom
 * margin.
 */
export function boardStripLayout(b: BoardLayout): BoardStripLayout {
    const top = b.frame.bottom + b.frame.h - b.image.margin;
    const imageY = top - b.image.h / 2;
    const stripTop = top - b.image.h;
    const stripBottom = b.frame.bottom + b.image.margin;
    const caps = [TY.boardTitle.size, TY.boardPitch.size, TY.boardTags.size].map((s) => s * INTER_CAP_EM);
    const gap = (stripTop - stripBottom - caps[0] - caps[1] - caps[2]) / 3;
    const titleTop = stripTop - gap;
    const pitchTop = titleTop - caps[0] - gap;
    const tagsTop = pitchTop - caps[1] - gap;
    return { imageY, titleTop, pitchTop, tagsTop, gap };
}

// ── The area ─────────────────────────────────────────────────────────────
export interface ProjectBoard {
    project: Terminal;
    /** Board root at the base centre, rotated to face the camera. */
    group: THREE.Group;
    frame: THREE.Mesh;
    legs: THREE.Mesh[];
    placeholder: THREE.Mesh;
    image: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    title: TextHandle;
    pitch: TextHandle;
    tags: TextHandle;
    collider: RAPIER.RigidBody;
    pad: PadVisual;
    padDef: PadDef;
    /** The board image's URL (as the board loader keys it). */
    imageUrl: string;
    /** True once the image is fully shown (fade finished). */
    readonly imageShown: boolean;
}

export interface ProjectsHandle extends AreaHandle {
    title: Word3D | null;
    boards: ProjectBoard[];
}

interface BoardState {
    board: ProjectBoard;
    /** Fade progress in [0, 1], or null when not fading. */
    fade: number | null;
    shown: boolean;
}

export function build(ctx: AreaContext): ProjectsHandle {
    const P = ctx.layout.AREA_LAYOUT.projects;
    const B = P.board;
    const { group, materials, text } = ctx;
    const geometries: THREE.BufferGeometry[] = [];
    const ownMaterials: THREE.Material[] = [];
    const texts: TextHandle[] = [];
    const pads: PadVisual[] = [];
    const bodies: RAPIER.RigidBody[] = [];
    const unsubscribe: (() => void)[] = [];
    const unregister: (() => void)[] = [];
    const states: BoardState[] = [];
    let title: Word3D | null = null;
    let disposed = false;

    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
        geometries.push(g);
        return g;
    };

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    // Board textures belong to Assets and are never disposed here.
    const release = () => {
        for (const off of unregister) off();
        unregister.length = 0;
        for (const off of unsubscribe) off();
        unsubscribe.length = 0;
        for (const b of bodies) ctx.physics.removeBody(b);
        bodies.length = 0;
        // Text3DSystem words carry dispose() (removes their bodies); the contract type doesn't.
        (title as (Word3D & { dispose?: () => void }) | null)?.dispose?.();
        title = null;
        for (const p of pads) p.dispose();
        pads.length = 0;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const m of ownMaterials) m.dispose();
        ownMaterials.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        states.length = 0;
        group.clear();
    };

    const finishFade = (s: BoardState) => {
        const m = s.board.image.material;
        m.opacity = 1;
        m.transparent = false;
        m.needsUpdate = true;
        s.board.placeholder.visible = false;
        s.fade = null;
        s.shown = true;
    };

    /**
     * Shows a loaded texture: fades in, or swaps at once (`instant`, reduced
     * motion, or while the area is culled and nobody would see the fade).
     */
    const showImage = (s: BoardState, tex: THREE.Texture, instant = false) => {
        if (disposed || s.shown || s.fade !== null) return;
        const { image } = s.board;
        image.material.map = tex;
        image.material.needsUpdate = true;
        image.visible = true;
        if (instant || ctx.runtime.reducedMotion || !group.visible) {
            finishFade(s);
            return;
        }
        image.material.transparent = true;
        image.material.opacity = 0;
        s.fade = 0;
    };

    try {
        // ── 3D title (static, ACCENT_INK.projects) ───────────────────────
        const t3 = ctx.def.title3D;
        if (t3) {
            title = ctx.text3d.word(t3.text, {
                cap: TY.areaTitle.cap,
                depth: TY.areaTitle.depth,
                curveSegments: TY.areaTitle.curveSegments,
                color: ctx.def.accentInk,
                dynamic: t3.dynamic,
            });
            title.group.position.set(t3.x, 0, t3.z);
            title.group.rotation.y = FACE_CAMERA_Y;
            group.add(title.group); // placed once; Areas arms it when build() returns
        }

        // ── Shared board geometry (one copy for every board) ─────────────
        const legGeo = geo(new THREE.BoxGeometry(B.leg.w, B.leg.h, B.leg.d));
        const frameGeo = geo(new RoundedBoxGeometry(B.frame.w, B.frame.h, B.frame.d, B.frame.segments, B.frame.radius));
        const imageGeo = geo(new THREE.PlaneGeometry(B.image.w, B.image.h));
        const strip = boardStripLayout(B);
        const totalH = B.frame.bottom + B.frame.h;
        const faceQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
        const projectPads = ctx.layout.PADS.filter((p) => p.areaId === ctx.def.id);

        const count = Math.min(frontendProjects.length, P.boards.length, projectPads.length);
        for (let i = 0; i < count; i++) {
            const project = frontendProjects[i];
            const base = P.boards[i];

            const root = new THREE.Group();
            root.name = `project-board-${i}`;
            root.position.set(base.x, 0, base.z);
            root.rotation.y = FACE_CAMERA_Y;
            group.add(root);

            // Legs + frame (static props cast and receive, §1.5).
            const legs = [-1, 1].map((side) => {
                const leg = new THREE.Mesh(legGeo, materials.lambert(PALETTE.ink));
                leg.name = "board-leg";
                leg.position.set(side * B.leg.x, B.leg.h / 2, 0);
                return leg;
            });
            const frame = new THREE.Mesh(frameGeo, materials.lambert(PALETTE.paper));
            frame.name = "board-frame";
            frame.position.set(0, B.frame.bottom + B.frame.h / 2, 0);
            for (const m of [...legs, frame]) {
                m.castShadow = true;
                m.receiveShadow = true;
                m.raycast = () => {};
                root.add(m);
            }

            // Placeholder colour until the lazy image arrives, then the image in front.
            const placeholder = new THREE.Mesh(imageGeo, materials.basic(PALETTE.imagePlaceholder));
            placeholder.name = "board-placeholder";
            placeholder.position.set(0, strip.imageY, B.image.z);
            const imageMat = new THREE.MeshBasicMaterial({ fog: true });
            ownMaterials.push(imageMat);
            const image = new THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>(imageGeo, imageMat);
            image.name = "board-image";
            image.position.set(0, strip.imageY, B.image.z + IMAGE_LIFT);
            image.visible = false;
            for (const m of [placeholder, image]) {
                m.raycast = () => {};
                root.add(m);
            }

            // Text strip (upright, left-aligned at Layout textX, on the frame face).
            const upright = (h: TextHandle, y: number): TextHandle => {
                h.object.position.set(B.textX, y, B.image.z);
                root.add(h.object);
                texts.push(h);
                return h;
            };
            const titleText = upright(
                text.upright({
                    text: project.title,
                    font: TY.boardTitle.font,
                    size: fitTitleSize(estimateTextWidth(project.title, TY.boardTitle.size), TY.boardTitle.size),
                    color: PALETTE.ink,
                    anchorX: "left",
                    anchorY: "top-cap",
                }),
                strip.titleTop
            );
            const pitchText = upright(
                text.upright({
                    text: project.boardPitch,
                    font: TY.boardPitch.font,
                    size: TY.boardPitch.size,
                    color: PALETTE.ink2,
                    anchorX: "left",
                    anchorY: "top-cap",
                }),
                strip.pitchTop
            );
            const tagsText = upright(
                text.upright({
                    text: boardTagLine(project.tags),
                    font: TY.boardTags.font,
                    size: TY.boardTags.size,
                    letterSpacing: TY.boardTags.letterSpacing,
                    color: PALETTE.ink2,
                    anchorX: "left",
                    anchorY: "top-cap",
                }),
                strip.tagsTop
            );

            // Auto-fit with troika's real metrics (the estimate above only seeds
            // it), then cap the width so an over-long title can never leave the frame.
            const tm = titleText.mesh;
            tm.sync(() => {
                if (disposed) return;
                const info = tm.textRenderInfo;
                if (info) {
                    const fitted = fitTitleSize(info.blockBounds[2] - info.blockBounds[0], tm.fontSize);
                    if (Math.abs(fitted - tm.fontSize) > FIT_EPSILON) tm.fontSize = fitted;
                }
                tm.maxWidth = TY.boardTitle.maxWidth;
                tm.sync();
            });

            // Pad at board + S·12 (Layout PADS), outline / fill + flat label.
            const padSpot = projectPads[i];
            const pad = buildPad(padSpot.pad, { materials, text }, { accent: ctx.def.accent, label: padSpot.label });
            pads.push(pad);
            group.add(pad.group);

            // ONE fixed cuboid over the frame and legs.
            const collider = ctx.physics.addFixedCuboid(
                { x: B.frame.w / 2, y: totalH / 2, z: B.frame.d / 2 },
                { x: base.x, y: totalH / 2, z: base.z },
                faceQuat
            );
            bodies.push(collider);

            const imageUrl = boardUrl(project.boardImage);
            const state: BoardState = {
                board: {
                    project,
                    group: root,
                    frame,
                    legs,
                    placeholder,
                    image,
                    title: titleText,
                    pitch: pitchText,
                    tags: tagsText,
                    collider,
                    pad,
                    padDef: padSpot.pad,
                    imageUrl,
                    get imageShown() {
                        return state.shown;
                    },
                },
                fade: null,
                shown: false,
            };
            states.push(state);

            // Lazy image: register for distance loading; show it once it is ready.
            ctx.assets.boards.register(imageUrl, base.x, base.z);
            unsubscribe.push(
                ctx.assets.boards.onLoaded((url, tex) => {
                    if (url === imageUrl) showImage(state, tex);
                })
            );
            const ready = ctx.assets.boards.get(imageUrl);
            if (ready) showImage(state, ready, true);

            unregister.push(
                ctx.addInteractable({
                    pad: padSpot.pad,
                    prompt: { title: project.title, action: PROMPT_ACTION },
                    areaId: ctx.def.id,
                    content: projectContent(project),
                    setActive: (on) => pad.setActive(on),
                })
            );
        }

        return {
            group,
            title,
            boards: states.map((s) => s.board),
            update(dt: number, _t: number, rt: RuntimeInfo) {
                if (disposed) return;
                for (const s of states) {
                    if (s.fade === null) continue;
                    if (rt.reducedMotion) {
                        finishFade(s);
                        continue;
                    }
                    s.fade = Math.min(1, s.fade + dt / B.fadeIn);
                    if (s.fade >= 1) finishFade(s);
                    else s.board.image.material.opacity = s.fade;
                }
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                release();
            },
        };
    } catch (err) {
        disposed = true;
        release();
        throw err;
    }
}

registerArea("projects", build);
