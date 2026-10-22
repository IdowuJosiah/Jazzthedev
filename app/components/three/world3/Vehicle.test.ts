import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, PALETTE } from "./Config";
import { AREA_BY_ID } from "./Layout";
import type { MaterialsApi, PhysicsApi } from "./types";
import { Disposal } from "./utils/disposal";
import { angleDelta } from "./utils/math";
import { LAYERS } from "./utils/shapes";
import { TRUCK_COLORS, WHEEL_NAMES } from "./models/Cybertruck";
import {
    blobOpacity,
    driveCommand,
    FlipTimer,
    HEADLIGHT,
    headlightIntensity,
    NEUTRAL_INPUT,
    rearBarColor,
    REST_HEIGHT,
    upY,
    Vehicle,
    yawFromQuaternion,
    type VehicleInput,
} from "./Vehicle";

const V = CONFIG.vehicle;
const H = CONFIG.physics.fixedStep;

const materials: MaterialsApi = {
    lambert: (hex) => new THREE.MeshLambertMaterial({ color: hex }),
    basic: (hex, o) => new THREE.MeshBasicMaterial({ color: hex, fog: o?.fog ?? true }),
};

/** Minimal PhysicsApi over a real Rapier world: flat ground, no interpolation (alpha = 1). */
function makeWorld() {
    const world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    world.timestep = H;
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 1, 500).setTranslation(0, -1, 0));
    const links = new Map<RAPIER.RigidBody, THREE.Object3D>();
    const snaps: RAPIER.RigidBody[] = [];
    const physics = {
        world,
        link: (b: RAPIER.RigidBody, o: THREE.Object3D) => links.set(b, o),
        unlink: (b: RAPIER.RigidBody) => links.delete(b),
        snap: (b: RAPIER.RigidBody) => snaps.push(b),
        interpolate: () => {
            for (const [b, o] of links) {
                const t = b.translation();
                const r = b.rotation();
                o.position.set(t.x, t.y, t.z);
                o.quaternion.set(r.x, r.y, r.z, r.w);
            }
        },
    } as unknown as PhysicsApi;
    return { world, physics, snaps };
}

function makeVehicle(spawn = { x: 0, z: 0, yaw: 0 }) {
    const w = makeWorld();
    const disposal = new Disposal();
    const vehicle = new Vehicle({ physics: w.physics, materials, disposal }, spawn);
    const run = (steps: number, input: VehicleInput = NEUTRAL_INPUT) => {
        for (let i = 0; i < steps; i++) {
            vehicle.control(H, input);
            w.world.step();
            w.physics.interpolate(1);
            vehicle.syncVisual(H);
        }
    };
    return { ...w, vehicle, run, disposal };
}

const hexOf = (m: THREE.Mesh) => "#" + (m.material as THREE.MeshBasicMaterial).color.getHexString().toUpperCase();

const throttle = (t: number, extra: Partial<VehicleInput> = {}): VehicleInput => ({ ...NEUTRAL_INPUT, throttle: t, ...extra });

beforeAll(async () => {
    await RAPIER.init();
});

describe("driveCommand (pure brake / drive logic, §4.2 fix 4)", () => {
    it("drives forward and reverses from rest", () => {
        expect(driveCommand(throttle(1), 0).engineForce).toBeGreaterThan(0);
        expect(driveCommand(throttle(-1), 0).engineForce).toBeLessThan(0);
        expect(driveCommand(throttle(1), 0).frontBrake).toBe(0);
    });

    it("brakes when the throttle opposes the motion", () => {
        const a = driveCommand(throttle(-1), 5);
        expect(a.engineForce).toBe(0);
        expect(a.frontBrake).toBeGreaterThan(0);
        expect(a.light).toBe("brake");
        const b = driveCommand(throttle(1), -5);
        expect(b.engineForce).toBe(0);
        expect(b.frontBrake).toBeGreaterThan(0);
        expect(b.light).toBe("brake");
    });

    it("keeps reversing (no brake) once already moving backwards", () => {
        const c = driveCommand(throttle(-1), -5);
        expect(c.engineForce).toBeLessThan(0);
        expect(c.frontBrake).toBe(0);
        expect(c.light).toBe("reverse");
    });

    it("shows the reverse light only below −0.5 with the throttle back", () => {
        expect(driveCommand(throttle(-1), -0.2).light).toBe("off");
        expect(driveCommand(throttle(0), -3).light).toBe("off");
    });

    it("caps forward drive at maxSpeed × boost", () => {
        expect(driveCommand(throttle(1), V.maxSpeed + 1).engineForce).toBe(0);
        const boosted = driveCommand(throttle(1, { boost: true }), V.maxSpeed + 1);
        expect(boosted.engineForce).toBeGreaterThan(0);
        expect(boosted.boosting).toBe(true);
        expect(driveCommand(throttle(0, { boost: true }), 0).boosting).toBe(false);
    });

    it("rear bar colour: dim tail light, bright brake red, warm-white reverse", () => {
        expect(rearBarColor("off")).toBe(TRUCK_COLORS.rearDim);
        expect(rearBarColor("brake")).toBe(PALETTE.brake);
        expect(rearBarColor("reverse")).toBe(PALETTE.carLight);
        expect(TRUCK_COLORS.rearDim).toBe("#8E1F17");
    });

    it("headlight intensity: 0 by day, full at night, linear between, clamped", () => {
        expect(headlightIntensity(0)).toBe(0);
        expect(headlightIntensity(1)).toBe(HEADLIGHT.intensity);
        expect(headlightIntensity(0.5)).toBeCloseTo(HEADLIGHT.intensity / 2, 9);
        expect(headlightIntensity(-1)).toBe(0);
        expect(headlightIntensity(3)).toBe(HEADLIGHT.intensity);
        expect(headlightIntensity(Number.NaN)).toBe(0);
    });

    it("handbrake brakes the rears harder and drops their grip", () => {
        const c = driveCommand(throttle(0, { handbrake: true }), 10);
        expect(c.rearBrake).toBeGreaterThan(c.frontBrake);
        expect(c.rearGrip).toBeLessThan(V.grip);
        expect(c.light).toBe("brake");
    });
});

describe("pose helpers", () => {
    it("yawFromQuaternion matches forward = (sin yaw, 0, cos yaw)", () => {
        const q = new THREE.Quaternion();
        for (const yaw of [0, Math.PI / 2, Math.PI - 0.01, -Math.PI / 2, 2.5, -2.9]) {
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            expect(angleDelta(yawFromQuaternion(q), yaw)).toBeCloseTo(0, 6);
        }
    });

    it("yawFromQuaternion survives a nose-up car and an upside-down car", () => {
        const yaw = 1.1;
        const noseUp = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
        expect(angleDelta(yawFromQuaternion(noseUp), yaw)).toBeCloseTo(0, 6);
        const roof = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
        expect(angleDelta(yawFromQuaternion(roof), yaw)).toBeCloseTo(0, 6);
        expect(upY(roof)).toBeCloseTo(-1, 6);
    });

    it("FlipTimer fires after 1.5 s below up.y 0.3 and resets when upright", () => {
        const f = new FlipTimer();
        expect(f.update(1.0, 0)).toBe(false);
        expect(f.update(0.2, 1)).toBe(false); // upright again: timer resets
        expect(f.update(1.0, 0.2)).toBe(false);
        expect(f.update(0.49, 0.2)).toBe(false);
        expect(f.update(0.02, 0.2)).toBe(true);
    });

    it("blob opacity fades with height above rest, quadratically", () => {
        const base = CONFIG.shadow.blob.car.opacity;
        expect(blobOpacity(base, REST_HEIGHT)).toBeCloseTo(base);
        expect(blobOpacity(base, REST_HEIGHT - 0.2)).toBeCloseTo(base); // compressed: still full
        expect(blobOpacity(base, REST_HEIGHT + 1.5)).toBeCloseTo(base * 0.25);
        expect(blobOpacity(base, REST_HEIGHT + 3)).toBe(0);
    });
});

describe("Vehicle on Rapier", () => {
    it("forward axis 2: currentVehicleSpeed is signed along +Z (negative in reverse)", () => {
        const { vehicle } = makeVehicle();
        expect(vehicle.controller.indexForwardAxis).toBe(2);
        vehicle.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
        vehicle.controller.updateVehicle(H);
        expect(vehicle.controller.currentVehicleSpeed()).toBeCloseTo(-10, 3);
        vehicle.body.setLinvel({ x: 0, y: 0, z: 10 }, true);
        vehicle.controller.updateVehicle(H);
        expect(vehicle.controller.currentVehicleSpeed()).toBeCloseTo(10, 3);
    });

    it("settles at its resting height", () => {
        const { vehicle, run } = makeVehicle();
        run(180);
        expect(vehicle.body.translation().y).toBeCloseTo(REST_HEIGHT, 1);
        expect(vehicle.rearGrounded).toBe(true);
    });

    it("drives nose-first: throttle moves it along its +Z forward (the light-bar nose) with positive speed", () => {
        const { vehicle, run } = makeVehicle();
        run(30);
        run(90, throttle(1));
        expect(vehicle.speed).toBeGreaterThan(3);
        expect(vehicle.body.linvel().z).toBeGreaterThan(3);
        expect(vehicle.light).toBe("off");
        // The nose (front light bar) is at +Z: ahead of the chassis in the direction of travel.
        const nose = vehicle.truck.frontBar.getWorldPosition(new THREE.Vector3());
        const tail = vehicle.truck.rearBar.getWorldPosition(new THREE.Vector3());
        expect(nose.z).toBeGreaterThan(vehicle.position.z);
        expect(tail.z).toBeLessThan(vehicle.position.z);
    });

    it("visual wheels sit on the physics wheels at rest (connection point − suspension length)", () => {
        const { vehicle, run } = makeVehicle();
        run(180);
        const c = vehicle.controller;
        WHEEL_NAMES.forEach((name, i) => {
            const w = vehicle.chassis.getObjectByName(name)!;
            const p = c.wheelChassisConnectionPointCs(i)!;
            const len = c.wheelSuspensionLength(i)!;
            expect(w.position.x).toBeCloseTo(p.x, 6);
            expect(w.position.z).toBeCloseTo(p.z, 6);
            expect(Math.abs(w.position.y - (p.y - len))).toBeLessThan(0.03);
            expect(c.wheelRadius(i)).toBeCloseTo(V.wheelRadius, 6);
        });
    });

    it("reverses with negative speed, the reverse light and backward wheel spin", () => {
        const { vehicle, run } = makeVehicle();
        run(30);
        run(90, throttle(-1));
        expect(vehicle.speed).toBeLessThan(-1);
        expect(vehicle.body.linvel().z).toBeLessThan(0);
        expect(vehicle.light).toBe("reverse");
        const wheel = vehicle.chassis.getObjectByName("wheel-back-left")!;
        const before = wheel.rotation.x;
        run(1, throttle(-1));
        expect(angleDelta(before, wheel.rotation.x)).toBeLessThan(0);
        // …and forward spin is positive.
        const fwd = makeVehicle();
        fwd.run(30);
        fwd.run(60, throttle(1));
        const w2 = fwd.vehicle.chassis.getObjectByName("wheel-back-left")!;
        const b2 = w2.rotation.x;
        fwd.run(1, throttle(1));
        expect(angleDelta(b2, w2.rotation.x)).toBeGreaterThan(0);
    });

    it("shows the brake light when throttling against the motion", () => {
        const { vehicle, run } = makeVehicle();
        run(30);
        run(90, throttle(1));
        run(2, throttle(-1));
        expect(vehicle.light).toBe("brake");
    });

    it("steers the front wheels only, about Y first (YXZ, no wobble), and turns right on +steer", () => {
        const { vehicle, run } = makeVehicle();
        run(30);
        run(60, throttle(1));
        run(60, throttle(1, { steer: 1 }));
        const fl = vehicle.chassis.getObjectByName("wheel-front-left")!;
        const rl = vehicle.chassis.getObjectByName("wheel-back-left")!;
        expect(fl.rotation.order).toBe("YXZ");
        expect(fl.rotation.y).toBeLessThan(0);
        expect(fl.rotation.z).toBe(0);
        expect(rl.rotation.y).toBe(0);
        // Facing +Z, the car's right is −X: the heading swings toward −X.
        expect(vehicle.yaw).toBeLessThan(-0.1);
    });

    it("never casts a real shadow; the blob follows x/z/yaw at y 0.10", () => {
        const { vehicle, run } = makeVehicle({ x: 5, z: -7, yaw: 0.8 });
        run(60);
        vehicle.chassis.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) expect(o.castShadow).toBe(false);
        });
        expect(vehicle.blob.position.x).toBeCloseTo(vehicle.position.x, 6);
        expect(vehicle.blob.position.z).toBeCloseTo(vehicle.position.z, 6);
        expect(vehicle.blob.position.y).toBe(LAYERS.blob.y);
        expect(angleDelta(vehicle.blob.rotation.y, 0.8)).toBeCloseTo(0, 2);
        expect((vehicle.blob.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(CONFIG.shadow.blob.car.opacity, 2);
        expect(vehicle.blob.castShadow).toBe(false);
        expect(vehicle.headlight.castShadow).toBe(false);
    });

    it("builds the procedural Cybertruck (any legacy model dep is ignored)", () => {
        const w = makeWorld();
        const legacy = new THREE.Group();
        legacy.name = "car-model";
        const vehicle = new Vehicle({ physics: w.physics, materials, disposal: new Disposal(), model: legacy });
        expect(vehicle.chassis.getObjectByName("cybertruck")).toBe(vehicle.truck.root);
        expect(vehicle.chassis.getObjectByName("car-model")).toBeUndefined();
        expect(hexOf(vehicle.truck.body)).toBe(TRUCK_COLORS.body.toUpperCase());
        for (const name of WHEEL_NAMES) expect(vehicle.chassis.getObjectByName(name)).toBeTruthy();
    });

    it("rear light bar: dim by default, bright red braking, warm white reversing", () => {
        const { vehicle, run } = makeVehicle();
        const bar = vehicle.truck.rearBar;
        run(30);
        expect(vehicle.light).toBe("off");
        expect(bar.visible).toBe(true);
        expect(hexOf(bar)).toBe(TRUCK_COLORS.rearDim.toUpperCase());
        run(5, throttle(0, { handbrake: true }));
        expect(vehicle.light).toBe("brake");
        expect(hexOf(bar)).toBe(PALETTE.brake.toUpperCase());
        run(5);
        run(90, throttle(-1));
        expect(vehicle.light).toBe("reverse");
        expect(hexOf(bar)).toBe(PALETTE.carLight.toUpperCase());
        run(1, throttle(0));
        expect(hexOf(bar)).toBe(TRUCK_COLORS.rearDim.toUpperCase());
    });

    it("headlight: a shadowless SpotLight off and hidden by day, full at night, aimed ahead of the nose", () => {
        const { vehicle, run } = makeVehicle({ x: 3, z: 4, yaw: 0 });
        const h = vehicle.headlight;
        expect(h).toBeInstanceOf(THREE.SpotLight);
        expect(h.parent).toBe(vehicle.chassis);
        expect(h.target.parent).toBe(vehicle.chassis);
        expect(h.castShadow).toBe(false);
        expect(h.angle).toBe(HEADLIGHT.angle);
        expect(h.penumbra).toBe(HEADLIGHT.penumbra);
        expect(h.distance).toBe(HEADLIGHT.distance);
        expect("#" + h.color.getHexString().toUpperCase()).toBe(HEADLIGHT.color.toUpperCase());
        // Day by default.
        expect(h.intensity).toBe(0);
        expect(h.visible).toBe(false);
        vehicle.setNightFactor(1);
        expect(h.intensity).toBe(HEADLIGHT.intensity);
        expect(h.visible).toBe(true);
        expect(vehicle.nightFactor).toBe(1);
        vehicle.setNightFactor(0.25);
        expect(h.intensity).toBeCloseTo(HEADLIGHT.intensity * 0.25, 9);
        expect(h.visible).toBe(true);
        vehicle.setNightFactor(0);
        expect(h.intensity).toBe(0);
        expect(h.visible).toBe(false);
        vehicle.setNightFactor(2);
        expect(vehicle.nightFactor).toBe(1);
        // From the front light bar, pointing forward and down to the ground ahead.
        run(30);
        vehicle.chassis.updateMatrixWorld(true);
        const from = h.getWorldPosition(new THREE.Vector3());
        const to = h.target.getWorldPosition(new THREE.Vector3());
        expect(from.distanceTo(vehicle.truck.frontBar.getWorldPosition(new THREE.Vector3()))).toBeLessThan(0.05);
        expect(to.z).toBeGreaterThan(from.z + HEADLIGHT.ahead * 0.9);
        expect(to.y).toBeLessThan(from.y);
        expect(to.y).toBeCloseTo(0, 1);
    });

    it("dispose removes the root and frees the truck geometries", () => {
        const { vehicle, disposal } = makeVehicle();
        const scene = new THREE.Scene();
        scene.add(vehicle.root);
        let freed = false;
        vehicle.truck.body.geometry.addEventListener("dispose", () => (freed = true));
        vehicle.dispose();
        expect(vehicle.root.parent).toBeNull();
        disposal.dispose();
        expect(freed).toBe(true);
    });

    it("auto-flips after 1.5 s upside down: yaw kept, lifted 1.5, snapped", () => {
        const { vehicle, snaps } = makeVehicle({ x: 0, z: 0, yaw: 0.6 });
        const q = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6)
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
        vehicle.body.setRotation(q, true);
        const y0 = vehicle.body.translation().y;
        const snapsBefore = snaps.length;
        vehicle.syncVisual(0.75);
        expect(upY(vehicle.body.rotation())).toBeLessThan(0);
        vehicle.syncVisual(0.75);
        expect(upY(vehicle.body.rotation())).toBeCloseTo(1, 6);
        expect(angleDelta(yawFromQuaternion(vehicle.body.rotation()), 0.6)).toBeCloseTo(0, 6);
        expect(vehicle.body.translation().y).toBeCloseTo(y0 + V.autoFlip.lift, 6);
        expect(snaps.length).toBe(snapsBefore + 1);
    });

    it("R respawns at the nearest area's arrival point and notifies listeners", () => {
        const { vehicle, snaps } = makeVehicle();
        let got: string | null = null;
        vehicle.onTeleport((id) => (got = id));
        vehicle.teleport(90, -40, 0);
        vehicle.respawn();
        const a = AREA_BY_ID.projects.arrival;
        const t = vehicle.body.translation();
        expect(t.x).toBeCloseTo(a.x, 6);
        expect(t.z).toBeCloseTo(a.z, 6);
        expect(angleDelta(vehicle.yaw, a.yaw)).toBeCloseTo(0, 6);
        expect(got).toBe("projects");
        expect(snaps.length).toBeGreaterThanOrEqual(2);
    });

    it("respawns when it falls below respawnBelowY", () => {
        const { vehicle } = makeVehicle();
        vehicle.body.setTranslation({ x: 0, y: V.respawnBelowY - 1, z: -190 }, true);
        vehicle.syncVisual(H);
        expect(vehicle.body.translation().y).toBeGreaterThan(0);
    });

    it("dropIn starts spawnDrop above rest at the spawn", () => {
        const { vehicle } = makeVehicle();
        vehicle.dropIn();
        expect(vehicle.body.translation().y).toBeCloseTo(REST_HEIGHT + V.spawnDrop, 6);
    });
});
