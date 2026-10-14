import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, PALETTE, type HexColor } from "./Config";
import { nearestArea, SPAWN } from "./Layout";
import { buildCybertruck, TRUCK_COLORS, type Cybertruck } from "./models/Cybertruck";
import type { AreaId, MaterialsApi, PhysicsApi } from "./types";
import type { Disposal } from "./utils/disposal";
import { clamp, damp, smoothstep, TAU } from "./utils/math";
import { applyLayerToMaterial, applyLayerToObject, LAYERS } from "./utils/shapes";

// ─────────────────────────────────────────────────────────────────────────
// Vehicle (§4.2): Rapier DynamicRayCastVehicleController + the procedural red
// Cybertruck-style truck (models/Cybertruck.ts; owner decision, replaces the
// Kenney car.glb). The truck faces +Z and is built in chassis space, wheels
// on the physics wheel connection points.
//
// Timing: `control(h, input)` runs once per FIXED substep (it is the physics
// `beforeEachStep` callback) and calls `updateVehicle(h)`. `syncVisual(dt)`
// runs once per frame AFTER `physics.interpolate(alpha)` has placed the chassis
// group, and drives wheels, the rear light bar, the blob shadow, auto-flip and
// the fall-off respawn. `setNightFactor(t)` fades the headlight (a SpotLight
// from the front light bar) in at night. The truck casts no real shadow: only
// the blob (§1.5); the headlight casts none either.
// ─────────────────────────────────────────────────────────────────────────

const V = CONFIG.vehicle;

// Chassis, wheel connection, handling and drift-metric tunables live in CONFIG.vehicle.
// ── Stream-local geometry / presentation constants ──────────────────────
/** Throttle / steer dead zone. */
const INPUT_EPSILON = 0.01;
/** Teleport / respawn: chassis placed this far above its resting height so it settles. */
const TELEPORT_LIFT = 0.4;
/**
 * Night headlight: ONE SpotLight from the front light bar, aimed at the ground
 * `ahead` units in front of the nose. Linear decay (1) keeps the pool even
 * from 2 to 10 units ahead without a hot spot at the bumper; `intensity` is the
 * full-night value (NoToneMapping: re-probe before raising it). No shadows.
 */
export const HEADLIGHT = Object.freeze({
    color: PALETTE.carLight,
    intensity: 14,
    distance: 40,
    angle: 0.5,
    penumbra: 0.6,
    decay: 1,
    ahead: 10,
});
/** Blob alpha map: rounded-rect SDF (half size, corner radius, in [−1, 1] uv) with a smoothstep falloff. */
const BLOB_MAP = { halfSize: 0.62, cornerRadius: 0.4, fadeInner: -0.6, fadeOuter: 0.38 } as const;

export interface VehicleInput {
    /** −1..1 (forward positive). */
    throttle: number;
    /** −1..1 (right positive). */
    steer: number;
    /** Space: brake / drift (rear grip drops). */
    handbrake: boolean;
    boost: boolean;
}

export const NEUTRAL_INPUT: Readonly<VehicleInput> = Object.freeze({
    throttle: 0,
    steer: 0,
    handbrake: false,
    boost: false,
});

export type LightState = "off" | "brake" | "reverse";

/** Rear light bar colour: dim tail light, bright brake red, or warm-white reverse. */
export function rearBarColor(light: LightState): HexColor {
    if (light === "brake") return TRUCK_COLORS.rearBrake;
    if (light === "reverse") return TRUCK_COLORS.rearReverse;
    return TRUCK_COLORS.rearDim;
}

/** Headlight intensity for a night factor t (0 = day → off, 1 = full night), clamped. */
export function headlightIntensity(t: number): number {
    return HEADLIGHT.intensity * clamp(Number.isFinite(t) ? t : 0, 0, 1);
}

export interface DriveCommand {
    /** Engine force per wheel (Rapier units; negative = reverse). */
    engineForce: number;
    frontBrake: number;
    rearBrake: number;
    rearGrip: number;
    light: LightState;
    /** Boost actually applied (throttle forward with boost held). */
    boosting: boolean;
}

/**
 * Pure drive logic (§4.2 fix 4). `speed` is SIGNED (forward axis 2):
 * - throttle < 0 && speed > 1  → brake;
 * - throttle > 0 && speed < −1 → brake;
 * - otherwise the throttle drives forward (capped at maxSpeed × boost) or in reverse.
 * Handbrake brakes every wheel (rears harder) and drops rear grip for drifts.
 * Lights: brake while braking, reverse while `speed < −0.5 && throttle < 0`.
 */
export function driveCommand(input: VehicleInput, speed: number): DriveCommand {
    const { throttle } = input;
    const forward = throttle > INPUT_EPSILON;
    const backward = throttle < -INPUT_EPSILON;
    const boosting = forward && input.boost;
    const boostMul = boosting ? V.boostMultiplier : 1;

    let engine = 0;
    let brake = 0;
    const opposing = (backward && speed > V.brakeAboveSpeed) || (forward && speed < -V.brakeAboveSpeed);
    if (opposing) {
        brake = V.brakePower * V.handling.opposingBrakeFactor;
    } else if (forward) {
        engine = speed > V.maxSpeed * boostMul ? 0 : throttle * V.enginePower * boostMul;
    } else if (backward) {
        engine = throttle * V.reversePower;
    }

    let rearBrake = brake;
    let rearGrip: number = V.grip;
    if (input.handbrake) {
        brake = V.brakePower;
        rearBrake = V.brakePower * V.handling.handbrakeRearFactor;
        rearGrip = V.grip * V.drift * V.handling.handbrakeRearGripFactor;
    }

    let light: LightState = "off";
    if (opposing || input.handbrake) light = "brake";
    else if (speed < V.reverseLightBelowSpeed && backward) light = "reverse";

    return { engineForce: engine * V.handling.engineForceScale, frontBrake: brake, rearBrake, rearGrip, light, boosting };
}

/**
 * Yaw (rotation about +Y, forward = (sin yaw, 0, cos yaw)) of a body rotation.
 * Falls back to the right vector when the nose points straight up or down.
 */
export function yawFromQuaternion(q: { x: number; y: number; z: number; w: number }): number {
    const { x, y, z, w } = q;
    // forward = q · (0, 0, 1)
    const fx = 2 * (x * z + w * y);
    const fz = 1 - 2 * (x * x + y * y);
    if (Math.hypot(fx, fz) > 0.1) return Math.atan2(fx, fz);
    // right = q · (−1, 0, 0) = (−cos yaw, 0, sin yaw) for an upright car.
    const rx = -(1 - 2 * (y * y + z * z));
    const rz = -2 * (x * z - w * y);
    return Math.atan2(rz, -rx);
}

/** The y component of the body's up vector, q · (0, 1, 0). */
export function upY(q: { x: number; y: number; z: number; w: number }): number {
    return 1 - 2 * (q.x * q.x + q.z * q.z);
}

/** Static suspension compression under gravity: |g| / (4 · stiffness), capped at the travel. */
export const REST_COMPRESSION = Math.min(
    Math.abs(CONFIG.physics.gravity) / (4 * V.suspensionStiffness),
    V.suspensionTravel
);

/** Chassis centre height above flat ground when the car is at rest. */
export const REST_HEIGHT = -V.wheelConnection.y + V.suspensionRest + V.wheelRadius - REST_COMPRESSION;

/** Blob opacity × clamp(1 − h / liftFade, 0, 1)², h = chassis height above rest (§1.5). */
export function blobOpacity(baseOpacity: number, chassisY: number, groundY = 0): number {
    const h = Math.max(0, chassisY - groundY - REST_HEIGHT);
    const k = clamp(1 - h / CONFIG.shadow.blob.car.liftFade, 0, 1);
    return baseOpacity * k * k;
}

/**
 * Auto-flip timer (§4.2 fix 9): counts the time the car has been upside-down-ish
 * (up.y < 0.3) and fires once it exceeds 1.5 s. Pure, so it is unit-tested.
 */
export class FlipTimer {
    private t = 0;

    update(dt: number, up: number): boolean {
        if (up < V.autoFlip.upY) this.t += dt;
        else this.t = 0;
        if (this.t >= V.autoFlip.seconds) {
            this.t = 0;
            return true;
        }
        return false;
    }

    reset() {
        this.t = 0;
    }
}

/** 128² rounded-rect radial falloff, as a DataTexture (no DOM needed). */
function makeBlobAlphaMap(size: number): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const b = BLOB_MAP.halfSize;
    const r = BLOB_MAP.cornerRadius;
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const px = Math.abs(((i + 0.5) / size) * 2 - 1);
            const py = Math.abs(((j + 0.5) / size) * 2 - 1);
            const qx = px - b + r;
            const qy = py - b + r;
            const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
            const a = 1 - smoothstep(BLOB_MAP.fadeInner, BLOB_MAP.fadeOuter, d);
            const v = Math.round(a * 255);
            const k = (j * size + i) * 4;
            // alphaMap samples the green channel.
            data[k] = v;
            data[k + 1] = v;
            data[k + 2] = v;
            data[k + 3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

export interface VehicleDeps {
    physics: PhysicsApi;
    materials: MaterialsApi;
    disposal: Disposal;
    /**
     * @deprecated Ignored: the truck is procedural (models/Cybertruck.ts) and
     * Assets no longer loads car.glb. Kept optional so existing callers compile.
     */
    model?: THREE.Object3D | null;
    /**
     * Shared blob alpha map (§1.5: the car and the low-profile prop blobs use the
     * same texture): `env.blobTexture("rect")`, owned by Environment. Without it
     * the car builds its own map (tests).
     */
    blobTexture?: THREE.Texture;
}

export interface VehiclePose {
    x: number;
    z: number;
    yaw: number;
}

export class Vehicle {
    /** Add to the scene. Holds the chassis (physics-linked) and the blob shadow. */
    readonly root = new THREE.Group();
    /** The interpolated chassis visual (linked to the body via physics.link). */
    readonly chassis = new THREE.Group();
    readonly blob: THREE.Mesh;
    /** The truck model (meshes under `chassis`). */
    readonly truck: Cybertruck;
    /** Night headlight (child of `chassis`, target ahead of the nose); off and hidden by day. */
    readonly headlight: THREE.SpotLight;
    readonly body: RAPIER.RigidBody;
    readonly controller: RAPIER.DynamicRayCastVehicleController;

    /** Signed forward speed (units/s), from currentVehicleSpeed() (negative in reverse). */
    speed = 0;
    /** Horizontal chassis velocity (physics, not interpolated). */
    readonly velocity = new THREE.Vector3();
    /** 0..1 lateral slip, for tyre dust. */
    driftAmount = 0;
    boosting = false;
    handbrake = false;
    light: LightState = "off";
    /** True when at least one rear wheel touches the ground. */
    rearGrounded = false;

    private physics: PhysicsApi;
    private materials: MaterialsApi;
    private disposal: Disposal;
    private wheels: THREE.Object3D[] = [];
    private wheelSpin = 0;
    private steer = 0;
    private flip = new FlipTimer();
    private rearBarMats: Readonly<Record<LightState, THREE.MeshBasicMaterial>>;
    private night = 0;
    private blobMat: THREE.MeshBasicMaterial;
    private blobBaseOpacity: number;
    private teleportListeners = new Set<(areaId: AreaId | null) => void>();
    private disposed = false;

    // scratch
    private _q = new THREE.Quaternion();
    private _v = new THREE.Vector3();
    private _rearLocal = [new THREE.Vector3(), new THREE.Vector3()];

    constructor(deps: VehicleDeps, spawn: VehiclePose = SPAWN) {
        this.physics = deps.physics;
        this.materials = deps.materials;
        this.disposal = deps.disposal;
        this.root.name = "vehicle";
        this.chassis.name = "vehicle-chassis";
        this.root.add(this.chassis);

        const world = this.physics.world;
        const half = V.chassisHalf;
        this.body = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(spawn.x, REST_HEIGHT, spawn.z)
                .setLinearDamping(V.chassis.linearDamping)
                .setAngularDamping(V.chassis.angularDamping)
                .setCanSleep(false)
        );
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
                .setMass(V.mass)
                .setFriction(V.chassis.friction)
                .setRestitution(V.chassis.restitution),
            this.body
        );
        this.controller = world.createVehicleController(this.body);
        // §4.2 fix 1: a setter PROPERTY — assigning `indexForwardAxis` does nothing.
        // Without it currentVehicleSpeed() measures along X and never goes negative.
        this.controller.setIndexForwardAxis = V.forwardAxis;
        this.addWheels();

        this.truck = buildCybertruck({ materials: this.materials, disposal: this.disposal, groundY: -REST_HEIGHT });
        this.chassis.add(this.truck.root);
        this.wheels = this.truck.wheels;
        this.rearBarMats = Object.freeze({
            off: this.materials.basic(rearBarColor("off")),
            brake: this.materials.basic(rearBarColor("brake")),
            reverse: this.materials.basic(rearBarColor("reverse")),
        });
        this.headlight = this.buildHeadlight();
        this.chassis.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.castShadow = false;
        });

        // The red truck reads like the "brand" paint against the ground (§4.2 contrast note).
        this.blobBaseOpacity = CONFIG.shadow.blob.car.opacity;
        const blob = this.buildBlob(deps.blobTexture);
        this.blob = blob.mesh;
        this.blobMat = blob.material;
        this.root.add(this.blob);

        this.setPose(spawn.x, REST_HEIGHT, spawn.z, spawn.yaw);
        this.physics.link(this.body, this.chassis);
        this.physics.snap(this.body);
        this.syncChassisFromBody();
    }

    // ── build ────────────────────────────────────────────────────────────
    private addWheels() {
        const c = this.controller;
        const down = { x: 0, y: -1, z: 0 };
        const axle = { x: -1, y: 0, z: 0 };
        const cx = V.chassisHalf.x;
        const cy = V.wheelConnection.y;
        const cz = V.chassisHalf.z - V.wheelConnection.insetZ;
        // 0 FL, 1 FR, 2 RL, 3 RR — left is +X for a car facing +Z.
        const points = [
            { x: cx, y: cy, z: cz },
            { x: -cx, y: cy, z: cz },
            { x: cx, y: cy, z: -cz },
            { x: -cx, y: cy, z: -cz },
        ];
        for (const p of points) c.addWheel(p, down, axle, V.suspensionRest, V.wheelRadius);
        for (let i = 0; i < points.length; i++) {
            c.setWheelSuspensionStiffness(i, V.suspensionStiffness);
            c.setWheelMaxSuspensionTravel(i, V.suspensionTravel);
            c.setWheelSuspensionCompression(i, V.suspensionDamping);
            c.setWheelSuspensionRelaxation(i, V.suspensionDamping);
            c.setWheelFrictionSlip(i, V.grip);
        }
        this._rearLocal[0].set(cx, -REST_HEIGHT, -cz);
        this._rearLocal[1].set(-cx, -REST_HEIGHT, -cz);
    }

    /** The headlight: a shadowless SpotLight on the front bar, aimed at the ground ahead; off until night. */
    private buildHeadlight(): THREE.SpotLight {
        const H = HEADLIGHT;
        const light = new THREE.SpotLight(H.color, 0, H.distance, H.angle, H.penumbra, H.decay);
        light.name = "vehicle-headlight";
        light.castShadow = false;
        light.visible = false;
        light.position.copy(this.truck.headlightOrigin);
        light.target.name = "vehicle-headlight-target";
        light.target.position.set(0, this.truck.dims.groundY, this.truck.dims.zFront + H.ahead);
        // Both under the chassis, so they follow the truck (the target's matrix updates with the scene).
        this.chassis.add(light, light.target);
        return light;
    }

    private buildBlob(shared?: THREE.Texture): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
        const B = CONFIG.shadow.blob;
        const geo = this.disposal.track(new THREE.PlaneGeometry(B.car.width, B.car.length));
        geo.rotateX(-Math.PI / 2);
        // The shared map belongs to Environment; only a car-built map is tracked here.
        const map = shared ?? this.disposal.track(makeBlobAlphaMap(B.textureSize));
        const material = this.disposal.track(
            new THREE.MeshBasicMaterial({
                color: B.color,
                alphaMap: map,
                transparent: true,
                opacity: this.blobBaseOpacity,
                fog: true,
            })
        );
        applyLayerToMaterial(material, "blob");
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = "vehicle-blob";
        applyLayerToObject(mesh, "blob");
        mesh.position.y = LAYERS.blob.y;
        return { mesh, material };
    }

    // ── per substep ──────────────────────────────────────────────────────
    /** Physics `beforeEachStep(h)`: steering, engine, brakes, then updateVehicle(h). */
    control(h: number, input: VehicleInput) {
        const c = this.controller;
        const targetSteer = -clamp(input.steer, -1, 1) * V.steerMax;
        const lambda = Math.abs(input.steer) > INPUT_EPSILON ? V.steerSpeed : V.steerReturn;
        this.steer = damp(this.steer, targetSteer, lambda, h);
        c.setWheelSteering(0, this.steer);
        c.setWheelSteering(1, this.steer);

        const speed = c.currentVehicleSpeed();
        this.speed = speed;
        const cmd = driveCommand(input, speed);
        for (let i = 0; i < 4; i++) c.setWheelEngineForce(i, cmd.engineForce);
        c.setWheelBrake(0, cmd.frontBrake);
        c.setWheelBrake(1, cmd.frontBrake);
        c.setWheelBrake(2, cmd.rearBrake);
        c.setWheelBrake(3, cmd.rearBrake);
        c.setWheelFrictionSlip(2, cmd.rearGrip);
        c.setWheelFrictionSlip(3, cmd.rearGrip);
        this.light = cmd.light;
        this.boosting = cmd.boosting;
        this.handbrake = input.handbrake;

        c.updateVehicle(h);
        // Wheel roll follows the SIGNED speed, so it reverses in reverse.
        this.wheelSpin = (this.wheelSpin + (speed / V.wheelRadius) * h) % TAU;
    }

    // ── per frame ────────────────────────────────────────────────────────
    /** After physics.interpolate(): wheels, lamps, blob, drift metric, auto-flip, fall-off respawn. */
    syncVisual(dt: number) {
        const lv = this.body.linvel();
        this.velocity.set(lv.x, 0, lv.z);
        const flatSpeed = this.velocity.length();
        if (flatSpeed > V.driftMetric.minSpeed) {
            const r = this.body.rotation();
            this._q.set(r.x, r.y, r.z, r.w);
            const right = this._v.set(-1, 0, 0).applyQuaternion(this._q);
            const lateral = Math.abs((this.velocity.x * right.x + this.velocity.z * right.z) / flatSpeed);
            this.driftAmount = clamp(lateral * V.driftMetric.gain, 0, 1);
        } else {
            this.driftAmount = 0;
        }
        this.rearGrounded = this.controller.wheelIsInContact(2) || this.controller.wheelIsInContact(3);

        // YXZ: steer (Y) first, then roll about the steered axle (X) — no wobble.
        const spin = this.wheelSpin;
        for (let i = 0; i < this.wheels.length; i++) {
            this.wheels[i].rotation.set(spin, i < 2 ? this.steer : 0, 0);
        }

        this.truck.rearBar.material = this.rearBarMats[this.light];

        // Blob follows the interpolated chassis x/z and yaw, flat at y 0.10.
        const p = this.chassis.position;
        this.blob.position.set(p.x, LAYERS.blob.y, p.z);
        this.blob.rotation.set(0, yawFromQuaternion(this.chassis.quaternion), 0);
        this.blobMat.opacity = blobOpacity(this.blobBaseOpacity, p.y);

        const t = this.body.translation();
        if (t.y < V.respawnBelowY) {
            this.respawn();
            return;
        }
        if (this.flip.update(dt, upY(this.body.rotation()))) this.autoFlip();
    }

    // ── night ────────────────────────────────────────────────────────────
    /**
     * Day/night: t = 0 (day) → headlight off and hidden; t = 1 (night) → full.
     * Hidden by day so the lit programs skip it; the first time it shows, the
     * programs gain a spot-light variant (pre-warm it with setNightFactor(1)
     * around renderer.compile()).
     */
    setNightFactor(t: number) {
        this.night = clamp(Number.isFinite(t) ? t : 0, 0, 1);
        const intensity = headlightIntensity(this.night);
        this.headlight.intensity = intensity;
        this.headlight.visible = intensity > 0;
    }

    /** The last night factor given to setNightFactor (0..1). */
    get nightFactor(): number {
        return this.night;
    }

    // ── placement ────────────────────────────────────────────────────────
    /** Interpolated chassis position (what the camera follows). */
    get position(): THREE.Vector3 {
        return this.chassis.position;
    }

    get yaw(): number {
        return yawFromQuaternion(this.chassis.quaternion);
    }

    /** Is the car drifting (handbrake held or sliding sideways)? */
    get drifting(): boolean {
        return this.handbrake || this.driftAmount > V.driftMetric.threshold;
    }

    /** World positions of the rear wheel contact points (tyre dust sources). */
    rearWheelPositions(out: [THREE.Vector3, THREE.Vector3]): [THREE.Vector3, THREE.Vector3] {
        this.chassis.updateMatrixWorld();
        out[0].copy(this._rearLocal[0]).applyMatrix4(this.chassis.matrixWorld);
        out[1].copy(this._rearLocal[1]).applyMatrix4(this.chassis.matrixWorld);
        return out;
    }

    /** Listens for teleports (travel, R respawn, fall-off, Start drop); returns an unsubscribe. */
    onTeleport(cb: (areaId: AreaId | null) => void): () => void {
        this.teleportListeners.add(cb);
        return () => this.teleportListeners.delete(cb);
    }

    /**
     * Places the car at (x, z) facing `yaw`, `lift` above its resting height,
     * with zero velocity, then snaps interpolation (no smear across the jump).
     */
    teleport(x: number, z: number, yaw: number, lift = TELEPORT_LIFT, areaId: AreaId | null = null) {
        this.setPose(x, REST_HEIGHT + lift, z, yaw);
        this.steer = 0;
        this.speed = 0;
        this.flip.reset();
        this.physics.snap(this.body);
        this.syncChassisFromBody();
        for (const cb of this.teleportListeners) cb(areaId);
    }

    /** R (§4.2 fix 10): the arrival point of the nearest area by rect distance. */
    respawn() {
        const t = this.body.translation();
        const area = nearestArea(t.x, t.z);
        this.teleport(area.arrival.x, area.arrival.z, area.arrival.yaw, TELEPORT_LIFT, area.id);
    }

    /** Start: the car drops in at the spawn from y + spawnDrop (§2.4). */
    dropIn(spawn: VehiclePose = SPAWN) {
        this.teleport(spawn.x, spawn.z, spawn.yaw, V.spawnDrop, "welcome");
    }

    /** §4.2 fix 9: yaw-only rotation, lifted by 1.5, angular velocity zeroed, snapped. */
    private autoFlip() {
        const t = this.body.translation();
        const yaw = yawFromQuaternion(this.body.rotation());
        this._q.setFromAxisAngle(this._v.set(0, 1, 0), yaw);
        this.body.setTranslation({ x: t.x, y: t.y + V.autoFlip.lift, z: t.z }, true);
        this.body.setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.snap(this.body);
        this.syncChassisFromBody();
    }

    private setPose(x: number, y: number, z: number, yaw: number) {
        this._q.setFromAxisAngle(this._v.set(0, 1, 0), yaw);
        this.body.setTranslation({ x, y, z }, true);
        this.body.setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w }, true);
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    /** Copies the body pose straight onto the chassis (until the next interpolate). */
    private syncChassisFromBody() {
        const t = this.body.translation();
        const r = this.body.rotation();
        this.chassis.position.set(t.x, t.y, t.z);
        this.chassis.quaternion.set(r.x, r.y, r.z, r.w);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.teleportListeners.clear();
        this.headlight.dispose();
        this.root.removeFromParent();
        try {
            this.physics.unlink(this.body);
            this.physics.world.removeVehicleController(this.controller);
            this.physics.world.removeRigidBody(this.body);
        } catch {
            /* the world may already be freed */
        }
    }
}
