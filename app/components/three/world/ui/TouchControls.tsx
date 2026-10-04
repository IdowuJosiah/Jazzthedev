"use client";

import { useCallback, useRef, useState } from "react";
import type { Store } from "../State";

const R = 56; // joystick radius in px

/** On-screen joystick (steer + throttle) and action buttons for touch devices. */
export default function TouchControls({ store }: { store: Store }) {
    const baseRef = useRef<HTMLDivElement>(null);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const active = useRef(false);
    const boost = useRef(false);
    const vec = useRef({ x: 0, y: 0 });

    const send = useCallback(() => {
        store.commands.setTouchInput?.(vec.current.x, vec.current.y, boost.current);
    }, [store]);

    const move = useCallback(
        (clientX: number, clientY: number) => {
            const base = baseRef.current;
            if (!base) return;
            const r = base.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            let dx = clientX - cx;
            let dy = clientY - cy;
            const len = Math.hypot(dx, dy);
            if (len > R) {
                dx = (dx / len) * R;
                dy = (dy / len) * R;
            }
            setKnob({ x: dx, y: dy });
            vec.current = { x: dx / R, y: -dy / R };
            send();
        },
        [send]
    );

    const onStart = useCallback(
        (e: React.PointerEvent) => {
            active.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            move(e.clientX, e.clientY);
        },
        [move]
    );
    const onMove = useCallback(
        (e: React.PointerEvent) => {
            if (active.current) move(e.clientX, e.clientY);
        },
        [move]
    );
    const onEnd = useCallback(() => {
        active.current = false;
        setKnob({ x: 0, y: 0 });
        vec.current = { x: 0, y: 0 };
        send();
    }, [send]);

    const holdBoost = useCallback(
        (on: boolean) => () => {
            boost.current = on;
            send();
        },
        [send]
    );
    const holdBrake = useCallback(
        (on: boolean) => () => store.commands.setTouchHandbrake?.(on),
        [store]
    );

    return (
        <div className="eko-touch">
            <div
                ref={baseRef}
                className="eko-joy-base"
                onPointerDown={onStart}
                onPointerMove={onMove}
                onPointerUp={onEnd}
                onPointerCancel={onEnd}
            >
                <div className="eko-joy-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
            </div>
            <div className="eko-touch-actions">
                <button
                    className="eko-touch-btn eko-touch-e"
                    onPointerDown={() => store.commands.interact?.()}
                    aria-label="Interact"
                >
                    E
                </button>
                <button
                    className="eko-touch-btn eko-touch-boost"
                    onPointerDown={holdBoost(true)}
                    onPointerUp={holdBoost(false)}
                    onPointerCancel={holdBoost(false)}
                    aria-label="Boost"
                >
                    ⏵⏵
                </button>
                <button
                    className="eko-touch-btn eko-touch-drift"
                    onPointerDown={holdBrake(true)}
                    onPointerUp={holdBrake(false)}
                    onPointerCancel={holdBrake(false)}
                    aria-label="Drift"
                >
                    ✦
                </button>
            </div>
        </div>
    );
}
