import { it } from "vitest";
import { CONFIG } from "./Config";
import {
    AREA_BY_ID,
    GROUND_TEXTS,
    PADS,
    PATHS,
    PROPS,
    RAMP_CORRIDOR,
    footprintCorners,
    padFootprint,
    pathHalfWidth,
    pointInRect,
    sunStrip,
    convexPolygonsOverlap,
} from "./Layout";
import { distToSegment2D } from "./utils/math";
import type { AreaId } from "./types";

const R = 0.5;
const disc = (x: number, z: number, r: number) => footprintCorners({ x, z, hu: r, hv: r, rot: 0 });

function ok(id: AreaId, x: number, z: number): string | null {
    const a = AREA_BY_ID[id];
    const r = a.rect;
    if (!pointInRect({ x: r.x, z: r.z, w: r.w - 2, d: r.d - 2 }, x, z)) return "rect";
    for (const p of PADS) if (convexPolygonsOverlap(disc(x, z, R + 1), footprintCorners(padFootprint(p.pad)))) return "pad " + p.id;
    for (const g of GROUND_TEXTS) {
        if (convexPolygonsOverlap(disc(x, z, R + 1), footprintCorners(g.footprint))) return "text " + g.id;
        if (convexPolygonsOverlap(disc(x, z, R), sunStrip(g.footprint))) return "strip " + g.id;
    }
    for (const p of PROPS) if (convexPolygonsOverlap(disc(x, z, R + 1.5), footprintCorners(p.footprint))) return "prop " + p.id;
    for (const p of PATHS) if (distToSegment2D(x, z, p.from.x, p.from.z, p.to.x, p.to.z) < pathHalfWidth(p) + 1.5) return "path " + p.id;
    if (pointInRect(RAMP_CORRIDOR, x, z)) return "ramp";
    if (Math.hypot(a.arrival.x - x, a.arrival.z - z) < 4) return "arrival";
    const Sx = Math.SQRT1_2, Sz = Math.SQRT1_2, Rx = Math.SQRT1_2, Rz = -Math.SQRT1_2;
    for (const f of [...GROUND_TEXTS.map((g) => g.footprint), ...PROPS.map((p) => p.footprint)]) {
        const cs = footprintCorners(f);
        const rs = cs.map((c) => (c.x - x) * Rx + (c.z - z) * Rz);
        const ss = cs.map((c) => (c.x - x) * Sx + (c.z - z) * Sz);
        if (Math.min(...rs) < 1 && Math.max(...rs) > -1 && Math.max(...ss) > -6 && Math.min(...ss) < 0) return "hides";
    }
    return null;
}

it("explore", () => {
    const ids: AreaId[] = ["hub", "welcome", "projects", "journey", "eko", "music", "about", "playground", "credits"];
    for (const id of ids) {
        const a = AREA_BY_ID[id];
        const out: string[] = [];
        for (let dx = -10; dx <= 10; dx += 1) {
            for (let dz = -10; dz <= 10; dz += 1) {
                const x = a.arrival.x + dx;
                const z = a.arrival.z + dz;
                if (ok(id, x, z) === null && Math.hypot(dx, dz) <= 8) out.push(`(${dx},${dz})`);
            }
        }
        console.log(id, JSON.stringify(a.arrival), CONFIG.dayNight.lamps.maxLamps, out.join(" "));
    }
});
