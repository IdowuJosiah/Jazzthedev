import * as THREE from "three";
import { CONFIG, PALETTE } from "./Config";
import {
    AREAS,
    PATHS,
    TILE,
    pathLabelPlacement,
    pathLength,
    pathTiles,
    pointOnRectEdge,
    type PathLabelPlacement,
} from "./Layout";
import { applyLayerToObject, roundedSlab } from "./utils/shapes";
import type { AreaId, MaterialsApi, PathDef, PathLabel, TextApi, TextHandle } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Paths (§2.5): Bruno-style stepping stones, no colliders.
//
// - Tiles: ONE InstancedMesh of roundedSlab(1.6, 1.6, 0.08, r 0.4) in `path`
//   for every path, solid from y 0 to 0.08, receiveShadow only. Placement is
//   Layout.pathTiles() (seeded zigzag + jitter, clamped, never overlapping).
//   The slab is unbevelled (TILE_SLAB): the one mesh spans the world and is
//   never frustum-culled, so its triangles always count against §9.2.
// - Labels: Inter Bold 1.0, letterSpacing 0.12, ink, flat on the ground-text
//   layer, BESIDE the path at Layout.pathLabelPlacement() (outer tile edge +
//   0.9 on the camera side, baseline along the tangent). Never on a tile.
//
// Label ownership (§2.4, §2.7): a label belongs to the area whose rect edge
// holds the path endpoint nearest to it — Welcome owns CROSSROADS and ABOUT &
// CONTACT, the hub its four spoke labels. Owned labels are built by their area
// (so they cull with it); P5/P6 (which leave the trail, not a rect edge) have
// no owner. `build()` draws every tile plus every label whose owner is not in
// `skipOwners`; the integrator passes `areas.builtIds`, so nothing is drawn
// twice and a failed area's labels still appear.
// ─────────────────────────────────────────────────────────────────────────

export interface PathsDeps {
    materials: MaterialsApi;
    text: TextApi;
}

export interface PathsOptions {
    /** Areas that draw their own labels (normally `areas.builtIds`). Default: none. */
    skipOwners?: readonly AreaId[];
    /** Paths to build (default: every path in Layout.PATHS). */
    paths?: readonly PathDef[];
}

export interface PathsHandle {
    group: THREE.Group;
    /** Every tile of every path, one draw call. */
    tiles: THREE.InstancedMesh;
    labels: TextHandle[];
    dispose(): void;
}

/** The area that owns a path label (draws and culls it), or null (Paths draws it). */
export function labelOwner(p: PathDef, label: PathLabel): AreaId | null {
    const end = label.d <= pathLength(p) / 2 ? p.from : p.to;
    for (const a of AREAS) if (pointOnRectEdge(a.rect, end.x, end.z)) return a.id;
    return null;
}

/** Label placements whose owner is `owner` (null = unowned labels). */
export function labelsOwnedBy(owner: AreaId | null, paths: readonly PathDef[] = PATHS): PathLabelPlacement[] {
    return paths.flatMap((p) =>
        p.labels.filter((l) => labelOwner(p, l) === owner).map((l) => pathLabelPlacement(p, l))
    );
}

/** One flat path label (§3.3 path label style) at its Layout placement. */
export function buildPathLabel(text: TextApi, placement: PathLabelPlacement): TextHandle {
    const T = CONFIG.type.pathLabel;
    const handle = text.onPath({
        text: placement.text,
        font: T.font,
        size: T.size,
        letterSpacing: T.letterSpacing,
        color: PALETTE.ink,
        anchorX: "center",
        anchorY: "middle",
        angle: placement.angle,
    });
    // Flat text already sits at its layer height on the inner mesh (DECISIONS.md).
    handle.object.position.set(placement.x, 0, placement.z);
    return handle;
}

/**
 * Builds every label `owner` is responsible for (Welcome / Hub call this).
 * All or nothing: if one label throws, the ones already built are disposed.
 */
export function buildOwnedPathLabels(text: TextApi, owner: AreaId): TextHandle[] {
    const built: TextHandle[] = [];
    try {
        for (const p of labelsOwnedBy(owner)) built.push(buildPathLabel(text, p));
    } catch (err) {
        for (const h of built) h.dispose();
        throw err;
    }
    return built;
}

/**
 * Tile slab tessellation (stream-local). A 0.02 bevel on a 0.08 slab is
 * invisible at the follow camera but triples the triangles (236 → 76 per tile;
 * ~100k → ~32k for every tile, all always in the frustum). Four segments per
 * corner keep the r 0.4 corners round.
 */
export const TILE_SLAB = { bevel: 0, curveSegments: 4 } as const;

/** The shared tile slab: 1.6 × 1.6, y 0 → 0.08, corner radius 0.4, unbevelled. */
export function tileGeometry(): THREE.BufferGeometry {
    return roundedSlab(TILE.size, TILE.size, TILE.height, TILE.radius, TILE_SLAB);
}

/** One InstancedMesh holding every tile of `paths` (geometry owned by the mesh). */
export function buildTiles(materials: MaterialsApi, paths: readonly PathDef[] = PATHS): THREE.InstancedMesh {
    const placements = paths.flatMap((p) => pathTiles(p));
    const capacity = Math.max(1, placements.length);
    const mesh = new THREE.InstancedMesh(tileGeometry(), materials.lambert(PALETTE.path), capacity);
    mesh.name = "path-tiles";
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    placements.forEach((t, i) => {
        q.setFromAxisAngle(up, t.yaw);
        pos.set(t.x, CONFIG.text.layers.tileBottom, t.z);
        mesh.setMatrixAt(i, m.compose(pos, q, one));
    });
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    // Tiles only receive shadows (§1.5); their layer is solid, no polygonOffset.
    applyLayerToObject(mesh, "tile");
    mesh.raycast = () => {};
    return mesh;
}

/** Builds the stepping-stone tiles of every path plus the labels no built area owns. */
export function build(deps: PathsDeps, opts: PathsOptions = {}): PathsHandle {
    const paths = opts.paths ?? PATHS;
    const skip = new Set<AreaId>(opts.skipOwners ?? []);
    const group = new THREE.Group();
    group.name = "paths";

    const tiles = buildTiles(deps.materials, paths);
    group.add(tiles);

    const labels: TextHandle[] = [];
    const release = () => {
        // The material is shared (MaterialsApi owns it); the slab is ours.
        tiles.geometry.dispose();
        tiles.dispose();
        for (const h of labels) h.dispose();
        group.removeFromParent();
    };
    try {
        for (const p of paths) {
            for (const l of p.labels) {
                const owner = labelOwner(p, l);
                if (owner && skip.has(owner)) continue;
                const h = buildPathLabel(deps.text, pathLabelPlacement(p, l));
                labels.push(h);
                group.add(h.object);
            }
        }
    } catch (err) {
        release(); // a failed label leaks neither the tiles nor the labels before it
        throw err;
    }

    let disposed = false;
    return {
        group,
        tiles,
        labels,
        dispose() {
            if (disposed) return;
            disposed = true;
            release();
        },
    };
}
