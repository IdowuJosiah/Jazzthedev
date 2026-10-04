import type { QualityTier } from "./Config";
import type { InfoContent } from "@/app/field/content/world";

// Shared, reactive state between the three.js engine and the React UI.
// React reads it via useSyncExternalStore; the engine mutates via set().

export interface Prompt {
    title: string;
    sub: string;
    kind: "zone" | "collectible" | "minigame" | "credits";
}

export interface WorldState {
    phase: "boot" | "loading" | "ready" | "running";
    loadProgress: number; // 0..1
    loadLabel: string;
    quality: QualityTier;
    adaptiveQuality: boolean;
    muted: boolean;
    paused: boolean;
    reducedMotion: boolean;
    photoMode: boolean;
    webglFailed: boolean;

    collectiblesFound: number;
    collectiblesTotal: number;
    foundWords: string[]; // Yoruba words collected (for the HUD list)

    prompt: Prompt | null; // nearest interactable hint
    panel: InfoContent | null; // open content panel
    creditsOpen: boolean;

    zones: { id: string; name: string; x: number; z: number; color: number; visited: boolean }[];
}

/** High-frequency values the engine writes every frame; read via rAF, never
 *  through React state, so the UI doesn't re-render 60×/second. */
export interface LiveState {
    x: number;
    z: number;
    angle: number;
    speedKmh: number;
    fps: number;
    dayTime: number;
}

export type Listener = () => void;

const initial: WorldState = {
    phase: "boot",
    loadProgress: 0,
    loadLabel: "Warming up",
    quality: "high",
    adaptiveQuality: true,
    muted: true,
    paused: false,
    reducedMotion: false,
    photoMode: false,
    webglFailed: false,
    collectiblesFound: 0,
    collectiblesTotal: 0,
    foundWords: [],
    prompt: null,
    panel: null,
    creditsOpen: false,
    zones: [],
};

export class Store {
    private state: WorldState = { ...initial };
    private listeners = new Set<Listener>();

    /** Mutated every frame by the engine; read via rAF, not React. */
    live: LiveState = { x: 0, z: 0, angle: 0, speedKmh: 0, fps: 0, dayTime: 0.72 };

    get snapshot(): WorldState {
        return this.state;
    }

    subscribe = (fn: Listener) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
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

    // ── Commands the UI dispatches back to the engine (wired by Experience) ──
    commands: {
        start?: () => void;
        setQuality?: (q: QualityTier) => void;
        setMuted?: (m: boolean) => void;
        setPaused?: (p: boolean) => void;
        setReducedMotion?: (r: boolean) => void;
        setAdaptive?: (a: boolean) => void;
        togglePhotoMode?: () => void;
        fastTravel?: (zoneId: string) => void;
        interact?: () => void;
        closePanel?: () => void;
        openCredits?: () => void;
        closeCredits?: () => void;
        respawn?: () => void;
        setTouchInput?: (x: number, y: number, boost: boolean) => void;
        setTouchHandbrake?: (on: boolean) => void;
        capturePhoto?: () => void;
        toggleRain?: () => void;
        resetPlayground?: () => void;
        setDayTime?: (t: number) => void;
    } = {};
}
