import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, PALETTE, type HexColor } from "./Config";
import { nearestArea, SPAWN } from "./Layout";
import type { AreaId, MaterialsApi, PhysicsApi } from "./types";
import type { Disposal } from "./utils/disposal";
import { clamp, damp, smoothstep, TAU } from "./utils/math";
import { applyLayerToMaterial, applyLayerToObject, LAYERS } from "./utils/shapes";

// ─────────────────────────────────────────────────────────────────────────
// Vehicle (§4.2): Rapier DynamicRayCastVehicleController + the Kenney car.glb
// (body + 4 `wheel-*` nodes, already facing +Z, so no model flip).
//
// Timing: `control(h, input)` runs once per FIXED substep (it is the physics
// `beforeEachStep` callback) and calls `updateVehicle(h)`. `syncVisual(dt)`
// runs once per frame AFTER `physics.interpolate(alpha)` has placed the chassis
// group, and drives wheels, lights, the blob shadow, auto-flip and the fall-off
// respawn. The car casts no real shadow: only the blob (§1.5).
// ─────────────────────────────────────────────────────────────────────────

const V = CONFIG.vehicle;

// ── Stream-local tuning (v2 values; not yet in CONFIG.vehicle) ──────────
/** Chassis rigid body / collider (copied from v2 Physics.createVehicle). */
const CHASSIS = { linearDamping: 0.12, angularDamping: 0.6, friction: 0.8, restitution: 0.1 } as const;
/** Wheel connection points in chassis space: y offset, and inset from the chassis ends along z. */
const WHEEL_CONNECTION = { y: -0.05, insetZ: 0.5 } as const;
/** Engine output → Rapier engine force. */
const ENGINE_FORCE_SCALE = 60;
/** Brake strength when the throttle opposes the motion (fraction of brakePower). */
const OPPOSING_BRAKE_FACTOR = 0.8;
/** Handbrake: rear wheels brake harder and lose grip so the tail slides. */
const HANDBRAKE_REAR_FACTOR = 1.4;
const HANDBRAKE_REAR_GRIP_FACTOR = 0.5;
/** Throttle / steer dead zone. */
const INPUT_EPSILON = 0.01;
/** Drift metric: ignored below this speed; lateral slip × gain, clamped to 1. */
const DRIFT_METRIC = { minSpeed: 2, gain: 1.4 } as const;
/** driftAmount above which the car counts as drifting (tyre dust). */
const DRIFT_THRESHOLD = 0.35;
/** The model is scaled so its length is the chassis length × this. */
const MODEL_LENGTH_FACTOR = 1.02;
/** Brake/reverse lamps on the model's rear face: x as a fraction of the half width, y of the height. */
const LAMP_PLACEMENT = { xFraction: 0.62, yFraction: 0.5 } as const;
/** Teleport / respawn: chassis placed this far above its resting height so it settles. */
const TELEPORT_LIFT = 0.4;
/** Procedural fallback body profile (side view, fractions of chassis half length / units). */
const FALLBACK = {
    bevel: 0.06,
    wheelWidth: 0.34,
    rimRadiusFraction: 0.55,
    rimWidth: 0.36,
    wheelSegments: 18,
    rimSegments: 12,
    cabin: { w: 1.5, h: 0.5, d: 1.7, z: -0.25 },
    /** Side profile (x along the length as a fraction of the half length, y in chassis half heights). */
    profile: [
        [-1, 0],
        [0.72, 0],
        [1, 1.2],
        [0.1, 1.66],
        [-0.55, 1.77],
        [-1, 1],
    ] as const,
    /** Cabin base height, in chassis half heights. */
    cabinBase: 1.6,
} as const;
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
        brake = V.brakePower * OPPOSING_BRAKE_FACTOR;
    } else if (forward) {
        engine = speed > V.maxSpeed * boostMul ? 0 : throttle * V.enginePower * boostMul;
    } else if (backward) {
        engine = throttle * V.reversePower;
    }

    let rearBrake = brake;
    let rearGrip: number = V.grip;
    if (input.handbrake) {
        brake = V.brakePower;
        rearBrake = V.brakePower * HANDBRAKE_REAR_FACTOR;
        rearGrip = V.grip * V.drift * HANDBRAKE_REAR_GRIP_FACTOR;
    }

    let light: LightState = "off";
    if (opposing || input.handbrake) light = "brake";
    else if (speed < V.reverseLightBelowSpeed && backward) light = "reverse";

    return { engineForce: engine * ENGINE_FORCE_SCALE, frontBrake: brake, rearBrake, rearGrip, light, boosting };
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
export const REST_HEIGHT = -WHEEL_CONNECTION.y + V.suspensionRest + V.wheelRadius - REST_COMPRESSION;

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
    /** `assets.model("car")` (Lambert, repainted); null → procedural fallback body. */
    model: THREE.Object3D | null;
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

/** Wheel order matches the controller: FL, FR, RL, RR. */
const WHEEL_NODE_NAMES = ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"] as const;

export class Vehicle {
    /** Add to the scene. Holds the chassis (physics-linked) and the blob shadow. */
    readonly root = new THREE.Group();
    /** The interpolated chassis visual (linked to the body via physics.link). */
    readonly chassis = new THREE.Group();
    readonly blob: THREE.Mesh;
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
    private lamps: THREE.Mesh[] = [];
    private brakeMat: THREE.MeshBasicMaterial;
    private reverseMat: THREE.MeshBasicMaterial;
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
                .setLinearDamping(CHASSIS.linearDamping)
                .setAngularDamping(CHASSIS.angularDamping)
                .setCanSleep(false)
        );
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
                .setMass(V.mass)
                .setFriction(CHASSIS.friction)
                .setRestitution(CHASSIS.restitution),
            this.body
        );
        this.controller = world.createVehicleController(this.body);
        // §4.2 fix 1: a setter PROPERTY — assigning `indexForwardAxis` does nothing.
        // Without it currentVehicleSpeed() measures along X and never goes negative.
        this.controller.setIndexForwardAxis = V.forwardAxis;
        this.addWheels();

        const rearZ = this.buildBody(deps.model);
        this.buildLamps(rearZ);
        this.chassis.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.castShadow = false;
        });

        const paintKey = V.paint;
        const B = CONFIG.shadow.blob;
        this.blobBaseOpacity = paintKey === "danfo" ? B.car.danfoOpacity : B.car.opacity;
        this.brakeMat = this.materials.basic(PALETTE.brake);
        this.reverseMat = this.materials.basic(PALETTE.carLight);
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
        const cy = WHEEL_CONNECTION.y;
        const cz = V.chassisHalf.z - WHEEL_CONNECTION.insetZ;
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

    /** Builds the GLB (or procedural) body; returns the rear face z in chassis space. */
    private buildBody(model: THREE.Object3D | null): number {
        if (model) {
            const wheels = WHEEL_NODE_NAMES.map((n) => model.getObjectByName(n));
            if (wheels.every((w): w is THREE.Object3D => !!w)) return this.buildFromModel(model, wheels);
            console.warn("[world3] car.glb is missing wheel nodes; using the procedural car");
        }
        return this.buildProcedural();
    }

    /** Kenney car.glb: already faces +Z (no rotation). Scaled to the chassis length, wheels on the ground. */
    private buildFromModel(model: THREE.Object3D, wheels: THREE.Object3D[]): number {
        const pivot = new THREE.Group();
        pivot.name = "car-model";
        pivot.add(model);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const scale = (V.chassisHalf.z * 2 * MODEL_LENGTH_FACTOR) / Math.max(size.z, 1e-3);
        pivot.scale.setScalar(scale);
        // Centre on x/z; the model's lowest point (tyre bottoms) sits on the ground at rest.
        pivot.position.set(-centre.x * scale, -REST_HEIGHT - box.min.y * scale, -centre.z * scale);

        for (const w of wheels) w.rotation.order = "YXZ";
        this.wheels = wheels;
        this.chassis.add(pivot);
        return pivot.position.z + box.min.z * scale;
    }

    /** Fallback when car.glb is missing: a palette wedge with a cabin and 4 wheels. */
    private buildProcedural(): number {
        const d = this.disposal;
        const m = this.materials;
        const paint: HexColor = V.paints[V.paint];
        const L = V.chassisHalf.z;
        const W = V.chassisHalf.x;
        const groundY = -REST_HEIGHT;
        const floorY = groundY + V.wheelRadius;

        const shape = new THREE.Shape();
        FALLBACK.profile.forEach(([px, py], i) => {
            if (i === 0) shape.moveTo(px * L, py * V.chassisHalf.y);
            else shape.lineTo(px * L, py * V.chassisHalf.y);
        });
        shape.closePath();
        const bodyGeo = d.track(
            new THREE.ExtrudeGeometry(shape, {
                depth: W * 2,
                bevelEnabled: true,
                bevelThickness: FALLBACK.bevel,
                bevelSize: FALLBACK.bevel,
                bevelSegments: 1,
            })
        );
        // Extruded along +Z (0..2W): turning by −90° maps the profile's +X to +Z
        // (forward) and the extrusion to x ∈ [−2W, 0], so shift it back by W.
        bodyGeo.rotateY(-Math.PI / 2);
        bodyGeo.translate(W, floorY, 0);
        const body = new THREE.Mesh(bodyGeo, m.lambert(paint));
        body.receiveShadow = true;
        this.chassis.add(body);

        const C = FALLBACK.cabin;
        const cabinGeo = d.track(new THREE.BoxGeometry(C.w, C.h, C.d));
        const cabin = new THREE.Mesh(cabinGeo, m.lambert(PALETTE.carTrim));
        cabin.position.set(0, floorY + V.chassisHalf.y * FALLBACK.cabinBase + C.h / 2, C.z);
        this.chassis.add(cabin);

        const tyreGeo = d.track(
            new THREE.CylinderGeometry(V.wheelRadius, V.wheelRadius, FALLBACK.wheelWidth, FALLBACK.wheelSegments)
        );
        tyreGeo.rotateZ(Math.PI / 2);
        const rimR = V.wheelRadius * FALLBACK.rimRadiusFraction;
        const rimGeo = d.track(new THREE.CylinderGeometry(rimR, rimR, FALLBACK.rimWidth, FALLBACK.rimSegments));
        rimGeo.rotateZ(Math.PI / 2);
        const cz = L - WHEEL_CONNECTION.insetZ;
        const spots = [
            [W, cz],
            [-W, cz],
            [W, -cz],
            [-W, -cz],
        ];
        for (const [x, z] of spots) {
            const w = new THREE.Group();
            w.rotation.order = "YXZ";
            w.position.set(x, groundY + V.wheelRadius, z);
            w.add(new THREE.Mesh(tyreGeo, m.lambert(PALETTE.carTyre)), new THREE.Mesh(rimGeo, m.lambert(PALETTE.carRim)));
            this.chassis.add(w);
            this.wheels.push(w);
        }
        return -L - FALLBACK.bevel;
    }

    /** Two brake/reverse lamps on ink backings at the rear (§4.2 fix 8). */
    private buildLamps(rearZ: number) {
        const Ls = V.lights;
        const backingGeo = this.disposal.track(new THREE.BoxGeometry(Ls.backing.w, Ls.backing.h, Ls.backing.d));
        const lampGeo = this.disposal.track(new THREE.BoxGeometry(Ls.lamp.w, Ls.lamp.h, Ls.lamp.d));
        const box = new THREE.Box3().setFromObject(this.chassis);
        const halfW = (box.max.x - box.min.x) / 2;
        const y = box.min.y + (box.max.y - box.min.y) * LAMP_PLACEMENT.yFraction;
        const backingZ = rearZ - Ls.backing.d / 2;
        const lampZ = backingZ - Ls.backing.d / 2 - Ls.lamp.d / 2;
        for (const sgn of [-1, 1]) {
            const x = sgn * halfW * LAMP_PLACEMENT.xFraction;
            const backing = new THREE.Mesh(backingGeo, this.materials.lambert(PALETTE.ink));
            backing.position.set(x, y, backingZ);
            const lamp = new THREE.Mesh(lampGeo, this.materials.basic(PALETTE.brake));
            lamp.position.set(x, y, lampZ);
            lamp.visible = false;
            this.chassis.add(backing, lamp);
            this.lamps.push(lamp);
        }
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
        if (flatSpeed > DRIFT_METRIC.minSpeed) {
            const r = this.body.rotation();
            this._q.set(r.x, r.y, r.z, r.w);
            const right = this._v.set(-1, 0, 0).applyQuaternion(this._q);
            const lateral = Math.abs((this.velocity.x * right.x + this.velocity.z * right.z) / flatSpeed);
            this.driftAmount = clamp(lateral * DRIFT_METRIC.gain, 0, 1);
        } else {
            this.driftAmount = 0;
        }
        this.rearGrounded = this.controller.wheelIsInContact(2) || this.controller.wheelIsInContact(3);

        // YXZ: steer (Y) first, then roll about the steered axle (X) — no wobble.
        const spin = this.wheelSpin;
        for (let i = 0; i < this.wheels.length; i++) {
            this.wheels[i].rotation.set(spin, i < 2 ? this.steer : 0, 0);
        }

        for (const lamp of this.lamps) {
            lamp.visible = this.light !== "off";
            lamp.material = this.light === "reverse" ? this.reverseMat : this.brakeMat;
        }

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
        return this.handbrake || this.driftAmount > DRIFT_THRESHOLD;
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
