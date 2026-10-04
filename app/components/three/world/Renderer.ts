import * as THREE from "three";
import { CONFIG, PALETTE, type QualityTier } from "./Config";

/** Wraps the WebGLRenderer with tone mapping, shadow + DPR management. */
export class Renderer {
    readonly instance: THREE.WebGLRenderer;

    constructor(canvas: HTMLCanvasElement) {
        this.instance = new THREE.WebGLRenderer({
            canvas,
            antialias: false, // SMAA in postprocessing handles edges cheaper
            powerPreference: "high-performance",
            stencil: false,
            alpha: false,
        });
        this.instance.outputColorSpace = THREE.SRGBColorSpace;
        this.instance.toneMapping = THREE.ACESFilmicToneMapping;
        this.instance.toneMappingExposure = 1.15;
        this.instance.shadowMap.enabled = true;
        this.instance.shadowMap.type = THREE.PCFShadowMap;
        this.instance.setClearColor(PALETTE.skyTop, 1);
    }

    setSize(w: number, h: number, dpr: number) {
        this.instance.setPixelRatio(dpr);
        this.instance.setSize(w, h, false);
    }

    applyQuality(q: QualityTier) {
        const shadow = CONFIG.quality.shadowMap[q];
        this.instance.shadowMap.enabled = shadow > 0;
        this.instance.shadowMap.needsUpdate = true;
    }

    dispose() {
        this.instance.dispose();
        this.instance.forceContextLoss();
    }
}

/** Quick capability probe so we can show a graceful fallback instead of a black box. */
export function webglAvailable(): boolean {
    try {
        const canvas = document.createElement("canvas");
        return !!(
            window.WebGLRenderingContext &&
            (canvas.getContext("webgl2") || canvas.getContext("webgl"))
        );
    } catch {
        return false;
    }
}
