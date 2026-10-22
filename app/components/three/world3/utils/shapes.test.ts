import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CONFIG } from "../Config";
import { LAYERS, applyLayerToObject, flatPlate, flatRing } from "./shapes";

const worldMaxY = (obj: THREE.Object3D) => {
    obj.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(obj).max.y;
};

describe("utils/shapes flat layers (§2.5)", () => {
    it("layers stack bottom to top: plaza < plate < padOnPlate < groundText < tile < onTile", () => {
        const ys = (["plaza", "plate", "padOnPlate", "groundText", "tile", "tileText"] as const).map((id) => LAYERS[id].y);
        for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        expect(LAYERS.padOnPlate.y).toBe(CONFIG.text.layers.padOnPlate);
    });

    it("a flatPlate passed through applyLayerToObject sits exactly at its layer height (no double offset)", () => {
        for (const id of ["plate", "plaza", "padOnPlate"] as const) {
            const m = applyLayerToObject(new THREE.Mesh(flatPlate(4, 2, 0.3, id)), id);
            expect(worldMaxY(m)).toBeCloseTo(LAYERS[id].y, 6);
            expect(m.renderOrder).toBe(LAYERS[id].renderOrder);
            expect(m.castShadow).toBe(false);
        }
        const ring = applyLayerToObject(new THREE.Mesh(flatRing(4, 2, 0.3, 0.2, "plate")), "plate");
        expect(worldMaxY(ring)).toBeCloseTo(LAYERS.plate.y, 6);
    });

    it("a plate stays below ground text so its own copy is never depth-hidden", () => {
        const m = applyLayerToObject(new THREE.Mesh(flatPlate(4, 2, 0.3)), "plate");
        expect(worldMaxY(m)).toBeLessThan(LAYERS.groundText.y);
    });
});
