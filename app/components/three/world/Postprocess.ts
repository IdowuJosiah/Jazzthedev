import * as THREE from "three";
import {
    EffectComposer,
    RenderPass,
    EffectPass,
    BloomEffect,
    SMAAEffect,
    VignetteEffect,
    HueSaturationEffect,
    BrightnessContrastEffect,
    ToneMappingEffect,
    ToneMappingMode,
    KernelSize,
    type Effect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { CONFIG, type QualityTier } from "./Config";

/**
 * HDR postprocessing chain: render → (SSAO) → bloom → tone-map → colour grade →
 * vignette → SMAA. Falls back to direct rendering if construction fails or on low
 * quality (handled by the caller).
 */
export class Postprocess {
    composer: EffectComposer;
    private n8?: N8AOPostPass;
    private bloom?: BloomEffect;

    constructor(
        private renderer: THREE.WebGLRenderer,
        scene: THREE.Scene,
        camera: THREE.Camera,
        w: number,
        h: number,
        quality: QualityTier
    ) {
        // postprocessing applies tone mapping itself; disable it on the renderer.
        renderer.toneMapping = THREE.NoToneMapping;
        this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
        this.composer.addPass(new RenderPass(scene, camera));

        if (CONFIG.quality.ssao[quality]) {
            this.n8 = new N8AOPostPass(scene, camera, w, h);
            this.n8.configuration.aoRadius = 3;
            this.n8.configuration.intensity = 2.2;
            this.n8.configuration.aoSamples = 8;
            this.n8.configuration.denoiseSamples = 4;
            this.composer.addPass(this.n8);
        }

        const effects: Effect[] = [];
        if (CONFIG.quality.bloom[quality]) {
            this.bloom = new BloomEffect({
                intensity: 1.15,
                luminanceThreshold: 0.5,
                luminanceSmoothing: 0.32,
                mipmapBlur: true,
                kernelSize: KernelSize.LARGE,
            });
            effects.push(this.bloom);
        }
        effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
        effects.push(new HueSaturationEffect({ saturation: 0.14 }));
        effects.push(new BrightnessContrastEffect({ contrast: 0.08, brightness: 0.01 }));
        effects.push(new VignetteEffect({ darkness: 0.52, offset: 0.33 }));
        effects.push(new SMAAEffect());
        this.composer.addPass(new EffectPass(camera, ...effects));
        this.composer.setSize(w, h);
    }

    render(dt: number) {
        this.composer.render(dt);
    }

    setSize(w: number, h: number) {
        this.composer.setSize(w, h);
        this.n8?.setSize(w, h);
    }

    dispose() {
        this.composer.dispose();
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
}
