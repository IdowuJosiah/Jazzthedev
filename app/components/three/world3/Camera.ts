import * as THREE from "three";
import gsap from "gsap";
import { CONFIG, SCREEN_DOWN } from "./Config";
import type { CameraShot, CameraState } from "./types";
import { clamp, clampLen, damp } from "./utils/math";

// ─────────────────────────────────────────────────────────────────────────
// Camera (§4.1): a fixed-azimuth 3/4 diorama view. Yaw is always π/4: the
// camera never rotates with the car, never orbits, rolls or shakes.
//
//   offset = d · (cos el · sin yaw, sin el, cos el · cos yaw), lookAt(focus)
//   d      = base · zoom + pullback
//
// Shots (default / gallery / intro) tween their elevation, base distance and
// gallery focus shift with gsap (instant cuts under reduced motion). Portrait
// screens (aspect < 1) use FOV 42, +4° elevation and a base that keeps 22 units
// visible across the screen. `state` (CameraState) is read by Environment for
// the shadow-box refit and the fog distances.
// ─────────────────────────────────────────────────────────────────────────

const C = CONFIG.camera;
const S = SCREEN_DOWN;
const DEG = Math.PI / 180;

/** WheelEvent.deltaMode line height in px (Firefox reports lines). */
const WHEEL_LINE_PX = 16;
/** The ground plane the pan drag raycasts against. */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export interface ShotParams {
    elevationDeg: number;
    base: number;
    /** Focus shift along −S (gallery: boards centre-frame, car low in frame). */
    focusShift: number;
}

export interface ShotView {
    fov: number;
    /** Radians. */
    elevation: number;
    base: number;
}

/** Portrait base: keeps `visibleWidth` units visible across the screen at the focus. */
export function portraitBase(aspect: number): number {
    const P = C.portrait;
    return P.visibleWidth / (2 * Math.tan(P.halfAngleDeg * DEG) * aspect);
}

/** Effective FOV / elevation / base of a shot for an aspect ratio (portrait rules applied). */
export function shotView(shot: ShotParams, aspect: number): ShotView {
    const portrait = aspect < 1;
    return {
        fov: portrait ? C.portraitFov : C.fov,
        elevation: (shot.elevationDeg + (portrait ? C.portrait.elevationBonusDeg : 0)) * DEG,
        base: portrait ? Math.max(shot.base, portraitBase(aspect)) : shot.base,
    };
}

/** Camera position relative to the focus for distance d, elevation `el` and the fixed yaw. */
export function cameraOffset(d: number, el: number, out: THREE.Vector3, yaw: number = C.yaw): THREE.Vector3 {
    return out.set(d * Math.cos(el) * Math.sin(yaw), d * Math.sin(el), d * Math.cos(el) * Math.cos(yaw));
}

/** Visible width at the focus: W = 2 · d · tan(fov / 2) · aspect. */
export function visibleWidthAt(d: number, fovDeg: number, aspect: number): number {
    return 2 * d * Math.tan((fovDeg * DEG) / 2) * aspect;
}

/** Speed pull-back target: 6 · (base / 38) · clamp(speed / 32, 0, 1). */
export function pullbackTarget(base: number, speed: number): number {
    const P = C.pullback;
    return P.max * (base / P.refBase) * clamp(speed / P.speedRef, 0, 1);
}

/**
 * Follow lead (§4.1): vel·0.3 + S·max(0, dot(v̂, S))·6·clamp(speed/12, 0, 1),
 * clamped to min(10, 0.25·W). The second term adds look-ahead when driving
 * toward the camera (east or south). Horizontal only.
 */
export function followLead(
    vel: { x: number; z: number },
    d: number,
    fovDeg: number,
    aspect: number,
    out: THREE.Vector3
): THREE.Vector3 {
    const F = C.follow;
    const speed = Math.hypot(vel.x, vel.z);
    out.set(vel.x * F.velocityLead, 0, vel.z * F.velocityLead);
    if (speed > 0) {
        const towardCamera = Math.max(0, (vel.x * S.x + vel.z * S.z) / speed);
        const k = towardCamera * F.towardCameraLead * clamp(speed / F.towardCameraSpeedRef, 0, 1);
        out.x += S.x * k;
        out.z += S.z * k;
    }
    return clampLen(out, Math.min(F.maxLead, F.maxLeadWidthFraction * visibleWidthAt(d, fovDeg, aspect)));
}

/** Multiplicative zoom factor for a wheel event (deltaY > 0 zooms out). */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
    const px = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * pageHeight : deltaY;
    return Math.exp(px * C.zoom.wheelPerDeltaY);
}

export const clampZoom = (z: number) => clamp(z, C.zoom.min, C.zoom.max);

const shotParams = (shot: CameraShot): ShotParams => ({ ...C.shots[shot] });

export interface CameraOptions {
    aspect: number;
    reducedMotion: boolean;
    /** Initial focus (x, z); defaults to the origin. */
    focus?: { x: number; z: number };
    /** Starting shot; "intro" until playIntro() (default). */
    shot?: CameraShot;
}

/** The minimal canvas surface the camera listens on (an HTMLCanvasElement in the app). */
export type CameraInputElement = Pick<
    HTMLElement,
    "addEventListener" | "removeEventListener" | "getBoundingClientRect" | "style"
> &
    Partial<Pick<HTMLElement, "setPointerCapture" | "releasePointerCapture" | "hasPointerCapture">>;

export class Camera {
    readonly camera: THREE.PerspectiveCamera;
    readonly state: CameraState;

    private reducedMotion: boolean;
    private inputEnabled = true;
    private shot: ShotParams;
    private targetShot: CameraShot;
    private shotTween: gsap.core.Tween | null = null;
    /** onDone of the running shot tween; also fired if a newer shot interrupts it. */
    private shotDone: (() => void) | null = null;
    /** True from an "intro" start until playIntro(): setShot() is ignored meanwhile. */
    private introHeld: boolean;
    private flyTween: gsap.core.Tween | null = null;
    private flying = false;
    private zoomTarget = 1;
    private pullback = 0;
    /** Damped follow point (car + lead), before the gallery shift and pan. */
    private follow = new THREE.Vector3();
    private pan = new THREE.Vector3();
    private clock = 0;
    private lastPanAt = -Infinity;

    // pointer state
    private pointers = new Map<number, { x: number; y: number }>();
    private dragId: number | null = null;
    private grab = new THREE.Vector3();
    private pinchDist = 0;

    // scratch
    private raycaster = new THREE.Raycaster();
    private ndc = new THREE.Vector2();
    private hit = new THREE.Vector3();
    private lead = new THREE.Vector3();
    private offset = new THREE.Vector3();
    private prevPan = new THREE.Vector3();

    constructor(
        private element: CameraInputElement,
        opts: CameraOptions
    ) {
        const shot = opts.shot ?? "intro";
        this.shot = shotParams(shot);
        this.targetShot = shot;
        this.introHeld = shot === "intro";
        this.reducedMotion = opts.reducedMotion;
        const view = shotView(this.shot, opts.aspect);
        this.camera = new THREE.PerspectiveCamera(view.fov, opts.aspect, C.near, C.far);
        if (opts.focus) this.follow.set(opts.focus.x, 0, opts.focus.z);
        this.state = {
            fov: view.fov,
            aspect: opts.aspect,
            elevation: view.elevation,
            base: view.base,
            zoom: 1,
            d: view.base,
            focus: new THREE.Vector3(),
            shot,
        };
        this.place();

        element.style.cursor = "grab";
        element.style.touchAction = "none";
        element.addEventListener("wheel", this.onWheel, { passive: false });
        element.addEventListener("pointerdown", this.onPointerDown);
        element.addEventListener("pointermove", this.onPointerMove);
        element.addEventListener("pointerup", this.onPointerUp);
        element.addEventListener("pointercancel", this.onPointerUp);
        element.addEventListener("lostpointercapture", this.onPointerUp);
    }

    // ── configuration ────────────────────────────────────────────────────
    /** Call on resize: FOV switches to 42 in portrait. */
    setAspect(aspect: number) {
        this.state.aspect = aspect;
        this.camera.aspect = aspect;
        const fov = shotView(this.shot, aspect).fov;
        this.camera.fov = fov;
        this.state.fov = fov;
        this.camera.updateProjectionMatrix();
    }

    setReducedMotion(on: boolean) {
        this.reducedMotion = on;
    }

    /** Pointer pan / zoom on or off (e.g. photo mode, panels). Ends any drag. */
    setInputEnabled(on: boolean) {
        this.inputEnabled = on;
        if (!on) this.endDrag();
    }

    /** True while a shot or travel tween runs (adaptive quality ignores these frames). */
    get isTweening(): boolean {
        return this.shotTween !== null || this.flyTween !== null;
    }

    /** The shot being shown or tweened to. */
    get currentShot(): CameraShot {
        return this.targetShot;
    }

    // ── shots ────────────────────────────────────────────────────────────
    /**
     * Tweens to a shot (1.2 s power2.inOut), or cuts under reduced motion or
     * `instant`. `state.shot` updates when the move completes, so the shadow box
     * refits once, for the final framing.
     *
     * Ignored while the intro is held (started on "intro", playIntro() not yet
     * called), so per-frame zone-driven calls before Start keep the intro framing.
     */
    setShot(shot: CameraShot, instant = false) {
        if (this.introHeld) return;
        if (shot === this.targetShot && !instant) return;
        const T = C.shotTween;
        this.tweenShot(shot, T.duration, T.ease, instant);
    }

    /**
     * After Start: intro → default over 1.6 s power3.inOut (a cut under reduced
     * motion). Releases the intro hold. `onDone` fires when the move ends, or
     * early if a later setShot() interrupts it.
     */
    playIntro(onDone?: () => void) {
        this.introHeld = false;
        this.tweenShot("default", C.intro.duration, C.intro.ease, false, onDone);
    }

    private tweenShot(shot: CameraShot, duration: number, ease: string, instant: boolean, onDone?: () => void) {
        // An interrupted move still reports done (after the new one is set up,
        // so a setShot() from inside that callback cleanly supersedes it).
        const interrupted = this.shotDone;
        this.shotDone = null;
        this.shotTween?.kill();
        this.shotTween = null;
        this.targetShot = shot;
        const to = C.shots[shot];
        if (instant || this.reducedMotion) {
            Object.assign(this.shot, to);
            this.state.shot = shot;
            interrupted?.();
            onDone?.();
            return;
        }
        this.shotDone = onDone ?? null;
        this.shotTween = gsap.to(this.shot, {
            elevationDeg: to.elevationDeg,
            base: to.base,
            focusShift: to.focusShift,
            duration,
            ease,
            onComplete: () => {
                this.shotTween = null;
                this.state.shot = shot;
                const done = this.shotDone;
                this.shotDone = null;
                done?.();
            },
        });
        interrupted?.();
    }

    // ── travel ───────────────────────────────────────────────────────────
    /**
     * Travel cut (gsap): moves the focus to (x, z) over the shot-tween time,
     * then hands back to follow. Instant under reduced motion. Clears the pan.
     */
    flyTo(x: number, z: number, onDone?: () => void) {
        this.flyTween?.kill();
        this.flyTween = null;
        this.endDrag();
        if (this.reducedMotion) {
            this.snapTo(x, z);
            onDone?.();
            return;
        }
        this.flying = true;
        const T = C.shotTween;
        const from = { x: this.follow.x, z: this.follow.z, px: this.pan.x, pz: this.pan.z };
        this.flyTween = gsap.to(from, {
            x,
            z,
            px: 0,
            pz: 0,
            duration: T.duration,
            ease: T.ease,
            onUpdate: () => {
                this.follow.set(from.x, 0, from.z);
                this.pan.set(from.px, 0, from.pz);
            },
            onComplete: () => {
                this.flyTween = null;
                this.flying = false;
                onDone?.();
            },
        });
    }

    /** Instantly centres the follow point on (x, z) (respawn, teleport) and clears the pan. */
    snapTo(x: number, z: number) {
        this.flyTween?.kill();
        this.flyTween = null;
        this.flying = false;
        this.follow.set(x, 0, z);
        this.pan.set(0, 0, 0);
        this.place();
    }

    // ── per frame ────────────────────────────────────────────────────────
    /**
     * @param carPos interpolated car position
     * @param carVel car velocity (horizontal components are used)
     */
    update(dt: number, carPos: THREE.Vector3, carVel: THREE.Vector3) {
        this.clock += dt;
        const speed = Math.hypot(carVel.x, carVel.z);
        this.state.zoom = damp(this.state.zoom, this.zoomTarget, C.zoom.lambda, dt);
        const view = shotView(this.shot, this.state.aspect);
        this.pullback = damp(this.pullback, pullbackTarget(view.base, speed), C.pullback.lambda, dt);

        if (!this.flying) {
            const d = view.base * this.state.zoom + this.pullback;
            followLead(carVel, d, view.fov, this.state.aspect, this.lead);
            const lambda = this.reducedMotion ? C.follow.reducedMotionLambda : C.follow.lambda;
            this.follow.x = damp(this.follow.x, carPos.x + this.lead.x, lambda, dt);
            this.follow.z = damp(this.follow.z, carPos.z + this.lead.z, lambda, dt);

            // Pan eases back after 1.2 s idle, or at once when the car moves off.
            const P = C.pan;
            const idle = this.clock - this.lastPanAt > P.idleDelay;
            if (this.dragId === null && (idle || speed > P.returnAboveSpeed)) {
                this.pan.x = damp(this.pan.x, 0, P.returnLambda, dt);
                this.pan.z = damp(this.pan.z, 0, P.returnLambda, dt);
            }
        }
        this.place();
    }

    /** Applies shot + zoom + pullback + focus to the camera and the shared state. */
    private place() {
        const st = this.state;
        const view = shotView(this.shot, st.aspect);
        st.fov = view.fov;
        st.elevation = view.elevation;
        st.base = view.base;
        st.d = view.base * st.zoom + this.pullback;
        st.focus.set(
            this.follow.x - S.x * this.shot.focusShift + this.pan.x,
            0,
            this.follow.z - S.z * this.shot.focusShift + this.pan.z
        );
        if (this.camera.fov !== view.fov) {
            this.camera.fov = view.fov;
            this.camera.updateProjectionMatrix();
        }
        cameraOffset(st.d, view.elevation, this.offset);
        this.camera.position.copy(st.focus).add(this.offset);
        this.camera.lookAt(st.focus);
        this.camera.updateMatrixWorld();
    }

    // ── input: wheel zoom, pinch zoom, drag pan ──────────────────────────
    private onWheel = (e: WheelEvent) => {
        if (!this.inputEnabled) return;
        e.preventDefault();
        const h = this.element.getBoundingClientRect().height;
        this.zoomTarget = clampZoom(this.zoomTarget * wheelZoomFactor(e.deltaY, e.deltaMode, h));
    };

    private onPointerDown = (e: PointerEvent) => {
        if (!this.inputEnabled || this.flying) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.element.setPointerCapture?.(e.pointerId);
        if (this.pointers.size === 1) {
            if (this.groundHit(e.clientX, e.clientY, this.grab)) {
                this.dragId = e.pointerId;
                this.lastPanAt = this.clock;
                if (e.pointerType === "mouse") this.element.style.cursor = "grabbing";
            }
        } else if (this.pointers.size === 2) {
            // Second finger: pinch replaces the pan.
            this.dragId = null;
            this.pinchDist = this.pointerSpread();
        }
    };

    private onPointerMove = (e: PointerEvent) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.pointers.size === 2) {
            const dist = this.pointerSpread();
            if (this.pinchDist > 0 && dist > 0) {
                this.zoomTarget = clampZoom(this.zoomTarget * (this.pinchDist / dist));
            }
            this.pinchDist = dist;
            return;
        }
        if (this.dragId !== e.pointerId || !this.groundHit(e.clientX, e.clientY, this.hit)) return;
        // Keep the grabbed ground point under the pointer: offset += grab − hit.
        const before = this.prevPan.copy(this.pan);
        this.pan.x += this.grab.x - this.hit.x;
        this.pan.z += this.grab.z - this.hit.z;
        clampLen(this.pan, C.pan.maxOffset);
        // Move the camera now so further moves before the next frame stay consistent.
        this.camera.position.x += this.pan.x - before.x;
        this.camera.position.z += this.pan.z - before.z;
        this.camera.updateMatrixWorld();
        this.lastPanAt = this.clock;
    };

    private onPointerUp = (e: PointerEvent) => {
        if (!this.pointers.delete(e.pointerId)) return;
        if (this.element.hasPointerCapture?.(e.pointerId)) this.element.releasePointerCapture?.(e.pointerId);
        if (this.dragId === e.pointerId) this.lastPanAt = this.clock;
        // Never resume a pan from the finger left after a pinch (it would jump).
        this.dragId = null;
        this.pinchDist = this.pointers.size === 2 ? this.pointerSpread() : 0;
        if (this.pointers.size === 0) this.element.style.cursor = "grab";
    };

    private endDrag() {
        this.pointers.clear();
        this.dragId = null;
        this.pinchDist = 0;
        this.element.style.cursor = "grab";
    }

    private pointerSpread(): number {
        const [a, b] = [...this.pointers.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }

    /** Raycasts a client point onto the y = 0 plane; false if it misses. */
    private groundHit(clientX: number, clientY: number, out: THREE.Vector3): boolean {
        const r = this.element.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.camera);
        return this.raycaster.ray.intersectPlane(GROUND_PLANE, out) !== null;
    }

    dispose() {
        this.shotTween?.kill();
        this.flyTween?.kill();
        this.shotTween = null;
        this.flyTween = null;
        // Torn down: pending callbacks must not reach into a disposed world.
        this.shotDone = null;
        const el = this.element;
        el.removeEventListener("wheel", this.onWheel);
        el.removeEventListener("pointerdown", this.onPointerDown);
        el.removeEventListener("pointermove", this.onPointerMove);
        el.removeEventListener("pointerup", this.onPointerUp);
        el.removeEventListener("pointercancel", this.onPointerUp);
        el.removeEventListener("lostpointercapture", this.onPointerUp);
        el.style.cursor = "";
    }
}
