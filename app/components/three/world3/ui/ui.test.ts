import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCENT, ACCENT_INK } from "../Config";
import { AREAS, BOUNDS, JETTY, rectBounds } from "../Layout";
import { failCopy } from "./FailCard";
import { areaAnnouncement, promptAnnouncement } from "./Hud";
import { MAP, fitMap, headingOnMap, mapExtent, rotateXZ, worldToMap } from "./MapModal";
import { MENU_TABS, nextTab, panelAccentInk, trapIndex } from "./Panels";
import { mutedOnStart, progressPercent, readSoundPref, writeSoundPref } from "./StartScreen";
import { TOUCH, TOUCH_DEVICE_QUERY, isTouchDevice, joystickVector, knobOffset } from "./TouchControls";

const EPS = 1e-9;

// ── Map (§6.2): rotated +π/4 so screen-up is world north-west ────────────
describe("map projection", () => {
    it("matches the fixed camera: NW up, N up-right, E down-right", () => {
        const nw = rotateXZ(-1, -1);
        expect(nw.u).toBeCloseTo(0, 9);
        expect(nw.v).toBeLessThan(0);

        const n = rotateXZ(0, -1);
        expect(n.u).toBeGreaterThan(0);
        expect(n.v).toBeLessThan(0);

        const e = rotateXZ(1, 0);
        expect(e.u).toBeGreaterThan(0);
        expect(e.v).toBeGreaterThan(0);
    });

    it("frames the bounds plus the jetty inside the padded canvas", () => {
        const ext = mapExtent();
        const b = rectBounds(ext);
        expect(b.minX).toBeLessThanOrEqual(BOUNDS.minX);
        expect(b.maxX).toBeGreaterThanOrEqual(BOUNDS.maxX);
        expect(b.minZ).toBeLessThan(rectBounds(JETTY.rect).minZ);
        expect(b.maxZ).toBeGreaterThanOrEqual(BOUNDS.maxZ);

        for (const [w, h] of [
            [600, 520],
            [358, 300],
            [880, 400],
        ]) {
            const view = fitMap(w, h);
            for (const [x, z] of [
                [b.minX, b.minZ],
                [b.maxX, b.minZ],
                [b.maxX, b.maxZ],
                [b.minX, b.maxZ],
            ]) {
                const p = worldToMap(view, x, z);
                expect(p.x).toBeGreaterThanOrEqual(MAP.padding - EPS);
                expect(p.x).toBeLessThanOrEqual(w - MAP.padding + EPS);
                expect(p.y).toBeGreaterThanOrEqual(MAP.padding - EPS);
                expect(p.y).toBeLessThanOrEqual(h - MAP.padding + EPS);
            }
            // The extent centre lands on the canvas centre.
            const c = worldToMap(view, ext.x, ext.z);
            expect(c.x).toBeCloseTo(w / 2, 6);
            expect(c.y).toBeCloseTo(h / 2, 6);
        }
    });

    it("keeps every area centre on the canvas", () => {
        const view = fitMap(600, 520);
        for (const a of AREAS) {
            const p = worldToMap(view, a.rect.x, a.rect.z);
            expect(p.x).toBeGreaterThan(0);
            expect(p.x).toBeLessThan(600);
            expect(p.y).toBeGreaterThan(0);
            expect(p.y).toBeLessThan(520);
        }
    });

    it("points the player arrow along the car's forward vector", () => {
        // yaw π faces −Z (north) → up-right on the map.
        const north = headingOnMap(Math.PI);
        expect(north.x).toBeCloseTo(Math.SQRT1_2, 9);
        expect(north.y).toBeCloseTo(-Math.SQRT1_2, 9);
        // yaw π/2 faces +X (east) → down-right.
        const east = headingOnMap(Math.PI / 2);
        expect(east.x).toBeCloseTo(Math.SQRT1_2, 9);
        expect(east.y).toBeCloseTo(Math.SQRT1_2, 9);
        expect(Math.hypot(east.x, east.y)).toBeCloseTo(1, 9);
    });
});

// ── Touch joystick ───────────────────────────────────────────────────────
describe("joystick", () => {
    it("maps up to throttle +1 and right to steer +1", () => {
        const up = joystickVector(0, -TOUCH.travel);
        expect(up.x).toBeCloseTo(0, 9);
        expect(up.y).toBeCloseTo(1, 9);
        const right = joystickVector(TOUCH.travel, 0);
        expect(right.x).toBeCloseTo(1, 9);
        expect(right.y).toBeCloseTo(0, 9);
    });

    it("clamps to the unit circle and zeroes the dead zone", () => {
        const far = joystickVector(TOUCH.travel * 3, TOUCH.travel * 3);
        expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 9);
        const tiny = joystickVector(TOUCH.travel * TOUCH.deadZone * 0.5, 0);
        expect(tiny).toEqual({ x: 0, y: 0 });
        expect(joystickVector(0, 0)).toEqual({ x: 0, y: 0 });
        // Just past the dead zone the output starts near 0 (no jump).
        const edge = joystickVector(TOUCH.travel * (TOUCH.deadZone + 0.01), 0);
        expect(edge.x).toBeGreaterThan(0);
        expect(edge.x).toBeLessThan(0.05);
    });

    it("keeps the knob inside the base, in whole pixels", () => {
        expect(TOUCH.travel).toBe((TOUCH.baseSize - TOUCH.knobSize) / 2);
        const k = knobOffset(100, 0);
        expect(k).toEqual({ x: TOUCH.travel, y: 0 });
        const j = knobOffset(10.4, -7.6);
        expect(Number.isInteger(j.x) && Number.isInteger(j.y)).toBe(true);
    });
});

describe("touch device gate (owner: desktop-first)", () => {
    /** A matchMedia stub answering from a set of matching media features. */
    const media = (features: string[]) => (q: string) => ({
        matches: q
            .split(" and ")
            .map((f) => f.trim())
            .every((f) => features.includes(f)),
    });

    it("asks for no hover AND a coarse pointer", () => {
        expect(TOUCH_DEVICE_QUERY).toBe("(hover: none) and (pointer: coarse)");
    });

    it("a phone or tablet (no hover, coarse) gets the touch controls", () => {
        expect(isTouchDevice(media(["(hover: none)", "(pointer: coarse)"]))).toBe(true);
    });

    it("desktops and touchscreen laptops with a trackpad never do", () => {
        expect(isTouchDevice(media(["(hover: hover)", "(pointer: fine)"]))).toBe(false);
        // Touchscreen laptop whose primary pointer is the trackpad.
        expect(isTouchDevice(media(["(hover: hover)", "(pointer: coarse)"]))).toBe(false);
        expect(isTouchDevice(media(["(hover: none)", "(pointer: fine)"]))).toBe(false);
    });

    it("no matchMedia (or one that throws) means no touch UI", () => {
        expect(isTouchDevice(undefined)).toBe(false);
        expect(
            isTouchDevice(() => {
                throw new Error("unsupported");
            })
        ).toBe(false);
    });
});

// ── Dialogs ──────────────────────────────────────────────────────────────
describe("focus trap", () => {
    it("wraps Tab and Shift+Tab at the ends only", () => {
        expect(trapIndex(2, 3, false)).toBe(0);
        expect(trapIndex(0, 3, true)).toBe(2);
        expect(trapIndex(1, 3, false)).toBeNull();
        expect(trapIndex(1, 3, true)).toBeNull();
        expect(trapIndex(-1, 3, false)).toBe(0);
        expect(trapIndex(-1, 3, true)).toBe(2);
        expect(trapIndex(0, 0, false)).toBeNull();
    });
});

describe("panel accent", () => {
    it("maps a shape accent to its text-safe ACCENT_INK twin", () => {
        expect(panelAccentInk(parseInt(ACCENT.projects.slice(1), 16), null)).toBe(ACCENT_INK.projects);
        expect(panelAccentInk(parseInt(ACCENT.music.slice(1), 16), "eko")).toBe(ACCENT_INK.music);
    });

    it("falls back to the current area, then brand", () => {
        expect(panelAccentInk(undefined, "eko")).toBe(ACCENT_INK.eko);
        expect(panelAccentInk(0x123456, "journey")).toBe(ACCENT_INK.journey);
        expect(panelAccentInk(undefined, null)).toBe(ACCENT_INK.brand);
    });
});

describe("menu tabs", () => {
    it("has the five §6.2 tabs and wraps with the arrow keys", () => {
        expect(MENU_TABS.map((t) => t.id)).toEqual(["settings", "controls", "words", "contact", "credits"]);
        expect(nextTab("credits", "ArrowRight")).toBe("settings");
        expect(nextTab("settings", "ArrowLeft")).toBe("credits");
        expect(nextTab("words", "Home")).toBe("settings");
        expect(nextTab("words", "End")).toBe("credits");
        expect(nextTab("words", "a")).toBeNull();
    });
});

// ── Copy, announcements, loader ──────────────────────────────────────────
describe("failure cards", () => {
    it("uses the §6.2 titles and actions", () => {
        expect(failCopy("webgl")).toMatchObject({ title: "Your browser can't show the 3D world", primary: "projects" });
        expect(failCopy("context-lost")).toMatchObject({ title: "Graphics were reset", primary: "reload" });
        expect(failCopy("asset")).toMatchObject({ title: "Something didn't load", primary: "reload" });
        expect(failCopy("timeout")).toMatchObject({
            title: "This is taking longer than usual",
            primary: "keepWaiting",
        });
        expect(failCopy(undefined).title).toBe("Something didn't load");
    });
});

describe("announcements", () => {
    it("reads prompts and areas aloud", () => {
        expect(promptAnnouncement({ title: "Clay Studio Creations", action: "Open project" }, false)).toBe(
            "Press E to open Clay Studio Creations"
        );
        expect(promptAnnouncement({ title: "Playground", action: "Reset" }, true)).toBe("Tap E: Reset, Playground");
        expect(areaAnnouncement("projects")).toBe("Entered Frontend Projects");
    });
});

describe("start + loader", () => {
    it("Start turns sound on unless the visitor turned it off before", () => {
        expect(mutedOnStart(null)).toBe(false);
        expect(mutedOnStart("on")).toBe(false);
        expect(mutedOnStart("off")).toBe(true);
    });

    it("survives missing storage", () => {
        expect(readSoundPref()).toBeNull();
        expect(() => writeSoundPref("on")).not.toThrow();
    });

    it("reports whole, clamped percentages", () => {
        expect(progressPercent(-1)).toBe(0);
        expect(progressPercent(0.154)).toBe(15);
        expect(progressPercent(2)).toBe(100);
    });
});

// ── Static style rules (§3.4.4, §3.4.7, §6.1) ────────────────────────────
describe("v3 UI style rules", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const css = readFileSync(fileURLToPath(new URL("../../../../field/v3/world.css", import.meta.url)), "utf8");
    const sources = [
        ...readdirSync(here)
            .filter((f) => f.endsWith(".tsx"))
            .map((f) => readFileSync(`${here}${f}`, "utf8")),
        readFileSync(fileURLToPath(new URL("../../../../field/v3/FieldExperience.tsx", import.meta.url)), "utf8"),
    ];

    it("has no backdrop-filter, gradients, glows or translateX(-50%)", () => {
        const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
        expect(bare).not.toMatch(/backdrop-filter/);
        expect(bare).not.toMatch(/gradient\(/);
        expect(bare).not.toMatch(/text-shadow/);
        expect(bare).not.toMatch(/translateX\(\s*-50%/);
        expect(bare).not.toMatch(/left:\s*50%/);
        for (const src of sources) expect(src).not.toMatch(/translateX\(\s*-50%|backdrop-filter/);
    });

    it("uses whole-pixel font sizes only", () => {
        const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
        expect(sizes.length).toBeGreaterThan(0);
        for (const s of sizes) expect(s).toMatch(/^\d+px$/);
    });

    it("uses no emoji or unicode glyph icons in rendered code", () => {
        // Arrows, technical symbols, geometric shapes, dingbats, emoji. Comments may use arrows.
        const glyphs = /[\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}]/u;
        const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
        for (const src of sources) expect(stripComments(src)).not.toMatch(glyphs);
    });
});
