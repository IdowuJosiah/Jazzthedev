import * as THREE from "three";
import type { LookPreset } from "../Config";

// ─────────────────────────────────────────────────────────────────────────
// Calibration pixel probe (§1.4, §10 W1-A). Reads ONE pixel of the scene back
// as LINEAR per-channel values, for the ?debug readout and the calibration
// rule "each channel of a sun-lit paper top stays in 0.88–0.96 linear".
//
// How: the scene is re-rendered into a 1×1 render target with
// camera.setViewOffset() framing exactly the requested buffer pixel. three
// writes LINEAR colour into render targets (the sRGB output transform only
// applies to the canvas), so the read-back needs no decoding. A float target
// is used when EXT_color_buffer_float is available (exact), else RGBA8
// (linear, 1/255 steps — still fine against a 0.08-wide band).
// ─────────────────────────────────────────────────────────────────────────

/** 8-bit channel max (RGBA8 fallback target). */
const BYTE_MAX = 255;

export interface ProbeSample {
    /** Buffer pixel, from the top-left. */
    x: number;
    y: number;
    /** Linear channel values (0..1, may exceed 1 on a float target = clipping). */
    r: number;
    g: number;
    b: number;
    /** The sRGB colour the canvas shows for this pixel, e.g. "#f9f7f6". */
    hex: string;
}

export interface ProbeVerdict {
    pass: boolean;
    /** Per channel: inside the band (perChannel looks) or ignored (false = fail). */
    channels: { r: boolean; g: boolean; b: boolean };
    /** The value the rule was applied to (highest channel for dusk). */
    max: number;
}

type ProbeCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Linear → displayed sRGB hex (clamped), matching what the canvas shows. */
export function linearToSrgbHex(r: number, g: number, b: number): string {
    const c = new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    return `#${c.getHexString(THREE.SRGBColorSpace)}`;
}

/** sRGB hex → linear channels (for comparing against the §1.4 calibration table). */
export function srgbHexToLinear(hex: string): { r: number; g: number; b: number } {
    const c = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
    const out = { r: 0, g: 0, b: 0 };
    c.getRGB(out, THREE.LinearSRGBColorSpace);
    return out;
}

/**
 * The calibration rule for a look (§1.4 / §1.7): `day` checks every channel in
 * [min, max]; `dusk` checks only the highest channel.
 */
export function checkProbe(s: Pick<ProbeSample, "r" | "g" | "b">, rule: LookPreset["probe"]): ProbeVerdict {
    const inBand = (v: number) => v >= rule.min && v <= rule.max;
    const max = Math.max(s.r, s.g, s.b);
    if (rule.perChannel) {
        const channels = { r: inBand(s.r), g: inBand(s.g), b: inBand(s.b) };
        return { pass: channels.r && channels.g && channels.b, channels, max };
    }
    const ok = inBand(max);
    return { pass: ok, channels: { r: ok, g: ok, b: ok }, max };
}

export class PixelProbe {
    private target: THREE.WebGLRenderTarget;
    private readonly float: boolean;
    private readonly floatBuf = new Float32Array(4);
    private readonly byteBuf = new Uint8Array(4);

    constructor(private renderer: THREE.WebGLRenderer) {
        this.float = renderer.extensions.has("EXT_color_buffer_float");
        this.target = new THREE.WebGLRenderTarget(1, 1, {
            type: this.float ? THREE.FloatType : THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            generateMipmaps: false,
            depthBuffer: true,
            samples: 0,
        });
    }

    /** Samples buffer pixel (x, y), measured from the canvas's top-left. */
    sample(scene: THREE.Object3D, camera: ProbeCamera, x: number, y: number): ProbeSample {
        const r = this.renderer;
        const fullW = r.domElement.width;
        const fullH = r.domElement.height;
        const px = Math.min(Math.max(Math.floor(x), 0), fullW - 1);
        const py = Math.min(Math.max(Math.floor(y), 0), fullH - 1);

        const savedView = camera.view ? { ...camera.view } : null;
        const savedTarget = r.getRenderTarget();
        camera.setViewOffset(fullW, fullH, px, py, 1, 1);
        try {
            r.setRenderTarget(this.target);
            r.render(scene, camera);
            let rgb: [number, number, number];
            if (this.float) {
                r.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.floatBuf);
                rgb = [this.floatBuf[0], this.floatBuf[1], this.floatBuf[2]];
            } else {
                r.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.byteBuf);
                rgb = [this.byteBuf[0] / BYTE_MAX, this.byteBuf[1] / BYTE_MAX, this.byteBuf[2] / BYTE_MAX];
            }
            return { x: px, y: py, r: rgb[0], g: rgb[1], b: rgb[2], hex: linearToSrgbHex(rgb[0], rgb[1], rgb[2]) };
        } finally {
            r.setRenderTarget(savedTarget);
            if (savedView && savedView.enabled) {
                camera.setViewOffset(
                    savedView.fullWidth,
                    savedView.fullHeight,
                    savedView.offsetX,
                    savedView.offsetY,
                    savedView.width,
                    savedView.height
                );
            } else {
                camera.clearViewOffset();
            }
        }
    }

    /** Samples the pixel under a pointer (clientX / clientY in CSS pixels). */
    sampleAtClient(scene: THREE.Object3D, camera: ProbeCamera, clientX: number, clientY: number): ProbeSample {
        const canvas = this.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width > 0 ? canvas.width / rect.width : 1;
        const sy = rect.height > 0 ? canvas.height / rect.height : 1;
        return this.sample(scene, camera, (clientX - rect.left) * sx, (clientY - rect.top) * sy);
    }

    dispose(): void {
        this.target.dispose();
    }
}
