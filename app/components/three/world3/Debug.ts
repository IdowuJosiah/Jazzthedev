import * as THREE from "three";
import GUI from "lil-gui";
import { Text as TroikaText } from "troika-three-text";
import { CONFIG, LOOK, type LookId } from "./Config";
import type { Camera } from "./Camera";
import type { Environment } from "./Environment";
import type { Physics } from "./Physics";
import type { Renderer } from "./Renderer";
import type { CameraShot } from "./types";
import { checkProbe, PixelProbe } from "./utils/probe";
import type { TextSystem } from "./utils/text";

// ─────────────────────────────────────────────────────────────────────────
// ?debug panel (lil-gui), §10 I: Look preset, lights, shadow, camera, text
// toggles and the calibration probe readout (§1.4: every channel of a sun-lit
// paper top in 0.88–0.96 linear for `day`). Tuned values are copied back into
// Config.ts by hand; nothing here persists. Only built when the URL has ?debug.
//
// Probe: tick "probe on click", then click a pixel on the canvas (the click
// also starts a camera drag; that does not affect the reading).
// ─────────────────────────────────────────────────────────────────────────

/** Readout refresh interval (s): lil-gui `listen()` polls every frame otherwise. */
const READOUT_INTERVAL = 0.25;
/** Slider ranges. */
const RANGE = {
    intensity: [0, 3, 0.01],
    shadowRadius: [0, 8, 0.1],
    bias: [-0.005, 0.005, 0.0001],
    normalBias: [0, 0.2, 0.001],
    zoom: [CONFIG.camera.zoom.min, CONFIG.camera.zoom.max, 0.01],
} as const;
const SHADOW_SIZES = { none: 0, "1024": 1024, "2048": 2048 } as const;

export interface DebugDeps {
    scene: THREE.Scene;
    camera: Camera;
    renderer: Renderer;
    env: Environment;
    physics: Physics;
    text: TextSystem;
    /** The live adaptive / quality state (read-only readout). */
    qualityInfo: () => string;
}

export class Debug {
    static active(): boolean {
        return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
    }

    private gui: GUI;
    private probe: PixelProbe;
    /** lil-gui-bound settings (the GUI needs public keys). */
    private readonly ui = { look: CONFIG.look as LookId, probeOn: false };
    private clock = 0;
    private fpsAcc = 0;
    private fpsFrames = 0;

    private readonly perf = {
        fps: 0,
        drawCalls: 0,
        triangles: 0,
        troikaTexts: 0,
        bodies: 0,
        dpr: 0,
        buffer: "",
        quality: "",
    };
    private readonly probeOut = { x: 0, y: 0, r: 0, g: 0, b: 0, hex: "", verdict: "click a pixel" };
    private readonly cam = { shot: "default" as CameraShot, zoom: 1, d: 0 };

    constructor(private deps: DebugDeps) {
        const { env, camera, renderer } = deps;
        this.gui = new GUI({ title: "world3 · debug" });
        this.probe = new PixelProbe(renderer.instance);

        // ── Look (§1.7) ──
        const look = this.gui.addFolder("Look");
        look.add(this.ui, "look", Object.keys(LOOK))
            .name("preset")
            .onChange((id: LookId) => {
                env.applyLook(id);
                renderer.setLook(LOOK[id]);
                this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
            });

        // ── Lights (§1.4) ──
        const lights = this.gui.addFolder("Lights");
        const [iMin, iMax, iStep] = RANGE.intensity;
        lights.add(env.hemi, "intensity", iMin, iMax, iStep).name("hemisphere ×").listen();
        lights.addColor(env.hemi, "color").name("hemi sky");
        lights.addColor(env.hemi, "groundColor").name("hemi ground");
        lights.add(env.sun, "intensity", iMin, iMax, iStep).name("sun ×").listen();
        lights.addColor(env.sun, "color").name("sun colour");
        lights.add(env.fill, "intensity", iMin, iMax, iStep).name("fill ×").listen();
        lights.addColor(env.fill, "color").name("fill colour");
        lights.close();

        // ── Shadow (§1.5) ──
        const shadow = this.gui.addFolder("Shadow");
        const s = env.sun.shadow;
        const size = { map: String(renderer.profile.shadowMapSize || "none") };
        shadow
            .add(size, "map", Object.keys(SHADOW_SIZES))
            .name("map size")
            .onChange((k: keyof typeof SHADOW_SIZES) => env.setShadowMapSize(SHADOW_SIZES[k]));
        shadow.add(s, "intensity", 0, 1, 0.01);
        shadow.add(s, "radius", ...RANGE.shadowRadius);
        shadow.add(s, "bias", ...RANGE.bias);
        shadow.add(s, "normalBias", ...RANGE.normalBias);
        shadow.close();

        // ── Camera (§4.1) ──
        const camF = this.gui.addFolder("Camera");
        camF.add(this.cam, "shot", ["default", "gallery", "intro"])
            .onChange((shot: CameraShot) => camera.setShot(shot));
        camF.add(camera.state, "zoom", ...RANGE.zoom).name("zoom (eased)").listen().disable();
        camF.add(camera.state, "d").name("distance d").listen().disable();
        camF.add(camera.state, "fov").listen().disable();
        camF.close();

        // ── Text (§3) ──
        const text = this.gui.addFolder("Text");
        const toggles = { troika: true, words3D: true, desktopOnlyAsTouch: false };
        text.add(toggles, "troika")
            .name("SDF text")
            .onChange((on: boolean) => this.forEachTroika((t) => (t.visible = on)));
        text.add(toggles, "words3D")
            .name("3D letters")
            .onChange((on: boolean) =>
                deps.scene.traverse((o) => {
                    if (o.name.startsWith("word3d:")) o.visible = on;
                })
            );
        text.add(toggles, "desktopOnlyAsTouch")
            .name("hide desktopOnly")
            .onChange((on: boolean) => deps.text.setViewport({ isTouch: on }));
        text.close();

        // ── Probe (§1.4 calibration) ──
        const probe = this.gui.addFolder("Probe");
        probe.add(this.ui, "probeOn").name("probe on click");
        for (const k of ["x", "y", "r", "g", "b", "hex", "verdict"] as const) {
            probe.add(this.probeOut, k).listen().disable();
        }
        renderer.instance.domElement.addEventListener("pointerdown", this.onProbe, true);

        // ── Perf (§9.2) ──
        const perf = this.gui.addFolder("Perf");
        for (const k of Object.keys(this.perf) as (keyof Debug["perf"])[]) perf.add(this.perf, k).listen().disable();
    }

    /** Per frame (after render): refreshes the readouts a few times a second. */
    update(dt: number): void {
        this.clock += dt;
        this.fpsAcc += dt;
        this.fpsFrames++;
        if (this.clock < READOUT_INTERVAL) return;
        this.clock = 0;
        const { renderer, physics } = this.deps;
        const info = renderer.instance.info.render;
        this.perf.fps = Math.round(this.fpsFrames / Math.max(this.fpsAcc, 1e-6));
        this.fpsAcc = 0;
        this.fpsFrames = 0;
        this.perf.drawCalls = info.calls;
        this.perf.triangles = info.triangles;
        this.perf.troikaTexts = this.deps.text.count;
        this.perf.bodies = physics.world.bodies.len();
        this.perf.dpr = renderer.size.dpr;
        this.perf.buffer = `${renderer.size.width}×${renderer.size.height}${renderer.sizes.usesDevicePixelBox ? " (device px)" : " (fallback)"}`;
        this.perf.quality = this.deps.qualityInfo();
        this.cam.shot = this.deps.camera.currentShot;
    }

    dispose(): void {
        this.deps.renderer.instance.domElement.removeEventListener("pointerdown", this.onProbe, true);
        this.probe.dispose();
        this.gui.destroy();
    }

    // ── internals ────────────────────────────────────────────────────────
    private onProbe = (e: PointerEvent) => {
        if (!this.ui.probeOn) return;
        const { scene, camera } = this.deps;
        const sample = this.probe.sampleAtClient(scene, camera.camera, e.clientX, e.clientY);
        const look = this.ui.look;
        const rule = LOOK[look].probe;
        const verdict = checkProbe(sample, rule);
        const fmt = (v: number) => Number(v.toFixed(3));
        Object.assign(this.probeOut, {
            x: sample.x,
            y: sample.y,
            r: fmt(sample.r),
            g: fmt(sample.g),
            b: fmt(sample.b),
            hex: sample.hex,
            verdict: `${verdict.pass ? "PASS" : "FAIL"} (${look} ${rule.min}–${rule.max})`,
        });
        console.info("[world3/probe]", sample, verdict);
    };

    private forEachTroika(fn: (t: THREE.Object3D) => void) {
        this.deps.scene.traverse((o) => {
            if (o instanceof TroikaText) fn(o);
        });
    }
}
