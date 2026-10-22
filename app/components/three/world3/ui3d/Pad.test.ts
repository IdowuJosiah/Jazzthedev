import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ACCENT } from "../Config";
import { LAYERS } from "../utils/shapes";
import type { MaterialsApi, TextApi, TextHandle } from "../types";
import * as PadModule from "./Pad";
import { buildPad, type PadDeps } from "./Pad";

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

    it("has no floating 3D keycap (owner: desktop-first, no on-screen controls)", () => {
        expect("buildKeycap" in PadModule).toBe(false);
        const pad = buildPad(def, deps, { accent: ACCENT.brand, label: "OPEN" });
        pad.setActive(true);
        // Outline + fill + the flat label only; nothing rises above the plate layer.
        expect(pad.group.children).toHaveLength(3);
        expect(maxMeshY(pad.group)).toBeCloseTo(LAYERS.plate.y, 6);
    });
});
