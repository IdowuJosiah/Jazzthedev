import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CONFIG, SCREEN_DOWN, SCREEN_RIGHT } from "./Config";
import { AREA_BY_ID, estimateTitleWidth, SPAWN } from "./Layout";
import {
    Camera,
    cameraOffset,
    clampZoom,
    followLead,
    portraitBase,
    pullbackTarget,
    shotView,
    visibleWidthAt,
    wheelZoomFactor,
    type CameraInputElement,
} from "./Camera";

const C = CONFIG.camera;
const DEG = Math.PI / 180;

/** A canvas stand-in that records listeners (no DOM in the node test env). */
function fakeCanvas(width = 1440, height = 900) {
    const listeners = new Map<string, (e: unknown) => void>();
    const el = {
        style: {} as CSSStyleDeclaration,
        addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
        removeEventListener: (type: string) => listeners.delete(type),
        getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }),
    };
    return { el: el as unknown as CameraInputElement, listeners, width, height };
}

const azimuth = (cam: THREE.PerspectiveCamera, focus: THREE.Vector3) =>
    Math.atan2(cam.position.x - focus.x, cam.position.z - focus.z);

describe("camera maths (§4.1)", () => {
    it("portrait base keeps 22 units visible (≈62 at 390×844)", () => {
        const aspect = 390 / 844;
        expect(portraitBase(aspect)).toBeCloseTo(62, 0);
        const v = shotView(C.shots.default, aspect);
        expect(v.fov).toBe(C.portraitFov);
        expect(v.elevation).toBeCloseTo((36 + 4) * DEG);
        expect(visibleWidthAt(v.base, v.fov, aspect)).toBeCloseTo(C.portrait.visibleWidth, 6);
    });

    it("landscape shots use FOV 30 and the shot's own base / elevation", () => {
        const v = shotView(C.shots.gallery, 16 / 9);
        expect(v.fov).toBe(30);
        expect(v.base).toBe(32);
        expect(v.elevation).toBeCloseTo(26 * DEG);
        // Portrait never goes closer than the shot base.
        expect(shotView(C.shots.intro, 0.95).base).toBeGreaterThanOrEqual(C.shots.intro.base);
    });

    it("offset sits at +X+Z of the focus at yaw π/4 and elevation el", () => {
        const o = cameraOffset(38, 36 * DEG, new THREE.Vector3());
        expect(o.length()).toBeCloseTo(38);
        expect(o.x).toBeCloseTo(o.z);
        expect(o.x).toBeGreaterThan(0);
        expect(Math.asin(o.y / 38)).toBeCloseTo(36 * DEG);
    });

    it("pull-back scales with base and saturates at speed 32", () => {
        expect(pullbackTarget(38, 0)).toBe(0);
        expect(pullbackTarget(38, 16)).toBeCloseTo(3);
        expect(pullbackTarget(38, 100)).toBeCloseTo(6);
        expect(pullbackTarget(76, 100)).toBeCloseTo(12);
    });

    it("lead adds look-ahead toward the camera and is clamped to min(10, 0.25·W)", () => {
        const out = new THREE.Vector3();
        // A wide view (aspect 3) so 0.25·W > 10 and only the 10-unit cap applies.
        // Driving away from the camera (north-west, −S): no extra term.
        followLead({ x: -SCREEN_DOWN.x * 10, z: -SCREEN_DOWN.z * 10 }, 38, 30, 3, out);
        expect(out.length()).toBeCloseTo(3);
        // Toward the camera (+S) at speed 12: 0.3·12 + 6 = 9.6.
        followLead({ x: SCREEN_DOWN.x * 12, z: SCREEN_DOWN.z * 12 }, 38, 30, 3, out);
        expect(out.length()).toBeCloseTo(9.6);
        // Fast: clamped at 10.
        followLead({ x: SCREEN_DOWN.x * 40, z: SCREEN_DOWN.z * 40 }, 38, 30, 3, out);
        expect(out.length()).toBeCloseTo(10);
        // Default 16:9 landscape: 0.25·W ≈ 9.05 is the tighter cap.
        followLead({ x: SCREEN_DOWN.x * 40, z: SCREEN_DOWN.z * 40 }, 38, 30, 16 / 9, out);
        expect(out.length()).toBeCloseTo(0.25 * visibleWidthAt(38, 30, 16 / 9));
        // Narrow view: clamped at 0.25·W.
        const W = visibleWidthAt(20, 30, 0.5);
        followLead({ x: SCREEN_DOWN.x * 40, z: SCREEN_DOWN.z * 40 }, 20, 30, 0.5, out);
        expect(out.length()).toBeCloseTo(0.25 * W);
        expect(out.y).toBe(0);
    });

    it("wheel zoom is multiplicative and handles line / page delta modes", () => {
        expect(wheelZoomFactor(100, 0, 900)).toBeGreaterThan(1);
        expect(wheelZoomFactor(-100, 0, 900) * wheelZoomFactor(100, 0, 900)).toBeCloseTo(1);
        expect(wheelZoomFactor(3, 1, 900)).toBeCloseTo(wheelZoomFactor(48, 0, 900));
        expect(clampZoom(10)).toBe(C.zoom.max);
        expect(clampZoom(0.1)).toBe(C.zoom.min);
    });
});

describe("Camera rig", () => {
    it("keeps the yaw constant whatever the car does", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: true, focus: SPAWN, shot: "default" });
        const pos = new THREE.Vector3(SPAWN.x, 0.8, SPAWN.z);
        const vel = new THREE.Vector3();
        for (let i = 0; i < 300; i++) {
            const a = i * 0.05;
            vel.set(Math.sin(a) * 30, 0, Math.cos(a) * 30);
            pos.addScaledVector(vel, 1 / 60);
            cam.update(1 / 60, pos, vel);
            expect(azimuth(cam.camera, cam.state.focus)).toBeCloseTo(C.yaw, 9);
            expect(cam.state.focus.y).toBe(0);
        }
        // Pull-back engaged at speed 30.
        expect(cam.state.d).toBeGreaterThan(C.shots.default.base + 4);
        cam.dispose();
    });

    it("publishes CameraState for Environment", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: true, focus: { x: 3, z: 4 }, shot: "default" });
        expect(cam.state.fov).toBe(30);
        expect(cam.state.base).toBe(38);
        expect(cam.state.d).toBeCloseTo(38);
        expect(cam.state.zoom).toBe(1);
        expect(cam.state.shot).toBe("default");
        expect(cam.state.focus.x).toBeCloseTo(3);
        cam.setAspect(0.5);
        expect(cam.camera.fov).toBe(C.portraitFov);
        expect(cam.state.fov).toBe(C.portraitFov);
        cam.dispose();
    });

    it("gallery shot shifts the focus by −S·4 (instant under reduced motion)", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: true, focus: { x: 0, z: 0 }, shot: "default" });
        cam.setShot("gallery");
        expect(cam.state.shot).toBe("gallery");
        expect(cam.isTweening).toBe(false);
        const p = new THREE.Vector3();
        cam.update(1 / 60, p, new THREE.Vector3());
        expect(cam.state.focus.x).toBeCloseTo(-SCREEN_DOWN.x * 4);
        expect(cam.state.focus.z).toBeCloseTo(-SCREEN_DOWN.z * 4);
        expect(cam.state.elevation).toBeCloseTo(26 * DEG);
        cam.dispose();
    });

    it("tweens shots with gsap when motion is allowed", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: false, focus: { x: 0, z: 0 }, shot: "default" });
        cam.setShot("gallery");
        expect(cam.isTweening).toBe(true);
        expect(cam.currentShot).toBe("gallery");
        // state.shot flips when the move completes (one shadow refit, final framing).
        expect(cam.state.shot).toBe("default");
        cam.setShot("default", true);
        expect(cam.isTweening).toBe(false);
        expect(cam.state.shot).toBe("default");
        cam.dispose();
    });

    it("intro starts at 44°/64 and cuts to default under reduced motion", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: true, focus: SPAWN });
        expect(cam.state.shot).toBe("intro");
        expect(cam.state.d).toBeCloseTo(64);
        let done = false;
        cam.playIntro(() => (done = true));
        expect(done).toBe(true);
        expect(cam.state.shot).toBe("default");
        cam.dispose();
    });

    it("holds the intro framing against setShot() until playIntro()", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: true, focus: SPAWN });
        cam.setShot("default");
        cam.setShot("gallery", true);
        expect(cam.currentShot).toBe("intro");
        expect(cam.state.shot).toBe("intro");
        cam.playIntro();
        expect(cam.state.shot).toBe("default");
        cam.setShot("gallery");
        expect(cam.state.shot).toBe("gallery");
        cam.dispose();
    });

    it("fires an interrupted intro's onDone when a later shot cuts it short", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: false, focus: SPAWN });
        let done = 0;
        cam.playIntro(() => done++);
        expect(cam.isTweening).toBe(true);
        expect(done).toBe(0);
        cam.setShot("gallery");
        expect(done).toBe(1);
        cam.setShot("default", true);
        expect(done).toBe(1);
        cam.dispose();
    });

    it("portrait keeps the hero word and the parked car in frame", () => {
        for (const [w, h] of [
            [390, 844],
            [360, 780],
            [1440, 900],
        ]) {
            const { el } = fakeCanvas(w, h);
            const aspect = w / h;
            const cam = new Camera(el, { aspect, reducedMotion: true, focus: SPAWN, shot: "default" });
            cam.update(1 / 60, new THREE.Vector3(SPAWN.x, 0.8, SPAWN.z), new THREE.Vector3());
            const hero = AREA_BY_ID.welcome.title3D!;
            const half = estimateTitleWidth(hero.text, CONFIG.type.heroWord.cap) / 2;
            const pts: THREE.Vector3[] = [new THREE.Vector3(SPAWN.x, 0, SPAWN.z), new THREE.Vector3(SPAWN.x, 1.5, SPAWN.z)];
            for (const s of [-1, 1]) {
                for (const y of [0, CONFIG.type.heroWord.cap]) {
                    pts.push(new THREE.Vector3(hero.x + SCREEN_RIGHT.x * half * s, y, hero.z + SCREEN_RIGHT.z * half * s));
                }
            }
            for (const p of pts) {
                const ndc = p.clone().project(cam.camera);
                expect(Math.abs(ndc.x)).toBeLessThan(1);
                expect(Math.abs(ndc.y)).toBeLessThan(1);
            }
            cam.dispose();
        }
    });

    it("snapTo recentres instantly; flyTo cuts under reduced motion", () => {
        const { el } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: true, focus: { x: 0, z: 0 }, shot: "default" });
        cam.snapTo(50, -60);
        expect(cam.state.focus.x).toBeCloseTo(50);
        let arrived = false;
        cam.flyTo(-40, -120, () => (arrived = true));
        expect(arrived).toBe(true);
        expect(cam.state.focus.z).toBeCloseTo(-120);
        cam.dispose();
    });

    it("wheel zoom eases toward the target and stays clamped", () => {
        const { el, listeners } = fakeCanvas();
        const cam = new Camera(el, { aspect: 16 / 9, reducedMotion: true, focus: { x: 0, z: 0 }, shot: "default" });
        const wheel = listeners.get("wheel")!;
        let prevented = false;
        for (let i = 0; i < 50; i++) wheel({ deltaY: 400, deltaMode: 0, preventDefault: () => (prevented = true) });
        expect(prevented).toBe(true);
        const v = new THREE.Vector3();
        cam.update(1 / 60, v, v);
        const first = cam.state.zoom;
        expect(first).toBeGreaterThan(1);
        expect(first).toBeLessThan(C.zoom.max);
        for (let i = 0; i < 240; i++) cam.update(1 / 60, v, v);
        expect(cam.state.zoom).toBeCloseTo(C.zoom.max, 3);
        expect(cam.state.d).toBeCloseTo(C.shots.default.base * C.zoom.max, 2);
        cam.dispose();
    });

    it("drag pans on the ground plane, clamps at 24 and eases back when idle", () => {
        const { el, listeners, width, height } = fakeCanvas();
        const cam = new Camera(el, { aspect: width / height, reducedMotion: true, focus: { x: 0, z: 0 }, shot: "default" });
        const v = new THREE.Vector3();
        cam.update(1 / 60, v, v);
        const down = listeners.get("pointerdown")!;
        const move = listeners.get("pointermove")!;
        const up = listeners.get("pointerup")!;
        const ev = (x: number, y: number) => ({ pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y });
        down(ev(720, 450));
        expect(el.style.cursor).toBe("grabbing");
        move(ev(820, 450));
        cam.update(1 / 60, v, v);
        const f1 = cam.state.focus.clone();
        // Dragging right moves the view left: the focus goes against R.
        expect(f1.x * SCREEN_RIGHT.x + f1.z * SCREEN_RIGHT.z).toBeLessThan(0);
        move(ev(4000, 450));
        cam.update(1 / 60, v, v);
        expect(Math.hypot(cam.state.focus.x, cam.state.focus.z)).toBeLessThanOrEqual(C.pan.maxOffset + 1e-6);
        up(ev(4000, 450));
        expect(el.style.cursor).toBe("grab");
        for (let i = 0; i < 60 * 8; i++) cam.update(1 / 60, v, v);
        expect(Math.hypot(cam.state.focus.x, cam.state.focus.z)).toBeLessThan(0.1);
        cam.dispose();
    });
});
