// ─────────────────────────────────────────────────────────────────────────
// Shared contracts for the v3 world (Step 0, frozen). Only the integrator may
// change these, with a note in DECISIONS.md.
// ─────────────────────────────────────────────────────────────────────────

import type * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Text as TroikaText } from "troika-three-text";
import type { InfoContent } from "@/app/field/content/world";
import type { HexColor, RenderProfileId, SceneryTier, Vec3Like } from "./Config";
import type { FlatLayerId } from "./utils/shapes";
import type { Disposal } from "./utils/disposal";
// Type-only (no runtime cycle): the options shape lives with its implementation.
import type { DynamicBodyOptions } from "./Physics";

export type { HexColor, Vec3Like, RenderProfileId, SceneryTier, DynamicBodyOptions };

// ── Layout ───────────────────────────────────────────────────────────────
export type AreaId =
    | "welcome"
    | "hub"
    | "projects"
    | "journey"
    | "eko"
    | "music"
    | "about"
    | "playground"
    | "credits";

/** World-axis-aligned rectangle: centre (x, z), size w (along X) × d (along Z). */
export interface Rect {
    x: number;
    z: number;
    w: number;
    d: number;
}

export interface XZ {
    x: number;
    z: number;
}

export type CameraShot = "default" | "gallery" | "intro";

export interface AreaDef {
    id: AreaId;
    name: string;
    /** For shapes (pad outlines, map fills). */
    accent: HexColor;
    /** For text and 3D titles (paper only). */
    accentInk: HexColor;
    rect: Rect;
    /** Travel / respawn target; always inside `rect` (Layout.test.ts). */
    arrival: { x: number; z: number; yaw: number };
    /** Shot used while the car is inside `cameraZone` (default: "default"). */
    cameraShot?: CameraShot;
    cameraZone?: Rect;
    /** 3D title word; `dynamic` letters are physics bodies (hero word, PLAY). */
    title3D?: { text: string; x: number; z: number; dynamic: boolean };
}

export interface PathLabel {
    text: string;
    /** Distance from `from` along the path to the label's centre. */
    d: number;
}

export interface PathDef {
    id: string;
    from: XZ;
    to: XZ;
    /** Width in tiles: 2 or 3. */
    width: 2 | 3;
    labels: PathLabel[];
}

/**
 * A rectangular trigger. With `faceCamera`, `w` runs along screen-right R and
 * `d` along screen-down S (the pad is rotated by CAMERA_YAW); otherwise `w`
 * runs along world X and `d` along world Z. Point tests use the pad's local frame.
 */
export interface PadDef {
    x: number;
    z: number;
    w: number;
    d: number;
    faceCamera: boolean;
}

// ── Interaction ──────────────────────────────────────────────────────────
/** HTML prompt card content: `E  {title} — {action}`. */
export interface Prompt {
    title: string;
    action: string;
}

export type MenuTab = "settings" | "controls" | "words" | "contact" | "credits";

export interface WorldInteractable {
    pad: PadDef;
    prompt: Prompt;
    areaId: AreaId;
    /** Opens this content panel on interact (unless `onInteract` is set). */
    content?: InfoContent;
    /** Runs synchronously inside the key/click handler (popups need this). */
    onInteract?: () => void;
    /** Visual highlight toggle (pad outline / keycap). */
    setActive?(on: boolean): void;
}

/** Per-frame values handed to every area's update(). */
export interface RuntimeInfo {
    carPos: THREE.Vector3;
    carSpeed: number;
    reducedMotion: boolean;
    muted: boolean;
    isTouch: boolean;
}

export type ImpactKind = "soft" | "wood" | "heavy";
export type UiSoundKind = "click" | "confirm" | "hover";

export interface AudioApi {
    /** n frequency bands in [0, 1], or null while muted / not started. */
    getBands(n: number): Float32Array | null;
    playImpact(kind: ImpactKind, force: number): void;
    playUi(kind: UiSoundKind): void;
}

/** The subset of world commands areas may call. */
export interface WorldCommands {
    openMenu(tab: MenuTab): void;
    /** Must be called synchronously from an input handler (Safari popup rule). */
    openUrl(url: string): void;
    resetPlayground(): void;
}

// ── Engine services handed to areas ──────────────────────────────────────
export interface QuatLike {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
}

/** Physics wrapper API (§4.4); implemented by Physics.ts (W1-A). */
export interface PhysicsApi {
    readonly world: RAPIER.World;
    /** Fixed-step accumulator; `beforeEachStep(h)` runs per substep. Returns alpha in [0, 1). */
    step(dt: number, beforeEachStep: (h: number) => void): number;
    /** Registers a body → object link (prev/curr pos + quat) for interpolation. */
    link(body: RAPIER.RigidBody, obj: THREE.Object3D): void;
    unlink(body: RAPIER.RigidBody): void;
    interpolate(alpha: number): void;
    /** prev = curr; call after teleport / respawn / reset / auto-flip / travel. */
    snap(body: RAPIER.RigidBody): void;
    addFixedCuboid(halfExtents: Vec3Like, pos: Vec3Like, quat?: QuatLike, offset?: Vec3Like): RAPIER.RigidBody;
    addFixedCylinder(halfHeight: number, radius: number, pos: Vec3Like): RAPIER.RigidBody;
    /** Falls back to a bbox cuboid (with a warning) if convexHull returns null. */
    addFixedConvexHull(points: Float32Array, pos: Vec3Like, quat: QuatLike): RAPIER.RigidBody;
    addGroundSlab(): RAPIER.RigidBody;
    addWall(halfExtents: Vec3Like, pos: Vec3Like): RAPIER.RigidBody;
    onImpact(cb: (kind: ImpactKind, force: number) => void): () => void;
    // ── Wave 1 integration (DECISIONS.md): dynamic props for Wave 2 areas ──
    /** Bricks / boxes. Not linked: call `link(body, mesh)` yourself. */
    addDynamicBox(halfExtents: Vec3Like, pos: Vec3Like, opts: DynamicBodyOptions): RAPIER.RigidBody;
    /** The bowling ball. Not linked. */
    addDynamicBall(radius: number, pos: Vec3Like, opts: DynamicBodyOptions): RAPIER.RigidBody;
    /** Upright (Y-axis) cylinder, e.g. bowling pins. Not linked. */
    addDynamicCylinder(halfHeight: number, radius: number, pos: Vec3Like, opts: DynamicBodyOptions): RAPIER.RigidBody;
    /** Dynamic 3D letter; body origin on the baseline, collider offset by `offset` (§3.3). */
    addDynamicLetter(
        halfExtents: Vec3Like,
        pos: Vec3Like,
        opts: Partial<DynamicBodyOptions> & { offset: Vec3Like }
    ): RAPIER.RigidBody;
    /** Unlinks, forgets impact sources and removes the body with its colliders. */
    removeBody(body: RAPIER.RigidBody): void;
}

export interface LambertOptions {
    flat?: boolean;
    /** Screen-door dither fade between camera and car (§1.3); all scenery. */
    occluder?: boolean;
    /** Flat layer: applies the layer's polygonOffset (cached per layer). */
    layer?: FlatLayerId;
}

export interface BasicOptions {
    /** Default true: every world material fogs consistently (§1.6). */
    fog?: boolean;
    /** Flat layer: polygonOffset / depthWrite from LAYERS. */
    layer?: FlatLayerId;
    /** < 1 makes the material transparent (depthWrite off). Cached per value. */
    opacity?: number;
}

/** Shared palette materials (§1.3); implemented by Materials.ts (W1-D). */
export interface MaterialsApi {
    lambert(hex: HexColor, opts?: LambertOptions): THREE.MeshLambertMaterial;
    basic(hex: HexColor, opts?: BasicOptions): THREE.MeshBasicMaterial;
}

export type ModelName = "car" | "palm" | "avatar" | `nature/${string}`;

/**
 * Distance-gated lazy board-image loader (§5.1; Assets.ts BoardTextures).
 * Areas register each board's world position; the Experience enables loading
 * on Start and feeds it the camera focus every frame. Failures resolve null
 * (the board keeps its placeholder colour).
 */
export interface BoardLoaderApi {
    /** "clay" → /assets/boards/clay.webp; anything containing "/" is a URL. */
    register(nameOrUrl: string, x: number, z: number): void;
    /** Starts loading now (idempotent); `onLoaded` runs once it is ready. */
    request(nameOrUrl: string, onLoaded?: (texture: THREE.Texture) => void): Promise<THREE.Texture | null>;
    /** The texture if already loaded, else null. */
    get(nameOrUrl: string): THREE.Texture | null;
    /** Fires for every board that finishes loading from now on. Returns unsubscribe. */
    onLoaded(cb: (url: string, texture: THREE.Texture) => void): () => void;
}

/** Asset service (W1-D). Models come back as fresh clones with Lambert materials. */
export interface AssetsApi {
    /** null for optional models that failed / are absent (avatar, Nature Kit). */
    model(name: ModelName): THREE.Object3D | null;
    /** sRGB, mipmapped, anisotropy min(8, max). Rejects on failure. */
    texture(url: string): Promise<THREE.Texture>;
    /** Lazy board images (Wave 1 integration, DECISIONS.md). */
    readonly boards: BoardLoaderApi;
}

// ── Text ─────────────────────────────────────────────────────────────────
export type FontId = "display" | "bold" | "semibold" | "medium";

export interface TextOpts {
    text: string;
    font: FontId;
    size: number;
    color: HexColor;
    maxWidth?: number;
    letterSpacing?: number;
    anchorX?: "left" | "center" | "right" | number;
    anchorY?: "top" | "top-baseline" | "top-cap" | "middle" | "bottom-baseline" | "bottom" | number;
    lineHeight?: number;
    /** Hidden on touch devices and portrait screens (aspect < 1). */
    desktopOnly?: boolean;
    /** Flat layer (flat / onPath text); defaults to "groundText". */
    layer?: FlatLayerId;
}

/**
 * A text instance. `object` is what you position:
 * - flat(): lies in the ground plane at its layer height, reading along local +X
 *   (set object.rotation.y = FACE_CAMERA_Y to read horizontally on screen);
 * - upright(): stands in the local XY plane facing +Z;
 * - onPath(): flat, already rotated to `angle` about Y.
 */
export interface TextHandle {
    readonly object: THREE.Object3D;
    readonly mesh: TroikaText;
    setText(text: string): void;
    setColor(hex: HexColor): void;
    dispose(): void;
}

export interface TextApi {
    flat(o: TextOpts): TextHandle;
    upright(o: TextOpts): TextHandle;
    onPath(o: TextOpts & { angle: number }): TextHandle;
}

export interface Word3DOptions {
    cap: number;
    depth: number;
    color: HexColor;
    dynamic: boolean;
    mass?: number;
    curveSegments: number;
}

export interface Letter3D {
    mesh: THREE.Mesh;
    /** Present for dynamic letters (linked to physics). */
    body?: RAPIER.RigidBody;
    /** Layout pose (baseline position) used by reset(). */
    home: { position: THREE.Vector3; quaternion: THREE.Quaternion };
}

export interface Word3D {
    group: THREE.Group;
    letters: Letter3D[];
    /** Returns letters to their layout poses and snaps their bodies. */
    reset(): void;
}

export interface Text3DApi {
    word(text: string, opts: Word3DOptions): Word3D;
}

// ── Area modules ─────────────────────────────────────────────────────────
export type ShapesApi = typeof import("./utils/shapes");
export type LayoutApi = typeof import("./Layout");

export interface AreaContext {
    /** The area's root group (already added to the scene). */
    group: THREE.Group;
    physics: PhysicsApi;
    materials: MaterialsApi;
    shapes: ShapesApi;
    text: TextApi;
    text3d: Text3DApi;
    assets: AssetsApi;
    audio: AudioApi;
    commands: WorldCommands;
    disposal: Disposal;
    def: AreaDef;
    layout: LayoutApi;
    /** Registers an interactable; returns an unregister function. */
    addInteractable(i: WorldInteractable): () => void;
}

export interface AreaHandle {
    group: THREE.Group;
    update?(dt: number, t: number, rt: RuntimeInfo): void;
    reset?(): void;
    dispose?(): void;
}

export type AreaBuilder = (ctx: AreaContext) => AreaHandle;

// ── Camera / render ──────────────────────────────────────────────────────
/** Shared camera state (§4.1), read by Environment for shadow refit + fog. */
export interface CameraState {
    fov: number;
    aspect: number;
    /** Radians. */
    elevation: number;
    base: number;
    zoom: number;
    /** Current camera distance (base·zoom + pullback). */
    d: number;
    focus: THREE.Vector3;
    shot: CameraShot;
}

/** Resolved render profile (§9.1), decided once at boot. */
export interface RenderProfile {
    id: RenderProfileId;
    /** Effective DPR cap; DPR = min(devicePixelRatio, dprCap) ≥ min(devicePixelRatio, 2). */
    dprCap: number;
    antialias: boolean;
    /** 0 = no shadow map (blob shadows). */
    shadowMapSize: number;
    scenery: SceneryTier;
    isMobile: boolean;
    gpuTier: number;
}
