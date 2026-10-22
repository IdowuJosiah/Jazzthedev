import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import { CONFIG, PALETTE } from "./Config";
import {
    Assets,
    BOARD_LOAD_DISTANCE,
    BoardTextures,
    MODEL_URLS,
    SIZE_ESTIMATE,
    NATURE_DIR,
    NATURE_KINDS,
    NATURE_MATERIAL_TOKENS,
    NATURE_MODELS,
    NATURE_NORMALIZE,
    ProgressAggregator,
    UnknownNatureMaterialError,
    applyTokenRemap,
    boardUrl,
    convertStandardToLambert,
    findStandardMaterials,
    natureKind,
    natureToken,
    normalizeNature,
    prepareNature,
    preparePalm,
    toLambert,
} from "./Assets";
import { Materials, hasOccluder } from "./Materials";

const PUBLIC = join(__dirname, "../../../../public");
const publicFile = (url: string) => join(PUBLIC, url);

/** The JSON chunk of a .glb file. */
function glbJson(file: string): {
    materials?: { name?: string }[];
    images?: { uri?: string; bufferView?: number; mimeType?: string }[];
    buffers?: { uri?: string }[];
    bufferViews?: { byteOffset?: number; byteLength: number }[];
    nodes?: { name?: string }[];
} {
    const b = readFileSync(file);
    const len = b.readUInt32LE(12);
    return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

function parseGLB(file: string): Promise<GLTF> {
    const b = readFileSync(file);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    return new Promise((resolve, reject) => new GLTFLoader().parse(ab, "", resolve, reject));
}

describe("Nature Kit subset (§2.6)", () => {
    const files = NATURE_MODELS.map((n) => publicFile(`${NATURE_DIR}${n}.glb`));

    it("ships 3 trees, 2 bushes, 3 rocks, ≤ 250 KB in total, with no external resources", () => {
        expect(NATURE_KINDS.tree).toHaveLength(3);
        expect(NATURE_KINDS.bush).toHaveLength(2);
        expect(NATURE_KINDS.boulder).toHaveLength(3);
        expect(new Set(Object.values(NATURE_KINDS).flat())).toEqual(new Set(NATURE_MODELS));
        let total = 0;
        for (const f of files) {
            total += statSync(f).size;
            const j = glbJson(f);
            for (const img of j.images ?? []) expect(img.uri).toBeUndefined();
            for (const buf of j.buffers ?? []) expect(buf.uri).toBeUndefined();
        }
        expect(total).toBeLessThanOrEqual(250 * 1024);
    });

    it("every shipped material name maps to a palette token (the build fails on unknown names)", () => {
        for (const [i, f] of files.entries()) {
            for (const m of glbJson(f).materials ?? []) {
                expect(() => natureToken(m.name ?? "", NATURE_MODELS[i])).not.toThrow();
            }
        }
    });

    it("natureToken throws on unknown names and maps the known ones", () => {
        expect(natureToken("leafsGreen")).toBe("foliage");
        expect(natureToken("woodBark")).toBe("trunk");
        expect(natureToken("dirt")).toBe("boulder");
        expect(natureToken("grass")).toBe("bush");
        expect(() => natureToken("_defaultMat", "rock_largeB")).toThrow(UnknownNatureMaterialError);
        expect(() => natureToken("toString")).toThrow(UnknownNatureMaterialError);
        for (const token of Object.values(NATURE_MATERIAL_TOKENS)) expect(PALETTE[token]).toMatch(/^#/);
    });

    it("prepareNature leaves no MeshStandardMaterial: shared palette Lamberts with the occluder", async () => {
        const mats = new Materials();
        for (const name of NATURE_MODELS) {
            const gltf = await parseGLB(publicFile(`${NATURE_DIR}${name}.glb`));
            prepareNature(gltf.scene, mats, name);
            expect(findStandardMaterials(gltf.scene)).toHaveLength(0);
            gltf.scene.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (!mesh.isMesh) return;
                const m = mesh.material as THREE.MeshLambertMaterial;
                expect(m).toBeInstanceOf(THREE.MeshLambertMaterial);
                expect(hasOccluder(m)).toBe(true);
                expect(mesh.castShadow).toBe(true);
                const token = mesh.userData.paletteToken as keyof typeof PALETTE;
                expect(m).toBe(mats.lambert(PALETTE[token], { occluder: true, flat: token === "boulder" }));
            });
        }
        // Trees: leaves recolour per instance to foliageDark.
        const tree = await parseGLB(publicFile(`${NATURE_DIR}tree_oak.glb`));
        prepareNature(tree.scene, mats, "tree_oak");
        const clone = tree.scene.clone(true);
        applyTokenRemap(clone, mats, { foliage: "foliageDark" });
        const colours = new Set<string>();
        clone.traverse((o) => {
            if ((o as THREE.Mesh).isMesh)
                colours.add(((o as THREE.Mesh).material as THREE.MeshLambertMaterial).color.getHexString(THREE.SRGBColorSpace));
        });
        expect(colours).toEqual(new Set([PALETTE.foliageDark.slice(1).toLowerCase(), PALETTE.trunk.slice(1).toLowerCase()]));
    });

    it("prepareNature throws on an unknown material name", () => {
        const root = new THREE.Group();
        root.add(new THREE.Mesh(new THREE.BoxGeometry(), Object.assign(new THREE.MeshStandardMaterial(), { name: "lava" })));
        expect(() => prepareNature(root, new Materials(), "test")).toThrow(UnknownNatureMaterialError);
    });
});

describe("GLB → Lambert conversion (§1.3)", () => {
    it("copies map / color / side / vertexColors / alphaTest / transparent / opacity", () => {
        const map = new THREE.Texture();
        const src = new THREE.MeshStandardMaterial({
            map,
            color: "#123456",
            side: THREE.DoubleSide,
            vertexColors: true,
            alphaTest: 0.4,
            transparent: true,
            opacity: 0.6,
            metalness: 0.4,
        });
        src.name = "Atlas";
        const l = toLambert(src);
        expect(l.map).toBe(map);
        expect(l.color.getHex()).toBe(src.color.getHex());
        expect(l.side).toBe(THREE.DoubleSide);
        expect(l.vertexColors).toBe(true);
        expect(l.alphaTest).toBe(0.4);
        expect(l.transparent).toBe(true);
        expect(l.opacity).toBe(0.6);
        expect(l.name).toBe("Atlas");
    });

    it("keeps shared materials shared, converts MeshPhysicalMaterial, leaves Basic alone", () => {
        const shared = new THREE.MeshStandardMaterial();
        const phys = new THREE.MeshPhysicalMaterial();
        const basic = new THREE.MeshBasicMaterial();
        const root = new THREE.Group();
        const geo = new THREE.BoxGeometry();
        const a = new THREE.Mesh(geo, shared);
        const b = new THREE.Mesh(geo, shared);
        const c = new THREE.Mesh(geo, [phys, basic]);
        root.add(a, b, c);
        const created = convertStandardToLambert(root);
        expect(created).toHaveLength(2);
        expect(a.material).toBe(b.material);
        expect((c.material as THREE.Material[])[1]).toBe(basic);
        expect(findStandardMaterials(root)).toHaveLength(0);
    });

    it("palm: Lambert + its original atlas + occluder; shadows on", () => {
        const atlas = new THREE.Texture();
        const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: atlas, metalness: 0.4 }));
        const [m] = preparePalm(root);
        expect(root.material).toBe(m);
        expect(m.map).toBe(atlas);
        expect(hasOccluder(m)).toBe(true);
        expect(root.castShadow).toBe(true);
    });
});

describe("ProgressAggregator", () => {
    it("is byte-weighted and monotonic, and failed items complete", () => {
        const seen: number[] = [];
        const p = new ProgressAggregator((f) => seen.push(f));
        p.add("a", 100);
        p.add("b", 100);
        p.update("a", 50);
        expect(p.fraction).toBeCloseTo(0.25);
        // A real total larger than the estimate would lower the fraction: it must not go back.
        p.update("a", 50, 1000);
        expect(p.fraction).toBeCloseTo(0.25);
        p.done("b");
        p.done("a");
        expect(p.fraction).toBe(1);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    });
});

describe("BoardTextures (§5.1 lazy load)", () => {
    const tex = () => new THREE.Texture();

    it("maps bare names to /assets/boards/*.webp", () => {
        expect(boardUrl("clay")).toBe("/assets/boards/clay.webp");
        expect(boardUrl("/assets/boards/mara.webp")).toBe("/assets/boards/mara.webp");
    });

    it("loads only after start(), only within range, once per URL, and notifies", async () => {
        const load = vi.fn(async () => tex());
        const boards = new BoardTextures(load);
        boards.register("clay", 44, -76);
        boards.register("mara", 44 + BOARD_LOAD_DISTANCE + 50, -76);
        const heard: string[] = [];
        boards.onLoaded((url) => heard.push(url));

        boards.update(0, 0);
        expect(load).not.toHaveBeenCalled(); // before Start
        boards.start();
        boards.update(0, 0);
        boards.update(0, 0);
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith("/assets/boards/clay.webp");
        await boards.request("clay");
        expect(boards.get("clay")).not.toBeNull();
        expect(boards.get("mara")).toBeNull();
        expect(heard).toEqual(["/assets/boards/clay.webp"]);

        const cb = vi.fn();
        await boards.request("clay", cb); // already loaded: callback still fires
        await Promise.resolve();
        expect(cb).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("a failed image resolves null (placeholder stays) and does not throw", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const boards = new BoardTextures(async () => {
            throw new Error("404");
        });
        await expect(boards.request("eko-phone")).resolves.toBeNull();
        expect(boards.get("eko-phone")).toBeNull();
        warn.mockRestore();
    });
});

// ── Load-time behaviour (ported from W1-D's scratch checks) ─────────────
describe("normalizeNature (§2.6 kit sizes)", () => {
    it("normalises trees to height 4.9, bushes to 0.9 and boulders to a footprint of 2", async () => {
        expect(NATURE_NORMALIZE).toBe(CONFIG.scenery.kitNormalize);
        expect(NATURE_NORMALIZE.tree).toEqual({ measure: "height", size: 4.9 });
        expect(NATURE_NORMALIZE.bush).toEqual({ measure: "height", size: 0.9 });
        expect(NATURE_NORMALIZE.boulder).toEqual({ measure: "footprint", size: 2 });
        const mats = new Materials();
        for (const name of NATURE_MODELS) {
            const gltf = await parseGLB(publicFile(`${NATURE_DIR}${name}.glb`));
            prepareNature(gltf.scene, mats, name);
            const kind = natureKind(name);
            normalizeNature(gltf.scene, kind);
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const spec = NATURE_NORMALIZE[kind];
            const measured =
                spec.measure === "height" ? box.max.y : Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
            expect(measured, name).toBeCloseTo(spec.size, 5);
            // Baked into the geometry: the root keeps an identity transform for Scenery to scale.
            expect(gltf.scene.scale.toArray()).toEqual([1, 1, 1]);
            // A scaled clone scales the normalised size (no double-applied factor).
            const clone = gltf.scene.clone(true);
            clone.scale.setScalar(1.5);
            clone.updateMatrixWorld(true);
            expect(new THREE.Box3().setFromObject(clone).max.y).toBeCloseTo(box.max.y * 1.5, 5);
        }
    });
});

type FetchOutcome = { ok: true; gltf: GLTF } | { ok: false; error: unknown };
/** Assets with its network layer replaced (fetchGLTF / the texture loader are private). */
type AssetsInternals = {
    fetchGLTF: (url: string) => Promise<FetchOutcome>;
    textureLoader: { loadAsync: (url: string) => Promise<THREE.Texture> };
};
const internals = (a: Assets) => a as unknown as AssetsInternals;

/** A GLTF-shaped result: one mesh whose material carries `materialName`. */
function fakeGLTF(materialName: string): GLTF {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), Object.assign(new THREE.MeshStandardMaterial(), { name: materialName })));
    return { scene, animations: [] } as unknown as GLTF;
}

describe("Assets.load", () => {
    it("an unknown Nature Kit material skips that model (model() null) without rejecting load()", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const a = new Assets({ materials: new Materials(), avatarUrl: null, loadNature: true });
            internals(a).fetchGLTF = async (url) => ({
                ok: true,
                gltf: fakeGLTF(url.includes("tree_oak") ? "lava" : url.includes("nature") ? "dirt" : "body"),
            });
            await expect(a.load()).resolves.toBeUndefined();
            expect(a.model("nature/tree_oak")).toBeNull();
            expect(a.model("nature/tree_default")).not.toBeNull();
            expect(a.model("palm")).not.toBeNull();
            expect(a.model("car")).toBeNull();
            expect(err).toHaveBeenCalledTimes(1);
            expect(String(err.mock.calls[0][0])).toContain("tree_oak");
        } finally {
            err.mockRestore();
            warn.mockRestore();
        }
    });

    it("no required model: car.glb is never requested and load() resolves when every model fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            expect(Object.keys(MODEL_URLS)).not.toContain("car");
            expect(Object.keys(SIZE_ESTIMATE)).not.toContain("car");
            const a = new Assets({ materials: new Materials(), loadNature: true });
            const requested: string[] = [];
            internals(a).fetchGLTF = async (url) => {
                requested.push(url);
                return { ok: false, error: new Error("404") };
            };
            await expect(a.load()).resolves.toBeUndefined();
            expect(requested.some((u) => u.includes("car"))).toBe(false);
            expect(requested).toContain(MODEL_URLS.palm);
            expect(a.model("car")).toBeNull();
            expect(a.model("palm")).toBeNull();
        } finally {
            warn.mockRestore();
        }
    });

    it("dispose() during loading frees every model once it arrives", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const a = new Assets({ materials: new Materials(), avatarUrl: null, loadNature: false });
            const arrivals: (() => void)[] = [];
            const geometries: THREE.BufferGeometry[] = [];
            internals(a).fetchGLTF = (url) =>
                new Promise((resolve) => {
                    const gltf = fakeGLTF(url);
                    gltf.scene.traverse((o) => {
                        if ((o as THREE.Mesh).isMesh) geometries.push((o as THREE.Mesh).geometry);
                    });
                    arrivals.push(() => resolve({ ok: true, gltf }));
                });
            const loading = a.load();
            a.dispose();
            const spies = geometries.map((g) => vi.spyOn(g, "dispose"));
            for (const arrive of arrivals) arrive();
            await loading;
            expect(a.model("car")).toBeNull();
            expect(a.model("palm")).toBeNull();
            for (const spy of spies) expect(spy).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it("a texture that arrives after dispose() is freed, not cached", async () => {
        const a = new Assets({ materials: new Materials() });
        const tex = new THREE.Texture();
        const freed = vi.spyOn(tex, "dispose");
        let arrive!: () => void;
        internals(a).textureLoader = {
            loadAsync: () => new Promise((resolve) => (arrive = () => resolve(tex))),
        };
        const pending = a.texture("/assets/boards/clay.webp");
        a.dispose();
        arrive();
        await expect(pending).rejects.toThrow(/after dispose/);
        expect(freed).toHaveBeenCalledTimes(1);
    });
});
