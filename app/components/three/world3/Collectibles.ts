import * as THREE from "three";
import { yorubaWords, type YorubaWord } from "@/app/field/content/world";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "./Config";
import { TOKEN, TOKENS } from "./Layout";
import type { GlossaryWord, WorldStore } from "./State";
import type { AudioApi, MaterialsApi, RuntimeInfo, TextApi, TextHandle, XZ } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Collectibles: the eight Yoruba-word coins (§2.7 item 5, §5.2 "Coins").
//
// - One coin per Layout.TOKENS point, paired in order with content
//   `yorubaWords`: Cylinder(1.1, 1.1, 0.28, 40) turned so its axis is local Z,
//   paper faces with a play-yellow (#F6C21C) rim, faceCamera.
// - The word is upright troika text through the shared TextApi (Inter Bold
//   0.42, ink) just in front of the face (local z +0.15), so the look's colour
//   swap reaches it like any other in-world text. Yoruba is Inter only (§3.2).
// - Motion: bob 0.3 at 1.2 Hz plus a ±20° yaw wobble (never a full spin, so
//   the word stays readable); phases are staggered per coin. Under reduced
//   motion (read live from the runtime) the coins hold still (§9.4) and a
//   pickup hides the coin at once.
// - Pickup: the car centre within 2.8 (ground distance) collects the coin. It
//   pops away and `onCollect(word, index, event)` fires once; the event carries
//   the running count and the toast text `Ọ̀rẹ́ — Friend · 3 of 8 words`.
//   `storeCollector(store)` is the store wiring (words list for the Menu →
//   Words glossary, wordsTotal, toast); the integrator passes it as `onCollect`,
//   and `collected: store.snapshot.words.map((w) => w.word)` so a world built
//   against a store that already holds words starts with those coins taken.
// - Coins further than CONFIG.text.cullDistance from the car are hidden and not
//   animated (they belong to no area, so Areas' culling never reaches them).
// ─────────────────────────────────────────────────────────────────────────

/** Yaw wobble rate (Hz): slower than the bob so the two never lock together. */
const WOBBLE_HZ = 0.45;
/** Per-coin phase step (radians, the golden angle) so neighbouring coins never move in sync. */
const PHASE_STEP = 2.39996;
/** The word fits inside this share of the coin's diameter. */
export const WORD_FIT = 0.8;
/** Pickup pop: duration (s) and rise (world units) while the coin shrinks away. */
export const COLLECT_POP_S = 0.3;
const COLLECT_RISE = 1.2;

const TAU = Math.PI * 2;
const WOBBLE_RAD = THREE.MathUtils.degToRad(TOKEN.wobbleDeg);

/** What a pickup reports besides the word and the coin index. */
export interface CollectEvent {
    /** The glossary entry (NFC). */
    word: GlossaryWord;
    /** Coin index (0-based, Layout.TOKENS order). */
    index: number;
    /** Coins collected so far, this one included. */
    collected: number;
    total: number;
    /** `Ọ̀rẹ́ — Friend · 3 of 8 words`. */
    toast: string;
}

export type CollectCallback = (word: GlossaryWord, index: number, event: CollectEvent) => void;

export interface CollectiblesDeps {
    materials: MaterialsApi;
    text: TextApi;
    /** Called once per pickup (the integrator passes `storeCollector(store)`). */
    onCollect?: CollectCallback;
    /** Optional pickup chime (`playUi("confirm")`). */
    audio?: Pick<AudioApi, "playUi">;
    /** Defaults: content `yorubaWords` at Layout `TOKENS` (paired by index). */
    words?: readonly YorubaWord[];
    positions?: readonly XZ[];
    /** Words already collected (e.g. the store's glossary): those coins start taken and hidden. */
    collected?: readonly string[];
}

export interface Coin {
    index: number;
    word: GlossaryWord;
    position: XZ;
    /** The coin root: placed at the token, bobbed and wobbled about its centre. */
    root: THREE.Group;
    mesh: THREE.Mesh;
    label: TextHandle;
    readonly collected: boolean;
}

export interface CollectiblesHandle {
    group: THREE.Group;
    coins: readonly Coin[];
    readonly total: number;
    readonly collectedCount: number;
    /** Animates, culls and checks pickups (call every unpaused frame with the shared runtime). */
    update(dt: number, t: number, rt: RuntimeInfo): void;
    /** Brings every coin back (uncollected). Does not touch the store. */
    reset(): void;
    dispose(): void;
}

// ── Pure helpers (exported for tests) ────────────────────────────────────
/** Toast text for a pickup: `Ọ̀rẹ́ — Friend · 3 of 8 words`. */
export function collectToast(word: Pick<GlossaryWord, "word" | "meaning">, collected: number, total: number): string {
    return `${word.word.normalize("NFC")} — ${word.meaning} · ${collected} of ${total} words`;
}

/** Bob height + wobble yaw of coin `index` at time `t` (static under reduced motion). */
export function coinPose(index: number, t: number, reducedMotion: boolean): { y: number; yaw: number } {
    if (reducedMotion) return { y: TOKEN.y, yaw: FACE_CAMERA_Y };
    const phase = index * PHASE_STEP;
    return {
        y: TOKEN.y + TOKEN.bob * Math.sin(TAU * TOKEN.bobHz * t + phase),
        yaw: FACE_CAMERA_Y + WOBBLE_RAD * Math.sin(TAU * WOBBLE_HZ * t + phase),
    };
}

/** True when the car centre is within the pickup radius of a token (ground distance). */
export function inPickupRange(token: XZ, carX: number, carZ: number): boolean {
    return Math.hypot(carX - token.x, carZ - token.z) <= TOKEN.pickupRadius;
}

/** Number of coins built for the default content (min of words and tokens). */
export const defaultTotal = (): number => Math.min(TOKENS.length, yorubaWords.length);

/**
 * The store wiring for `onCollect`: sets `wordsTotal` now, then on each pickup
 * appends the word to `words` (the Menu → Words glossary; never twice) and
 * shows the toast. The toast counts the glossary, so it always agrees with the
 * Words tab (even after the coins were reset).
 */
export function storeCollector(store: WorldStore, total: number = defaultTotal()): CollectCallback {
    store.set({ wordsTotal: total });
    return (word, _index, e) => {
        const words = store.snapshot.words;
        const next = words.some((w) => w.word === word.word) ? words : [...words, word];
        store.set({ words: next, wordsTotal: e.total });
        store.showToast(collectToast(word, next.length, e.total));
    };
}

// ── Builder ──────────────────────────────────────────────────────────────
interface CoinState extends Coin {
    collected: boolean;
    /** Seconds into the pickup pop (null when not popping). */
    pop: number | null;
}

export function build(deps: CollectiblesDeps): CollectiblesHandle {
    const words = deps.words ?? yorubaWords;
    const positions = deps.positions ?? TOKENS;
    const total = Math.min(words.length, positions.length);
    const already = new Set((deps.collected ?? []).map((w) => w.normalize("NFC")));
    const T = TOKEN;
    const TY = CONFIG.type.coinWord;
    const cullDistance = CONFIG.text.cullDistance;

    const group = new THREE.Group();
    group.name = "collectibles";
    const geometry = new THREE.CylinderGeometry(T.radius, T.radius, T.thickness, T.segments);
    // Axis along local Z: the top cap becomes the front face (+Z), toward the camera.
    geometry.rotateX(Math.PI / 2);
    const paper = deps.materials.lambert(PALETTE.paper);
    // CylinderGeometry groups: 0 = side (the rim), 1 = top cap, 2 = bottom cap.
    const faces: THREE.Material[] = [deps.materials.lambert(ACCENT.play), paper, paper];

    const coins: CoinState[] = [];
    let collectedCount = 0;
    let disposed = false;

    const release = () => {
        for (const c of coins) c.label.dispose();
        coins.length = 0;
        geometry.dispose();
        group.clear();
        group.removeFromParent();
    };

    try {
        for (let i = 0; i < total; i++) {
            const src = words[i];
            const word: GlossaryWord = { word: src.word.normalize("NFC"), meaning: src.meaning };
            if (src.pron) word.pron = src.pron;
            const position = positions[i];

            const root = new THREE.Group();
            root.name = `coin:${word.word}`;
            root.position.set(position.x, T.y, position.z);
            root.rotation.y = FACE_CAMERA_Y;

            const mesh = new THREE.Mesh(geometry, faces);
            mesh.name = "coin";
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.raycast = () => {};
            root.add(mesh);

            // Inter Bold: Yoruba is never set in the display face (§3.4 item 8).
            const label = deps.text.upright({
                text: word.word,
                font: TY.font,
                size: TY.size,
                color: PALETTE.ink,
                maxWidth: 2 * T.radius * WORD_FIT,
                anchorX: "center",
                anchorY: "middle",
            });
            label.object.position.set(0, 0, T.wordZ);
            root.add(label.object);

            group.add(root);
            const taken = already.has(word.word);
            if (taken) {
                root.visible = false;
                collectedCount++;
            }
            coins.push({ index: i, word, position, root, mesh, label, collected: taken, pop: null });
        }
    } catch (err) {
        release();
        throw err;
    }

    const collect = (c: CoinState, reducedMotion: boolean) => {
        c.collected = true;
        collectedCount++;
        if (reducedMotion) c.root.visible = false;
        else c.pop = 0;
        deps.audio?.playUi("confirm");
        const event: CollectEvent = {
            word: { ...c.word },
            index: c.index,
            collected: collectedCount,
            total,
            toast: collectToast(c.word, collectedCount, total),
        };
        deps.onCollect?.(event.word, c.index, event);
    };

    return {
        group,
        coins,
        total,
        get collectedCount() {
            return collectedCount;
        },
        update(dt: number, t: number, rt: RuntimeInfo) {
            if (disposed) return;
            for (const c of coins) {
                if (c.pop !== null) {
                    // Pickup pop: shrink and rise, then hide.
                    c.pop += dt;
                    const k = Math.min(c.pop / COLLECT_POP_S, 1);
                    if (k >= 1 || rt.reducedMotion) {
                        c.root.visible = false;
                        c.pop = null;
                        continue;
                    }
                    c.root.scale.setScalar(1 - k);
                    c.root.position.y = T.y + COLLECT_RISE * k;
                    continue;
                }
                if (c.collected) continue;
                const dx = rt.carPos.x - c.position.x;
                const dz = rt.carPos.z - c.position.z;
                c.root.visible = Math.hypot(dx, dz) <= cullDistance;
                if (!c.root.visible) continue;
                const pose = coinPose(c.index, t, rt.reducedMotion);
                c.root.position.y = pose.y;
                c.root.rotation.y = pose.yaw;
                if (inPickupRange(c.position, rt.carPos.x, rt.carPos.z)) collect(c, rt.reducedMotion);
            }
        },
        reset() {
            if (disposed) return;
            collectedCount = 0;
            for (const c of coins) {
                c.collected = false;
                c.pop = null;
                c.root.visible = true;
                c.root.scale.setScalar(1);
                c.root.position.y = T.y;
                c.root.rotation.y = FACE_CAMERA_Y;
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            release();
        },
    };
}
