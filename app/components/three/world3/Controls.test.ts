import { describe, expect, it } from "vitest";
import { Controls, isFormControl, type ControlHandlers, type ControlsEnv, type FocusLike } from "./Controls";

/** Fake window/document pair: records listeners so tests can dispatch plain key objects. */
function setup() {
    const winL = new Map<string, (e: unknown) => void>();
    const docL = new Map<string, (e: unknown) => void>();
    const doc = {
        activeElement: null as FocusLike | null,
        hidden: false,
        addEventListener: (t: string, fn: (e: unknown) => void) => docL.set(t, fn),
        removeEventListener: (t: string) => docL.delete(t),
    };
    const env = {
        win: {
            addEventListener: (t: string, fn: (e: unknown) => void) => winL.set(t, fn),
            removeEventListener: (t: string) => winL.delete(t),
        },
        doc,
    } as unknown as ControlsEnv;
    const calls: string[] = [];
    const handlers: ControlHandlers = {
        interact: () => calls.push("interact"),
        respawn: () => calls.push("respawn"),
        toggleMap: () => calls.push("map"),
        toggleMute: () => calls.push("mute"),
        togglePhotoMode: () => calls.push("photo"),
        escape: () => calls.push("escape"),
    };
    const canvas: FocusLike = { tagName: "CANVAS" };
    const controls = new Controls(canvas, handlers, env);
    const key = (type: "keydown" | "keyup", code: string, k: string, extra: Record<string, unknown> = {}) => {
        let prevented = false;
        winL.get(type)!({ code, key: k, repeat: false, preventDefault: () => (prevented = true), ...extra });
        return prevented;
    };
    return { controls, calls, doc, winL, docL, canvas, key };
}

describe("isFormControl", () => {
    it("matches buttons, inputs, textareas, selects and contenteditable", () => {
        for (const tagName of ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "button"]) {
            expect(isFormControl({ tagName })).toBe(true);
        }
        expect(isFormControl({ tagName: "DIV", isContentEditable: true })).toBe(true);
        expect(isFormControl({ tagName: "SPAN", closest: () => ({}) })).toBe(true);
        expect(isFormControl({ tagName: "CANVAS", closest: () => null })).toBe(false);
        expect(isFormControl(null)).toBe(false);
    });
});

describe("Controls (§4.3)", () => {
    it("drives by physical key code, so WASD works on AZERTY (Z/Q labels)", () => {
        const { controls, key } = setup();
        // AZERTY: the physical W key is labelled Z, the physical A key is labelled Q.
        key("keydown", "KeyW", "z");
        key("keydown", "KeyA", "q");
        expect(controls.getInput()).toEqual({ throttle: 1, steer: -1, handbrake: false, boost: false });
        key("keyup", "KeyW", "z");
        key("keydown", "KeyS", "s");
        key("keydown", "KeyD", "d");
        key("keyup", "KeyA", "q");
        expect(controls.getInput()).toMatchObject({ throttle: -1, steer: 1 });
        key("keydown", "ShiftLeft", "Shift");
        key("keydown", "Space", " ");
        expect(controls.getInput()).toMatchObject({ boost: true, handbrake: true });
    });

    it("uses the key label for mnemonics (M is the key labelled M)", () => {
        const { calls, key } = setup();
        // AZERTY: the label "m" sits on the physical Semicolon key.
        key("keydown", "Semicolon", "m");
        key("keydown", "KeyN", "N", { shiftKey: true });
        key("keydown", "KeyP", "p");
        key("keydown", "KeyR", "r");
        key("keydown", "KeyE", "e");
        key("keydown", "Enter", "Enter");
        key("keydown", "Escape", "Escape");
        expect(calls).toEqual(["map", "mute", "photo", "respawn", "interact", "interact", "escape"]);
    });

    it("interacts synchronously and ignores auto-repeat", () => {
        const { calls, key } = setup();
        key("keydown", "KeyE", "e");
        expect(calls).toEqual(["interact"]); // already ran inside the handler
        key("keydown", "KeyE", "e", { repeat: true });
        key("keydown", "Enter", "Enter", { repeat: true });
        expect(calls).toEqual(["interact"]);
    });

    it("ignores keys while a form control has focus, except Escape", () => {
        const { controls, calls, doc, key } = setup();
        doc.activeElement = { tagName: "BUTTON" };
        key("keydown", "Enter", "Enter");
        key("keydown", "Space", " ");
        key("keydown", "KeyW", "w");
        key("keydown", "KeyM", "m");
        expect(calls).toEqual([]);
        expect(controls.getInput().throttle).toBe(0);
        key("keydown", "Escape", "Escape");
        expect(calls).toEqual(["escape"]);
    });

    it("ignores keys while a link (or the summary sheet) has focus: Enter never runs interact", () => {
        const { controls, calls, doc, canvas, key } = setup();
        doc.activeElement = { tagName: "A" };
        key("keydown", "Enter", "Enter");
        key("keydown", "KeyW", "w");
        key("keydown", "ArrowUp", "ArrowUp");
        expect(calls).toEqual([]);
        expect(controls.getInput().throttle).toBe(0);
        doc.activeElement = { tagName: "SECTION" };
        key("keydown", "KeyE", "e");
        expect(calls).toEqual([]);
        // The world owns the keys again on the canvas or <body>.
        doc.activeElement = { tagName: "BODY" };
        key("keydown", "KeyE", "e");
        doc.activeElement = canvas;
        key("keydown", "Enter", "Enter");
        expect(calls).toEqual(["interact", "interact"]);
    });

    it("prevents default for Space / arrows only while the canvas has focus", () => {
        const { doc, canvas, key } = setup();
        expect(key("keydown", "Space", " ")).toBe(false);
        expect(key("keydown", "ArrowUp", "ArrowUp")).toBe(false);
        doc.activeElement = canvas;
        expect(key("keydown", "Space", " ")).toBe(true);
        expect(key("keydown", "ArrowLeft", "ArrowLeft")).toBe(true);
        expect(key("keydown", "KeyW", "w")).toBe(false);
    });

    it("leaves browser shortcuts alone (Cmd+R, Ctrl+P)", () => {
        const { calls, key } = setup();
        key("keydown", "KeyR", "r", { metaKey: true });
        key("keydown", "KeyP", "p", { ctrlKey: true });
        expect(calls).toEqual([]);
    });

    it("clears held input on blur and when the tab is hidden", () => {
        const { controls, winL, docL, doc, key } = setup();
        key("keydown", "KeyW", "w");
        winL.get("blur")!({});
        expect(controls.getInput().throttle).toBe(0);
        key("keydown", "KeyW", "w");
        controls.setTouchInput(0.5, 0.5);
        doc.hidden = true;
        docL.get("visibilitychange")!({});
        expect(controls.getInput()).toEqual({ throttle: 0, steer: 0, handbrake: false, boost: false });
    });

    it("never sticks a drive key pressed under Cmd (macOS drops its keyup)", () => {
        const { controls, key } = setup();
        key("keydown", "MetaLeft", "Meta", { metaKey: true });
        key("keydown", "KeyA", "a", { metaKey: true });
        key("keyup", "MetaLeft", "Meta");
        expect(controls.getInput()).toEqual({ throttle: 0, steer: 0, handbrake: false, boost: false });
        // Held before Cmd went down, released while it was down: Cmd's keyup clears it.
        key("keydown", "KeyD", "d");
        key("keydown", "MetaRight", "Meta", { metaKey: true });
        key("keyup", "MetaRight", "Meta");
        expect(controls.getInput().steer).toBe(0);
    });

    it("tolerates keydown events with no key and skips IME composition", () => {
        const { controls, calls, key } = setup();
        expect(() => key("keydown", "KeyW", undefined as unknown as string)).not.toThrow();
        expect(controls.getInput().throttle).toBe(1);
        key("keyup", "KeyW", "w");
        key("keydown", "KeyE", "e", { isComposing: true });
        key("keydown", "KeyS", "s", { isComposing: true });
        expect(calls).toEqual([]);
        expect(controls.getInput().throttle).toBe(0);
    });

    it("touch joystick overrides keys while active; brake and boost buttons merge", () => {
        const { controls, key } = setup();
        key("keydown", "KeyW", "w");
        controls.setTouchInput(0.4, -2);
        expect(controls.getInput()).toMatchObject({ throttle: -1, steer: 0.4 });
        controls.setTouchInput(0, 0);
        expect(controls.getInput().throttle).toBe(1);
        controls.setTouchBrake(true);
        controls.setTouchBoost(true);
        expect(controls.getInput()).toMatchObject({ handbrake: true, boost: true });
    });

    it("setEnabled(false) stops driving, interact and respawn but not map / Escape", () => {
        const { controls, calls, key } = setup();
        key("keydown", "KeyW", "w");
        controls.setEnabled(false);
        expect(controls.getInput().throttle).toBe(0);
        key("keydown", "KeyW", "w");
        key("keydown", "KeyE", "e");
        key("keydown", "KeyR", "r");
        key("keydown", "KeyM", "m");
        key("keydown", "Escape", "Escape");
        expect(calls).toEqual(["map", "escape"]);
        controls.setEnabled(true);
        expect(controls.getInput().throttle).toBe(0);
    });

    it("removes its listeners on dispose", () => {
        const { controls, winL, docL } = setup();
        controls.dispose();
        expect(winL.size).toBe(0);
        expect(docL.size).toBe(0);
    });
});
