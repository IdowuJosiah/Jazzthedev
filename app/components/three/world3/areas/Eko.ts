import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { areaCopy, ekoMilestones, type InfoContent } from "@/app/field/content/world";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { boardUrl } from "../Assets";
import { buildPad, type PadVisual } from "../ui3d/Pad";
import type { AreaContext, AreaHandle, RuntimeInfo, TextHandle, Word3D } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Eko, the product case study (§2.4, §5.2, §5.3). Everything comes from
// Layout (AREA_LAYOUT.eko, the eko AreaDef, the "eko" PADS entry):
//
// - 3D title `EKO`: static Bricolage letters in ACCENT_INK.eko (cap 2.4);
//   Areas arms the word (fixed colliders) right after this builder returns.
// - Five flush paper milestone tiles (plate layer), faceCamera, in a row along
//   R. Each carries its number `01`–`05` (Bricolage SDF 2.4, ACCENT.eko) and
//   its title (Inter Bold 0.8, ink) as flat text on the padOnPlate layer, so
//   the copy sits above the plate and the look system knows it is on paper.
// - The hero phone: an ink rounded slab standing on a paper plinth, with a
//   screen plane in front of its face. The screen shows the placeholder colour
//   until the image arrives (lazy, §5.1): `eko-phone.webp` when it exists,
//   else the Eko board image letterboxed (contained) on a paper screen. The
//   image fades in over the boards' 0.6 s (instantly under reduced motion).
//   Fixed colliders: one for the plinth and one for the phone body.
// - One pad (Pad.ts outline / fill + flat label, no keycap) in front of the
//   phone that opens the Eko panel: the five milestones and the eeko.site link.
// ─────────────────────────────────────────────────────────────────────────

/** The Eko board image (scripts/boards: eko.webp, 16:9); also the panel image. */
export const EKO_BOARD = "eko";
/**
 * Phone screen images in order of preference (board names, §5.1): the portrait
 * phone screenshot when scripts/boards produced one, else the board image.
 */
export const PHONE_SCREEN_SOURCES = ["eko-phone", EKO_BOARD] as const;

// ── Stream-local presentation constants (no Config slot) ─────────────────
/** Milestone tile corner radius. */
const TILE_RADIUS = 0.5;
/** Numeral centre, toward screen-up (−S) from the tile centre. */
const TILE_NUMERAL_OFFSET = 1.3;
/** Title centre, toward screen-down (+S) from the tile centre. */
const TILE_TITLE_OFFSET = 1.6;
/** Title margin from each side of the tile (maxWidth = tile.w − 2·margin). */
const TILE_TITLE_MARGIN = 0.6;
/** Letterboxed image sits this many screen insets in front of the face (the screen itself is at one). */
const IMAGE_INSET_STEPS = 2;
/** Size equality tolerance when deciding whether an image letterboxes. */
const FIT_EPSILON = 1e-3;
/** Prompt card action (§5.3). */
const PROMPT_ACTION = "Open case study";

const hexToNumber = (hex: string): number => parseInt(hex.slice(1), 16);

/** rotation.y = FACE_CAMERA_Y as a quaternion (fixed colliders of faceCamera props). */
const faceCameraQuat = (): THREE.Quaternion =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_CAMERA_Y);

/** Largest w × h with the image's aspect that fits inside box w × h ("contain"). */
export function containSize(imageW: number, imageH: number, boxW: number, boxH: number): { w: number; h: number } {
    if (!(imageW > 0) || !(imageH > 0)) return { w: boxW, h: boxH };
    const s = Math.min(boxW / imageW, boxH / imageH);
    return { w: imageW * s, h: imageH * s };
}

/** The panel the Eko pad opens: the five milestones and the eeko.site link. */
export function ekoPanelContent(): InfoContent {
    const links = ekoMilestones
        .filter((m) => m.liveUrl)
        .map((m) => ({ label: `Visit ${new URL(m.liveUrl!).host}`, url: m.liveUrl! }));
    return {
        title: areaCopy.eko.name,
        sub: areaCopy.eko.blurb,
        image: boardUrl(EKO_BOARD),
        sections: ekoMilestones.map((m) => ({ heading: `${m.step} — ${m.title}`, text: m.body })),
        links: links.length > 0 ? links : undefined,
        accent: hexToNumber(ACCENT.eko),
    };
}

/** "01" … for milestone k (0-based). */
export const milestoneNumber = (k: number): string => String(k + 1).padStart(2, "0");

export interface EkoHandle extends AreaHandle {
    title: Word3D | null;
    tiles: THREE.Mesh[];
    numerals: TextHandle[];
    tileTitles: TextHandle[];
    plinth: THREE.Mesh;
    phone: THREE.Group;
    body: THREE.Mesh;
    /** Placeholder until the image arrives, then the letterbox background. */
    screen: THREE.Mesh;
    /** The screen image (hidden until a texture arrives). */
    image: THREE.Mesh;
    colliders: RAPIER.RigidBody[];
    pad: PadVisual;
    /** Which source is on the screen (null: still the placeholder). */
    readonly screenSource: string | null;
}

export function build(ctx: AreaContext): EkoHandle {
    const { group, materials, shapes, text } = ctx;
    const E = ctx.layout.AREA_LAYOUT.eko;
    const BOARD = ctx.layout.AREA_LAYOUT.projects.board;
    const TY = CONFIG.type;

    const geometries: THREE.BufferGeometry[] = [];
    const texts: TextHandle[] = [];
    const bodies: RAPIER.RigidBody[] = [];
    const unregister: (() => void)[] = [];
    let title: Word3D | null = null;
    let pad: PadVisual | null = null;
    let imageMaterial: THREE.MeshBasicMaterial | null = null;
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
        pad?.dispose();
        pad = null;
        for (const b of bodies) ctx.physics.removeBody(b);
        bodies.length = 0;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        // The texture is owned by Assets; only our material is freed.
        imageMaterial?.dispose();
        imageMaterial = null;
        group.clear();
    };

    try {
        const quat = faceCameraQuat();

        // ── 3D title (static, ACCENT_INK.eko) ────────────────────────────
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

        // ── Milestone tiles (flush paper plates, numbered 01–05) ─────────
        const tileGeo = geo(shapes.flatPlate(E.tile.w, E.tile.d, TILE_RADIUS, "plate"));
        const tileMat = materials.lambert(PALETTE.paper, { layer: "plate" });
        const tiles: THREE.Mesh[] = [];
        const numerals: TextHandle[] = [];
        const tileTitles: TextHandle[] = [];
        E.tiles.forEach((p, k) => {
            const m = ekoMilestones[k];
            const tile = new THREE.Group();
            tile.name = `eko-tile-${k}`;
            tile.position.set(p.x, 0, p.z);
            tile.rotation.y = FACE_CAMERA_Y;
            group.add(tile);

            const plate = new THREE.Mesh(tileGeo, tileMat);
            plate.name = "eko-tile-plate";
            shapes.applyLayerToObject(plate, "plate");
            plate.raycast = () => {};
            tile.add(plate);
            tiles.push(plate);

            const numeral = text.flat({
                text: milestoneNumber(k),
                font: TY.numerals.font,
                size: E.tile.numeralSize,
                color: ACCENT.eko,
                anchorX: "center",
                anchorY: "middle",
                layer: "padOnPlate",
            });
            texts.push(numeral);
            numerals.push(numeral);
            numeral.object.position.set(0, 0, -TILE_NUMERAL_OFFSET);
            tile.add(numeral.object);

            const label = text.flat({
                text: m.title,
                font: TY.padLabel.font,
                size: TY.minFlatSize,
                color: PALETTE.ink,
                maxWidth: E.tile.w - 2 * TILE_TITLE_MARGIN,
                anchorX: "center",
                anchorY: "middle",
                layer: "padOnPlate",
            });
            texts.push(label);
            tileTitles.push(label);
            label.object.position.set(0, 0, TILE_TITLE_OFFSET);
            tile.add(label.object);
        });

        // ── The hero phone on its plinth ─────────────────────────────────
        const P = E.phone;
        const pl = P.plinth;
        const plinth = new THREE.Mesh(
            geo(new RoundedBoxGeometry(pl.w, pl.h, pl.d, pl.segments, pl.radius)),
            materials.lambert(PALETTE.paper)
        );
        plinth.name = "eko-plinth";
        plinth.position.set(P.position.x, pl.h / 2, P.position.z);
        plinth.rotation.y = FACE_CAMERA_Y;
        plinth.castShadow = true;
        plinth.receiveShadow = true;
        plinth.raycast = () => {};
        group.add(plinth);

        const phone = new THREE.Group();
        phone.name = "eko-phone";
        phone.position.set(P.position.x, pl.h, P.position.z);
        phone.rotation.y = FACE_CAMERA_Y;
        group.add(phone);

        // A front-view rounded rect extruded by `depth`, stood upright: the
        // slab's depth axis (Z) becomes height, its thickness (Y) faces +Z.
        const B = P.body;
        const bodyGeo = geo(shapes.roundedSlab(B.w, B.h, B.depth, B.radius));
        bodyGeo.rotateX(Math.PI / 2);
        bodyGeo.translate(0, B.h / 2, -B.depth / 2);
        const body = new THREE.Mesh(bodyGeo, materials.lambert(PALETTE.ink));
        body.name = "eko-phone-body";
        body.castShadow = true;
        body.receiveShadow = true;
        body.raycast = () => {};
        phone.add(body);

        const S = P.screen;
        const screen = new THREE.Mesh(
            geo(new THREE.PlaneGeometry(S.w, S.h)),
            materials.basic(PALETTE.imagePlaceholder)
        );
        screen.name = "eko-phone-screen";
        screen.position.set(0, B.h / 2, B.depth / 2 + S.inset);
        screen.raycast = () => {};
        phone.add(screen);

        const image = new THREE.Mesh(geo(new THREE.PlaneGeometry(1, 1)));
        image.name = "eko-phone-image";
        image.position.set(0, B.h / 2, B.depth / 2 + S.inset * IMAGE_INSET_STEPS);
        image.visible = false;
        image.raycast = () => {};
        phone.add(image);

        // ── Pad (opens the Eko panel) ────────────────────────────────────
        const spot = ctx.layout.PADS.find((s) => s.id === ctx.def.id);
        if (!spot) throw new Error("Layout has no eko pad");
        const visual = buildPad(spot.pad, { materials, text }, { accent: ctx.def.accent, label: spot.label });
        pad = visual;
        group.add(visual.group);
        unregister.push(
            ctx.addInteractable({
                pad: spot.pad,
                prompt: { title: areaCopy.eko.name, action: PROMPT_ACTION },
                areaId: ctx.def.id,
                content: ekoPanelContent(),
                setActive: (on) => visual.setActive(on),
            })
        );

        // ── Lazy screen image (§5.1): primary source, then the fallback ──
        const loader = ctx.assets.boards;
        loader.register(PHONE_SCREEN_SOURCES[0], P.position.x, P.position.z);
        let requested = false;
        let screenSource: string | null = null;
        let fade = 1;

        const show = (source: string, texture: THREE.Texture) => {
            const img = texture.image as { width?: number; height?: number } | null | undefined;
            const size = containSize(img?.width ?? S.w, img?.height ?? S.h, S.w, S.h);
            image.scale.set(size.w, size.h, 1);
            const instant = ctx.runtime.reducedMotion;
            imageMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                fog: true,
                transparent: !instant,
                opacity: instant ? 1 : 0,
            });
            image.material = imageMaterial;
            image.visible = true;
            fade = instant ? 1 : 0;
            // Letterboxed: the bars are a paper screen, not the placeholder.
            const letterboxed = size.w < S.w - FIT_EPSILON || size.h < S.h - FIT_EPSILON;
            if (letterboxed) screen.material = materials.basic(PALETTE.paper);
            screenSource = source;
        };

        const loadScreen = async () => {
            for (const source of PHONE_SCREEN_SOURCES) {
                const texture = await loader.request(source);
                if (disposed) return;
                if (texture) {
                    show(source, texture);
                    return;
                }
            }
            // Every source failed: the placeholder colour stays.
        };

        // ── Colliders last: nothing after them can throw ──────────────
        bodies.push(
            ctx.physics.addFixedCuboid(
                { x: pl.w / 2, y: pl.h / 2, z: pl.d / 2 },
                { x: P.position.x, y: pl.h / 2, z: P.position.z },
                quat
            ),
            ctx.physics.addFixedCuboid(
                { x: B.w / 2, y: B.h / 2, z: B.depth / 2 },
                { x: P.position.x, y: pl.h + B.h / 2, z: P.position.z },
                quat
            )
        );

        return {
            group,
            title,
            tiles,
            numerals,
            tileTitles,
            plinth,
            phone,
            body,
            screen,
            image,
            colliders: [...bodies],
            pad: visual,
            get screenSource() {
                return screenSource;
            },
            update(dt: number, _t: number, rt: RuntimeInfo) {
                if (disposed) return;
                if (!requested) {
                    const d = Math.hypot(rt.carPos.x - P.position.x, rt.carPos.z - P.position.z);
                    if (d <= BOARD.lazyLoadDistance) {
                        requested = true;
                        void loadScreen();
                    }
                }
                if (fade < 1 && imageMaterial) {
                    fade = rt.reducedMotion ? 1 : Math.min(1, fade + dt / BOARD.fadeIn);
                    imageMaterial.opacity = fade;
                    if (fade >= 1) {
                        imageMaterial.transparent = false;
                        imageMaterial.needsUpdate = true;
                    }
                }
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

registerArea("eko", build);
