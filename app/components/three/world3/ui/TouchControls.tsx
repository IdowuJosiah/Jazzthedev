"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LuZap } from "react-icons/lu";
import type { WorldStore } from "../State";
import type { Prompt } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Touch controls (§6.2): a joystick on the left (steer + throttle), Boost
// (LuZap) and Brake on the right, and an "E" button that appears only while a
// pad is in range. It is the only tappable E (the HUD prompt card shows a kbd
// chip), named from the prompt's action. E calls interact() synchronously
// inside its click handler so popups opened by contact pads are allowed (§4.3).
// ─────────────────────────────────────────────────────────────────────────

const JOY_BASE = 120;
const JOY_KNOB = 52;

/** Joystick geometry in CSS px (base 120, knob 52; §6.2). Stream-local: Config has no touch block. */
export const TOUCH = {
    baseSize: JOY_BASE,
    knobSize: JOY_KNOB,
    /** Knob travel from the centre: (base − knob) / 2. */
    travel: (JOY_BASE - JOY_KNOB) / 2,
    /** Input below this fraction of full travel reads as zero (thumb jitter). */
    deadZone: 0.08,
} as const;

/**
 * Joystick drag (dx, dy in px from the base centre; +dy is down) → the engine
 * input vector: x = steer (right +), y = throttle (up +). Clamped to the unit
 * circle, with a radial dead zone rescaled so the output still reaches 1.
 */
export function joystickVector(dx: number, dy: number, travel: number = TOUCH.travel, deadZone: number = TOUCH.deadZone) {
    const len = Math.hypot(dx, dy) / travel;
    if (len <= deadZone || !Number.isFinite(len)) return { x: 0, y: 0 };
    const mag = Math.min(1, (Math.min(len, 1) - deadZone) / (1 - deadZone));
    const nx = dx / (len * travel);
    const ny = -dy / (len * travel);
    return { x: nx * mag, y: ny * mag };
}

/** Knob offset in whole px, clamped to the travel radius. */
export function knobOffset(dx: number, dy: number, travel: number = TOUCH.travel) {
    const len = Math.hypot(dx, dy);
    const k = len > travel ? travel / len : 1;
    return { x: Math.round(dx * k), y: Math.round(dy * k) };
}

interface TouchControlsProps {
    store: WorldStore;
    prompt: Prompt | null;
}

export default function TouchControls({ store, prompt }: TouchControlsProps) {
    const baseRef = useRef<HTMLDivElement>(null);
    const pointerId = useRef<number | null>(null);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const [boost, setBoost] = useState(false);
    const [brake, setBrake] = useState(false);

    // Release everything when the controls unmount (panel / map / menu opened).
    // store.commands is read at call time: the engine may re-wire it after mount.
    useEffect(
        () => () => {
            store.commands.setTouchInput(0, 0);
            store.commands.setTouchBoost(false);
            store.commands.setTouchBrake(false);
        },
        [store]
    );

    const moveTo = (clientX: number, clientY: number) => {
        const base = baseRef.current;
        if (!base) return;
        const r = base.getBoundingClientRect();
        const dx = clientX - (r.left + r.width / 2);
        const dy = clientY - (r.top + r.height / 2);
        setKnob(knobOffset(dx, dy));
        const v = joystickVector(dx, dy);
        store.commands.setTouchInput(v.x, v.y);
    };

    const onJoyDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerId.current !== null) return;
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e.clientX, e.clientY);
    };
    const onJoyMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerId === pointerId.current) moveTo(e.clientX, e.clientY);
    };
    const onJoyEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerId !== pointerId.current) return;
        pointerId.current = null;
        setKnob({ x: 0, y: 0 });
        store.commands.setTouchInput(0, 0);
    };

    const hold = (set: (on: boolean) => void, command: (on: boolean) => void) => ({
        onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            set(true);
            command(true);
        },
        onPointerUp: () => {
            set(false);
            command(false);
        },
        onPointerCancel: () => {
            set(false);
            command(false);
        },
        onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
    });

    return (
        <div className="w3-touch">
            <div
                ref={baseRef}
                className="w3-joy"
                role="presentation"
                onPointerDown={onJoyDown}
                onPointerMove={onJoyMove}
                onPointerUp={onJoyEnd}
                onPointerCancel={onJoyEnd}
            >
                <div className="w3-joy-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
            </div>
            <div className="w3-touch-actions">
                {prompt && (
                    <button
                        type="button"
                        className="w3-touch-btn w3-touch-e"
                        aria-label={`${prompt.action}: ${prompt.title}`}
                        onClick={() => store.commands.interact()}
                    >
                        E
                    </button>
                )}
                <div className="w3-touch-row">
                    <button
                        type="button"
                        className={`w3-touch-btn${brake ? " is-held" : ""}`}
                        aria-label="Brake"
                        aria-pressed={brake}
                        {...hold(setBrake, (on) => store.commands.setTouchBrake(on))}
                    >
                        Brake
                    </button>
                    <button
                        type="button"
                        className={`w3-touch-btn${boost ? " is-held" : ""}`}
                        aria-label="Boost"
                        aria-pressed={boost}
                        {...hold(setBoost, (on) => store.commands.setTouchBoost(on))}
                    >
                        <LuZap size={20} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
}
