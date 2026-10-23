"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { setLenis } from "./smooth";

/** Lenis smooth scrolling on the classic pages (never on the 3D world, never under reduced motion). */
export default function SmoothScroll() {
    const onField = usePathname() === "/field";

    useEffect(() => {
        if (onField || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const lenis = new Lenis({ lerp: 0.1, anchors: true });
        setLenis(lenis);
        let raf = 0;
        const loop = (time: number) => {
            lenis.raf(time);
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(raf);
            lenis.destroy();
            setLenis(null);
        };
    }, [onField]);

    return null;
}
