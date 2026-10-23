"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Interactive elements that grow the ring (a `data-cursor` label wins over these). */
const LINKISH = "a, button, [role='button'], summary, label";
const TEXTISH = "input, textarea, select, [contenteditable='true']";
/** Ring easing toward the pointer per frame (the dot follows exactly). */
const RING_EASE = 0.18;

/**
 * A dot plus a trailing ring that inverts what is under it. Over links the
 * ring fills; over anything with `data-cursor="View ↗"` it becomes a blue
 * label. Only for fine pointers, never on the 3D world, never under reduced
 * motion (the native cursor stays in all of those cases).
 */
export default function Cursor() {
    const onField = usePathname() === "/field";
    const dotRef = useRef<HTMLDivElement>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const dot = dotRef.current;
        const ring = ringRef.current;
        const label = labelRef.current;
        if (onField || !dot || !ring || !label) return;
        const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!fine || reduced) return;

        const root = document.documentElement;
        root.classList.add("has-cursor");
        let x = -100;
        let y = -100;
        let rx = x;
        let ry = y;
        let shown = false;
        let raf = 0;

        const show = (on: boolean) => {
            shown = on;
            dot.classList.toggle("is-visible", on);
            ring.classList.toggle("is-visible", on);
        };
        const onMove = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            x = e.clientX;
            y = e.clientY;
            if (!shown) {
                rx = x;
                ry = y;
                show(true);
            }
        };
        const onOver = (e: PointerEvent) => {
            const target = e.target instanceof Element ? e.target : null;
            const labelled = target?.closest<HTMLElement>("[data-cursor]");
            const text = target?.closest(TEXTISH);
            const link = target?.closest(LINKISH);
            ring.classList.toggle("is-label", !!labelled);
            ring.classList.toggle("is-text", !labelled && !!text);
            ring.classList.toggle("is-link", !labelled && !text && !!link);
            label.textContent = labelled?.dataset.cursor ?? "";
        };
        const onLeave = () => show(false);
        const loop = () => {
            rx += (x - rx) * RING_EASE;
            ry += (y - ry) * RING_EASE;
            dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
            raf = requestAnimationFrame(loop);
        };

        window.addEventListener("pointermove", onMove, { passive: true });
        document.addEventListener("pointerover", onOver, { passive: true });
        document.documentElement.addEventListener("pointerleave", onLeave);
        raf = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerover", onOver);
            document.documentElement.removeEventListener("pointerleave", onLeave);
            root.classList.remove("has-cursor");
            show(false);
        };
    }, [onField]);

    if (onField) return null;
    return (
        <>
            <div ref={ringRef} className="cursor-ring" aria-hidden="true">
                <div className="cursor-ring-inner">
                    <span ref={labelRef} className="cursor-label" />
                </div>
            </div>
            <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
        </>
    );
}
