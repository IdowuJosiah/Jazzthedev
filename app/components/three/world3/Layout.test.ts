import { describe, expect, it } from "vitest";
import { CONFIG } from "./Config";
import {
    AREAS,
    AREA_BY_ID,
    AREA_LAYOUT,
    BOUNDS_RECT,
    GROUND_TEXTS,
    JETTY,
    PADS,
    PATHS,
    PATH_LABELS,
    PROPS,
    RAMP_CORRIDOR,
    RAMP_FOOTPRINT,
    SPAWN,
    SUN_GROUND_DIR,
    TILE,
    TOKEN,
    TOKENS,
    areaAt,
    convexPolygonsOverlap,
    distToRect,
    footprintCorners,
    footprintOverlapsRect,
    footprintsOverlap,
    padFootprint,
    pathHalfWidth,
    pathTiles,
    pointInPad,
    pointInRect,
    pointOnRectEdge,
    rectsOverlap,
    sunStrip,
    tileFootprint,
} from "./Layout";
import { distToSegment2D } from "./utils/math";
import { about, frontendProjects, contactLinks } from "@/app/field/content/world";
import type { PathDef, XZ } from "./types";

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

describe("areas (§2.3)", () => {
    it("has all 9 areas in table order", () => {
        expect(AREAS.map((a) => a.id)).toEqual([
            "welcome",
            "hub",
            "projects",
            "journey",
            "eko",
            "music",
            "about",
            "playground",
            "credits",
        ]);
    });

    it.each(AREAS.map((a) => [a.id, a] as const))("%s: arrival lies inside its own rect", (_, a) => {
        expect(pointInRect(a.rect, a.arrival.x, a.arrival.z)).toBe(true);
        // ...and area detection resolves it to this area (first-match order).
        expect(areaAt(a.arrival.x, a.arrival.z)?.id).toBe(a.id);
    });

    it("no two area rects overlap", () => {
        const bad: string[] = [];
        for (let i = 0; i < AREAS.length; i++) {
            for (let j = i + 1; j < AREAS.length; j++) {
                if (rectsOverlap(AREAS[i].rect, AREAS[j].rect)) bad.push(`${AREAS[i].id} × ${AREAS[j].id}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it("camera zones match §2.3", () => {
        const p = AREA_BY_ID.projects.cameraZone!;
        expect([p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2]).toEqual([28, 152, -92, -44]);
        expect(AREA_BY_ID.music.cameraZone).toEqual(AREA_BY_ID.music.rect);
        expect(AREA_BY_ID.projects.cameraShot).toBe("gallery");
        expect(AREA_BY_ID.music.cameraShot).toBe("gallery");
    });

    it("spawn is the welcome arrival and the credits rect is the jetty", () => {
        expect(SPAWN).toMatchObject({ x: AREA_BY_ID.welcome.arrival.x, z: AREA_BY_ID.welcome.arrival.z });
        expect(AREA_BY_ID.credits.rect).toEqual(JETTY.rect);
    });

    it("every area except credits (the jetty) lies inside the playable bounds", () => {
        for (const a of AREAS) {
            if (a.id === "credits") continue;
            const r = a.rect;
            expect(pointInRect(BOUNDS_RECT, r.x - r.w / 2, r.z - r.d / 2)).toBe(true);
            expect(pointInRect(BOUNDS_RECT, r.x + r.w / 2, r.z + r.d / 2)).toBe(true);
        }
    });
});

describe("paths (§2.5)", () => {
    const onAnotherPath = (p: XZ, self: PathDef) =>
        PATHS.some(
            (o) =>
                o !== self &&
                distToSegment2D(p.x, p.z, o.from.x, o.from.z, o.to.x, o.to.z) <= pathHalfWidth(o) + TILE.joinTolerance
        );
    const onRectEdge = (p: XZ) => AREAS.some((a) => pointOnRectEdge(a.rect, p.x, p.z));

    it.each(PATHS.map((p) => [p.id, p] as const))("%s: both endpoints lie on a rect edge or another path", (_, p) => {
        for (const end of [p.from, p.to]) {
            expect(onRectEdge(end) || onAnotherPath(end, p), `${p.id} endpoint (${end.x}, ${end.z})`).toBe(true);
        }
    });

    it("P5/P6 tiles don't overlap P4's", () => {
        const p4 = pathTiles(PATHS.find((p) => p.id === "P4")!).map(tileFootprint);
        for (const id of ["P5", "P6"]) {
            const tiles = pathTiles(PATHS.find((p) => p.id === id)!).map(tileFootprint);
            const hits = tiles.filter((t) => p4.some((q) => footprintsOverlap(t, q)));
            expect(hits, `${id} tiles overlapping P4`).toEqual([]);
        }
    });

    it("tiles never pass their path's endpoints", () => {
        for (const p of PATHS) {
            const L = Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z);
            const tx = (p.to.x - p.from.x) / L;
            const tz = (p.to.z - p.from.z) / L;
            for (const t of pathTiles(p)) {
                for (const c of footprintCorners(tileFootprint(t))) {
                    const along = (c.x - p.from.x) * tx + (c.z - p.from.z) * tz;
                    expect(along).toBeGreaterThanOrEqual(-1e-6);
                    expect(along).toBeLessThanOrEqual(L + 1e-6);
                }
            }
        }
    });

    it("no two path tiles overlap (same path or across paths — coplanar tiles would z-fight)", () => {
        const all = PATHS.flatMap((p) => pathTiles(p).map((t, i) => ({ id: `${p.id}#${i}`, f: tileFootprint(t) })));
        expect(all.length).toBeGreaterThan(100);
        const bad: string[] = [];
        for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
                if (footprintsOverlap(all[i].f, all[j].f)) bad.push(`${all[i].id} × ${all[j].id}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it("tile placement is deterministic per seed", () => {
        expect(pathTiles(PATHS[1])).toEqual(pathTiles(PATHS[1]));
    });

    it("labels sit beside the path on the camera side, never on tiles", () => {
        const allTiles = PATHS.flatMap((p) => pathTiles(p).map(tileFootprint));
        for (const text of GROUND_TEXTS.filter((g) => g.id.startsWith("path-"))) {
            const hits = allTiles.filter((t) => footprintsOverlap(t, text.footprint));
            expect(hits, text.id).toEqual([]);
        }
        expect(PATH_LABELS).toHaveLength(PATHS.reduce((n, p) => n + p.labels.length, 0));
        // START sits 6 outside the hub edge on P1.
        const start = PATH_LABELS.find((l) => l.text === "START")!;
        expect(near(start.z, AREA_BY_ID.hub.rect.z + AREA_BY_ID.hub.rect.d / 2 + 6)).toBe(true);
    });
});

describe("ground text and titles (§2.5, §3.4.5)", () => {
    it("no two ground-text footprints overlap (labels never draw over plates or each other)", () => {
        const bad: string[] = [];
        for (let i = 0; i < GROUND_TEXTS.length; i++) {
            for (let j = i + 1; j < GROUND_TEXTS.length; j++) {
                if (footprintsOverlap(GROUND_TEXTS[i].footprint, GROUND_TEXTS[j].footprint)) {
                    bad.push(`${GROUND_TEXTS[i].id} × ${GROUND_TEXTS[j].id}`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it("every 3D area title's footprint lies inside its own area rect", () => {
        const titles = PROPS.filter((p) => p.id.startsWith("title-"));
        expect(titles).toHaveLength(AREAS.filter((a) => a.title3D).length);
        const bad: string[] = [];
        for (const t of titles) {
            const area = AREA_BY_ID[t.id.slice("title-".length) as keyof typeof AREA_BY_ID];
            for (const c of footprintCorners(t.footprint)) {
                if (!pointInRect(area.rect, c.x, c.z)) bad.push(`${t.id} corner (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
            }
        }
        expect(bad).toEqual([]);
    });
});

describe("tokens and the ramp corridor (§2.4, §2.7)", () => {
    it("has 8 tokens inside the bounds", () => {
        expect(TOKENS).toHaveLength(8);
        for (const t of TOKENS) expect(pointInRect(BOUNDS_RECT, t.x, t.z)).toBe(true);
    });

    it("tokens lie outside every area rect and the ramp corridor (coin included)", () => {
        for (const t of TOKENS) {
            for (const a of AREAS) {
                expect(distToRect(a.rect, t.x, t.z), `token (${t.x}, ${t.z}) vs ${a.id}`).toBeGreaterThan(TOKEN.radius);
            }
            expect(distToRect(RAMP_CORRIDOR, t.x, t.z)).toBeGreaterThan(TOKEN.radius);
        }
    });

    it("the ramp sits inside the corridor", () => {
        for (const c of footprintCorners(RAMP_FOOTPRINT)) expect(pointInRect(RAMP_CORRIDOR, c.x, c.z)).toBe(true);
    });

    it("the corridor is clear of props, pads and ground text", () => {
        const props = PROPS.filter((p) => footprintOverlapsRect(p.footprint, RAMP_CORRIDOR)).map((p) => p.id);
        const pads = PADS.filter((p) => footprintOverlapsRect(padFootprint(p.pad), RAMP_CORRIDOR)).map((p) => p.id);
        const texts = GROUND_TEXTS.filter((g) => footprintOverlapsRect(g.footprint, RAMP_CORRIDOR)).map((g) => g.id);
        expect([...props, ...pads, ...texts]).toEqual([]);
    });

    it("no path tile crosses the corridor", () => {
        for (const p of PATHS) {
            const hits = pathTiles(p).filter((t) => footprintOverlapsRect(tileFootprint(t), RAMP_CORRIDOR));
            expect(hits, p.id).toEqual([]);
        }
    });
});

describe("sun-side strips (§1.2)", () => {
    it("sun direction on the ground is ≈ (−0.42, 0.91)", () => {
        expect(near(SUN_GROUND_DIR.x, -0.42, 0.01)).toBe(true);
        expect(near(SUN_GROUND_DIR.z, 0.91, 0.01)).toBe(true);
    });

    it("no prop taller than 1.5 stands in any ground text's 6-unit sun-side strip", () => {
        const tall = PROPS.filter((p) => p.height > CONFIG.scenery.tallPropHeight);
        expect(tall.length).toBeGreaterThan(10);
        const bad: string[] = [];
        for (const g of GROUND_TEXTS) {
            const strip = sunStrip(g.footprint);
            for (const p of tall) {
                if (convexPolygonsOverlap(strip, footprintCorners(p.footprint))) bad.push(`${p.id} shades ${g.id}`);
            }
        }
        expect(bad).toEqual([]);
    });
});

describe("area contents (§2.4)", () => {
    it("project pads sit at board + S·12 (≈ (52.5 + 30i, −67.5))", () => {
        expect(AREA_LAYOUT.projects.boards).toHaveLength(frontendProjects.length);
        AREA_LAYOUT.projects.pads.forEach((p, i) => {
            expect(near(p.x, 52.5 + 30 * i, 0.05)).toBe(true);
            expect(near(p.z, -67.5, 0.05)).toBe(true);
        });
    });

    it("music sleeve row centre is ≈ (−56.9, −112.1) and the stage centre ≈ (−67.5, −125.5)", () => {
        const s = AREA_LAYOUT.music.sleeves;
        const cx = s.reduce((a, p) => a + p.x, 0) / s.length;
        const cz = s.reduce((a, p) => a + p.z, 0) / s.length;
        expect(near(cx, -56.9, 0.05) && near(cz, -112.1, 0.05)).toBe(true);
        expect(near(AREA_LAYOUT.music.stage.x, -67.5, 0.05) && near(AREA_LAYOUT.music.stage.z, -125.5, 0.05)).toBe(
            true
        );
    });

    it("the brick wall has 32 bodies and the pin deck 10 pins", () => {
        expect(AREA_LAYOUT.playground.bricks).toHaveLength(32);
        expect(AREA_LAYOUT.playground.bricks.filter((b) => b.half)).toHaveLength(4);
        expect(AREA_LAYOUT.playground.pins).toHaveLength(10);
    });

    it("contact pads exist only for present links (no CV today)", () => {
        expect(AREA_LAYOUT.about.contactPads).toHaveLength(contactLinks.length);
        expect(PADS.filter((p) => p.id.startsWith("contact-")).map((p) => p.label)).toEqual(
            contactLinks.map((c) => c.label)
        );
    });

    it("pad rect tests use the pad's local frame", () => {
        const pad = { x: 10, z: 10, w: 8, d: 2, faceCamera: true };
        // 3.5 along R is inside; 3.5 along world X is not (only 2.47 along R, 2.47 along S).
        expect(pointInPad(pad, 10 + 0.7071 * 3.5, 10 - 0.7071 * 3.5)).toBe(true);
        expect(pointInPad(pad, 13.5, 10)).toBe(false);
        expect(pointInPad({ ...pad, faceCamera: false }, 13.5, 10)).toBe(true);
    });
});

describe("content limits", () => {
    it("bioShort ≤ 100 characters and every boardPitch ≤ 32", () => {
        expect(about.bioShort.length).toBeLessThanOrEqual(100);
        for (const p of frontendProjects) expect(p.boardPitch.length).toBeLessThanOrEqual(CONFIG.type.boardPitch.maxChars);
    });
});
