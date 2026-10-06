import * as THREE from "three";
import { CONFIG } from "../Config";

// Rounded flat shapes (§1.3) and the flat-layer table (§2.5).
// r186's RoundedBoxGeometry clamps its radius to half the shortest side, so thin
// objects that need rounded corners seen from above / the front use these.

export type FlatLayerId = "plaza" | "plate" | "padOnPlate" | "groundText" | "tile" | "blob" | "tileText";

export interface FlatLayer {
    /** Height of the layer's surface (tiles: their top). */
    readonly y: number;
    readonly polygonOffset: boolean;
    readonly polygonOffsetFactor: number;
    readonly polygonOffsetUnits: number;
    readonly depthWrite: boolean;
    readonly renderOrder: number;
    readonly receiveShadow: boolean;
}

const L = CONFIG.text.layers;

const layer = (
    y: number,
    factor: number,
    units: number,
    extra: Partial<Pick<FlatLayer, "depthWrite" | "renderOrder" | "receiveShadow">> = {}
): FlatLayer =>
    Object.freeze({
        y,
        polygonOffset: factor !== 0 || units !== 0,
        polygonOffsetFactor: factor,
        polygonOffsetUnits: units,
        depthWrite: extra.depthWrite ?? true,
        renderOrder: extra.renderOrder ?? 0,
        receiveShadow: extra.receiveShadow ?? true,
    });

/** Flat layers, bottom to top (§2.5). Layered to avoid z-fighting. */
export const LAYERS: Readonly<Record<FlatLayerId, FlatLayer>> = Object.freeze({
    /** Area plaza plates. */
    plaza: layer(L.plaza, -1, -1),
    /** Plates, pads, lane strip. */
    plate: layer(L.plate, -2, -2),
    /**
     * Pad outline / fill drawn ON a plate that is also the pad (milestone, skill,
     * contact plates): just above the plate so the two never share a plane.
     */
    padOnPlate: layer(L.padOnPlate, -3, -3, { depthWrite: false, renderOrder: 1 }),
    /** Text on ground, plaza or plates. */
    groundText: layer(L.groundText, -4, -4, { depthWrite: false, renderOrder: 2, receiveShadow: false }),
    /** Path tiles: solid from tileBottom to tileTop (y is the top). */
    tile: layer(L.tileTop, 0, 0),
    /** Blob shadows. */
    blob: layer(L.onTile, -1, -4, { depthWrite: false, renderOrder: 1, receiveShadow: false }),
    /** Text on tiles (`NOW`). */
    tileText: layer(L.onTile, -4, -4, { depthWrite: false, renderOrder: 2, receiveShadow: false }),
});

/** Copies a layer's polygonOffset / depthWrite onto a material. */
export function applyLayerToMaterial(material: THREE.Material, id: FlatLayerId): THREE.Material {
    const l = LAYERS[id];
    material.polygonOffset = l.polygonOffset;
    material.polygonOffsetFactor = l.polygonOffsetFactor;
    material.polygonOffsetUnits = l.polygonOffsetUnits;
    material.depthWrite = l.depthWrite;
    return material;
}

/**
 * Copies a layer's renderOrder / shadow flags onto an object. It does NOT touch
 * position: the layer height has ONE source of truth — `flatPlate` / `flatRing`
 * bake LAYERS[id].y into their geometry. Objects whose geometry sits at y = 0
 * (e.g. text) set `position.y = LAYERS[id].y` themselves.
 */
export function applyLayerToObject(obj: THREE.Object3D, id: FlatLayerId): THREE.Object3D {
    const l = LAYERS[id];
    obj.renderOrder = l.renderOrder;
    obj.receiveShadow = l.receiveShadow;
    obj.castShadow = false;
    return obj;
}

/** Rounded rectangle centred on the origin in the XY plane (w along X, h along Y). */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    const x0 = -w / 2;
    const y0 = -h / 2;
    const x1 = w / 2;
    const y1 = h / 2;
    const s = new THREE.Shape();
    s.moveTo(x0 + rr, y0);
    s.lineTo(x1 - rr, y0);
    if (rr > 0) s.quadraticCurveTo(x1, y0, x1, y0 + rr);
    s.lineTo(x1, y1 - rr);
    if (rr > 0) s.quadraticCurveTo(x1, y1, x1 - rr, y1);
    s.lineTo(x0 + rr, y1);
    if (rr > 0) s.quadraticCurveTo(x0, y1, x0, y1 - rr);
    s.lineTo(x0, y0 + rr);
    if (rr > 0) s.quadraticCurveTo(x0, y0, x0 + rr, y0);
    return s;
}

/** Rounded-rect ring (outline) of the given line width; outer size w × h. */
export function roundedRectRingShape(w: number, h: number, r: number, lineWidth: number): THREE.Shape {
    const outer = roundedRectShape(w, h, r);
    const inner = roundedRectShape(
        Math.max(0.001, w - 2 * lineWidth),
        Math.max(0.001, h - 2 * lineWidth),
        Math.max(0, r - lineWidth)
    );
    // Holes must wind opposite to the outer contour.
    const pts = inner.getPoints().reverse();
    outer.holes.push(new THREE.Path(pts));
    return outer;
}

export interface RoundedSlabOptions {
    /** Bevel radius; default min(0.04, h / 4). */
    bevel?: number;
    curveSegments?: number;
}

/**
 * An extruded rounded-rect slab lying flat: exactly w (X) × d (Z) × h (Y), from
 * y = 0 to y = h, centred in X/Z. Used for path tiles, plates, the phone body
 * (rotated upright by the caller).
 */
export function roundedSlab(
    w: number,
    d: number,
    h: number,
    r: number,
    { bevel = Math.min(0.04, h / 4), curveSegments = 4 }: RoundedSlabOptions = {}
): THREE.BufferGeometry {
    const b = Math.max(0, Math.min(bevel, h / 2 - 1e-4, w / 2 - 1e-4, d / 2 - 1e-4));
    const shape = roundedRectShape(w - 2 * b, d - 2 * b, Math.max(0, r - b));
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(1e-4, h - 2 * b),
        bevelEnabled: b > 0,
        bevelThickness: b,
        bevelSize: b,
        bevelOffset: 0,
        bevelSegments: 2,
        curveSegments,
    });
    // Shape XY → ground XZ (shape +Y → −Z), extrude +Z → +Y; then lift to y ∈ [0, h].
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, b, 0);
    geo.computeVertexNormals();
    return geo;
}

/**
 * A flush flat plate (single-sided, facing +Y) w (X) × d (Z) with corner radius r.
 * The layer's height is baked into the geometry (y = LAYERS[layerId].y), so the
 * mesh stays at position.y = 0. Pair with a material from `applyLayerToMaterial`
 * (or MaterialsApi `{ layer }`) and `applyLayerToObject` (renderOrder + shadow flags).
 */
export function flatPlate(w: number, d: number, r: number, layerId: FlatLayerId = "plate"): THREE.BufferGeometry {
    const geo = new THREE.ShapeGeometry(roundedRectShape(w, d, r), CONFIG.pad.curveSegments);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, LAYERS[layerId].y, 0);
    return geo;
}

/** A flat rounded-rect outline (ring); the layer height is baked in like `flatPlate`. Used by pads. */
export function flatRing(
    w: number,
    d: number,
    r: number,
    lineWidth: number,
    layerId: FlatLayerId = "plate"
): THREE.BufferGeometry {
    const geo = new THREE.ShapeGeometry(roundedRectRingShape(w, d, r, lineWidth), CONFIG.pad.curveSegments);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, LAYERS[layerId].y, 0);
    return geo;
}
