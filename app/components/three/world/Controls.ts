import type { VehicleInput } from "./Vehicle";
import { clamp } from "./utils/math";

export interface ControlHandlers {
    onInteract: () => void;
    onRespawn: () => void;
    onPhotoMode: () => void;
    onPause: () => void;
    onMuteToggle: () => void;
    onHelp: () => void;
}

/**
 * Unifies keyboard, and a touch/virtual-joystick layer, into one VehicleInput.
 * Discrete actions (interact/respawn/etc.) fire through handlers. A window blur
 * or tab-hide clears all held inputs so the car never drifts off on its own.
 */
export class Controls {
    private keys = new Set<string>();
    private touch = { x: 0, y: 0, boost: false, active: false };
    private handlers: ControlHandlers;
    private enabled = true;

    constructor(handlers: ControlHandlers) {
        this.handlers = handlers;
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
        window.addEventListener("blur", this.clear);
        document.addEventListener("visibilitychange", this.onVisibility);
    }

    setEnabled(on: boolean) {
        this.enabled = on;
        if (!on) this.clear();
    }

    /** Called by the React virtual joystick. x,y in -1..1 (y up = forward). */
    setTouch(x: number, y: number, boost: boolean) {
        this.touch.x = clamp(x, -1, 1);
        this.touch.y = clamp(y, -1, 1);
        this.touch.boost = boost;
        this.touch.active = x !== 0 || y !== 0 || boost;
    }

    touchInteract() {
        this.handlers.onInteract();
    }
    touchHandbrake(on: boolean) {
        if (on) this.keys.add("handbrake");
        else this.keys.delete("handbrake");
    }

    private onVisibility = () => {
        if (document.hidden) this.clear();
    };

    private clear = () => {
        this.keys.clear();
        this.touch.x = this.touch.y = 0;
        this.touch.boost = this.touch.active = false;
    };

    private onKeyDown = (e: KeyboardEvent) => {
        // let typing in inputs pass through
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const k = e.key.toLowerCase();
        if (!this.enabled && !["escape"].includes(k)) return;

        switch (k) {
            case "e":
            case "enter":
                this.handlers.onInteract();
                return;
            case "r":
                this.handlers.onRespawn();
                return;
            case "p":
                this.handlers.onPhotoMode();
                return;
            case "m":
                this.handlers.onMuteToggle();
                return;
            case "h":
            case "?":
                this.handlers.onHelp();
                return;
            case "escape":
                this.handlers.onPause();
                return;
        }
        if (k === " ") e.preventDefault();
        this.keys.add(k);
    };

    private onKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.key.toLowerCase());
    };

    getInput(): VehicleInput {
        const k = this.keys;
        let throttle = 0;
        let steer = 0;
        if (k.has("w") || k.has("arrowup")) throttle += 1;
        if (k.has("s") || k.has("arrowdown")) throttle -= 1;
        if (k.has("a") || k.has("arrowleft")) steer -= 1;
        if (k.has("d") || k.has("arrowright")) steer += 1;

        // merge touch (touch overrides when active)
        if (this.touch.active) {
            throttle = this.touch.y;
            steer = this.touch.x;
        }

        const boost = k.has("shift") || this.touch.boost;
        const handbrake = k.has(" ") || k.has("handbrake");
        return {
            throttle: clamp(throttle, -1, 1),
            steer: clamp(steer, -1, 1),
            handbrake,
            boost,
        };
    }

    dispose() {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        window.removeEventListener("blur", this.clear);
        document.removeEventListener("visibilitychange", this.onVisibility);
    }
}
