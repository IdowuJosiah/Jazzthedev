import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { CONFIG, PALETTE, type HexColor, type PaletteToken } from "./Config";
import { applyOccluder, type Materials } from "./Materials";
import type { AssetsApi, ModelName } from "./types";
import type { Disposal } from "./utils/disposal";

// ─────────────────────────────────────────────────────────────────────────
// Assets (W1-D). Loads the GLB models with real byte progress, converts every
// MeshStandardMaterial to Lambert (§1.3), repaints the car's Kenney colormap
// into the palette (§4.2), recolours the Nature Kit subset into palette tokens
// (§2.6; unknown material names THROW), and serves board / portrait textures
// (sRGB, mipmapped, anisotropic) with a distance-gated lazy loader (§5.1).
//
// Required: car.glb (retried once, then load() rejects → "asset" failure card).
// Optional: palm, avatar, Nature Kit, board images → null / placeholder. An
// optional model that loads but fails preparation (e.g. an unmapped Nature Kit
// material) is logged with console.error and skipped; it never fails load().
// ─────────────────────────────────────────────────────────────────────────

/** Model URLs (public/assets/models). */
export const MODEL_URLS = {
    car: "/assets/models/car.glb",
    palm: "/assets/models/palm.glb",
    avatar: "/assets/models/avatar.glb",
} as const;

export const NATURE_DIR = "/assets/models/nature/";

/** The Kenney Nature Kit subset shipped in public/assets/models/nature (§2.6). */
export const NATURE_MODELS = [
    "tree_default",
    "tree_oak",
    "tree_fat",
    "plant_bush",
    "plant_bushLarge",
    "rock_largeA",
    "rock_largeC",
    "rock_smallA",
] as const;
export type NatureModelName = (typeof NATURE_MODELS)[number];

export type NatureKind = "tree" | "bush" | "boulder";

/** Nature models by scenery prop kind (Scenery.ts picks per instance). */
export const NATURE_KINDS: Readonly<Record<NatureKind, readonly NatureModelName[]>> = Object.freeze({
    tree: ["tree_default", "tree_oak", "tree_fat"],
    bush: ["plant_bush", "plant_bushLarge"],
    boulder: ["rock_largeA", "rock_largeC", "rock_smallA"],
});

/** The prop kind a Nature Kit model belongs to. */
export function natureKind(name: NatureModelName): NatureKind {
    for (const kind of Object.keys(NATURE_KINDS) as NatureKind[]) {
        if (NATURE_KINDS[kind].includes(name)) return kind;
    }
    throw new Error(`[world3] Nature Kit model "${name}" is in no NATURE_KINDS list`);
}

/**
 * Size every Nature Kit model is normalised to at load time (`normalizeNature`),
 * so the CONFIG.scenery.scale ranges mean the same for `'kit'` and
 * `'procedural'` (§2.6). The kit ships in its own units (trees ≈ 1.2–1.7 tall,
 * bushes ≈ 0.24, rocks ≈ 0.2–0.3 tall). Each size matches the procedural prop:
 * - tree: height 4.9, the procedural crown top (3.2 + 1.7);
 * - bush: height 0.9, the procedural bush's half-height, so scale ≤ 1.6 stays
 *   ≤ 1.5 high near the south / east bounds;
 * - boulder: footprint 2, the procedural Dodecahedron(1)'s diameter. Kit rocks
 *   are flat slabs; matching their height instead would make them 3–4× wider.
 */
export const NATURE_NORMALIZE: Readonly<Record<NatureKind, { measure: "height" | "footprint"; size: number }>> =
    Object.freeze({
        tree: { measure: "height", size: 4.9 },
        bush: { measure: "height", size: 0.9 },
        boulder: { measure: "footprint", size: 2 },
    });

/**
 * Nature Kit source material name → palette token (exact, case-sensitive).
 * Verified from the GLBs: trees use leafsGreen + woodBark; bushes use grass;
 * rocks are a `dirt` body with a small `grass` tuft on top. Anything else
 * throws (`natureToken`), and Assets.test.ts parses every shipped GLB, so a
 * new model with an unmapped material fails `npm run test`.
 */
export const NATURE_MATERIAL_TOKENS: Readonly<Record<string, PaletteToken>> = Object.freeze({
    leafsGreen: "foliage",
    woodBark: "trunk",
    dirt: "boulder",
    grass: "bush",
});

/** Tokens drawn flat-shaded (boulders are faceted, §1.2). */
export const FLAT_TOKENS: ReadonlySet<PaletteToken> = new Set<PaletteToken>(["boulder"]);

/** Leaf colours chosen at random per tree instance (§1.2 foliage / foliageDark). */
export const FOLIAGE_TOKENS: readonly PaletteToken[] = ["foliage", "foliageDark"];

export class UnknownNatureMaterialError extends Error {
    constructor(
        readonly materialName: string,
        readonly model: string
    ) {
        super(
            `[world3] Nature Kit material "${materialName}" in "${model}" has no palette token. ` +
                `Add it to NATURE_MATERIAL_TOKENS in Assets.ts.`
        );
        this.name = "UnknownNatureMaterialError";
    }
}

/** Palette token for a Nature Kit material name; throws on unknown names. */
export function natureToken(materialName: string, model = "?"): PaletteToken {
    const token = Object.prototype.hasOwnProperty.call(NATURE_MATERIAL_TOKENS, materialName)
        ? NATURE_MATERIAL_TOKENS[materialName]
        : undefined;
    if (!token) throw new UnknownNatureMaterialError(materialName, model);
    return token;
}

// ── Stream-local constants (not in Config yet; see report) ───────────────
/** Board texture anisotropy cap: min(this, renderer max) (§5.1). */
export const MAX_ANISOTROPY = 8;
/** Boards start loading once within this distance of the focus (§5.1). */
export const BOARD_LOAD_DISTANCE = 120;
/** Directory + extension used when a board is requested by bare name ("clay"). */
export const BOARD_DIR = "/assets/boards/";
export const BOARD_EXT = ".webp";
/** Attempts after the first failure for required assets (§6.2: retry once). */
export const REQUIRED_RETRIES = 1;
/**
 * Progress weights (bytes) used until a response reports its real size; close
 * to the shipped files so the bar moves evenly from the start. The avatar is
 * optional and usually a 404 (§8.3), so it is weighted like a small error
 * response: a real avatar replaces the estimate with its Content-Length (the
 * bar holds, never drops, until it catches up).
 */
export const SIZE_ESTIMATE = {
    car: 183_000,
    palm: 112_000,
    avatar: 4_000,
    nature: 8_000,
} as const;

// ── Car colormap repaint (§4.2) ──────────────────────────────────────────
export interface ColormapCell {
    col: number;
    row: number;
    hex: HexColor;
}

/**
 * Kenney car colormap cells (col, row) on the 8 × 4 grid, verified from the
 * UVs (§4.2): body paint (7,1), dark trim (3,2), tyre (2,2), rim (4,1), lights
 * (6,2) and (0,3).
 */
export const CAR_COLORMAP_CELLS = Object.freeze({
    body: [{ col: 7, row: 1 }],
    trim: [{ col: 3, row: 2 }],
    tyre: [{ col: 2, row: 2 }],
    rim: [{ col: 4, row: 1 }],
    light: [
        { col: 6, row: 2 },
        { col: 0, row: 3 },
    ],
} as const);

export type CarPaint = "brand" | "danfo";

/** The fills for a paint option, in draw order. */
export function carRepaintCells(paint: CarPaint): ColormapCell[] {
    const C = CAR_COLORMAP_CELLS;
    const fills: [readonly { col: number; row: number }[], HexColor][] = [
        [C.body, CONFIG.vehicle.paints[paint]],
        [C.trim, PALETTE.carTrim],
        [C.tyre, PALETTE.carTyre],
        [C.rim, PALETTE.carRim],
        [C.light, PALETTE.carLight],
    ];
    return fills.flatMap(([cells, hex]) => cells.map((c) => ({ col: c.col, row: c.row, hex })));
}

/** Fills each cell's full 64×128 rect on a 2D context. */
export function paintColormapCells(
    g: { fillStyle: string | CanvasGradient | CanvasPattern; fillRect(x: number, y: number, w: number, h: number): void },
    cells: readonly ColormapCell[]
): void {
    const { cellW, cellH } = CONFIG.vehicle.colormap;
    for (const c of cells) {
        g.fillStyle = c.hex;
        g.fillRect(c.col * cellW, c.row * cellH, cellW, cellH);
    }
}

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

const defaultCanvas: CanvasFactory = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
};

/**
 * Draws the original colormap into a 512² canvas, fills the palette cells and
 * returns a nearest-filtered, non-mipmapped sRGB CanvasTexture (flipY false,
 * glTF UV convention).
 */
export function repaintCarColormap(
    image: CanvasImageSource | null,
    paint: CarPaint,
    createCanvas: CanvasFactory = defaultCanvas
): THREE.CanvasTexture {
    const size = CONFIG.vehicle.colormap.size;
    const canvas = createCanvas(size, size);
    const g = canvas.getContext("2d");
    if (!g) throw new Error("[world3] 2D canvas unavailable for the car repaint");
    if (image) g.drawImage(image, 0, 0, size, size);
    paintColormapCells(g, carRepaintCells(paint));
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.name = "car-colormap-palette";
    return tex;
}

// ── GLB → Lambert conversion (§1.3) ──────────────────────────────────────
const isStandard = (m: THREE.Material): m is THREE.MeshStandardMaterial =>
    (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;

/** A Lambert copy of a standard (or physical) material: map/color/side/vertexColors/alphaTest/transparent/opacity. */
export function toLambert(src: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({
        map: src.map,
        color: src.color.clone(),
        side: src.side,
        vertexColors: src.vertexColors,
        alphaTest: src.alphaTest,
        transparent: src.transparent,
        opacity: src.opacity,
    });
    m.name = src.name;
    return m;
}

const meshMaterials = (mesh: THREE.Mesh): THREE.Material[] =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material];

/** Every texture a material references (map, normalMap, roughnessMap, …). */
export function materialTextures(m: THREE.Material): THREE.Texture[] {
    const found: THREE.Texture[] = [];
    for (const value of Object.values(m)) {
        if ((value as THREE.Texture | null)?.isTexture === true) found.push(value as THREE.Texture);
    }
    return found;
}

/**
 * Replaces every MeshStandardMaterial under `root` with a Lambert copy. Shared
 * source materials stay shared (one Lambert per source). Returns the created
 * Lambert materials; the replaced standard materials are disposed, and so are
 * their textures that no Lambert kept (normal / roughness / metalness maps).
 * Kept maps belong to the caller (Material.dispose() never frees its map).
 */
export function convertStandardToLambert(root: THREE.Object3D): THREE.MeshLambertMaterial[] {
    const map = new Map<THREE.Material, THREE.MeshLambertMaterial>();
    const swap = (m: THREE.Material): THREE.Material => {
        if (!isStandard(m)) return m;
        let l = map.get(m);
        if (!l) {
            l = toLambert(m);
            map.set(m, l);
        }
        return l;
    };
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    const kept = new Set<THREE.Texture>();
    for (const l of map.values()) for (const t of materialTextures(l)) kept.add(t);
    for (const src of map.keys()) {
        for (const t of materialTextures(src)) if (!kept.has(t)) t.dispose();
        src.dispose();
    }
    return [...map.values()];
}

/** Every MeshStandardMaterial still reachable under `root` (should be none). */
export function findStandardMaterials(root: THREE.Object3D): THREE.Material[] {
    const found = new Set<THREE.Material>();
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) for (const m of meshMaterials(mesh)) if (isStandard(m)) found.add(m);
    });
    return [...found];
}

const setShadows = (root: THREE.Object3D, cast: boolean, receive: boolean) =>
    root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
            o.castShadow = cast;
            o.receiveShadow = receive;
        }
    });

// ── Per-model preparation (exported for tests) ───────────────────────────
/** White material colour: a textured material shows its map unchanged. */
const MAP_PASSTHROUGH = 0xffffff;

export interface PreparedCar {
    root: THREE.Object3D;
    material: THREE.MeshLambertMaterial;
    texture: THREE.CanvasTexture | null;
}

/**
 * Car (§4.2): one double-sided Lambert with the repainted colormap on the body
 * and all four wheels; castShadow false on every mesh (blob shadow only).
 */
export function prepareCar(root: THREE.Object3D, paint: CarPaint, createCanvas?: CanvasFactory): PreparedCar {
    let srcMap: THREE.Texture | null = null;
    const sources = new Set<THREE.Material>();
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of meshMaterials(mesh)) {
            sources.add(m);
            const mapped = (m as THREE.MeshStandardMaterial).map;
            if (!srcMap && mapped) srcMap = mapped;
        }
    });
    const original = srcMap as THREE.Texture | null;
    const image = (original?.image ?? null) as CanvasImageSource | null;
    let texture: THREE.CanvasTexture | null = null;
    if (image) {
        texture = repaintCarColormap(image, paint, createCanvas);
        texture.wrapS = original!.wrapS;
        texture.wrapT = original!.wrapT;
        texture.channel = original!.channel;
    } else {
        console.warn("[world3] car.glb has no colormap image; drawing the car flat in its paint colour");
    }
    const material = new THREE.MeshLambertMaterial({
        map: texture,
        // The map carries the colour; a white multiplier keeps it exact.
        color: texture ? MAP_PASSTHROUGH : CONFIG.vehicle.paints[paint],
        side: THREE.DoubleSide,
    });
    material.name = "car-palette";
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = material;
    });
    setShadows(root, false, true);
    // The repaint copied the pixels: free the source texture, its decoded
    // ImageBitmap (GLTFLoader's default where supported) and the GLB materials.
    original?.dispose();
    (image as Partial<ImageBitmap> | null)?.close?.();
    for (const m of sources) {
        for (const t of materialTextures(m)) if (t !== original) t.dispose();
        m.dispose();
    }
    return { root, material, texture };
}

/** Palm (§2.6): Lambert + its original atlas, with the scenery occluder dither. */
export function preparePalm(root: THREE.Object3D): THREE.MeshLambertMaterial[] {
    const mats = convertStandardToLambert(root);
    for (const m of mats) applyOccluder(m);
    setShadows(root, true, true);
    return mats;
}

/** Avatar (§8.3): Lambert copies (skinning is handled by the mesh type in r186). */
export function prepareAvatar(root: THREE.Object3D): THREE.MeshLambertMaterial[] {
    const mats = convertStandardToLambert(root);
    setShadows(root, true, true);
    return mats;
}

/** Remaps a token at clone time, e.g. { foliage: "foliageDark" } for a darker tree. */
export type TokenRemap = Partial<Record<PaletteToken, PaletteToken>>;

const NATURE_TOKEN_KEY = "paletteToken";

/** The palette Lambert for a token: occluder dither always, flat for boulders. */
export function natureMaterial(materials: Materials, token: PaletteToken): THREE.MeshLambertMaterial {
    return materials.lambert(PALETTE[token], { occluder: true, flat: FLAT_TOKENS.has(token) });
}

/**
 * Nature Kit (§2.6): every sub-mesh's material becomes the shared palette
 * Lambert for its token (occluder on). Throws UnknownNatureMaterialError on an
 * unmapped source material name. Records the token on mesh.userData so clones
 * can be recoloured (`applyTokenRemap`): { foliage: "foliageDark" } for darker
 * trees, or { bush: "boulder" } to drop the mossy tuft from a rock.
 */
export function prepareNature(root: THREE.Object3D, materials: Materials, model: string): void {
    const sources = new Set<THREE.Material>();
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = meshMaterials(mesh);
        const tokens = src.map((m) => natureToken(m.name, model));
        for (const m of src) sources.add(m);
        mesh.userData[NATURE_TOKEN_KEY] = tokens[0];
        const mats = tokens.map((t) => natureMaterial(materials, t));
        mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    });
    setShadows(root, true, true);
    for (const m of sources) m.dispose();
}

/**
 * Uniformly rescales a Nature Kit model about its origin (the base of the
 * model, so it still stands on y = 0) to NATURE_NORMALIZE[kind]: height for
 * trees and bushes, max(x, z) extent for boulders. The scale is baked into the
 * geometry and the child node offsets, so the root keeps an identity transform
 * for Scenery to scale, and instancing that reads mesh geometry gets the
 * normalised size. Expects an un-parented root with an identity transform
 * (a GLTF scene). Returns the factor applied (1 for an empty model).
 */
export function normalizeNature(root: THREE.Object3D, kind: NatureKind): number {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const spec = NATURE_NORMALIZE[kind];
    const measured =
        spec.measure === "height" ? box.max.y : Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    if (!(measured > 0) || !Number.isFinite(measured)) return 1;
    const f = spec.size / measured;
    // Uniform scale commutes with each node's rotation / scale, so scaling every
    // descendant offset and every vertex position by f equals scaling the whole
    // model. Primitives of one glTF mesh share their POSITION attribute, so the
    // attributes (not the geometries) are deduplicated; normals are unchanged.
    const geometries = new Set<THREE.BufferGeometry>();
    root.traverse((o) => {
        if (o !== root) o.position.multiplyScalar(f);
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) geometries.add(mesh.geometry);
    });
    const positions = new Set<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>();
    for (const g of geometries) if (g.attributes.position) positions.add(g.attributes.position);
    const scale = new THREE.Matrix4().makeScale(f, f, f);
    for (const attr of positions) {
        attr.applyMatrix4(scale);
        attr.needsUpdate = true;
    }
    for (const g of geometries) {
        g.computeBoundingBox();
        g.computeBoundingSphere();
    }
    root.updateMatrixWorld(true);
    return f;
}

/** Swaps palette materials on a prepared Nature clone according to `remap`. */
export function applyTokenRemap(root: THREE.Object3D, materials: Materials, remap: TokenRemap): void {
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const token = mesh.userData?.[NATURE_TOKEN_KEY] as PaletteToken | undefined;
        if (!mesh.isMesh || !token) return;
        const next = remap[token];
        if (!next || Array.isArray(mesh.material)) return;
        mesh.material = natureMaterial(materials, next);
        mesh.userData[NATURE_TOKEN_KEY] = next;
    });
}

// ── Progress ─────────────────────────────────────────────────────────────
/**
 * Byte-weighted, monotonic progress over a set of downloads. Each item counts
 * with its estimated size until its response reports a real total.
 */
export class ProgressAggregator {
    private items = new Map<string, { loaded: number; total: number; done: boolean }>();
    private last = 0;

    constructor(private onProgress?: (fraction: number) => void) {}

    add(id: string, estimate: number): void {
        this.items.set(id, { loaded: 0, total: Math.max(1, estimate), done: false });
        this.emit();
    }

    update(id: string, loaded: number, total?: number): void {
        const it = this.items.get(id);
        if (!it || it.done) return;
        if (total && total > 0) it.total = total;
        it.loaded = Math.min(loaded, it.total);
        this.emit();
    }

    /** Success or failure: the item no longer holds the bar back. */
    done(id: string): void {
        const it = this.items.get(id);
        if (!it) return;
        it.done = true;
        it.loaded = it.total;
        this.emit();
    }

    get fraction(): number {
        return this.last;
    }

    private emit(): void {
        let loaded = 0;
        let total = 0;
        for (const it of this.items.values()) {
            loaded += it.loaded;
            total += it.total;
        }
        const f = total > 0 ? loaded / total : 0;
        // Progress only ever increases (§6.2), even when a real total replaces a low estimate.
        if (f > this.last) this.last = Math.min(1, f);
        this.onProgress?.(this.last);
    }
}

// ── Board textures (§5.1) ────────────────────────────────────────────────
/** "clay" → "/assets/boards/clay.webp"; anything with a "/" is already a URL. */
export function boardUrl(nameOrUrl: string): string {
    return nameOrUrl.includes("/") ? nameOrUrl : `${BOARD_DIR}${nameOrUrl}${BOARD_EXT}`;
}

export type BoardLoadedCallback = (url: string, texture: THREE.Texture) => void;

/**
 * Lazy board-image loader. Areas (or the integrator) `register` each board's
 * world position; after Start, `update(focus)` requests every registered board
 * within BOARD_LOAD_DISTANCE. `request` can also be called directly. Failures
 * degrade silently (the board keeps its placeholder colour).
 */
export class BoardTextures {
    private positions = new Map<string, { x: number; z: number }>();
    private pending = new Map<string, Promise<THREE.Texture | null>>();
    private loaded = new Map<string, THREE.Texture>();
    private listeners = new Set<BoardLoadedCallback>();
    private started = false;
    private disposed = false;

    constructor(
        private load: (url: string) => Promise<THREE.Texture>,
        private distance: number = BOARD_LOAD_DISTANCE
    ) {}

    /** Registers a board for distance-gated loading. */
    register(nameOrUrl: string, x: number, z: number): void {
        this.positions.set(boardUrl(nameOrUrl), { x, z });
    }

    /** Enables distance loading (call on Start, §5.1 "start loading after Start"). */
    start(): void {
        this.started = true;
    }

    /** Requests every registered, not-yet-requested board within range of (x, z). */
    update(focusX: number, focusZ: number): void {
        if (!this.started) return;
        const r2 = this.distance * this.distance;
        for (const [url, p] of this.positions) {
            if (this.pending.has(url)) continue;
            const dx = p.x - focusX;
            const dz = p.z - focusZ;
            if (dx * dx + dz * dz <= r2) void this.request(url);
        }
    }

    /**
     * Starts loading (idempotent). Resolves with the texture, or null on failure.
     * `onLoaded` (if given) runs once the texture is ready, even if it already is.
     */
    request(nameOrUrl: string, onLoaded?: (texture: THREE.Texture) => void): Promise<THREE.Texture | null> {
        const url = boardUrl(nameOrUrl);
        let p = this.pending.get(url);
        if (!p) {
            p = this.load(url).then(
                (tex) => {
                    // Arrived after dispose(): the loader has already freed it.
                    if (this.disposed) return null;
                    this.loaded.set(url, tex);
                    for (const cb of this.listeners) cb(url, tex);
                    return tex;
                },
                (err: unknown) => {
                    if (!this.disposed) console.warn(`[world3] board image failed: ${url}`, err);
                    return null;
                }
            );
            this.pending.set(url, p);
        }
        if (onLoaded) void p.then((tex) => tex && onLoaded(tex));
        return p;
    }

    /** The texture if already loaded, else null. */
    get(nameOrUrl: string): THREE.Texture | null {
        return this.loaded.get(boardUrl(nameOrUrl)) ?? null;
    }

    isRequested(nameOrUrl: string): boolean {
        return this.pending.has(boardUrl(nameOrUrl));
    }

    /** Fires for every board that finishes loading from now on. Returns an unsubscribe. */
    onLoaded(cb: BoardLoadedCallback): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /** Drops all state; textures are owned (and freed) by the loader, i.e. Assets. */
    dispose(): void {
        this.disposed = true;
        this.started = false;
        this.listeners.clear();
        this.positions.clear();
        this.pending.clear();
        this.loaded.clear();
    }
}

// ── The service ──────────────────────────────────────────────────────────
export interface AssetsOptions {
    materials: Materials;
    /** For the anisotropy cap; null in tests. */
    renderer?: THREE.WebGLRenderer | null;
    /** If given, Assets.dispose() is registered on it. */
    disposal?: Disposal;
    paint?: CarPaint;
    /** Load the Nature Kit (CONFIG.scenery.source === "kit"). */
    loadNature?: boolean;
    /** Optional avatar (§8.3); absent file → model("avatar") is null. */
    avatarUrl?: string | null;
}

type LoadOutcome = { ok: true; gltf: GLTF } | { ok: false; error: unknown };

/** Asset service (implements AssetsApi). */
export class Assets implements AssetsApi {
    readonly boards: BoardTextures;
    private loader = new GLTFLoader();
    private textureLoader = new THREE.TextureLoader();
    private models = new Map<ModelName, THREE.Object3D>();
    private clips = new Map<ModelName, THREE.AnimationClip[]>();
    private textures = new Map<string, Promise<THREE.Texture>>();
    private owned = new Set<{ dispose(): void }>();
    private materials: Materials;
    private renderer: THREE.WebGLRenderer | null;
    private opts: AssetsOptions;
    private disposed = false;

    constructor(opts: AssetsOptions) {
        this.opts = opts;
        this.materials = opts.materials;
        this.renderer = opts.renderer ?? null;
        this.boards = new BoardTextures((url) => this.texture(url));
        opts.disposal?.onDispose(() => this.dispose());
    }

    /**
     * Loads every model in parallel, reporting byte progress in [0, 1]
     * (monotonic). Rejects only when the required car.glb fails after one
     * retry. Optional models that fail to load or prepare (including an
     * UnknownNatureMaterialError, which `npm run test` already catches at build
     * time) are skipped, so model() returns null and Scenery falls back.
     */
    async load(onProgress?: (fraction: number) => void): Promise<void> {
        const progress = new ProgressAggregator(onProgress);
        const paint = this.opts.paint ?? CONFIG.vehicle.paint;
        const jobs: Promise<void>[] = [];

        progress.add("car", SIZE_ESTIMATE.car);
        jobs.push(
            this.fetchGLTF(MODEL_URLS.car, "car", progress, REQUIRED_RETRIES).then((r) => {
                if (!r.ok) throw new Error(`[world3] required asset failed: ${MODEL_URLS.car}`, { cause: r.error });
                const car = prepareCar(r.gltf.scene, paint);
                this.own(car.material);
                if (car.texture) this.own(car.texture);
                this.keep("car", r.gltf);
            })
        );

        progress.add("palm", SIZE_ESTIMATE.palm);
        jobs.push(
            this.fetchGLTF(MODEL_URLS.palm, "palm", progress).then((r) => {
                if (!r.ok) return this.warnOptional(MODEL_URLS.palm, r.error);
                if (this.prepareOptional(MODEL_URLS.palm, r.gltf, () => this.ownMaterials(preparePalm(r.gltf.scene)))) {
                    this.keep("palm", r.gltf);
                }
            })
        );

        const avatarUrl = this.opts.avatarUrl === undefined ? MODEL_URLS.avatar : this.opts.avatarUrl;
        if (avatarUrl) {
            progress.add("avatar", SIZE_ESTIMATE.avatar);
            jobs.push(
                this.fetchGLTF(avatarUrl, "avatar", progress).then((r) => {
                    // The avatar is optional and usually absent (§8.3): no warning.
                    if (!r.ok) return;
                    if (this.prepareOptional(avatarUrl, r.gltf, () => this.ownMaterials(prepareAvatar(r.gltf.scene)))) {
                        this.keep("avatar", r.gltf);
                    }
                })
            );
        }

        const loadNature = this.opts.loadNature ?? CONFIG.scenery.source === "kit";
        if (loadNature) {
            for (const name of NATURE_MODELS) {
                const id: ModelName = `nature/${name}`;
                const url = `${NATURE_DIR}${name}.glb`;
                progress.add(id, SIZE_ESTIMATE.nature);
                jobs.push(
                    this.fetchGLTF(url, id, progress).then((r) => {
                        if (!r.ok) return this.warnOptional(url, r.error);
                        const ok = this.prepareOptional(url, r.gltf, () => {
                            // Throws UnknownNatureMaterialError on an unmapped name.
                            prepareNature(r.gltf.scene, this.materials, name);
                            normalizeNature(r.gltf.scene, natureKind(name));
                        });
                        if (ok) this.keep(id, r.gltf);
                    })
                );
            }
        }

        // allSettled: every job finishes (and is kept or freed) before load()
        // settles, so a dispose() during loading always sees the full set.
        const results = await Promise.allSettled(jobs);
        if (this.disposed) this.dispose();
        const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (failed) throw failed.reason;
    }

    /**
     * A fresh clone (shared geometry + materials), or null if absent / failed.
     * The clone carries the model's clips on `animations` (avatar Idle / Wave).
     * Nature Kit clones are normalised (NATURE_NORMALIZE) and can be recoloured
     * with `applyTokenRemap`.
     */
    model(name: ModelName): THREE.Object3D | null {
        const base = this.models.get(name);
        if (!base) return null;
        // Skinned meshes need their skeletons re-bound to the clone's bones.
        return name === "avatar" ? cloneSkinned(base) : base.clone(true);
    }

    /** A Nature Kit clone with tokens remapped, e.g. { foliage: "foliageDark" }. */
    natureModel(name: NatureModelName, remap?: TokenRemap): THREE.Object3D | null {
        const obj = this.model(`nature/${name}`);
        if (obj && remap) applyTokenRemap(obj, this.materials, remap);
        return obj;
    }

    /** The model's animation clips (avatar Idle / Wave), empty when none. */
    animations(name: ModelName): THREE.AnimationClip[] {
        return this.clips.get(name) ?? [];
    }

    has(name: ModelName): boolean {
        return this.models.has(name);
    }

    /** sRGB, mipmapped, anisotropy min(8, max). Cached per URL; rejects on failure (retry allowed). */
    texture(url: string): Promise<THREE.Texture> {
        let p = this.textures.get(url);
        if (p) return p;
        p = this.textureLoader.loadAsync(url).then((tex) => {
            // Resolved after dispose(): free it now instead of caching a leak.
            if (this.disposed) {
                tex.dispose();
                throw new Error(`[world3] texture arrived after dispose: ${url}`);
            }
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = this.anisotropy();
            tex.name = url;
            tex.needsUpdate = true;
            this.own(tex);
            return tex;
        });
        p.catch(() => this.textures.delete(url));
        this.textures.set(url, p);
        return p;
    }

    dispose(): void {
        this.disposed = true;
        this.boards.dispose();
        for (const root of this.models.values()) {
            root.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (mesh.isMesh) mesh.geometry.dispose();
            });
        }
        this.models.clear();
        this.clips.clear();
        for (const item of this.owned) item.dispose();
        this.owned.clear();
        // Requests still in flight dispose their texture on arrival (see texture()).
        this.textures.clear();
    }

    // ── internals ────────────────────────────────────────────────────────
    private anisotropy(): number {
        const max = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
        return Math.max(1, Math.min(MAX_ANISOTROPY, max));
    }

    private own<T extends { dispose(): void }>(item: T): T {
        this.owned.add(item);
        return item;
    }

    /** Owns converted materials and the textures they kept (e.g. the palm atlas). */
    private ownMaterials(mats: readonly THREE.Material[]): void {
        for (const m of mats) {
            this.own(m);
            for (const t of materialTextures(m)) this.own(t);
        }
    }

    private keep(name: ModelName, gltf: GLTF): void {
        this.models.set(name, gltf.scene);
        // Object3D.clone copies `animations`, so model() clones carry the clips.
        gltf.scene.animations = gltf.animations;
        if (gltf.animations.length) this.clips.set(name, gltf.animations);
    }

    private warnOptional(url: string, error: unknown): void {
        console.warn(`[world3] optional asset unavailable: ${url}`, error);
    }

    /**
     * Runs an optional model's preparation. On a throw it logs console.error,
     * frees the GLB's GPU-side resources and returns false (the model is not
     * kept, so model() returns null). Palette materials from Materials are
     * shared and never freed here.
     */
    private prepareOptional(url: string, gltf: GLTF, prepare: () => void): boolean {
        try {
            prepare();
            return true;
        } catch (err) {
            console.error(`[world3] optional asset skipped: ${url}`, err);
            const textures = new Set<THREE.Texture>();
            gltf.scene.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (!mesh.isMesh) return;
                mesh.geometry.dispose();
                for (const m of meshMaterials(mesh)) {
                    if (!isStandard(m)) continue;
                    for (const t of materialTextures(m)) textures.add(t);
                    m.dispose();
                }
            });
            for (const t of textures) t.dispose();
            return false;
        }
    }

    /** GLTFLoader with byte progress; retries `retries` times before reporting failure. */
    private async fetchGLTF(url: string, id: string, progress: ProgressAggregator, retries = 0): Promise<LoadOutcome> {
        let lastError: unknown = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const gltf = await new Promise<GLTF>((resolve, reject) =>
                    this.loader.load(
                        url,
                        resolve,
                        (e) => progress.update(id, e.loaded, e.lengthComputable ? e.total : undefined),
                        reject
                    )
                );
                progress.done(id);
                return { ok: true, gltf };
            } catch (err) {
                lastError = err;
            }
        }
        progress.done(id);
        return { ok: false, error: lastError };
    }
}
