import * as THREE from "three";
import { CONFIG, PALETTE, type QualityTier } from "./Config";
import type { Physics } from "./Physics";
import type { Disposal } from "./utils/disposal";
import { clamp, lerp } from "./utils/math";
import { waterMaterial, updateWater } from "./shaders/water";
import { skyMaterial, updateSky } from "./shaders/sky";

const SEG = 150; // terrain grid resolution (per side)

/** Deterministic smooth height field from summed sines — stylized dunes. */
function terrainHeight(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const shore = CONFIG.world.shoreRadius;
    // island mask: 1 inside, 0 out in the sea
    const mask = clamp((shore + 24 - r) / 48, 0, 1);
    const m = mask * mask * (3 - 2 * mask); // smoothstep
    const dunes =
        Math.sin(x * 0.045) * Math.cos(z * 0.05) * 1.1 +
        Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.7) * 0.5 +
        Math.sin((x + z) * 0.2) * 0.18;
    const seabed = -7 + Math.sin(x * 0.03) * 0.8;
    return lerp(seabed, dunes, m);
}

export class Environment {
    group = new THREE.Group();
    sun!: THREE.DirectionalLight;
    private moon!: THREE.DirectionalLight;
    private hemi!: THREE.HemisphereLight;
    private ambient!: THREE.AmbientLight;
    private sky!: THREE.Mesh;
    private water!: THREE.Mesh;
    private fog!: THREE.FogExp2;
    private terrainMesh!: THREE.Mesh;

    constructor(
        private physics: Physics,
        private disposal: Disposal,
        private scene: THREE.Scene
    ) {
        this.buildSky();
        this.buildTerrain();
        this.buildWater();
        this.buildLights();
    }

    heightAt(x: number, z: number) {
        return terrainHeight(x, z);
    }

    setWaterNormal(tex: THREE.Texture) {
        const mat = this.water.material as THREE.ShaderMaterial;
        mat.uniforms.uNormalMap.value = tex;
        mat.uniforms.uHasNormal.value = 1;
    }

    /** Surface relief for the terrain so the land catches light instead of reading flat. */
    setGroundTextures(normal: THREE.Texture) {
        const mat = this.terrainMesh.material as THREE.MeshStandardMaterial;
        mat.normalMap = normal;
        mat.normalScale.set(0.7, 0.7);
        mat.needsUpdate = true;
    }

    private buildSky() {
        const geo = new THREE.SphereGeometry(CONFIG.camera.far * 0.9, 32, 16);
        this.disposal.track(geo);
        const mat = skyMaterial();
        this.disposal.track(mat);
        this.sky = new THREE.Mesh(geo, mat);
        this.sky.renderOrder = -1;
        this.group.add(this.sky);

        this.fog = new THREE.FogExp2(PALETTE.fog, CONFIG.fog.density);
        this.scene.fog = this.fog;
    }

    private buildTerrain() {
        const size = CONFIG.world.size * 2;
        const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const colors: number[] = [];
        const cSand = new THREE.Color(PALETTE.sand);
        const cGrass = new THREE.Color(PALETTE.grass);
        const cGround = new THREE.Color(PALETTE.ground);
        const cSea = new THREE.Color(PALETTE.water).multiplyScalar(0.4);
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const h = terrainHeight(x, z);
            pos.setY(i, h);
            // vertex colour by height/zone
            const c = new THREE.Color();
            if (h < CONFIG.world.waterLevel + 0.2) c.copy(cSea);
            else if (h < 0.6) c.copy(cSand);
            else c.copy(cGrass).lerp(cGround, clamp((h - 0.6) / 2, 0, 1));
            colors.push(c.r, c.g, c.b);
        }
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        this.disposal.track(geo);

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.95,
            metalness: 0,
            flatShading: false,
        });
        this.disposal.track(mat);
        this.terrainMesh = new THREE.Mesh(geo, mat);
        this.terrainMesh.receiveShadow = true;
        this.group.add(this.terrainMesh);

        // Physics trimesh straight from the geometry (guaranteed to match).
        const verts = new Float32Array(pos.array);
        const index = geo.index!;
        const indices = new Uint32Array(index.array);
        this.physics.addStaticTrimesh(verts, indices);
    }

    private buildWater() {
        const geo = new THREE.PlaneGeometry(CONFIG.world.size * 3, CONFIG.world.size * 3, 1, 1);
        geo.rotateX(-Math.PI / 2);
        this.disposal.track(geo);
        const mat = waterMaterial();
        this.disposal.track(mat);
        this.water = new THREE.Mesh(geo, mat);
        this.water.position.y = CONFIG.world.waterLevel;
        this.group.add(this.water);
    }

    private buildLights() {
        this.ambient = new THREE.AmbientLight(0x3a4a66, 0.5);
        this.group.add(this.ambient);

        this.hemi = new THREE.HemisphereLight(PALETTE.skyBottom, PALETTE.ground, 0.6);
        this.group.add(this.hemi);

        this.sun = new THREE.DirectionalLight(PALETTE.horizon, 1.4);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.camera.near = 1;
        this.sun.shadow.camera.far = 220;
        const s = 70;
        this.sun.shadow.camera.left = -s;
        this.sun.shadow.camera.right = s;
        this.sun.shadow.camera.top = s;
        this.sun.shadow.camera.bottom = -s;
        this.sun.shadow.bias = -0.0004;
        this.group.add(this.sun);
        this.group.add(this.sun.target);

        this.moon = new THREE.DirectionalLight(0x8fb6ff, 0.3);
        this.group.add(this.moon);
        this.group.add(this.moon.target);
    }

    setQuality(q: QualityTier) {
        const size = CONFIG.quality.shadowMap[q];
        this.sun.castShadow = size > 0;
        if (size > 0) {
            this.sun.shadow.mapSize.set(size, size);
            this.sun.shadow.map?.dispose();
            this.sun.shadow.map = null;
        }
    }

    /**
     * @param dayTime 0..1 — 0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight
     * @param focus   player position (shadows + sky follow the car)
     */
    update(dt: number, elapsed: number, dayTime: number, focus: THREE.Vector3) {
        // Sun orbit: angle around the day.
        const ang = dayTime * Math.PI * 2;
        const sunDir = new THREE.Vector3(Math.cos(ang) * 0.9, Math.sin(ang), 0.35).normalize();
        const night = clamp(-sunDir.y * 1.4 + 0.25, 0, 1); // 0 day, 1 deep night

        // Sun light (day) fades out at night; moon fades in.
        this.sun.position.copy(focus).addScaledVector(sunDir, 120);
        this.sun.target.position.copy(focus);
        this.sun.intensity = lerp(1.6, 0.0, night);
        this.sun.color.setHex(night > 0.5 ? PALETTE.horizon : PALETTE.horizon);

        this.moon.position.copy(focus).addScaledVector(sunDir.clone().negate(), 120);
        this.moon.target.position.copy(focus);
        this.moon.intensity = lerp(0.0, 0.9, night);

        this.ambient.intensity = lerp(0.65, 0.44, night);
        this.hemi.intensity = lerp(0.8, 0.55, night);

        // Fog + sky colours shift with time of day.
        const dayFog = new THREE.Color(PALETTE.horizon).lerp(new THREE.Color(0x9fb8e6), 0.4);
        const nightFog = new THREE.Color(PALETTE.fog);
        this.fog.color.copy(dayFog).lerp(nightFog, night);
        this.fog.density = lerp(0.0011, CONFIG.fog.density, night);

        updateSky(this.sky.material as THREE.ShaderMaterial, sunDir, night);
        updateWater(this.water.material as THREE.ShaderMaterial, elapsed, night, sunDir);

        // keep sky + water centred on the camera focus
        this.sky.position.set(focus.x, 0, focus.z);
        this.water.position.set(focus.x, CONFIG.world.waterLevel, focus.z);
    }
}
