import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ACCENT, CONFIG } from "../Config";
import { LAYERS } from "../utils/shapes";
import type { MaterialsApi, TextApi, TextHandle } from "../types";
import { buildKeycap, buildPad, type PadDeps } from "./Pad";

const handle = (): TextHandle => ({ object: new THREE.Object3D(), dispose() {} }) as unknown as TextHandle;
const deps: PadDeps = {
    materials: {
        lambert: () => new THREE.MeshLambertMaterial(),
        basic: () => new THREE.MeshBasicMaterial(),
    } as unknown as MaterialsApi,
    text: { flat: handle, upright: handle, onPath: handle } as unknown as TextApi,
};

const maxMeshY = (g: THREE.Object3D) => {
    g.updateMatrixWorld(true);
    let y = -Infinity;
    g.traverse((o) => {
        if (o instanceof THREE.Mesh) y = Math.max(y, new THREE.Box3().setFromObject(o).max.y);
    });
    return y;
};

describe("ui3d/Pad (§5.3)", () => {
    const def = { x: 4, z: -8, w: 6, d: 4, faceCamera: true };

    it("draws on the plate layer by default and on padOnPlate when asked", () => {
        const onGround = buildPad(def, deps, { accent: ACCENT.brand });
        onGround.setActive(true);
        expect(maxMeshY(onGround.group)).toBeCloseTo(LAYERS.plate.y, 6);
        const onPlate = buildPad(def, deps, { accent: ACCENT.brand, layer: "padOnPlate" });
        onPlate.setActive(true);
        expect(maxMeshY(onPlate.group)).toBeCloseTo(LAYERS.padOnPlate.y, 6);
    });

    it("the keycap never casts a shadow (it would shade the pad label)", () => {
        const k = buildKeycap(deps);
        let casters = 0;
        k.group.traverse((o) => {
            if (o.castShadow) casters++;
        });
        expect(casters).toBe(0);
        k.dispose();
    });

    it("reads reducedMotion live when given a getter (runtime toggle, §9.4)", () => {
        const K = CONFIG.pad.keycap;
        let reduced = true;
        const k = buildKeycap(deps, { reducedMotion: () => reduced });
        const cap = k.group.children[0];
        k.show();
        expect(cap.position.y).toBe(K.raisedY); // snapped, no tween
        k.hide();
        expect(cap.position.y).toBe(K.restY);
        expect(cap.visible).toBe(false);
        reduced = false;
        k.show();
        expect(cap.visible).toBe(true);
        expect(cap.position.y).toBe(K.restY); // tween starts from rest
        reduced = true;
        k.punch();
        expect(cap.position.y).toBe(K.raisedY);
        k.dispose();
    });
});
