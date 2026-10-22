import * as THREE from "three";
import { CONFIG, FACE_CAMERA_Y, PALETTE, type HexColor } from "../Config";
import { applyLayerToObject, flatPlate, flatRing } from "../utils/shapes";
import type { FlatLayerId } from "../utils/shapes";
import type { MaterialsApi, PadDef, TextApi, TextHandle } from "../types";

// The one interaction language (§5.3): a flat rounded-rect pad outline on the
// plates layer (idle: ink @ 0.35; active: ACCENT @ 1 + width 0.32 + paper fill
// @ 0.55) and an optional flat label. No floating 3D "E" keycap: the HTML
// prompt card names what is in range (DECISIONS.md, "Owner: desktop-first, no
// on-screen controls").

const P = CONFIG.pad;

export interface PadDeps {
    materials: MaterialsApi;
    text: TextApi;
}

export interface PadOptions {
    /** Area accent (ACCENT[area]) used by the active outline. */
    accent: HexColor;
    /** Flat label at the pad centre (Inter Bold 0.9, ink), e.g. "E  OPEN PROJECT". */
    label?: string | null;
    /** Corner radius (defaults to CONFIG.pad.cornerRadius, clamped to the pad). */
    radius?: number;
    /**
     * Flat layer for the outline + fill. Default "plate" (a pad on bare ground).
     * Use "padOnPlate" when the pad is drawn on a plate that is also the pad
     * (milestone, skill and contact plates) so it never shares the plate's plane.
     */
    layer?: FlatLayerId;
}

export interface PadVisual {
    /** Positioned at the pad centre, rotated for faceCamera pads. */
    group: THREE.Group;
    label: TextHandle | null;
    readonly active: boolean;
    setActive(on: boolean): void;
    dispose(): void;
}

/** Builds a pad outline + fill (+ optional label) for a PadDef. */
export function buildPad(def: PadDef, deps: PadDeps, opts: PadOptions): PadVisual {
    const group = new THREE.Group();
    group.name = "pad";
    group.position.set(def.x, 0, def.z);
    if (def.faceCamera) group.rotation.y = FACE_CAMERA_Y;

    const r = Math.min(opts.radius ?? P.cornerRadius, def.w / 2, def.d / 2);
    const layer: FlatLayerId = opts.layer ?? "plate";

    const idleGeo = flatRing(def.w, def.d, r, P.lineWidth, layer);
    const activeGeo = flatRing(def.w, def.d, r, P.activeLineWidth, layer);
    const fillGeo = flatPlate(def.w - 2 * P.activeLineWidth, def.d - 2 * P.activeLineWidth, Math.max(0, r - P.activeLineWidth), layer);

    const idleMat = deps.materials.basic(PALETTE.ink, { layer, opacity: P.idleOpacity });
    const activeMat = deps.materials.basic(opts.accent, { layer, opacity: P.activeOpacity });
    const fillMat = deps.materials.basic(PALETTE.paper, { layer, opacity: P.fillOpacity });

    const outline = new THREE.Mesh(idleGeo, idleMat);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    for (const m of [outline, fill]) {
        applyLayerToObject(m, layer); // the geometry already sits at the layer height
        m.raycast = () => {};
    }
    fill.visible = false;
    group.add(fill, outline);

    let label: TextHandle | null = null;
    if (opts.label) {
        label = deps.text.flat({
            text: opts.label,
            font: CONFIG.type.padLabel.font,
            size: CONFIG.type.padLabel.size,
            color: PALETTE.ink,
            anchorX: "center",
            anchorY: "middle",
            layer: "groundText",
        });
        group.add(label.object);
    }

    let active = false;
    return {
        group,
        label,
        get active() {
            return active;
        },
        setActive(on: boolean) {
            if (on === active) return;
            active = on;
            outline.geometry = on ? activeGeo : idleGeo;
            outline.material = on ? activeMat : idleMat;
            fill.visible = on;
        },
        dispose() {
            // Materials are shared (owned by MaterialsApi); geometry is ours.
            idleGeo.dispose();
            activeGeo.dispose();
            fillGeo.dispose();
            label?.dispose();
            group.removeFromParent();
        },
    };
}
