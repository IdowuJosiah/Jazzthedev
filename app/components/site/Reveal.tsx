"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Adds `visible` to every `.reveal` element as it scrolls into view, on every
 * classic page (re-scanned after each navigation). The CSS in index.css does
 * the motion and drops it under reduced motion.
 */
export default function Reveal() {
    const pathname = usePathname();

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    e.target.classList.add("visible");
                    observer.unobserve(e.target);
                }
            },
            { threshold: 0.1 }
        );
        document.querySelectorAll(".reveal:not(.visible)").forEach((el) => observer.observe(el));
        return () => observer.disconnect();
    }, [pathname]);

    return null;
}
