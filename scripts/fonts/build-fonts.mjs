// ─────────────────────────────────────────────────────────────────────────
// Font build for the /field v3 world (docs/field-v3-spec.md §3.2).
//
//   node scripts/fonts/build-fonts.mjs [--reverse]
//
// Instances the committed OFL variable TTFs (scripts/fonts/src/) at fixed axis
// values and subsets them with HarfBuzz (subset-font). Output is WOFF, because
// troika-three-text cannot read woff2. The Bricolage display face also gets a
// three.js typeface JSON (1-em scale) for the extruded 3D titles. Both OFL
// licences are copied next to the fonts. Neither OFL.txt declares a Reserved
// Font Name, so the subsets may keep the original family names.
//
// Paths resolve from the repo root, so the script runs from any cwd. The build
// is deterministic: re-running it reproduces byte-identical files.
// ─────────────────────────────────────────────────────────────────────────

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import opentype from "opentype.js";
import { toTypefaceJSON } from "./typeface.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(HERE, "src");
const OUT = join(ROOT, "public", "fonts");

/**
 * Code point ranges kept in every SDF subset (Latin, Latin-1, Yoruba marks,
 * Vietnamese block, punctuation, arrows, ₦). The non-Yoruba part is mirrored by
 * DISPLAY_SAFE_RANGES in app/components/three/world3/utils/text.ts (the guard
 * that keeps Bricolage away from glyphs it lacks, which also drops U+00A4,
 * U+00AD and U+201B: the Bricolage source has no glyph for them); change both
 * together.
 * fonts.test.ts fails if the guard accepts a code point the subset lacks.
 */
const RANGES = [
    [0x20, 0x7e],
    [0xa0, 0xff],
    [0x300, 0x304],
    [0x306, 0x308],
    [0x30a, 0x30c],
    [0x323, 0x323],
    [0x1e62, 0x1e63],
    [0x1ea0, 0x1ef9],
    [0x2013, 0x2014],
    [0x2018, 0x201e],
    [0x2022, 0x2022],
    [0x2026, 0x2026],
    [0x2190, 0x2193],
    [0x2197, 0x2197],
    [0x20a6, 0x20a6],
];
const TEXT = RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i))).join("");

/** OpenType features kept: kerning, mark positioning (Yoruba tone/under-dots), composition, ligatures. */
const keepFeatures = ["kern", "mark", "mkmk", "ccmp", "locl", "liga", "calt"];

/**
 * Characters in the 3D typeface (ASCII / Latin-1 display titles only; Yoruba is
 * never set in Bricolage). The space is added to the spec's set so a title with
 * a space gets a real advance instead of three's "?" fallback glyph.
 */
const CHARSET_3D = "ABCDEFGHIJKLMNOPQRSTUVWXYZÈÓ0123456789&·!?-' ";

const JOBS = [
    ["Inter[opsz,wght].ttf", { wght: 700, opsz: 32 }, "Inter-Bold"],
    ["Inter[opsz,wght].ttf", { wght: 600, opsz: 32 }, "Inter-SemiBold"],
    ["Inter[opsz,wght].ttf", { wght: 500, opsz: 14 }, "Inter-Medium"],
    ["BricolageGrotesque[opsz,wdth,wght].ttf", { wght: 800, opsz: 96, wdth: 100 }, "BricolageGrotesque-ExtraBold"],
];

const LICENCES = [
    ["OFL-Inter.txt", "OFL-Inter.txt"],
    ["OFL-BricolageGrotesque.txt", "OFL-BricolageGrotesque.txt"],
];

const reverse = process.argv.includes("--reverse");

await mkdir(OUT, { recursive: true });
for (const [file, variationAxes, out] of JOBS) {
    const src = await readFile(join(SRC, file));
    const woff = await subsetFont(src, TEXT, { variationAxes, keepFeatures, targetFormat: "woff" });
    await writeFile(join(OUT, `${out}.woff`), woff);
    console.log(`fonts: ${out}.woff ${(woff.byteLength / 1024).toFixed(1)} KB`);

    if (out.startsWith("Bricolage")) {
        const sfnt = await subsetFont(src, CHARSET_3D, { variationAxes, keepFeatures, targetFormat: "sfnt" });
        const font = opentype.parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength));
        const json = JSON.stringify(toTypefaceJSON(font, CHARSET_3D, { reverse }));
        await writeFile(join(OUT, `${out}.typeface.json`), json);
        console.log(`fonts: ${out}.typeface.json ${(json.length / 1024).toFixed(1)} KB${reverse ? " (reversed contours)" : ""}`);
    }
}
for (const [from, to] of LICENCES) {
    await copyFile(join(SRC, from), join(OUT, to));
    console.log(`fonts: ${to}`);
}
