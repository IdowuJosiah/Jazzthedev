declare module "n8ao" {
    import type { Camera, Scene } from "three";
    import { Pass } from "postprocessing";

    interface N8AOConfiguration {
        aoRadius: number;
        intensity: number;
        aoSamples: number;
        denoiseSamples: number;
        denoiseRadius: number;
        distanceFalloff: number;
        [key: string]: number;
    }

    export class N8AOPostPass extends Pass {
        constructor(scene: Scene, camera: Camera, width: number, height: number);
        configuration: N8AOConfiguration;
        setSize(width: number, height: number): void;
    }

    export class N8AOPass extends Pass {
        constructor(scene: Scene, camera: Camera, width: number, height: number);
        configuration: N8AOConfiguration;
        setSize(width: number, height: number): void;
    }
}
