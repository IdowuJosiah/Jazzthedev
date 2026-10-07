import * as THREE from "three";
import { Text, configureTextBuilder, preloadFont } from "troika-three-text";
import { CONFIG, type HexColor } from "../Config";
import { LAYERS, applyLayerToMaterial, type FlatLayerId } from "./shapes";
import type { FontId, TextApi, TextHandle, TextOpts } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Tier-B text (§3.1–§3.3): troika-three-text SDF meshes, never billboarded.
//
// - configureText() points troika at the self-hosted Inter (no CDN Roboto) with
//   sdfGlyphSize 64; it runs once, before the first Text is created.
// - preloadAll(strings) warms the glyph atlases of all four WOFFs during
//   loading, with every content string NFC-normalised.
// - flat()/onPath() text lies in the ground plane at its flat layer (§2.5):
//   y from LAYERS, polygonOffset, depthWrite off, renderOrder. The layer height
//   lives on the inner mesh, so callers can position `object` at y = 0 freely.
// - Base materials are MeshBasicMaterial({ fog: true }) shared per layer; each
//   Text's colour is troika's per-mesh uniform. Raycast is disabled.
// - desktopOnly text is hidden on touch devices and on portrait (aspect < 1).
// - Yoruba (anything outside DISPLAY_SAFE_RANGES, the Bricolage subset) is
//   never set in Bricolage: `display` falls back to Inter Bold (§3.4 item 8).
// - troika's font loader only logs a failed font and never calls back, so
//   preloadAll() first fetches every WOFF itself (retry once, §6.2) and rejects
//   with a FontLoadError; a timeout backstops the troika preload itself.
// ─────────────────────────────────────────────────────────────────────────

const T = CONFIG.text;

/**
 * Code points Bricolage display text may use: the non-Yoruba ranges of the SDF
 * subset in scripts/fonts/build-fonts.mjs (RANGES), minus the three code points
 * the Bricolage source itself lacks (U+00A4 ¤, U+00AD soft hyphen, U+201B ‛).
 * Keep the two in step; fonts.test.ts checks every accepted code point against
 * the Bricolage cmap, so a guard wider than the font fails the tests.
 */
export const DISPLAY_SAFE_RANGES: readonly (readonly [number, number])[] = [
    [0x20, 0x7e], // printable ASCII
    [0xa0, 0xa3], // Latin-1 supplement, without ¤ and the soft hyphen
    [0xa5, 0xac],
    [0xae, 0xff],
    [0x2013, 0x2014], // en / em dash
    [0x2018, 0x201a], // curly quotes, without ‛
    [0x201c, 0x201e],
    [0x2022, 0x2022], // bullet
    [0x2026, 0x2026], // ellipsis
];
/** Unicode combining diacritical marks block (Yoruba tone marks). */
const COMBINING_MARKS: readonly [number, number] = [0x300, 0x36f];
/** Printable ASCII, always preloaded (pad labels, keycaps, controls card). */
const ASCII_PRINTABLE: readonly [number, number] = [0x20, 0x7e];
/** Characters skipped by the preload: C0 controls (newlines, tabs) and DEL. */
const CONTROL_MAX = 0x1f;
const DEL = 0x7f;
/** Attempts after the first failed font fetch (§6.2: retry once). */
const FONT_RETRIES = 1;
/**
 * Backstop for one troika preload after its WOFF fetched fine (a parse failure
 * would otherwise hang). Longer than CONFIG.loading.timeoutMs, so the "taking
 * longer than usual" card shows first on a slow device.
 */
const FONT_PRELOAD_TIMEOUT_MS = 30000;
/** First four bytes of every WOFF 1 file. */
const WOFF_SIGNATURE = "wOFF";

const noRaycast = () => {};

// ── Pure helpers (unit-tested without a browser) ─────────────────────────
export const nfc = (s: string): string => s.normalize("NFC");

/**
 * True when every code point of `text` is safe to set in Bricolage: inside
 * DISPLAY_SAFE_RANGES, or a C0 control (newline, tab), which troika lays out
 * as whitespace without a glyph lookup.
 */
export function isDisplaySafe(text: string): boolean {
    for (const ch of nfc(text)) {
        const cp = ch.codePointAt(0)!;
        if (cp <= CONTROL_MAX) continue;
        if (!DISPLAY_SAFE_RANGES.some(([a, b]) => cp >= a && cp <= b)) return false;
    }
    return true;
}

/** The font a string is actually set in: `display` never carries Yoruba. */
export function resolveFont(font: FontId, text: string): FontId {
    return font === "display" && !isDisplaySafe(text) ? "bold" : font;
}

export function hasCombiningMarks(text: string): boolean {
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp >= COMBINING_MARKS[0] && cp <= COMBINING_MARKS[1]) return true;
    }
    return false;
}

/** Recursively collects every string under a value (content modules, arrays, records). */
export function collectStrings(value: unknown, out: string[] = [], seen = new Set<object>()): string[] {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") {
        if (seen.has(value)) return out;
        seen.add(value);
        for (const v of Object.values(value)) collectStrings(v, out, seen);
    }
    return out;
}

/** Unique NFC code points of `strings` (controls dropped), sorted, as one string. */
export function uniqueCharacters(strings: readonly string[], filter: (ch: string) => boolean = () => true): string {
    const set = new Set<string>();
    for (const s of strings) {
        for (const ch of nfc(s)) {
            const cp = ch.codePointAt(0)!;
            if (cp <= CONTROL_MAX || cp === DEL) continue;
            if (filter(ch)) set.add(ch);
        }
    }
    return Array.from(set)
        .sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!)
        .join("");
}

const asciiPrintable = (): string =>
    Array.from({ length: ASCII_PRINTABLE[1] - ASCII_PRINTABLE[0] + 1 }, (_, i) =>
        String.fromCodePoint(ASCII_PRINTABLE[0] + i)
    ).join("");

/** desktopOnly rule: hidden on touch devices and portrait screens. */
export function desktopOnlyVisible(isTouch: boolean, aspect: number): boolean {
    return !isTouch && aspect >= T.desktopOnlyMinAspect;
}

// ── troika setup ─────────────────────────────────────────────────────────
let configured = false;

/**
 * Configures troika once (idempotent). Must run before any Text is created:
 * without a defaultFontURL troika fetches Roboto from a CDN.
 */
export function configureText(): void {
    if (configured) return;
    configured = true;
    configureTextBuilder({
        defaultFontURL: T.defaultFontURL,
        sdfGlyphSize: T.sdfGlyphSize,
        useWorker: T.useWorker,
    });
}

/** A required font failed to load (the integrator maps it to failReason "asset"). */
export class FontLoadError extends Error {
    readonly url: string;

    constructor(url: string, reason: string) {
        super(`Font ${url} failed to load: ${reason}`);
        this.name = "FontLoadError";
        this.url = url;
    }
}

type FontFetch = (url: string) => Promise<Pick<Response, "ok" | "status" | "arrayBuffer">>;

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Fetches a WOFF and checks its signature, retrying once (§6.2). Rejects with a
 * FontLoadError on a network error, an HTTP error or a body that is not a WOFF
 * (e.g. an HTML fallback page). troika's own request then hits the HTTP cache.
 */
export async function verifyFont(
    url: string,
    fetchFont: FontFetch = (u) => fetch(u),
    retries: number = FONT_RETRIES
): Promise<void> {
    let reason = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetchFont(url);
            if (!res.ok) {
                reason = `HTTP ${res.status}`;
                continue;
            }
            const head = new Uint8Array(await res.arrayBuffer(), 0, WOFF_SIGNATURE.length);
            const sig = String.fromCharCode(...head);
            if (sig === WOFF_SIGNATURE) return;
            reason = "not a WOFF file";
        } catch (e) {
            reason = errorMessage(e);
        }
    }
    throw new FontLoadError(url, reason);
}

/** Rejects with `onTimeout()` if `promise` has not settled after `ms`. */
export function withTimeout<V>(promise: Promise<V>, ms: number, onTimeout: () => Error): Promise<V> {
    return new Promise<V>((resolve, reject) => {
        const timer = setTimeout(() => reject(onTimeout()), ms);
        promise.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (e: unknown) => {
                clearTimeout(timer);
                reject(e);
            }
        );
    });
}

/**
 * Preloads the four WOFFs' glyph SDFs for `strings` (NFC). Inter fonts get every
 * character; Bricolage only the display-safe ones, so a Yoruba glyph it lacks
 * never triggers troika's CDN fallback-font lookup. Printable ASCII is always
 * included. Resolves when every font is ready; rejects with a FontLoadError when
 * a font cannot be fetched (after one retry) or troika never finishes with it.
 */
export function preloadAll(strings: readonly string[]): Promise<void> {
    configureText();
    const all = [...strings, asciiPrintable()];
    const jobs = (Object.keys(T.fonts) as FontId[]).map(async (id) => {
        const url = T.fonts[id];
        await verifyFont(url);
        const characters = id === "display" ? uniqueCharacters(all, (ch) => isDisplaySafe(ch)) : uniqueCharacters(all);
        const preloaded = new Promise<void>((resolve) => {
            preloadFont({ font: url, characters, sdfGlyphSize: T.sdfGlyphSize }, () => resolve());
        });
        await withTimeout(
            preloaded,
            FONT_PRELOAD_TIMEOUT_MS,
            () => new FontLoadError(url, `glyph preload timed out after ${FONT_PRELOAD_TIMEOUT_MS} ms`)
        );
    });
    return Promise.all(jobs).then(() => undefined);
}

// ── TextApi ──────────────────────────────────────────────────────────────
type Orientation = "flat" | "upright";

export interface TextViewport {
    isTouch: boolean;
    aspect: number;
}

export interface TextSystemOptions extends Partial<TextViewport> {
    /** Track window resizes for the desktopOnly rule (default true in a browser). */
    watchWindow?: boolean;
}

/** TextApi plus the engine-side hooks (viewport for desktopOnly, budget count, teardown). */
export interface TextSystem extends TextApi {
    setViewport(v: Partial<TextViewport>): void;
    /** Live troika Text meshes (budget §9.2: ≤ CONFIG.text.maxMeshes). */
    readonly count: number;
    dispose(): void;
}

const browserViewport = (): TextViewport => {
    if (typeof window === "undefined") return { isTouch: false, aspect: 1 };
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    return {
        isTouch: coarse || (navigator.maxTouchPoints ?? 0) > 0,
        aspect: window.innerWidth / Math.max(1, window.innerHeight),
    };
};

/** Creates the TextApi handed to areas (AreaContext.text). */
export function createTextApi(opts: TextSystemOptions = {}): TextSystem {
    configureText();
    const detected = browserViewport();
    const viewport: TextViewport = {
        isTouch: opts.isTouch ?? detected.isTouch,
        aspect: opts.aspect ?? detected.aspect,
    };
    const materials = new Map<string, THREE.MeshBasicMaterial>();
    const live = new Set<Text>();
    const desktopOnly = new Set<Text>();

    const baseMaterial = (layer: FlatLayerId | null): THREE.MeshBasicMaterial => {
        const key = layer ?? "upright";
        let m = materials.get(key);
        if (!m) {
            // White base; troika applies each mesh's `color` as a uniform.
            m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: true, side: THREE.DoubleSide });
            if (layer) applyLayerToMaterial(m, layer);
            materials.set(key, m);
        }
        return m;
    };

    const applyDesktopOnly = () => {
        const show = desktopOnlyVisible(viewport.isTouch, viewport.aspect);
        for (const t of desktopOnly) t.visible = show;
    };

    const onResize = () => {
        viewport.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        applyDesktopOnly();
    };
    const watch = (opts.watchWindow ?? true) && typeof window !== "undefined";
    if (watch) window.addEventListener("resize", onResize);

    const setContent = (mesh: Text, font: FontId, text: string, letterSpacing: number) => {
        const s = nfc(text);
        const actual = resolveFont(font, s);
        if (actual !== font) console.warn(`[world3/text] "${s}" is not display-safe; set in Inter Bold instead`);
        // troika adds letterSpacing after every glyph, including zero-advance
        // combining marks, which would push Yoruba tone marks off their base.
        const spacing = letterSpacing !== 0 && hasCombiningMarks(s) ? 0 : letterSpacing;
        mesh.text = s;
        mesh.font = T.fonts[actual];
        mesh.letterSpacing = spacing;
    };

    const make = (o: TextOpts, orientation: Orientation, angle = 0): TextHandle => {
        const mesh = new Text();
        const layerId: FlatLayerId | null = orientation === "flat" ? (o.layer ?? "groundText") : null;
        const font = o.font;
        const letterSpacing = o.letterSpacing ?? 0;
        setContent(mesh, font, o.text, letterSpacing);
        mesh.fontSize = o.size;
        mesh.color = o.color;
        mesh.maxWidth = o.maxWidth ?? Infinity;
        mesh.anchorX = o.anchorX ?? "center";
        mesh.anchorY = o.anchorY ?? "middle";
        mesh.lineHeight = o.lineHeight ?? "normal";
        mesh.sdfGlyphSize = T.sdfGlyphSize;
        mesh.material = baseMaterial(layerId);
        mesh.raycast = noRaycast;
        mesh.castShadow = false; // text casts nothing (§1.5)
        mesh.receiveShadow = false;

        const object = new THREE.Group();
        object.name = `text:${orientation}`;
        if (layerId) {
            const L = LAYERS[layerId];
            // Lie in the ground plane, reading along local +X, facing +Y.
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = L.y;
            mesh.renderOrder = L.renderOrder;
            object.rotation.y = angle;
        }
        object.add(mesh);

        live.add(mesh);
        if (o.desktopOnly) {
            desktopOnly.add(mesh);
            mesh.visible = desktopOnlyVisible(viewport.isTouch, viewport.aspect);
        }
        mesh.sync();

        let disposed = false;
        return {
            object,
            mesh,
            setText(text: string) {
                if (disposed) return;
                setContent(mesh, font, text, letterSpacing);
                mesh.sync();
            },
            setColor(hex: HexColor) {
                if (disposed) return;
                mesh.color = hex;
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                live.delete(mesh);
                desktopOnly.delete(mesh);
                mesh.removeFromParent();
                object.removeFromParent();
                // troika's dispose() frees only the geometry; the derived SDF
                // material would live until the shared base material is
                // disposed (its base listener re-disposing it then is harmless).
                // With an outline the getter returns [outline, derived]; the
                // derived material disposes its outline twin itself.
                const m = mesh.material as THREE.Material | THREE.Material[];
                (Array.isArray(m) ? m[m.length - 1] : m).dispose();
                mesh.dispose();
            },
        };
    };

    return {
        flat: (o) => make(o, "flat"),
        upright: (o) => make(o, "upright"),
        onPath: (o) => make(o, "flat", o.angle),
        setViewport(v: Partial<TextViewport>) {
            if (v.isTouch !== undefined) viewport.isTouch = v.isTouch;
            if (v.aspect !== undefined) viewport.aspect = v.aspect;
            applyDesktopOnly();
        },
        get count() {
            return live.size;
        },
        dispose() {
            if (watch) window.removeEventListener("resize", onResize);
            for (const t of live) {
                t.removeFromParent();
                t.dispose();
            }
            live.clear();
            desktopOnly.clear();
            for (const m of materials.values()) m.dispose();
            materials.clear();
        },
    };
}
