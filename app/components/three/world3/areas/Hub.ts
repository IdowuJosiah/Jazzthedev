import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { buildOwnedPathLabels } from "../Paths";
import { createSceneryTree } from "../Scenery";
import type { AreaContext, AreaHandle, TextHandle } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Hub / Crossroads (§2.4). From Layout (AREA_LAYOUT.hub, the hub AreaDef):
//
// - Planter: paper RoundedBox(6, 1, 6, 3, 0.3) at the hub centre with ONE
//   fixed cuboid collider; casts and receives shadows (§1.5 static props).
// - One tree standing on the planter, from Scenery's createSceneryTree (§2.6):
//   a Nature Kit tree (already normalised to 4.9 high, palette Lambert with the
//   occluder dither), or Scenery's procedural round tree when the source is
//   "procedural" or no kit tree is loaded. One definition of the tree, shared
//   with the scattered scenery.
// - Plaza plate (plaza layer) over the rect.
// - The four spoke labels, 6 outside the hub edge (Paths.ts ownership):
//   P1 START, P2 PROJECTS, P3 PLAYGROUND, P4 JOURNEY · EKO · MUSIC.
// ─────────────────────────────────────────────────────────────────────────

export interface HubHandle extends AreaHandle {
    planter: THREE.Mesh;
    /** The tree root (kit clone or procedural group), standing on the planter top. */
    tree: THREE.Object3D;
    /** "kit" or "procedural": which source the tree came from. */
    treeSource: "kit" | "procedural";
    collider: RAPIER.RigidBody;
    pathLabels: TextHandle[];
}

export function build(ctx: AreaContext): HubHandle {
    const { group, materials, shapes } = ctx;
    const H = ctx.layout.AREA_LAYOUT.hub;
    const geometries: THREE.BufferGeometry[] = [];
    const pathLabels: TextHandle[] = [];
    let collider: RAPIER.RigidBody | null = null;

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    const release = () => {
        if (collider) ctx.physics.removeBody(collider);
        collider = null;
        for (const h of pathLabels) h.dispose();
        for (const g of geometries) g.dispose();
        group.clear();
    };

    try {
        // ── Plaza plate over the rect ────────────────────────────────────
        const rect = ctx.def.rect;
        const plazaGeo = shapes.flatPlate(rect.w, rect.d, H.plazaRadius, "plaza");
        geometries.push(plazaGeo);
        const plaza = new THREE.Mesh(plazaGeo, materials.lambert(PALETTE.plaza, { layer: "plaza" }));
        plaza.name = "hub-plaza";
        plaza.position.set(rect.x, 0, rect.z);
        shapes.applyLayerToObject(plaza, "plaza");
        plaza.raycast = () => {};
        group.add(plaza);

        // ── Planter (its collider is added last, see below) ──────────────
        const pl = H.planter;
        const planterGeo = new RoundedBoxGeometry(pl.w, pl.h, pl.d, pl.segments, pl.radius);
        geometries.push(planterGeo);
        const planter = new THREE.Mesh(planterGeo, materials.lambert(PALETTE.paper));
        planter.name = "hub-planter";
        planter.position.set(pl.x, pl.h / 2, pl.z);
        planter.castShadow = true;
        planter.receiveShadow = true;
        planter.raycast = () => {};
        group.add(planter);

        // ── Tree on the planter (Scenery's source, procedural fallback) ──
        // A kit clone shares the kit's geometry + palette materials (never
        // disposed here); a procedural tree pushes its geometries to ours.
        const before = geometries.length;
        const tree = createSceneryTree(materials, ctx.assets, geometries);
        const treeSource: "kit" | "procedural" = geometries.length > before ? "procedural" : "kit";
        tree.name = "hub-tree";
        tree.position.set(pl.x, pl.h, pl.z);
        tree.traverse((o) => {
            if (!(o as THREE.Mesh).isMesh) return;
            o.castShadow = true; // §1.5 static props cast and receive
            o.receiveShadow = true;
            o.raycast = () => {};
        });
        group.add(tree);

        // ── The four spoke labels ────────────────────────────────────────
        for (const h of buildOwnedPathLabels(ctx.text, ctx.def.id)) {
            pathLabels.push(h);
            group.add(h.object);
        }

        // ── ONE fixed cuboid collider, last: nothing after it can throw ──
        const body = ctx.physics.addFixedCuboid(
            { x: pl.w / 2, y: pl.h / 2, z: pl.d / 2 },
            { x: pl.x, y: pl.h / 2, z: pl.z }
        );
        collider = body;

        let disposed = false;
        return {
            group,
            planter,
            tree,
            treeSource,
            collider: body,
            pathLabels,
            dispose() {
                if (disposed) return;
                disposed = true;
                release();
            },
        };
    } catch (err) {
        release();
        throw err;
    }
}

registerArea("hub", build);
