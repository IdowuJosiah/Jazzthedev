import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import type { Disposal } from "./utils/disposal";

const MODELS = {
    palm: "/assets/models/palm.glb",
    lantern: "/assets/models/lantern.glb",
    market: "/assets/models/market.glb",
    house: "/assets/models/house.glb",
    crate: "/assets/models/crate.glb",
    rock: "/assets/models/rock.glb",
    bird: "/assets/models/bird.glb",
} as const;
type ModelName = keyof typeof MODELS;

/**
 * Loads GLB models, the night HDRI (as a PMREM environment map) and PBR textures,
 * reporting real progress through a LoadingManager. Models are cached and handed
 * out as clones.
 */
export class Assets {
    private manager = new THREE.LoadingManager();
    private gltf = new GLTFLoader(this.manager);
    private rgbe = new RGBELoader(this.manager);
    private tex = new THREE.TextureLoader(this.manager);
    private models = new Map<ModelName, THREE.Object3D>();

    envMap: THREE.Texture | null = null;
    sandColor: THREE.Texture | null = null;
    sandNormal: THREE.Texture | null = null;
    waterNormal: THREE.Texture | null = null;

    constructor(
        private renderer: THREE.WebGLRenderer,
        private disposal: Disposal,
        private onProgress: (p: number, label: string) => void
    ) {
        this.manager.onProgress = (url, loaded, total) => {
            const p = total > 0 ? loaded / total : 0;
            this.onProgress(p, "Loading world assets");
        };
    }

    async loadAll() {
        await Promise.all([this.loadModels(), this.loadEnv(), this.loadTextures()]);
    }

    private async loadModels() {
        const entries = Object.entries(MODELS) as [ModelName, string][];
        await Promise.all(
            entries.map(async ([name, url]) => {
                try {
                    const gltf = await this.gltf.loadAsync(url);
                    const root = gltf.scene;
                    root.traverse((o) => {
                        const m = o as THREE.Mesh;
                        if (m.isMesh) {
                            m.castShadow = true;
                            m.receiveShadow = true;
                        }
                    });
                    this.disposal.trackObject(root);
                    this.models.set(name, root);
                } catch {
                    /* missing model → consumers fall back to procedural */
                }
            })
        );
    }

    private async loadEnv() {
        try {
            const hdr = await this.rgbe.loadAsync("/assets/hdri/night_1k.hdr");
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            pmrem.compileEquirectangularShader();
            this.envMap = pmrem.fromEquirectangular(hdr).texture;
            this.disposal.track(this.envMap);
            hdr.dispose();
            pmrem.dispose();
        } catch {
            /* no IBL → lights still work */
        }
    }

    private async loadTextures() {
        const load = async (url: string, srgb: boolean, repeat: number) => {
            try {
                const t = await this.tex.loadAsync(url);
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                t.repeat.set(repeat, repeat);
                if (srgb) t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = 4;
                this.disposal.track(t);
                return t;
            } catch {
                return null;
            }
        };
        [this.sandColor, this.sandNormal, this.waterNormal] = await Promise.all([
            load("/assets/textures/sand_color.webp", true, 40),
            load("/assets/textures/sand_normal.webp", false, 40),
            load("/assets/textures/water_normal.jpg", false, 8),
        ]);
    }

    /** A fresh clone of a cached model, or null if it failed to load. */
    get(name: ModelName): THREE.Object3D | null {
        const base = this.models.get(name);
        return base ? base.clone(true) : null;
    }

    has(name: ModelName) {
        return this.models.has(name);
    }
}
