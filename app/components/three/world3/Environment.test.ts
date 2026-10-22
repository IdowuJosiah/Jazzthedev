import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CONFIG, LOOK, PALETTE } from "./Config";
import {
    blobAlpha,
    cameraOffset,
    createBlobTexture,
    Environment,
    fitShadowBox,
    fogRange,
    frustumGroundCorners,
    lightBasis,
    needsShadowRefit,
    snapToTexelGrid,
    type ShadowFitInput,
    type ShadowFitKey,
} from "./Environment";
import { glslFloat, injectAfter, patchWaterMaterial, WATER_PROGRAM_KEY } from "./shaders/water";
import type { CameraShot, CameraState, MaterialsApi, PhysicsApi, RenderProfile, Vec3Like } from "./types";
import { LAYERS } from "./utils/shapes";

const deg = THREE.MathUtils.degToRad;
const SH = CONFIG.shadow;
const BOX = SH.box;
const C = CONFIG.camera;

// ── Camera states (§4.1) ─────────────────────────────────────────────────
const portraitBase = (aspect: number, base: number) =>
    Math.max(base, C.portrait.visibleWidth / (2 * Math.tan(deg(C.portrait.halfAngleDeg)) * aspect));

interface Case extends ShadowFitInput {
    name: string;
    shot: CameraShot;
}

const landscape = (name: string, aspect: number, shot: "default" | "gallery", zoom: number): Case => ({
    name,
    shot,
    fov: C.fov,
    aspect,
    elevation: deg(C.shots[shot].elevationDeg),
    base: C.shots[shot].base,
    zoom,
});

const portrait = (name: string, aspect: number, zoom: number): Case => ({
    name,
    shot: "default",
    fov: C.portraitFov,
    aspect,
    elevation: deg(C.shots.default.elevationDeg + C.portrait.elevationBonusDeg),
    base: portraitBase(aspect, C.shots.default.base),
    zoom,
});

const CASES: Case[] = [
    landscape("default 16:9", 16 / 9, "default", 1),
    landscape("min zoom", 16 / 9, "default", C.zoom.min),
    landscape("max zoom", 16 / 9, "default", C.zoom.max),
    landscape("ultrawide max zoom", 21 / 9, "default", C.zoom.max),
    landscape("4:3", 4 / 3, "default", 1),
    landscape("gallery", 16 / 9, "gallery", 1),
    landscape("gallery max zoom", 16 / 9, "gallery", C.zoom.max),
    portrait("portrait 390×844", 390 / 844, 1),
    portrait("portrait min zoom", 390 / 844, C.zoom.min),
    portrait("portrait max zoom", 390 / 844, C.zoom.max),
];

const axes = (sunDir: Vec3Like = CONFIG.lights.sunDirection) => {
    const ax = new THREE.Vector3();
    const ay = new THREE.Vector3();
    const az = new THREE.Vector3();
    lightBasis(sunDir).extractBasis(ax, ay, az);
    return { ax, ay, az };
};

describe("Environment: fog (§1.6)", () => {
    it("near = 1.18·d, far = 3.0·d (45..115 at d = 38)", () => {
        const f = fogRange(38);
        expect(f.near).toBeCloseTo(44.84, 6);
        expect(f.far).toBeCloseTo(114, 6);
        expect(Math.round(f.near)).toBe(45);
    });
});

describe("Environment: shadow box (§1.5)", () => {
    it("the light basis matches the shadow camera (z axis points at the sun)", () => {
        const { az } = axes();
        const s = CONFIG.lights.sunDirection;
        expect(az.x).toBeCloseTo(s.x, 9);
        expect(az.y).toBeCloseTo(s.y, 9);
        expect(az.z).toBeCloseTo(s.z, 9);
        // Same basis three's DirectionalLightShadow builds via camera.lookAt.
        const cam = new THREE.OrthographicCamera();
        cam.position.set(s.x, s.y, s.z).multiplyScalar(SH.lightDistance);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        const cx = new THREE.Vector3();
        const cy = new THREE.Vector3();
        const cz = new THREE.Vector3();
        cam.matrixWorld.extractBasis(cx, cy, cz);
        const { ax, ay } = axes();
        expect(cx.distanceTo(ax)).toBeLessThan(1e-9);
        expect(cy.distanceTo(ay)).toBeLessThan(1e-9);
    });

    it("frustum corner rays end on y = 0, or are clamped at 140", () => {
        for (const c of CASES) {
            const rayDist = c.base * c.zoom + (BOX.pullback * c.base) / BOX.refBase;
            const eye = cameraOffset(rayDist, c.elevation);
            for (const p of frustumGroundCorners(c, rayDist)) {
                const len = p.distanceTo(eye);
                expect(len).toBeLessThanOrEqual(BOX.rayClamp + 1e-6);
                if (len < BOX.rayClamp - 1e-6) expect(Math.abs(p.y)).toBeLessThan(1e-6);
            }
        }
    });

    it("half extents are padded multiples of 4 and grow with zoom", () => {
        for (const c of CASES) {
            const f = fitShadowBox(c);
            expect(f.halfX % BOX.roundTo).toBe(0);
            expect(f.halfY % BOX.roundTo).toBe(0);
            expect(f.halfX).toBeGreaterThan(BOX.pad);
            expect(f.halfY).toBeGreaterThan(BOX.pad);
        }
        const small = fitShadowBox(landscape("a", 16 / 9, "default", C.zoom.min));
        const big = fitShadowBox(landscape("b", 16 / 9, "default", C.zoom.max));
        expect(big.halfX).toBeGreaterThan(small.halfX);
        expect(big.halfY).toBeGreaterThan(small.halfY);
        // Default view: a texel well under 0.05 units at 2048.
        const def = fitShadowBox(CASES[0]);
        expect((2 * Math.max(def.halfX, def.halfY)) / 2048).toBeLessThan(0.05);
    });

    it("covers the visible ground and 8-high casters at min / max zoom, gallery and portrait", () => {
        // Between refits the zoom may drift up to ±0.1 and the speed pull-back is
        // anywhere in [0, max]; the box (fitted once, recentred + snapped every
        // frame) must still contain every visible ground corner.
        const { ax, ay, az } = axes();
        const focus = new THREE.Vector3(37.3, 0, -91.7);
        const mapSize = 2048;
        for (const c of CASES) {
            const fit = fitShadowBox(c);
            const centre = snapToTexelGrid(
                focus.clone().add(fit.offset),
                lightBasis(CONFIG.lights.sunDirection),
                (2 * fit.halfX) / mapSize,
                (2 * fit.halfY) / mapSize
            );
            const cl = new THREE.Vector3(centre.dot(ax), centre.dot(ay), centre.dot(az));
            // Dense samples: a clamped far ray moves non-monotonically with zoom.
            const drift = BOX.refitZoomDelta - 1e-3;
            const zooms = Array.from({ length: 21 }, (_, i) => c.zoom - drift + (i / 20) * 2 * drift).filter(
                (z) => z >= C.zoom.min - 1e-9 && z <= C.zoom.max + 1e-9
            );
            for (const zoom of zooms) {
                for (const pull of [0, 0.25, 0.5, 0.75, 1]) {
                    const d = c.base * zoom + pull * ((BOX.pullback * c.base) / BOX.refBase);
                    const ground = frustumGroundCorners(c, d).map((p) => p.add(focus));
                    const raised = ground.map((p) => p.clone().setY(p.y + BOX.casterHeight));
                    for (const p of [...ground, ...raised]) {
                        const lx = p.dot(ax) - cl.x;
                        const ly = p.dot(ay) - cl.y;
                        const lz = p.dot(az) - cl.z;
                        const where = `${c.name} zoom ${zoom.toFixed(3)} pull ${pull}`;
                        expect(Math.abs(lx), where).toBeLessThanOrEqual(fit.halfX);
                        expect(Math.abs(ly), where).toBeLessThanOrEqual(fit.halfY);
                        // Inside [near, far] of a light sitting lightDistance up the sun ray.
                        expect(lz, where).toBeLessThanOrEqual(SH.lightDistance - SH.near);
                        expect(lz, where).toBeGreaterThanOrEqual(SH.lightDistance - SH.far);
                    }
                }
            }
        }
    });

    it("refits only on zoom > 0.1, aspect, FOV or shot changes", () => {
        const base: ShadowFitKey = { ...CASES[0] };
        expect(needsShadowRefit(null, base)).toBe(true);
        expect(needsShadowRefit(base, { ...base })).toBe(false);
        expect(needsShadowRefit(base, { ...base, zoom: base.zoom + 0.09 })).toBe(false);
        expect(needsShadowRefit(base, { ...base, zoom: base.zoom - 0.09 })).toBe(false);
        expect(needsShadowRefit(base, { ...base, zoom: base.zoom + 0.11 })).toBe(true);
        expect(needsShadowRefit(base, { ...base, aspect: 4 / 3 })).toBe(true);
        expect(needsShadowRefit(base, { ...base, fov: C.portraitFov })).toBe(true);
        expect(needsShadowRefit(base, { ...base, shot: "gallery" })).toBe(true);
        // The shot tween moves elevation / base: those refit too.
        expect(needsShadowRefit(base, { ...base, elevation: base.elevation + 0.01 })).toBe(true);
        expect(needsShadowRefit(base, { ...base, base: base.base + 1 })).toBe(true);
    });

    it("snaps the box centre to the light-space texel grid (no crawl)", () => {
        const basis = lightBasis(CONFIG.lights.sunDirection);
        const { ax, ay, az } = axes();
        const tx = 72 / 2048;
        const ty = 64 / 2048;
        const p = new THREE.Vector3();
        for (let i = 0; i < 200; i++) {
            p.set(Math.sin(i * 1.7) * 90, Math.cos(i * 0.3) * 3, Math.cos(i * 2.3) * 120);
            const s = snapToTexelGrid(p, basis, tx, ty);
            const kx = s.dot(ax) / tx;
            const ky = s.dot(ay) / ty;
            expect(Math.abs(kx - Math.round(kx))).toBeLessThan(1e-6);
            expect(Math.abs(ky - Math.round(ky))).toBeLessThan(1e-6);
            expect(Math.abs(s.dot(ax) - p.dot(ax))).toBeLessThanOrEqual(tx / 2 + 1e-9);
            expect(Math.abs(s.dot(ay) - p.dot(ay))).toBeLessThanOrEqual(ty / 2 + 1e-9);
            expect(s.dot(az)).toBeCloseTo(p.dot(az), 9);
        }
        // Sub-texel movement of the focus never moves the box.
        const a = snapToTexelGrid(new THREE.Vector3(10, 0, 10), basis, tx, ty);
        const b = snapToTexelGrid(new THREE.Vector3(10, 0, 10).addScaledVector(ax, tx * 0.1), basis, tx, ty);
        const shift = new THREE.Vector3().subVectors(b, a);
        expect(Math.abs(shift.dot(ax)) < 1e-9 || Math.abs(Math.abs(shift.dot(ax)) - tx) < 1e-9).toBe(true);
    });
});

describe("Environment: blob shadows (§1.5)", () => {
    it("alpha is 1 in the core, 0 at the edge, and falls off monotonically", () => {
        expect(blobAlpha(0, 0, 0.6)).toBe(1);
        expect(blobAlpha(0.3, 0.3, 0.6)).toBe(1);
        expect(blobAlpha(1, 0, 0.6)).toBe(0);
        expect(blobAlpha(1, 1, 1)).toBe(0);
        let prev = 2;
        for (let u = 0; u <= 1; u += 0.05) {
            const a = blobAlpha(u, u * 0.5, 1);
            expect(a).toBeLessThanOrEqual(prev + 1e-12);
            prev = a;
        }
        // Round blob is radially symmetric.
        expect(blobAlpha(0.5, 0, 1)).toBeCloseTo(blobAlpha(0, 0.5, 1), 12);
        expect(blobAlpha(Math.SQRT1_2 * 0.5, Math.SQRT1_2 * 0.5, 1)).toBeCloseTo(blobAlpha(0.5, 0, 1), 12);
    });

    it("the alpha map is 128² linear data: opaque centre, clear corners", () => {
        const size = SH.blob.textureSize;
        const tex = createBlobTexture(0.6);
        const data = tex.image.data as Uint8Array;
        expect(tex.image.width).toBe(size);
        expect(tex.colorSpace).toBe(THREE.NoColorSpace);
        const px = (i: number, j: number) => data[(j * size + i) * 4 + 1];
        expect(px(size / 2, size / 2)).toBe(255);
        expect(px(0, 0)).toBe(0);
        expect(px(size - 1, size / 2)).toBeLessThan(8);
        tex.dispose();
    });
});

describe("shaders/water (§2.2)", () => {
    it("patches three's basic shader: world xz varying, gradient + foam from Config", () => {
        const mat = new THREE.MeshBasicMaterial();
        const patch = patchWaterMaterial(mat, -177);
        const shader = {
            uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms),
            vertexShader: THREE.ShaderLib.basic.vertexShader,
            fragmentShader: THREE.ShaderLib.basic.fragmentShader,
        };
        mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
        expect(shader.vertexShader).toContain("vWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
        // The varying is written after project_vertex (transformed exists there).
        expect(shader.vertexShader.indexOf("vWaterXZ = ")).toBeGreaterThan(
            shader.vertexShader.indexOf("#include <project_vertex>")
        );
        // Colour is replaced after color_fragment, before lighting / fog.
        const fs = shader.fragmentShader;
        expect(fs.indexOf("diffuseColor.rgb = mix(water")).toBeGreaterThan(fs.indexOf("#include <color_fragment>"));
        expect(fs.indexOf("diffuseColor.rgb = mix(water")).toBeLessThan(fs.indexOf("#include <fog_fragment>"));
        const W = CONFIG.world.water;
        expect(fs).toContain(`smoothstep(${glslFloat(W.shallowToMid[0])}, ${glslFloat(W.shallowToMid[1])}, wd)`);
        expect(fs).toContain(`smoothstep(${glslFloat(W.midToDeep[0])}, ${glslFloat(W.midToDeep[1])}, wd)`);
        expect(fs).toContain(`wd * ${glslFloat(W.contour.frequency)} - uWaterTime * ${glslFloat(W.contour.speed)}`);
        expect(fs).toContain("fwidth(");
        // No waves, no normal map.
        expect(shader.vertexShader).not.toMatch(/sin\(|uNormalMap/);
        expect(shader.uniforms).toHaveProperty("uWaterTime");
        expect(mat.fog).toBe(true);
        expect(mat.customProgramCacheKey()).toBe(WATER_PROGRAM_KEY);
        patch.setTime(12.5);
        expect((shader.uniforms as Record<string, THREE.IUniform>).uWaterTime.value).toBe(12.5);
        expect(patch.uniforms.uWaterShoreZ.value).toBe(-177);
    });

    it("fails loudly if a shader anchor is missing; floats always have a point", () => {
        expect(() => injectAfter("void main(){}", "#include <nope>", "x")).toThrow(/anchor/);
        expect(glslFloat(2)).toBe("2.0");
        expect(glslFloat(0.35)).toBe("0.35");
        expect(glslFloat(-4)).toBe("-4.0");
    });
});

// ── Environment integration (headless: mocked physics + materials) ───────
interface BodyCall {
    kind: "slab" | "wall" | "cuboid";
    half?: Vec3Like;
    pos?: Vec3Like;
}

function mockPhysics() {
    const calls: BodyCall[] = [];
    const removed: unknown[] = [];
    const body = () => ({}) as never;
    const api = {
        world: { removeRigidBody: (b: unknown) => removed.push(b) },
        addGroundSlab: () => (calls.push({ kind: "slab" }), body()),
        addWall: (half: Vec3Like, pos: Vec3Like) => (calls.push({ kind: "wall", half, pos }), body()),
        addFixedCuboid: (half: Vec3Like, pos: Vec3Like) => (calls.push({ kind: "cuboid", half, pos }), body()),
    } as unknown as PhysicsApi;
    return { api, calls, removed };
}

const materials = {
    lambert: (hex: string) => new THREE.MeshLambertMaterial({ color: hex }),
    basic: (hex: string) => new THREE.MeshBasicMaterial({ color: hex }),
} as unknown as MaterialsApi;

const profile = (shadowMapSize: number): RenderProfile => ({
    id: shadowMapSize > 0 ? "desktop-high" : "desktop-low",
    dprCap: 2,
    antialias: true,
    shadowMapSize,
    scenery: shadowMapSize > 0 ? "high" : "low",
    isMobile: false,
    gpuTier: shadowMapSize > 0 ? 3 : 1,
});

const camState = (over: Partial<CameraState> = {}): CameraState => ({
    fov: C.fov,
    aspect: 16 / 9,
    elevation: deg(C.shots.default.elevationDeg),
    base: C.shots.default.base,
    zoom: 1,
    d: C.shots.default.base,
    focus: new THREE.Vector3(0, 0, 12),
    shot: "default",
    ...over,
});

const byName = (env: Environment, name: string) => env.group.getObjectByName(name) as THREE.Mesh;

const instancePositions = (m: THREE.InstancedMesh) => {
    const out: THREE.Vector3[] = [];
    const mat = new THREE.Matrix4();
    for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat);
        out.push(new THREE.Vector3().setFromMatrixPosition(mat));
    }
    return out;
};

describe("Environment (integration)", () => {
    it("builds the ground, quay, water and jetty with the §2.2 colliders", () => {
        const scene = new THREE.Scene();
        const phys = mockPhysics();
        const env = new Environment({ scene, physics: phys.api, materials, profile: profile(2048) });
        expect(scene.children).toContain(env.group);
        expect((scene.background as THREE.Color).getHexString()).toBe(LOOK.day.background.slice(1).toLowerCase());
        expect(scene.fog).toBe(env.fog);

        // Ground + slab.
        const ground = byName(env, "ground");
        expect(ground.receiveShadow).toBe(true);
        expect(ground.castShadow).toBe(false);
        const gb = new THREE.Box3().setFromObject(ground);
        expect(gb.min.x).toBeCloseTo(-700);
        expect(gb.max.z).toBeCloseTo(700);
        expect(gb.min.z).toBeCloseTo(-176);
        expect(gb.max.y).toBeCloseTo(0);
        expect(phys.calls.filter((c) => c.kind === "slab")).toHaveLength(1);

        // Bound walls (inner faces on the bounds) + 2 sea walls leaving x ∈ [−4, 4].
        const walls = phys.calls.filter((c) => c.kind === "wall");
        expect(walls).toHaveLength(5);
        const B = CONFIG.world.bounds;
        const faces = walls.map((w) => ({
            minX: w.pos!.x - w.half!.x,
            maxX: w.pos!.x + w.half!.x,
            minZ: w.pos!.z - w.half!.z,
            maxZ: w.pos!.z + w.half!.z,
            top: w.pos!.y + w.half!.y,
        }));
        expect(faces.some((f) => Math.abs(f.maxX - B.minX) < 1e-9 && f.top === CONFIG.world.wallHeight)).toBe(true);
        expect(faces.some((f) => Math.abs(f.minX - B.maxX) < 1e-9)).toBe(true);
        expect(faces.some((f) => Math.abs(f.minZ - B.maxZ) < 1e-9)).toBe(true);
        const sea = faces.filter((f) => Math.abs(f.top - CONFIG.world.quay.seaWallHeight) < 1e-9);
        expect(sea).toHaveLength(2);
        const gap = CONFIG.world.quay.jettyGapHalfWidth;
        expect(sea.map((f) => f.maxX).sort((a, b) => a - b)[0]).toBeCloseTo(-gap);
        expect(sea.map((f) => f.minX).sort((a, b) => b - a)[0]).toBeCloseTo(gap);
        for (const f of sea) expect(f.maxZ).toBeCloseTo(CONFIG.world.quayZ);
        // They reach the bound walls on both sides.
        expect(Math.min(...sea.map((f) => f.minX))).toBeLessThanOrEqual(B.minX);
        expect(Math.max(...sea.map((f) => f.maxX))).toBeGreaterThanOrEqual(B.maxX);

        // Quay strip: top at 0, z −176..−177.
        const sb = new THREE.Box3().setFromObject(byName(env, "quay-strip"));
        expect(sb.max.y).toBeCloseTo(0);
        expect(sb.max.z).toBeCloseTo(-176);
        expect(sb.min.z).toBeCloseTo(-177);

        // Bollards every 8, none in x ∈ [−6, 6].
        const bollards = byName(env, "bollards") as unknown as THREE.InstancedMesh;
        const bx = instancePositions(bollards).map((p) => p.x);
        expect(bx.every((x) => Math.abs(x) > CONFIG.world.quay.bollard.skipHalfWidth)).toBe(true);
        expect(bx).toContain(8);
        expect(bx).toContain(-8);
        expect(bx.every((x) => Math.abs(x % CONFIG.world.quay.bollard.spacing) < 1e-9)).toBe(true);
        expect(bollards.castShadow).toBe(true);

        // Water: y −1.1, z −900..−176, unlit + fogged.
        const water = byName(env, "water");
        const wb = new THREE.Box3().setFromObject(water);
        expect(wb.max.y).toBeCloseTo(CONFIG.world.water.y);
        expect(wb.min.z).toBeCloseTo(-900);
        expect(wb.max.z).toBeCloseTo(-176);
        expect(water.material).toBeInstanceOf(THREE.MeshBasicMaterial);
        expect((water.material as THREE.MeshBasicMaterial).fog).toBe(true);

        // Jetty planks: top at y 0, inside x −4..4, z −176..−200, non-overlapping.
        const planks = byName(env, "jetty-planks") as unknown as THREE.InstancedMesh;
        const P = CONFIG.world.jetty.plank;
        const pz = instancePositions(planks).map((p) => {
            expect(p.y + P.height / 2).toBeCloseTo(0);
            return p.z;
        });
        expect(pz.length).toBeGreaterThan(20);
        expect(Math.max(...pz) + P.depth / 2).toBeLessThanOrEqual(-176 + 1e-9);
        expect(Math.min(...pz) - P.depth / 2).toBeGreaterThanOrEqual(-200 - 1e-9);
        const sorted = [...pz].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeCloseTo(P.depth + P.gap);
        // No plank top overlaps the quay strip top (coplanar at y 0 → z-fight at the jetty mouth).
        expect(pz).toHaveLength(22);
        expect(Math.max(...pz) + P.depth / 2).toBeLessThanOrEqual(
            CONFIG.world.quayZ - CONFIG.world.quay.strip.depth + 1e-9
        );

        // Jetty colliders: deck top at 0, two 0.8 rails, an end bumper at z −200.
        const cuboids = phys.calls.filter((c) => c.kind === "cuboid");
        expect(cuboids).toHaveLength(4);
        const deck = cuboids.find((c) => c.half!.x === 4 && c.half!.z === 12)!;
        expect(deck.pos!.y + deck.half!.y).toBeCloseTo(0);
        const rails = cuboids.filter((c) => c !== deck && c.half!.z === 12);
        expect(rails).toHaveLength(2);
        for (const r of rails) expect(r.pos!.y + r.half!.y).toBeCloseTo(CONFIG.world.jetty.railHeight);
        const bumper = cuboids.find((c) => c !== deck && !rails.includes(c))!;
        expect(bumper.pos!.z - bumper.half!.z).toBeCloseTo(-200);

        expect(env.isDisposed()).toBe(false);
        env.dispose();
        // Scenery reads this to skip its blob calls on a torn-down Environment.
        expect(env.isDisposed()).toBe(true);
        expect(scene.children).not.toContain(env.group);
        expect(scene.fog).toBeNull();
        expect(scene.background).toBeNull();
        expect(phys.removed).toHaveLength(phys.calls.length);
    });

    it("lights come from LOOK (hemisphere, sun shadow caster, camera fill)", () => {
        const env = new Environment({
            scene: new THREE.Scene(),
            physics: mockPhysics().api,
            materials,
            profile: profile(2048),
        });
        const L = LOOK[CONFIG.look];
        expect(env.hemi.intensity).toBe(L.hemisphere.intensity);
        expect(env.sun.intensity).toBe(L.sun.intensity);
        expect(env.fill.intensity).toBe(L.fill.intensity);
        expect(env.sun.castShadow).toBe(true);
        expect(env.fill.castShadow).toBe(false);
        expect(env.sun.shadow.mapSize.x).toBe(2048);
        expect(env.sun.shadow.intensity).toBe(SH.intensity);
        expect(env.sun.shadow.bias).toBe(SH.bias);
        expect(env.sun.shadow.normalBias).toBe(SH.normalBias);
        expect(env.sun.shadow.radius).toBe(SH.radius);
        const F = CONFIG.lights.fillDirection;
        const fillDir = env.fill.position.clone().sub(env.fill.target.position).normalize();
        expect(fillDir.distanceTo(new THREE.Vector3(F.x, F.y, F.z))).toBeLessThan(1e-9);
        env.applyLook("dusk");
        expect(env.sun.intensity).toBe(LOOK.dusk.sun.intensity);
        expect(env.fog.color.getHexString()).toBe(LOOK.dusk.background.slice(1).toLowerCase());
        env.dispose();
    });

    it("calibration (§1.4): a sun-lit paper top stays inside the look's probe band", () => {
        // three's Lambert with physical intensities and NoToneMapping:
        //   out = albedo / π · (hemi(n) + Σ dir.colour·intensity·max(0, n·l)),
        // hemi(n) = mix(ground, sky, 0.5·n_y + 0.5)·intensity. Light colours are
        // read back from the Environment's own lights (linear THREE.Colors).
        const paper = new THREE.Color(PALETTE.paper);
        const up = new THREE.Vector3(0, 1, 0);
        for (const id of ["day", "dusk"] as const) {
            const env = new Environment({
                scene: new THREE.Scene(),
                physics: mockPhysics().api,
                materials,
                profile: profile(2048),
            });
            env.applyLook(id);
            const sunL = env.sun.position.clone().sub(env.sun.target.position).normalize();
            const fillL = env.fill.position.clone().sub(env.fill.target.position).normalize();
            const irr = env.hemi.color.clone().multiplyScalar(env.hemi.intensity);
            irr.add(env.sun.color.clone().multiplyScalar(env.sun.intensity * Math.max(0, up.dot(sunL))));
            irr.add(env.fill.color.clone().multiplyScalar(env.fill.intensity * Math.max(0, up.dot(fillL))));
            const out = irr.multiply(paper).multiplyScalar(1 / Math.PI);
            const band = LOOK[id].probe;
            const ch = [out.r, out.g, out.b];
            if (band.perChannel) {
                for (const v of ch) {
                    expect(v, id).toBeGreaterThanOrEqual(band.min);
                    expect(v, id).toBeLessThanOrEqual(band.max);
                }
            } else {
                expect(Math.max(...ch), id).toBeGreaterThanOrEqual(band.min);
                expect(Math.max(...ch), id).toBeLessThanOrEqual(band.max);
            }
            if (id === "day") {
                // The spec's measured day values: 0.952 / 0.927 / 0.919.
                expect(out.r).toBeCloseTo(0.952, 2);
                expect(out.g).toBeCloseTo(0.927, 2);
                expect(out.b).toBeCloseTo(0.919, 2);
            }
            env.dispose();
        }
    });

    it("update(): fog from d, sun at centre + dir·100, refit only when needed", () => {
        const env = new Environment({
            scene: new THREE.Scene(),
            physics: mockPhysics().api,
            materials,
            profile: profile(2048),
        });
        const cam = camState({ d: 41 });
        env.update(1 / 60, 1, cam);
        expect(env.fog.near).toBeCloseTo(CONFIG.fog.nearFactor * 41);
        expect(env.fog.far).toBeCloseTo(CONFIG.fog.farFactor * 41);

        const sc = env.sun.shadow.camera;
        const fit = env.shadowBox!;
        expect(sc.right).toBe(fit.halfX);
        expect(sc.top).toBe(fit.halfY);
        expect(sc.near).toBe(SH.near);
        expect(sc.far).toBe(SH.far);
        const toLight = env.sun.position.clone().sub(env.sun.target.position);
        expect(toLight.length()).toBeCloseTo(SH.lightDistance);
        const s = CONFIG.lights.sunDirection;
        expect(toLight.normalize().distanceTo(new THREE.Vector3(s.x, s.y, s.z))).toBeLessThan(1e-9);
        // The target is within half a texel (light x / y) of focus + offset.
        const want = cam.focus.clone().add(fit.offset);
        expect(env.sun.target.position.distanceTo(want)).toBeLessThan((2 * fit.halfX) / 2048);

        // Pull-back / small zoom drift: same box (no refit, texel size stable).
        const before = { ...fit };
        env.update(1 / 60, 1.1, camState({ d: 47, zoom: 1.08 }));
        expect(env.shadowBox).toBe(fit);
        expect(sc.right).toBe(before.halfX);
        // Zoom beyond 0.1: refit to a larger box.
        env.update(1 / 60, 1.2, camState({ d: 60, zoom: 1.3 }));
        expect(env.shadowBox).not.toBe(fit);
        expect(sc.right).toBeGreaterThan(before.halfX);

        // Sub-texel focus jitter moves the shadow camera across its own x / y
        // (the axes that shift texels) at most once, by exactly one texel.
        const { ax, ay } = axes();
        const lightXY = () => [env.sun.target.position.dot(ax), env.sun.target.position.dot(ay)];
        env.update(1 / 60, 2, camState({ zoom: 1.3, focus: new THREE.Vector3(5, 0, 5) }));
        const texel = (2 * env.shadowBox!.halfX) / 2048;
        let prev = lightXY();
        let moves = 0;
        for (let i = 1; i <= 20; i++) {
            env.update(1 / 60, 2, camState({ zoom: 1.3, focus: new THREE.Vector3(5 + i * 1e-4, 0, 5) }));
            const cur = lightXY();
            const dx = Math.abs(cur[0] - prev[0]);
            const dy = Math.abs(cur[1] - prev[1]);
            if (dx > 1e-9 || dy > 1e-9) moves++;
            expect(dx < 1e-9 || Math.abs(dx - texel) < 1e-6).toBe(true);
            prev = cur;
        }
        expect(20 * 1e-4).toBeLessThan(texel);
        expect(moves).toBeLessThanOrEqual(1);
        env.dispose();
    });

    it("low profiles: no shadow map, prop blobs drawn on the blob layer", () => {
        const env = new Environment({
            scene: new THREE.Scene(),
            physics: mockPhysics().api,
            materials,
            profile: profile(0),
        });
        expect(env.sun.castShadow).toBe(false);
        expect(env.usesPropBlobs).toBe(true);
        const range = env.addPropBlobs([
            { x: 1, z: 2, w: 2, d: 2 },
            { x: 5, z: 6, w: 10.8, d: 0.35, rot: Math.PI / 4 },
            { x: -3, z: -9, w: 3, d: 3 },
        ]);
        expect(range.size).toBe(3);
        const blobs = env.group.getObjectByName("prop-blobs") as THREE.Group;
        expect(blobs.visible).toBe(true);
        const mesh = blobs.children[0] as THREE.InstancedMesh;
        expect(mesh.count).toBe(3);
        expect(mesh.renderOrder).toBe(LAYERS.blob.renderOrder);
        expect(mesh.castShadow).toBe(false);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        expect(mat.opacity).toBe(SH.blob.staticProps.opacity);
        expect(mat.transparent).toBe(true);
        expect(mat.depthWrite).toBe(false);
        expect(mat.polygonOffsetFactor).toBe(LAYERS.blob.polygonOffsetFactor);
        expect(mat.polygonOffsetUnits).toBe(LAYERS.blob.polygonOffsetUnits);
        expect(mat.alphaMap).toBeTruthy();
        const bb = new THREE.Box3();
        mesh.geometry.computeBoundingBox();
        bb.copy(mesh.geometry.boundingBox!);
        expect(bb.max.y).toBeCloseTo(LAYERS.blob.y);

        // setCount hides the tail of a range (scenery prefix cuts).
        range.setCount(1);
        const m = new THREE.Matrix4();
        mesh.getMatrixAt(1, m);
        expect(m.determinant()).toBe(0);
        mesh.getMatrixAt(0, m);
        expect(m.determinant()).not.toBe(0);

        // Growth past the initial capacity keeps every blob.
        const many = Array.from({ length: 200 }, (_, i) => ({ x: i, z: 0, w: 1, d: 1 }));
        env.addPropBlobs(many);
        const grown = blobs.children[0] as THREE.InstancedMesh;
        expect(blobs.children).toHaveLength(1);
        expect(grown.count).toBe(203);

        // Quality raised: real shadows, blobs hidden; and back.
        env.setShadowMapSize(2048);
        expect(env.sun.castShadow).toBe(true);
        expect(blobs.visible).toBe(false);
        env.update(1 / 60, 0, camState());
        expect(env.shadowBox).not.toBeNull();
        env.setShadowMapSize(1024);
        expect(env.sun.shadow.mapSize.x).toBe(1024);
        env.setShadowMapSize(0);
        expect(env.sun.castShadow).toBe(false);
        expect(blobs.visible).toBe(true);

        // Shared following-blob materials are cached per kind + opacity.
        expect(env.blobMaterial("round", 0.3)).toBe(env.blobMaterial("round", 0.3));
        expect(env.blobMaterial("round", 0.3)).not.toBe(env.blobMaterial("rect", 0.3));
        env.dispose();
    });
});
