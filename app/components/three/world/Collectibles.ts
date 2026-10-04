import * as THREE from "three";
import { CONFIG, PALETTE } from "./Config";
import type { Environment } from "./Environment";
import type { Disposal } from "./utils/disposal";
import { makeRng, TAU } from "./utils/math";
import { yorubaWords } from "@/app/field/content/world";

export interface Orb {
    word: string;
    meaning: string;
    position: THREE.Vector3;
    mesh: THREE.Group;
    collected: boolean;
}

/** Glowing Yoruba-word orbs scattered across the island. Grab them all. */
export class Collectibles {
    group = new THREE.Group();
    orbs: Orb[] = [];
    private coreMat: THREE.MeshStandardMaterial;
    private ringMat: THREE.MeshBasicMaterial;

    constructor(
        private env: Environment,
        private disposal: Disposal,
        avoid: THREE.Vector3[]
    ) {
        this.coreMat = disposal.track(
            new THREE.MeshStandardMaterial({
                color: PALETTE.neonCyan,
                emissive: PALETTE.neonCyan,
                emissiveIntensity: 2,
                roughness: 0.3,
            })
        );
        this.ringMat = disposal.track(
            new THREE.MeshBasicMaterial({
                color: PALETTE.neonCyan,
                transparent: true,
                opacity: 0.6,
                side: THREE.DoubleSide,
            })
        );
        const geo = disposal.track(new THREE.IcosahedronGeometry(0.5, 0));
        const ringGeo = disposal.track(new THREE.TorusGeometry(0.9, 0.05, 8, 24));

        const count = Math.min(CONFIG.collectibles.count, yorubaWords.length);
        const rng = makeRng(CONFIG.world.seed + 404);
        let placed = 0;
        let guard = count * 40;
        while (placed < count && guard-- > 0) {
            const a = rng() * TAU;
            const r = 20 + Math.sqrt(rng()) * (CONFIG.world.shoreRadius - 24);
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            const y = this.env.heightAt(x, z);
            if (y < 0.4) continue;
            if (avoid.some((v) => Math.hypot(x - v.x, z - v.z) < 10)) continue;
            const w = yorubaWords[placed];
            const g = new THREE.Group();
            const core = new THREE.Mesh(geo, this.coreMat);
            const ring = new THREE.Mesh(ringGeo, this.ringMat);
            ring.rotation.x = Math.PI / 2;
            g.add(core, ring);
            g.position.set(x, y + 1.4, z);
            this.group.add(g);
            this.orbs.push({
                word: w.word,
                meaning: w.meaning,
                position: new THREE.Vector3(x, y + 1.4, z),
                mesh: g,
                collected: false,
            });
            placed++;
        }
    }

    /** Returns the orb collected this frame (within `radius` of pos), if any. */
    tryCollect(pos: THREE.Vector3, radius: number): Orb | null {
        for (const orb of this.orbs) {
            if (orb.collected) continue;
            if (Math.hypot(pos.x - orb.position.x, pos.z - orb.position.z) < radius) {
                orb.collected = true;
                orb.mesh.visible = false;
                return orb;
            }
        }
        return null;
    }

    get total() {
        return this.orbs.length;
    }

    update(elapsed: number) {
        for (const orb of this.orbs) {
            if (orb.collected) continue;
            orb.mesh.rotation.y = elapsed * 1.2;
            orb.mesh.position.y =
                orb.position.y + Math.sin(elapsed * 2 + orb.position.x) * CONFIG.collectibles.bobHeight;
            orb.mesh.children[1].rotation.z = elapsed * 0.8;
        }
    }
}
