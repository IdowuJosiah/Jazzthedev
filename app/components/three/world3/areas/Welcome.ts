import * as THREE from "three";
import { meta } from "@/app/field/content/world";
import { CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { buildOwnedPathLabels } from "../Paths";
import type { AreaContext, AreaHandle, RuntimeInfo, TextHandle, Word3D } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Welcome / Spawn (§2.4). Everything comes from Layout (AREA_LAYOUT.welcome,
// the welcome AreaDef and its path labels):
//
// - Hero word `meta.heroWord`: DYNAMIC Bricolage letters in ink (cap 4.0,
//   depth 1.2), centred on the Layout point and laid out along R. Areas arms
//   the word right after this builder returns (DECISIONS.md, W1-B rule), so
//   the group is placed here and never moved. reset() sends the letters home
//   (Travel, R, fall-off respawn, the Start drop); update() also does when the
//   car goes from near to > 60 units away (§3.3 auto-reset).
// - Role line (Inter Bold 1.1, ink) and greeting (Inter Medium 0.9, ink2, on
//   the plaza), flat and faceCamera.
// - Controls card (desktop only): a flush paper plate with four rows of Inter
//   SemiBold 0.8 ink2 copy, each key set inside a rounded-rect keycap outline.
//   The text is desktopOnly (TextApi hides it on touch / portrait); the plate
//   and outlines follow the first key label's visibility every frame.
// - Plaza plate (plaza layer) over the rect, radius 3.
// - Path labels P1 CROSSROADS and P7 ABOUT & CONTACT (Paths.ts ownership).
// ─────────────────────────────────────────────────────────────────────────

/** Controls card copy (§2.4): the key(s) in a keycap outline, then the action. */
export const CONTROLS_ROWS: readonly { keys: string; action: string }[] = [
    { keys: "W A S D", action: "DRIVE" },
    { keys: "SHIFT", action: "BOOST" },
    { keys: "SPACE", action: "BRAKE / DRIFT" },
    { keys: "E", action: "OPEN" },
];

/**
 * Controls card presentation (stream-local, like Pad.ts's ring maths): the
 * card's size and row count come from Layout; these only set the inner margins
 * and the keycap outline proportions. The 10-wide card is tight on the SPACE
 * row (keycap + "BRAKE / DRIFT" ≈ 9.6 of the conservative width estimate), so
 * the margins are small; `controlsCardLayout` keeps every row apart by `minGap`.
 */
export const CARD_STYLE = {
    /** Margin from the plate edge to the keycaps (left) and the actions (right). */
    inset: 0.15,
    /** Keycap outline height as a fraction of the row pitch. */
    keyHeightFraction: 0.72,
    /** Space between the key text and its outline, each side (estimate-based; real glyphs leave more). */
    keyPadX: 0.08,
    /** Keycap outline line width and corner radius. */
    keyLineWidth: 0.06,
    keyRadius: 0.18,
    /** Least space between a keycap outline and its right-aligned action text. */
    minGap: 0.1,
} as const;

/** One controls-card row in card-local units (+X across, +Z down the screen). */
export interface ControlsRowLayout {
    keys: string;
    action: string;
    z: number;
    /** Keycap outline centre and outer width (the key text is centred in it). */
    keyX: number;
    keyW: number;
    /** Right edge of the right-aligned action text, and its estimated left edge. */
    actionRight: number;
    actionLeft: number;
}

/**
 * Lays out the card rows from a text width estimate (Layout.estimateTextWidth:
 * conservative, so real text only leaves more room).
 */
export function controlsCardLayout(
    card: { w: number; d: number; rows: number },
    size: number,
    estimate: (text: string, size: number) => number
): ControlsRowLayout[] {
    const pitch = card.d / card.rows;
    const keyLeft = -card.w / 2 + CARD_STYLE.inset;
    const actionRight = card.w / 2 - CARD_STYLE.inset;
    return CONTROLS_ROWS.slice(0, card.rows).map((row, i) => {
        const keyW = estimate(row.keys, size) + 2 * CARD_STYLE.keyPadX;
        return {
            ...row,
            z: (i - (card.rows - 1) / 2) * pitch,
            keyX: keyLeft + keyW / 2,
            keyW,
            actionRight,
            actionLeft: actionRight - estimate(row.action, size),
        };
    });
}

export interface WelcomeHandle extends AreaHandle {
    /** The hero word (null only if the AreaDef carries no title3D). */
    hero: Word3D | null;
    roleLine: TextHandle;
    greeting: TextHandle;
    /** Controls card: plate + keycap outlines (`chrome`) and its desktopOnly texts. */
    controls: { group: THREE.Group; chrome: THREE.Group; texts: TextHandle[] };
    pathLabels: TextHandle[];
}

export function build(ctx: AreaContext): WelcomeHandle {
    const { group, materials, shapes, text } = ctx;
    const W = ctx.layout.AREA_LAYOUT.welcome;
    const TY = CONFIG.type;
    const geometries: THREE.BufferGeometry[] = [];
    const texts: TextHandle[] = [];
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
        geometries.push(g);
        return g;
    };

    let hero: Word3D | null = null;

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    const release = () => {
        // Text3DSystem words carry dispose() (removes their bodies); the contract type doesn't.
        (hero as (Word3D & { dispose?: () => void }) | null)?.dispose?.();
        hero = null;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        group.clear();
    };

    try {
        // ── Plaza plate over the rect ────────────────────────────────────
        const rect = ctx.def.rect;
        const plaza = new THREE.Mesh(
            geo(shapes.flatPlate(rect.w, rect.d, W.plazaRadius, "plaza")),
            materials.lambert(PALETTE.plaza, { layer: "plaza" })
        );
        plaza.name = "welcome-plaza";
        plaza.position.set(rect.x, 0, rect.z);
        shapes.applyLayerToObject(plaza, "plaza");
        plaza.raycast = () => {};
        group.add(plaza);

        // ── Hero word (dynamic, ink) ─────────────────────────────────────
        const title = ctx.def.title3D;
        if (title) {
            hero = ctx.text3d.word(title.text, {
                cap: TY.heroWord.cap,
                depth: TY.heroWord.depth,
                curveSegments: TY.heroWord.curveSegments,
                color: PALETTE.ink,
                dynamic: title.dynamic,
            });
            hero.group.position.set(title.x, 0, title.z);
            hero.group.rotation.y = FACE_CAMERA_Y;
            group.add(hero.group); // placed once; Areas arms it when build() returns
        }

        // ── Role line + greeting (flat, faceCamera) ──────────────────────
        const flatAt = (h: TextHandle, x: number, z: number): TextHandle => {
            h.object.position.set(x, 0, z);
            h.object.rotation.y = FACE_CAMERA_Y;
            group.add(h.object);
            texts.push(h);
            return h;
        };
        const roleLine = flatAt(
            text.flat({
                text: meta.role,
                font: TY.roleLine.font,
                size: TY.roleLine.size,
                letterSpacing: TY.roleLine.letterSpacing,
                color: PALETTE.ink,
                anchorX: "center",
                anchorY: "middle",
            }),
            W.roleLine.x,
            W.roleLine.z
        );
        // Yoruba: Inter only (§3.2). ink2 is allowed here: it sits on the plaza.
        const greeting = flatAt(
            text.flat({
                text: meta.greeting,
                font: "medium",
                size: TY.floorCaption.size,
                color: PALETTE.ink2,
                anchorX: "center",
                anchorY: "middle",
            }),
            W.greeting.x,
            W.greeting.z
        );

        // ── Controls card (desktop only) ─────────────────────────────────
        const C = W.controlsCard;
        const card = new THREE.Group();
        card.name = "controls-card";
        card.position.set(C.x, 0, C.z);
        card.rotation.y = FACE_CAMERA_Y; // local +X → R (rows read across), +Z → S (rows stack down)
        group.add(card);
        const chrome = new THREE.Group();
        chrome.name = "controls-card-chrome";
        card.add(chrome);

        const plate = new THREE.Mesh(
            geo(shapes.flatPlate(C.w, C.d, CONFIG.pad.cornerRadius, "plate")),
            materials.lambert(PALETTE.paper, { layer: "plate" })
        );
        shapes.applyLayerToObject(plate, "plate");
        plate.raycast = () => {};
        chrome.add(plate);

        const keyH = (C.d / C.rows) * CARD_STYLE.keyHeightFraction;
        const outlineMat = materials.basic(PALETTE.ink2, { layer: "padOnPlate" });
        const D = TY.floorDetail;
        const cardTexts: TextHandle[] = [];
        const cardText = (copy: string, anchorX: "center" | "right", x: number, z: number): TextHandle => {
            const h = text.flat({
                text: copy,
                font: D.font,
                size: D.size,
                color: PALETTE.ink2,
                anchorX,
                anchorY: "middle",
                desktopOnly: true,
            });
            texts.push(h);
            h.object.position.set(x, 0, z);
            card.add(h.object);
            cardTexts.push(h);
            return h;
        };
        for (const row of controlsCardLayout(C, D.size, ctx.layout.estimateTextWidth)) {
            // The outline is drawn ON the paper plate: padOnPlate keeps it off the plate's plane.
            const outline = new THREE.Mesh(
                geo(shapes.flatRing(row.keyW, keyH, CARD_STYLE.keyRadius, CARD_STYLE.keyLineWidth, "padOnPlate")),
                outlineMat
            );
            outline.position.set(row.keyX, 0, row.z);
            shapes.applyLayerToObject(outline, "padOnPlate");
            outline.raycast = () => {};
            chrome.add(outline);
            cardText(row.keys, "center", row.keyX, row.z);
            cardText(row.action, "right", row.actionRight, row.z);
        }
        // The card is desktop-only as a whole: plate + outlines follow the text rule.
        const syncCard = () => {
            const shown = cardTexts.length > 0 ? cardTexts[0].mesh.visible : !ctx.runtime.isTouch;
            chrome.visible = shown;
        };
        syncCard();

        // ── Welcome's path labels (P1 CROSSROADS, P7 ABOUT & CONTACT) ────
        const pathLabels = buildOwnedPathLabels(text, ctx.def.id);
        texts.push(...pathLabels);
        for (const h of pathLabels) group.add(h.object);

        // ── Auto-reset (§3.3): letters go home on the near → far change ──
        const resetDistance = CONFIG.physics.heroLetterResetDistance;
        let far = false;
        let disposed = false;

        return {
            group,
            hero,
            roleLine,
            greeting,
            controls: { group: card, chrome, texts: cardTexts },
            pathLabels,
            update(_dt: number, _t: number, rt: RuntimeInfo) {
                if (disposed) return;
                syncCard();
                if (!hero || !title) return;
                const nowFar = Math.hypot(rt.carPos.x - title.x, rt.carPos.z - title.z) > resetDistance;
                if (nowFar && !far) hero.reset();
                far = nowFar;
            },
            reset() {
                if (!disposed) hero?.reset();
            },
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

registerArea("welcome", build);
