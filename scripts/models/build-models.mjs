// Builds the in-world prop models from the raw Tripo exports in
// assets-src/tripo/<slug>.glb (not committed: ~23 MB) into
// public/assets/models/tripo/<slug>.glb. Paths resolve from the script's own
// location, so it runs from any directory:
//
//     node scripts/models/build-models.mjs [slug ...]
//
// Each job welds and simplifies the mesh to a triangle budget, resizes its
// textures to WebP, and writes a meshopt-compressed GLB (the loader needs
// MeshoptDecoder). A missing source is skipped with a warning, so the script
// can rebuild any subset. The truck is special: its export is one mesh with
// the wheels attached, so it is split into a `body` and one reusable `wheel`
// (see splitTruck); the wheel centres and radius ride along in the scene extras.

import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, meshopt, prune, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

/** Repo root: two levels up from scripts/models/. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC_DIR = join(ROOT, "assets-src/tripo");
const OUT_DIR = join(ROOT, "public/assets/models/tripo");

const KB = 1024;
const WEBP_QUALITY = 82;
/**
 * Simplification error bound, as a fraction of the mesh extent. "Permissive"
 * lets edges collapse across the many UV seams of generated meshes.
 */
const SIMPLIFY = { error: 0.03, flags: ["Permissive"] };
/** Foliage is a soup of thin leaves: a looser bound, and stray bits are pruned. */
const FOLIAGE = { error: 0.12, flags: ["Permissive", "Prune"] };

/**
 * slug → budget. `tris`: triangle target; `tex`: texture edge in px;
 * `maps`: which PBR maps survive ("all" = base + metal/rough + normal,
 * "base+normal", or "base"); `budget`: max output size; `simplify`: the
 * simplifier settings (default SIMPLIFY).
 */
const JOBS = {
    truck: { tris: 22000, wheelTris: 1600, tex: 1024, maps: "all", budget: 900 * KB },
    "street-lamp": { tris: 2600, tex: 512, maps: "all", budget: 220 * KB },
    "palm-tree": { tris: 3200, tex: 1024, maps: "base+normal", budget: 420 * KB, simplify: FOLIAGE },
    "tree-broadleaf": { tris: 3600, tex: 1024, maps: "base+normal", budget: 420 * KB, simplify: FOLIAGE },
    bush: { tris: 900, tex: 512, maps: "base+normal", budget: 160 * KB, simplify: FOLIAGE },
    boulder: { tris: 700, tex: 512, maps: "base+normal", budget: 160 * KB },
    "speaker-stack": { tris: 2400, tex: 1024, maps: "all", budget: 380 * KB },
    turntable: { tris: 6000, tex: 1024, maps: "all", budget: 420 * KB },
    bench: { tris: 2400, tex: 512, maps: "all", budget: 220 * KB },
    "bowling-pin": { tris: 1200, tex: 256, maps: "all", budget: 90 * KB },
    canoe: { tris: 3600, tex: 1024, maps: "base+normal", budget: 380 * KB },
};

const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const triangles = (doc) =>
    doc
        .getRoot()
        .listMeshes()
        .flatMap((m) => m.listPrimitives())
        .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);

/** Drops the maps a job does not keep; the factors then stand in for them. */
function trimMaps(doc, maps) {
    for (const m of doc.getRoot().listMaterials()) {
        if (maps !== "all") {
            m.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.9);
            m.setOcclusionTexture(null);
        }
        if (maps === "base") m.setNormalTexture(null);
    }
}

// ── Truck: one mesh → body + one wheel ───────────────────────────────────
/** Clearance added around a wheel when cutting it out of the body (model units). */
const WHEEL_CUT = { radius: 1.04, inner: 0.01, outer: 0.012 };

/** Connected components of a primitive after welding by position. */
function components(pos, idx) {
    const n = pos.length / 3;
    const first = new Map();
    const weldOf = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
        if (!first.has(k)) first.set(k, i);
        weldOf[i] = first.get(k);
    }
    const parent = new Uint32Array(n).map((_, i) => i);
    const find = (a) => {
        while (parent[a] !== a) a = parent[a] = parent[parent[a]];
        return a;
    };
    for (let t = 0; t < idx.length; t += 3) {
        const a = find(weldOf[idx[t]]);
        parent[find(weldOf[idx[t + 1]])] = a;
        parent[find(weldOf[idx[t + 2]])] = a;
    }
    const comps = new Map();
    for (let t = 0; t < idx.length; t += 3) {
        const root = find(weldOf[idx[t]]);
        let c = comps.get(root);
        if (!c) comps.set(root, (c = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
        c.tris.push(t / 3);
        for (let k = 0; k < 3; k++) {
            for (let a = 0; a < 3; a++) {
                const v = pos[idx[t + k] * 3 + a];
                if (v < c.min[a]) c.min[a] = v;
                if (v > c.max[a]) c.max[a] = v;
            }
        }
    }
    return [...comps.values()].sort((a, b) => b.tris.length - a.tris.length);
}

/** A new primitive holding only `tris` of `prim` (compacted), moved by −`offset`. */
function subPrimitive(doc, prim, tris, offset = [0, 0, 0]) {
    const buffer = doc.getRoot().listBuffers()[0];
    const idx = prim.getIndices().getArray();
    const remap = new Map();
    const order = [];
    const outIdx = new Uint32Array(tris.length * 3);
    tris.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
            const v = idx[t * 3 + k];
            let nv = remap.get(v);
            if (nv === undefined) {
                nv = order.length;
                remap.set(v, nv);
                order.push(v);
            }
            outIdx[i * 3 + k] = nv;
        }
    });
    const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
    for (const semantic of prim.listSemantics()) {
        const src = prim.getAttribute(semantic);
        const size = src.getElementSize();
        const srcArr = src.getArray();
        const arr = new srcArr.constructor(order.length * size);
        order.forEach((v, i) => {
            for (let c = 0; c < size; c++) arr[i * size + c] = srcArr[v * size + c] - (semantic === "POSITION" ? offset[c] : 0);
        });
        out.setAttribute(
            semantic,
            doc.createAccessor().setType(src.getType()).setNormalized(src.getNormalized()).setArray(arr).setBuffer(buffer)
        );
    }
    out.setIndices(doc.createAccessor().setType("SCALAR").setArray(outIdx).setBuffer(buffer));
    return out;
}

/**
 * The export faces +Z with its wheels at y 0. Its two rear wheels are separate
 * shells; the front ones are fused into the body. Keeps the body without any
 * wheel (the fused front ones are cut out as cylinders mirrored from the rear
 * pair) and one rear wheel, centred on its own axle, as a reusable `wheel`.
 * Scene extras: `wheelRadius` and `wheelCentres` (FL, FR, RL, RR; +X is left).
 */
function splitTruck(doc) {
    const root = doc.getRoot();
    const scene = root.listScenes()[0];
    const mesh = root.listMeshes()[0];
    const prim = mesh.listPrimitives()[0];
    const pos = prim.getAttribute("POSITION").getArray();
    const idx = prim.getIndices().getArray();
    const comps = components(pos, idx);
    const body = comps[0];
    const bodyHeight = body.max[1] - body.min[1];
    const wheels = comps.slice(1).filter((c) => c.max[1] - c.min[1] < bodyHeight * 0.6 && c.tris.length > 1000);
    if (wheels.length !== 2) throw new Error(`truck: expected 2 separate wheel shells, found ${wheels.length}`);
    const left = wheels.find((w) => w.min[0] > 0);
    if (!left) throw new Error("truck: no wheel shell on +X");

    const centre = left.min.map((v, a) => (v + left.max[a]) / 2);
    const radius = (left.max[1] - left.min[1]) / 2;
    const rearZ = centre[2];
    const frontZ = -rearZ;
    const centres = [
        [centre[0], centre[1], frontZ],
        [-centre[0], centre[1], frontZ],
        [centre[0], centre[1], rearZ],
        [-centre[0], centre[1], rearZ],
    ];

    // Body triangles that lie wholly inside a front-wheel cylinder go.
    const r2 = (radius * WHEEL_CUT.radius) ** 2;
    const x0 = left.min[0] - WHEEL_CUT.inner;
    const x1 = left.max[0] + WHEEL_CUT.outer;
    const inFrontWheel = (v) => {
        const ax = Math.abs(pos[v * 3]);
        const dy = pos[v * 3 + 1] - centre[1];
        const dz = pos[v * 3 + 2] - frontZ;
        return ax >= x0 && ax <= x1 && dy * dy + dz * dz <= r2;
    };
    const bodyTris = body.tris.filter((t) => !(inFrontWheel(idx[t * 3]) && inFrontWheel(idx[t * 3 + 1]) && inFrontWheel(idx[t * 3 + 2])));

    const bodyMesh = doc.createMesh("body").addPrimitive(subPrimitive(doc, prim, bodyTris));
    const wheelMesh = doc.createMesh("wheel").addPrimitive(subPrimitive(doc, prim, left.tris, centre));
    for (const node of scene.listChildren()) node.dispose();
    mesh.dispose();
    scene.addChild(doc.createNode("body").setMesh(bodyMesh));
    scene.addChild(doc.createNode("wheel").setMesh(wheelMesh));
    scene.setExtras({ wheelRadius: radius, wheelCentres: centres });
    return { cut: body.tris.length - bodyTris.length, radius, centres };
}

/** Simplifies every primitive of a mesh to a triangle target (never upward). */
function simplifyMesh(mesh, target, { error, flags } = SIMPLIFY) {
    for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const idx = new Uint32Array(indices.getArray());
        if (idx.length <= target * 3) continue;
        const pos = prim.getAttribute("POSITION").getArray();
        const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(target) * 3, error, flags);
        indices.setArray(out);
        compactPrimitive(prim);
    }
}

async function build(slug, job) {
    const src = join(SRC_DIR, `${slug}.glb`);
    if (!existsSync(src)) {
        console.warn(`skip  ${slug}: no source at ${src}`);
        return { slug, skipped: true };
    }
    const doc = await io.read(src);
    const before = triangles(doc);
    let note = "";
    await doc.transform(dedup(), weld());
    if (slug === "truck") {
        const t = splitTruck(doc);
        note = `  cut ${t.cut} front-wheel tris, wheel r ${t.radius.toFixed(3)}`;
        const [bodyMesh, wheelMesh] = ["body", "wheel"].map((name) => doc.getRoot().listMeshes().find((m) => m.getName() === name));
        simplifyMesh(bodyMesh, job.tris, job.simplify);
        simplifyMesh(wheelMesh, job.wheelTris, job.simplify);
    } else {
        simplifyMesh(doc.getRoot().listMeshes()[0], job.tris, job.simplify);
    }
    trimMaps(doc, job.maps);
    await doc.transform(
        prune(),
        textureCompress({ encoder: sharp, targetFormat: "webp", resize: [job.tex, job.tex], quality: WEBP_QUALITY }),
        meshopt({ encoder: MeshoptEncoder, level: "medium" })
    );
    const out = join(OUT_DIR, `${slug}.glb`);
    await io.write(out, doc);
    const size = (await stat(out)).size;
    const over = size > job.budget;
    console.log(
        `${over ? "OVER " : "wrote"} ${`${slug}.glb`.padEnd(20)} ${String(Math.round(before)).padStart(6)} → ${String(Math.round(triangles(doc))).padStart(5)} tris  ${job.tex}px ${job.maps.padEnd(11)} ${(size / KB).toFixed(0).padStart(4)} KB${note}`
    );
    return { slug, size, over };
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
await mkdir(OUT_DIR, { recursive: true });
const wanted = process.argv.slice(2);
const slugs = wanted.length ? wanted : Object.keys(JOBS);
const results = [];
for (const slug of slugs) {
    if (!JOBS[slug]) throw new Error(`unknown model "${slug}" (known: ${Object.keys(JOBS).join(", ")})`);
    results.push(await build(slug, JOBS[slug]));
}
const built = results.filter((r) => !r.skipped);
const total = built.reduce((n, r) => n + r.size, 0);
console.log(`\n${built.length} built, ${(total / KB).toFixed(0)} KB total${results.some((r) => r.skipped) ? "; some sources missing" : ""}`);
if (built.some((r) => r.over)) {
    console.error("A model is over its size budget.");
    process.exitCode = 1;
}
