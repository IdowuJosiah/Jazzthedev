import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { CONFIG, type Vec3Like } from "./Config";
import type { ImpactKind, PhysicsApi, QuatLike } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Physics (§4.4). A thin wrapper over Rapier's compat build (WASM inline):
//
// - fixed-step accumulator (1/60, ≤ 4 substeps) that returns the render alpha;
//   `beforeEachStep(h)` runs once per substep (vehicle control lives there);
// - a link registry of body → Object3D with prev/curr pos + quat, so every
//   dynamic body is DRAWN interpolated between the last two physics states
//   (no 60-on-120 Hz judder, §3.4 item 6);
// - fixed collider factories (cuboid / cylinder / convex hull / ground / wall)
//   and the dynamic helpers Wave 2 needs (box, ball, cylinder, letter);
// - contact-force impact events for dynamic props (threshold mass × 40), with
//   resting contacts filtered out (a stacked wall's bottom rows carry several
//   bricks' weight, which is above one brick's threshold).
//
// The car's chassis body and raycast controller are owned by Vehicle.ts (one
// implementation of the chassis tuning; §4.2 fix 1 lives there).
//
// Each substep: beforeEachStep(h) → snapshot prev (+ which props are moving) →
// world.step(queue) → store curr → drain contact-force events. Linked objects
// are written in WORLD space (converted into the parent's frame when the parent
// is not the identity).
// ─────────────────────────────────────────────────────────────────────────

// Surface, dynamic-default and impact-filter tunables live in CONFIG.physics.
const PH = CONFIG.physics;
/** Accumulator slack: a 120 Hz frame pair (2 × 1/120) must count as one 1/60 step. */
const STEP_EPSILON = 1e-9;
/** Smallest half-extent of a bbox fallback cuboid (flat / degenerate hulls). */
const MIN_HALF_EXTENT = 0.01;

const ZERO: Vec3Like = Object.freeze({ x: 0, y: 0, z: 0 });
const IDENTITY_QUAT: QuatLike = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const IDENTITY_MATRIX = new THREE.Matrix4();

/** Options shared by every dynamic body helper. */
export interface DynamicBodyOptions {
    mass: number;
    friction?: number;
    restitution?: number;
    linearDamping?: number;
    angularDamping?: number;
    quat?: QuatLike;
    /** Collider offset from the body origin (letters: the bbox centre's y). */
    offset?: Vec3Like;
    /**
     * Impact-sound family. Enables CONTACT_FORCE_EVENTS with a threshold of
     * mass × CONFIG.physics.contactForcePerMass. `null` = silent body.
     */
    impact?: ImpactKind | null;
    canSleep?: boolean;
    /** Continuous collision detection (fast, small bodies). */
    ccd?: boolean;
}

interface Link {
    body: RAPIER.RigidBody;
    obj: THREE.Object3D;
    prevPos: THREE.Vector3;
    prevQuat: THREE.Quaternion;
    currPos: THREE.Vector3;
    currQuat: THREE.Quaternion;
}

interface ImpactSource {
    kind: ImpactKind;
    mass: number;
    threshold: number;
    body: RAPIER.RigidBody;
    /** Whether the body was moving at the start of the current substep. */
    movingBefore: boolean;
}

type ImpactCb = (kind: ImpactKind, force: number) => void;

let rapierReady: Promise<void> | null = null;

/** Initialises Rapier's WASM once per page (safe to call repeatedly). */
export function loadRapier(): Promise<void> {
    if (!rapierReady) {
        rapierReady = RAPIER.init().catch((err: unknown) => {
            rapierReady = null; // allow the one retry the loader does (§6.2)
            throw err;
        });
    }
    return rapierReady;
}

export class Physics implements PhysicsApi {
    readonly world: RAPIER.World;
    private readonly events: RAPIER.EventQueue;
    private acc = 0;
    private links = new Map<number, Link>();
    private impactSources = new Map<number, ImpactSource>();
    private impactCbs = new Set<ImpactCb>();
    private disposed = false;

    // scratch
    private readonly tmpPos = new THREE.Vector3();
    private readonly tmpQuat = new THREE.Quaternion();
    private readonly tmpInv = new THREE.Matrix4();
    private readonly tmpParentPos = new THREE.Vector3();
    private readonly tmpParentQuat = new THREE.Quaternion();
    private readonly tmpParentScale = new THREE.Vector3();

    /** Loads Rapier (once) and creates the world. */
    static async create(): Promise<Physics> {
        await loadRapier();
        return new Physics();
    }

    /** Requires `loadRapier()` to have resolved; prefer `Physics.create()`. */
    constructor() {
        this.world = new RAPIER.World({ x: 0, y: PH.gravity, z: 0 });
        this.world.timestep = PH.fixedStep;
        this.events = new RAPIER.EventQueue(true);
    }

    // ── Stepping and interpolation ───────────────────────────────────────
    /**
     * Fixed-step accumulator. Runs up to `maxSubSteps` substeps of `fixedStep`;
     * when time is still owed after the last allowed substep the remainder is
     * dropped (`acc %= h`), so the returned alpha always lies in [0, 1).
     */
    step(dt: number, beforeEachStep: (h: number) => void): number {
        if (this.disposed) return 0;
        const h = PH.fixedStep;
        this.acc += Number.isFinite(dt) && dt > 0 ? dt : 0;
        let n = 0;
        while (this.acc >= h - STEP_EPSILON && n < PH.maxSubSteps) {
            beforeEachStep(h);
            this.snapshot("prev");
            this.markMovingBefore();
            this.world.step(this.events);
            this.snapshot("curr");
            this.drainImpacts();
            this.acc -= h;
            n++;
        }
        if (this.acc >= h - STEP_EPSILON) {
            // Spiral-of-death guard: drop the owed time, keep the sub-step phase.
            this.acc %= h;
            if (this.acc >= h - STEP_EPSILON) this.acc = 0;
        }
        if (this.acc < 0) this.acc = 0;
        return this.alpha;
    }

    /** Current render alpha in [0, 1): fraction of a step owed by the accumulator. */
    get alpha(): number {
        return Math.min(Math.max(this.acc / PH.fixedStep, 0), 1 - Number.EPSILON);
    }

    /** Registers body → object; both snapshots start at the body's current pose. */
    link(body: RAPIER.RigidBody, obj: THREE.Object3D): void {
        const t = body.translation();
        const r = body.rotation();
        const l: Link = {
            body,
            obj,
            prevPos: new THREE.Vector3(t.x, t.y, t.z),
            prevQuat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
            currPos: new THREE.Vector3(t.x, t.y, t.z),
            currQuat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
        };
        this.links.set(body.handle, l);
        this.write(l, 1);
    }

    unlink(body: RAPIER.RigidBody): void {
        this.links.delete(body.handle);
    }

    /** obj = lerp/slerp(prev, curr, alpha) for every linked body. */
    interpolate(alpha: number): void {
        const a = Math.min(Math.max(alpha, 0), 1);
        for (const l of this.links.values()) this.write(l, a);
    }

    /** prev = curr = the body's pose now (teleport / respawn / reset / flip / travel). */
    snap(body: RAPIER.RigidBody): void {
        const l = this.links.get(body.handle);
        if (!l) return;
        this.read(l.body, l.currPos, l.currQuat);
        l.prevPos.copy(l.currPos);
        l.prevQuat.copy(l.currQuat);
        this.write(l, 1);
    }

    // ── Fixed colliders ──────────────────────────────────────────────────
    addFixedCuboid(halfExtents: Vec3Like, pos: Vec3Like, quat?: QuatLike, offset?: Vec3Like): RAPIER.RigidBody {
        const body = this.fixedBody(pos, quat);
        const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
            .setTranslation(offset?.x ?? 0, offset?.y ?? 0, offset?.z ?? 0)
            .setFriction(PH.colliders.fixed.friction)
            .setRestitution(PH.colliders.fixed.restitution);
        this.world.createCollider(desc, body);
        return body;
    }

    /** Upright (Y-axis) cylinder; `pos` is its centre. */
    addFixedCylinder(halfHeight: number, radius: number, pos: Vec3Like): RAPIER.RigidBody {
        const body = this.fixedBody(pos);
        const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
            .setFriction(PH.colliders.fixed.friction)
            .setRestitution(PH.colliders.fixed.restitution);
        this.world.createCollider(desc, body);
        return body;
    }

    /**
     * Convex hull of `points` (flat xyz, body-local). If Rapier cannot build the
     * hull (`convexHull` returns null, or the points are degenerate and the
     * collider build rejects them) it falls back to the points' bbox cuboid and
     * logs a warning, so a bad prop never leaves a hole in the world.
     */
    addFixedConvexHull(points: Float32Array, pos: Vec3Like, quat: QuatLike): RAPIER.RigidBody {
        const body = this.fixedBody(pos, quat);
        let built = false;
        try {
            const desc = RAPIER.ColliderDesc.convexHull(points);
            if (desc) {
                const F = PH.colliders.fixed;
                this.world.createCollider(desc.setFriction(F.friction).setRestitution(F.restitution), body);
                built = true;
            }
        } catch {
            built = false;
        }
        if (!built) {
            const box = bboxOf(points);
            console.warn(
                `[world3/physics] convexHull failed for ${points.length / 3} points; using a bbox cuboid`,
                box
            );
            const desc = RAPIER.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z)
                .setTranslation(box.center.x, box.center.y, box.center.z)
                .setFriction(PH.colliders.fixed.friction)
                .setRestitution(PH.colliders.fixed.restitution);
            this.world.createCollider(desc, body);
        }
        return body;
    }

    /** The flat world's single ground collider (§2.2), top at y = 0. */
    addGroundSlab(): RAPIER.RigidBody {
        const G = CONFIG.world.groundSlab;
        const body = this.fixedBody(G.center);
        const desc = RAPIER.ColliderDesc.cuboid(G.halfExtents.x, G.halfExtents.y, G.halfExtents.z)
            .setFriction(PH.colliders.ground.friction)
            .setRestitution(PH.colliders.ground.restitution);
        this.world.createCollider(desc, body);
        return body;
    }

    /** Invisible wall (bounds, sea wall, jetty rails). */
    addWall(halfExtents: Vec3Like, pos: Vec3Like): RAPIER.RigidBody {
        const body = this.fixedBody(pos);
        const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
            .setFriction(PH.colliders.wall.friction)
            .setRestitution(PH.colliders.wall.restitution);
        this.world.createCollider(desc, body);
        return body;
    }

    // ── Dynamic bodies (Wave 2 helpers) ──────────────────────────────────
    /** Bricks and boxes. Not linked: call `link(body, mesh)` yourself. */
    addDynamicBox(halfExtents: Vec3Like, pos: Vec3Like, opts: DynamicBodyOptions): RAPIER.RigidBody {
        const D = PH.dynamicDefaults.box;
        const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
            .setFriction(opts.friction ?? D.friction)
            .setRestitution(opts.restitution ?? D.restitution);
        return this.dynamicBody(desc, pos, opts, D, D.impact);
    }

    /** Ball (bowling ball). */
    addDynamicBall(radius: number, pos: Vec3Like, opts: DynamicBodyOptions): RAPIER.RigidBody {
        const D = PH.dynamicDefaults.ball;
        const desc = RAPIER.ColliderDesc.ball(radius)
            .setFriction(opts.friction ?? D.friction)
            .setRestitution(opts.restitution ?? D.restitution);
        return this.dynamicBody(desc, pos, opts, D, D.impact);
    }

    /** Upright (Y-axis) cylinder, e.g. bowling pins (r 0.42, mass 8). */
    addDynamicCylinder(halfHeight: number, radius: number, pos: Vec3Like, opts: DynamicBodyOptions): RAPIER.RigidBody {
        const D = PH.dynamicDefaults.cylinder;
        const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
            .setFriction(opts.friction ?? D.friction)
            .setRestitution(opts.restitution ?? D.restitution);
        return this.dynamicBody(desc, pos, opts, D, D.impact);
    }

    /**
     * Dynamic 3D letter (§3.3): the body origin stays at the letter's BASELINE
     * position; the bbox cuboid is offset by the bbox centre (`offset`, usually
     * (0, cy, 0)). Mass / friction / restitution / damping default to
     * CONFIG.physics.dynamicLetter.
     */
    addDynamicLetter(
        halfExtents: Vec3Like,
        pos: Vec3Like,
        opts: Partial<DynamicBodyOptions> & { offset: Vec3Like }
    ): RAPIER.RigidBody {
        const L = PH.dynamicLetter;
        const merged: DynamicBodyOptions = { ...opts, mass: opts.mass ?? L.mass };
        const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
            .setFriction(opts.friction ?? L.friction)
            .setRestitution(opts.restitution ?? L.restitution);
        return this.dynamicBody(desc, pos, merged, L, PH.dynamicDefaults.letter.impact);
    }

    /** Unlinks, forgets impact sources and removes the body (with its colliders). */
    removeBody(body: RAPIER.RigidBody): void {
        if (this.disposed) return;
        this.unlink(body);
        for (let i = 0; i < body.numColliders(); i++) this.impactSources.delete(body.collider(i).handle);
        this.world.removeRigidBody(body);
    }

    // ── Impacts ──────────────────────────────────────────────────────────
    /**
     * Subscribes to prop impacts. `force` is the contact force relative to the
     * prop's threshold (mass × contactForcePerMass), so it is ≥ 1 and scales the
     * same way for a 12.5 kg half brick and a 140 kg ball. Returns unsubscribe.
     */
    onImpact(cb: ImpactCb): () => void {
        this.impactCbs.add(cb);
        return () => {
            this.impactCbs.delete(cb);
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.links.clear();
        this.impactSources.clear();
        this.impactCbs.clear();
        this.events.free();
        this.world.free();
    }

    // ── internals ────────────────────────────────────────────────────────
    private fixedBody(pos: Vec3Like, quat: QuatLike = IDENTITY_QUAT): RAPIER.RigidBody {
        return this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed()
                .setTranslation(pos.x, pos.y, pos.z)
                .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        );
    }

    private dynamicBody(
        desc: RAPIER.ColliderDesc,
        pos: Vec3Like,
        opts: DynamicBodyOptions,
        defaults: { linearDamping: number; angularDamping: number },
        defaultImpact: ImpactKind
    ): RAPIER.RigidBody {
        const q = opts.quat ?? IDENTITY_QUAT;
        const o = opts.offset ?? ZERO;
        const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(pos.x, pos.y, pos.z)
                .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                .setLinearDamping(opts.linearDamping ?? defaults.linearDamping)
                .setAngularDamping(opts.angularDamping ?? defaults.angularDamping)
                .setCanSleep(opts.canSleep ?? true)
                .setCcdEnabled(opts.ccd ?? false)
        );
        desc.setTranslation(o.x, o.y, o.z).setMass(opts.mass);
        const impact = opts.impact === undefined ? defaultImpact : opts.impact;
        const threshold = opts.mass * PH.contactForcePerMass;
        if (impact) {
            desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(threshold);
        }
        const collider = this.world.createCollider(desc, body);
        if (impact) {
            this.impactSources.set(collider.handle, { kind: impact, mass: opts.mass, threshold, body, movingBefore: false });
        }
        return body;
    }

    private snapshot(which: "prev" | "curr"): void {
        for (const l of this.links.values()) {
            if (which === "prev") this.read(l.body, l.prevPos, l.prevQuat);
            else this.read(l.body, l.currPos, l.currQuat);
        }
    }

    private read(body: RAPIER.RigidBody, pos: THREE.Vector3, quat: THREE.Quaternion): void {
        const t = body.translation();
        const r = body.rotation();
        pos.set(t.x, t.y, t.z);
        quat.set(r.x, r.y, r.z, r.w);
    }

    private write(l: Link, alpha: number): void {
        const { obj } = l;
        const pos = this.tmpPos.lerpVectors(l.prevPos, l.currPos, alpha);
        const quat = this.tmpQuat.slerpQuaternions(l.prevQuat, l.currQuat, alpha);
        const parent = obj.parent;
        if (parent) {
            parent.updateWorldMatrix(true, false);
            if (!parent.matrixWorld.equals(IDENTITY_MATRIX)) {
                // World → parent-local, for links whose parent group is offset.
                this.tmpInv.copy(parent.matrixWorld).invert();
                pos.applyMatrix4(this.tmpInv);
                parent.matrixWorld.decompose(this.tmpParentPos, this.tmpParentQuat, this.tmpParentScale);
                quat.premultiply(this.tmpParentQuat.invert());
            }
        }
        obj.position.copy(pos);
        obj.quaternion.copy(quat);
    }

    /** Records, per impact source, whether its body is moving before this substep. */
    private markMovingBefore(): void {
        for (const src of this.impactSources.values()) src.movingBefore = isMoving(src.body);
    }

    private drainImpacts(): void {
        this.events.drainContactForceEvents((e) => {
            if (this.impactCbs.size === 0) return;
            const a = this.impactSources.get(e.collider1());
            const b = this.impactSources.get(e.collider2());
            // The heavier registered prop names the sound (ball into pins → heavy).
            const src = a && b ? (a.mass >= b.mass ? a : b) : (a ?? b);
            if (!src) return;
            // Resting contact (stacked bricks, a pin on the lane): neither prop moved.
            if (!wasOrIsMoving(a) && !wasOrIsMoving(b)) return;
            const force = e.totalForceMagnitude() / src.threshold;
            for (const cb of this.impactCbs) cb(src.kind, force);
        });
    }
}

/** True when a body is awake and above the impact filter's linear or angular speed. */
function isMoving(body: RAPIER.RigidBody): boolean {
    if (body.isSleeping()) return false;
    const v = body.linvel();
    const w = body.angvel();
    const lin2 = v.x * v.x + v.y * v.y + v.z * v.z;
    const ang2 = w.x * w.x + w.y * w.y + w.z * w.z;
    return lin2 >= PH.impact.minLinearSpeed ** 2 || ang2 >= PH.impact.minAngularSpeed ** 2;
}

/** Moving at the start of the substep (landing with no bounce) or after it (struck by the car). */
function wasOrIsMoving(src: ImpactSource | undefined): boolean {
    return !!src && (src.movingBefore || isMoving(src.body));
}

/** Axis-aligned bbox of flat xyz points (half-extents ≥ MIN_HALF_EXTENT). */
export function bboxOf(points: Float32Array): { center: Vec3Like; half: Vec3Like } {
    if (points.length < 3) {
        return { center: ZERO, half: { x: MIN_HALF_EXTENT, y: MIN_HALF_EXTENT, z: MIN_HALF_EXTENT } };
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < points.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const v = points[i + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
    }
    const half = (k: number) => Math.max((max[k] - min[k]) / 2, MIN_HALF_EXTENT);
    const mid = (k: number) => (max[k] + min[k]) / 2;
    return { center: { x: mid(0), y: mid(1), z: mid(2) }, half: { x: half(0), y: half(1), z: half(2) } };
}
