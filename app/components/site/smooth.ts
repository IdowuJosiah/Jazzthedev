import type Lenis from "lenis";

// The page's Lenis instance (null on /field, under reduced motion, or before
// SmoothScroll mounts), so the menu can pause scrolling while it is open.
let current: Lenis | null = null;

export function setLenis(lenis: Lenis | null): void {
    current = lenis;
}

export function getLenis(): Lenis | null {
    return current;
}
