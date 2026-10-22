// Builds the in-world board images (§8.1) from public/images into
// public/assets/boards as WebP. Paths resolve from the script's own location,
// so it runs from any directory:
//
//     node scripts/boards/build-boards.mjs
//
// Each job resizes with fit "cover" (centre crop, never letterboxed) at WebP
// quality 82. Budgets (§9.2): boards ≤ 160 KB, profile ≤ 100 KB. A file over
// budget is re-encoded at lower quality (down to QUALITY_FLOOR) and the script
// fails if it still does not fit. Missing sources are skipped with a warning
// (eko-phone.webp needs a portrait phone screenshot the repo does not have).

import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/** Repo root: two levels up from scripts/boards/. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC_DIR = join(ROOT, "public/images");
const OUT_DIR = join(ROOT, "public/assets/boards");

const QUALITY = 82;
const QUALITY_STEP = 4;
const QUALITY_FLOOR = 60;
const KB = 1024;
const BOARD = { width: 1600, height: 900, budget: 160 * KB };
const PROFILE = { width: 800, height: 800, budget: 100 * KB };
const PHONE = { width: 720, height: 1500, budget: 160 * KB };

/** [output, source, size]. `source: null` = no suitable source in the repo yet. */
const JOBS = [
    ["clay.webp", "claystudiocreations.jpg", BOARD],
    ["caferiddim.webp", "caferridim.png", BOARD],
    ["mara.webp", "mara.png", BOARD],
    ["sphiderass.webp", "cRf6OhI78D9fHIZyhDlqODIP0.webp", BOARD],
    ["eko.webp", "eekoo.png", BOARD],
    ["profile.webp", "profile.png", PROFILE],
    // Cannot be cropped from the landscape eekoo.png (1666×944) without a blurry
    // upscale. Drop a portrait phone screenshot (e.g. eeko.site at 390×812 @2x)
    // at public/images/eko-phone.png and re-run.
    ["eko-phone.webp", "eko-phone.png", PHONE],
];

async function encode(src, { width, height }, quality) {
    return sharp(src)
        .rotate() // honour EXIF orientation
        .resize(width, height, { fit: "cover", position: "centre", withoutEnlargement: false })
        .webp({ quality, effort: 6, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
}

async function build([out, source, size]) {
    const src = join(SRC_DIR, source);
    if (!existsSync(src)) {
        console.warn(`skip  ${out}: no source at ${src}`);
        return { out, skipped: true };
    }
    const meta = await sharp(src).metadata();
    if (meta.width < size.width || meta.height < size.height) {
        console.warn(`warn  ${out}: source ${meta.width}×${meta.height} is smaller than ${size.width}×${size.height} (upscaled)`);
    }
    let quality = QUALITY;
    let result = await encode(src, size, quality);
    while (result.data.length > size.budget && quality - QUALITY_STEP >= QUALITY_FLOOR) {
        quality -= QUALITY_STEP;
        result = await encode(src, size, quality);
    }
    if (result.data.length > size.budget) {
        throw new Error(`${out}: ${(result.data.length / KB).toFixed(1)} KB exceeds ${size.budget / KB} KB at quality ${quality}`);
    }
    const dest = join(OUT_DIR, out);
    await writeFile(dest, result.data); // already encoded: never re-encode
    const bytes = (await stat(dest)).size;
    console.log(
        `wrote ${out.padEnd(16)} ${result.info.width}×${result.info.height}  q${quality}  ${(bytes / KB).toFixed(1)} KB  ← ${source}`
    );
    return { out, bytes, quality };
}

await mkdir(OUT_DIR, { recursive: true });
const results = [];
for (const job of JOBS) results.push(await build(job));
const skipped = results.filter((r) => r.skipped).map((r) => r.out);
const total = results.reduce((s, r) => s + (r.bytes ?? 0), 0);
console.log(`\n${results.length - skipped.length} built, ${(total / KB).toFixed(1)} KB total` + (skipped.length ? `; skipped: ${skipped.join(", ")}` : ""));
