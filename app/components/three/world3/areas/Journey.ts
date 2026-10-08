import * as THREE from "three";
import { areaCopy, journeyStops, skillTotems, type InfoContent } from "@/app/field/content/world";
import { CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { buildOwnedPathLabels } from "../Paths";
import { buildPad, type PadVisual } from "../ui3d/Pad";
import { LAYERS, type FlatLayerId } from "../utils/shapes";
import type { AreaContext, AreaHandle, PadDef, TextHandle, TextOpts, Word3D } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Journey & Skills (§2.4, §5.2, §5.3). Everything comes from Layout
// (AREA_LAYOUT.journey, the journey AreaDef and its PADS):
//
// - 3D title `JOURNEY`: static Bricolage letters in ACCENT_INK.journey (area
//   title scale), faceCamera. Areas arms it (fixed colliders) when build() returns.
// - Six milestone plates (flush paper, 9×4.6, faceCamera) beside the trail:
//   the year in Bricolage 1.5 (ACCENT_INK.journey) and the title in Inter Bold
//   0.8 (ink, maxWidth 8). The plate is also the pad: it opens that stop's panel.
// - Three skill plates (10×6) on the west side: the category in Inter Bold 0.9
//   (ink) and the proof line in Inter Medium 0.8 (ink2). The plate is also the
//   pad: each opens the full skills list.
// - The flat `NOW` end marker (Bricolage 1.8, ink) on the trail tiles.
//
// Layers (§2.5, DECISIONS.md "padOnPlate"): plates on "plate", their pad
// outline / fill on "padOnPlate", and the plate copy on "padOnPlate" too, so
// the look system can tell copy ON a plate from copy on the ground. The copy
// draws after the active pad fill (renderOrder of the ground-text layer), so
// the fill never veils it. NOW sits on the tiles ("tileText", y 0.10).
// No keycaps (DECISIONS.md, "Owner: desktop-first, no on-screen controls").
// ─────────────────────────────────────────────────────────────────────────

/** Layer of the copy printed on a plate (above the plate and its pad outline). */
const PLATE_TEXT_LAYER: FlatLayerId = "padOnPlate";
/** Plate copy draws after the active pad fill (padOnPlate renderOrder 1). */
const PLATE_TEXT_RENDER_ORDER = LAYERS.groundText.renderOrder;
/** Line height of the wrapped plate copy (titles, categories, proof lines). */
const PLATE_LINE_HEIGHT = 1.15;
const PROMPT_MILESTONE = "Open milestone";
const PROMPT_SKILLS = "Open skills";
const SKILLS_TITLE = "Skills";

export interface PlateBuild {
    /** Plate root: at the plate centre, rotated faceCamera (local +X → R, +Z → S). */
    group: THREE.Group;
    plate: THREE.Mesh;
    pad: PadVisual;
    texts: TextHandle[];
}

export interface JourneyHandle extends AreaHandle {
    title: Word3D | null;
    milestones: PlateBuild[];
    skills: PlateBuild[];
    now: TextHandle;
}

/** "#12A387" → 0x12a387 (InfoContent.accent is numeric). */
const hexNumber = (hex: string): number => parseInt(hex.slice(1), 16);

/** The full skills list every skill plate opens (§5.3). */
export function skillsContent(accent: number): InfoContent {
    return {
        title: SKILLS_TITLE,
        sub: areaCopy.journey.name,
        sections: skillTotems.map((s) => ({ heading: s.category, text: `${s.proof} ${s.skills.join(" · ")}` })),
        accent,
    };
}

export function build(ctx: AreaContext): JourneyHandle {
    const { group, materials, shapes, text } = ctx;
    const J = ctx.layout.AREA_LAYOUT.journey;
    const TY = CONFIG.type;
    const def = ctx.def;
    const accent = hexNumber(def.accent);
    const geometries: THREE.BufferGeometry[] = [];
    const texts: TextHandle[] = [];
    const pads: PadVisual[] = [];
    const unregister: (() => void)[] = [];
    let title: (Word3D & { dispose?: () => void }) | null = null;

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    const release = () => {
        for (const off of unregister) off();
        unregister.length = 0;
        title?.dispose?.(); // Text3DSystem words carry dispose() (removes their bodies)
        title = null;
        for (const p of pads) p.dispose();
        pads.length = 0;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        group.clear();
    };

    const padDef = (id: string): PadDef => {
        const spot = ctx.layout.PADS.find((p) => p.id === id);
        if (!spot) throw new Error(`[world3/journey] Layout has no pad "${id}"`);
        return spot.pad;
    };

    /** Flat copy on a plate, at plate-local (lx, lz). */
    const plateText = (parent: THREE.Object3D, o: Omit<TextOpts, "layer">, lx: number, lz: number): TextHandle => {
        const h = text.flat({ ...o, layer: PLATE_TEXT_LAYER, lineHeight: o.lineHeight ?? PLATE_LINE_HEIGHT });
        texts.push(h);
        h.mesh.renderOrder = PLATE_TEXT_RENDER_ORDER;
        h.object.position.set(lx, 0, lz); // flat text already sits at its layer height
        parent.add(h.object);
        return h;
    };

    /** A flush paper plate that is also its pad (outline + fill on padOnPlate). */
    const plateWithPad = (pad: PadDef, plateGeo: THREE.BufferGeometry, name: string) => {
        const root = new THREE.Group();
        root.name = name;
        root.position.set(pad.x, 0, pad.z);
        root.rotation.y = FACE_CAMERA_Y;
        const plate = new THREE.Mesh(plateGeo, materials.lambert(PALETTE.paper, { layer: "plate" }));
        plate.name = `${name}-plate`;
        shapes.applyLayerToObject(plate, "plate");
        plate.raycast = () => {};
        root.add(plate);
        group.add(root);
        const visual = buildPad(pad, { materials, text }, { accent: def.accent, layer: "padOnPlate" });
        pads.push(visual);
        group.add(visual.group);
        return { root, plate, visual };
    };

    try {
        // ── 3D title (static, ACCENT_INK.journey) ────────────────────────
        const t3 = def.title3D;
        if (t3) {
            title = ctx.text3d.word(t3.text, {
                cap: TY.areaTitle.cap,
                depth: TY.areaTitle.depth,
                curveSegments: TY.areaTitle.curveSegments,
                color: def.accentInk,
                dynamic: t3.dynamic,
            });
            title.group.position.set(t3.x, 0, t3.z);
            title.group.rotation.y = FACE_CAMERA_Y;
            group.add(title.group); // placed once; Areas arms it when build() returns
        }

        // ── Milestone plates (year + title), each its own pad ────────────
        const MP = J.milestonePlate;
        const radius = CONFIG.pad.cornerRadius;
        // Copy inset from the plate edge: the margin the title's maxWidth leaves.
        const inset = (MP.w - MP.titleMaxWidth) / 2;
        const milestoneGeo = shapes.flatPlate(MP.w, MP.d, radius, "plate");
        geometries.push(milestoneGeo);
        const milestones: PlateBuild[] = [];
        J.milestones.forEach((_, i) => {
            const stop = journeyStops[i];
            const pad = padDef(`milestone-${i}`);
            const { root, plate, visual } = plateWithPad(pad, milestoneGeo, `milestone-${i}`);
            const year = plateText(
                root,
                {
                    text: stop.year,
                    font: TY.numerals.font,
                    size: TY.numerals.min,
                    color: def.accentInk,
                    anchorX: "left",
                    anchorY: "top",
                },
                -MP.w / 2 + inset,
                -MP.d / 2 + inset
            );
            const heading = plateText(
                root,
                {
                    text: stop.title,
                    font: "bold",
                    size: TY.minFlatSize,
                    color: PALETTE.ink,
                    maxWidth: MP.titleMaxWidth,
                    anchorX: "left",
                    anchorY: "bottom",
                },
                -MP.w / 2 + inset,
                MP.d / 2 - inset
            );
            const content: InfoContent = { title: stop.title, sub: stop.year, body: stop.body, accent };
            unregister.push(
                ctx.addInteractable({
                    pad,
                    prompt: { title: stop.title, action: PROMPT_MILESTONE },
                    areaId: def.id,
                    content,
                    setActive: (on) => visual.setActive(on),
                })
            );
            milestones.push({ group: root, plate, pad: visual, texts: [year, heading] });
        });

        // ── Skill plates (category + proof), each opens the skills list ──
        const SP = J.skillPlate;
        const skillGeo = shapes.flatPlate(SP.w, SP.d, radius, "plate");
        geometries.push(skillGeo);
        const skillsPanel = skillsContent(accent);
        const skills: PlateBuild[] = [];
        J.skills.forEach((_, i) => {
            const totem = skillTotems[i];
            const pad = padDef(`skill-${i}`);
            const { root, plate, visual } = plateWithPad(pad, skillGeo, `skill-${i}`);
            const maxWidth = SP.w - 2 * inset;
            const category = plateText(
                root,
                {
                    text: totem.category,
                    font: TY.floorCaption.font,
                    size: TY.floorCaption.size,
                    color: PALETTE.ink,
                    maxWidth,
                    anchorX: "left",
                    anchorY: "top",
                },
                -SP.w / 2 + inset,
                -SP.d / 2 + inset
            );
            // ink2 is allowed here: it sits on paper (§9.4).
            const proof = plateText(
                root,
                {
                    text: totem.proof,
                    font: "medium",
                    size: TY.minFlatSize,
                    color: PALETTE.ink2,
                    maxWidth,
                    anchorX: "left",
                    anchorY: "bottom",
                },
                -SP.w / 2 + inset,
                SP.d / 2 - inset
            );
            unregister.push(
                ctx.addInteractable({
                    pad,
                    prompt: { title: totem.category, action: PROMPT_SKILLS },
                    areaId: def.id,
                    content: skillsPanel,
                    setActive: (on) => visual.setActive(on),
                })
            );
            skills.push({ group: root, plate, pad: visual, texts: [category, proof] });
        });

        // ── NOW end marker (flat, on the trail tiles) ────────────────────
        const now = text.flat({
            text: "NOW",
            font: TY.numerals.font,
            size: J.now.size,
            color: PALETTE.ink,
            anchorX: "center",
            anchorY: "middle",
            layer: "tileText",
        });
        texts.push(now);
        now.object.position.set(J.now.x, 0, J.now.z);
        now.object.rotation.y = FACE_CAMERA_Y;
        group.add(now.object);

        // ── Path labels this area owns (none in the current Layout) ──────
        for (const h of buildOwnedPathLabels(text, def.id)) {
            texts.push(h);
            group.add(h.object);
        }

        let disposed = false;
        return {
            group,
            title,
            milestones,
            skills,
            now,
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

registerArea("journey", build);
