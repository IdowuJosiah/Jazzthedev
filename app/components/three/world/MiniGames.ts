import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PALETTE } from "./Config";
import type { Physics } from "./Physics";
import type { Assets } from "./Assets";
import type { Environment } from "./Environment";
import type { Disposal } from "./utils/disposal";

interface Dyn {
    body: RAPIER.RigidBody;
    mesh: THREE.Object3D;
    init: { p: THREE.Vector3; q: THREE.Quaternion };
}

/** A physics playground: a jump ramp, a knockable crate pyramid, and a push-ball. */
export class MiniGames {
    group = new THREE.Group();
    center: THREE.Vector3;
    private dyn: Dyn[] = [];

    constructor(
        private physics: Physics,
        private assets: Assets,
        env: Environment,
        private disposal: Disposal
    ) {
        const cx = 42;
        const cz = 2;
        const cy = env.heightAt(cx, cz);
        this.center = new THREE.Vector3(cx, cy, cz);
        this.buildRamp(cx, cy, cz - 10);
        this.buildCratePyramid(cx, cy, cz + 8);
        this.buildBall(cx + 10, cy, cz);
    }

    private buildRamp(x: number, y: number, z: number) {
        const w = 6;
        const len = 8;
        const angle = -0.32;
        const mat = this.disposal.track(
            new THREE.MeshStandardMaterial({ color: 0x1b2347, roughness: 0.6, metalness: 0.2 })
        );
        const geo = this.disposal.track(new THREE.BoxGeometry(w, 0.5, len));
        const mesh = new THREE.Mesh(geo, mat);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
        mesh.position.set(x, y + 1.0, z);
        mesh.quaternion.copy(q);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        // neon lip
        const lipMat = this.disposal.track(
            new THREE.MeshStandardMaterial({ color: PALETTE.neonLime, emissive: PALETTE.neonLime, emissiveIntensity: 1.6 })
        );
        const lip = new THREE.Mesh(this.disposal.track(new THREE.BoxGeometry(w, 0.12, 0.4)), lipMat);
        lip.position.set(x, y + 1.0 + Math.sin(-angle) * (len / 2) + 0.3, z - Math.cos(angle) * (len / 2));
        this.group.add(lip);
        this.physics.addFixedCuboidRot(
            { x: w / 2, y: 0.25, z: len / 2 },
            { x, y: y + 1.0, z },
            { x: q.x, y: q.y, z: q.z, w: q.w },
            0.6
        );
    }

    private buildCratePyramid(x: number, y: number, z: number) {
        const size = 1.1;
        const rows = 4;
        const crateModel = this.assets.get("crate");
        for (let r = 0; r < rows; r++) {
            const n = rows - r;
            for (let i = 0; i < n; i++) {
                const px = x + (i - (n - 1) / 2) * (size + 0.04);
                const py = y + size / 2 + r * size;
                const body = this.physics.addDynamicBox(
                    { x: size / 2, y: size / 2, z: size / 2 },
                    { x: px, y: py, z },
                    6
                );
                const mesh = this.makeCrateMesh(crateModel ? crateModel.clone(true) : null, size);
                this.group.add(mesh);
                this.dyn.push({
                    body,
                    mesh,
                    init: { p: new THREE.Vector3(px, py, z), q: new THREE.Quaternion() },
                });
            }
        }
    }

    private makeCrateMesh(model: THREE.Object3D | null, size: number) {
        if (model) {
            const box = new THREE.Box3().setFromObject(model);
            const s = new THREE.Vector3();
            box.getSize(s);
            model.scale.multiplyScalar(size / Math.max(s.x, s.y, s.z, 0.001));
            model.traverse((o) => {
                const m = o as THREE.Mesh;
                if (m.isMesh) m.castShadow = true;
            });
            return model;
        }
        const mat = this.disposal.track(
            new THREE.MeshStandardMaterial({ color: 0xb9823f, roughness: 0.7 })
        );
        const edge = this.disposal.track(
            new THREE.MeshStandardMaterial({ color: PALETTE.neonAmber, emissive: PALETTE.neonAmber, emissiveIntensity: 0.8 })
        );
        const g = new THREE.Group();
        const body = new THREE.Mesh(this.disposal.track(new THREE.BoxGeometry(size, size, size)), mat);
        body.castShadow = true;
        const frame = new THREE.Mesh(
            this.disposal.track(new THREE.BoxGeometry(size * 1.02, size * 0.08, size * 1.02)),
            edge
        );
        g.add(body, frame);
        return g;
    }

    private buildBall(x: number, y: number, z: number) {
        const radius = 1.6;
        const body = this.physics.addDynamicBall(radius, { x, y: y + radius, z }, 3);
        const mat = this.disposal.track(
            new THREE.MeshStandardMaterial({
                color: PALETTE.neonPink,
                emissive: PALETTE.neonPink,
                emissiveIntensity: 0.5,
                roughness: 0.4,
                metalness: 0.2,
            })
        );
        const mesh = new THREE.Mesh(this.disposal.track(new THREE.SphereGeometry(radius, 20, 16)), mat);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.dyn.push({
            body,
            mesh,
            init: { p: new THREE.Vector3(x, y + radius, z), q: new THREE.Quaternion() },
        });
    }

    reset() {
        for (const d of this.dyn) {
            d.body.setTranslation({ x: d.init.p.x, y: d.init.p.y, z: d.init.p.z }, true);
            d.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            d.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
    }

    update() {
        for (const d of this.dyn) {
            const t = d.body.translation();
            const r = d.body.rotation();
            d.mesh.position.set(t.x, t.y, t.z);
            d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
    }
}
