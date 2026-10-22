// ─────────────────────────────────────────────────────────────────────────
// Device-pixel-exact canvas sizing (§3.4 item 2).
//
// - A ResizeObserver with { box: "device-pixel-content-box" } reports the
//   canvas's exact size in DEVICE pixels; the buffer is that size (capped by
//   round(cssSize × dprCap) when the device DPR is above the profile cap).
// - Safari has no device-pixel-content-box: there the buffer is
//   round(contentRect × min(devicePixelRatio, dprCap)).
// - The renderer applies it with setPixelRatio(1) + setSize(bufW, bufH, false).
// - A matchMedia("(resolution: Xdppx)") listener re-measures when the window
//   moves to a screen with another DPR (or the page zoom changes).
//
// The DPR cap comes from the render profile and never changes mid-session, so
// resizing or opening devtools never changes the DPR (only the device can).
// ─────────────────────────────────────────────────────────────────────────

/** Treat DPRs this close as equal (e.g. 2 vs 1.9999999 after page zoom). */
const DPR_EPSILON = 1e-3;

export interface SizeInfo {
    /** CSS size of the canvas content box (fractional). */
    cssWidth: number;
    cssHeight: number;
    /** Drawing-buffer size in device pixels (canvas.width / canvas.height). */
    width: number;
    height: number;
    /** Effective buffer pixels per CSS pixel = min(devicePixelRatio, dprCap). */
    dpr: number;
    /** width / height of the buffer (square pixels → camera aspect). */
    aspect: number;
    /** True when measured through device-pixel-content-box (exact device pixels). */
    devicePixelExact: boolean;
}

export interface MeasureInput {
    cssWidth: number;
    cssHeight: number;
    /** devicePixelContentBoxSize, when the browser reports it. */
    devWidth?: number;
    devHeight?: number;
    /** window.devicePixelRatio at measure time. */
    dpr: number;
    /** Profile DPR cap (§9.1). */
    dprCap: number;
}

/**
 * Pure buffer-size rule (unit-tested). With device pixels and a device DPR at
 * or under the cap, the buffer IS the device-pixel box (no rounding guess).
 * Above the cap it is min(devicePixelBox, round(css × cap)). Without device
 * pixels (Safari) it is round(css × min(dpr, cap)). Never below 1×1.
 */
export function computeBufferSize(m: MeasureInput): Pick<SizeInfo, "width" | "height" | "dpr" | "devicePixelExact"> {
    const effective = Math.min(m.dpr, m.dprCap);
    const capped = m.dpr > m.dprCap + DPR_EPSILON;
    const hasDev = m.devWidth !== undefined && m.devHeight !== undefined && m.devWidth > 0 && m.devHeight > 0;
    let width: number;
    let height: number;
    if (hasDev) {
        width = capped ? Math.min(m.devWidth!, Math.round(m.cssWidth * m.dprCap)) : m.devWidth!;
        height = capped ? Math.min(m.devHeight!, Math.round(m.cssHeight * m.dprCap)) : m.devHeight!;
    } else {
        width = Math.round(m.cssWidth * effective);
        height = Math.round(m.cssHeight * effective);
    }
    return {
        width: Math.max(1, width),
        height: Math.max(1, height),
        dpr: effective,
        devicePixelExact: hasDev && !capped,
    };
}

type SizeCb = (s: SizeInfo) => void;

const deviceDpr = () => window.devicePixelRatio || 1;

/** Observes the canvas and reports device-pixel buffer sizes. */
export class Sizes {
    private info: SizeInfo = {
        cssWidth: 1,
        cssHeight: 1,
        width: 1,
        height: 1,
        dpr: 1,
        aspect: 1,
        devicePixelExact: false,
    };
    private cbs = new Set<SizeCb>();
    private ro: ResizeObserver | null = null;
    /** Whether observe() accepted device-pixel-content-box (false on Safari). */
    private devicePixelBox = false;
    /** Set once the browser rejected (or never filled) the device-pixel box. */
    private deviceBoxUnsupported = false;
    private mq: MediaQueryList | null = null;
    private disposed = false;

    constructor(
        private el: HTMLElement,
        readonly dprCap: number
    ) {
        this.measureNow();
        if (typeof ResizeObserver !== "undefined") {
            this.ro = new ResizeObserver((entries) => this.onEntries(entries));
            this.observe();
        } else {
            window.addEventListener("resize", this.measureNow);
        }
        this.armDprListener();
    }

    get current(): Readonly<SizeInfo> {
        return this.info;
    }

    /** True when the browser accepted device-pixel-content-box (false on Safari: fallback path). */
    get usesDevicePixelBox(): boolean {
        return this.devicePixelBox;
    }

    /** Subscribes to buffer-size changes; returns unsubscribe. */
    onChange(cb: SizeCb): () => void {
        this.cbs.add(cb);
        return () => {
            this.cbs.delete(cb);
        };
    }

    /**
     * Synchronous measurement from the CSS box (used before the first observer
     * callback and where ResizeObserver is missing). Keeps an exact device-pixel
     * measurement when the CSS size has not changed since it was taken.
     */
    measureNow = (): void => {
        if (this.disposed) return;
        const r = this.el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const sameCss = r.width === this.info.cssWidth && r.height === this.info.cssHeight;
        const sameDpr = Math.abs(this.info.dpr - Math.min(deviceDpr(), this.dprCap)) < DPR_EPSILON;
        if (this.info.devicePixelExact && sameCss && sameDpr) return;
        this.apply({ cssWidth: r.width, cssHeight: r.height, dpr: deviceDpr(), dprCap: this.dprCap });
    };

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.ro?.disconnect();
        this.ro = null;
        window.removeEventListener("resize", this.measureNow);
        this.mq?.removeEventListener("change", this.onDprChange);
        this.mq = null;
        this.cbs.clear();
    }

    // ── internals ────────────────────────────────────────────────────────
    private observe(): void {
        if (!this.ro) return;
        if (!this.deviceBoxUnsupported) {
            try {
                this.ro.observe(this.el, { box: "device-pixel-content-box" });
                this.devicePixelBox = true;
                return;
            } catch {
                // Safari: unsupported box value → CSS content box × DPR fallback.
                this.deviceBoxUnsupported = true;
            }
        }
        this.devicePixelBox = false;
        this.ro.observe(this.el, { box: "content-box" });
    }

    private onEntries(entries: ResizeObserverEntry[]): void {
        if (this.disposed) return;
        for (const entry of entries) {
            if (entry.target !== this.el) continue;
            const css = entry.contentBoxSize?.[0];
            const cssWidth = css ? css.inlineSize : entry.contentRect.width;
            const cssHeight = css ? css.blockSize : entry.contentRect.height;
            if (cssWidth <= 0 || cssHeight <= 0) continue;
            const dev = this.devicePixelBox ? entry.devicePixelContentBoxSize?.[0] : undefined;
            if (this.devicePixelBox && !dev && this.ro) {
                // Accepted the option but reports no device box: observe the CSS box instead.
                this.deviceBoxUnsupported = true;
                this.ro.unobserve(this.el);
                this.observe();
            }
            this.apply({
                cssWidth,
                cssHeight,
                devWidth: dev?.inlineSize,
                devHeight: dev?.blockSize,
                dpr: deviceDpr(),
                dprCap: this.dprCap,
            });
        }
    }

    private apply(m: MeasureInput): void {
        const b = computeBufferSize(m);
        const next: SizeInfo = {
            cssWidth: m.cssWidth,
            cssHeight: m.cssHeight,
            width: b.width,
            height: b.height,
            dpr: b.dpr,
            aspect: b.width / b.height,
            devicePixelExact: b.devicePixelExact,
        };
        const prev = this.info;
        this.info = next;
        if (prev.width === next.width && prev.height === next.height && prev.dpr === next.dpr) return;
        for (const cb of this.cbs) cb(next);
    }

    /** Listens for the CURRENT DPR to stop matching (window moved / zoom). */
    private armDprListener(): void {
        if (typeof window.matchMedia !== "function") return;
        this.mq?.removeEventListener("change", this.onDprChange);
        this.mq = window.matchMedia(`(resolution: ${deviceDpr()}dppx)`);
        this.mq.addEventListener("change", this.onDprChange);
    }

    private onDprChange = (): void => {
        if (this.disposed) return;
        this.armDprListener();
        if (this.ro) {
            // Re-observing delivers a fresh initial observation (device pixels
            // in Chrome, contentRect × new DPR in Safari) before the next paint.
            this.ro.unobserve(this.el);
            this.observe();
        } else {
            this.measureNow();
        }
    };
}
