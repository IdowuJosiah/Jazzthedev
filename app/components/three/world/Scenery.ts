import * as THREE from "three";
import { CONFIG, PALETTE, type QualityTier } from "./Config";
import type { Assets } from "./Assets";
import type { Environment } from "./Environment";
import type { Physics } from "./Physics";
import type { Disposal } from "./utils/disposal";
import { makeRng, randRange, TAU } from "./utils/math";
import { buildInstances } from "./utils/instancing";
import { grassMaterial, grassBladeGeometry } from "./shaders/grass";

interface Placement {
    x: number;
    y: number;
    z: number;
    yaw: number;
    s: number;
}

function normScale(model: THREE.Object3D, targetH: number) {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    return targetH / Math.max(size.y, 0.001);
}

export class Scenery {
    group = new THREE.Group();
    private grassMat?: THREE.ShaderMaterial;
    private lanternLights: THREE.PointLight[] = [];

    constructor(
        private assets: Assets,
        private env: Environment,
        private physics: Physics,
        private disposal: Disposal,
        quality: QualityTier,
        private avoid: THREE.Vector3[]
    ) {
        this.scatterPalms(quality);
        this.scatterRocks(quality);
        this.buildGrass(quality);
        this.buildMarket();
    }

    private clear(x: number, z: number, pad = 16) {
        if (Math.hypot(x, z - 30) < 14) return false; // spawn clearing
        for (const a of this.avoid) if (Math.hypot(x - a.x, z - a.z) < pad) return false;
        return true;
    }

    private ringPlacements(
        count: number,
        rMin: number,
        rMax: number,
        rng: () => number,
        pad = 16
    ): Placement[] {
        const out: Placement[] = [];
        let guard = count * 8;
        while (out.length < count && guard-- > 0) {
            const a = rng() * TAU;
            const r = randRange(rng, rMin, rMax);
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            if (!this.clear(x, z, pad)) continue;
            const y = this.env.heightAt(x, z);
            if (y < CONFIG.world.waterLevel + 0.3) continue; // not in the sea
            out.push({ x, y, z, yaw: rng() * TAU, s: randRange(rng, 0.8, 1.3) });
        }
        return out;
    }

    private toMatrices(raw: Placement[], baseScale: number) {
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        return raw.map((p) => {
            q.setFromAxisAngle(up, p.yaw);
            const s = baseScale * p.s;
            return new THREE.Matrix4().compose(
                new THREE.Vector3(p.x, p.y, p.z),
                q,
                new THREE.Vector3(s, s, s)
            );
        });
    }

    private scatterPalms(quality: QualityTier) {
        const model = this.assets.get("palm");
        const count = CONFIG.foliage.palmCount[quality];
        const rng = makeRng(CONFIG.world.seed + 11);
        const raw = this.ringPlacements(count, 24, CONFIG.world.shoreRadius - 6, rng);
        if (model) {
            const base = normScale(model, 6);
            const mats = this.toMatrices(raw, base);
            const { group, meshes } = buildInstances(model, mats, new THREE.Color(0xbfe6d0));
            meshes.forEach((m) => this.disposal.track(m));
            this.group.add(group);
        } else {
            this.proceduralPalms(raw);
        }
    }

    private proceduralPalms(raw: { x: number; y: number; z: number; yaw: number; s: number }[]) {
        const trunkGeo = this.disposal.track(new THREE.CylinderGeometry(0.12, 0.2, 4, 6));
        const trunkMat = this.disposal.track(
            new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.9 })
        );
        const leafGeo = this.disposal.track(new THREE.ConeGeometry(2.2, 1.2, 6));
        const leafMat = this.disposal.track(
            new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 0.8 })
        );
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, raw.length);
        const leaves = new THREE.InstancedMesh(leafGeo, leafMat, raw.length);
        trunks.castShadow = leaves.castShadow = true;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        raw.forEach((p, i) => {
            m.compose(new THREE.Vector3(p.x, p.y + 2 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
            trunks.setMatrixAt(i, m);
            m.compose(new THREE.Vector3(p.x, p.y + 4 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
            leaves.setMatrixAt(i, m);
        });
        this.disposal.track(trunks);
        this.disposal.track(leaves);
        this.group.add(trunks, leaves);
    }

    private scatterRocks(quality: QualityTier) {
        const model = this.assets.get("rock");
        if (!model) return;
        const count = Math.round(CONFIG.foliage.palmCount[quality] / 4);
        const rng = makeRng(CONFIG.world.seed + 23);
        const raw = this.ringPlacements(count, 18, CONFIG.world.shoreRadius, rng, 12);
        const base = normScale(model, 1.6);
        const mats = this.toMatrices(raw, base);
        const { meshes, group } = buildInstances(model, mats, new THREE.Color(0x8a93b5));
        meshes.forEach((m) => this.disposal.track(m));
        this.group.add(group);
    }

    private buildGrass(quality: QualityTier) {
        const count = CONFIG.foliage.grassBlades[quality];
        if (count <= 0) return;
        const rng = makeRng(CONFIG.world.seed + 31);
        const geo = this.disposal.track(grassBladeGeometry());
        const mat = grassMaterial();
        this.disposal.track(mat);
        this.grassMat = mat;
        const inst = new THREE.InstancedMesh(geo, mat, count);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        let placed = 0;
        let guard = count * 6;
        while (placed < count && guard-- > 0) {
            const a = rng() * TAU;
            const r = Math.sqrt(rng()) * CONFIG.foliage.grassRadius;
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            if (!this.clear(x, z, 10)) continue;
            const y = this.env.heightAt(x, z);
            if (y < 0.3) continue;
            q.setFromAxisAngle(up, rng() * TAU);
            const s = randRange(rng, 0.7, 1.4);
            m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
            inst.setMatrixAt(placed++, m);
        }
        inst.count = placed;
        inst.instanceMatrix.needsUpdate = true;
        this.disposal.track(inst);
        this.group.add(inst);
    }

    private buildMarket() {
        // A small night market cluster offset from spawn.
        const cx = -36;
        const cz = 24;
        const rng = makeRng(CONFIG.world.seed + 7);
        const place = (name: "market" | "house" | "lantern", x: number, z: number, targetH: number, withLight: boolean, collide: boolean) => {
            const model = this.assets.get(name);
            const y = this.env.heightAt(x, z);
            if (model) {
                const s = normScale(model, targetH);
                model.scale.setScalar(s);
                model.position.set(x, y, z);
                model.rotation.y = rng() * TAU;
                this.group.add(model);
            }
            if (withLight) {
                const light = new THREE.PointLight(PALETTE.neonAmber, 26, 26, 2);
                light.position.set(x, y + 2.6, z);
                this.group.add(light);
                this.lanternLights.push(light);
                // emissive bulb so it reads even without the model
                const bulb = new THREE.Mesh(
                    this.disposal.track(new THREE.SphereGeometry(0.18, 8, 8)),
                    this.disposal.track(
                        new THREE.MeshBasicMaterial({ color: PALETTE.neonAmber })
                    )
                );
                bulb.position.set(x, y + 2.6, z);
                this.group.add(bulb);
            }
            if (collide) this.physics.addFixedCuboid({ x: targetH * 0.4, y: targetH, z: targetH * 0.4 }, { x, y: y + targetH, z });
        };

        const stalls = 5;
        for (let i = 0; i < stalls; i++) {
            const a = (i / stalls) * TAU;
            place("market", cx + Math.cos(a) * 9, cz + Math.sin(a) * 9, 3, false, true);
            place("lantern", cx + Math.cos(a + 0.4) * 12, cz + Math.sin(a + 0.4) * 12, 2.6, i < 4, false);
        }
        place("house", cx - 14, cz - 6, 4.5, false, true);
        place("house", cx + 14, cz + 8, 4, false, true);
    }

    update(elapsed: number, beat: number) {
        if (this.grassMat) this.grassMat.uniforms.uTime.value = elapsed;
        for (let i = 0; i < this.lanternLights.length; i++) {
            const l = this.lanternLights[i];
            l.intensity = 22 + Math.sin(elapsed * 3 + i) * 4 + beat * 10;
        }
    }
}
