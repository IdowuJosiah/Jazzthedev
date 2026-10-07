import * as THREE from "three";
import { CONFIG, LOOK, type LookPreset } from "./Config";
import type { RenderProfile } from "./types";
import { Sizes, type SizeInfo } from "./utils/sizes";

// ─────────────────────────────────────────────────────────────────────────
// Renderer (§1.4, §1.5, §3.4, §7). Draws straight to the canvas with
// renderer.render(scene, camera): no composer, no tone mapping, no FXAA/SMAA,
// no bloom. Everything that affects crispness is decided once by the render
// profile (§9.1) and never changes mid-session:
//
// - `antialias` (MSAA) from the profile;
// - DPR cap from the profile; the buffer is device-pixel exact (utils/sizes.ts)
//   and applied as setPixelRatio(1) + setSize(bufW, bufH, false);
// - NoToneMapping + SRGB output, clear colour = the active LOOK background;
// - PCFShadowMap (PCFSoftShadowMap was removed in r186), enabled only when the
//   profile has a shadow map.
//
// webglcontextlost / webglcontextrestored are exposed as callbacks: the UI shows
// "Graphics were reset" on loss and the integrator reloads on restore (§6.2).
// ─────────────────────────────────────────────────────────────────────────

export interface RendererOptions {
    onContextLost?: () => void;
    onContextRestored?: () => void;
}

type Cb = () => void;
type ResizeCb = (s: SizeInfo) => void;

/**
 * The live Renderer per canvas. A disposed Renderer only force-loses its
 * context when no newer Renderer has claimed the same canvas meanwhile.
 */
const owners = new WeakMap<HTMLCanvasElement, Renderer>();

export class Renderer {
    readonly instance: THREE.WebGLRenderer;
    readonly sizes: Sizes;
    private lostCbs = new Set<Cb>();
    private restoredCbs = new Set<Cb>();
    private resizeCbs = new Set<ResizeCb>();
    private lost = false;
    private disposed = false;
    /** Last frame's scene + camera: re-drawn right after a resize clears the buffer. */
    private lastScene: THREE.Object3D | null = null;
    private lastCamera: THREE.Camera | null = null;
    private unsubscribeSizes: () => void;

    /** Throws if the WebGL context cannot be created (Experience → "webgl" fail card). */
    constructor(
        private canvas: HTMLCanvasElement,
        readonly profile: RenderProfile,
        opts: RendererOptions = {}
    ) {
        if (opts.onContextLost) this.lostCbs.add(opts.onContextLost);
        if (opts.onContextRestored) this.restoredCbs.add(opts.onContextRestored);

        // The buffer is sized in device pixels with updateStyle = false, so the
        // canvas's CSS box must not depend on its width/height attributes.
        // No CSS transform or scale is ever applied (§3.4 item 3).
        const style = canvas.style;
        if (!style.display) style.display = "block";
        if (!style.width) style.width = "100%";
        if (!style.height) style.height = "100%";

        canvas.addEventListener("webglcontextlost", this.handleLost);
        canvas.addEventListener("webglcontextrestored", this.handleRestored);

        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas,
                antialias: profile.antialias,
                alpha: false,
                stencil: false,
                depth: true,
                powerPreference: "high-performance",
                preserveDrawingBuffer: false,
            });
        } catch (err) {
            canvas.removeEventListener("webglcontextlost", this.handleLost);
            canvas.removeEventListener("webglcontextrestored", this.handleRestored);
            throw err;
        }
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = profile.shadowMapSize > 0;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.setPixelRatio(1);
        this.instance = renderer;
        owners.set(canvas, this);
        this.setLook(LOOK[CONFIG.look]);

        this.sizes = new Sizes(canvas, profile.dprCap);
        this.applySize(this.sizes.current);
        this.unsubscribeSizes = this.sizes.onChange((s) => this.handleResize(s));
    }

    /** Current buffer / CSS size and effective DPR. */
    get size(): Readonly<SizeInfo> {
        return this.sizes.current;
    }

    get isContextLost(): boolean {
        return this.lost;
    }

    /** Clear colour from a look preset (Debug's look switch; §1.7). */
    setLook(look: LookPreset): void {
        this.instance.setClearColor(look.background, CONFIG.render.clearAlpha);
    }

    /**
     * Called after the buffer was resized (camera aspect / FOV updates go here).
     * The last frame is re-drawn right after the callbacks run, so a resize never
     * paints a cleared canvas. Returns unsubscribe.
     */
    onResize(cb: ResizeCb): () => void {
        this.resizeCbs.add(cb);
        return () => {
            this.resizeCbs.delete(cb);
        };
    }

    /** `webglcontextlost` (already preventDefault-ed). Returns unsubscribe. */
    onContextLost(cb: Cb): () => void {
        this.lostCbs.add(cb);
        return () => {
            this.lostCbs.delete(cb);
        };
    }

    /** `webglcontextrestored`. Returns unsubscribe. */
    onContextRestored(cb: Cb): () => void {
        this.restoredCbs.add(cb);
        return () => {
            this.restoredCbs.delete(cb);
        };
    }

    render(scene: THREE.Object3D, camera: THREE.Camera): void {
        if (this.lost || this.disposed) return;
        this.lastScene = scene;
        this.lastCamera = camera;
        this.instance.render(scene, camera);
    }

    /**
     * Photo mode (§7): renders one frame and reads it back in the same tick
     * (no preserveDrawingBuffer needed). Returns a data URL ("" if lost).
     */
    capture(scene: THREE.Object3D, camera: THREE.Camera, type = "image/png", quality?: number): string {
        if (this.lost || this.disposed) return "";
        this.render(scene, camera);
        return this.canvas.toDataURL(type, quality);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribeSizes();
        this.sizes.dispose();
        this.canvas.removeEventListener("webglcontextlost", this.handleLost);
        this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
        this.lostCbs.clear();
        this.restoredCbs.clear();
        this.resizeCbs.clear();
        this.lastScene = null;
        this.lastCamera = null;
        this.instance.dispose();
        this.releaseContextIfDetached();
    }

    // ── internals ────────────────────────────────────────────────────────
    /**
     * A strict-mode remount reuses this canvas, and a force-lost canvas can never
     * render again, so the context is not dropped synchronously. After the
     * current task (React has removed the DOM by then) it is lost on purpose
     * only if the canvas left the document and no newer Renderer owns it, so
     * client-side navigation never piles up live WebGL contexts (Chrome kills
     * the oldest past ~16).
     */
    private releaseContextIfDetached(): void {
        const { canvas, instance } = this;
        setTimeout(() => {
            if (canvas.isConnected || owners.get(canvas) !== this) return;
            owners.delete(canvas);
            instance.getContext().getExtension("WEBGL_lose_context")?.loseContext();
        }, 0);
    }

    private applySize(s: SizeInfo): void {
        this.instance.setPixelRatio(1);
        this.instance.setSize(s.width, s.height, false);
    }

    private handleResize(s: SizeInfo): void {
        if (this.disposed) return;
        this.applySize(s);
        for (const cb of this.resizeCbs) cb(s);
        // Resizing cleared the drawing buffer after this frame's render: redraw.
        if (this.lastScene && this.lastCamera) this.render(this.lastScene, this.lastCamera);
    }

    private handleLost = (e: Event): void => {
        e.preventDefault(); // required for webglcontextrestored to fire
        if (this.lost) return;
        this.lost = true;
        for (const cb of this.lostCbs) cb();
    };

    private handleRestored = (): void => {
        this.lost = false;
        for (const cb of this.restoredCbs) cb();
    };
}
