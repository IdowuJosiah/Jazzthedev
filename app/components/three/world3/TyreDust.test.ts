import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { MaterialsApi } from "./types";
import { Disposal } from "./utils/disposal";
import { DUST, DUST_EMIT_INTERVAL, puffScale, shouldEmitDust, TyreDust, type DustSource } from "./TyreDust";

const materials: MaterialsApi = {
    lambert: (hex) => new THREE.MeshLambertMaterial({ color: hex }),
    basic: (hex) => new THREE.MeshBasicMaterial({ color: hex }),
};

const source = (over: Partial<DustSource> = {}): DustSource => ({
    speed: 20,
    drifting: true,
    boosting: false,
    grounded: true,
    wheels: [new THREE.Vector3(1, 0, -1.4), new THREE.Vector3(-1, 0, -1.4)],
    velocity: new THREE.Vector3(0, 0, 20),
    ...over,
});

describe("TyreDust", () => {
    it("emits only above speed 6 while drifting or boosting on the ground", () => {
        expect(shouldEmitDust(7, true, false, true)).toBe(true);
        expect(shouldEmitDust(-7, false, true, true)).toBe(true);
        expect(shouldEmitDust(5, true, true, true)).toBe(false);
        expect(shouldEmitDust(20, false, false, true)).toBe(false);
        expect(shouldEmitDust(20, true, false, false)).toBe(false);
    });

    it("puffs swell then shrink to nothing at the end of life", () => {
        expect(puffScale(0)).toBeCloseTo(DUST.scale.start);
        expect(puffScale(DUST.scale.peakAt)).toBeCloseTo(DUST.scale.peak);
        expect(puffScale(1)).toBe(0);
        expect(puffScale(0.99)).toBeLessThan(0.1);
    });

    it("uses one 48-instance mesh that never casts shadows", () => {
        const dust = new TyreDust(materials, new Disposal());
        expect(dust.mesh.count).toBe(48);
        expect(dust.mesh.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
        expect(dust.mesh.castShadow).toBe(false);
        expect((dust.mesh.material as THREE.MeshLambertMaterial).color.getHexString()).toBe("efd9bc");
    });

    it("spawns at the rear wheels, lives 0.7 s and never exceeds the pool", () => {
        const dust = new TyreDust(materials, new Disposal());
        dust.update(DUST_EMIT_INTERVAL * 1.01, source());
        expect(dust.liveCount).toBe(2);
        expect(dust.mesh.visible).toBe(true);
        for (let i = 0; i < 120; i++) dust.update(1 / 60, source());
        expect(dust.liveCount).toBeLessThanOrEqual(DUST.capacity);
        expect(dust.liveCount).toBeGreaterThan(DUST.capacity / 2);
        for (let i = 0; i < Math.ceil((DUST.life * 60) / 1) + 2; i++) dust.update(1 / 60, source({ drifting: false }));
        expect(dust.liveCount).toBe(0);
        expect(dust.mesh.visible).toBe(false);
    });

    it("setEnabled(false) (adaptive dustOff) clears and stops emitting", () => {
        const dust = new TyreDust(materials, new Disposal());
        dust.update(0.1, source());
        dust.setEnabled(false);
        expect(dust.liveCount).toBe(0);
        dust.update(0.1, source());
        expect(dust.liveCount).toBe(0);
        dust.setEnabled(true);
        dust.update(0.1, source());
        expect(dust.liveCount).toBeGreaterThan(0);
    });
});
