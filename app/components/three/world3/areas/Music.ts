import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { areaCopy, musicPillars, type InfoContent } from "@/app/field/content/world";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { buildPad, type PadVisual } from "../ui3d/Pad";
import { damp } from "../utils/math";
import type { AreaContext, AreaHandle, RuntimeInfo, TextHandle, Word3D } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Music & Culture (§2.4, §5.2, §5.3). Everything comes from Layout
// (AREA_LAYOUT.music, the music AreaDef, the "sleeve-i" PADS entries):
//
// - 3D title `MUSIC`: static Bricolage letters in ACCENT_INK.music (cap 2.4);
//   Areas arms the word (fixed colliders) right after this builder returns.
// - Stage: an ink RoundedBox (18 along R × 1 × 8 along S), faceCamera, with
//   one fixed collider.
// - Vinyl: an ink disc on the stage top with an ACCENT.music label disc. It
//   turns about Y at 0.6 rad/s and stands still under reduced motion (read
//   live from the runtime). A paper bar across the label makes the turn
//   visible on an otherwise rotationally symmetric disc.
// - Two stone speakers on the stage top.
// - Nine EQ bars (ACCENT.music, one InstancedMesh) on the stage top: driven
//   by `audio.getBands(9)` while sound is on and the music plays, else (and
//   under reduced motion) they hold the static heights 1 2 3 4 3 2 3 2 1.
// - Four upright paper record sleeves (one per musicPillars entry) with an
//   ACCENT.music strip along the top of the front face and the pillar title
//   (Inter Bold 0.7, ink, upright). Each has a thin fixed collider and a pad
//   (Pad.ts outline / fill, no label, no keycap) that opens its panel.
// ─────────────────────────────────────────────────────────────────────────

// ── Stream-local presentation constants (no Config slot) ─────────────────
/** Lowest driven EQ bar height (a silent band still shows a stub). */
const EQ_MIN_HEIGHT = 0.4;
/** EQ bar height smoothing (damp lambda, 1/s). */
const EQ_LAMBDA = 18;
/** Height of the vinyl label disc and its bar above the vinyl top (no z-fight). */
const VINYL_DECAL_LIFT = 0.004;
/** The paper bar across the vinyl label: width, and length as a fraction of the label diameter. */
const VINYL_MARK = { w: 0.22, lengthFraction: 0.8 } as const;
/** Front-face decals (strip, title) sit this far in front of the sleeve face. */
const SLEEVE_DECAL_LIFT = 0.005;
/** Prompt card action (§5.3). */
const PROMPT_ACTION = "Open record";
/** Link label for a pillar's URL in its panel. */
const LINK_LABEL = "Visit site";

const hexToNumber = (hex: string): number => parseInt(hex.slice(1), 16);

/** rotation.y = FACE_CAMERA_Y as a quaternion (fixed colliders of faceCamera props). */
const faceCameraQuat = (): THREE.Quaternion =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);

/** The panel a sleeve pad opens. */
export function musicPillarContent(i: number): InfoContent {
    const p = musicPillars[i];
    return {
        title: p.title,
        sub: areaCopy.music.name,
        body: p.body,
        links: p.url ? [{ label: LINK_LABEL, url: p.url }] : undefined,
        accent: hexToNumber(ACCENT.music),
    };
}

/**
 * Target EQ bar heights: the bands (each in [0, 1]) mapped onto
 * [EQ_MIN_HEIGHT, max static height], or the static heights when `bands` is null.
 */
export function eqTargets(
    bands: ArrayLike<number> | null,
    staticHeights: readonly number[],
    out: number[] = new Array<number>(staticHeights.length)
): number[] {
    const max = Math.max(...staticHeights);
    for (let i = 0; i < staticHeights.length; i++) {
        const b = bands ? Math.min(1, Math.max(0, bands[i] ?? 0)) : null;
        out[i] = b === null ? staticHeights[i] : EQ_MIN_HEIGHT + b * (max - EQ_MIN_HEIGHT);
    }
    return out;
}

export interface MusicHandle extends AreaHandle {
    title: Word3D | null;
    stage: THREE.Mesh;
    /** Turns about Y (its children: the disc, the label and the label bar). */
    vinyl: THREE.Group;
    speakers: THREE.Mesh[];
    /** One instance per bar; each bar's height is its instance's scale.y. */
    eq: THREE.InstancedMesh;
    /** Current bar heights (read-only view for tests / debug). */
    readonly eqHeights: readonly number[];
    sleeves: THREE.Group[];
    sleeveTitles: TextHandle[];
    pads: PadVisual[];
    colliders: RAPIER.RigidBody[];
}

export function build(ctx: AreaContext): MusicHandle {
    const { group, materials, text } = ctx;
    const M = ctx.layout.AREA_LAYOUT.music;
    const TY = CONFIG.type;

    const geometries: THREE.BufferGeometry[] = [];
    const texts: TextHandle[] = [];
    const bodies: RAPIER.RigidBody[] = [];
    const pads: PadVisual[] = [];
    const unregister: (() => void)[] = [];
    let title: Word3D | null = null;
    let eq: THREE.InstancedMesh | null = null;
    let disposed = false;
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
        geometries.push(g);
        return g;
    };

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    const release = () => {
        disposed = true;
        for (const off of unregister) off();
        unregister.length = 0;
        // Text3DSystem words carry dispose() (removes their colliders); the contract type doesn't.
        (title as (Word3D & { dispose?: () => void }) | null)?.dispose?.();
        title = null;
        for (const p of pads) p.dispose();
        pads.length = 0;
        for (const b of bodies) ctx.physics.removeBody(b);
        bodies.length = 0;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        eq?.dispose(); // frees the instance buffers (geometry / material are shared)
        eq = null;
        group.clear();
    };

    try {
        const quat = faceCameraQuat();
        const stageTop = M.stage.h;

        // ── 3D title (static, ACCENT_INK.music) ──────────────────────────
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

        // ── Stage ────────────────────────────────────────────────────────
        const st = M.stage;
        const stage = new THREE.Mesh(
            geo(new RoundedBoxGeometry(st.w, st.h, st.d, st.segments, st.radius)),
            materials.lambert(PALETTE.ink)
        );
        stage.name = "music-stage";
        stage.position.set(st.x, st.h / 2, st.z);
        stage.rotation.y = FACE_CAMERA_Y;
        stage.castShadow = true;
        stage.receiveShadow = true;
        stage.raycast = () => {};
        group.add(stage);

        // ── Vinyl (turns about Y) ────────────────────────────────────────
        const V = M.vinyl;
        const vinyl = new THREE.Group();
        vinyl.name = "music-vinyl";
        vinyl.position.set(V.x, stageTop, V.z);
        group.add(vinyl);
        const discGeo = geo(new THREE.CylinderGeometry(V.radius, V.radius, V.height, V.segments));
        discGeo.translate(0, V.height / 2, 0);
        const disc = new THREE.Mesh(discGeo, materials.lambert(PALETTE.ink));
        disc.name = "vinyl-disc";
        disc.castShadow = true;
        disc.receiveShadow = true;
        disc.raycast = () => {};
        const labelGeo = geo(new THREE.CircleGeometry(V.labelRadius, V.segments));
        labelGeo.rotateX(-Math.PI / 2);
        const label = new THREE.Mesh(labelGeo, materials.lambert(ACCENT.music));
        label.name = "vinyl-label";
        label.position.y = V.height + VINYL_DECAL_LIFT;
        label.receiveShadow = true;
        label.raycast = () => {};
        const markGeo = geo(new THREE.PlaneGeometry(V.labelRadius * 2 * VINYL_MARK.lengthFraction, VINYL_MARK.w));
        markGeo.rotateX(-Math.PI / 2);
        const mark = new THREE.Mesh(markGeo, materials.lambert(PALETTE.paper));
        mark.name = "vinyl-mark";
        mark.position.y = V.height + 2 * VINYL_DECAL_LIFT;
        mark.receiveShadow = true;
        mark.raycast = () => {};
        vinyl.add(disc, label, mark);

        // ── Speakers ─────────────────────────────────────────────────────
        const spGeo = geo(new THREE.BoxGeometry(M.speaker.w, M.speaker.h, M.speaker.d));
        const spMat = materials.lambert(PALETTE.stone);
        const speakers = M.speakers.map((p, i) => {
            const m = new THREE.Mesh(spGeo, spMat);
            m.name = `music-speaker-${i}`;
            m.position.set(p.x, stageTop + M.speaker.h / 2, p.z);
            m.rotation.y = FACE_CAMERA_Y;
            m.castShadow = true;
            m.receiveShadow = true;
            m.raycast = () => {};
            group.add(m);
            return m;
        });

        // ── EQ bars: one InstancedMesh, each bar a unit box scaled in y ──
        const barGeo = geo(new THREE.BoxGeometry(M.eqBar.w, M.eqBar.h, M.eqBar.d));
        barGeo.translate(0, M.eqBar.h / 2, 0); // base on the stage top
        const bars = new THREE.InstancedMesh(barGeo, materials.lambert(ACCENT.music), M.eqBars.length);
        eq = bars;
        bars.name = "music-eq";
        bars.castShadow = true;
        bars.receiveShadow = true;
        bars.raycast = () => {};
        group.add(bars);
        const statics: readonly number[] = M.eqStaticHeights;
        const heights = [...statics];
        const targets = [...statics];
        const tmpM = new THREE.Matrix4();
        const tmpP = new THREE.Vector3();
        const tmpS = new THREE.Vector3();
        const writeBars = (hs: readonly number[]) => {
            M.eqBars.forEach((p, i) => {
                tmpP.set(p.x, stageTop, p.z);
                tmpS.set(1, hs[i] / M.eqBar.h, 1);
                bars.setMatrixAt(i, tmpM.compose(tmpP, quat, tmpS));
            });
            bars.instanceMatrix.needsUpdate = true;
        };
        // Bounds once at the tallest pose, so culling never clips a driven bar.
        writeBars(statics.map(() => Math.max(...statics)));
        bars.computeBoundingBox();
        bars.computeBoundingSphere();
        writeBars(heights);

        // ── Record sleeves (one per pillar) + their pads ─────────────────
        const SL = M.sleeve;
        const sleeveGeo = geo(new RoundedBoxGeometry(SL.w, SL.h, SL.d, SL.segments, SL.radius));
        const stripGeo = geo(new THREE.ShapeGeometry(ctx.shapes.roundedRectShape(SL.w, SL.stripH, SL.radius)));
        const sleeveMat = materials.lambert(PALETTE.paper);
        const stripMat = materials.lambert(ACCENT.music);
        const sleeves: THREE.Group[] = [];
        const sleeveTitles: TextHandle[] = [];
        M.sleeves.forEach((p, i) => {
            const pillar = musicPillars[i];
            const sleeve = new THREE.Group();
            sleeve.name = `music-sleeve-${i}`;
            sleeve.position.set(p.x, 0, p.z);
            sleeve.rotation.y = FACE_CAMERA_Y;
            group.add(sleeve);
            sleeves.push(sleeve);

            const box = new THREE.Mesh(sleeveGeo, sleeveMat);
            box.name = "sleeve-box";
            box.position.y = SL.h / 2;
            box.castShadow = true;
            box.receiveShadow = true;
            box.raycast = () => {};
            const strip = new THREE.Mesh(stripGeo, stripMat);
            strip.name = "sleeve-strip";
            strip.position.set(0, SL.h - SL.stripH / 2, SL.d / 2 + SLEEVE_DECAL_LIFT);
            strip.receiveShadow = true;
            strip.raycast = () => {};
            sleeve.add(box, strip);

            const name = text.upright({
                text: pillar.title,
                font: TY.sleeveTitle.font,
                size: TY.sleeveTitle.size,
                color: PALETTE.ink,
                maxWidth: SL.titleMaxWidth,
                anchorX: "center",
                anchorY: "middle",
            });
            texts.push(name);
            sleeveTitles.push(name);
            // Centred on the face below the strip.
            name.object.position.set(0, (SL.h - SL.stripH) / 2, SL.d / 2 + SLEEVE_DECAL_LIFT);
            sleeve.add(name.object);

            const spot = ctx.layout.PADS.find((s) => s.id === `sleeve-${i}`);
            if (!spot) throw new Error(`Layout has no sleeve-${i} pad`);
            const visual = buildPad(spot.pad, { materials, text }, { accent: ctx.def.accent, label: spot.label });
            pads.push(visual);
            group.add(visual.group);
            unregister.push(
                ctx.addInteractable({
                    pad: spot.pad,
                    prompt: { title: pillar.title, action: PROMPT_ACTION },
                    areaId: ctx.def.id,
                    content: musicPillarContent(i),
                    setActive: (on) => visual.setActive(on),
                })
            );
        });

        // ── Colliders last: nothing after them can throw ─────────────────
        bodies.push(
            ctx.physics.addFixedCuboid({ x: st.w / 2, y: st.h / 2, z: st.d / 2 }, { x: st.x, y: st.h / 2, z: st.z }, quat)
        );
        for (const p of M.sleeves) {
            bodies.push(
                ctx.physics.addFixedCuboid({ x: SL.w / 2, y: SL.h / 2, z: SL.d / 2 }, { x: p.x, y: SL.h / 2, z: p.z }, quat)
            );
        }

        return {
            group,
            title,
            stage,
            vinyl,
            speakers,
            eq: bars,
            eqHeights: heights,
            sleeves,
            sleeveTitles,
            pads: [...pads],
            colliders: [...bodies],
            update(dt: number, _t: number, rt: RuntimeInfo) {
                if (disposed) return;
                const still = rt.reducedMotion;
                if (!still) vinyl.rotation.y = (vinyl.rotation.y + V.spin * dt) % (Math.PI * 2);

                // Sound on (and the music playing) → bands; else the static pose.
                const bands = still || rt.muted ? null : ctx.audio.getBands(M.eqBars.length);
                eqTargets(bands, statics, targets);
                let changed = false;
                for (let i = 0; i < heights.length; i++) {
                    const next = still ? targets[i] : damp(heights[i], targets[i], EQ_LAMBDA, dt);
                    if (next !== heights[i]) {
                        heights[i] = next;
                        changed = true;
                    }
                }
                if (changed) writeBars(heights);
            },
            dispose() {
                if (disposed) return;
                release();
            },
        };
    } catch (err) {
        release();
        throw err;
    }
}

registerArea("music", build);
