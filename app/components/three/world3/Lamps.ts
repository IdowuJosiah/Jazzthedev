import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, PALETTE } from "./Config";
import type { BlobSpot } from "./Environment";
import { AREA_BY_ID } from "./Layout";
import { applyOccluder } from "./Materials";
import type { AreaId, MaterialsApi, PhysicsApi, XZ } from "./types";
import { Disposal } from "./utils/disposal";
import { clamp } from "./utils/math";

// ─────────────────────────────────────────────────────────────────────────
// Night lamps (owner: the world switches between day and night). A lamp post
// at the Hub and beside seven area arrivals (the Credits jetty is too narrow
// for one): ink foot, paper post, a warm UNLIT
// globe (MeshBasicMaterial, so it never glows or blooms: its colour simply
// lerps paper → CONFIG.dayNight.lamps.globeNight) and an ink shade over it.
// Each lamp pairs with a shadowless PointLight whose intensity follows the
// night factor; by day the lights are 0 and hidden, so the lit programs skip
// them (DayNight.prewarm compiles their night variant ahead of time).
//
// Four InstancedMeshes (foot, post, shade, globe) draw every lamp: 4 draw
// calls. The post parts use the scenery occluder dither, so a lamp between
// the camera and the car fades out like a tree. Static cylinder colliders go
// through the physics API; low profiles get a blob under each lamp.
//
//   const lamps = Lamps.build({ materials, physics, addPropBlobs: (s) => env.addPropBlobs(s) });
//   scene.add(lamps.group);
//   lamps.setNight(t);   // DayNight, when t changes
//   lamps.dispose();
// ─────────────────────────────────────────────────────────────────────────

const LP = CONFIG.dayNight.lamps;

/**
 * Where a lamp stands, as an offset (world X / Z) from its area's arrival
 * point. Each spot lies on its area's plaza, ≥ 4 from the arrival, clear of
 * pads, ground text (and its sun-side strip: lamps are tall), props, path
 * tiles (+1.5), the ramp corridor and the coin pickups, and never directly in
 * front of a ground text or a title on screen (Lamps.test.ts checks all of it).
 */
export const LAMP_OFFSETS: Readonly<Partial<Record<AreaId, XZ>>> = Object.freeze({
    /** South-west quadrant of the Crossroads, between the P1 entry and the P3 arm. */
    hub: { x: -6, z: -3 },
    /** East of the spawn lane, level with the hero word. */
    welcome: { x: 5, z: -3 },
    /** South of P2, at the gallery's mouth (north of it stands the PROJECTS title). */
    projects: { x: 2, z: 5 },
    /** East of P4's end, clear of the JOURNEY title (west). */
    journey: { x: 6, z: 3 },
    /** North of P6, at the Eko arrival. */
    eko: { x: 2, z: -5 },
    /** North of P5, at the Music arrival. */
    music: { x: -2, z: -5 },
    /** North of P7, at the About arrival. */
    about: { x: -2, z: -5 },
    /** South of the P3 end, clear of the ramp corridor and the lane. */
    playground: { x: 1, z: 5 },
});

export interface LampSpot {
    areaId: AreaId;
    x: number;
    z: number;
}

/** Every lamp position (≤ CONFIG.dayNight.lamps.maxLamps), Hub first. */
export const LAMP_SPOTS: readonly LampSpot[] = Object.freeze(
    (Object.keys(LAMP_OFFSETS) as AreaId[]).slice(0, LP.maxLamps).map((areaId) => {
        const a = AREA_BY_ID[areaId].arrival;
        const o = LAMP_OFFSETS[areaId]!;
        return { areaId, x: a.x + o.x, z: a.z + o.z };
    })
);

/** The shade's lower rim sits this far up the globe (fraction of its radius), so it hides the globe top. */
const SHADE_SEAT = 0.5;

/** Bottom of the shade (y). */
export const SHADE_BOTTOM_Y = LP.globe.y + LP.globe.radius * SHADE_SEAT;
/** The lamp's full height (top of the shade). */
export const LAMP_HEIGHT = SHADE_BOTTOM_Y + LP.cap.height;

/** PointLight intensity for a night factor (0 by day; clamped, non-finite → 0). */
export function lampIntensity(t: number): number {
    return LP.light.intensity * clamp(Number.isFinite(t) ? t : 0, 0, 1);
}

const GLOBE_DAY = new THREE.Color(PALETTE.paper);
const GLOBE_NIGHT = new THREE.Color(LP.globeNight);

/** Globe colour for a night factor (linear mix paper → globeNight), written into `out`. */
export function globeColor(t: number, out: THREE.Color = new THREE.Color()): THREE.Color {
    return out.lerpColors(GLOBE_DAY, GLOBE_NIGHT, clamp(Number.isFinite(t) ? t : 0, 0, 1));
}

export interface LampsDeps {
    materials: MaterialsApi;
    /** Static post colliders; omitted in tests / without physics. */
    physics?: Pick<PhysicsApi, "addFixedCylinder" | "removeBody">;
    /** Low-profile blobs (Environment.addPropBlobs); hidden again on dispose. */
    addPropBlobs?: (spots: readonly BlobSpot[]) => { setCount(n: number): void };
    /** false → globes only, no PointLights (e.g. the low profiles). Default true. */
    lights?: boolean;
    /** Positions (default LAMP_SPOTS). */
    spots?: readonly XZ[];
}

export interface LampsHandle {
    readonly group: THREE.Group;
    /** One per lamp (empty with `lights: false`). */
    readonly lights: readonly THREE.PointLight[];
    /** The last night factor applied. */
    readonly night: number;
    /** 0 = day (lights off + hidden, paper globes) … 1 = night (warm globes + pools). */
    setNight(t: number): void;
    dispose(): void;
}

/** One InstancedMesh with an instance per lamp, `y` = the part's centre height. */
function instanced(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    spots: readonly XZ[],
    y: number,
    name: string
): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    mesh.name = name;
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => mesh.setMatrixAt(i, m.makeTranslation(s.x, y, s.z)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
    return mesh;
}

/** Builds the lamps (day state). */
export function build(deps: LampsDeps): LampsHandle {
    const spots = (deps.spots ?? LAMP_SPOTS).slice(0, LP.maxLamps);
    const own = new Disposal();
    const group = new THREE.Group();
    group.name = "lamps";
    const bodies: RAPIER.RigidBody[] = [];
    const lights: THREE.PointLight[] = [];
    let blobs: { setCount(n: number): void } | null = null;
    let night = 0;
    let disposed = false;

    const { materials } = deps;
    const seg = LP.radialSegments;
    const ink = materials.lambert(PALETTE.ink, { occluder: true });
    const paper = materials.lambert(PALETTE.paper, { occluder: true });
    // Unlit and ours (its colour changes with t); fogged like every world material.
    const globeMat = own.track(applyOccluder(new THREE.MeshBasicMaterial({ color: PALETTE.paper, fog: true })));
    globeMat.name = "lamp-globe";

    const footGeo = own.track(new THREE.CylinderGeometry(LP.foot.radius, LP.foot.radius, LP.foot.height, seg));
    const postGeo = own.track(new THREE.CylinderGeometry(LP.post.radius, LP.post.radius, LP.post.height, seg));
    const shadeGeo = own.track(new THREE.CylinderGeometry(LP.cap.radiusTop, LP.cap.radiusBottom, LP.cap.height, seg));
    const globeGeo = own.track(
        new THREE.SphereGeometry(LP.globe.radius, LP.globeSegments.width, LP.globeSegments.height)
    );

    const parts = [
        instanced(footGeo, ink, spots, LP.foot.height / 2, "lamp-feet"),
        instanced(postGeo, paper, spots, LP.post.height / 2, "lamp-posts"),
        instanced(shadeGeo, ink, spots, SHADE_BOTTOM_Y + LP.cap.height / 2, "lamp-shades"),
        instanced(globeGeo, globeMat, spots, LP.globe.y, "lamp-globes"),
    ];
    for (const p of parts) {
        // The globe is the light: it casts nothing; the post parts cast like any prop (§1.5).
        p.castShadow = p.material !== globeMat;
        p.receiveShadow = p.material !== globeMat;
        own.onDispose(() => p.dispose());
        group.add(p);
    }

    if (deps.lights !== false) {
        const L = LP.light;
        for (const s of spots) {
            const light = new THREE.PointLight(L.color, 0, L.distance, L.decay);
            light.name = "lamp-light";
            light.castShadow = false;
            light.position.set(s.x, LP.globe.y, s.z);
            light.visible = false;
            own.onDispose(() => light.dispose());
            lights.push(light);
            group.add(light);
        }
    }

    try {
        if (deps.physics) {
            const half = LAMP_HEIGHT / 2;
            for (const s of spots) bodies.push(deps.physics.addFixedCylinder(half, LP.colliderRadius, { x: s.x, y: half, z: s.z }));
        }
        blobs = deps.addPropBlobs?.(spots.map((s) => ({ x: s.x, z: s.z, w: LP.blobSize, d: LP.blobSize }))) ?? null;
    } catch (err) {
        for (const b of bodies) deps.physics?.removeBody(b);
        own.dispose();
        throw err;
    }

    const handle: LampsHandle = {
        group,
        lights,
        get night() {
            return night;
        },
        setNight(t: number) {
            if (disposed) return;
            night = clamp(Number.isFinite(t) ? t : 0, 0, 1);
            globeColor(night, globeMat.color);
            const intensity = lampIntensity(night);
            for (const l of lights) {
                l.intensity = intensity;
                l.visible = intensity > 0;
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            group.removeFromParent();
            for (const b of bodies) {
                try {
                    deps.physics?.removeBody(b);
                } catch {
                    /* the world may already be freed */
                }
            }
            bodies.length = 0;
            blobs?.setCount(0);
            own.dispose();
        },
    };
    return handle;
}
