import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { about, contactLinks, type ContactLink } from "@/app/field/content/world";
import { CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { buildOwnedPathLabels } from "../Paths";
import { buildPad, type PadVisual } from "../ui3d/Pad";
import { LAYERS, type FlatLayerId } from "../utils/shapes";
import type { AreaContext, AreaHandle, PadDef, RuntimeInfo, TextHandle, Word3D } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// About & Contact (§2.4, §5.2, §5.3, §8.3). Everything comes from Layout
// (AREA_LAYOUT.about, the about AreaDef and its PADS):
//
// - 3D title `ABOUT`: static Bricolage letters in ACCENT_INK.brand, faceCamera.
// - Portrait board: paper RoundedBox(5, 6.2, 0.3) frame on two ink legs, with
//   `profile.webp` (4.4 square) on its face; one fixed collider covers frame +
//   legs. The image is fetched at build (it is in the first-load budget) and
//   shows the placeholder colour until it arrives.
//   If Assets provides `avatar.glb` (model("avatar") is non-null), the figure
//   replaces the board automatically (§8.3): scaled to AVATAR.height, feet on
//   the ground, faceCamera, a fixed cylinder collider. Its optional `Idle` clip
//   loops and `Wave` plays once each time the car comes within AVATAR.waveDistance;
//   both stay still under reduced motion (read live from the runtime).
// - Plaza plate over the rect (the bio sits "on the plaza", §2.4).
// - Bio: `about.bioShort` flat on the plaza, Inter Medium 0.85, ink, maxWidth
//   16, lineHeight 1.35 (≤ 3 lines; the full bio lives in the panel).
// - Contact pads: a flush paper plate per contact link that has a URL (CV only
//   when one exists), each its own pad with its label on the plate. Interact
//   calls commands.openUrl(url) synchronously, inside the input handler (§4.3).
// ─────────────────────────────────────────────────────────────────────────

/** Avatar figure (§8.3): toy scale next to the 3.8-unit car; waves at the car. */
export const AVATAR = {
    /** World height the figure is scaled to. */
    height: 5.5,
    /** Wave once when the car comes within this distance. */
    waveDistance: 12,
    /** Cross-fade between Idle and Wave, seconds. */
    fade: 0.25,
    idleClip: "idle",
    waveClip: "wave",
} as const;
/** Legs / posts stand at this fraction of the half-width (as on the project boards, 3.6 of 5.4). */
const LEG_SPREAD = 2 / 3;
/** Portrait image sits this far in front of the frame face (project boards: 0.18 on a 0.35 frame). */
const IMAGE_LIFT = 0.005;
/** White: the loaded portrait shows unmodified (the placeholder colour is replaced). */
const IMAGE_TINT = 0xffffff;
/** The plaza corner radius shared with the Welcome and Hub plazas. */
const PLAZA_RADIUS_SOURCE = "welcome" as const;
/** Layer of the label printed on a contact plate (above the plate and its pad outline). */
const PLATE_TEXT_LAYER: FlatLayerId = "padOnPlate";
/** Plate copy draws after the active pad fill (padOnPlate renderOrder 1). */
const PLATE_TEXT_RENDER_ORDER = LAYERS.groundText.renderOrder;
/** HTML prompt action per contact link (title: the link's display value). */
const CONTACT_ACTIONS: Readonly<Record<ContactLink["id"], string>> = {
    email: "Send an email",
    github: "Open GitHub",
    linkedin: "Open LinkedIn",
    cv: "Open CV",
};

export interface ContactPadBuild {
    link: ContactLink;
    root: THREE.Group;
    plate: THREE.Mesh;
    pad: PadVisual;
    label: TextHandle;
}

export interface AboutHandle extends AreaHandle {
    title: Word3D | null;
    /** The portrait board root (null when the avatar replaced it). */
    portrait: THREE.Group | null;
    /** The portrait image material (null with the avatar). */
    portraitImage: THREE.MeshBasicMaterial | null;
    /** Resolves once the portrait texture is applied (false: failed, absent or disposed first). */
    portraitReady: Promise<boolean>;
    /** The avatar figure root (null when absent). */
    avatar: THREE.Object3D | null;
    mixer: THREE.AnimationMixer | null;
    collider: RAPIER.RigidBody;
    bio: TextHandle;
    contacts: ContactPadBuild[];
}

/** First clip whose name contains `key` (case-insensitive), e.g. "Armature|Wave". */
const findClip = (clips: readonly THREE.AnimationClip[], key: string) =>
    clips.find((c) => c.name.toLowerCase().includes(key)) ?? null;

export function build(ctx: AreaContext): AboutHandle {
    const { group, materials, shapes, text } = ctx;
    const A = ctx.layout.AREA_LAYOUT.about;
    const TY = CONFIG.type;
    const def = ctx.def;
    const geometries: THREE.BufferGeometry[] = [];
    const ownMaterials: THREE.Material[] = [];
    const texts: TextHandle[] = [];
    const pads: PadVisual[] = [];
    const unregister: (() => void)[] = [];
    let title: (Word3D & { dispose?: () => void }) | null = null;
    let collider: RAPIER.RigidBody | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let idleAction: THREE.AnimationAction | null = null;
    let waveAction: THREE.AnimationAction | null = null;
    let avatar: THREE.Object3D | null = null;
    let released = false;

    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
        geometries.push(g);
        return g;
    };

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    // The avatar clone shares Assets' geometry and materials: never disposed here.
    const release = () => {
        released = true;
        for (const off of unregister) off();
        unregister.length = 0;
        if (collider) ctx.physics.removeBody(collider);
        collider = null;
        if (mixer && avatar) {
            mixer.stopAllAction();
            mixer.uncacheRoot(avatar);
        }
        mixer = null;
        avatar = null;
        title?.dispose?.(); // Text3DSystem words carry dispose() (removes their bodies)
        title = null;
        for (const p of pads) p.dispose();
        pads.length = 0;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        for (const m of ownMaterials) m.dispose();
        ownMaterials.length = 0;
        group.clear();
    };

    try {
        // ── Plaza plate over the rect ────────────────────────────────────
        const rect = def.rect;
        const plaza = new THREE.Mesh(
            geo(shapes.flatPlate(rect.w, rect.d, ctx.layout.AREA_LAYOUT[PLAZA_RADIUS_SOURCE].plazaRadius, "plaza")),
            materials.lambert(PALETTE.plaza, { layer: "plaza" })
        );
        plaza.name = "about-plaza";
        plaza.position.set(rect.x, 0, rect.z);
        shapes.applyLayerToObject(plaza, "plaza");
        plaza.raycast = () => {};
        group.add(plaza);

        // ── 3D title (static, ACCENT_INK.brand) ──────────────────────────
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

        // ── Portrait board, or the avatar figure when Assets has one ─────
        const P = A.portrait;
        const faceCamera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);
        avatar = ctx.assets.model("avatar");
        let portrait: THREE.Group | null = null;
        let portraitImage: THREE.MeshBasicMaterial | null = null;
        let portraitReady: Promise<boolean> = Promise.resolve(false);
        let colliderSpec: () => RAPIER.RigidBody;

        if (avatar) {
            const fig = avatar;
            fig.name = "about-avatar";
            fig.position.set(0, 0, 0);
            fig.rotation.set(0, 0, 0);
            fig.scale.setScalar(1);
            fig.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(fig);
            const size = box.getSize(new THREE.Vector3());
            const s = size.y > 0 ? AVATAR.height / size.y : 1;
            fig.scale.setScalar(s);
            fig.position.set(P.x, -box.min.y * s, P.z);
            fig.rotation.y = FACE_CAMERA_Y;
            fig.traverse((o) => {
                o.raycast = () => {};
            });
            group.add(fig);
            // Torso-sized cylinder: the narrower footprint side, so a waving arm doesn't widen it.
            const radius = Math.max(P.frame.d / 2, (Math.min(size.x, size.z) / 2) * s);
            colliderSpec = () => ctx.physics.addFixedCylinder(AVATAR.height / 2, radius, { x: P.x, y: AVATAR.height / 2, z: P.z });

            const clips = fig.animations ?? [];
            const idleClip = findClip(clips, AVATAR.idleClip);
            const waveClip = findClip(clips, AVATAR.waveClip);
            if (idleClip || waveClip) {
                const m = new THREE.AnimationMixer(fig);
                mixer = m;
                if (idleClip) idleAction = m.clipAction(idleClip).play();
                if (waveClip) waveAction = m.clipAction(waveClip).setLoop(THREE.LoopOnce, 1);
            }
        } else {
            portrait = new THREE.Group();
            portrait.name = "about-portrait";
            portrait.position.set(P.x, 0, P.z);
            portrait.rotation.y = FACE_CAMERA_Y;

            const F = P.frame;
            const frame = new THREE.Mesh(
                geo(new RoundedBoxGeometry(F.w, F.h, F.d, F.segments, F.radius)),
                materials.lambert(PALETTE.paper)
            );
            frame.name = "about-portrait-frame";
            frame.position.set(0, P.leg.h + F.h / 2, 0);
            const legGeo = geo(new THREE.BoxGeometry(P.leg.w, P.leg.h, P.leg.d));
            const legs = [-1, 1].map((side) => {
                const leg = new THREE.Mesh(legGeo, materials.lambert(PALETTE.ink));
                leg.name = "about-portrait-leg";
                leg.position.set((side * F.w * LEG_SPREAD) / 2, P.leg.h / 2, 0);
                return leg;
            });
            for (const m of [frame, ...legs]) {
                m.castShadow = true; // §1.5 static props cast and receive
                m.receiveShadow = true;
                m.raycast = () => {};
                portrait.add(m);
            }

            // profile.webp, square, centred across the face with an equal top margin.
            const margin = (F.w - P.image) / 2;
            const image = new THREE.MeshBasicMaterial({ color: PALETTE.imagePlaceholder, fog: true });
            ownMaterials.push(image);
            portraitImage = image;
            const imageMesh = new THREE.Mesh(geo(new THREE.PlaneGeometry(P.image, P.image)), image);
            imageMesh.name = "about-portrait-image";
            imageMesh.position.set(0, P.leg.h + F.h - margin - P.image / 2, F.d / 2 + IMAGE_LIFT);
            imageMesh.castShadow = false;
            imageMesh.raycast = () => {};
            portrait.add(imageMesh);
            group.add(portrait);

            portraitReady = ctx.assets.texture(about.portrait).then(
                (tex) => {
                    if (released) return false; // the texture stays Assets' to free
                    image.map = tex;
                    image.color.set(IMAGE_TINT);
                    image.needsUpdate = true;
                    return true;
                },
                (err: unknown) => {
                    if (!released) console.warn(`[world3/about] portrait unavailable: ${about.portrait}`, err);
                    return false;
                }
            );

            const totalH = P.leg.h + F.h;
            colliderSpec = () =>
                ctx.physics.addFixedCuboid({ x: F.w / 2, y: totalH / 2, z: F.d / 2 }, { x: P.x, y: totalH / 2, z: P.z }, faceCamera);
        }

        // ── Bio (flat, on the plaza) ─────────────────────────────────────
        const B = A.bio;
        const bio = text.flat({
            text: about.bioShort,
            font: "medium",
            size: B.size,
            color: PALETTE.ink,
            maxWidth: B.maxWidth,
            lineHeight: B.lineHeight,
            anchorX: "center",
            anchorY: "middle",
            layer: "groundText",
        });
        texts.push(bio);
        bio.mesh.textAlign = "center";
        bio.object.position.set(B.x, 0, B.z);
        bio.object.rotation.y = FACE_CAMERA_Y;
        group.add(bio.object);

        // ── Contact pads (flush plates; CV only when it has a URL) ───────
        const CP = A.contactPad;
        const plateGeo = geo(shapes.flatPlate(CP.w, CP.d, CONFIG.pad.cornerRadius, "plate"));
        const contacts: ContactPadBuild[] = [];
        for (const link of contactLinks) {
            if (!link.url) continue;
            const spot = ctx.layout.PADS.find((p) => p.id === `contact-${link.id}`);
            if (!spot) throw new Error(`[world3/about] Layout has no pad "contact-${link.id}"`);
            const pad: PadDef = spot.pad;

            const root = new THREE.Group();
            root.name = `contact-${link.id}`;
            root.position.set(pad.x, 0, pad.z);
            root.rotation.y = FACE_CAMERA_Y;
            const plate = new THREE.Mesh(plateGeo, materials.lambert(PALETTE.paper, { layer: "plate" }));
            plate.name = `contact-${link.id}-plate`;
            shapes.applyLayerToObject(plate, "plate");
            plate.raycast = () => {};
            root.add(plate);
            group.add(root);

            const visual = buildPad(pad, { materials, text }, { accent: def.accent, layer: "padOnPlate" });
            pads.push(visual);
            group.add(visual.group);

            const label = text.flat({
                text: spot.label ?? link.label,
                font: TY.padLabel.font,
                size: TY.padLabel.size,
                color: PALETTE.ink,
                anchorX: "center",
                anchorY: "middle",
                layer: PLATE_TEXT_LAYER,
            });
            texts.push(label);
            label.mesh.renderOrder = PLATE_TEXT_RENDER_ORDER;
            root.add(label.object);

            const url = link.url;
            unregister.push(
                ctx.addInteractable({
                    pad,
                    prompt: { title: link.display, action: CONTACT_ACTIONS[link.id] },
                    areaId: def.id,
                    // Synchronous, inside the key / click handler (Safari popup rule, §4.3).
                    onInteract: () => ctx.commands.openUrl(url),
                    setActive: (on) => visual.setActive(on),
                })
            );
            contacts.push({ link, root, plate, pad: visual, label });
        }

        // ── Path labels this area owns (none in the current Layout) ──────
        for (const h of buildOwnedPathLabels(text, def.id)) {
            texts.push(h);
            group.add(h.object);
        }

        // ── ONE fixed collider, last: nothing after it can throw ─────────
        const body = colliderSpec();
        collider = body;

        // ── Avatar animation: Idle loops, Wave once on approach ──────────
        const fig: THREE.Object3D | null = avatar;
        const anim: THREE.AnimationMixer | null = mixer;
        const idleA = idleAction;
        const waveA = waveAction;
        const onFinished = (e: { action: THREE.AnimationAction }) => {
            if (e.action !== waveA || !idleA) return;
            idleA.reset().fadeIn(AVATAR.fade).play();
        };
        if (anim) anim.addEventListener("finished", onFinished);
        let near = false;

        let disposed = false;
        return {
            group,
            title,
            portrait,
            portraitImage,
            portraitReady,
            avatar: fig,
            mixer: anim,
            collider: body,
            bio,
            contacts,
            update(dt: number, _t: number, rt: RuntimeInfo) {
                if (disposed || !anim || !fig) return;
                const nowNear = Math.hypot(rt.carPos.x - P.x, rt.carPos.z - P.z) <= AVATAR.waveDistance;
                const entered = nowNear && !near;
                near = nowNear;
                // Reduced motion: the figure holds its pose (no idle sway, no wave).
                if (rt.reducedMotion) return;
                if (entered && waveA) {
                    idleA?.fadeOut(AVATAR.fade);
                    waveA.reset().fadeIn(AVATAR.fade).play();
                }
                anim.update(dt);
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                anim?.removeEventListener("finished", onFinished);
                release();
            },
        };
    } catch (err) {
        release();
        throw err;
    }
}

registerArea("about", build);
