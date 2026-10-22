import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import * as content from "@/app/field/content/world";
import { CONFIG, PALETTE, type Vec3Like } from "./Config";
import { AREAS } from "./Layout";
import type { FontId, MaterialsApi, PhysicsApi } from "./types";
import {
    collectStrings,
    FontLoadError,
    isDisplaySafe,
    nfc,
    resolveFont,
    uniqueCharacters,
    verifyFont,
    withTimeout,
} from "./utils/text";
import {
    buildLetterGeometry,
    capRatio,
    createText3D,
    layoutWord,
    parseTypeface,
    sizeForCap,
    type DynamicLetterFactory,
    type TypefaceData,
} from "./utils/text3d";

// Font coverage (§3.2) and the 3D-letter baseline maths (§3.3).
// The cmap check guards against troika silently fetching fallback fonts from a
// CDN when a content glyph is missing from our subsets (§11).

/** The slice of opentype.js 2.0 used here (the package ships no typings). */
interface OTFont {
    charToGlyphIndex(ch: string): number;
    tables: { os2: { usWeightClass: number } };
}
const opentype = createRequire(import.meta.url)("opentype.js") as { parse(buffer: ArrayBuffer): OTFont };

const PUBLIC = join(process.cwd(), "public");
const publicPath = (url: string) => join(PUBLIC, ...url.split("/").filter(Boolean));
const hex = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

const loadFont = (url: string) => {
    const b = readFileSync(publicPath(url));
    return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const FONTS = Object.fromEntries(
    (Object.keys(CONFIG.text.fonts) as FontId[]).map((id) => [id, loadFont(CONFIG.text.fonts[id])])
) as Record<FontId, OTFont>;
const INTER: FontId[] = ["bold", "semibold", "medium"];

const covers = (font: OTFont, ch: string) => font.charToGlyphIndex(ch) > 0;
const missing = (font: OTFont, chars: string) =>
    Array.from(chars)
        .filter((ch) => ch.trim() !== "" && !covers(font, ch))
        .map((ch) => `${ch} ${hex(ch)}`);

const STRINGS = collectStrings(content);
const typefaceJSON = JSON.parse(readFileSync(publicPath(CONFIG.text.typeface3D), "utf8")) as TypefaceData;

describe("font files", () => {
    it("builds all four WOFFs as WOFF (troika cannot read woff2)", () => {
        for (const url of Object.values(CONFIG.text.fonts)) {
            const sig = readFileSync(publicPath(url)).subarray(0, 4).toString("latin1");
            expect(sig, url).toBe("wOFF");
        }
    });

    it("ships both OFL licences", () => {
        for (const f of ["OFL-Inter.txt", "OFL-BricolageGrotesque.txt"]) {
            expect(readFileSync(join(PUBLIC, "fonts", f), "utf8")).toContain("SIL Open Font License, Version 1.1");
        }
    });

    it("instanced the display face at ExtraBold and Inter at its three weights", () => {
        expect(FONTS.display.tables.os2.usWeightClass).toBe(800);
        expect(FONTS.bold.tables.os2.usWeightClass).toBe(700);
        expect(FONTS.semibold.tables.os2.usWeightClass).toBe(600);
        expect(FONTS.medium.tables.os2.usWeightClass).toBe(500);
    });
});

describe("cmap coverage of content/world.ts", () => {
    it("collects the content strings", () => {
        expect(STRINGS.length).toBeGreaterThan(50);
        expect(STRINGS).toContain(content.meta.greeting);
    });

    it("every NFC code point of every string is in all three Inter subsets", () => {
        const chars = uniqueCharacters(STRINGS);
        for (const id of INTER) expect(missing(FONTS[id], chars), id).toEqual([]);
    });

    it("every display-safe content character is in Bricolage (what preloadAll sends it)", () => {
        const chars = uniqueCharacters(STRINGS, (ch) => isDisplaySafe(ch));
        expect(missing(FONTS.display, chars)).toEqual([]);
    });

    it("strings set in Bricolage are covered by it", () => {
        const display = [
            content.meta.heroWord,
            ...content.journeyStops.map((s) => s.year),
            ...content.ekoMilestones.map((m) => m.step.split(" ")[0]),
            "NOW",
        ];
        for (const s of display) {
            expect(resolveFont("display", s), s).toBe("display");
            expect(missing(FONTS.display, nfc(s)), s).toEqual([]);
        }
    });

    it("Yoruba strings are never set in Bricolage and are covered by Inter", () => {
        const yoruba = [content.meta.greeting, ...content.yorubaWords.map((w) => w.word)];
        // Coin words are Inter by type scale; the greeting is Inter Medium (§2.4).
        expect(CONFIG.type.coinWord.font).not.toBe("display");
        for (const s of yoruba) {
            for (const id of INTER) expect(missing(FONTS[id], nfc(s)), `${id}: ${s}`).toEqual([]);
            // Even if a caller asks for `display`, anything beyond Latin-1 is redirected to Inter.
            if (!isDisplaySafe(s)) expect(resolveFont("display", s), s).toBe("bold");
        }
        expect(yoruba.filter((s) => !isDisplaySafe(s)).length).toBeGreaterThan(4);
        // Bricolage really lacks ṣ (U+1E63), which is why the rule exists.
        expect(covers(FONTS.display, "ṣ")).toBe(false);
    });

    it("the spike sample's marks are in Inter (ẹ ọ ṣ + combining grave/acute)", () => {
        const sample = nfc("Ẹ káàbọ̀ Ọ̀rẹ́ Ẹ ṣé");
        for (const id of INTER) expect(missing(FONTS[id], sample), id).toEqual([]);
        expect(sample).toContain("̀"); // ọ̀ has no precomposed form: needs GPOS mark positioning
    });

    it("every 3D title and the hero word are in the typeface JSON", () => {
        const words = [content.meta.heroWord, ...AREAS.flatMap((a) => (a.title3D ? [a.title3D.text] : []))];
        for (const w of words) {
            for (const ch of nfc(w)) expect(typefaceJSON.glyphs[ch], `${w}: ${ch}`).toBeDefined();
        }
    });
});

describe("text helpers", () => {
    it("display safety: Latin-1 and dashes yes, Yoruba under-dots no", () => {
        expect(isDisplaySafe("2023 – 24")).toBe(true);
        expect(isDisplaySafe("ÈKÓ")).toBe(true);
        expect(isDisplaySafe("Ẹ ṣé")).toBe(false);
        expect(resolveFont("medium", "Ẹ ṣé")).toBe("medium");
    });

    it("the display-safe guard is no wider than the Bricolage subset (no CDN fallback)", () => {
        const BMP_MAX = 0xffff;
        const SURROGATES: readonly [number, number] = [0xd800, 0xdfff];
        const CONTROL_MAX = 0x1f;
        const uncovered: string[] = [];
        for (let cp = CONTROL_MAX + 1; cp <= BMP_MAX; cp++) {
            if (cp >= SURROGATES[0] && cp <= SURROGATES[1]) continue;
            const ch = String.fromCodePoint(cp);
            // Text is set NFC, so singletons such as U+212B (Angstrom) arrive as Å.
            if (isDisplaySafe(ch) && missing(FONTS.display, nfc(ch)).length > 0) uncovered.push(hex(ch));
        }
        expect(uncovered).toEqual([]);
        // General punctuation outside the subset is redirected to Inter.
        for (const ch of ["‐", "―", "†", "‥"]) expect(isDisplaySafe(ch), hex(ch)).toBe(false);
        expect(isDisplaySafe("A\nB")).toBe(true);
    });

    it("uniqueCharacters is NFC, de-duplicated and drops controls", () => {
        expect(uniqueCharacters(["éé", "a\nb"])).toBe("abé");
    });
});

describe("font fetch verification (§6.2 retry once, then fail)", () => {
    const bytes = (s: string) => () => new TextEncoder().encode(s).buffer as ArrayBuffer;
    const ok = (body: () => ArrayBuffer) => ({ ok: true, status: 200, arrayBuffer: async () => body() });
    const notFound = { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const URL_ = "/fonts/a.woff";

    it("resolves for a WOFF on the first try", async () => {
        const f = vi.fn(async () => ok(bytes("wOFF....")));
        await expect(verifyFont(URL_, f)).resolves.toBeUndefined();
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("retries once after a network error", async () => {
        const f = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(ok(bytes("wOFF....")));
        await expect(verifyFont(URL_, f)).resolves.toBeUndefined();
        expect(f).toHaveBeenCalledTimes(2);
    });

    it("rejects with FontLoadError after the retry (404, non-WOFF body)", async () => {
        const f404 = vi.fn(async () => notFound);
        const err = await verifyFont(URL_, f404).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(FontLoadError);
        expect((err as FontLoadError).url).toBe(URL_);
        expect((err as FontLoadError).message).toContain("HTTP 404");
        expect(f404).toHaveBeenCalledTimes(2);

        const fHtml = vi.fn(async () => ok(bytes("<!DOCTYPE html>")));
        await expect(verifyFont(URL_, fHtml)).rejects.toThrow("not a WOFF");
        expect(fHtml).toHaveBeenCalledTimes(2);
    });

    it("withTimeout rejects a hung promise and passes a settled one through", async () => {
        vi.useFakeTimers();
        try {
            const MS = 1000;
            const hung = withTimeout(new Promise<void>(() => {}), MS, () => new FontLoadError("/f", "timeout"));
            const assertion = expect(hung).rejects.toBeInstanceOf(FontLoadError);
            vi.advanceTimersByTime(MS);
            await assertion;
            await expect(withTimeout(Promise.resolve(7), MS, () => new Error("x"))).resolves.toBe(7);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ── 3D letters (§3.3) ────────────────────────────────────────────────────
const font3D = parseTypeface(typefaceJSON);
const CAP = CONFIG.type.heroWord.cap;
const SIZE = sizeForCap(typefaceJSON, CAP);
const geo = (ch: string) =>
    buildLetterGeometry(font3D, ch, {
        size: SIZE,
        depth: CONFIG.type.heroWord.depth,
        curveSegments: CONFIG.type.heroWord.curveSegments,
    });

describe("3D letter maths", () => {
    const B = CONFIG.type.bevel;
    const H = geo("H");
    const tolerance = 1e-6;

    it("cap ratio is measured from H (about 0.66–0.72 at the 1-em scale)", () => {
        const r = capRatio(typefaceJSON);
        expect(r).toBeGreaterThan(0.6);
        expect(r).toBeLessThan(0.75);
        // H's straight body spans exactly the cap height (plus the bevel on both ends).
        expect(H.box.max.y - H.box.min.y).toBeCloseTo(CAP + 2 * B.size, 5);
    });

    it("H sits on the baseline: its flat bottom is the bevel line below y = 0", () => {
        expect(H.box.min.y).toBeCloseTo(-B.size, 6);
    });

    it("È keeps the baseline (accent adds height above, nothing below)", () => {
        const E = geo("È");
        expect(E.box.min.y).toBeCloseTo(H.box.min.y, 6);
        expect(E.box.max.y).toBeGreaterThan(H.box.max.y);
    });

    it("J stays on the baseline (only its optical overshoot dips below)", () => {
        const J = geo("J");
        expect(J.box.min.y).toBeLessThanOrEqual(H.box.min.y + tolerance);
        expect(H.box.min.y - J.box.min.y).toBeLessThan(0.02 * SIZE);
        expect(J.box.max.y).toBeCloseTo(H.box.max.y, 6);
    });

    it("Q keeps its baseline: the tail descends, the bowl tops out with O", () => {
        const Q = geo("Q");
        const O = geo("O");
        expect(Q.box.min.y).toBeLessThan(H.box.min.y - 0.05 * SIZE);
        expect(Q.box.max.y).toBeCloseTo(O.box.max.y, 5);
    });

    it("letters are centred in X and Z only; geometry.center() would break the baseline", () => {
        for (const ch of ["H", "J", "Q", "È"]) {
            const g = geo(ch);
            expect((g.box.min.x + g.box.max.x) / 2, ch).toBeCloseTo(0, 6);
            expect((g.box.min.z + g.box.max.z) / 2, ch).toBeCloseTo(0, 6);
        }
        const centred = geo("È").geometry.clone().center();
        centred.computeBoundingBox();
        expect(Math.abs(centred.boundingBox!.min.y - H.box.min.y)).toBeGreaterThan(0.5);
    });

    it("layoutWord: tracked advances, ink-centred, one slot per non-space letter", () => {
        const L = layoutWord(typefaceJSON, "JQ È", SIZE);
        expect(L.slots.map((s) => s.char)).toEqual(["J", "Q", "È"]);
        const g = typefaceJSON.glyphs;
        const adv = (ch: string) => (g[ch].ha / typefaceJSON.resolution + CONFIG.type.tracking) * SIZE;
        expect(L.slots[1].penX - L.slots[0].penX).toBeCloseTo(adv("J"), 9);
        expect(L.slots[2].penX - L.slots[1].penX).toBeCloseTo(adv("Q") + adv(" "), 9);
        const scale = SIZE / typefaceJSON.resolution;
        const left = L.slots[0].penX + g.J.x_min * scale;
        const right = L.slots[2].penX + g["È"].x_max * scale;
        expect(left).toBeCloseTo(-L.width / 2, 9);
        expect(right).toBeCloseTo(L.width / 2, 9);
    });
});

// ── Word building with stub physics ──────────────────────────────────────
interface FakeBody {
    enabled: boolean;
    t: { x: number; y: number; z: number };
    r: { x: number; y: number; z: number; w: number };
    setEnabled(on: boolean): void;
    setTranslation(v: { x: number; y: number; z: number }): void;
    setRotation(q: { x: number; y: number; z: number; w: number }): void;
    setLinvel(): void;
    setAngvel(): void;
}

const makeBody = (): FakeBody => ({
    enabled: true,
    t: { x: 0, y: 0, z: 0 },
    r: { x: 0, y: 0, z: 0, w: 1 },
    setEnabled(on) {
        this.enabled = on;
    },
    setTranslation(v) {
        this.t = { x: v.x, y: v.y, z: v.z };
    },
    setRotation(q) {
        this.r = { x: q.x, y: q.y, z: q.z, w: q.w };
    },
    setLinvel() {},
    setAngvel() {},
});

function stubDeps() {
    const dynamic: { half: Vec3Like; offset: Vec3Like; body: FakeBody }[] = [];
    const fixed: { half: Vec3Like; pos: THREE.Vector3; offset: Vec3Like; body: FakeBody }[] = [];
    const snapped: FakeBody[] = [];
    const removed: FakeBody[] = [];
    type StubPhysics = Pick<PhysicsApi, "addFixedCuboid" | "link" | "unlink" | "snap"> & DynamicLetterFactory;
    const physics: StubPhysics = {
        removeBody(b) {
            removed.push(b as unknown as FakeBody);
        },
        addDynamicLetter(half, _pos, opts) {
            const body = makeBody();
            dynamic.push({ half: { ...half }, offset: { ...opts.offset }, body });
            return body as never;
        },
        addFixedCuboid(half, pos, _q, offset) {
            const body = makeBody();
            fixed.push({ half: { ...half }, pos: new THREE.Vector3(pos.x, pos.y, pos.z), offset: { ...offset! }, body });
            return body as never;
        },
        link() {},
        unlink() {},
        snap(b) {
            snapped.push(b as unknown as FakeBody);
        },
    };
    const materials = { lambert: () => new THREE.MeshLambertMaterial() } as unknown as MaterialsApi;
    return { physics: physics as unknown as PhysicsApi & DynamicLetterFactory, materials, dynamic, fixed, snapped, removed };
}

describe("createText3D", () => {
    const opts = {
        cap: CONFIG.type.areaTitle.cap,
        depth: CONFIG.type.areaTitle.depth,
        color: PALETTE.ink,
        curveSegments: CONFIG.type.areaTitle.curveSegments,
    };

    it("static words: one baseline (y 0), shared geometry for repeats, fixed colliders on first render", () => {
        const d = stubDeps();
        const t3d = createText3D({ font: font3D, materials: d.materials, physics: d.physics });
        const w = t3d.word("JAZZ", { ...opts, dynamic: false });
        expect(w.letters).toHaveLength(4);
        for (const l of w.letters) expect(l.mesh.position.y).toBe(0);
        expect(w.letters[2].mesh.geometry).toBe(w.letters[3].mesh.geometry);
        expect(d.fixed).toHaveLength(0);

        const scene = new THREE.Scene();
        w.group.position.set(10, 0, -5);
        w.group.rotation.y = Math.PI / 4;
        scene.add(w.group);
        scene.updateMatrixWorld(); // what renderer.render does
        expect(d.fixed).toHaveLength(4);
        // Collider world pose = the letter's world baseline position; offset = bbox centre y.
        const wp = w.letters[0].mesh.getWorldPosition(new THREE.Vector3());
        expect(d.fixed[0].pos.distanceTo(wp)).toBeLessThan(1e-9);
        const box = new THREE.Box3().setFromBufferAttribute(
            w.letters[0].mesh.geometry.getAttribute("position") as THREE.BufferAttribute
        );
        expect(d.fixed[0].offset.y).toBeCloseTo((box.min.y + box.max.y) / 2, 9);
        // The placed group keeps its transform (static letters stay local).
        expect(w.group.position.x).toBe(10);
        // Teardown goes through Physics.removeBody (impact sources forgotten).
        t3d.dispose();
        expect(d.removed).toEqual(d.fixed.map((f) => f.body));
    });

    it("dynamic words: bodies disabled until armed, then world poses on one lifted baseline", () => {
        const d = stubDeps();
        const t3d = createText3D({ font: font3D, materials: d.materials, physics: d.physics });
        const w = t3d.word("JQÈ", { ...opts, dynamic: true });
        expect(d.dynamic.map((x) => x.body.enabled)).toEqual([false, false, false]);

        const scene = new THREE.Scene();
        const area = new THREE.Group();
        scene.add(area);
        area.add(w.group);
        w.group.position.set(-11, 0, 4);
        w.group.rotation.y = Math.PI / 4;
        const expected = w.letters.map((l) => {
            w.group.updateWorldMatrix(true, false);
            return l.mesh.position.clone().applyMatrix4(w.group.matrixWorld);
        });
        w.reset(); // arms explicitly
        expect(d.dynamic.map((x) => x.body.enabled)).toEqual([true, true, true]);
        // Group world transform is identity; meshes sit at world poses.
        w.group.updateWorldMatrix(true, false);
        expect(w.group.matrixWorld.equals(new THREE.Matrix4())).toBe(true);
        w.letters.forEach((l, i) => {
            expect(l.mesh.position.distanceTo(expected[i])).toBeLessThan(1e-9);
            expect(d.dynamic[i].body.t.x).toBeCloseTo(expected[i].x, 9);
        });
        // One shared baseline, lifted by the bevel so the colliders rest on y = 0.
        const lift = CONFIG.type.bevel.size;
        for (const l of w.letters) expect(l.home.position.y).toBeCloseTo(lift, 9);
        for (const { half, offset } of d.dynamic) expect(lift + offset.y - half.y).toBeCloseTo(0, 9);
        expect(d.snapped).toHaveLength(3);

        // reset() returns displaced letters home.
        w.letters[0].mesh.position.set(0, 5, 0);
        d.dynamic[0].body.setTranslation({ x: 0, y: 5, z: 0 });
        w.reset();
        expect(w.letters[0].mesh.position.distanceTo(expected[0])).toBeLessThan(1e-9);
        expect(d.dynamic[0].body.t.y).toBeCloseTo(lift, 9);
        t3d.dispose();
        expect(d.removed).toEqual(d.dynamic.map((x) => x.body));
    });

    it("warns once (dev) when an armed word's group moves", () => {
        const d = stubDeps();
        const t3d = createText3D({ font: font3D, materials: d.materials, physics: d.physics });
        const w = t3d.word("PLAY", { ...opts, dynamic: false });
        const scene = new THREE.Scene();
        w.group.position.set(3, 0, 3);
        scene.add(w.group);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            scene.updateMatrixWorld(); // arms
            scene.updateMatrixWorld(); // unchanged: no warning
            expect(warn).not.toHaveBeenCalled();
            w.group.position.x += 1;
            scene.updateMatrixWorld();
            scene.updateMatrixWorld();
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
            t3d.dispose();
        }
    });
});
