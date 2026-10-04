import * as THREE from "three";
import gsap from "gsap";
import { CONFIG } from "./Config";
import { damp } from "./utils/math";

type Mode = "intro" | "follow" | "transition";

/**
 * Camera rig: a cinematic flyover on load, a damped chase cam during play,
 * and GSAP-driven swoops when fast-travelling between zones.
 */
export class CameraRig {
    readonly camera: THREE.PerspectiveCamera;
    private mode: Mode = "intro";
    private curLook = new THREE.Vector3();
    private introT = 0;
    private tween?: gsap.core.Tween;
    private tmp = new THREE.Vector3();
    private desired = new THREE.Vector3();

    constructor(aspect: number) {
        const c = CONFIG.camera;
        this.camera = new THREE.PerspectiveCamera(c.fov, aspect, c.near, c.far);
        this.camera.position.set(0, 60, 120);
        this.camera.lookAt(0, 0, 0);
    }

    setAspect(aspect: number) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    get isIntro() {
        return this.mode === "intro";
    }

    skipIntro() {
        this.introT = CONFIG.camera.intro.duration;
    }

    startFollow() {
        this.mode = "follow";
    }

    /** Smooth cinematic move to look at a world point, then hand back to follow. */
    flyTo(pos: THREE.Vector3, look: THREE.Vector3, onDone?: () => void) {
        this.mode = "transition";
        this.tween?.kill();
        const proxy = {
            px: this.camera.position.x,
            py: this.camera.position.y,
            pz: this.camera.position.z,
            lx: this.curLook.x,
            ly: this.curLook.y,
            lz: this.curLook.z,
        };
        this.tween = gsap.to(proxy, {
            px: pos.x,
            py: pos.y,
            pz: pos.z,
            lx: look.x,
            ly: look.y,
            lz: look.z,
            duration: 1.4,
            ease: "power2.inOut",
            onUpdate: () => {
                this.camera.position.set(proxy.px, proxy.py, proxy.pz);
                this.curLook.set(proxy.lx, proxy.ly, proxy.lz);
                this.camera.lookAt(this.curLook);
            },
            onComplete: () => {
                this.mode = "follow";
                onDone?.();
            },
        });
    }

    /**
     * @param target  chassis position
     * @param forward chassis forward (unit) on the XZ plane
     * @param speed   current speed (units/s) for dynamic pullback
     */
    update(
        dt: number,
        target: THREE.Vector3,
        forward: THREE.Vector3,
        speed: number,
        reducedMotion: boolean
    ) {
        const f = CONFIG.camera.follow;

        if (this.mode === "intro") {
            this.introT += dt;
            const d = CONFIG.camera.intro.duration;
            const t = Math.min(this.introT / d, 1);
            // ease-in-out orbit descending toward the car
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const ang = -Math.PI * 0.5 + ease * Math.PI * 1.1;
            const radius = 150 - ease * 125;
            const height = 90 - ease * 82;
            this.camera.position.set(
                target.x + Math.cos(ang) * radius,
                height,
                target.z + Math.sin(ang) * radius
            );
            this.curLook.lerp(target, 0.1);
            this.camera.lookAt(this.curLook);
            if (t >= 1) this.mode = "follow";
            return;
        }

        if (this.mode === "transition") return; // GSAP drives it

        // Follow mode
        const pull = Math.min(speed * f.speedPullback, f.maxPullback);
        this.desired
            .copy(forward)
            .multiplyScalar(-(f.distance + pull))
            .add(target);
        this.desired.y = target.y + f.height;

        const lambda = reducedMotion ? 10 : f.stiffness;
        this.camera.position.x = damp(this.camera.position.x, this.desired.x, lambda, dt);
        this.camera.position.y = damp(this.camera.position.y, this.desired.y, lambda, dt);
        this.camera.position.z = damp(this.camera.position.z, this.desired.z, lambda, dt);

        this.tmp.copy(forward).multiplyScalar(f.lookAhead).add(target);
        this.tmp.y = target.y + 1.2;
        const ll = reducedMotion ? 12 : f.lookStiffness;
        this.curLook.x = damp(this.curLook.x, this.tmp.x, ll, dt);
        this.curLook.y = damp(this.curLook.y, this.tmp.y, ll, dt);
        this.curLook.z = damp(this.curLook.z, this.tmp.z, ll, dt);
        this.camera.lookAt(this.curLook);
    }

    dispose() {
        this.tween?.kill();
    }
}
