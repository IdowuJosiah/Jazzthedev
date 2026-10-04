import * as THREE from "three";
import { CONFIG } from "./Config";
import type { Assets } from "./Assets";
import type { Disposal } from "./utils/disposal";
import { makeRng, TAU } from "./utils/math";

/** A small flock of birds circling the island — ambient life. */
export class Creatures {
    group = new THREE.Group();
    private birds: { obj: THREE.Object3D; radius: number; speed: number; phase: number; y: number }[] = [];

    constructor(assets: Assets, private disposal: Disposal, count = 7) {
        const base = assets.get("bird");
        if (!base) return;
        // normalize size
        const box = new THREE.Box3().setFromObject(base);
        const size = new THREE.Vector3();
        box.getSize(size);
        const s = 1.6 / Math.max(size.y, 0.001);
        const rng = makeRng(CONFIG.world.seed + 303);
        for (let i = 0; i < count; i++) {
            const obj = i === 0 ? base : base.clone(true);
            obj.scale.setScalar(s);
            this.group.add(obj);
            this.birds.push({
                obj,
                radius: 40 + rng() * 70,
                speed: 0.1 + rng() * 0.18,
                phase: rng() * TAU,
                y: 18 + rng() * 22,
            });
        }
    }

    update(elapsed: number, focus: THREE.Vector3) {
        for (const b of this.birds) {
            const a = b.phase + elapsed * b.speed;
            const x = focus.x + Math.cos(a) * b.radius;
            const z = focus.z + Math.sin(a) * b.radius;
            const y = b.y + Math.sin(elapsed * 1.5 + b.phase) * 2;
            b.obj.position.set(x, y, z);
            // face direction of travel + slight bank
            b.obj.rotation.y = -a + Math.PI / 2;
            b.obj.rotation.z = Math.sin(elapsed * 4 + b.phase) * 0.25;
        }
    }

    dispose() {
        /* geometries/materials tracked by Disposal via Assets */
        void this.disposal;
    }
}
