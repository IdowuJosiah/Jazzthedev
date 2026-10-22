import * as THREE from "three";
import {
    CONFIG,
    LOOK,
    PALETTE,
    type ClockTime,
    type EffectiveTime,
    type HexColor,
    type LookPreset,
    type TimeMode,
} from "./Config";
import type { LambertOptions, MaterialsApi } from "./types";
import type { WaterColors } from "./shaders/water";
import { clamp, smoothstep } from "./utils/math";

// ─────────────────────────────────────────────────────────────────────────
// Day / night switching (owner decision: the world switches between day and
// night, and stays crisp). One eased factor t ∈ [0, 1] (0 = day, 1 = night)
// drives everything; no emissives, no bloom, no post-processing:
//
// - lights, background + fog, water: LOOK[CONFIG.look] → LOOK.night, blended
//   in linear colour space and handed to Environment.setLook();
// - albedos of the ground and the plazas (the shared palette materials listed
//   in CONFIG.dayNight.albedoMaterials), so the night text and paper plates read;
// - the shared unlit pad materials of pads on bare ground
//   (CONFIG.dayNight.padMaterials: idle outline ink → paper, active fill
//   paper → ink, so the paper night labels stay readable on them);
// - text colours: TextSystem / Text3DSystem.setNightFactor(t) (ground text
//   ink → paper, accents → their light variants; ink on paper stays ink);
// - the lamps (Lamps.setNight) and the headlights (an injected callback, e.g.
//   the vehicle's setNightFactor).
//
// Mode: "auto" (the visitor's local clock, re-checked every minute), "day" or
// "night"; persisted in localStorage (every access guarded). A mode change eases
// t over CONFIG.dayNight.transitionSeconds (smoothstep), instantly under
// reduced motion. Boot starts at the resolved state (no fade on load).
//
// Lights that are hidden by day (lamp PointLights, the headlight) change the
// lit programs' light count when they first show: prewarm(compile) applies the
// night state, runs `compile` (renderer.compile) and restores, so the first
// switch never stalls on shader compiles.
//
//   const dn = new DayNight({ environment: env, materials, text, text3d, lamps,
//       setHeadlights: (t) => vehicle.setNightFactor(t),
//       reducedMotion: () => rt.reducedMotion,
//       onChange: ({ mode, effective }) => store.set({ timeMode: mode, effectiveTime: effective }) });
//   store.set({ timeMode: dn.mode, effectiveTime: dn.effective });
//   dn.prewarm(() => renderer.compile(scene, camera));   // during the warm-up
//   dn.update(dt);   // every frame
//   dn.setMode("night");
//   dn.dispose();
// ─────────────────────────────────────────────────────────────────────────

export type { TimeMode, EffectiveTime };

const DN = CONFIG.dayNight;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const TIME_MODES: readonly TimeMode[] = ["auto", "day", "night"];

// ── Clock window (pure) ──────────────────────────────────────────────────
export interface DayWindow {
    dayStart: ClockTime;
    dayEnd: ClockTime;
}

export const minutesOf = (t: ClockTime): number => t.h * MINUTES_PER_HOUR + t.m;

/**
 * True when `date` (local time) falls in the day window: dayStart inclusive,
 * dayEnd exclusive. A window that wraps midnight (start > end) is supported.
 */
export function isDaytime(date: Date, window: DayWindow = DN.autoWindow): boolean {
    const m = date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
    const s = minutesOf(window.dayStart);
    const e = minutesOf(window.dayEnd);
    return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** The time of day a mode shows now. */
export function resolveEffective(mode: TimeMode, date: Date, window: DayWindow = DN.autoWindow): EffectiveTime {
    if (mode !== "auto") return mode;
    return isDaytime(date, window) ? "day" : "night";
}

export const isTimeMode = (v: unknown): v is TimeMode => TIME_MODES.includes(v as TimeMode);

// ── Persistence (pure, guarded) ──────────────────────────────────────────
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** window.localStorage, or null when it is absent or access throws (privacy modes). */
export function defaultStorage(): StorageLike | null {
    try {
        return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
    } catch {
        return null;
    }
}

/** The stored mode, or null (nothing stored, an unknown value, or storage throwing). */
export function readStoredMode(storage: StorageLike | null, key: string = DN.storageKey): TimeMode | null {
    if (!storage) return null;
    try {
        const v = storage.getItem(key);
        return isTimeMode(v) ? v : null;
    } catch {
        return null;
    }
}

/** Stores the mode; false when storage is missing or throws (quota, privacy modes). */
export function writeStoredMode(storage: StorageLike | null, mode: TimeMode, key: string = DN.storageKey): boolean {
    if (!storage) return false;
    try {
        storage.setItem(key, mode);
        return true;
    } catch {
        return false;
    }
}

// ── Easing (pure) ────────────────────────────────────────────────────────
/**
 * Moves the linear progress p toward `target` (0 or 1) by dt / seconds;
 * `instant` (reduced motion) or a non-positive duration jumps straight there.
 */
export function stepProgress(p: number, target: number, dt: number, seconds: number, instant: boolean): number {
    if (instant || seconds <= 0) return target;
    const step = Math.max(0, dt) / seconds;
    return target > p ? Math.min(target, p + step) : Math.max(target, p - step);
}

/** The eased night factor for a linear progress (smoothstep, so it starts and ends at rest). */
export const easeNight = (p: number): number => smoothstep(0, 1, clamp(p, 0, 1));

// ── Look blending ────────────────────────────────────────────────────────
/** A look resolved to linear THREE.Colors (what the lights, fog and uniforms take). */
export interface BlendedLook {
    background: THREE.Color;
    hemisphere: { sky: THREE.Color; ground: THREE.Color; intensity: number };
    sun: { color: THREE.Color; intensity: number };
    fill: { color: THREE.Color; intensity: number };
    water: WaterColors;
    albedo: { ground: THREE.Color; plaza: THREE.Color };
}

/** Resolves a preset (THREE.Color converts the sRGB hex to linear). */
export function createBlendedLook(look: LookPreset = LOOK[CONFIG.look]): BlendedLook {
    const c = (hex: HexColor) => new THREE.Color(hex);
    return {
        background: c(look.background),
        hemisphere: { sky: c(look.hemisphere.sky), ground: c(look.hemisphere.ground), intensity: look.hemisphere.intensity },
        sun: { color: c(look.sun.color), intensity: look.sun.intensity },
        fill: { color: c(look.fill.color), intensity: look.fill.intensity },
        water: { shallow: c(look.water.shallow), mid: c(look.water.mid), deep: c(look.water.deep), foam: c(look.water.foam) },
        albedo: { ground: c(look.albedo.ground), plaza: c(look.albedo.plaza) },
    };
}

const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;

/** out = mix(a, b, t) for every colour (linear space) and intensity; allocation-free. */
export function blendResolved(a: BlendedLook, b: BlendedLook, t: number, out: BlendedLook): BlendedLook {
    out.background.lerpColors(a.background, b.background, t);
    out.hemisphere.sky.lerpColors(a.hemisphere.sky, b.hemisphere.sky, t);
    out.hemisphere.ground.lerpColors(a.hemisphere.ground, b.hemisphere.ground, t);
    out.hemisphere.intensity = lerpNum(a.hemisphere.intensity, b.hemisphere.intensity, t);
    out.sun.color.lerpColors(a.sun.color, b.sun.color, t);
    out.sun.intensity = lerpNum(a.sun.intensity, b.sun.intensity, t);
    out.fill.color.lerpColors(a.fill.color, b.fill.color, t);
    out.fill.intensity = lerpNum(a.fill.intensity, b.fill.intensity, t);
    out.water.shallow.lerpColors(a.water.shallow, b.water.shallow, t);
    out.water.mid.lerpColors(a.water.mid, b.water.mid, t);
    out.water.deep.lerpColors(a.water.deep, b.water.deep, t);
    out.water.foam.lerpColors(a.water.foam, b.water.foam, t);
    out.albedo.ground.lerpColors(a.albedo.ground, b.albedo.ground, t);
    out.albedo.plaza.lerpColors(a.albedo.plaza, b.albedo.plaza, t);
    return out;
}

/** Convenience for tests / Debug: blends two presets at t. */
export function blendLook(a: LookPreset, b: LookPreset, t: number, out?: BlendedLook): BlendedLook {
    return blendResolved(createBlendedLook(a), createBlendedLook(b), clamp(t, 0, 1), out ?? createBlendedLook(a));
}

// ── DayNight ─────────────────────────────────────────────────────────────
/** Environment.setLook (lights, background + fog, water). */
export interface LookTarget {
    setLook(look: Readonly<BlendedLook>): void;
}

/** TextSystem / Text3DSystem. */
export interface NightFactorTarget {
    setNightFactor(t: number): void;
}

export interface DayNightState {
    mode: TimeMode;
    effective: EffectiveTime;
}

export interface DayNightDeps {
    environment?: LookTarget;
    /** Shared palette materials whose albedo follows the look (CONFIG.dayNight.albedoMaterials). */
    materials?: MaterialsApi;
    text?: NightFactorTarget;
    text3d?: NightFactorTarget;
    lamps?: { setNight(t: number): void };
    /** Vehicle headlights, e.g. `(t) => vehicle.setNightFactor?.(t)`. */
    setHeadlights?: (t: number) => void;
    /** Read whenever a mode change starts a transition (Menu / OS toggles apply live). */
    reducedMotion?: () => boolean;
    /** undefined → window.localStorage (guarded); null → no persistence. */
    storage?: StorageLike | null;
    /** Clock (tests); default `new Date()`. */
    now?: () => Date;
    /** Initial mode, overriding the stored one (e.g. a ?time= URL param). */
    mode?: TimeMode;
    /** Fires when the mode or the effective time changes (not on construction). */
    onChange?: (state: DayNightState) => void;
}

type AlbedoKey = keyof LookPreset["albedo"];

interface AlbedoMaterial {
    key: AlbedoKey;
    material: THREE.MeshLambertMaterial;
    day: HexColor;
}

/** A shared unlit pad material and its two colours (linear). */
interface PadMaterial {
    material: THREE.MeshBasicMaterial;
    dayHex: HexColor;
    day: THREE.Color;
    night: THREE.Color;
}

export class DayNight {
    private storage: StorageLike | null;
    private now: () => Date;
    private _mode: TimeMode;
    private _effective: EffectiveTime;
    /** Linear progress toward the target (0 day, 1 night); t = easeNight(progress). */
    private progress: number;
    private _t: number;
    private appliedT = Number.NaN;
    private lastClockCheck: number;
    private dayLook = createBlendedLook(LOOK[CONFIG.look]);
    private nightLook = createBlendedLook(LOOK.night);
    private blended = createBlendedLook(LOOK[CONFIG.look]);
    private albedo: AlbedoMaterial[] = [];
    private pads: PadMaterial[] = [];
    private disposed = false;

    constructor(private deps: DayNightDeps = {}) {
        this.storage = deps.storage === undefined ? defaultStorage() : deps.storage;
        this.now = deps.now ?? (() => new Date());
        this._mode = deps.mode ?? readStoredMode(this.storage) ?? DN.defaultMode;
        const date = this.now();
        this.lastClockCheck = date.getTime();
        this._effective = resolveEffective(this._mode, date);
        // Boot shows the resolved time straight away (no fade while loading).
        this.progress = this.target;
        this._t = easeNight(this.progress);
        this.collectMaterials();
        this.apply();
    }

    /** The chosen mode ("auto" follows the clock). */
    get mode(): TimeMode {
        return this._mode;
    }

    /** What the world is heading to (or showing): day or night. */
    get effective(): EffectiveTime {
        return this._effective;
    }

    /** The current eased night factor, 0 (day) … 1 (night). */
    get t(): number {
        return this._t;
    }

    get state(): DayNightState {
        return { mode: this._mode, effective: this._effective };
    }

    /** The blended look applied last (read-only; ?debug readouts). */
    get look(): Readonly<BlendedLook> {
        return this.blended;
    }

    /** Sets the mode, persists it and starts the transition (instant under reduced motion). */
    setMode(mode: TimeMode): void {
        if (this.disposed || !isTimeMode(mode)) return;
        const changed = mode !== this._mode;
        this._mode = mode;
        writeStoredMode(this.storage, mode);
        const effectiveChanged = this.recheck();
        if (changed || effectiveChanged) this.deps.onChange?.(this.state);
        // Reduced motion: jump now, so the next frame (or a paused world) is already right.
        if (this.reducedMotion()) this.advance(0);
    }

    /** The HUD sun / moon button: the opposite of what shows, as an explicit mode. */
    toggle(): void {
        this.setMode(this._effective === "night" ? "day" : "night");
    }

    /**
     * Compiles the night variants of the lit programs ahead of time: applies
     * full night (lamp lights and the headlight visible), runs `compile` (e.g.
     * `() => renderer.compile(scene, camera)`), then restores the current state.
     * three keeps every program a material has used, so later switches are free.
     */
    prewarm(compile: () => void): void {
        if (this.disposed) return;
        const t = this._t;
        try {
            this._t = 1;
            this.apply();
            compile();
        } finally {
            this._t = t;
            this.apply();
        }
    }

    /** Per frame: re-checks the clock in auto mode, eases t, applies a changed t. */
    update(dt: number): void {
        if (this.disposed) return;
        if (this._mode === "auto") {
            const nowMs = this.now().getTime();
            // abs(): a clock set backwards re-checks too.
            if (Math.abs(nowMs - this.lastClockCheck) >= DN.clockCheckSeconds * MS_PER_SECOND) {
                if (this.recheck()) this.deps.onChange?.(this.state);
            }
        }
        this.advance(dt);
    }

    /**
     * Restores the shared palette materials to their day albedo (they outlive
     * this module) and stops. Owners of the other targets dispose them.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const a of this.albedo) a.material.color.set(a.day);
        for (const p of this.pads) p.material.color.set(p.dayHex);
        this.albedo = [];
        this.pads = [];
    }

    // ── internals ────────────────────────────────────────────────────────
    private get target(): number {
        return this._effective === "night" ? 1 : 0;
    }

    private reducedMotion(): boolean {
        return this.deps.reducedMotion?.() ?? false;
    }

    /** Re-resolves the effective time from the clock; true when it changed. */
    private recheck(): boolean {
        const date = this.now();
        this.lastClockCheck = date.getTime();
        const next = resolveEffective(this._mode, date);
        if (next === this._effective) return false;
        this._effective = next;
        return true;
    }

    private advance(dt: number): void {
        this.progress = stepProgress(this.progress, this.target, dt, DN.transitionSeconds, this.reducedMotion());
        this._t = easeNight(this.progress);
        if (this._t !== this.appliedT) this.apply();
    }

    /** The shared palette materials this module recolours (same cache keys as their users). */
    private collectMaterials(): void {
        const materials = this.deps.materials;
        if (!materials) return;
        const seen = new Set<THREE.Material>();
        for (const key of Object.keys(DN.albedoMaterials) as AlbedoKey[]) {
            const day = PALETTE[key];
            for (const variant of DN.albedoMaterials[key] as readonly LambertOptions[]) {
                // Same cache key as the areas / Environment use, so this is THEIR material.
                const material = materials.lambert(day, variant);
                if (seen.has(material)) continue;
                seen.add(material);
                this.albedo.push({ key, material, day });
            }
        }
        for (const p of DN.padMaterials) {
            const material = materials.basic(p.hex, { layer: p.layer, opacity: p.opacity });
            if (seen.has(material)) continue;
            seen.add(material);
            this.pads.push({ material, dayHex: p.hex, day: new THREE.Color(p.hex), night: new THREE.Color(p.night) });
        }
    }

    private apply(): void {
        const t = this._t;
        this.appliedT = t;
        const look = blendResolved(this.dayLook, this.nightLook, t, this.blended);
        this.deps.environment?.setLook(look);
        for (const a of this.albedo) a.material.color.copy(look.albedo[a.key]);
        for (const p of this.pads) p.material.color.lerpColors(p.day, p.night, t);
        this.deps.text?.setNightFactor(t);
        this.deps.text3d?.setNightFactor(t);
        this.deps.lamps?.setNight(t);
        this.deps.setHeadlights?.(t);
    }
}
