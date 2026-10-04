import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG } from "./Config";

/**
 * Thin wrapper over Rapier. Owns the physics world, a fixed-step accumulator,
 * and factories for the colliders/bodies the world needs. Rapier's compat
 * build ships the WASM inline, so there's nothing extra to serve.
 */
export class Physics {
    world!: RAPIER.World;
    private acc = 0;
    private static ready = false;

    static async load() {
        if (!Physics.ready) {
            await RAPIER.init();
            Physics.ready = true;
        }
    }

    init() {
        this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
        this.world.timestep = CONFIG.physics.fixedStep;
    }

    /** Advance with a fixed timestep accumulator for stable simulation. */
    step(dt: number) {
        this.acc += dt;
        const step = CONFIG.physics.fixedStep;
        let n = 0;
        while (this.acc >= step && n < CONFIG.physics.maxSubSteps) {
            this.world.step();
            this.acc -= step;
            n++;
        }
        // drop leftover time if we hit the sub-step ceiling (avoids spiral of death)
        if (n === CONFIG.physics.maxSubSteps) this.acc = 0;
    }

    // ── Terrain ──────────────────────────────────────────────────────────
    /**
     * Static trimesh collider built straight from the visual terrain geometry,
     * so physics and render meshes can never drift apart. `vertices` is a flat
     * xyz Float32Array, `indices` a Uint32Array of triangles.
     */
    addStaticTrimesh(vertices: Float32Array, indices: Uint32Array) {
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
            .setFriction(1.0)
            .setRestitution(0.05);
        this.world.createCollider(desc, body);
        return body;
    }

    addFixedCuboid(
        half: { x: number; y: number; z: number },
        pos: { x: number; y: number; z: number },
        friction = 0.9,
        restitution = 0.2
    ) {
        const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
        );
        const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
            .setFriction(friction)
            .setRestitution(restitution);
        this.world.createCollider(desc, body);
        return body;
    }

    addFixedCuboidRot(
        half: { x: number; y: number; z: number },
        pos: { x: number; y: number; z: number },
        quat: { x: number; y: number; z: number; w: number },
        friction = 0.9
    ) {
        const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed()
                .setTranslation(pos.x, pos.y, pos.z)
                .setRotation(quat)
        );
        this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(friction),
            body
        );
        return body;
    }

    addDynamicBox(
        half: { x: number; y: number; z: number },
        pos: { x: number; y: number; z: number },
        mass = 5,
        restitution = 0.3
    ) {
        const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(pos.x, pos.y, pos.z)
                .setLinearDamping(0.4)
                .setAngularDamping(0.5)
        );
        const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
            .setMass(mass)
            .setFriction(0.7)
            .setRestitution(restitution);
        this.world.createCollider(desc, body);
        return body;
    }

    addDynamicBall(radius: number, pos: { x: number; y: number; z: number }, mass = 2) {
        const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(pos.x, pos.y, pos.z)
                .setLinearDamping(0.3)
                .setAngularDamping(0.3)
        );
        const desc = RAPIER.ColliderDesc.ball(radius)
            .setMass(mass)
            .setFriction(0.6)
            .setRestitution(0.6);
        this.world.createCollider(desc, body);
        return body;
    }

    /** Create a dynamic chassis body + Rapier raycast vehicle controller. */
    createVehicle(pos: { x: number; y: number; z: number }) {
        const half = CONFIG.vehicle.chassisHalf;
        const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(pos.x, pos.y, pos.z)
                .setLinearDamping(0.12)
                .setAngularDamping(0.6)
                .setCanSleep(false)
        );
        const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
            .setMass(CONFIG.vehicle.mass)
            .setFriction(0.8)
            .setRestitution(0.1);
        this.world.createCollider(col, body);
        const controller = this.world.createVehicleController(body);
        return { body, controller };
    }

    /** Downward ray to find ground height at (x,z). Returns y or null. */
    groundAt(x: number, z: number, from = 200): number | null {
        const ray = new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 });
        const hit = this.world.castRay(ray, from + 50, true);
        if (hit) return from - hit.timeOfImpact;
        return null;
    }

    dispose() {
        this.world?.free();
    }
}
