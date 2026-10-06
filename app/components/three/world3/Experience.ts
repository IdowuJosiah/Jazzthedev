import * as THREE from "three";
import { CONFIG, LOOK, PALETTE, type RenderProfileId } from "./Config";
import { AREA_BY_ID, SPAWN } from "./Layout";
import type { Areas } from "./Areas";
import type { WorldStore } from "./State";
import type { RenderProfile } from "./types";
import { Disposal } from "./utils/disposal";
import { Time } from "./utils/time";

// ─────────────────────────────────────────────────────────────────────────
// Experience (skeleton, Step 0). The PUBLIC API below is frozen:
//
//   new Experience(canvas, container, store)
//   init({ profile, reducedMotion, isTouch }): Promise<void>
//       — on failure sets phase "failed" + failReason; never throws
//   interact(): void   — synchronous (called from key / click handlers)
//   dispose(): void
//   pickProfile(gpuTier, isMobile): RenderProfile
//
// Load contract (§6.2): fonts 0.15 → assets 0.55 → build 0.25 → warm-up 0.05
// with labels "Loading fonts" / "Loading models" / "Building the world";
// progress only ever increases (LoadTracker). The internals here are a
// placeholder world (renderer + rig + flat ground) the integrator replaces
// with the Wave 1 modules (Renderer, Physics, Environment, Vehicle, Areas...).
// ─────────────────────────────────────────────────────────────────────────

const deviceDpr = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

/** Render profile from the GPU tier (§9.1). Decided once at boot. */
export function pickProfile(gpuTier: number, isMobile: boolean, dpr: number = deviceDpr()): RenderProfile {
    let id: RenderProfileId;
    if (isMobile) id = gpuTier >= 2 ? "mobile" : "mobile-low";
    else id = gpuTier >= 3 ? "desktop-high" : gpuTier === 2 ? "desktop-medium" : "desktop-low";
    const spec = CONFIG.render.profiles[id];
    const antialias = spec.antialias === "belowDpr2" ? dpr < 2 : spec.antialias;
    return {
        id,
        // Never below min(devicePixelRatio, 2).
        dprCap: Math.max(spec.dprCap, CONFIG.render.minDprCap),
        antialias,
        shadowMapSize: spec.shadowMapSize,
        scenery: spec.scenery,
        isMobile,
        gpuTier,
    };
}

/** Reads the next-visit DPR fallback (§9.1); only ever lowers the mobile cap to 2. */
export function applyNextVisitDprCap(profile: RenderProfile): RenderProfile {
    if (profile.id !== "mobile") return profile;
    try {
        const raw = window.localStorage.getItem(CONFIG.render.nextVisit.storageKey);
        const cap = raw === null ? NaN : Number(raw);
        if (cap === CONFIG.render.nextVisit.dprCap) return { ...profile, dprCap: cap };
    } catch {
        /* storage blocked: keep the profile */
    }
    return profile;
}

/**
 * detect-gpu raced against a 3 s timeout (tier 2 on timeout / error), then
 * pickProfile + the next-visit DPR fallback.
 */
export async function detectRenderProfile(): Promise<RenderProfile> {
    const G = CONFIG.render.gpu;
    const coarse =
        typeof window !== "undefined" &&
        (window.matchMedia?.("(pointer: coarse)").matches || (navigator.maxTouchPoints ?? 0) > 0);
    let tier: number = G.fallbackTier;
    let isMobile = coarse;
    try {
        const { getGPUTier } = await import("detect-gpu");
        const result = await Promise.race([
            getGPUTier({ benchmarksURL: G.benchmarksURL }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), G.timeoutMs)),
        ]);
        if (result) {
            tier = result.tier;
            isMobile = result.isMobile ?? coarse;
        }
    } catch {
        /* keep the fallback tier */
    }
    return applyNextVisitDprCap(pickProfile(tier, isMobile));
}

export type LoadStage = keyof typeof CONFIG.loading.stages;
const STAGE_ORDER: readonly LoadStage[] = ["fonts", "assets", "build", "warmup"];

/** Weighted, monotonic load progress (§6.2). */
export class LoadTracker {
    constructor(private store: WorldStore) {}

    /** Reports `fraction` ∈ [0, 1] of a stage; sets that stage's label. */
    report(stage: LoadStage, fraction: number): void {
        const stages = CONFIG.loading.stages;
        let base = 0;
        for (const s of STAGE_ORDER) {
            if (s === stage) break;
            base += stages[s].weight;
        }
        const f = Math.min(1, Math.max(0, fraction));
        this.store.setProgress(base + stages[stage].weight * f, stages[stage].label);
    }

    complete(stage: LoadStage): void {
        this.report(stage, 1);
    }
}

export function webgl2Available(): boolean {
    try {
        const c = document.createElement("canvas");
        return !!c.getContext("webgl2");
    } catch {
        return false;
    }
}

export interface InitOptions {
    profile: RenderProfile;
    reducedMotion: boolean;
    isTouch: boolean;
}

export class Experience {
    private disposal = new Disposal();
    private time = new Time();
    private tracker: LoadTracker;
    private renderer: THREE.WebGLRenderer | null = null;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far);
    private focus = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    private profile: RenderProfile | null = null;
    /** Wired by the integrator once the Wave 1 services exist. */
    private areas: Areas | null = null;
    private disposed = false;
    private started = false;

    constructor(
        private canvas: HTMLCanvasElement,
        private container: HTMLElement,
        private store: WorldStore
    ) {
        this.tracker = new LoadTracker(store);
    }

    async init(opts: InitOptions): Promise<void> {
        const { profile, reducedMotion, isTouch } = opts;
        this.profile = profile;
        this.store.set({ reducedMotion, isTouch });
        if (!webgl2Available()) {
            this.store.fail("webgl");
            return;
        }
        this.store.set({ phase: "loading" });
        const timeout = window.setTimeout(() => {
            // Loading continues; the UI shows "taking longer than usual".
            if (this.store.snapshot.phase === "loading") this.store.set({ failReason: "timeout" });
        }, CONFIG.loading.timeoutMs);
        this.disposal.onDispose(() => window.clearTimeout(timeout));

        try {
            this.wireCommands();
            this.tracker.report("fonts", 0);
            try {
                this.createRenderer(profile);
            } catch (err) {
                // Context creation failed despite the WebGL2 probe (e.g. GPU process blocked).
                console.error("[world3] WebGL renderer creation failed", err);
                if (!this.disposed) this.store.fail("webgl");
                return;
            }
            if (this.disposed) return;
            this.tracker.complete("fonts");

            this.tracker.report("assets", 0);
            this.tracker.complete("assets");

            this.tracker.report("build", 0);
            this.buildPlaceholderWorld();
            this.tracker.complete("build");

            this.tracker.report("warmup", 0);
            this.resize();
            this.renderer!.compile(this.scene, this.camera);
            this.renderer!.render(this.scene, this.camera);
            this.tracker.complete("warmup");

            this.time.onTick((dt) => this.tick(dt));
            this.time.start();
            this.store.set({ phase: "ready", failReason: undefined });
        } catch (err) {
            console.error("[world3] init failed", err);
            if (!this.disposed) this.store.fail("asset");
        } finally {
            window.clearTimeout(timeout);
        }
    }

    /** Synchronous: runs the active interactable from inside the input handler. */
    interact(): void {
        if (!this.started || !this.areas) return;
        this.areas.interact((i) => {
            if (i.content) this.store.set({ panel: i.content });
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.time.dispose();
        this.areas?.dispose();
        this.disposal.dispose();
        this.renderer?.dispose();
        this.renderer = null;
    }

    // ── internals (placeholder until Wave 1) ─────────────────────────────
    private wireCommands() {
        this.store.wire({
            start: () => {
                if (this.store.snapshot.phase !== "ready") return;
                this.started = true;
                this.store.set({ phase: "running", muted: false });
            },
            interact: () => this.interact(),
            travelTo: (id) => {
                const a = AREA_BY_ID[id];
                this.focus.set(a.arrival.x, 0, a.arrival.z);
                const visited = this.store.snapshot.visited;
                this.store.set({
                    areaId: id,
                    mapOpen: false,
                    visited: visited.includes(id) ? visited : [...visited, id],
                });
            },
        });
    }

    private createRenderer(profile: RenderProfile) {
        const look = LOOK[CONFIG.look];
        const renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: profile.antialias,
            alpha: false,
            powerPreference: "high-performance",
        });
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(look.background, CONFIG.render.clearAlpha);
        renderer.shadowMap.enabled = profile.shadowMapSize > 0;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.setPixelRatio(1);
        this.renderer = renderer;

        const onLost = (e: Event) => {
            e.preventDefault();
            this.time.stop();
            this.store.fail("context-lost");
        };
        const onRestored = () => window.location.reload();
        this.canvas.addEventListener("webglcontextlost", onLost);
        this.canvas.addEventListener("webglcontextrestored", onRestored);
        this.disposal.onDispose(() => {
            this.canvas.removeEventListener("webglcontextlost", onLost);
            this.canvas.removeEventListener("webglcontextrestored", onRestored);
        });

        const ro = new ResizeObserver(() => this.resize());
        ro.observe(this.container);
        this.disposal.onDispose(() => ro.disconnect());
    }

    private buildPlaceholderWorld() {
        const look = LOOK[CONFIG.look];
        const L = CONFIG.lights;
        this.scene.background = new THREE.Color(look.background);
        this.scene.fog = new THREE.Fog(look.background, 1, 2);

        const hemi = new THREE.HemisphereLight(look.hemisphere.sky, look.hemisphere.ground, look.hemisphere.intensity);
        const sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity);
        sun.position.set(L.sunDirection.x, L.sunDirection.y, L.sunDirection.z).multiplyScalar(CONFIG.shadow.lightDistance);
        const fill = new THREE.DirectionalLight(look.fill.color, look.fill.intensity);
        fill.position.set(L.fillDirection.x, L.fillDirection.y, L.fillDirection.z);
        this.scene.add(hemi, sun, fill);

        const G = CONFIG.world.ground;
        const groundGeo = this.disposal.track(new THREE.PlaneGeometry(G.maxX - G.minX, G.maxZ - G.minZ));
        groundGeo.rotateX(-Math.PI / 2);
        const groundMat = this.disposal.track(new THREE.MeshLambertMaterial({ color: PALETTE.ground }));
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.position.set((G.minX + G.maxX) / 2, 0, (G.minZ + G.maxZ) / 2);
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    /** Camera distance d for the default shot (portrait keeps 22 units visible). */
    private cameraDistance(aspect: number) {
        const C = CONFIG.camera;
        const shot = C.shots.default;
        if (aspect >= 1) return shot.base;
        const half = THREE.MathUtils.degToRad(C.portrait.halfAngleDeg);
        return Math.max(shot.base, C.portrait.visibleWidth / (2 * Math.tan(half) * aspect));
    }

    private resize() {
        const renderer = this.renderer;
        if (!renderer || !this.profile) return;
        const w = Math.max(1, this.container.clientWidth);
        const h = Math.max(1, this.container.clientHeight);
        // Placeholder sizing (W1-A's utils/sizes.ts adds device-pixel-content-box).
        const dpr = Math.min(deviceDpr(), this.profile.dprCap);
        renderer.setSize(Math.round(w * dpr), Math.round(h * dpr), false);
        const aspect = w / h;
        const C = CONFIG.camera;
        this.camera.aspect = aspect;
        this.camera.fov = aspect < 1 ? C.portraitFov : C.fov;
        this.camera.updateProjectionMatrix();
        this.placeCamera(aspect);
    }

    private placeCamera(aspect: number) {
        const C = CONFIG.camera;
        const elevDeg = C.shots.default.elevationDeg + (aspect < 1 ? C.portrait.elevationBonusDeg : 0);
        const el = THREE.MathUtils.degToRad(elevDeg);
        const d = this.cameraDistance(aspect);
        this.camera.position.set(
            this.focus.x + d * Math.cos(el) * Math.sin(C.yaw),
            this.focus.y + d * Math.sin(el),
            this.focus.z + d * Math.cos(el) * Math.cos(C.yaw)
        );
        this.camera.lookAt(this.focus);
        const fog = this.scene.fog;
        if (fog instanceof THREE.Fog) {
            fog.near = CONFIG.fog.nearFactor * d;
            fog.far = CONFIG.fog.farFactor * d;
        }
    }

    private tick(dt: number) {
        const renderer = this.renderer;
        if (!renderer || this.store.snapshot.paused) return;
        this.placeCamera(this.camera.aspect);
        this.store.live.x = this.focus.x;
        this.store.live.z = this.focus.z;
        this.store.live.yaw = SPAWN.yaw;
        this.store.live.fps = dt > 0 ? 1 / dt : 0;
        renderer.render(this.scene, this.camera);
    }
}
