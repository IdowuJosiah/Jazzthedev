import type { VehicleInput } from "./Vehicle";
import { clamp } from "./utils/math";

// ─────────────────────────────────────────────────────────────────────────
// Controls (§4.3): keyboard + touch → one VehicleInput, plus discrete actions.
//
// - Movement uses `e.code` (physical WASD / arrows / Shift / Space), so it works
//   on AZERTY and other layouts.
// - Mnemonic shortcuts use `e.key` (lower-cased): E/Enter interact, R respawn,
//   M map, N mute, P photo mode, Escape menu / close the top layer.
// - Keys are ignored while a form control has focus (button, input, textarea,
//   select, [contenteditable]) — except Escape — so Enter/Space never fire twice.
// - preventDefault only for Space and the arrows, and only while the canvas has focus.
// - Interact runs SYNCHRONOUSLY inside the keydown handler (Safari popup rule)
//   and ignores auto-repeat.
// - Held input clears on window blur, when the tab is hidden and when Cmd is
//   released (macOS drops keyups under Cmd); drive keys pressed with Cmd are ignored.
// ─────────────────────────────────────────────────────────────────────────

export interface ControlHandlers {
    /** E / Enter. Runs inside the keydown handler — never deferred. */
    interact(): void;
    /** R. */
    respawn(): void;
    /** M. */
    toggleMap(): void;
    /** N. */
    toggleMute(): void;
    /** P. */
    togglePhotoMode(): void;
    /** Escape: open the menu, or close the topmost panel / map. */
    escape(): void;
}

type DrivingAction = "forward" | "back" | "left" | "right" | "boost" | "brake";
export type DiscreteAction = "interact" | "respawn" | "map" | "mute" | "photo" | "escape";

/** Physical keys (KeyboardEvent.code) → driving action. */
export const DRIVE_CODES: Readonly<Record<string, DrivingAction>> = Object.freeze({
    KeyW: "forward",
    ArrowUp: "forward",
    KeyS: "back",
    ArrowDown: "back",
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right",
    ShiftLeft: "boost",
    ShiftRight: "boost",
    Space: "brake",
});

/** Labelled keys (KeyboardEvent.key, lower-cased) → discrete action. */
export const ACTION_KEYS: Readonly<Record<string, DiscreteAction>> = Object.freeze({
    e: "interact",
    enter: "interact",
    r: "respawn",
    m: "map",
    n: "mute",
    p: "photo",
    escape: "escape",
});

/** Codes whose browser default (page scroll) is suppressed while the canvas has focus. */
const SCROLL_CODES: ReadonlySet<string> = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** Cmd / Windows keys: releasing one clears held driving keys (see onKeyUp). */
const META_CODES: ReadonlySet<string> = new Set(["MetaLeft", "MetaRight"]);

const FORM_TAGS: ReadonlySet<string> = new Set(["BUTTON", "INPUT", "TEXTAREA", "SELECT"]);

/** Duck-typed so it is testable without a DOM. */
export interface FocusLike {
    tagName?: string;
    isContentEditable?: boolean;
    closest?(selector: string): unknown;
}

/** True when keyboard focus is in a form control or editable content (§4.3). */
export function isFormControl(el: FocusLike | null | undefined): boolean {
    if (!el) return false;
    if (el.tagName && FORM_TAGS.has(el.tagName.toUpperCase())) return true;
    if (el.isContentEditable) return true;
    return !!el.closest?.("[contenteditable]:not([contenteditable='false'])");
}

export interface KeyLike {
    code: string;
    /** Missing on some autofill / synthetic events despite the DOM typing. */
    key?: string;
    repeat: boolean;
    isComposing?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    preventDefault(): void;
}

interface Listenable {
    addEventListener(type: string, fn: (e: never) => void): void;
    removeEventListener(type: string, fn: (e: never) => void): void;
}

/** The DOM surfaces Controls listens on; `window` / `document` by default. */
export interface ControlsEnv {
    win: Listenable;
    doc: Listenable & { readonly activeElement: FocusLike | null; readonly hidden: boolean };
}

// DOM listener overloads don't unify with the duck-typed surface; the shapes match at runtime.
const defaultEnv = (): ControlsEnv => ({
    win: window as unknown as ControlsEnv["win"],
    doc: document as unknown as ControlsEnv["doc"],
});

export class Controls {
    private held = new Set<DrivingAction>();
    private touch = { x: 0, y: 0, active: false, brake: false, boost: false };
    private enabled = true;
    private env: ControlsEnv;
    private disposed = false;

    constructor(
        /** The world canvas (focus target); Space / arrows are only swallowed while it has focus. */
        private canvas: FocusLike,
        private handlers: ControlHandlers,
        env?: ControlsEnv
    ) {
        this.env = env ?? defaultEnv();
        this.env.win.addEventListener("keydown", this.onKeyDown);
        this.env.win.addEventListener("keyup", this.onKeyUp);
        this.env.win.addEventListener("blur", this.clear);
        this.env.doc.addEventListener("visibilitychange", this.onVisibility);
    }

    /**
     * Driving, interact and respawn on/off (e.g. before Start, while a panel is
     * open). Map / mute / photo / Escape keep working. Disabling clears held input.
     */
    setEnabled(on: boolean) {
        this.enabled = on;
        if (!on) this.clear();
    }

    // ── touch (React overlay → store commands → here) ────────────────────
    /** Joystick vector in [−1, 1]² (x = steer, y = throttle); (0, 0) releases it. */
    setTouchInput(x: number, y: number) {
        this.touch.x = clamp(x, -1, 1);
        this.touch.y = clamp(y, -1, 1);
        this.touch.active = this.touch.x !== 0 || this.touch.y !== 0;
    }

    setTouchBrake(on: boolean) {
        this.touch.brake = on;
    }

    setTouchBoost(on: boolean) {
        this.touch.boost = on;
    }

    /** Clears every held key and touch input. */
    clear = () => {
        this.held.clear();
        this.touch.x = 0;
        this.touch.y = 0;
        this.touch.active = false;
        this.touch.brake = false;
        this.touch.boost = false;
    };

    /** The current driving input (touch joystick overrides keys while active). */
    getInput(out: VehicleInput = { throttle: 0, steer: 0, handbrake: false, boost: false }): VehicleInput {
        if (!this.enabled) {
            out.throttle = 0;
            out.steer = 0;
            out.handbrake = false;
            out.boost = false;
            return out;
        }
        const h = this.held;
        let throttle = (h.has("forward") ? 1 : 0) - (h.has("back") ? 1 : 0);
        let steer = (h.has("right") ? 1 : 0) - (h.has("left") ? 1 : 0);
        if (this.touch.active) {
            throttle = this.touch.y;
            steer = this.touch.x;
        }
        out.throttle = clamp(throttle, -1, 1);
        out.steer = clamp(steer, -1, 1);
        out.handbrake = h.has("brake") || this.touch.brake;
        out.boost = h.has("boost") || this.touch.boost;
        return out;
    }

    // ── keyboard ─────────────────────────────────────────────────────────
    private onKeyDown = (e: KeyLike) => {
        // IME composition keystrokes are text input, not driving.
        if (e.isComposing) return;
        // Autofill and some synthetic events dispatch keydown with no `key`.
        const key = (e.key ?? "").toLowerCase();
        const action = ACTION_KEYS[key];
        if (isFormControl(this.env.doc.activeElement) && action !== "escape") return;

        const drive = DRIVE_CODES[e.code];
        if (drive) {
            if (this.env.doc.activeElement === this.canvas && SCROLL_CODES.has(e.code)) e.preventDefault();
            // macOS sends no keyup for a key released while Cmd is down, so a
            // Cmd+A / Cmd+S / Cmd+D chord would leave the key stuck in `held`.
            if (this.enabled && !e.metaKey) this.held.add(drive);
            return;
        }

        // Browser / OS shortcuts (Cmd+R, Ctrl+P…) are not ours.
        if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
        // Toggles and interact fire once per press, never on auto-repeat.
        if (e.repeat) return;
        switch (action) {
            case "interact":
                if (this.enabled) this.handlers.interact();
                return;
            case "respawn":
                if (this.enabled) this.handlers.respawn();
                return;
            case "map":
                this.handlers.toggleMap();
                return;
            case "mute":
                this.handlers.toggleMute();
                return;
            case "photo":
                this.handlers.togglePhotoMode();
                return;
            case "escape":
                this.handlers.escape();
                return;
        }
    };

    private onKeyUp = (e: KeyLike) => {
        // Always release, even if focus moved into a form control meanwhile.
        const drive = DRIVE_CODES[e.code];
        if (drive) this.held.delete(drive);
        // Keys released while Cmd was down never sent their keyup (macOS): drop them all.
        else if (META_CODES.has(e.code)) this.held.clear();
    };

    private onVisibility = () => {
        if (this.env.doc.hidden) this.clear();
    };

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.env.win.removeEventListener("keydown", this.onKeyDown);
        this.env.win.removeEventListener("keyup", this.onKeyUp);
        this.env.win.removeEventListener("blur", this.clear);
        this.env.doc.removeEventListener("visibilitychange", this.onVisibility);
        this.clear();
    }
}
