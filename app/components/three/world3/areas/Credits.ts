import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { areaCopy, creditsSignLine } from "@/app/field/content/world";
import { FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { estimateTextWidth } from "../Layout";
import { buildOwnedPathLabels } from "../Paths";
import { buildPad, type PadVisual } from "../ui3d/Pad";
import type { AreaContext, AreaHandle, TextHandle } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Credits, at the end of the jetty (§2.2, §2.4, §5.3). Everything comes from
// Layout (AREA_LAYOUT.credits, the credits AreaDef and its PADS):
//
// - Sign: a paper RoundedBox(7, 3.6, 0.3, 2, 0.14) on two ink posts (postH
//   high), standing on the deck at (0, −196), faceCamera. One fixed cuboid
//   covers the board and posts. Upright copy on its face: `CREDITS` in Inter
//   Bold 0.9 (ink) and the credit line in Inter Medium 0.55 (ink2, on paper).
// - The credit line (`creditsSignLine`, "a · b · c") is wider than the board,
//   so it is broken at its separators into lines that fit (`packSeparated`),
//   never mid-name and never with a dangling "·"; the block is centred in the
//   space under the heading.
// - Pad on the deck at (0, −190), 6×5, faceCamera, plates layer (no label: the
//   sign names it, and the HTML prompt card says what E does). Interact calls
//   commands.openMenu("credits") synchronously, inside the input handler.
// No keycaps (DECISIONS.md, "Owner: desktop-first, no on-screen controls").
// ─────────────────────────────────────────────────────────────────────────

/** Sign copy (§2.4). Upright, on paper. */
export const SIGN_TYPE = {
    title: { text: "CREDITS", font: "bold", size: 0.9 },
    line: { font: "medium", size: 0.55, lineHeight: 1.2, separator: " · " },
} as const;
/** Post cross-section (square), matching the About portrait legs. */
export const POST_SECTION = 0.3;
/** Posts stand at this fraction of the board's half-width (as the About portrait legs). */
const POST_SPREAD = 2 / 3;
/** Copy inset from the board's top, bottom and side edges. */
export const SIGN_MARGIN = 0.35;
/** Gap between the heading's baseline and the credit-line block. */
const TITLE_GAP = 0.25;
/** Inter's cap height per em (1490 / 2048 units): where the heading's baseline lands. */
const INTER_CAP_RATIO = 1490 / 2048;
/** Upright copy sits this far in front of the board face (no z-fighting). */
const TEXT_LIFT = 0.01;
const PROMPT_ACTION = "Open credits";

/**
 * Breaks `line` ("a · b · c") at its separators into lines no wider than
 * `maxWidth` at `size` (Layout.estimateTextWidth, conservative), joined with
 * "\n". Separators at a break are dropped; an item wider than `maxWidth` gets a
 * line of its own (troika's maxWidth then wraps it).
 */
export function packSeparated(line: string, separator: string, maxWidth: number, size: number): string {
    const items = line
        .split(separator)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const lines: string[] = [];
    let current = "";
    for (const item of items) {
        const candidate = current ? `${current}${separator}${item}` : item;
        if (current && estimateTextWidth(candidate, size) > maxWidth) {
            lines.push(current);
            current = item;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines.join("\n");
}

export interface CreditsHandle extends AreaHandle {
    /** Sign root at its Layout point, faceCamera (local +X → R, +Z → S). */
    sign: THREE.Group;
    board: THREE.Mesh;
    posts: THREE.Mesh[];
    heading: TextHandle;
    line: TextHandle;
    pad: PadVisual;
    collider: RAPIER.RigidBody;
}

export function build(ctx: AreaContext): CreditsHandle {
    const { group, materials, text } = ctx;
    const C = ctx.layout.AREA_LAYOUT.credits;
    const def = ctx.def;
    const geometries: THREE.BufferGeometry[] = [];
    const texts: TextHandle[] = [];
    const unregister: (() => void)[] = [];
    let pad: PadVisual | null = null;
    let collider: RAPIER.RigidBody | null = null;

    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
        geometries.push(g);
        return g;
    };

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    const release = () => {
        for (const off of unregister) off();
        unregister.length = 0;
        if (collider) ctx.physics.removeBody(collider);
        collider = null;
        pad?.dispose();
        pad = null;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        group.clear();
    };

    try {
        // ── Sign: paper board on two ink posts ───────────────────────────
        const S = C.sign;
        const sign = new THREE.Group();
        sign.name = "credits-sign";
        sign.position.set(S.x, 0, S.z);
        sign.rotation.y = FACE_CAMERA_Y;

        const board = new THREE.Mesh(
            geo(new RoundedBoxGeometry(S.w, S.h, S.d, S.segments, S.radius)),
            materials.lambert(PALETTE.paper)
        );
        board.name = "credits-board";
        board.position.set(0, S.postH + S.h / 2, 0);
        const postGeo = geo(new THREE.BoxGeometry(POST_SECTION, S.postH, POST_SECTION));
        const posts = [-1, 1].map((side) => {
            const post = new THREE.Mesh(postGeo, materials.lambert(PALETTE.ink));
            post.name = "credits-post";
            post.position.set((side * S.w * POST_SPREAD) / 2, S.postH / 2, 0);
            return post;
        });
        for (const m of [board, ...posts]) {
            m.castShadow = true; // §1.5 static props cast and receive
            m.receiveShadow = true;
            m.raycast = () => {};
            sign.add(m);
        }
        group.add(sign);

        // ── Upright copy on the board face ───────────────────────────────
        const top = S.postH + S.h;
        const faceZ = S.d / 2 + TEXT_LIFT;
        const copyWidth = S.w - 2 * SIGN_MARGIN;
        const T = SIGN_TYPE;

        const headingTop = top - SIGN_MARGIN;
        const heading = text.upright({
            text: T.title.text,
            font: T.title.font,
            size: T.title.size,
            color: PALETTE.ink,
            anchorX: "center",
            anchorY: "top-cap",
        });
        texts.push(heading);
        heading.object.position.set(0, headingTop, faceZ);
        sign.add(heading.object);

        // The credit-line block is centred between the heading and the bottom margin.
        const blockTop = headingTop - T.title.size * INTER_CAP_RATIO - TITLE_GAP;
        const blockBottom = S.postH + SIGN_MARGIN;
        // ink2 is allowed here: it sits on paper (§9.4).
        const line = text.upright({
            text: packSeparated(creditsSignLine, T.line.separator, copyWidth, T.line.size),
            font: T.line.font,
            size: T.line.size,
            color: PALETTE.ink2,
            maxWidth: copyWidth,
            lineHeight: T.line.lineHeight,
            anchorX: "center",
            anchorY: "middle",
        });
        texts.push(line);
        line.mesh.textAlign = "center";
        line.object.position.set(0, (blockTop + blockBottom) / 2, faceZ);
        sign.add(line.object);

        // ── Pad on the deck: opens Menu → Credits ────────────────────────
        const spot = ctx.layout.PADS.find((p) => p.id === "credits");
        if (!spot) throw new Error('[world3/credits] Layout has no pad "credits"');
        const visual = buildPad(spot.pad, { materials, text }, { accent: def.accent, label: spot.label });
        pad = visual;
        group.add(visual.group);
        unregister.push(
            ctx.addInteractable({
                pad: spot.pad,
                prompt: { title: areaCopy.credits.name, action: PROMPT_ACTION },
                areaId: def.id,
                // Synchronous, inside the key / click handler (§4.3).
                onInteract: () => ctx.commands.openMenu("credits"),
                setActive: (on) => visual.setActive(on),
            })
        );

        // ── Path labels this area owns (none in the current Layout) ──────
        for (const h of buildOwnedPathLabels(text, def.id)) {
            texts.push(h);
            group.add(h.object);
        }

        // ── ONE fixed collider (board + posts), last: nothing after it can throw ──
        const faceCamera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
        const body = ctx.physics.addFixedCuboid(
            { x: S.w / 2, y: top / 2, z: S.d / 2 },
            { x: S.x, y: top / 2, z: S.z },
            faceCamera
        );
        collider = body;

        let disposed = false;
        return {
            group,
            sign,
            board,
            posts,
            heading,
            line,
            pad: visual,
            collider: body,
            dispose() {
                if (disposed) return;
                disposed = true;
                release();
            },
        };
    } catch (err) {
        release();
        throw err;
    }
}

registerArea("credits", build);
