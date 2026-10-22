import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CONFIG, PALETTE } from "./Config";
import {
    BAYER4,
    Materials,
    OCCLUDER_UNIFORMS,
    applyOccluder,
    bayer4,
    clearOccluder,
    hasOccluder,
    occluderDiscards,
    occluderKeep,
    setOccluder,
} from "./Materials";
import { LAYERS } from "./utils/shapes";

const OCC = CONFIG.scenery.occluder;

/** Runs a material's onBeforeCompile against the real Lambert / Basic shader source. */
function compiled(m: THREE.Material, lib: "lambert" | "basic") {
    const src = THREE.ShaderLib[lib];
    const shader = {
        uniforms: THREE.UniformsUtils.clone(src.uniforms),
        vertexShader: src.vertexShader,
        fragmentShader: src.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return shader;
}

describe("Materials cache (§1.3)", () => {
    it("caches one Lambert per (hex, flat, occluder, layer) and is case-insensitive on hex", () => {
        const mats = new Materials();
        const a = mats.lambert(PALETTE.paper);
        expect(mats.lambert("#fffdf8")).toBe(a);
        expect(mats.lambert(PALETTE.paper, { flat: true })).not.toBe(a);
        expect(mats.lambert(PALETTE.paper, { occluder: true })).not.toBe(a);
        expect(mats.lambert(PALETTE.paper, { layer: "plate" })).not.toBe(a);
        expect(a).toBeInstanceOf(THREE.MeshLambertMaterial);
        expect(a.color.getHexString(THREE.SRGBColorSpace)).toBe("fffdf8");
        expect(mats.lambert(PALETTE.boulder, { flat: true }).flatShading).toBe(true);
        mats.dispose();
        expect(mats.size).toBe(0);
    });

    it("applies the flat layer's polygonOffset / depthWrite", () => {
        const mats = new Materials();
        const l = mats.lambert(PALETTE.plaza, { layer: "plaza" });
        expect(l.polygonOffset).toBe(true);
        expect(l.polygonOffsetFactor).toBe(LAYERS.plaza.polygonOffsetFactor);
        expect(l.polygonOffsetUnits).toBe(LAYERS.plaza.polygonOffsetUnits);
        const b = mats.basic(PALETTE.ink, { layer: "groundText" });
        expect(b.depthWrite).toBe(false);
        expect(b.polygonOffsetUnits).toBe(LAYERS.groundText.polygonOffsetUnits);
    });

    it("basic(): fog on by default, cached per fog / layer / opacity; opacity < 1 is transparent without depth writes", () => {
        const mats = new Materials();
        const a = mats.basic(PALETTE.ink);
        expect(a).toBeInstanceOf(THREE.MeshBasicMaterial);
        expect(a.fog).toBe(true);
        expect(a.transparent).toBe(false);
        expect(mats.basic(PALETTE.ink, { fog: true })).toBe(a);
        expect(mats.basic(PALETTE.ink, { fog: false }).fog).toBe(false);
        const t = mats.basic(PALETTE.ink, { opacity: 0.35, layer: "plate" });
        expect(t).not.toBe(a);
        expect(t.transparent).toBe(true);
        expect(t.opacity).toBeCloseTo(0.35);
        // The plate layer writes depth, but a translucent pad outline must not.
        expect(LAYERS.plate.depthWrite).toBe(true);
        expect(t.depthWrite).toBe(false);
        expect(mats.basic(PALETTE.ink, { opacity: 0.35, layer: "plate" })).toBe(t);
    });
});

describe("occluder dither (§1.3)", () => {
    it("bayer4 is the 16-level ordered-dither matrix with thresholds in (0, 1)", () => {
        expect([...BAYER4].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
        const seen = new Set<number>();
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(bayer4(x + 0.5, y + 0.5));
        expect(seen.size).toBe(16);
        for (const v of seen) expect(v > 0 && v < 1).toBe(true);
        // Tiles every 4 pixels.
        expect(bayer4(5, 6)).toBe(bayer4(1, 2));
    });

    it("keep follows smoothstep(near, far, d) + step(endT, t) along the camera → car segment", () => {
        const cam = { x: 0, y: 30, z: 30 };
        const car = { x: 0, y: 1, z: 0 };
        const mid = { x: 0, y: 15.5, z: 15 };
        expect(occluderKeep(mid, cam, car)).toBe(0); // on the line, mid-way: fully cut
        expect(occluderDiscards(0, 0, 0)).toBe(true);
        const far = { x: 10, y: 15.5, z: 15 };
        expect(occluderKeep(far, cam, car)).toBe(1); // 10 units off the line: kept
        // Between near and far it is partial.
        const half = { x: (OCC.near + OCC.far) / 2, y: 15.5, z: 15 };
        const k = occluderKeep(half, cam, car);
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThan(1);
        // Past the car (t clamps to 1 ≥ endT): always kept, so the ground at the car never dithers.
        expect(occluderKeep({ x: 0, y: 0, z: -1 }, cam, car)).toBeGreaterThanOrEqual(1);
        // keep ≥ 1 never discards at any pixel.
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(occluderDiscards(1, x, y)).toBe(false);
    });

    it("degenerate segment (camera on the car) does not divide by zero", () => {
        const p = { x: 1, y: 1, z: 1 };
        expect(Number.isFinite(occluderKeep(p, p, p))).toBe(true);
    });

    it("setOccluder moves the shared uniforms (car lifted by carLift); clearOccluder parks them", () => {
        setOccluder({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
        expect(OCCLUDER_UNIFORMS.uOccA.value.toArray()).toEqual([1, 2, 3]);
        expect(OCCLUDER_UNIFORMS.uOccB.value.toArray()).toEqual([4, 5 + OCC.carLift, 6]);
        clearOccluder();
        const a = OCCLUDER_UNIFORMS.uOccA.value;
        expect(occluderKeep({ x: 0, y: 0, z: 0 }, a, OCCLUDER_UNIFORMS.uOccB.value)).toBeGreaterThanOrEqual(1);
    });

    it("occluder materials share uniform objects and inject the dither into Lambert and Basic shaders", () => {
        const mats = new Materials();
        const a = mats.lambert(PALETTE.foliage, { occluder: true });
        const b = mats.lambert(PALETTE.trunk, { occluder: true });
        expect(hasOccluder(a)).toBe(true);
        expect(hasOccluder(mats.lambert(PALETTE.trunk))).toBe(false);
        // One shared function → identical program cache key across occluder materials.
        expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
        expect(a.customProgramCacheKey()).not.toBe(mats.lambert(PALETTE.trunk).customProgramCacheKey());

        const sa = compiled(a, "lambert");
        const sb = compiled(b, "lambert");
        expect(sa.uniforms.uOccA).toBe(OCCLUDER_UNIFORMS.uOccA);
        expect(sb.uniforms.uOccB).toBe(sa.uniforms.uOccB);
        expect(sa.vertexShader).toContain("vOccWorld = occWorld.xyz");
        expect(sa.vertexShader).toContain("instanceMatrix * occWorld");
        expect(sa.fragmentShader).toContain("occBayer4( gl_FragCoord.xy )");
        expect(sa.fragmentShader).toContain("discard");

        const basic = applyOccluder(new THREE.MeshBasicMaterial());
        const sbasic = compiled(basic, "basic");
        expect(sbasic.fragmentShader).toContain("occKeep");
        // Idempotent.
        expect(applyOccluder(basic)).toBe(basic);
        // clone() drops onBeforeCompile: the clone must not claim the patch.
        expect(hasOccluder(a.clone())).toBe(false);
    });
});
