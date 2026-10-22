import * as THREE from "three";
import { PALETTE } from "./Config";
import type { MaterialsApi } from "./types";
import type { Disposal } from "./utils/disposal";
import { mulberry32, randRange } from "./utils/math";

// ─────────────────────────────────────────────────────────────────────────
// Tyre dust (§10 W1-E, P1): 48 instanced Icosahedron(0.35, 0) puffs in sand
// (#EFD9BC), 0.7 s life, spawned at the rear wheels while the car is faster
// than 6 and drifting or boosting. One draw call. Puffs never fade through
// opacity (Lambert, opaque): they pop in, swell, drift up and shrink to nothing.
// Adaptive quality's last step ("dustOff", §9.3) calls setEnabled(false).
// ─────────────────────────────────────────────────────────────────────────

/** Stream-local tuning (P1 polish values). */
export const DUST = {
    capacity: 48,
    radius: 0.35,
    life: 0.7,
    minSpeed: 6,
    /** Puff scale at birth, at its peak, and the life fraction where it peaks. */
    scale: { start: 0.45, peak: 1.1, peakAt: 0.3 },
    /** Initial velocity: upward range, and a fraction of the car's velocity (trailing). */
    rise: [0.6, 1.4] as const,
    carVelocityShare: 0.15,
    /** Random sideways scatter speed (±). */
    scatter: 0.8,
    /** Velocity damping per second while airborne. */
    drag: 2.5,
    /** Spawn height above the contact point and random jitter (±) around it. */
    spawnY: 0.15,
    spawnJitter: 0.2,
    seed: 0x7d057,
} as const;

/** Emit interval per wheel that keeps the pool exactly full at a steady rate. */
export const DUST_EMIT_INTERVAL = DUST.life / (DUST.capacity / 2);

/** Puff scale over its normalised age t ∈ [0, 1]: swell to the peak, then shrink to 0. */
export function puffScale(t: number): number {
    const S = DUST.scale;
    if (t <= 0) return S.start;
    if (t >= 1) return 0;
    if (t < S.peakAt) return S.start + (S.peak - S.start) * (t / S.peakAt);
    const k = (t - S.peakAt) / (1 - S.peakAt);
    return S.peak * (1 - k * k);
}

/** Should the rear wheels kick up dust this frame? */
export function shouldEmitDust(speed: number, drifting: boolean, boosting: boolean, grounded: boolean): boolean {
    return grounded && Math.abs(speed) > DUST.minSpeed && (drifting || boosting);
}

export interface DustSource {
    /** Signed or absolute speed (units/s). */
    speed: number;
    drifting: boolean;
    boosting: boolean;
    /** Rear wheels touching the ground. */
    grounded: boolean;
    /** Rear wheel contact points (world). */
    wheels: readonly THREE.Vector3[];
    /** Car velocity (puffs inherit a little of it). */
    velocity: THREE.Vector3;
}

interface Puff {
    age: number;
    alive: boolean;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    spin: number;
}

export class TyreDust {
    readonly mesh: THREE.InstancedMesh;
    private puffs: Puff[] = [];
    private next = 0;
    private emitClock = 0;
    private enabled = true;
    private anyAlive = false;
    private rng = mulberry32(DUST.seed);
    private _m = new THREE.Matrix4();
    private _q = new THREE.Quaternion();
    private _s = new THREE.Vector3();
    private _e = new THREE.Euler();
    private static readonly ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

    constructor(materials: MaterialsApi, disposal: Disposal) {
        const geo = disposal.track(new THREE.IcosahedronGeometry(DUST.radius, 0));
        this.mesh = new THREE.InstancedMesh(geo, materials.lambert(PALETTE.tyreDust, { flat: true }), DUST.capacity);
        this.mesh.name = "tyre-dust";
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        // Instances spread around the car; the default bounds would cull wrongly.
        this.mesh.frustumCulled = false;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < DUST.capacity; i++) {
            this.puffs.push({ age: 0, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0 });
            this.mesh.setMatrixAt(i, TyreDust.ZERO);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.visible = false;
    }

    /** Adaptive "dustOff" (§9.3). Disabling also clears live puffs. */
    setEnabled(on: boolean) {
        this.enabled = on;
        if (!on) this.clear();
    }

    get isEnabled() {
        return this.enabled;
    }

    /** Number of live puffs (debug / tests). */
    get liveCount(): number {
        let n = 0;
        for (const p of this.puffs) if (p.alive) n++;
        return n;
    }

    clear() {
        for (let i = 0; i < this.puffs.length; i++) {
            this.puffs[i].alive = false;
            this.mesh.setMatrixAt(i, TyreDust.ZERO);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.visible = false;
        this.anyAlive = false;
        this.emitClock = 0;
    }

    update(dt: number, src: DustSource) {
        if (!this.enabled) return;
        if (shouldEmitDust(src.speed, src.drifting, src.boosting, src.grounded)) {
            this.emitClock += dt;
            while (this.emitClock >= DUST_EMIT_INTERVAL) {
                this.emitClock -= DUST_EMIT_INTERVAL;
                for (const w of src.wheels) this.spawn(w, src.velocity);
            }
        } else {
            this.emitClock = 0;
        }
        if (!this.anyAlive) return;

        let alive = false;
        const damping = Math.exp(-DUST.drag * dt);
        for (let i = 0; i < this.puffs.length; i++) {
            const p = this.puffs[i];
            if (!p.alive) continue;
            p.age += dt;
            if (p.age >= DUST.life) {
                p.alive = false;
                this.mesh.setMatrixAt(i, TyreDust.ZERO);
                continue;
            }
            alive = true;
            p.pos.addScaledVector(p.vel, dt);
            p.vel.multiplyScalar(damping);
            const s = puffScale(p.age / DUST.life);
            this._q.setFromEuler(this._e.set(p.spin, p.spin * 2, 0));
            this._m.compose(p.pos, this._q, this._s.setScalar(s));
            this.mesh.setMatrixAt(i, this._m);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.anyAlive = alive;
        this.mesh.visible = alive;
    }

    private spawn(at: THREE.Vector3, carVel: THREE.Vector3) {
        const r = this.rng;
        const p = this.puffs[this.next];
        this.next = (this.next + 1) % this.puffs.length;
        p.alive = true;
        p.age = 0;
        p.spin = r() * Math.PI * 2;
        p.pos.set(
            at.x + randRange(r, -DUST.spawnJitter, DUST.spawnJitter),
            at.y + DUST.spawnY,
            at.z + randRange(r, -DUST.spawnJitter, DUST.spawnJitter)
        );
        p.vel.set(
            carVel.x * DUST.carVelocityShare + randRange(r, -DUST.scatter, DUST.scatter),
            randRange(r, DUST.rise[0], DUST.rise[1]),
            carVel.z * DUST.carVelocityShare + randRange(r, -DUST.scatter, DUST.scatter)
        );
        this.anyAlive = true;
        this.mesh.visible = true;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.dispose();
    }
}
