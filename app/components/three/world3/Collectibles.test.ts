import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { yorubaWords } from "@/app/field/content/world";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "./Config";
import { AREAS, RAMP_CORRIDOR, TOKEN, TOKENS, pointInRect } from "./Layout";
import { WorldStore } from "./State";
import type { MaterialsApi, RuntimeInfo, TextApi, TextHandle, TextOpts, XZ } from "./types";
import { resolveFont } from "./utils/text";
import {
    COLLECT_POP_S,
    WORD_FIT,
    build,
    coinPose,
    collectToast,
    defaultTotal,
    inPickupRange,
    storeCollector,
    type CollectEvent,
} from "./Collectibles";

// Yoruba-word coins (§5.2 "Coins", §2.7 item 5): build, motion, pickup, the
// store wiring and the Inter coverage of every coin word.

const DT = 1 / 60;
const WOBBLE = THREE.MathUtils.degToRad(TOKEN.wobbleDeg);
/** Index of Ọ̀rẹ́ (Friend) in the content list: the spec's toast example. */
const ORE = yorubaWords.findIndex((w) => w.meaning === "Friend");

type TextCall = { opts: TextOpts; handle: TextHandle };

function stubDeps(fail: { textAt?: number } = {}) {
    const texts: TextCall[] = [];
    const lambert = vi.fn<(hex: string) => THREE.MeshLambertMaterial>((hex) => new THREE.MeshLambertMaterial({ color: hex }));
    const upright = (o: TextOpts): TextHandle => {
        if (fail.textAt !== undefined && texts.length === fail.textAt) throw new Error("text failed");
        const handle = { object: new THREE.Group(), mesh: {}, setText() {}, setColor() {}, dispose: vi.fn() } as unknown as TextHandle;
        texts.push({ opts: o, handle });
        return handle;
    };
    const notUsed = () => {
        throw new Error("coins only use upright text");
    };
    const onCollect = vi.fn<(word: { word: string; meaning: string }, index: number, e: CollectEvent) => void>();
    const playUi = vi.fn();
    return {
        deps: {
            materials: { lambert, basic: notUsed } as unknown as MaterialsApi,
            text: { flat: notUsed, upright, onPath: notUsed } as unknown as TextApi,
            onCollect,
            audio: { playUi },
        },
        texts,
        lambert,
        onCollect,
        playUi,
    };
}

const rt = (p: XZ | null, reducedMotion = false): RuntimeInfo => ({
    // Default: parked far from every token but within the cull distance of none.
    carPos: p ? new THREE.Vector3(p.x, 0, p.z) : new THREE.Vector3(0, 0, 12),
    carSpeed: 0,
    reducedMotion,
    muted: true,
    isTouch: false,
});

describe("Collectibles — pure helpers", () => {
    it("toast reads `Ọ̀rẹ́ — Friend · 3 of 8 words` (NFC)", () => {
        const t = collectToast(yorubaWords[ORE], 3, 8);
        expect(t).toBe("Ọ̀rẹ́ — Friend · 3 of 8 words".normalize("NFC"));
        expect(t).toBe(t.normalize("NFC"));
    });

    it("coinPose: bob ≤ 0.3 around TOKEN.y, yaw wobble within ±20° of faceCamera (never a spin)", () => {
        let minYaw = Infinity;
        let maxYaw = -Infinity;
        for (let i = 0; i < TOKENS.length; i++) {
            for (let t = 0; t < 10; t += 0.01) {
                const p = coinPose(i, t, false);
                expect(Math.abs(p.y - TOKEN.y)).toBeLessThanOrEqual(TOKEN.bob + 1e-9);
                expect(Math.abs(p.yaw - FACE_CAMERA_Y)).toBeLessThanOrEqual(WOBBLE + 1e-9);
                minYaw = Math.min(minYaw, p.yaw);
                maxYaw = Math.max(maxYaw, p.yaw);
            }
        }
        // It actually wobbles (close to the full ±20°), and the bob runs at 1.2 Hz.
        expect(maxYaw - minYaw).toBeGreaterThan(1.9 * WOBBLE);
        const period = 1 / TOKEN.bobHz;
        const a = coinPose(0, 0.3, false);
        const b = coinPose(0, 0.3 + period, false);
        expect(b.y).toBeCloseTo(a.y, 9);
        // Neighbouring coins are out of phase.
        expect(coinPose(1, 0.3, false).y).not.toBeCloseTo(a.y, 3);
    });

    it("coinPose is static (rest pose) under reduced motion", () => {
        for (const t of [0, 0.37, 5]) expect(coinPose(3, t, true)).toEqual({ y: TOKEN.y, yaw: FACE_CAMERA_Y });
    });

    it("pickup radius 2.8 on the ground plane", () => {
        const tok = TOKENS[0];
        expect(inPickupRange(tok, tok.x + TOKEN.pickupRadius - 1e-9, tok.z)).toBe(true);
        expect(inPickupRange(tok, tok.x + 2, tok.z - 1.9)).toBe(true);
        expect(inPickupRange(tok, tok.x + TOKEN.pickupRadius + 0.01, tok.z)).toBe(false);
        expect(TOKEN.pickupRadius).toBe(2.8);
    });

    it("eight tokens, each paired with a word, all outside every area rect and the ramp corridor", () => {
        expect(defaultTotal()).toBe(8);
        expect(yorubaWords).toHaveLength(8);
        for (const t of TOKENS) {
            expect(pointInRect(RAMP_CORRIDOR, t.x, t.z)).toBe(false);
            for (const a of AREAS) expect(pointInRect(a.rect, t.x, t.z)).toBe(false);
        }
    });
});

describe("Collectibles — Yoruba glyph coverage (§3.2, §3.4 item 8)", () => {
    interface OTFont {
        charToGlyphIndex(ch: string): number;
    }
    const opentype = createRequire(import.meta.url)("opentype.js") as { parse(buffer: ArrayBuffer): OTFont };
    const fontUrl = CONFIG.text.fonts[CONFIG.type.coinWord.font];
    const b = readFileSync(join(process.cwd(), "public", ...fontUrl.split("/").filter(Boolean)));
    const font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

    it("coin words are set in Inter (never the display face), and Inter Bold has every code point", () => {
        expect(CONFIG.type.coinWord.font).toBe("bold");
        const missing: string[] = [];
        for (const w of yorubaWords) {
            const s = w.word.normalize("NFC");
            expect(resolveFont(CONFIG.type.coinWord.font, s)).toBe("bold");
            for (const ch of s) {
                if (ch.trim() === "") continue;
                if (font.charToGlyphIndex(ch) <= 0) missing.push(`${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()} in "${s}"`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("the words carry the marks that must render: under-dots (ẹ ọ ṣ) and stacked tones (Ọ̀ ẹ́)", () => {
        const all = yorubaWords.map((w) => w.word.normalize("NFC")).join("");
        for (const ch of ["ẹ", "Ọ", "ọ", "ṣ", "̀", "́"]) {
            expect(all.includes(ch), `U+${ch.codePointAt(0)!.toString(16)}`).toBe(true);
            expect(font.charToGlyphIndex(ch)).toBeGreaterThan(0);
        }
    });
});

describe("Collectibles — build (§5.2)", () => {
    it("one paper coin with a yellow rim per token, axis along local Z, faceCamera at TOKEN.y", () => {
        const s = stubDeps();
        const h = build(s.deps);
        expect(h.total).toBe(8);
        expect(h.coins).toHaveLength(8);
        h.coins.forEach((c, i) => {
            expect(c.position).toEqual(TOKENS[i]);
            expect(c.root.position.toArray()).toEqual([TOKENS[i].x, TOKEN.y, TOKENS[i].z]);
            expect(c.root.rotation.y).toBe(FACE_CAMERA_Y);
            expect(c.root.parent).toBe(h.group);
            expect(c.word).toEqual({ ...yorubaWords[i], word: yorubaWords[i].word.normalize("NFC") });
        });
        const g = h.coins[0].mesh.geometry;
        g.computeBoundingBox();
        const box = g.boundingBox!;
        expect(box.max.z - box.min.z).toBeCloseTo(TOKEN.thickness, 6);
        expect(box.max.x - box.min.x).toBeCloseTo(2 * TOKEN.radius, 6);
        expect(box.max.y - box.min.y).toBeCloseTo(2 * TOKEN.radius, 6);
        // Groups: 0 = side (rim), 1/2 = caps (faces).
        const mats = h.coins[0].mesh.material as THREE.MeshLambertMaterial[];
        expect(mats[0].color.getHexString()).toBe(ACCENT.play.slice(1).toLowerCase());
        expect(mats[1].color.getHexString()).toBe(PALETTE.paper.slice(1).toLowerCase());
        expect(mats[2]).toBe(mats[1]);
        // The front cap faces +Z (toward the camera once faceCamera).
        const n = g.getAttribute("normal");
        const pos = g.getAttribute("position");
        let front = 0;
        for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > TOKEN.thickness / 2 - 1e-6 && n.getZ(i) > 0.99) front++;
        expect(front).toBeGreaterThan(TOKEN.segments);
        // One geometry shared by all coins.
        expect(new Set(h.coins.map((c) => c.mesh.geometry)).size).toBe(1);
        h.dispose();
    });

    it("the word is upright Inter Bold 0.42 ink, centred just in front of the face, fitting the coin", () => {
        const s = stubDeps();
        const h = build(s.deps);
        expect(s.texts).toHaveLength(8);
        s.texts.forEach((t, i) => {
            expect(t.opts).toEqual({
                text: yorubaWords[i].word.normalize("NFC"),
                font: CONFIG.type.coinWord.font,
                size: CONFIG.type.coinWord.size,
                color: PALETTE.ink,
                maxWidth: 2 * TOKEN.radius * WORD_FIT,
                anchorX: "center",
                anchorY: "middle",
            });
            const o = t.handle.object;
            expect(o.parent).toBe(h.coins[i].root);
            expect(o.position.toArray()).toEqual([0, 0, TOKEN.wordZ]);
            expect(TOKEN.wordZ).toBeGreaterThan(TOKEN.thickness / 2);
        });
        h.dispose();
    });

    it("update animates visible coins and hides those beyond the cull distance", () => {
        const s = stubDeps();
        const h = build(s.deps);
        const near = TOKENS[0];
        // Car 30 units from token 0: it shows and bobs; tokens > 70 away hide.
        const car = { x: near.x + 30, z: near.z };
        h.update(DT, 0.4, rt(car));
        h.coins.forEach((c, i) => {
            const d = Math.hypot(TOKENS[i].x - car.x, TOKENS[i].z - car.z);
            expect(c.root.visible).toBe(d <= CONFIG.text.cullDistance);
        });
        const pose = coinPose(0, 0.4, false);
        expect(h.coins[0].root.position.y).toBeCloseTo(pose.y, 12);
        expect(h.coins[0].root.rotation.y).toBeCloseTo(pose.yaw, 12);
        expect(s.onCollect).not.toHaveBeenCalled();
        h.dispose();
    });

    it("under reduced motion (read live) the coins hold their rest pose", () => {
        const s = stubDeps();
        const h = build(s.deps);
        const car = { x: TOKENS[0].x + 10, z: TOKENS[0].z };
        const r = rt(car, true);
        for (const t of [0.1, 0.5, 1.7]) {
            h.update(DT, t, r);
            expect(h.coins[0].root.position.y).toBe(TOKEN.y);
            expect(h.coins[0].root.rotation.y).toBe(FACE_CAMERA_Y);
        }
        r.reducedMotion = false;
        h.update(DT, 0.5, r);
        expect(h.coins[0].root.position.y).not.toBe(TOKEN.y);
        h.dispose();
    });

    it("pickup: within 2.8 → onCollect(word, index, event) once, with the running count and toast", () => {
        const s = stubDeps();
        const h = build(s.deps);
        const order = [0, 3, ORE];
        order.forEach((i, n) => {
            h.update(DT, 1, rt({ x: TOKENS[i].x + 2.7, z: TOKENS[i].z }));
            expect(s.onCollect).toHaveBeenCalledTimes(n + 1);
            const [word, index, e] = s.onCollect.mock.calls[n];
            expect(index).toBe(i);
            expect(word).toEqual(h.coins[i].word);
            expect(e).toMatchObject({ index: i, collected: n + 1, total: 8 });
        });
        expect(s.onCollect.mock.calls[2][2].toast).toBe("Ọ̀rẹ́ — Friend · 3 of 8 words".normalize("NFC"));
        expect(h.collectedCount).toBe(3);
        expect(h.coins[ORE].collected).toBe(true);
        expect(s.playUi).toHaveBeenCalledWith("confirm");
        // Staying in range never collects again.
        for (let k = 0; k < 5; k++) h.update(DT, 1 + k * DT, rt({ x: TOKENS[ORE].x, z: TOKENS[ORE].z }));
        expect(s.onCollect).toHaveBeenCalledTimes(3);
        h.dispose();
    });

    it("just outside the radius nothing is collected", () => {
        const s = stubDeps();
        const h = build(s.deps);
        h.update(DT, 1, rt({ x: TOKENS[2].x, z: TOKENS[2].z + TOKEN.pickupRadius + 0.05 }));
        expect(s.onCollect).not.toHaveBeenCalled();
        h.dispose();
    });

    it("a collected coin pops (shrinks and rises) for 0.3 s, then hides; under reduced motion it hides at once", () => {
        const s = stubDeps();
        const h = build(s.deps);
        const at = { x: TOKENS[1].x, z: TOKENS[1].z };
        h.update(DT, 1, rt(at));
        const c = h.coins[1];
        h.update(COLLECT_POP_S / 2, 1.1, rt(at));
        expect(c.root.visible).toBe(true);
        expect(c.root.scale.x).toBeLessThan(1);
        expect(c.root.position.y).toBeGreaterThan(TOKEN.y);
        h.update(COLLECT_POP_S, 1.5, rt(at));
        expect(c.root.visible).toBe(false);

        const r = stubDeps();
        const k = build(r.deps);
        k.update(DT, 1, rt({ x: TOKENS[4].x, z: TOKENS[4].z }, true));
        expect(k.coins[4].root.visible).toBe(false);
        expect(r.onCollect).toHaveBeenCalledTimes(1);
        // It stays hidden even when the car leaves and comes back.
        k.update(DT, 2, rt({ x: TOKENS[4].x + 10, z: TOKENS[4].z }));
        expect(k.coins[4].root.visible).toBe(false);
        h.dispose();
        k.dispose();
    });

    it("reset brings every coin back uncollected", () => {
        const s = stubDeps();
        const h = build(s.deps);
        h.update(DT, 1, rt({ x: TOKENS[6].x, z: TOKENS[6].z }, true));
        expect(h.collectedCount).toBe(1);
        h.reset();
        expect(h.collectedCount).toBe(0);
        for (const c of h.coins) {
            expect(c.collected).toBe(false);
            expect(c.root.visible).toBe(true);
            expect(c.root.scale.x).toBe(1);
        }
        h.update(DT, 2, rt({ x: TOKENS[6].x, z: TOKENS[6].z }, true));
        expect(s.onCollect).toHaveBeenCalledTimes(2);
        h.dispose();
    });

    it("dispose frees the labels and the shared geometry once, detaches the group; update is a no-op after", () => {
        const s = stubDeps();
        const h = build(s.deps);
        const parent = new THREE.Group().add(h.group);
        const geo = vi.spyOn(h.coins[0].mesh.geometry, "dispose");
        const coin = h.coins[0];
        h.dispose();
        h.dispose();
        expect(geo).toHaveBeenCalledTimes(1);
        for (const t of s.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
        expect(parent.children).toHaveLength(0);
        expect(h.group.children).toHaveLength(0);
        h.update(DT, 1, rt({ x: coin.position.x, z: coin.position.z }));
        expect(s.onCollect).not.toHaveBeenCalled();
    });

    it("a label that throws frees the labels already built and rethrows", () => {
        const s = stubDeps({ textAt: 3 });
        expect(() => build(s.deps)).toThrow("text failed");
        expect(s.texts).toHaveLength(3);
        for (const t of s.texts) expect(t.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it("words already collected (any normalisation) start taken and hidden, and count toward the total", () => {
        const s = stubDeps();
        const taken = [yorubaWords[ORE].word.normalize("NFD"), yorubaWords[2].word];
        const h = build({ ...s.deps, collected: taken });
        expect(h.collectedCount).toBe(2);
        expect(h.coins[ORE].collected).toBe(true);
        expect(h.coins[ORE].root.visible).toBe(false);
        expect(h.coins[2].collected).toBe(true);
        // Driving through a taken coin never collects it; the next new one is "3 of 8".
        h.update(DT, 1, rt({ x: TOKENS[ORE].x, z: TOKENS[ORE].z }));
        expect(h.coins[ORE].root.visible).toBe(false);
        expect(s.onCollect).not.toHaveBeenCalled();
        h.update(DT, 1, rt({ x: TOKENS[0].x, z: TOKENS[0].z }));
        expect(s.onCollect.mock.calls[0][2]).toMatchObject({ index: 0, collected: 3, total: 8 });
        h.dispose();
    });

    it("custom words / positions pair by index and the total is the shorter list", () => {
        const s = stubDeps();
        const h = build({ ...s.deps, words: yorubaWords.slice(0, 3), positions: TOKENS });
        expect(h.total).toBe(3);
        expect(h.coins.map((c) => c.position)).toEqual(TOKENS.slice(0, 3));
        h.dispose();
    });
});

describe("Collectibles — storeCollector (store wiring)", () => {
    it("sets wordsTotal, appends each word once, and shows the toast", () => {
        const store = new WorldStore();
        const onCollect = storeCollector(store);
        expect(store.snapshot.wordsTotal).toBe(8);
        const s = stubDeps();
        const h = build({ ...s.deps, onCollect });
        for (const i of [0, 3, ORE]) h.update(DT, 1, rt({ x: TOKENS[i].x, z: TOKENS[i].z }));
        expect(store.snapshot.words.map((w) => w.meaning)).toEqual([
            yorubaWords[0].meaning,
            yorubaWords[3].meaning,
            "Friend",
        ]);
        expect(store.snapshot.words[2]).toEqual({ ...yorubaWords[ORE], word: yorubaWords[ORE].word.normalize("NFC") });
        expect(store.snapshot.toast?.text).toBe("Ọ̀rẹ́ — Friend · 3 of 8 words".normalize("NFC"));
        // A reset world collecting the same word again never duplicates the glossary
        // entry, and the toast counts the glossary (3), not the reset coins (1).
        const toastId = store.snapshot.toast!.id;
        h.reset();
        h.update(DT, 2, rt({ x: TOKENS[0].x, z: TOKENS[0].z }));
        expect(store.snapshot.words).toHaveLength(3);
        expect(store.snapshot.toast!.id).toBeGreaterThan(toastId);
        expect(store.snapshot.toast!.text).toBe(collectToast(yorubaWords[0], 3, 8));
        h.dispose();
        // A world rebuilt against the same store starts with the glossary's coins taken.
        const k = build({ ...stubDeps().deps, onCollect, collected: store.snapshot.words.map((w) => w.word) });
        expect(k.collectedCount).toBe(3);
        k.update(DT, 3, rt({ x: TOKENS[1].x, z: TOKENS[1].z }));
        expect(store.snapshot.words).toHaveLength(4);
        expect(store.snapshot.toast!.text).toBe(collectToast(yorubaWords[1], 4, 8));
        k.dispose();
    });
});
