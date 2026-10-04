import * as THREE from "three";
import { CONFIG, type QualityTier } from "./Config";
import { Renderer, webglAvailable } from "./Renderer";
import { CameraRig } from "./Camera";
import { Physics } from "./Physics";
import { Environment } from "./Environment";
import { Vehicle } from "./Vehicle";
import { Controls } from "./Controls";
import { Assets } from "./Assets";
import { Zones } from "./Zones";
import { Scenery } from "./Scenery";
import { Particles } from "./Particles";
import { Creatures } from "./Creatures";
import { Collectibles } from "./Collectibles";
import { MiniGames } from "./MiniGames";
import { AudioEngine } from "./Audio";
import { Postprocess } from "./Postprocess";
import { Debug } from "./Debug";
import { Sizes } from "./utils/sizes";
import { Time } from "./utils/time";
import { Disposal } from "./utils/disposal";
import { clamp } from "./utils/math";
import type { Store } from "./State";
import type { WorldInteractable } from "./types";

export class Experience {
    private disposal = new Disposal();
    private renderer!: Renderer;
    private scene!: THREE.Scene;
    private rig!: CameraRig;
    private physics!: Physics;
    private assets!: Assets;
    private environment!: Environment;
    private vehicle!: Vehicle;
    private controls!: Controls;
    private zones!: Zones;
    private scenery!: Scenery;
    private particles!: Particles;
    private creatures!: Creatures;
    private collectibles!: Collectibles;
    private minigames!: MiniGames;
    private audio = new AudioEngine();
    private post?: Postprocess;
    private debug?: Debug;
    private sizes!: Sizes;
    private time = new Time();

    private dayTime: number = CONFIG.dayNight.start;
    private quality: QualityTier = "high";
    private reducedMotion = false;
    private paused = false;
    private started = false;
    private fpsAvg = 60;
    private beat = 0;
    private adaptTimer = 0;
    private nearInteractable: WorldInteractable | null = null;

    constructor(
        private canvas: HTMLCanvasElement,
        private container: HTMLElement,
        private store: Store
    ) {}

    async init(quality: QualityTier, reducedMotion: boolean) {
        if (!webglAvailable()) {
            this.store.set({ webglFailed: true, phase: "ready" });
            return;
        }
        this.quality = quality;
        this.reducedMotion = reducedMotion;
        this.store.set({ phase: "loading", loadLabel: "Starting physics", loadProgress: 0.05 });

        await Physics.load();
        this.physics = new Physics();
        this.physics.init();

        this.scene = new THREE.Scene();
        this.renderer = new Renderer(this.canvas);
        this.sizes = new Sizes(this.container);
        this.sizes.setDprCap(CONFIG.quality.dprCap[quality]);
        this.rig = new CameraRig(this.sizes.width / this.sizes.height);
        this.renderer.setSize(this.sizes.width, this.sizes.height, this.sizes.dpr);

        // Assets (real progress 0.1 → 0.75)
        this.store.set({ loadLabel: "Loading world assets", loadProgress: 0.1 });
        this.assets = new Assets(this.renderer.instance, this.disposal, (p, label) => {
            this.store.set({ loadProgress: 0.1 + p * 0.6, loadLabel: label });
        });
        await this.assets.loadAll();
        if (this.assets.envMap) this.scene.environment = this.assets.envMap;

        this.store.set({ loadLabel: "Raising the island", loadProgress: 0.78 });
        this.environment = new Environment(this.physics, this.disposal, this.scene);
        this.scene.add(this.environment.group);
        this.environment.setQuality(quality);
        if (this.assets.waterNormal) this.environment.setWaterNormal(this.assets.waterNormal);

        // Vehicle
        const sx = 0;
        const sz = 30;
        const sy = this.environment.heightAt(sx, sz) + 1.5;
        this.vehicle = new Vehicle(this.physics, this.disposal, new THREE.Vector3(sx, sy, sz), Math.PI);
        this.scene.add(this.vehicle.group);

        // Districts
        this.store.set({ loadLabel: "Lighting the districts", loadProgress: 0.84 });
        this.zones = new Zones(this.disposal, this.physics, this.environment);
        this.scene.add(this.zones.group);
        const avoid = Object.values(this.zones.centers);

        // Scenery, life, collectibles, playground
        this.store.set({ loadLabel: "Planting the island", loadProgress: 0.9 });
        this.scenery = new Scenery(this.assets, this.environment, this.physics, this.disposal, quality, avoid);
        this.scene.add(this.scenery.group);
        this.particles = new Particles(this.disposal, quality);
        this.scene.add(this.particles.group);
        this.creatures = new Creatures(this.assets, this.disposal);
        this.scene.add(this.creatures.group);
        this.collectibles = new Collectibles(this.environment, this.disposal, avoid);
        this.scene.add(this.collectibles.group);
        this.minigames = new MiniGames(this.physics, this.assets, this.environment, this.disposal);
        this.scene.add(this.minigames.group);

        // Audio (buffers only; playback starts on Enter gesture)
        this.store.set({ loadLabel: "Cueing the music", loadProgress: 0.95 });
        await this.audio.load();

        // Postprocessing
        if (quality !== "low") {
            try {
                this.post = new Postprocess(
                    this.renderer.instance,
                    this.scene,
                    this.rig.camera,
                    this.sizes.width,
                    this.sizes.height,
                    quality
                );
            } catch {
                this.post = undefined; // fall back to direct rendering
            }
        }

        // Input
        this.controls = new Controls({
            onInteract: () => this.handleInteract(),
            onRespawn: () => this.vehicle.respawn(),
            onPhotoMode: () => this.togglePhotoMode(),
            onPause: () => this.setPaused(!this.paused),
            onMuteToggle: () => this.setMuted(!this.store.snapshot.muted),
            onHelp: () => this.store.commands.openCredits?.(),
        });
        this.controls.setEnabled(false);

        this.sizes.onResize((w, h, dpr) => {
            this.renderer.setSize(w, h, dpr);
            this.rig.setAspect(w / h);
            this.post?.setSize(w, h);
        });

        if (Debug.active()) {
            this.debug = new Debug({
                onQuality: (q) => this.setQuality(q),
                onTimeScrub: (t) => (this.dayTime = t),
                onToggleRain: () => this.particles.toggleRain(),
            });
        }

        this.wireCommands();
        this.time.onTick(this.tick);
        this.time.start();

        this.store.set({
            phase: "ready",
            loadProgress: 1,
            loadLabel: "Ready",
            collectiblesTotal: this.collectibles.total,
            zones: this.zones.zones.map((z) => ({ ...z })),
        });
    }

    private wireCommands() {
        const c = this.store.commands;
        c.start = () => this.start();
        c.setPaused = (p) => this.setPaused(p);
        c.setMuted = (m) => this.setMuted(m);
        c.setReducedMotion = (r) => {
            this.reducedMotion = r;
            this.store.set({ reducedMotion: r });
        };
        c.setQuality = (q) => this.setQuality(q);
        c.setAdaptive = (a) => this.store.set({ adaptiveQuality: a });
        c.respawn = () => this.vehicle.respawn();
        c.resetPlayground = () => this.minigames.reset();
        c.setTouchInput = (x, y, boost) => this.controls.setTouch(x, y, boost);
        c.setTouchHandbrake = (on) => this.controls.touchHandbrake(on);
        c.interact = () => this.handleInteract();
        c.closePanel = () => {
            this.store.set({ panel: null });
            this.audio.playUi("ui_click");
        };
        c.openCredits = () => this.store.set({ creditsOpen: true });
        c.closeCredits = () => this.store.set({ creditsOpen: false });
        c.togglePhotoMode = () => this.togglePhotoMode();
        c.toggleRain = () => this.particles.toggleRain();
        c.capturePhoto = () => this.capturePhoto();
        c.fastTravel = (id) => this.fastTravel(id);
        c.setDayTime = (t) => {
            this.dayTime = t;
        };
    }

    private start() {
        if (this.started) return;
        this.started = true;
        this.audio.start();
        this.store.set({ phase: "running", muted: this.store.snapshot.muted });
    }

    private setPaused(p: boolean) {
        this.paused = p;
        this.controls.setEnabled(!p && this.started && !this.rig.isIntro);
        this.store.set({ paused: p });
    }

    private setMuted(m: boolean) {
        this.audio.setMuted(m);
        this.store.set({ muted: m });
    }

    setQuality(q: QualityTier) {
        this.quality = q;
        this.sizes.setDprCap(CONFIG.quality.dprCap[q]);
        this.renderer.applyQuality(q);
        this.environment.setQuality(q);
        // rebuild postprocessing to match (bloom/ssao toggles)
        this.post?.dispose();
        this.post = undefined;
        if (q !== "low") {
            try {
                this.post = new Postprocess(
                    this.renderer.instance,
                    this.scene,
                    this.rig.camera,
                    this.sizes.width,
                    this.sizes.height,
                    q
                );
            } catch {
                this.post = undefined;
            }
        }
        this.store.set({ quality: q });
    }

    private handleInteract() {
        if (this.store.snapshot.panel) return; // already open
        const it = this.nearInteractable;
        if (!it) return;
        if (it.onInteract) {
            it.onInteract();
            this.audio.playUi("ui_confirm");
            return;
        }
        if (it.content) {
            this.store.set({ panel: it.content });
            this.audio.playUi("ui_confirm");
            if (it.zoneId) this.markVisited(it.zoneId);
        }
    }

    private markVisited(id: string) {
        const z = this.zones.zones.find((zz) => zz.id === id);
        if (z && !z.visited) {
            z.visited = true;
            this.store.set({ zones: this.zones.zones.map((zz) => ({ ...zz })) });
        }
    }

    private fastTravel(id: string) {
        const center = this.zones.centers[id];
        if (!center) return;
        this.store.set({ panel: null, paused: false });
        // place the car just outside the district, facing in
        const toCenter = new THREE.Vector3(center.x, 0, center.z).normalize();
        const spot = new THREE.Vector3(center.x, 0, center.z).addScaledVector(toCenter, 20);
        spot.y = this.environment.heightAt(spot.x, spot.z);
        const yaw = Math.atan2(center.x - spot.x, center.z - spot.z);
        this.vehicle.teleport(spot, yaw);
        // cinematic swoop
        const camPos = spot.clone().addScaledVector(toCenter, 16);
        camPos.y += 14;
        this.rig.flyTo(camPos, center.clone(), () => this.markVisited(id));
        this.audio.playUi("ui_confirm");
    }

    private togglePhotoMode() {
        const on = !this.store.snapshot.photoMode;
        this.store.set({ photoMode: on });
        this.audio.playUi("ui_click");
    }

    private capturePhoto() {
        // render one clean frame then export
        if (this.post) this.post.render(this.time.delta);
        else this.renderer.instance.render(this.scene, this.rig.camera);
        try {
            const url = this.canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = url;
            a.download = `eko-nights-${Date.now()}.png`;
            a.click();
        } catch {
            /* tainted canvas / blocked download */
        }
    }

    private updateInteractions(carPos: THREE.Vector3) {
        let best: WorldInteractable | null = null;
        let bestD = Infinity;
        for (const it of this.zones.interactables) {
            const d = Math.hypot(carPos.x - it.position.x, carPos.z - it.position.z);
            if (d < it.radius && d < bestD) {
                best = it;
                bestD = d;
            }
        }
        this.nearInteractable = best;
        const snap = this.store.snapshot;
        if (best && !snap.panel) {
            if (snap.prompt?.title !== best.prompt.title) this.store.set({ prompt: best.prompt });
        } else if (snap.prompt) {
            this.store.set({ prompt: null });
        }
    }

    private tick = (dt: number, elapsed: number) => {
        if (this.store.snapshot.webglFailed) return;
        this.debug?.begin();

        const fps = 1 / Math.max(dt, 1e-4);
        this.fpsAvg += (fps - this.fpsAvg) * 0.1;

        const panelOpen = !!this.store.snapshot.panel;
        const simActive = this.started && !this.paused && !this.rig.isIntro && !panelOpen;

        if (this.started && !this.paused && CONFIG.dayNight.autoAdvance && !this.debug) {
            this.dayTime = (this.dayTime + dt * CONFIG.dayNight.speed) % 1;
        }

        if (simActive) {
            const input = this.controls.getInput();
            this.vehicle.control(dt, input);
            this.physics.step(dt);
            this.vehicle.sync();
            this.minigames.update();
        } else if (this.started && !this.paused && !panelOpen) {
            this.physics.step(dt);
            this.vehicle.sync();
            this.minigames.update();
        }

        if (this.started && !this.rig.isIntro)
            this.controls.setEnabled(!this.paused && !panelOpen);

        const pos = this.vehicle.position;
        const fwd = this.vehicle.forward;

        // audio + beat
        this.beat = this.audio.update(dt, this.vehicle.speed, this.rig.camera.position, fwd);

        // interactions + collectibles
        if (simActive) {
            this.updateInteractions(pos);
            const orb = this.collectibles.tryCollect(pos, CONFIG.collectibles.radius + 2.5);
            if (orb) {
                const found = [...this.store.snapshot.foundWords, `${orb.word} — ${orb.meaning}`];
                this.store.set({
                    collectiblesFound: this.store.snapshot.collectiblesFound + 1,
                    foundWords: found,
                });
                this.audio.playUi("ui_confirm");
            }
        }

        // camera
        this.rig.update(dt, pos, fwd, this.vehicle.speed, this.reducedMotion);

        // world systems
        const night = clamp(-Math.sin(this.dayTime * Math.PI * 2) * 1.4 + 0.25, 0, 1);
        this.environment.update(dt, elapsed, this.dayTime, pos);
        this.zones.update(elapsed, this.nearInteractable?.halo ?? null, this.beat);
        this.scenery.update(elapsed, this.beat);
        this.particles.update(dt, elapsed, night, pos);
        this.creatures.update(elapsed, pos);
        this.collectibles.update(elapsed);

        // HUD (high-frequency → non-reactive live channel)
        const live = this.store.live;
        live.x = pos.x;
        live.z = pos.z;
        live.angle = Math.atan2(fwd.x, fwd.z);
        live.speedKmh = Math.round(Math.abs(this.vehicle.speed) * 3.6);
        live.fps = Math.round(this.fpsAvg);
        live.dayTime = this.dayTime;

        this.adaptQuality(dt);

        if (this.post) this.post.render(dt);
        else this.renderer.instance.render(this.scene, this.rig.camera);

        this.debug?.end();
    };

    private adaptQuality(dt: number) {
        if (!this.store.snapshot.adaptiveQuality || !this.started) return;
        const q = CONFIG.quality;
        if (this.fpsAvg < q.adaptDownFps && this.quality !== "low") {
            this.adaptTimer += dt;
            if (this.adaptTimer > q.adaptWindow) {
                this.adaptTimer = 0;
                this.setQuality(this.quality === "high" ? "medium" : "low");
            }
        } else {
            this.adaptTimer = Math.max(0, this.adaptTimer - dt);
        }
    }

    skipIntro() {
        this.rig.skipIntro();
    }

    dispose() {
        this.time.dispose();
        this.controls?.dispose();
        this.rig?.dispose();
        this.post?.dispose();
        this.debug?.dispose();
        this.audio.dispose();
        this.sizes?.dispose();
        this.disposal.dispose();
        this.physics?.dispose();
        this.renderer?.dispose();
        this.scene?.clear();
    }
}
