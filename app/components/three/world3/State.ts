import type { QualitySetting } from "./Config";
import { CONFIG } from "./Config";
import type { AreaId, MenuTab, Prompt } from "./types";
import type { InfoContent } from "@/app/field/content/world";

// Shared, reactive state between the v3 engine and the React UI.
// React reads it via useSyncExternalStore; the engine mutates via set().

export type WorldPhase = "boot" | "loading" | "ready" | "running" | "failed";
export type FailReason = "webgl" | "context-lost" | "timeout" | "asset";

export interface Toast {
    /** Monotonic id so identical consecutive toasts still re-trigger. */
    id: number;
    text: string;
}

export interface GlossaryWord {
    word: string;
    meaning: string;
    pron?: string;
}

export interface WorldState {
    // ── kept from v2 ──
    phase: WorldPhase;
    loadProgress: number; // 0..1, only ever increases
    loadLabel: string;
    quality: QualitySetting;
    adaptiveQuality: boolean;
    muted: boolean;
    paused: boolean;
    reducedMotion: boolean;
    photoMode: boolean;
    webglFailed: boolean;
    prompt: Prompt | null; // active interactable hint (HTML prompt card)
    panel: InfoContent | null; // open content panel

    // ── added in v3 ──
    failReason?: FailReason;
    areaId: AreaId | null;
    visited: AreaId[];
    mapOpen: boolean;
    menuTab: MenuTab | null;
    toast: Toast | null;
    words: GlossaryWord[];
    wordsTotal: number;
    isTouch: boolean;
}

/** High-frequency values the engine writes every frame; read via rAF, never
 *  through React state, so the UI doesn't re-render 60×/second. */
export interface LiveState {
    x: number;
    z: number;
    yaw: number;
    fps: number;
}

/** Everything the UI can ask the engine to do. Experience wires real handlers. */
export interface WorldCommandSet {
    start(): void;
    setPaused(p: boolean): void;
    setMuted(m: boolean): void;
    setReducedMotion(r: boolean): void;
    setQuality(q: QualitySetting): void;
    setAdaptive(a: boolean): void;
    travelTo(id: AreaId): void;
    /** Synchronous: call straight from the key / click handler. */
    interact(): void;
    closePanel(): void;
    openMap(): void;
    closeMap(): void;
    openMenu(tab: MenuTab): void;
    closeMenu(): void;
    /** Synchronous: window.open(url, "_blank", "noopener"), or location.href for mailto:. */
    openUrl(url: string): void;
    respawn(): void;
    /** Joystick vector in [−1, 1]² (x = steer, y = throttle). */
    setTouchInput(x: number, y: number): void;
    setTouchBrake(on: boolean): void;
    setTouchBoost(on: boolean): void;
    togglePhotoMode(): void;
    capturePhoto(): void;
    resetPlayground(): void;
}

export type Listener = () => void;

/**
 * Opens an external link. Must run inside a user-input handler (Safari blocks
 * popups opened from the render loop). mailto:/tel: navigate in place.
 */
export function openExternalUrl(url: string): void {
    if (typeof window === "undefined") return;
    if (/^(mailto|tel):/i.test(url)) {
        window.location.href = url;
        return;
    }
    window.open(url, "_blank", "noopener");
}

export const initialWorldState = (): WorldState => ({
    phase: "boot",
    loadProgress: 0,
    loadLabel: CONFIG.loading.stages.fonts.label,
    quality: CONFIG.quality.default,
    adaptiveQuality: CONFIG.quality.adaptive,
    muted: true,
    paused: false,
    reducedMotion: false,
    photoMode: false,
    webglFailed: false,
    prompt: null,
    panel: null,
    failReason: undefined,
    areaId: null,
    visited: [],
    mapOpen: false,
    menuTab: null,
    toast: null,
    words: [],
    wordsTotal: 0,
    isTouch: false,
});

const noop = () => {};

/** Default commands: inert until Experience wires them (openUrl works standalone). */
const defaultCommands = (store: WorldStore): WorldCommandSet => ({
    start: noop,
    setPaused: (paused) => store.set({ paused }),
    setMuted: (muted) => store.set({ muted }),
    setReducedMotion: (reducedMotion) => store.set({ reducedMotion }),
    setQuality: (quality) => store.set({ quality }),
    setAdaptive: (adaptiveQuality) => store.set({ adaptiveQuality }),
    travelTo: noop,
    interact: noop,
    closePanel: () => store.set({ panel: null }),
    openMap: () => store.set({ mapOpen: true }),
    closeMap: () => store.set({ mapOpen: false }),
    openMenu: (menuTab) => store.set({ menuTab }),
    closeMenu: () => store.set({ menuTab: null }),
    openUrl: openExternalUrl,
    respawn: noop,
    setTouchInput: noop,
    setTouchBrake: noop,
    setTouchBoost: noop,
    togglePhotoMode: () => store.set({ photoMode: !store.snapshot.photoMode }),
    capturePhoto: noop,
    resetPlayground: noop,
});

export class WorldStore {
    private state: WorldState = initialWorldState();
    private listeners = new Set<Listener>();
    private toastSeq = 0;

    /** Mutated every frame by the engine; read via rAF, not React. */
    live: LiveState = { x: 0, z: 0, yaw: 0, fps: 0 };

    /** UI → engine. Experience replaces entries with real handlers. */
    commands: WorldCommandSet = defaultCommands(this);

    get snapshot(): WorldState {
        return this.state;
    }

    subscribe = (fn: Listener) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };

    getSnapshot = () => this.state;

    set(patch: Partial<WorldState>) {
        // Shallow-equality guard so the UI only re-renders on real changes.
        let changed = false;
        for (const k in patch) {
            const key = k as keyof WorldState;
            if (!Object.is(this.state[key], patch[key])) {
                changed = true;
                break;
            }
        }
        if (!changed) return;
        this.state = { ...this.state, ...patch };
        for (const fn of this.listeners) fn();
    }

    /** Sets loadProgress without ever going backwards. */
    setProgress(progress: number, label?: string) {
        const loadProgress = Math.max(this.state.loadProgress, Math.min(1, progress));
        this.set(label === undefined ? { loadProgress } : { loadProgress, loadLabel: label });
    }

    showToast(text: string) {
        this.set({ toast: { id: ++this.toastSeq, text } });
    }

    fail(reason: FailReason) {
        this.set({ phase: "failed", failReason: reason, webglFailed: reason === "webgl" });
    }

    /** Wires engine handlers (partial: unspecified commands keep their defaults). */
    wire(handlers: Partial<WorldCommandSet>) {
        this.commands = { ...this.commands, ...handlers };
    }
}
