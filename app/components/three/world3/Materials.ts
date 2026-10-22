import * as THREE from "three";
import { CONFIG, type HexColor } from "./Config";
import { applyLayerToMaterial, type FlatLayerId } from "./utils/shapes";
import { clamp, smoothstep } from "./utils/math";
import type { BasicOptions, LambertOptions, MaterialsApi } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Shared palette materials (§1.3). One cached MeshLambertMaterial per
// (hex, flat, occluder, layer) and one MeshBasicMaterial per
// (hex, fog, layer, opacity), so the whole world draws from a handful of
// programs. No matcaps, no toon ramps, no emissives.
//
// Occluder dither: scenery between the camera and the car fades out with a
// screen-door (ordered 4×4 Bayer) discard. For each fragment the shader takes
// the distance d to the segment uOccA (camera) → uOccB (car + carLift·Y) and how
// far along it the fragment sits, t ∈ [0, 1]:
//
//     keep = smoothstep(near, far, d) + step(endT, t)
//     discard if keep < bayer4(gl_FragCoord.xy)
//
// The uniforms are SHARED objects (one Vector3 each), injected into every
// occluder program, and moved once per frame by `setOccluder(camPos, carPos)`.
// Shadow depth passes use three's internal depth materials, so occluded props
// still cast their shadows.
// ─────────────────────────────────────────────────────────────────────────

const OCC = CONFIG.scenery.occluder;

/** Guards the segment projection when camera and car coincide (degenerate segment). */
const OCC_SEGMENT_EPS = 1e-6;
/**
 * Where the segment is parked until the first `setOccluder` call: far below the
 * world, so every fragment has d ≫ far and nothing dithers.
 */
const OCC_PARKED_Y = -1e5;

/** Standard 4×4 ordered-dither (Bayer) matrix, row-major, values 0..15. */
export const BAYER4: readonly number[] = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
const BAYER_N = 4;
const BAYER_LEVELS = BAYER_N * BAYER_N;

/** The dither threshold at a pixel (matches the GLSL bayer4): (m + 0.5) / 16 ∈ (0, 1). */
export function bayer4(px: number, py: number): number {
    const x = ((Math.floor(px) % BAYER_N) + BAYER_N) % BAYER_N;
    const y = ((Math.floor(py) % BAYER_N) + BAYER_N) % BAYER_N;
    return (BAYER4[y * BAYER_N + x] + 0.5) / BAYER_LEVELS;
}

interface V3 {
    x: number;
    y: number;
    z: number;
}

/**
 * CPU mirror of the occluder shader's `keep` value for a world point p and the
 * segment a → b (camera → lifted car). Used by tests and ?debug readouts.
 */
export function occluderKeep(p: V3, a: V3, b: V3, near: number = OCC.near, far: number = OCC.far, endT: number = OCC.endT): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const len2 = Math.max(abx * abx + aby * aby + abz * abz, OCC_SEGMENT_EPS);
    const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2, 0, 1);
    const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
    return smoothstep(near, far, d) + (t >= endT ? 1 : 0);
}

/** True when the fragment at screen pixel (px, py) is discarded by the dither. */
export function occluderDiscards(keep: number, px: number, py: number): boolean {
    return keep < bayer4(px, py);
}

// ── Shared occluder uniforms ─────────────────────────────────────────────
const occUniforms = {
    uOccA: { value: new THREE.Vector3(0, OCC_PARKED_Y, 0) },
    uOccB: { value: new THREE.Vector3(0, OCC_PARKED_Y, 0) },
    /** (near, far, endT); a uniform so ?debug can tune the fade live. */
    uOccParams: { value: new THREE.Vector3(OCC.near, OCC.far, OCC.endT) },
};

/** Read-only view of the shared occluder uniforms (debug / tests). */
export const OCCLUDER_UNIFORMS: Readonly<typeof occUniforms> = occUniforms;

/**
 * Moves the occluder segment. Call once per frame (after the camera and the
 * car's interpolated pose are final): A = camera position, B = car + carLift·Y.
 */
export function setOccluder(camPos: V3, carPos: V3): void {
    occUniforms.uOccA.value.set(camPos.x, camPos.y, camPos.z);
    occUniforms.uOccB.value.set(carPos.x, carPos.y + OCC.carLift, carPos.z);
}

/** Parks the segment so nothing dithers (e.g. photo mode, intro, before Start). */
export function clearOccluder(): void {
    occUniforms.uOccA.value.set(0, OCC_PARKED_Y, 0);
    occUniforms.uOccB.value.set(0, OCC_PARKED_Y, 0);
}

/** Overrides the fade parameters (?debug); defaults come from CONFIG.scenery.occluder. */
export function setOccluderParams(near: number, far: number, endT: number): void {
    occUniforms.uOccParams.value.set(near, far, endT);
}

const OCC_VERTEX_PARS = /* glsl */ `
varying vec3 vOccWorld;
`;

// Mirrors <project_vertex> (batching → instancing → model) with modelMatrix so
// instanced scenery gets each instance's world position.
const OCC_VERTEX = /* glsl */ `
{
    vec4 occWorld = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
        occWorld = batchingMatrix * occWorld;
    #endif
    #ifdef USE_INSTANCING
        occWorld = instanceMatrix * occWorld;
    #endif
    occWorld = modelMatrix * occWorld;
    vOccWorld = occWorld.xyz;
}
`;

const BAYER_GLSL = BAYER4.map((v) => `${v}.0`).join(", ");

const OCC_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uOccA;
uniform vec3 uOccB;
uniform vec3 uOccParams;
varying vec3 vOccWorld;

float occBayer4( vec2 frag ) {
    const float m[ ${BAYER_LEVELS} ] = float[ ${BAYER_LEVELS} ]( ${BAYER_GLSL} );
    ivec2 c = ivec2( mod( floor( frag ), ${BAYER_N}.0 ) );
    return ( m[ c.y * ${BAYER_N} + c.x ] + 0.5 ) / ${BAYER_LEVELS}.0;
}
`;

const OCC_FRAGMENT = /* glsl */ `
{
    vec3 occAB = uOccB - uOccA;
    float occT = clamp( dot( vOccWorld - uOccA, occAB ) / max( dot( occAB, occAB ), ${OCC_SEGMENT_EPS.toExponential()} ), 0.0, 1.0 );
    float occD = distance( vOccWorld, uOccA + occAB * occT );
    float occKeep = smoothstep( uOccParams.x, uOccParams.y, occD ) + step( uOccParams.z, occT );
    if ( occKeep < occBayer4( gl_FragCoord.xy ) ) discard;
}
`;

/**
 * The ONE onBeforeCompile used by every occluder material. A single shared
 * function keeps three's default program cache key (its source text) identical
 * across materials, so all occluder Lamberts of a variant share one program,
 * while each material still receives the shared uniform objects.
 */
function occluderOnBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uOccA = occUniforms.uOccA;
    shader.uniforms.uOccB = occUniforms.uOccB;
    shader.uniforms.uOccParams = occUniforms.uOccParams;
    shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${OCC_VERTEX_PARS}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${OCC_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${OCC_FRAGMENT_PARS}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${OCC_FRAGMENT}`);
}

/**
 * Installs the occluder dither on any Lambert / Basic material (e.g. the palm's
 * textured Lambert, which the palette cache can't produce). Idempotent.
 */
export function applyOccluder<T extends THREE.Material>(material: T): T {
    if (hasOccluder(material)) return material;
    material.onBeforeCompile = occluderOnBeforeCompile;
    material.needsUpdate = true;
    return material;
}

/**
 * True when the material carries the occluder patch. Checked by function
 * identity, not a userData flag: `Material.clone()` copies userData but NOT
 * onBeforeCompile, so a cloned scenery material loses the dither (pass
 * `material: (m) => m` to buildInstances to keep the shared one).
 */
export function hasOccluder(material: THREE.Material): boolean {
    return material.onBeforeCompile === occluderOnBeforeCompile;
}

// ── Cache keys (exported for tests) ──────────────────────────────────────
const normHex = (hex: HexColor) => hex.toUpperCase();

export function lambertKey(hex: HexColor, opts: LambertOptions = {}): string {
    return `L|${normHex(hex)}|${opts.flat ? "flat" : "smooth"}|${opts.occluder ? "occ" : "-"}|${opts.layer ?? "-"}`;
}

export function basicKey(hex: HexColor, opts: BasicOptions = {}): string {
    const opacity = opts.opacity ?? 1;
    return `B|${normHex(hex)}|${opts.fog === false ? "nofog" : "fog"}|${opts.layer ?? "-"}|${opacity}`;
}

/**
 * The material cache (implements MaterialsApi). Materials are shared: callers
 * must never mutate or dispose them — `dispose()` here frees them all.
 */
export class Materials implements MaterialsApi {
    private lamberts = new Map<string, THREE.MeshLambertMaterial>();
    private basics = new Map<string, THREE.MeshBasicMaterial>();

    lambert(hex: HexColor, opts: LambertOptions = {}): THREE.MeshLambertMaterial {
        const key = lambertKey(hex, opts);
        let m = this.lamberts.get(key);
        if (m) return m;
        m = new THREE.MeshLambertMaterial({ color: hex, flatShading: !!opts.flat });
        m.name = key;
        if (opts.layer) applyLayerToMaterial(m, opts.layer as FlatLayerId);
        if (opts.occluder) applyOccluder(m);
        this.lamberts.set(key, m);
        return m;
    }

    basic(hex: HexColor, opts: BasicOptions = {}): THREE.MeshBasicMaterial {
        const key = basicKey(hex, opts);
        let m = this.basics.get(key);
        if (m) return m;
        const opacity = clamp(opts.opacity ?? 1, 0, 1);
        m = new THREE.MeshBasicMaterial({ color: hex, fog: opts.fog !== false });
        m.name = key;
        if (opacity < 1) {
            m.transparent = true;
            m.opacity = opacity;
            m.depthWrite = false;
        }
        if (opts.layer) {
            applyLayerToMaterial(m, opts.layer);
            // A translucent material never writes depth, whatever the layer says.
            if (opacity < 1) m.depthWrite = false;
        }
        this.basics.set(key, m);
        return m;
    }

    /** Number of cached materials (debug / tests). */
    get size(): number {
        return this.lamberts.size + this.basics.size;
    }

    dispose(): void {
        for (const m of this.lamberts.values()) m.dispose();
        for (const m of this.basics.values()) m.dispose();
        this.lamberts.clear();
        this.basics.clear();
    }
}
