import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, PALETTE } from "./Config";
import { AREA_BY_ID } from "./Layout";
import type { MaterialsApi, PhysicsApi } from "./types";
import { Disposal } from "./utils/disposal";
import { angleDelta } from "./utils/math";
import { LAYERS } from "./utils/shapes";
import {
    blobOpacity,
    driveCommand,
    FlipTimer,
    NEUTRAL_INPUT,
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

function makeVehicle(model: THREE.Object3D | null = null, spawn = { x: 0, z: 0, yaw: 0 }) {
    const w = makeWorld();
    const vehicle = new Vehicle({ physics: w.physics, materials, disposal: new Disposal(), model }, spawn);
    const run = (steps: number, input: VehicleInput = NEUTRAL_INPUT) => {
        for (let i = 0; i < steps; i++) {
            vehicle.control(H, input);
            w.world.step();
            w.physics.interpolate(1);
            vehicle.syncVisual(H);
        }
    };
    return { ...w, vehicle, run };
}

/** A stand-in for the Kenney car: a body box and four named wheel meshes (front at +Z, left at +X). */
function fakeCarModel(): THREE.Object3D {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 2.66), new THREE.MeshLambertMaterial());
    body.name = "body";
    body.position.y = 0.5;
    body.castShadow = true;
    root.add(body);
    const spots: [string, number, number][] = [
        ["wheel-front-left", 0.3, 0.59],
        ["wheel-front-right", -0.3, 0.59],
        ["wheel-back-left", 0.3, -0.93],
        ["wheel-back-right", -0.3, -0.93],
    ];
    for (const [name, x, z] of spots) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial());
        w.name = name;
        w.position.set(x, 0.3, z);
        w.castShadow = true;
        root.add(w);
    }
    return root;
}

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

    it("drives nose-first: throttle moves it along its +Z forward with positive speed", () => {
        const { vehicle, run } = makeVehicle(fakeCarModel());
        run(30);
        run(90, throttle(1));
        expect(vehicle.speed).toBeGreaterThan(3);
        expect(vehicle.body.linvel().z).toBeGreaterThan(3);
        expect(vehicle.light).toBe("off");
    });

    it("reverses with negative speed, the reverse light and backward wheel spin", () => {
        const { vehicle, run } = makeVehicle(fakeCarModel());
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
        const fwd = makeVehicle(fakeCarModel());
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
        const { vehicle, run } = makeVehicle(fakeCarModel());
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
        const { vehicle, run } = makeVehicle(fakeCarModel(), { x: 5, z: -7, yaw: 0.8 });
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
    });

    it("uses the GLB without flipping it, and falls back to a procedural body", () => {
        const model = fakeCarModel();
        const a = makeVehicle(model).vehicle;
        expect(model.rotation.y).toBe(0);
        expect(a.chassis.getObjectByName("car-model")).toBeTruthy();
        const b = makeVehicle(null).vehicle;
        expect(b.chassis.getObjectByName("car-model")).toBeUndefined();
        let meshes = 0;
        b.chassis.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) meshes++;
        });
        expect(meshes).toBeGreaterThan(4);
        const noWheels = new THREE.Group();
        noWheels.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 2)));
        expect(makeVehicle(noWheels).vehicle.chassis.getObjectByName("car-model")).toBeUndefined();
    });

    it("brake lamps sit on ink backings at the rear and switch material", () => {
        const { vehicle, run } = makeVehicle(fakeCarModel());
        const lamps: THREE.Mesh[] = [];
        vehicle.chassis.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh && m.material instanceof THREE.MeshBasicMaterial) lamps.push(m);
        });
        expect(lamps).toHaveLength(2);
        for (const l of lamps) expect(l.position.z).toBeLessThan(-V.chassisHalf.z * 0.9);
        run(30);
        expect(lamps.every((l) => !l.visible)).toBe(true);
        run(5, throttle(0, { handbrake: true }));
        expect(lamps.every((l) => l.visible)).toBe(true);
        expect((lamps[0].material as THREE.MeshBasicMaterial).color.getHexString()).toBe(PALETTE.brake.slice(1).toLowerCase());
    });

    it("auto-flips after 1.5 s upside down: yaw kept, lifted 1.5, snapped", () => {
        const { vehicle, snaps } = makeVehicle(null, { x: 0, z: 0, yaw: 0.6 });
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
