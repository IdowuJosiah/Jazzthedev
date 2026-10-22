// ─────────────────────────────────────────────────────────────────────────
// opentype.js Font → three.js typeface JSON (for FontLoader + TextGeometry).
//
// A port of facetype.js's convert() (MIT, gero3/facetype.js) to Node and
// opentype.js 2.0, with two deliberate changes (docs/field-v3-spec.md §3.2):
//   - 1-em scale: scale = resolution / unitsPerEm with resolution 1000, so a
//     TextGeometry `size` equals 1 em (facetype used 100000 / (upm · 72)).
//   - Only the requested characters are exported (looked up through the cmap).
// Curves are written END POINT FIRST, then the control point(s): `q x y cx cy`
// and `b x y c1x c1y c2x c2y`, which is the order three's Font.createPath reads.
// `reverse` flips the command order of each contour (use only if the counters
// of A / O fill in).
// ─────────────────────────────────────────────────────────────────────────

/** Typeface units per em (the JSON's `resolution`). */
export const RESOLUTION = 1000;

const round = (v) => Math.round(v);

/**
 * Splits path commands into contours and reverses each one (facetype's
 * reverseCommands): the last point becomes the move-to, and every segment is
 * walked backwards with its control points swapped.
 */
export function reverseCommands(commands) {
    const contours = [];
    let contour = null;
    for (const c of commands) {
        const t = c.type.toLowerCase();
        if (t === "m") {
            contour = [c];
            contours.push(contour);
        } else if (t !== "z" && contour) {
            contour.push(c);
        }
    }
    const reversed = [];
    for (const p of contours) {
        reversed.push({ type: "M", x: p[p.length - 1].x, y: p[p.length - 1].y });
        for (let i = p.length - 1; i > 0; i--) {
            const c = p[i];
            const r = { type: c.type };
            if (c.x2 !== undefined && c.y2 !== undefined) {
                r.x1 = c.x2;
                r.y1 = c.y2;
                r.x2 = c.x1;
                r.y2 = c.y1;
            } else if (c.x1 !== undefined && c.y1 !== undefined) {
                r.x1 = c.x1;
                r.y1 = c.y1;
            }
            r.x = p[i - 1].x;
            r.y = p[i - 1].y;
            reversed.push(r);
        }
        reversed.push({ type: "Z" });
    }
    return reversed;
}

/** Encodes opentype.js path commands (font units, y-up) as a typeface outline string. */
export function encodeOutline(commands, scale) {
    const out = [];
    const pt = (x, y) => out.push(round(x * scale), round(y * scale));
    for (const c of commands) {
        switch (c.type) {
            case "M":
                out.push("m");
                pt(c.x, c.y);
                break;
            case "L":
                out.push("l");
                pt(c.x, c.y);
                break;
            case "Q":
                out.push("q");
                pt(c.x, c.y); // end point first …
                pt(c.x1, c.y1); // … then the control point
                break;
            case "C":
                out.push("b");
                pt(c.x, c.y);
                pt(c.x1, c.y1);
                pt(c.x2, c.y2);
                break;
            case "Z":
                out.push("z");
                break;
            default:
                throw new Error(`typeface: unknown path command "${c.type}"`);
        }
    }
    return out.join(" ");
}

/**
 * Converts an opentype.js Font to a three.js typeface object.
 * @param {import("opentype.js").Font} font
 * @param {string} charset characters to export (each must be in the font's cmap)
 * @param {{ reverse?: boolean }} [opts]
 */
export function toTypefaceJSON(font, charset, { reverse = false } = {}) {
    const scale = RESOLUTION / font.unitsPerEm;
    const glyphs = {};
    for (const ch of Array.from(new Set(Array.from(charset)))) {
        const glyph = font.charToGlyph(ch);
        if (!glyph || glyph.index === 0) throw new Error(`typeface: "${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase()}) is not in the font`);
        // glyph.path is in font units, y-up (getPath() would flip y).
        const commands = reverse ? reverseCommands(glyph.path.commands) : glyph.path.commands;
        const bb = glyph.path.getBoundingBox();
        const empty = commands.length === 0;
        glyphs[ch] = {
            ha: round(glyph.advanceWidth * scale),
            x_min: empty ? 0 : round(bb.x1 * scale),
            x_max: empty ? 0 : round(bb.x2 * scale),
            o: encodeOutline(commands, scale),
        };
    }
    const head = font.tables.head;
    const post = font.tables.post;
    const style = (font.getEnglishName("fontSubfamily") ?? "").toLowerCase();
    // An instanced variable font keeps the default "Regular" subfamily name, so
    // read the weight from OS/2 (≥ 600 is CSS "bold").
    const bold = (font.tables.os2?.usWeightClass ?? 400) >= 600 || style.includes("bold");
    return {
        glyphs,
        familyName: font.getEnglishName("fontFamily") ?? "",
        ascender: round(font.ascender * scale),
        descender: round(font.descender * scale),
        underlinePosition: round(post.underlinePosition * scale),
        underlineThickness: round(post.underlineThickness * scale),
        boundingBox: {
            yMin: round(head.yMin * scale),
            xMin: round(head.xMin * scale),
            yMax: round(head.yMax * scale),
            xMax: round(head.xMax * scale),
        },
        resolution: RESOLUTION,
        original_font_information: font.tables.name,
        cssFontWeight: bold ? "bold" : "normal",
        cssFontStyle: style.includes("italic") ? "italic" : "normal",
    };
}
