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
// - Role line (Inter Bold 1.1, ink) and greeting (CONFIG.type.greeting, ink2,
//   on the plaza), flat and faceCamera.
// - No in-world controls card (owner direction, DECISIONS.md "Owner:
//   desktop-first, no on-screen controls"); the controls live in Menu → Controls.
// - Plaza plate (plaza layer) over the rect, radius 3.
// - Path labels P1 CROSSROADS and P7 ABOUT & CONTACT (Paths.ts ownership).
// ─────────────────────────────────────────────────────────────────────────

export interface WelcomeHandle extends AreaHandle {
    /** The hero word (null only if the AreaDef carries no title3D). */
    hero: Word3D | null;
    roleLine: TextHandle;
    greeting: TextHandle;
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
                font: TY.greeting.font,
                size: TY.greeting.size,
                color: PALETTE.ink2,
                anchorX: "center",
                anchorY: "middle",
            }),
            W.greeting.x,
            W.greeting.z
        );

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
            pathLabels,
            update(_dt: number, _t: number, rt: RuntimeInfo) {
                if (disposed || !hero || !title) return;
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
