import * as THREE from "three";
import { CONFIG, FACE_CAMERA_Y, PALETTE, type QualitySetting, type RenderProfileId, type SceneryTier } from "./Config";
import { AREAS, AREA_BY_ID, AREA_LAYOUT, SPAWN, areaAt, pointInRect } from "./Layout";
import { Areas, registeredAreaIds, type AreaServices } from "./Areas";
// Explicit "/index": on a case-insensitive disk "./areas" would resolve to Areas.ts.
import "./areas/index"; // side-effect registration of the Wave 2 area modules
import { Assets } from "./Assets";
import { Audio } from "./Audio";
import { Camera } from "./Camera";
import { Controls } from "./Controls";
import type { Debug } from "./Debug";
import { Environment } from "./Environment";
import { Materials, clearOccluder, setOccluder } from "./Materials";
import * as Paths from "./Paths";
import { Physics, loadRapier } from "./Physics";
import { Renderer } from "./Renderer";
import { Scenery, planScenery, type SceneryPlan } from "./Scenery";
import { openExternalUrl, type WorldCommandSet, type WorldStore } from "./State";
import { TyreDust } from "./TyreDust";
import { Vehicle, type VehicleInput } from "./Vehicle";
import type { AreaDef, AreaId, CameraShot, RenderProfile, RuntimeInfo, Word3D, WorldCommands } from "./types";
import { Disposal } from "./utils/disposal";
import * as shapes from "./utils/shapes";
import { collectStrings, createTextApi, preloadAll, type TextSystem } from "./utils/text";
import { createText3D, loadTypeface, type Text3DSystem } from "./utils/text3d";
import { Time } from "./utils/time";
import * as content from "@/app/field/content/world";

// ─────────────────────────────────────────────────────────────────────────
// Experience: the v3 world root. The PUBLIC API is frozen (Step 0):
//
//   new Experience(canvas, container, store)
//   init({ profile, reducedMotion, isTouch }): Promise<void>
//       — on failure sets phase "failed" + failReason; never throws
//   interact(): void   — synchronous (called from key / click handlers)
//   dispose(): void
//   pickProfile(gpuTier, isMobile): RenderProfile
//
// Boot (§10 Wave 3 order; the profile is detected by the React shell first):
//   renderer → fonts (troika preload + typeface JSON) ∥ Rapier init → assets
//   (the scenery plan is computed while they download) → environment → car,
//   camera, controls → areas (+ interim markers) → paths → scenery → warm-up
//   render → "ready". The build yields to the UI between steps so the loader
//   bar moves (CONFIG.loading.buildSteps).
// Load contract (§6.2): fonts 0.15 → assets 0.55 → build 0.25 → warm-up 0.05,
// progress only ever increases (LoadTracker). Failures: no WebGL2 / renderer
// throws → "webgl"; a required asset (font, typeface, car.glb, Rapier) fails
// after its one retry → "asset"; webglcontextlost → "context-lost" (and
// location.reload() on restore); 15 s without "ready" → failReason "timeout"
// while loading continues.
//
// Tick (§10): physics.step (vehicle control per substep) → interpolate →
// vehicle.syncVisual → tyre dust → areas → camera → environment (shadow box,
// fog) → occluder uniforms → render. Around it: area enter / visited / toast,
// camera zones, area culling at 70 units, board lazy-loading, hero-letter
// auto-reset, adaptive quality (§9.3) and the next-visit DPR fallback (§9.1).
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
    // One probe context, handed to detect-gpu (which never releases its own)
    // and lost afterwards, so no orphan context counts against the browser's
    // live-context limit until GC.
    let gl: WebGLRenderingContext | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        gl = document.createElement("canvas").getContext("webgl");
        const { getGPUTier } = await import("detect-gpu");
        const result = await Promise.race([
            // A late rejection (after the timeout won and the probe was lost) stays quiet.
            getGPUTier({ benchmarksURL: G.benchmarksURL, glContext: gl ?? undefined }).catch(() => null),
            new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), G.timeoutMs);
            }),
        ]);
        if (result) {
            tier = result.tier;
            isMobile = result.isMobile ?? coarse;
        }
    } catch {
        /* keep the fallback tier */
    } finally {
        clearTimeout(timer);
        loseContext(gl);
    }
    return applyNextVisitDprCap(pickProfile(tier, isMobile));
}

/** Releases a probe context now instead of at GC. */
function loseContext(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
    try {
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
        /* already lost / unsupported: nothing to release */
    }
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

/** Runs `fn`, retrying up to `retries` more times before rejecting with the last error. */
export async function withRetries<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt >= retries) throw err;
        }
    }
}

/** WebGL2 probe; its context is lost before returning (see loseContext). */
export function webgl2Available(): boolean {
    try {
        const gl = document.createElement("canvas").getContext("webgl2");
        loseContext(gl);
        return !!gl;
    } catch {
        return false;
    }
}

// ── Quality (§9.3): Menu setting + adaptive downgrade steps ──────────────
export type QualityStep = (typeof CONFIG.quality.steps)[number];

/** What the renderer / world actually uses after the setting and adaptive steps. */
export interface QualityState {
    shadowMapSize: number;
    scenery: SceneryTier;
    /** Scenery InstancedMesh.count multiplier (adaptive "scenery-30"). */
    sceneryScale: number;
    dust: boolean;
}

/**
 * Fixed Quality settings (affect shadows and scenery only, never DPR / MSAA):
 * High = 2048 shadows, Medium = the 1024 downgrade size, Low = no shadow map
 * (blob shadows) and no tyre dust.
 */
const QUALITY_PRESETS: Readonly<Record<Exclude<QualitySetting, "auto">, QualityState>> = Object.freeze({
    high: { shadowMapSize: CONFIG.render.profiles["desktop-high"].shadowMapSize, scenery: "high", sceneryScale: 1, dust: true },
    medium: { shadowMapSize: CONFIG.shadow.downgradedMapSize, scenery: "medium", sceneryScale: 1, dust: true },
    low: { shadowMapSize: 0, scenery: "low", sceneryScale: 1, dust: false },
});

/** The adaptive downgrade steps that apply to a profile ("shadow1024" only with a shadow map). */
export function adaptiveSteps(profile: Pick<RenderProfile, "shadowMapSize">): QualityStep[] {
    return CONFIG.quality.steps.filter((s) => s !== "shadow1024" || profile.shadowMapSize > CONFIG.shadow.downgradedMapSize);
}

/** Resolves the Quality setting (+ the adaptive steps applied under "auto"). Pure. */
export function resolveQuality(
    setting: QualitySetting,
    profile: Pick<RenderProfile, "shadowMapSize" | "scenery">,
    applied: readonly QualityStep[] = []
): QualityState {
    if (setting !== "auto") return { ...QUALITY_PRESETS[setting] };
    const st: QualityState = { shadowMapSize: profile.shadowMapSize, scenery: profile.scenery, sceneryScale: 1, dust: true };
    for (const step of applied) {
        if (step === "shadow1024") st.shadowMapSize = Math.min(st.shadowMapSize, CONFIG.shadow.downgradedMapSize);
        else if (step === "scenery-30") st.sceneryScale = 1 - CONFIG.quality.sceneryReduction;
        else if (step === "dustOff") st.dust = false;
    }
    return st;
}

/** Median of a list (0 when empty). */
export function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Adaptive evaluation interval (s): medians are not recomputed every frame. */
const ADAPTIVE_EVAL_INTERVAL = 1;
/** A median window counts once its samples reach back to within this of its start (s). */
const ADAPTIVE_WINDOW_SLACK = 0.1;

/**
 * Adaptive quality (§9.3). Feed it every frame with the time since Start; it
 * ignores the first 5 s and skipped frames (hidden tab, camera tweens), steps
 * down when the 4 s median frame time exceeds 22 ms, back up after a 10 s
 * median below 14 ms, and changes at most once every 8 s. `level` = the
 * number of steps applied, in order.
 */
export class AdaptiveQuality {
    level = 0;
    private samples: { t: number; ms: number }[] = [];
    private lastChange = -Infinity;
    private lastEval = -Infinity;

    constructor(
        private readonly maxLevel: number,
        private readonly onChange: (level: number) => void
    ) {}

    /** Drops the history and returns to level 0 (setting changed / adaptive off). */
    reset(): void {
        this.samples = [];
        this.lastChange = -Infinity;
        this.lastEval = -Infinity;
        if (this.level !== 0) {
            this.level = 0;
            this.onChange(0);
        }
    }

    sample(t: number, frameMs: number, skip: boolean): void {
        const Q = CONFIG.quality;
        if (skip || t < Q.ignoreFirst) return;
        this.samples.push({ t, ms: frameMs });
        while (this.samples.length && this.samples[0].t < t - Q.upWindow) this.samples.shift();
        if (t - this.lastEval < ADAPTIVE_EVAL_INTERVAL) return;
        this.lastEval = t;
        if (t - this.lastChange < Q.minInterval) return;
        const since = (span: number) => this.samples.filter((s) => s.t >= t - span).map((s) => s.ms);
        // A window only counts once it is fully covered by samples.
        const covers = (span: number) => this.samples.length > 0 && this.samples[0].t <= t - span + ADAPTIVE_WINDOW_SLACK;
        if (this.level < this.maxLevel && covers(Q.downWindow) && median(since(Q.downWindow)) > Q.downMedianMs) {
            this.change(t, this.level + 1);
        } else if (this.level > 0 && covers(Q.upWindow) && median(since(Q.upWindow)) < Q.upMedianMs) {
            this.change(t, this.level - 1);
        }
    }

    private change(t: number, level: number) {
        this.level = level;
        this.lastChange = t;
        this.samples = [];
        this.onChange(level);
    }
}

/**
 * Next-visit DPR fallback (§9.1): on the `mobile` profile, the median frame
 * time over seconds 5–15 after Start decides once whether the NEXT visit caps
 * DPR at 2. Returns true when it wrote the fallback.
 */
export class NextVisitMonitor {
    private samples: number[] = [];
    private done = false;

    constructor(private readonly profile: Pick<RenderProfile, "id">) {}

    sample(t: number, frameMs: number, skip: boolean): boolean {
        const N = CONFIG.render.nextVisit;
        if (this.done || this.profile.id !== "mobile") return false;
        if (t < N.windowStart) return false;
        if (t <= N.windowEnd) {
            if (!skip) this.samples.push(frameMs);
            return false;
        }
        this.done = true;
        if (this.samples.length === 0 || median(this.samples) <= N.medianFrameMs) return false;
        try {
            window.localStorage.setItem(N.storageKey, String(N.dprCap));
        } catch {
            /* storage blocked: nothing to remember */
        }
        return true;
    }
}

/**
 * Computes (and memoises) the scenery plan early; undefined when it throws, so
 * Scenery's own build reports the failure and the world boots without it.
 */
function warmSceneryPlan(): SceneryPlan | undefined {
    try {
        return planScenery();
    } catch (err) {
        console.warn("[world3] scenery plan failed", err);
        return undefined;
    }
}

/** Builds an optional, decorative part of the world; a throw is logged and skipped. */
function optional<T>(name: string, build: () => T): T | null {
    try {
        return build();
    } catch (err) {
        console.error(`[world3] ${name} failed to build; skipping it`, err);
        return null;
    }
}

// ── Experience ───────────────────────────────────────────────────────────
export interface InitOptions {
    profile: RenderProfile;
    reducedMotion: boolean;
    isTouch: boolean;
}

/** Download name for photo mode captures. */
const PHOTO_FILENAME = "jazz-world.png";
/** Frames-per-second readout smoothing (store.live.fps). */
const FPS_SMOOTHING = 0.1;
/** Font-stage jobs reported as they finish: troika preload, typeface JSON, Rapier init. */
const FONT_STAGE_JOBS = 3;

/** Lets the browser paint (the loader bar) between synchronous build steps. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The Wave 1 services, created during init (absent until then). */
interface World {
    renderer: Renderer;
    scene: THREE.Scene;
    physics: Physics;
    materials: Materials;
    assets: Assets;
    env: Environment;
    text: TextSystem;
    text3d: Text3DSystem;
    vehicle: Vehicle;
    dust: TyreDust;
    camera: Camera;
    controls: Controls;
    areas: Areas;
    /** Optional decoration: null when it failed to build (logged; the world still runs). */
    paths: Paths.PathsHandle | null;
    scenery: Scenery | null;
}

export class Experience {
    private disposal = new Disposal();
    /** Teardown in reverse creation order (see own()). */
    private teardown: (() => void)[] = [];
    private time = new Time();
    private tracker: LoadTracker;
    private profile: RenderProfile | null = null;
    private w: World | null = null;
    private audio = new Audio();
    private debug: Debug | null = null;
    private disposed = false;
    private started = false;

    // per-frame state
    private input: VehicleInput = { throttle: 0, steer: 0, handbrake: false, boost: false };
    private rearWheels: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
    private rt: RuntimeInfo | null = null;
    private runClock = 0;
    private fps = 0;
    private quality: QualityState | null = null;
    private adaptive: AdaptiveQuality | null = null;
    private steps: QualityStep[] = [];
    private nextVisit: NextVisitMonitor | null = null;

    // interim markers (until the Wave 2 areas exist)
    private interim = new THREE.Group();
    private interimWords = new Map<AreaId, Word3D>();
    private heroFar = false;

    constructor(
        private canvas: HTMLCanvasElement,
        /** Kept for the frozen API; the canvas itself is measured (utils/sizes.ts). */
        private container: HTMLElement,
        private store: WorldStore
    ) {
        this.tracker = new LoadTracker(store);
        this.interim.name = "interim-markers";
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
        this.own(() => window.clearTimeout(timeout));

        try {
            this.wireCommands();
            this.tracker.report("fonts", 0);

            // 1. Renderer (a throw here is a WebGL failure, not an asset one).
            let renderer: Renderer;
            try {
                renderer = new Renderer(this.canvas, profile, {
                    onContextLost: () => {
                        this.time.stop();
                        this.store.fail("context-lost");
                    },
                    onContextRestored: () => window.location.reload(),
                });
            } catch (err) {
                console.error("[world3] WebGL renderer creation failed", err);
                if (!this.disposed) this.store.fail("webgl");
                return;
            }
            this.own(() => renderer.dispose());

            // 2. Fonts (troika SDF preload + 3D typeface) alongside Rapier's WASM.
            let done = 0;
            const step = <V>(p: Promise<V>) =>
                p.then((v) => {
                    this.tracker.report("fonts", ++done / FONT_STAGE_JOBS);
                    return v;
                });
            const [, font] = await Promise.all([
                step(preloadAll(collectStrings(content))),
                step(loadTypeface()),
                // Retried (§6.2, CONFIG.loading.retries): loadRapier() forgets a failed init.
                step(withRetries(loadRapier, CONFIG.loading.retries)),
            ]);
            if (this.halted()) return;
            this.tracker.complete("fonts");

            // 3. Assets (car required; palm, Nature Kit, avatar optional).
            const scene = new THREE.Scene();
            const physics = new Physics();
            this.own(() => physics.dispose());
            const materials = new Materials();
            this.own(() => materials.dispose());
            const assets = new Assets({
                materials,
                renderer: renderer.instance,
                // The avatar only has a consumer once the About area exists (no 404 until then).
                avatarUrl: registeredAreaIds().includes("about") ? (content.about.avatarModel ?? null) : null,
            });
            this.own(() => assets.dispose());
            this.tracker.report("assets", 0);
            const loadingAssets = assets.load((f) => this.tracker.report("assets", f));
            // The scenery plan (pure maths, memoised per seed) runs while the models download.
            const plan = warmSceneryPlan();
            await loadingAssets;
            if (this.halted()) return;
            this.tracker.complete("assets");

            // 4. Environment, car, camera, controls, text, areas, paths, scenery.
            this.tracker.report("build", 0);
            const world = await this.buildWorld({ renderer, scene, physics, materials, assets, font, profile, isTouch, plan });
            if (!world || this.halted()) return;
            this.tracker.complete("build");

            // 5. Warm-up render (compiles every program before the first real frame).
            this.tracker.report("warmup", 0);
            const { camera } = world;
            renderer.instance.compile(scene, camera.camera);
            renderer.render(scene, camera.camera);
            this.tracker.complete("warmup");
            if (this.halted()) return;

            this.time.onTick((dt, elapsed) => this.tick(dt, elapsed));
            this.time.start();
            this.store.set({ phase: "ready", failReason: undefined });
            void this.maybeDebug();
        } catch (err) {
            console.error("[world3] init failed", err);
            if (!this.disposed && this.store.snapshot.phase !== "failed") this.store.fail("asset");
        } finally {
            window.clearTimeout(timeout);
        }
    }

    /** Synchronous: runs the active interactable from inside the input handler. */
    interact(): void {
        const w = this.w;
        if (!this.started || !w) return;
        const s = this.store.snapshot;
        if (s.phase !== "running" || s.panel || s.mapOpen || s.menuTab !== null) return;
        const ran = w.areas.interact((i) => {
            if (i.content) this.store.set({ panel: i.content });
        });
        if (ran) this.audio.playUi("confirm");
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.time.dispose();
        this.debug?.dispose();
        this.debug = null;
        for (let i = this.teardown.length - 1; i >= 0; i--) {
            try {
                this.teardown[i]();
            } catch (err) {
                console.warn("[world3] teardown step failed", err);
            }
        }
        this.teardown = [];
        this.disposal.dispose();
        this.audio.dispose();
        this.w = null;
    }

    // ── boot helpers ─────────────────────────────────────────────────────
    /** Registers a teardown step (runs at once if the Experience is already disposed). */
    private own(fn: () => void) {
        if (this.disposed) fn();
        else this.teardown.push(fn);
    }

    /** True when init must stop: disposed, or a failure (e.g. context lost) already showed. */
    private halted(): boolean {
        return this.disposed || this.store.snapshot.phase === "failed";
    }

    /**
     * Builds the world in the §10 order, yielding to the UI between steps.
     * Returns null when init must stop (disposed, or a failure showed meanwhile).
     */
    private async buildWorld(o: {
        renderer: Renderer;
        scene: THREE.Scene;
        physics: Physics;
        materials: Materials;
        assets: Assets;
        font: Awaited<ReturnType<typeof loadTypeface>>;
        profile: RenderProfile;
        isTouch: boolean;
        plan: SceneryPlan | undefined;
    }): Promise<World | null> {
        const { renderer, scene, physics, materials, assets, font, profile } = o;
        const size = renderer.size;
        const B = CONFIG.loading.buildSteps;
        /** Reports a finished build step and lets the loader paint; false = stop. */
        const stepDone = async (fraction: number) => {
            this.tracker.report("build", fraction);
            await yieldToUi();
            return !this.halted();
        };

        // Environment owns background, fog, lights, ground slab, walls, quay, water, jetty.
        const env = new Environment({ scene, physics, materials, profile, renderer: renderer.instance });
        this.own(() => env.dispose());
        if (!(await stepDone(B.environment))) return null;
        // The store's value, not init()'s: an OS toggle during loading already updated it.
        const reducedMotion = this.store.snapshot.reducedMotion;

        const text = createTextApi({ isTouch: o.isTouch, aspect: size.aspect, watchWindow: false });
        this.own(() => text.dispose());
        const text3d = createText3D({ font, materials, physics });
        this.own(() => text3d.dispose());

        const vehicle = new Vehicle(
            { physics, materials, disposal: this.disposal, model: assets.model("car"), blobTexture: env.blobTexture("rect") },
            SPAWN
        );
        scene.add(vehicle.root);
        this.own(() => vehicle.dispose());
        vehicle.onTeleport(() => this.afterTeleport());

        const dust = new TyreDust(materials, this.disposal);
        scene.add(dust.mesh);
        this.own(() => dust.dispose());

        const camera = new Camera(this.canvas, {
            aspect: size.aspect,
            reducedMotion,
            focus: SPAWN,
            shot: "intro",
        });
        camera.setInputEnabled(false);
        this.own(() => camera.dispose());
        this.own(
            renderer.onResize((s) => {
                camera.setAspect(s.aspect);
                text.setViewport({ aspect: s.aspect });
            })
        );

        const controls = new Controls(this.canvas, {
            interact: () => this.interact(),
            respawn: () => this.store.commands.respawn(),
            toggleMap: () => {
                if (this.store.snapshot.phase !== "running") return;
                if (this.store.snapshot.mapOpen) this.store.commands.closeMap();
                else this.store.commands.openMap();
            },
            toggleMute: () => {
                if (this.store.snapshot.phase === "running") this.store.commands.setMuted(!this.store.snapshot.muted);
            },
            togglePhotoMode: () => this.store.commands.togglePhotoMode(),
            escape: () => this.escape(),
        });
        controls.setEnabled(false);
        this.own(() => controls.dispose());

        this.own(physics.onImpact((kind, force) => this.audio.playImpact(kind, force)));
        if (!(await stepDone(B.core))) return null;

        // Runtime values exist before the areas build, so builders can hold on to
        // them (ctx.runtime) and read reducedMotion when an animation runs.
        const rt: RuntimeInfo = {
            carPos: vehicle.position,
            carSpeed: 0,
            reducedMotion,
            muted: this.store.snapshot.muted,
            isTouch: o.isTouch,
        };
        this.rt = rt;

        // Areas: the root group is in the scene BEFORE build (words arm on build).
        const commands: WorldCommands = {
            openMenu: (tab) => this.store.commands.openMenu(tab),
            openUrl: (url) => this.store.commands.openUrl(url),
            resetPlayground: () => this.store.commands.resetPlayground(),
        };
        const services: AreaServices = {
            physics,
            materials,
            shapes,
            text,
            text3d,
            assets,
            audio: this.audio,
            commands,
            disposal: this.disposal,
            runtime: rt,
        };
        const areas = new Areas(services);
        scene.add(areas.group);
        this.own(() => areas.dispose());
        areas.build();

        scene.add(this.interim);
        this.own(() => this.interim.removeFromParent());
        this.buildInterimMarkers(areas, text, text3d);
        if (!(await stepDone(B.areas))) return null;

        // Paths: every tile, plus the labels no built area draws itself.
        const paths = optional("paths", () => Paths.build({ materials, text }, { skipOwners: areas.builtIds }));
        if (paths) {
            scene.add(paths.group);
            this.own(() => paths.dispose());
        }
        if (!(await stepDone(B.paths))) return null;

        // Scenery (§2.6). Registered after the Environment, so its teardown runs
        // first (it hides its blob ranges on a live Environment). Tier and density
        // are applied by applyQuality() below.
        const scenery = optional(
            "scenery",
            () => new Scenery({ physics, materials, assets, environment: env, profile, plan: o.plan })
        );
        if (scenery) {
            scene.add(scenery.group);
            this.own(() => scenery.dispose());
        }
        if (!(await stepDone(B.scenery))) return null;

        // Quality: the Menu setting + adaptive steps → shadows, scenery, dust.
        this.steps = adaptiveSteps(profile);
        this.adaptive = new AdaptiveQuality(this.steps.length, () => this.applyQuality());
        this.nextVisit = new NextVisitMonitor(profile);

        const world: World = {
            renderer,
            scene,
            physics,
            materials,
            assets,
            env,
            text,
            text3d,
            vehicle,
            dust,
            camera,
            controls,
            areas,
            paths,
            scenery,
        };
        // Input gating follows the store (Start, dialogs, pause).
        const sync = () => this.syncInput(world);
        this.own(this.store.subscribe(sync));
        sync();
        this.w = world;
        this.applyQuality();
        return world;
    }

    /**
     * Interim markers: every area that has no built area module yet shows its
     * 3D title (the JAZZ hero word and PLAY dynamic, the rest static) at its
     * Layout position, and Welcome's role line while Welcome is absent. An area
     * whose module registered and built (Welcome and Hub since Wave 2a) gets no
     * marker (DECISIONS.md, Wave 1 integration).
     */
    private buildInterimMarkers(areas: Areas, text: TextSystem, text3d: Text3DSystem) {
        const built = new Set(areas.builtIds);
        const TY = CONFIG.type;
        for (const def of AREAS) {
            if (built.has(def.id) || !def.title3D) continue;
            const t = def.title3D;
            const T = def.id === "welcome" ? TY.heroWord : TY.areaTitle;
            const word = text3d.word(t.text, {
                cap: T.cap,
                depth: T.depth,
                curveSegments: T.curveSegments,
                // Dynamic words (hero, PLAY) are ink; static titles their ACCENT_INK (§2.4).
                color: t.dynamic ? PALETTE.ink : def.accentInk,
                dynamic: t.dynamic,
            });
            word.group.position.set(t.x, 0, t.z);
            word.group.rotation.y = FACE_CAMERA_Y;
            this.interim.add(word.group);
            word.reset(); // arm the colliders now (W1-B rule)
            this.interimWords.set(def.id, word);
        }
        if (!built.has("welcome")) {
            const R = TY.roleLine;
            const W = AREA_LAYOUT.welcome.roleLine;
            const role = text.flat({
                text: content.meta.role,
                font: R.font,
                size: R.size,
                letterSpacing: R.letterSpacing,
                color: PALETTE.ink,
                anchorX: "center",
                anchorY: "middle",
            });
            role.object.position.set(W.x, 0, W.z);
            role.object.rotation.y = FACE_CAMERA_Y;
            this.interim.add(role.object);
        }
    }

    private async maybeDebug() {
        const w = this.w;
        if (!w || !new URLSearchParams(window.location.search).has("debug")) return;
        const { Debug } = await import("./Debug");
        if (this.disposed || !this.w) return;
        this.debug = new Debug({
            scene: w.scene,
            camera: w.camera,
            renderer: w.renderer,
            env: w.env,
            physics: w.physics,
            text: w.text,
            qualityInfo: () => {
                const q = this.quality;
                const lvl = this.adaptive?.level ?? 0;
                return q
                    ? `${this.store.snapshot.quality} · shadow ${q.shadowMapSize || "blobs"} · scenery ${q.scenery} ×${q.sceneryScale} · dust ${q.dust ? "on" : "off"} · adaptive ${lvl}/${this.steps.length}`
                    : "";
            },
        });
    }

    // ── commands (everything in WorldCommandSet) ─────────────────────────
    private wireCommands() {
        const store = this.store;
        const running = () => store.snapshot.phase === "running";
        const handlers: Partial<WorldCommandSet> = {
            start: () => this.start(),
            setPaused: (paused) => store.set({ paused }),
            setMuted: (muted) => {
                store.set({ muted });
                this.audio.setMuted(muted);
                if (this.rt) this.rt.muted = muted;
            },
            setReducedMotion: (reducedMotion) => {
                store.set({ reducedMotion });
                this.w?.camera.setReducedMotion(reducedMotion);
                if (this.rt) this.rt.reducedMotion = reducedMotion;
            },
            setQuality: (quality) => {
                store.set({ quality });
                this.adaptive?.reset();
                this.applyQuality();
            },
            setAdaptive: (adaptiveQuality) => {
                store.set({ adaptiveQuality });
                this.adaptive?.reset();
                this.applyQuality();
            },
            travelTo: (id) => this.travelTo(id),
            interact: () => this.interact(),
            closePanel: () => {
                store.set({ panel: null });
                this.audio.playUi("click");
            },
            openMap: () => {
                if (!running()) return;
                store.set({ mapOpen: true });
                this.audio.playUi("click");
            },
            closeMap: () => store.set({ mapOpen: false }),
            openMenu: (menuTab) => {
                if (!running()) return;
                store.set({ menuTab });
                this.audio.playUi("click");
            },
            closeMenu: () => store.set({ menuTab: null }),
            // Synchronous inside the input handler (Safari popup rule, §4.3). No
            // sound here: interact() already plays "confirm" for every pad.
            openUrl: (url) => openExternalUrl(url),
            respawn: () => {
                const w = this.w;
                if (!w || !running()) return;
                w.vehicle.respawn();
                w.camera.snapTo(w.vehicle.position.x, w.vehicle.position.z);
            },
            setTouchInput: (x, y) => this.w?.controls.setTouchInput(x, y),
            setTouchBrake: (on) => this.w?.controls.setTouchBrake(on),
            setTouchBoost: (on) => this.w?.controls.setTouchBoost(on),
            togglePhotoMode: () => {
                if (running()) store.set({ photoMode: !store.snapshot.photoMode });
            },
            capturePhoto: () => this.capturePhoto(),
            resetPlayground: () => {
                const w = this.w;
                if (!w) return;
                w.areas.reset("playground");
                this.interimWords.get("playground")?.reset();
            },
        };
        store.wire(handlers);
    }

    /** Start (inside the click): sound, the car's drop-in, the intro move, board loading. */
    private start() {
        const w = this.w;
        if (!w || this.started || this.store.snapshot.phase !== "ready") return;
        this.started = true;
        // The audio context may only start inside this user gesture.
        this.audio.unlock(this.store.snapshot.muted);
        const spawnArea = areaAt(SPAWN.x, SPAWN.z)?.id ?? null;
        // The spawn area counts as visited without a toast (the Start card was the welcome).
        this.store.set({
            phase: "running",
            areaId: spawnArea,
            visited: spawnArea ? [spawnArea] : [],
        });
        this.runClock = 0;
        w.vehicle.dropIn();
        w.camera.playIntro();
        w.assets.boards.start();
    }

    private travelTo(id: AreaId) {
        const w = this.w;
        if (!w || this.store.snapshot.phase !== "running") return;
        const a = AREA_BY_ID[id].arrival;
        // A content panel left open under the map would cover the new area and keep driving off.
        this.store.set({ mapOpen: false, panel: null });
        // teleport() snaps the interpolation and fires afterTeleport (detect + visited).
        w.vehicle.teleport(a.x, a.z, a.yaw, undefined, id);
        w.camera.flyTo(a.x, a.z);
    }

    /** Escape (when no dialog swallowed it): leave photo mode, close the top layer, or open the menu. */
    private escape() {
        const s = this.store.snapshot;
        const c = this.store.commands;
        if (s.phase !== "running") return;
        if (s.photoMode) c.togglePhotoMode();
        else if (s.menuTab !== null) c.closeMenu();
        else if (s.mapOpen) c.closeMap();
        else if (s.panel) c.closePanel();
        else c.openMenu("settings");
    }

    /** Photo mode (§7): render one frame and read it back in the same tick, inside the click. */
    private capturePhoto() {
        const w = this.w;
        if (!w) return;
        const url = w.renderer.capture(w.scene, w.camera.camera);
        if (!url) return;
        const a = document.createElement("a");
        a.href = url;
        a.download = PHOTO_FILENAME;
        a.click();
        this.audio.playUi("confirm");
    }

    /** Travel, R, fall-off respawn, the Start drop: re-detect the area now and tidy the hero word. */
    private afterTeleport() {
        const w = this.w;
        if (!w) return;
        this.detectArea(w.vehicle.position.x, w.vehicle.position.z);
        this.resetHero();
    }

    /** Hero letters return home after Travel / R (§3.3); Welcome's reset() owns this once it exists. */
    private resetHero() {
        const w = this.w;
        if (!w) return;
        const interimHero = this.interimWords.get("welcome");
        if (interimHero) interimHero.reset();
        else w.areas.reset("welcome");
    }

    private syncInput(w: World) {
        const s = this.store.snapshot;
        const free = s.phase === "running" && !s.paused && s.panel === null && !s.mapOpen && s.menuTab === null;
        w.controls.setEnabled(free);
        w.camera.setInputEnabled(free);
    }

    private applyQuality() {
        const w = this.w;
        const profile = this.profile;
        if (!w || !profile) return;
        const s = this.store.snapshot;
        const adaptiveOn = s.quality === "auto" && s.adaptiveQuality;
        const level = adaptiveOn ? (this.adaptive?.level ?? 0) : 0;
        const q = resolveQuality(s.quality, profile, this.steps.slice(0, level));
        this.quality = q;
        w.env.setShadowMapSize(q.shadowMapSize);
        // §9.3 order: shadow map → scenery −30% (sceneryScale) → tyre dust.
        w.scenery?.setQuality(q);
        w.dust.setEnabled(q.dust);
    }

    // ── per frame ────────────────────────────────────────────────────────
    /** First area (table order) containing (x, z): area chip, first-visit toast + map tick (§2.7). */
    private detectArea(x: number, z: number) {
        const s = this.store.snapshot;
        if (s.phase !== "running") return;
        const def: AreaDef | null = areaAt(x, z);
        const id = def?.id ?? null;
        if (id === s.areaId) return;
        if (id && !s.visited.includes(id)) {
            this.store.set({ areaId: id, visited: [...s.visited, id] });
            const copy = content.areaCopy[id];
            this.store.showToast(`${copy.name} · ${copy.blurb}`);
        } else {
            this.store.set({ areaId: id });
        }
    }

    /** Camera zones (§2.3): the first zone containing the car picks the shot, else "default". */
    private zoneShot(x: number, z: number): CameraShot {
        for (const def of AREAS) {
            if (def.cameraZone && def.cameraShot && pointInRect(def.cameraZone, x, z)) return def.cameraShot;
        }
        return "default";
    }

    private tick(dt: number, elapsed: number) {
        const w = this.w;
        const rt = this.rt;
        if (!w || !rt || w.renderer.isContextLost) return;
        const s = this.store.snapshot;
        const running = s.phase === "running";
        const { vehicle, camera, physics, areas } = w;

        if (!s.paused) {
            const input = w.controls.getInput(this.input);
            const alpha = physics.step(dt, (h) => vehicle.control(h, input));
            physics.interpolate(alpha);
            vehicle.syncVisual(dt);
            w.dust.update(dt, {
                speed: vehicle.speed,
                drifting: vehicle.drifting,
                boosting: vehicle.boosting,
                grounded: vehicle.rearGrounded,
                wheels: vehicle.rearWheelPositions(this.rearWheels),
                velocity: vehicle.velocity,
            });

            rt.carSpeed = vehicle.speed;
            areas.update(dt, elapsed, rt);
            if (running) {
                const p = vehicle.position;
                this.detectArea(p.x, p.z);
                const prompt = areas.active?.prompt ?? null;
                if (prompt !== s.prompt) this.store.set({ prompt });
                camera.setShot(this.zoneShot(p.x, p.z));
                this.heroAutoReset(p);
            }
        }

        camera.update(dt, vehicle.position, vehicle.velocity);
        const focus = camera.state.focus;
        areas.cull(focus.x, focus.z, CONFIG.text.cullDistance);
        w.assets.boards.update(focus.x, focus.z);
        w.env.update(dt, elapsed, camera.state);
        // Scenery between camera and car dithers out; parked before Start and in photo mode.
        if (running && !s.photoMode) setOccluder(camera.camera.position, vehicle.position);
        else clearOccluder();
        this.audio.update(vehicle.speed);
        w.renderer.render(w.scene, camera.camera);

        // Live values for the map arrow (read via rAF, never React state).
        const live = this.store.live;
        live.x = vehicle.position.x;
        live.z = vehicle.position.z;
        live.yaw = vehicle.yaw;
        if (dt > 0) this.fps += (1 / dt - this.fps) * FPS_SMOOTHING;
        live.fps = this.fps;

        if (running) {
            this.runClock += dt;
            const skip = document.hidden || camera.isTweening;
            const frameMs = dt * 1000;
            if (s.quality === "auto" && s.adaptiveQuality) this.adaptive?.sample(this.runClock, frameMs, skip);
            this.nextVisit?.sample(this.runClock, frameMs, document.hidden);
        }
        this.debug?.update(dt);
    }

    /** Interim hero word: letters go home when the car leaves (> 60 units, §3.3). */
    private heroAutoReset(p: THREE.Vector3) {
        const hero = this.interimWords.get("welcome");
        const t = AREA_BY_ID.welcome.title3D;
        if (!hero || !t) return;
        const far = Math.hypot(p.x - t.x, p.z - t.z) > CONFIG.physics.heroLetterResetDistance;
        if (far && !this.heroFar) hero.reset();
        this.heroFar = far;
    }
}
