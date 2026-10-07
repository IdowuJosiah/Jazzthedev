import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import gsap from "gsap";
import { CONFIG, FACE_CAMERA_Y, PALETTE, type HexColor } from "../Config";
import { applyLayerToObject, flatPlate, flatRing } from "../utils/shapes";
import type { FlatLayerId } from "../utils/shapes";
import type { MaterialsApi, PadDef, TextApi, TextHandle } from "../types";

// The one interaction language (§5.3): a flat rounded-rect pad outline on the
// plates layer (idle: ink @ 0.35; active: ACCENT @ 1 + width 0.32 + paper fill
// @ 0.55), an optional flat label, and a desktop keycap that pops up.

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

export interface KeycapOptions {
    label?: string;
    /**
     * Under reduced motion the keycap snaps instead of tweening. Pass a getter
     * (`() => ctx.runtime.reducedMotion`) so a runtime toggle (Menu or OS) is
     * honoured; a boolean is read as a fixed value.
     */
    reducedMotion?: boolean | (() => boolean);
}

export interface Keycap {
    /** Place it at the pad centre (faceCamera); it rises from y 0 to 2.2. */
    group: THREE.Group;
    readonly shown: boolean;
    show(): void;
    hide(): void;
    /** Punch down to 1.6, then recover (on interact). */
    punch(): void;
    dispose(): void;
}

/** Desktop-only keycap: paper RoundedBox(1.4, 1.4, 0.5, 2, 0.2) with an ink "E". */
export function buildKeycap(deps: PadDeps, opts: KeycapOptions = {}): Keycap {
    const K = P.keycap;
    const group = new THREE.Group();
    group.name = "keycap";
    group.rotation.y = FACE_CAMERA_Y;

    const cap = new THREE.Group();
    cap.position.y = K.restY;
    cap.visible = false;
    group.add(cap);

    const geo = new RoundedBoxGeometry(K.size, K.size, K.depth, K.segments, K.radius);
    const body = new THREE.Mesh(geo, deps.materials.lambert(PALETTE.paper));
    // Never a shadow caster (§1.5 casters list): it rises over the pad label and
    // would shade ground text (§1.2 sun-side strip rule).
    body.castShadow = false;
    body.position.y = K.size / 2;
    body.raycast = () => {};
    cap.add(body);

    const letter = deps.text.upright({
        text: opts.label ?? K.label,
        font: "bold",
        size: K.labelSize,
        color: PALETTE.ink,
        anchorX: "center",
        anchorY: "middle",
    });
    letter.object.position.set(0, K.size / 2, K.depth / 2 + K.labelInset);
    cap.add(letter.object);

    let shown = false;
    const kill = () => gsap.killTweensOf(cap.position);
    const rm = () => (typeof opts.reducedMotion === "function" ? opts.reducedMotion() : !!opts.reducedMotion);

    return {
        group,
        get shown() {
            return shown;
        },
        show() {
            if (shown) return;
            shown = true;
            kill();
            cap.visible = true;
            if (rm()) {
                cap.position.y = K.raisedY;
                return;
            }
            gsap.to(cap.position, { y: K.raisedY, duration: K.rise.duration, ease: K.rise.ease });
        },
        hide() {
            if (!shown) return;
            shown = false;
            kill();
            if (rm()) {
                cap.position.y = K.restY;
                cap.visible = false;
                return;
            }
            gsap.to(cap.position, {
                y: K.restY,
                duration: K.drop.duration,
                ease: K.drop.ease,
                onComplete: () => {
                    if (!shown) cap.visible = false;
                },
            });
        },
        punch() {
            if (!shown) return;
            kill();
            if (rm()) {
                // Reduced motion switched on mid-rise: settle at the raised pose.
                cap.position.y = K.raisedY;
                return;
            }
            gsap.timeline()
                .to(cap.position, { y: K.punchY, duration: K.punch.duration, ease: "none" })
                .to(cap.position, { y: K.raisedY, duration: K.punch.recover, ease: K.punch.recoverEase });
        },
        dispose() {
            kill();
            geo.dispose();
            letter.dispose();
            group.removeFromParent();
        },
    };
}
