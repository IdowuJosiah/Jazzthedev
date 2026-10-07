import * as THREE from "three";
import { CONFIG, PALETTE } from "../Config";

// ─────────────────────────────────────────────────────────────────────────
// Lagoon water patch (§2.2). The water is a plain MeshBasicMaterial (so it gets
// fog for free and stays unlit); this patch only swaps its flat colour for:
//
//   d     = distance north of the quay face (world units, ≥ 0 on the water)
//   col   = mix(shallow, mid, smoothstep(2, 14, d)) → mix(·, deep, smoothstep(14, 60, d))
//   foam  = solid band where d < 0.7, plus moving contour lines
//           f = fract(d·0.35 − t·0.25)
//           line = smoothstep(0.93 − fw, 0.93 + fw, f) · (1 − smoothstep(4, 16, d))
//
// No waves, no normal map. Every number comes from CONFIG.world.water.
// ─────────────────────────────────────────────────────────────────────────

const W = CONFIG.world.water;

/** Program cache key: one program for the (single) water material. */
export const WATER_PROGRAM_KEY = "world3-water-v1";

export interface WaterUniforms {
    uWaterTime: THREE.IUniform<number>;
    uWaterShoreZ: THREE.IUniform<number>;
    uWaterShallow: THREE.IUniform<THREE.Color>;
    uWaterMid: THREE.IUniform<THREE.Color>;
    uWaterDeep: THREE.IUniform<THREE.Color>;
    uWaterFoam: THREE.IUniform<THREE.Color>;
}

export interface WaterPatch {
    readonly uniforms: WaterUniforms;
    /** Seconds; drives the contour-line drift. */
    setTime(t: number): void;
}

/** A GLSL float literal (always carries a decimal point). */
export function glslFloat(n: number): string {
    if (!Number.isFinite(n)) throw new Error(`[world3/water] non-finite constant ${n}`);
    const s = String(n);
    return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** Replaces the first `anchor` in `src`; throws if three's chunk layout changed. */
export function injectAfter(src: string, anchor: string, code: string): string {
    const i = src.indexOf(anchor);
    if (i < 0) throw new Error(`[world3/water] shader anchor not found: ${anchor}`);
    const end = i + anchor.length;
    return `${src.slice(0, end)}\n${code}${src.slice(end)}`;
}

const VERTEX_PARS = /* glsl */ `varying vec2 vWaterXZ;`;
// `transformed` is the object-space position after morph/skinning (begin_vertex).
const VERTEX_MAIN = /* glsl */ `vWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`;

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vWaterXZ;
uniform float uWaterTime;
uniform float uWaterShoreZ;
uniform vec3 uWaterShallow;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform vec3 uWaterFoam;
`;

function fragmentMain(): string {
    const C = W.contour;
    const f = glslFloat;
    return /* glsl */ `
    {
        // North is −Z: distance from the quay face out into the lagoon.
        float wd = uWaterShoreZ - vWaterXZ.y;
        vec3 water = mix(uWaterShallow, uWaterMid, smoothstep(${f(W.shallowToMid[0])}, ${f(W.shallowToMid[1])}, wd));
        water = mix(water, uWaterDeep, smoothstep(${f(W.midToDeep[0])}, ${f(W.midToDeep[1])}, wd));
        // Solid foam band at the waterline (anti-aliased by the screen-space footprint of d).
        float fwD = fwidth(wd);
        float band = 1.0 - smoothstep(${f(W.foamBand)} - fwD, ${f(W.foamBand)} + fwD, wd);
        // Contour lines. fwidth() is taken of the UNWRAPPED phase so the fract()
        // seam doesn't produce a 1-px spike; the trailing edge at the wrap is
        // smoothed the same way so the line has two soft edges.
        float phase = wd * ${f(C.frequency)} - uWaterTime * ${f(C.speed)};
        float fc = fract(phase);
        float fw = fwidth(phase);
        float line = smoothstep(${f(C.threshold)} - fw, ${f(C.threshold)} + fw, fc);
        line *= 1.0 - smoothstep(1.0 - fw, 1.0, fc);
        line *= 1.0 - smoothstep(${f(C.fadeStart)}, ${f(C.fadeEnd)}, wd);
        diffuseColor.rgb = mix(water, uWaterFoam, max(band, line));
    }
`;
}

/**
 * Patches a MeshBasicMaterial into the lagoon (gradient + foam). `shoreZ` is the
 * world z of the visible waterline (the quay's water face); d = shoreZ − worldZ.
 * The material keeps `fog: true`, so the water fades exactly like the ground.
 */
export function patchWaterMaterial(material: THREE.MeshBasicMaterial, shoreZ: number): WaterPatch {
    const uniforms: WaterUniforms = {
        uWaterTime: { value: 0 },
        uWaterShoreZ: { value: shoreZ },
        // THREE.Color converts the sRGB hex to linear (ColorManagement), so the
        // mixes happen in linear space like every other material.
        uWaterShallow: { value: new THREE.Color(PALETTE.waterShallow) },
        uWaterMid: { value: new THREE.Color(PALETTE.water) },
        uWaterDeep: { value: new THREE.Color(PALETTE.waterDeep) },
        uWaterFoam: { value: new THREE.Color(PALETTE.foam) },
    };
    // The patch replaces the colour entirely; keep `diffuse` neutral.
    material.color.set(PALETTE.foam);
    material.fog = true;
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = injectAfter(
            injectAfter(shader.vertexShader, "#include <common>", VERTEX_PARS),
            "#include <project_vertex>",
            VERTEX_MAIN
        );
        shader.fragmentShader = injectAfter(
            injectAfter(shader.fragmentShader, "#include <common>", FRAGMENT_PARS),
            "#include <color_fragment>",
            fragmentMain()
        );
    };
    material.customProgramCacheKey = () => WATER_PROGRAM_KEY;
    material.needsUpdate = true;
    return {
        uniforms,
        setTime(t: number) {
            uniforms.uWaterTime.value = t;
        },
    };
}
