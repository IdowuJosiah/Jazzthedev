import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, LOOK, PALETTE, type LookId, type Vec3Like } from "./Config";
import { BOUNDS, JETTY, QUAY_Z, rectBounds } from "./Layout";
import type { CameraShot, CameraState, MaterialsApi, PhysicsApi, RenderProfile } from "./types";
import { Disposal } from "./utils/disposal";
import { clamp, smoothstep } from "./utils/math";
import { applyLayerToMaterial, applyLayerToObject, LAYERS } from "./utils/shapes";
import { patchWaterMaterial, type WaterPatch } from "./shaders/water";

// ─────────────────────────────────────────────────────────────────────────
// Environment (§1.4–§1.6, §2.2): the flat ground + its physics slab, invisible
// bound walls, the quay (strip, bollards, sea-wall colliders with the jetty
// gap), the lagoon water, the Credits jetty, the 3-light rig from
// LOOK[CONFIG.look], the sun's shadow box (refit + texel-snapped recentre),
// distance-scaled linear fog, scene.background, and the instanced blob
// shadows that stand in for the shadow map on the low profiles.
//
//   const env = new Environment({ scene, physics, materials, profile, renderer });
//   env.update(dt, t, cameraState);   // every frame, after the camera
//   env.addPropBlobs([...]);          // static props (only drawn without a shadow map)
//   env.dispose();
// ─────────────────────────────────────────────────────────────────────────

const WORLD = CONFIG.world;
const SH = CONFIG.shadow;
const BOX = SH.box;

// ── Stream-local constants (Config has no slot for these; see report) ────
/** Half thickness of the invisible bound walls; their inner face sits on the bound. */
const WALL_HALF_THICKNESS = 1;
/** Jetty posts: square section, from below the waterline up to the rail height. */
const JETTY_POST = { size: 0.3, bottomY: -2 } as const;
/** Half height of the jetty deck collider (thick so the car can't tunnel; top stays at y 0). */
const JETTY_DECK_COLLIDER_HALF_HEIGHT = 0.5;
/** Half thickness of the jetty side-rail and end-bumper colliders. */
const JETTY_RAIL_HALF_THICKNESS = 0.15;
/** Radial segments of the bollard cylinders. */
const BOLLARD_SEGMENTS = 16;
/** Prop blobs are this much larger than the prop footprint they sit under. */
export const PROP_BLOB_SPREAD = 1.3;
/** Blob alpha-map corner fraction: 0.6 = rounded rect (car, props), 1 = round (ball, letters). */
export const BLOB_CORNER = { rect: 0.6, round: 1 } as const;
/** Refit epsilons (state is compared against the state of the last fit). */
const REFIT_EPS = { aspect: 1e-3, fovDeg: 1e-3, elevation: 1e-4, base: 1e-3 } as const;
/** Initial capacity of the prop-blob InstancedMesh (doubles when exceeded). */
const PROP_BLOB_INITIAL_CAPACITY = 64;

// ── Pure helpers (exported for tests / Debug) ────────────────────────────
/** Linear fog distances for camera distance d (§1.6): 45..115 at d = 38. */
export function fogRange(d: number): { near: number; far: number } {
    return { near: CONFIG.fog.nearFactor * d, far: CONFIG.fog.farFactor * d };
}

/**
 * Rotation whose columns are the sun shadow camera's x / y / z axes in world
 * space — exactly what DirectionalLightShadow builds via camera.lookAt(target)
 * with up = +Y (z points from the target toward the light).
 */
export function lightBasis(sunDir: Vec3Like): THREE.Matrix4 {
    return new THREE.Matrix4().lookAt(
        new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 1, 0)
    );
}

/** The sun shadow camera's x / y / z axes in world space (the columns of lightBasis()). */
export interface LightAxes {
    readonly x: THREE.Vector3;
    readonly y: THREE.Vector3;
    readonly z: THREE.Vector3;
}

/** Extracts the light axes once, so per-frame callers don't re-extract them from the basis. */
export function lightAxes(basis: THREE.Matrix4): LightAxes {
    const axes = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
    basis.extractBasis(axes.x, axes.y, axes.z);
    return axes;
}

/** The camera state fields the shadow fit depends on. `fov` is vertical, in degrees. */
export interface ShadowFitInput {
    fov: number;
    aspect: number;
    /** Radians. */
    elevation: number;
    base: number;
    zoom: number;
}

export interface ShadowFit {
    /** Half extents of the orthographic box along the light's x / y axes (multiples of roundTo). */
    halfX: number;
    halfY: number;
    /** Box centre relative to the camera focus, world space (`focus + offset` each frame). */
    offset: THREE.Vector3;
}

/** Camera offset from its focus (§4.1): d·(cos el·sin yaw, sin el, cos el·cos yaw). */
export function cameraOffset(d: number, elevation: number, yaw: number = CONFIG.camera.yaw): THREE.Vector3 {
    const c = Math.cos(elevation);
    return new THREE.Vector3(d * c * Math.sin(yaw), d * Math.sin(elevation), d * c * Math.cos(yaw));
}

/**
 * Unit directions of the four frustum-corner rays. The camera yaw and pitch are
 * fixed per state, so these don't depend on the distance.
 */
export function frustumCornerDirs(cam: Pick<ShadowFitInput, "fov" | "aspect" | "elevation">): THREE.Vector3[] {
    const eye = cameraOffset(1, cam.elevation);
    const m = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const cx = new THREE.Vector3();
    const cy = new THREE.Vector3();
    const cz = new THREE.Vector3();
    m.extractBasis(cx, cy, cz);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const tanH = tanV * cam.aspect;
    return (
        [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ] as const
    ).map(([sx, sy]) =>
        cz
            .clone()
            .negate()
            .addScaledVector(cx, sx * tanH)
            .addScaledVector(cy, sy * tanV)
            .normalize()
    );
}

/**
 * The four frustum-corner rays of a camera at distance `rayDist` from a focus at
 * the origin, cut where they meet y = 0 and clamped at `rayClamp` units.
 */
export function frustumGroundCorners(
    cam: Pick<ShadowFitInput, "fov" | "aspect" | "elevation">,
    rayDist: number,
    rayClamp: number = BOX.rayClamp
): THREE.Vector3[] {
    const eye = cameraOffset(rayDist, cam.elevation);
    return frustumCornerDirs(cam).map((dir) => {
        const tHit = dir.y < 0 ? -eye.y / dir.y : Infinity;
        return eye.clone().addScaledVector(dir, Math.min(tHit, rayClamp));
    });
}

const roundUp = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step;

/**
 * Camera distances one fit must cover: the whole no-refit window. The eased
 * zoom may sit anywhere within ±refitZoomDelta of the fitted zoom (clamped to
 * the zoom range) with any speed pull-back, so d ∈ [base·zoomLo, base·zoomHi +
 * full pull-back]. Each corner's end point is piecewise linear in d: it scales
 * with d about the focus while the ray reaches the ground, and moves the other
 * way once the ray is clamped at 140 (zooming IN pushes a clamped end point
 * further out). So the extremes are the two window ends plus, per corner, the
 * distance where its ray hits y = 0 exactly at the clamp.
 */
export function shadowFitDistances(cam: ShadowFitInput): number[] {
    const Z = CONFIG.camera.zoom;
    // Window clamped to the zoom range, but always containing the current zoom.
    const zLo = Math.min(cam.zoom, Math.max(cam.zoom - BOX.refitZoomDelta, Z.min));
    const zHi = Math.max(cam.zoom, Math.min(cam.zoom + BOX.refitZoomDelta, Z.max));
    const lo = cam.base * zLo;
    const hi = cam.base * zHi + (BOX.pullback * cam.base) / BOX.refBase;
    const out = [lo, hi];
    const sinEl = Math.sin(cam.elevation);
    if (sinEl > 0) {
        for (const dir of frustumCornerDirs(cam)) {
            if (dir.y >= 0) continue;
            const dClamp = (BOX.rayClamp * -dir.y) / sinEl;
            if (dClamp > lo && dClamp < hi) out.push(dClamp);
        }
    }
    return out;
}

/**
 * Fits the sun's orthographic shadow box to the view (§1.5): frustum-corner
 * rays hit y = 0 (clamped at 140), plus the same points raised 8 for tall
 * casters; their light-space AABB padded by 4 with the half extents rounded up
 * to a multiple of 4. The rays are cast at every distance from
 * shadowFitDistances() (the spec's base·zoom + full pull-back, widened to the
 * no-refit window) so the box covers every view until the next refit. The
 * centre is stored relative to the focus so it follows the car without
 * changing size. `axes` (lightAxes(lightBasis(sunDir))) may be passed in by
 * callers that already hold them.
 */
export function fitShadowBox(
    cam: ShadowFitInput,
    sunDir: Vec3Like = CONFIG.lights.sunDirection,
    axes: LightAxes = lightAxes(lightBasis(sunDir))
): ShadowFit {
    const ground = shadowFitDistances(cam).flatMap((d) => frustumGroundCorners(cam, d));
    const pts = [...ground, ...ground.map((p) => p.clone().setY(p.y + BOX.casterHeight))];
    const { x: ax, y: ay, z: az } = axes;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const l = new THREE.Vector3();
    for (const p of pts) {
        l.set(p.dot(ax), p.dot(ay), p.dot(az));
        min.min(l);
        max.max(l);
    }
    const halfX = roundUp((max.x - min.x) / 2 + BOX.pad, BOX.roundTo);
    const halfY = roundUp((max.y - min.y) / 2 + BOX.pad, BOX.roundTo);
    const c = min.clone().add(max).multiplyScalar(0.5);
    const offset = new THREE.Vector3()
        .addScaledVector(ax, c.x)
        .addScaledVector(ay, c.y)
        .addScaledVector(az, c.z);
    return { halfX, halfY, offset };
}

/** The camera state a fit was made for (zoom / aspect / FOV / shot + the shot's tweened params). */
export interface ShadowFitKey extends ShadowFitInput {
    shot: CameraShot;
}

/**
 * Refit only when zoom moved more than 0.1, or the aspect, FOV or shot changed
 * (§1.5). A shot change tweens elevation and base over ~1.2 s, so those count
 * as "shot changes" too: the box refits during the tween and is stable after.
 */
export function needsShadowRefit(last: ShadowFitKey | null, cur: ShadowFitKey): boolean {
    if (!last) return true;
    return (
        Math.abs(cur.zoom - last.zoom) > BOX.refitZoomDelta ||
        Math.abs(cur.aspect - last.aspect) > REFIT_EPS.aspect ||
        Math.abs(cur.fov - last.fov) > REFIT_EPS.fovDeg ||
        cur.shot !== last.shot ||
        Math.abs(cur.elevation - last.elevation) > REFIT_EPS.elevation ||
        Math.abs(cur.base - last.base) > REFIT_EPS.base
    );
}

/**
 * Snaps a world point to the shadow map's texel grid in light space (x / y only),
 * so shadow edges never crawl while the box follows the focus. `basis` is
 * lightBasis() or, allocation-free for the per-frame path, its lightAxes();
 * `texelX` / `texelY` are the world sizes of one shadow texel. `out` may alias `p`.
 */
export function snapToTexelGrid(
    p: THREE.Vector3,
    basis: THREE.Matrix4 | LightAxes,
    texelX: number,
    texelY: number,
    out: THREE.Vector3 = new THREE.Vector3()
): THREE.Vector3 {
    const { x: ax, y: ay, z: az } = basis instanceof THREE.Matrix4 ? lightAxes(basis) : basis;
    const lx = Math.round(p.dot(ax) / texelX) * texelX;
    const ly = Math.round(p.dot(ay) / texelY) * texelY;
    const lz = p.dot(az);
    return out.set(0, 0, 0).addScaledVector(ax, lx).addScaledVector(ay, ly).addScaledVector(az, lz);
}

/**
 * Blob-shadow alpha at (u, v) ∈ [−1, 1]²: a rounded-rect radial gradient with a
 * smoothstep falloff (§1.5). `corner` ∈ (0, 1] is the corner radius as a
 * fraction of the half size (1 = a pure radial blob). 1 inside the flat core,
 * 0 at and beyond the edge.
 */
export function blobAlpha(u: number, v: number, corner: number): number {
    const c = clamp(corner, 1e-3, 1);
    const qx = Math.max(Math.abs(u) - (1 - c), 0);
    const qy = Math.max(Math.abs(v) - (1 - c), 0);
    return 1 - smoothstep(0, 1, Math.hypot(qx, qy) / c);
}

/**
 * The blob alpha map (CONFIG.shadow.blob.textureSize², e.g. 128²). Built as a
 * DataTexture from the same per-pixel gradient a canvas would hold, so it needs
 * no DOM. alphaMap reads the green channel; the data is linear (NoColorSpace).
 */
export function createBlobTexture(corner: number, size: number = SH.blob.textureSize): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const a = Math.round(255 * blobAlpha(((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1, corner));
            const k = (j * size + i) * 4;
            data[k] = a;
            data[k + 1] = a;
            data[k + 2] = a;
            data[k + 3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

export type BlobKind = keyof typeof BLOB_CORNER;

/** A prop footprint for the low-profile blob (centre, size along local X / Z, yaw). */
export interface BlobSpot {
    x: number;
    z: number;
    w: number;
    d: number;
    /** rotation.y of the prop (faceCamera props: FACE_CAMERA_Y). Default 0. */
    rot?: number;
}

/** A batch of prop blobs; `setCount(n)` keeps only the first n (scenery prefix cuts, §9.3). */
export interface PropBlobRange {
    readonly start: number;
    readonly size: number;
    setCount(n: number): void;
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** One InstancedMesh of blobs under every registered static prop (§1.5, low profiles). */
class PropBlobs {
    readonly group = new THREE.Group();
    private mesh: THREE.InstancedMesh | null = null;
    private matrices: THREE.Matrix4[] = [];
    private shown: boolean[] = [];
    private dirty = false;

    constructor(
        private geometry: THREE.BufferGeometry,
        private material: THREE.Material
    ) {
        this.group.name = "prop-blobs";
    }

    get count(): number {
        return this.matrices.length;
    }

    add(spots: readonly BlobSpot[]): PropBlobRange {
        const start = this.matrices.length;
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        for (const s of spots) {
            q.setFromAxisAngle(up, s.rot ?? 0);
            this.matrices.push(
                new THREE.Matrix4().compose(
                    new THREE.Vector3(s.x, 0, s.z),
                    q,
                    new THREE.Vector3(s.w * PROP_BLOB_SPREAD, 1, s.d * PROP_BLOB_SPREAD)
                )
            );
            this.shown.push(true);
        }
        this.dirty = true;
        this.flush();
        const size = spots.length;
        return {
            start,
            size,
            setCount: (n: number) => {
                const keep = Math.max(0, Math.min(size, Math.round(n)));
                for (let i = 0; i < size; i++) this.shown[start + i] = i < keep;
                this.dirty = true;
                this.flush();
            },
        };
    }

    /** Writes matrices into the InstancedMesh, growing it (×2) when full. */
    private flush() {
        if (!this.dirty) return;
        this.dirty = false;
        const n = this.matrices.length;
        if (!this.mesh || this.mesh.instanceMatrix.count < n) {
            let cap = this.mesh ? this.mesh.instanceMatrix.count : PROP_BLOB_INITIAL_CAPACITY;
            while (cap < n) cap *= 2;
            if (this.mesh) {
                this.group.remove(this.mesh);
                this.mesh.dispose();
            }
            const mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
            mesh.name = "prop-blobs";
            applyLayerToObject(mesh, "blob");
            this.mesh = mesh;
            this.group.add(mesh);
        }
        const mesh = this.mesh;
        for (let i = 0; i < n; i++) mesh.setMatrixAt(i, this.shown[i] ? this.matrices[i] : ZERO_MATRIX);
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        // Instance-aware bounds so the batch still frustum-culls as a whole.
        mesh.computeBoundingSphere();
    }

    dispose() {
        this.mesh?.dispose();
        this.mesh = null;
    }
}

// ── Environment ──────────────────────────────────────────────────────────
export interface EnvironmentDeps {
    scene: THREE.Scene;
    physics: PhysicsApi;
    materials: MaterialsApi;
    profile: RenderProfile;
    /**
     * Optional. Lets setShadowMapSize() switch the renderer's shadow map on when a
     * profile that booted without one (low) is raised by the Quality setting.
     */
    renderer?: THREE.WebGLRenderer;
}

export class Environment {
    /** Everything this module draws (lights included). */
    readonly group = new THREE.Group();
    readonly hemi: THREE.HemisphereLight;
    readonly sun: THREE.DirectionalLight;
    readonly fill: THREE.DirectionalLight;
    readonly fog: THREE.Fog;

    private own = new Disposal();
    private bodies: RAPIER.RigidBody[] = [];
    private water: WaterPatch;
    private propBlobs: PropBlobs;
    private blobTextures = new Map<BlobKind, THREE.DataTexture>();
    private blobMaterials = new Map<string, THREE.MeshBasicMaterial>();
    private blobGeometry: THREE.BufferGeometry;

    /** Light axes, extracted once: the per-frame recentre and refits allocate none. */
    private axes = lightAxes(lightBasis(CONFIG.lights.sunDirection));
    /** The Color this module put in scene.background (dispose clears it only while it's still ours). */
    private background: THREE.Color;
    private sunDir = new THREE.Vector3(
        CONFIG.lights.sunDirection.x,
        CONFIG.lights.sunDirection.y,
        CONFIG.lights.sunDirection.z
    );
    private fitKey: ShadowFitKey | null = null;
    private fit: ShadowFit | null = null;
    private shadowMapSize: number;
    private tmpCentre = new THREE.Vector3();
    private disposed = false;

    constructor(private deps: EnvironmentDeps) {
        const { scene, profile } = deps;
        const look = LOOK[CONFIG.look];
        this.group.name = "environment";

        // Background + linear fog (§1.6); distances are set every frame from d.
        this.background = new THREE.Color(look.background);
        scene.background = this.background;
        const init = fogRange(CONFIG.camera.shots.default.base);
        this.fog = new THREE.Fog(look.background, init.near, init.far);
        scene.fog = this.fog;

        // Lights (§1.4).
        this.hemi = new THREE.HemisphereLight(look.hemisphere.sky, look.hemisphere.ground, look.hemisphere.intensity);
        this.hemi.name = "hemisphere";
        this.sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity);
        this.sun.name = "sun";
        this.fill = new THREE.DirectionalLight(look.fill.color, look.fill.intensity);
        this.fill.name = "fill";
        this.fill.castShadow = false;
        const F = CONFIG.lights.fillDirection;
        this.fill.position.set(F.x, F.y, F.z);
        this.sun.position.copy(this.sunDir).multiplyScalar(SH.lightDistance);
        this.group.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);

        // Shadow settings (§1.5): PCF, the map size comes from the profile.
        const s = this.sun.shadow;
        s.radius = SH.radius;
        s.bias = SH.bias;
        s.normalBias = SH.normalBias;
        s.intensity = SH.intensity;
        s.camera.near = SH.near;
        s.camera.far = SH.far;
        this.shadowMapSize = profile.shadowMapSize;
        this.sun.castShadow = profile.shadowMapSize > 0;
        if (profile.shadowMapSize > 0) s.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
        if (deps.renderer && profile.shadowMapSize > 0) {
            deps.renderer.shadowMap.enabled = true;
            deps.renderer.shadowMap.type = THREE.PCFShadowMap;
        }

        // Blobs: one flat unit plane at the blob layer, shared by every instance.
        const blobGeo = new THREE.PlaneGeometry(1, 1);
        blobGeo.rotateX(-Math.PI / 2);
        blobGeo.translate(0, LAYERS.blob.y, 0);
        this.blobGeometry = this.own.track(blobGeo);
        this.propBlobs = new PropBlobs(this.blobGeometry, this.blobMaterial("rect", SH.blob.staticProps.opacity));
        this.group.add(this.propBlobs.group);
        this.syncBlobVisibility();

        this.buildGround();
        this.buildBoundWalls();
        this.buildQuay();
        this.water = this.buildWater();
        this.buildJetty();

        scene.add(this.group);
    }

    // ── Public API ───────────────────────────────────────────────────────
    /** Per frame, after the camera: water time, fog distances, shadow box. */
    update(_dt: number, t: number, cam: CameraState): void {
        if (this.disposed) return;
        this.water.setTime(t);
        // Same as fogRange(cam.d), written in place (no per-frame object).
        this.fog.near = CONFIG.fog.nearFactor * cam.d;
        this.fog.far = CONFIG.fog.farFactor * cam.d;
        if (this.sun.castShadow) this.updateShadowBox(cam);
    }

    /**
     * Registers static props for the low-profile blob shadows (§1.5). Always
     * recorded; drawn only while there is no shadow map. `w` / `d` are the
     * prop's footprint (the blob is PROP_BLOB_SPREAD larger).
     */
    addPropBlobs(spots: readonly BlobSpot[]): PropBlobRange {
        return this.propBlobs.add(spots);
    }

    /** True when static props show blobs instead of real shadows. */
    get usesPropBlobs(): boolean {
        return this.shadowMapSize <= 0;
    }

    /**
     * Shared blob material (cached per kind + opacity): blobShadow colour, the
     * blob alpha map, transparent, depthWrite off, polygonOffset −1/−4 (blob
     * layer). Pair meshes with renderOrder 1 (applyLayerToObject(mesh, "blob"))
     * and y = LAYERS.blob.y. Owned (and disposed) by the Environment.
     *
     * Fixed opacities only: every caller asking for the same kind + opacity gets
     * the same instance, so never mutate the result, and don't call this with a
     * per-frame value (each new value would allocate and keep another material).
     * A blob whose opacity changes per frame (the car's lift fade) builds its own
     * MeshBasicMaterial around blobTexture(kind) (or clones this one) and owns it.
     */
    blobMaterial(kind: BlobKind, opacity: number): THREE.MeshBasicMaterial {
        const key = `${kind}:${opacity}`;
        let mat = this.blobMaterials.get(key);
        if (!mat) {
            mat = new THREE.MeshBasicMaterial({
                color: SH.blob.color,
                alphaMap: this.blobTexture(kind),
                transparent: true,
                opacity,
                fog: true,
            });
            applyLayerToMaterial(mat, "blob");
            this.blobMaterials.set(key, this.own.track(mat));
        }
        return mat;
    }

    /**
     * The shared blob alpha map of a kind (rounded rect or round). §1.5 wants the
     * car and the low-profile prop blobs on the same texture: the car's blob
     * should use blobTexture("rect") rather than building its own map.
     */
    blobTexture(kind: BlobKind): THREE.DataTexture {
        let tex = this.blobTextures.get(kind);
        if (!tex) {
            tex = this.own.track(createBlobTexture(BLOB_CORNER[kind]));
            this.blobTextures.set(kind, tex);
        }
        return tex;
    }

    /**
     * Adaptive quality / Quality setting (§9.3): 2048 → 1024, or 0 for no
     * shadow map (props fall back to blobs). Never touches DPR or MSAA.
     */
    setShadowMapSize(size: number): void {
        const s = Math.max(0, Math.round(size));
        if (s === this.shadowMapSize) return;
        this.shadowMapSize = s;
        const shadow = this.sun.shadow;
        if (s > 0) {
            shadow.mapSize.set(s, s);
            // The map is reallocated at the new size on the next render.
            shadow.map?.dispose();
            shadow.map = null;
            if (this.deps.renderer) {
                this.deps.renderer.shadowMap.enabled = true;
                this.deps.renderer.shadowMap.type = THREE.PCFShadowMap;
            }
            // Texel size changed: the next update refits.
            this.fitKey = null;
        }
        this.sun.castShadow = s > 0;
        this.syncBlobVisibility();
    }

    /** Switches the look preset at runtime (?debug); the Config value stays the default. */
    applyLook(id: LookId): void {
        const look = LOOK[id];
        this.background.set(look.background);
        this.deps.scene.background = this.background;
        this.fog.color.copy(this.background);
        this.hemi.color.set(look.hemisphere.sky);
        this.hemi.groundColor.set(look.hemisphere.ground);
        this.hemi.intensity = look.hemisphere.intensity;
        this.sun.color.set(look.sun.color);
        this.sun.intensity = look.sun.intensity;
        this.fill.color.set(look.fill.color);
        this.fill.intensity = look.fill.intensity;
    }

    /** Current shadow box (for ?debug): half extents and the focus-relative centre. */
    get shadowBox(): Readonly<ShadowFit> | null {
        return this.fit;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        const { scene, physics } = this.deps;
        scene.remove(this.group);
        if (scene.fog === this.fog) scene.fog = null;
        if (scene.background === this.background) scene.background = null;
        for (const b of this.bodies) {
            try {
                physics.world.removeRigidBody(b);
            } catch {
                /* the world may already be freed */
            }
        }
        this.bodies = [];
        this.propBlobs.dispose();
        // DirectionalLight.dispose() also frees its shadow map.
        this.sun.dispose();
        this.fill.dispose();
        this.hemi.dispose();
        this.own.dispose();
    }

    // ── Shadow box (§1.5) ────────────────────────────────────────────────
    private updateShadowBox(cam: CameraState) {
        const key: ShadowFitKey = {
            fov: cam.fov,
            aspect: cam.aspect,
            elevation: cam.elevation,
            base: cam.base,
            zoom: cam.zoom,
            shot: cam.shot,
        };
        if (!this.fit || needsShadowRefit(this.fitKey, key)) {
            this.fit = fitShadowBox(key, CONFIG.lights.sunDirection, this.axes);
            this.fitKey = key;
            const c = this.sun.shadow.camera;
            c.left = -this.fit.halfX;
            c.right = this.fit.halfX;
            c.bottom = -this.fit.halfY;
            c.top = this.fit.halfY;
            c.near = SH.near;
            c.far = SH.far;
            c.updateProjectionMatrix();
        }
        const fit = this.fit;
        const size = this.sun.shadow.mapSize;
        const centre = this.tmpCentre.copy(cam.focus).add(fit.offset);
        snapToTexelGrid(centre, this.axes,(2 * fit.halfX) / size.x, (2 * fit.halfY) / size.y, centre);
        this.sun.target.position.copy(centre);
        this.sun.position.copy(centre).addScaledVector(this.sunDir, SH.lightDistance);
    }

    private syncBlobVisibility() {
        this.propBlobs.group.visible = this.usesPropBlobs;
    }

    // ── Builders ─────────────────────────────────────────────────────────
    private addBody(b: RAPIER.RigidBody) {
        this.bodies.push(b);
    }

    /** Flat ground plane (lambert ground, receives only) + the fixed slab (§2.2). */
    private buildGround() {
        const G = WORLD.ground;
        const geo = this.own.track(new THREE.PlaneGeometry(G.maxX - G.minX, G.maxZ - G.minZ));
        geo.rotateX(-Math.PI / 2);
        const ground = new THREE.Mesh(geo, this.deps.materials.lambert(PALETTE.ground));
        ground.name = "ground";
        ground.position.set((G.minX + G.maxX) / 2, 0, (G.minZ + G.maxZ) / 2);
        ground.receiveShadow = true;
        ground.castShadow = false;
        this.group.add(ground);
        this.addBody(this.deps.physics.addGroundSlab());
    }

    /** Invisible 4-high walls at x = minX, x = maxX and z = maxZ; inner faces on the bound. */
    private buildBoundWalls() {
        const h = WORLD.wallHeight / 2;
        const t = WALL_HALF_THICKNESS;
        const spanZ = (BOUNDS.maxZ - BOUNDS.minZ) / 2 + t;
        const midZ = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
        const spanX = (BOUNDS.maxX - BOUNDS.minX) / 2 + 2 * t;
        const midX = (BOUNDS.minX + BOUNDS.maxX) / 2;
        const { physics } = this.deps;
        this.addBody(physics.addWall({ x: t, y: h, z: spanZ }, { x: BOUNDS.minX - t, y: h, z: midZ }));
        this.addBody(physics.addWall({ x: t, y: h, z: spanZ }, { x: BOUNDS.maxX + t, y: h, z: midZ }));
        this.addBody(physics.addWall({ x: spanX, y: h, z: t }, { x: midX, y: h, z: BOUNDS.maxZ + t }));
    }

    /** Quay strip, instanced bollards (skipping the jetty mouth) and sea-wall colliders. */
    private buildQuay() {
        const Q = WORLD.quay;
        const { materials, physics } = this.deps;
        const stripZ = QUAY_Z - Q.strip.depth / 2;

        // Strip: Box(1400, 1.2, 1.0), top at y = 0, z −176..−177.
        const stripGeo = this.own.track(new THREE.BoxGeometry(Q.strip.length, Q.strip.height, Q.strip.depth));
        const strip = new THREE.Mesh(stripGeo, materials.lambert(PALETTE.quay));
        strip.name = "quay-strip";
        strip.position.set(0, -Q.strip.height / 2, stripZ);
        strip.receiveShadow = true;
        strip.castShadow = false;
        this.group.add(strip);

        // Bollards every 8 along the quay, skipping x ∈ [−6, 6].
        const B = Q.bollard;
        const halfLen = Q.strip.length / 2;
        const xs: number[] = [];
        const kMax = Math.floor((halfLen - B.radius) / B.spacing);
        for (let k = -kMax; k <= kMax; k++) {
            const x = k * B.spacing;
            if (Math.abs(x) <= B.skipHalfWidth) continue;
            xs.push(x);
        }
        const bollardGeo = this.own.track(new THREE.CylinderGeometry(B.radius, B.radius, B.height, BOLLARD_SEGMENTS));
        const bollards = new THREE.InstancedMesh(bollardGeo, materials.lambert(PALETTE.paper), xs.length);
        bollards.name = "bollards";
        const m = new THREE.Matrix4();
        xs.forEach((x, i) => bollards.setMatrixAt(i, m.makeTranslation(x, B.height / 2, stripZ)));
        bollards.instanceMatrix.needsUpdate = true;
        bollards.computeBoundingSphere();
        bollards.castShadow = true;
        bollards.receiveShadow = true;
        this.own.onDispose(() => bollards.dispose());
        this.group.add(bollards);

        // Sea-wall colliders, 1.0 high, on the strip, leaving the jetty gap x ∈ [−4, 4].
        const wh = Q.seaWallHeight / 2;
        const gap = Q.jettyGapHalfWidth;
        const west = BOUNDS.minX - 2 * WALL_HALF_THICKNESS;
        const east = BOUNDS.maxX + 2 * WALL_HALF_THICKNESS;
        const half = { y: wh, z: Q.strip.depth / 2 };
        this.addBody(
            physics.addWall({ x: (-gap - west) / 2, ...half }, { x: (west - gap) / 2, y: wh, z: stripZ })
        );
        this.addBody(physics.addWall({ x: (east - gap) / 2, ...half }, { x: (east + gap) / 2, y: wh, z: stripZ }));
    }

    /** The lagoon: one unlit plane at y −1.1 with the gradient + foam patch (§2.2). */
    private buildWater(): WaterPatch {
        const W = WORLD.water;
        const geo = this.own.track(new THREE.PlaneGeometry(W.maxX - W.minX, QUAY_Z - W.minZ));
        geo.rotateX(-Math.PI / 2);
        const mat = this.own.track(new THREE.MeshBasicMaterial({ fog: true }));
        // The strip covers z −176..−177 down to y −1.2, so the visible waterline
        // is the strip's water face: d is measured from there, which keeps the
        // 0.7 solid foam band visible (measured from −176 it would sit under the strip).
        const patch = patchWaterMaterial(mat, QUAY_Z - WORLD.quay.strip.depth);
        const water = new THREE.Mesh(geo, mat);
        water.name = "water";
        water.position.set((W.minX + W.maxX) / 2, W.y, (QUAY_Z + W.minZ) / 2);
        water.castShadow = false;
        water.receiveShadow = false;
        this.group.add(water);
        return patch;
    }

    /** Credits jetty: instanced planks, posts, and deck / rail / bumper colliders (§2.2). */
    private buildJetty() {
        const J = WORLD.jetty;
        const { materials, physics } = this.deps;
        const b = rectBounds(JETTY.rect);
        const width = b.maxX - b.minX;
        const length = b.maxZ - b.minZ;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const top = JETTY.deckTopY;
        const m = new THREE.Matrix4();

        // Planks across the deck (7.6 along x), 0.9 deep with a 0.15 gap, centred
        // along z over the part of the deck past the quay strip's water face
        // (z −177..−200): the strip's top is also at y 0, so a plank over it
        // would z-fight at the jetty mouth (the Credits arrival point).
        const P = J.plank;
        const pitch = P.depth + P.gap;
        const plankMaxZ = Math.min(b.maxZ, QUAY_Z - WORLD.quay.strip.depth);
        const plankLength = plankMaxZ - b.minZ;
        const nPlanks = Math.max(1, Math.floor((plankLength + P.gap) / pitch));
        const run = nPlanks * pitch - P.gap;
        const plankGeo = this.own.track(new THREE.BoxGeometry(P.length, P.height, P.depth));
        const planks = new THREE.InstancedMesh(plankGeo, materials.lambert(PALETTE.wood), nPlanks);
        planks.name = "jetty-planks";
        for (let i = 0; i < nPlanks; i++) {
            const z = plankMaxZ - (plankLength - run) / 2 - P.depth / 2 - i * pitch;
            planks.setMatrixAt(i, m.makeTranslation(cx, top - P.height / 2, z));
        }
        planks.instanceMatrix.needsUpdate = true;
        planks.computeBoundingSphere();
        planks.receiveShadow = true;
        planks.castShadow = false;
        this.own.onDispose(() => planks.dispose());
        this.group.add(planks);

        // Posts every 4 along both sides, from below the water up to the rail height
        // (they mark the invisible rails and the end bumper).
        const ph = J.railHeight - JETTY_POST.bottomY;
        const postGeo = this.own.track(new THREE.BoxGeometry(JETTY_POST.size, ph, JETTY_POST.size));
        const half = JETTY_POST.size / 2;
        const zs: number[] = [];
        const nPosts = Math.floor(length / J.postSpacing + 1e-9);
        for (let k = 1; k <= nPosts; k++) zs.push(Math.max(b.minZ + half, b.maxZ - k * J.postSpacing));
        const sides = [b.minX + half, b.maxX - half];
        const posts = new THREE.InstancedMesh(postGeo, materials.lambert(PALETTE.stone), zs.length * sides.length);
        posts.name = "jetty-posts";
        let i = 0;
        for (const z of zs) {
            for (const x of sides) posts.setMatrixAt(i++, m.makeTranslation(x, JETTY_POST.bottomY + ph / 2, z));
        }
        posts.instanceMatrix.needsUpdate = true;
        posts.computeBoundingSphere();
        posts.castShadow = true;
        posts.receiveShadow = true;
        this.own.onDispose(() => posts.dispose());
        this.group.add(posts);

        // Colliders: deck (top at y 0), side rails 0.8 high, end bumper.
        const dh = JETTY_DECK_COLLIDER_HALF_HEIGHT;
        const rt = JETTY_RAIL_HALF_THICKNESS;
        const rh = J.railHeight / 2;
        this.addBody(physics.addFixedCuboid({ x: width / 2, y: dh, z: length / 2 }, { x: cx, y: top - dh, z: cz }));
        for (const x of [b.minX + rt, b.maxX - rt]) {
            this.addBody(physics.addFixedCuboid({ x: rt, y: rh, z: length / 2 }, { x, y: top + rh, z: cz }));
        }
        this.addBody(
            physics.addFixedCuboid({ x: width / 2, y: rh, z: rt }, { x: cx, y: top + rh, z: b.minZ + rt })
        );
    }
}
