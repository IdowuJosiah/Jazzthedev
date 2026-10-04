import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, PALETTE } from "./Config";
import type { Physics } from "./Physics";
import type { Disposal } from "./utils/disposal";
import { clamp, damp } from "./utils/math";

export interface VehicleInput {
    throttle: number; // -1..1
    steer: number; // -1..1
    handbrake: boolean;
    boost: boolean;
}

/** Wheel connection points in chassis-local space (y near the chassis floor). */
const V = CONFIG.vehicle;

export class Vehicle {
    group = new THREE.Group();
    private body!: RAPIER.RigidBody;
    private controller!: RAPIER.DynamicRayCastVehicleController;
    private wheelMeshes: THREE.Object3D[] = [];
    private steer = 0;
    private spawn: THREE.Vector3;
    private spawnYaw: number;

    // scratch
    private _pos = new THREE.Vector3();
    private _fwd = new THREE.Vector3();
    private _quat = new THREE.Quaternion();
    private _m = new THREE.Matrix4();
    speed = 0; // signed units/s
    driftAmount = 0; // 0..1, for tire tracks / fx

    constructor(
        private physics: Physics,
        private disposal: Disposal,
        spawn: THREE.Vector3,
        spawnYaw: number
    ) {
        this.spawn = spawn.clone();
        this.spawnYaw = spawnYaw;
        this.buildBody();
        this.buildMesh();
    }

    private buildBody() {
        const { body, controller } = this.physics.createVehicle({
            x: this.spawn.x,
            y: this.spawn.y,
            z: this.spawn.z,
        });
        this.body = body;
        this.controller = controller;
        const q = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            this.spawnYaw
        );
        body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);

        const down = { x: 0, y: -1, z: 0 };
        const axle = { x: -1, y: 0, z: 0 };
        const cy = -0.05;
        const cx = V.chassisHalf.x;
        const cz = V.chassisHalf.z - 0.5;
        // 0 FL, 1 FR, 2 RL, 3 RR
        const points = [
            { x: cx, y: cy, z: cz },
            { x: -cx, y: cy, z: cz },
            { x: cx, y: cy, z: -cz },
            { x: -cx, y: cy, z: -cz },
        ];
        for (const p of points) {
            controller.addWheel(p, down, axle, V.suspensionRest, V.wheelRadius);
        }
        for (let i = 0; i < 4; i++) {
            controller.setWheelSuspensionStiffness(i, V.suspensionStiffness);
            controller.setWheelMaxSuspensionTravel(i, V.suspensionTravel);
            controller.setWheelSuspensionCompression(i, V.suspensionDamping);
            controller.setWheelSuspensionRelaxation(i, V.suspensionDamping);
            controller.setWheelFrictionSlip(i, V.grip);
        }
    }

    private buildMesh() {
        const d = this.disposal;
        const accent = PALETTE.neonCyan;

        // Low-poly wedge body (Cybertruck-ish night cruiser).
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x20232e,
            metalness: 0.6,
            roughness: 0.35,
        });
        d.track(bodyMat);
        const shape = new THREE.Shape();
        const L = V.chassisHalf.z;
        shape.moveTo(-L, 0);
        shape.lineTo(L * 0.72, 0);
        shape.lineTo(L, 0.42);
        shape.lineTo(L * 0.1, 0.58);
        shape.lineTo(-L * 0.55, 0.62);
        shape.lineTo(-L, 0.34);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: V.chassisHalf.x * 2,
            bevelEnabled: true,
            bevelThickness: 0.06,
            bevelSize: 0.06,
            bevelSegments: 1,
        });
        geo.rotateY(Math.PI / 2);
        geo.translate(0, -0.1, V.chassisHalf.x);
        d.track(geo);
        const bodyMesh = new THREE.Mesh(geo, bodyMat);
        bodyMesh.castShadow = true;
        this.group.add(bodyMesh);

        // Glass greenhouse
        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x10151f,
            metalness: 0.9,
            roughness: 0.1,
            transparent: true,
            opacity: 0.8,
        });
        d.track(glassMat);
        const glassGeo = new THREE.BoxGeometry(V.chassisHalf.x * 1.7, 0.34, 1.7);
        d.track(glassGeo);
        const glass = new THREE.Mesh(glassGeo, glassMat);
        glass.position.set(0, 0.52, 0.1);
        this.group.add(glass);

        // Neon light bars (front amber, rear pink) + underglow
        const mkBar = (color: number, z: number) => {
            const m = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 2.4,
                roughness: 0.4,
            });
            d.track(m);
            const g = new THREE.BoxGeometry(V.chassisHalf.x * 1.5, 0.08, 0.08);
            d.track(g);
            const bar = new THREE.Mesh(g, m);
            bar.position.set(0, 0.2, z);
            this.group.add(bar);
        };
        mkBar(PALETTE.neonAmber, V.chassisHalf.z - 0.05);
        mkBar(PALETTE.neonPink, -V.chassisHalf.z + 0.05);

        const glowMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5 });
        d.track(glowMat);
        const glowGeo = new THREE.PlaneGeometry(V.chassisHalf.x * 2.1, V.chassisHalf.z * 2.1);
        d.track(glowGeo);
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -0.26;
        this.group.add(glow);

        const headlight = new THREE.PointLight(PALETTE.neonAmber, 6, 40, 2);
        headlight.position.set(0, 0.3, V.chassisHalf.z);
        this.group.add(headlight);

        // Wheels
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0b10, roughness: 0.8 });
        d.track(wheelMat);
        const rimMat = new THREE.MeshStandardMaterial({
            color: accent,
            emissive: accent,
            emissiveIntensity: 1.1,
            roughness: 0.4,
        });
        d.track(rimMat);
        const wGeo = new THREE.CylinderGeometry(V.wheelRadius, V.wheelRadius, 0.34, 18);
        wGeo.rotateZ(Math.PI / 2);
        d.track(wGeo);
        const rimGeo = new THREE.CylinderGeometry(V.wheelRadius * 0.5, V.wheelRadius * 0.5, 0.36, 12);
        rimGeo.rotateZ(Math.PI / 2);
        d.track(rimGeo);
        for (let i = 0; i < 4; i++) {
            const w = new THREE.Group();
            const tire = new THREE.Mesh(wGeo, wheelMat);
            tire.castShadow = true;
            const rim = new THREE.Mesh(rimGeo, rimMat);
            w.add(tire, rim);
            this.group.add(w);
            this.wheelMeshes.push(w);
        }
    }

    get position() {
        const t = this.body.translation();
        return this._pos.set(t.x, t.y, t.z);
    }

    get forward() {
        const r = this.body.rotation();
        this._quat.set(r.x, r.y, r.z, r.w);
        return this._fwd.set(0, 0, 1).applyQuaternion(this._quat).setY(0).normalize();
    }

    get quaternion() {
        const r = this.body.rotation();
        return this._quat.set(r.x, r.y, r.z, r.w);
    }

    respawn() {
        this.body.setTranslation(
            { x: this.spawn.x, y: this.spawn.y + 1, z: this.spawn.z },
            true
        );
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spawnYaw);
        this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    teleport(pos: THREE.Vector3, yaw: number) {
        this.body.setTranslation({ x: pos.x, y: pos.y + 1.2, z: pos.z }, true);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    /** Apply inputs to the controller. Call BEFORE physics.step(). */
    control(dt: number, input: VehicleInput) {
        // Steering (front wheels), smoothed.
        const targetSteer = -input.steer * V.steerMax;
        const lambda = Math.abs(input.steer) > 0.01 ? V.steerSpeed : V.steerReturn;
        this.steer = damp(this.steer, targetSteer, lambda, dt);
        this.controller.setWheelSteering(0, this.steer);
        this.controller.setWheelSteering(1, this.steer);

        // Engine + brake
        const spd = this.controller.currentVehicleSpeed();
        this.speed = spd;
        const boost = input.boost ? V.boostMultiplier : 1;
        const overMax = Math.abs(spd) > V.maxSpeed * boost;
        let engine = 0;
        if (input.throttle > 0.01) engine = overMax ? 0 : input.throttle * V.enginePower * boost;
        else if (input.throttle < -0.01) engine = input.throttle * V.reversePower;
        const engineForce = engine * 60; // scale to Newtons-ish
        for (let i = 0; i < 4; i++) this.controller.setWheelEngineForce(i, engineForce);

        // Brake: handbrake on rear + brake when throttle opposes motion.
        let brake = 0;
        if (input.handbrake) brake = V.brakePower;
        else if (input.throttle < -0.01 && spd > 1) brake = V.brakePower * 0.8;
        this.controller.setWheelBrake(0, brake);
        this.controller.setWheelBrake(1, brake);
        this.controller.setWheelBrake(2, brake * (input.handbrake ? 1.4 : 1));
        this.controller.setWheelBrake(3, brake * (input.handbrake ? 1.4 : 1));

        // Drift: drop rear grip on handbrake for slides.
        const rearGrip = input.handbrake ? V.grip * V.drift * 0.5 : V.grip;
        this.controller.setWheelFrictionSlip(2, rearGrip);
        this.controller.setWheelFrictionSlip(3, rearGrip);

        this.controller.updateVehicle(dt);
    }

    /** Read integrated transforms into the meshes. Call AFTER physics.step(). */
    sync() {
        // Drift metric from lateral velocity.
        const lv = this.body.linvel();
        const vel = new THREE.Vector3(lv.x, 0, lv.z);
        if (vel.length() > 2) {
            const lateral = Math.abs(vel.clone().normalize().dot(this.rightVector()));
            this.driftAmount = clamp(lateral * 1.4, 0, 1);
        } else this.driftAmount = 0;

        this.syncMeshes();

        const t = this.body.translation();
        if (t.y < V.respawnBelowY) this.respawn();
    }

    private rightVector() {
        const r = this.body.rotation();
        return new THREE.Vector3(1, 0, 0).applyQuaternion(this._quat.set(r.x, r.y, r.z, r.w));
    }

    private syncMeshes() {
        const t = this.body.translation();
        const r = this.body.rotation();
        this.group.position.set(t.x, t.y, t.z);
        this.group.quaternion.set(r.x, r.y, r.z, r.w);

        for (let i = 0; i < 4; i++) {
            const mesh = this.wheelMeshes[i];
            const conn = this.controller.wheelChassisConnectionPointCs(i);
            const susp = this.controller.wheelSuspensionLength(i) ?? V.suspensionRest;
            const steer = this.controller.wheelSteering(i) ?? 0;
            const rot = this.controller.wheelRotation(i) ?? 0;
            if (conn) {
                mesh.position.set(conn.x, conn.y - susp, conn.z);
            }
            // local wheel orientation: steer around Y, spin around X (axle)
            this._m.makeRotationY(steer);
            mesh.setRotationFromMatrix(this._m);
            mesh.rotateX(rot);
        }
    }
}
