import * as THREE from "three";
import { FontLoader, type Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, type Vec3Like } from "../Config";
import type { Letter3D, MaterialsApi, PhysicsApi, QuatLike, Text3DApi, Word3D, Word3DOptions } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Tier-A text (§3.3): extruded Bricolage ExtraBold letters (FontLoader +
// TextGeometry from three/addons; never TTFLoader, which pulls opentype.js from
// a CDN in r186).
//
// - size = cap / capRatio, capRatio = the 'H' glyph's bbox height / resolution.
// - One geometry per distinct letter, reused for repeats.
// - BASELINE PRESERVED: each letter geometry is centred in X and Z only; y = 0
//   stays the baseline. Never geometry.center() (it drops J/Q/È off the line).
// - Tracking 0.06 em between letters; the word is centred on its ink extents.
// - Colliders: a cuboid from the letter's bbox, offset by the bbox centre's y;
//   the body origin stays at the letter's baseline position. Dynamic words
//   (hero word, PLAY) are lifted by the bevel size so their colliders rest on
//   the ground (one shared baseline); static titles get fixed cuboids.
//
// PLACEMENT: `word()` builds the letters in the group's local frame (reading
// along +X, facing +Z). The caller positions/rotates `group` (e.g. rotation.y =
// FACE_CAMERA_Y) and adds it under the scene. Colliders need world poses, so a
// word is "armed" once: on its first world-matrix update inside a Scene (the
// first render) or on the first reset(), whichever comes first. Arming reads
// the group's world transform once. For DYNAMIC words it then bakes that
// transform into the letters and makes the group's world transform identity,
// so physics-driven letters (written in world space) render correctly under any
// Physics.interpolate implementation. Until armed, dynamic bodies are disabled.
// RULE: place the group (and its parents) before the first render or reset(),
// and never move it afterwards; dev builds warn once if it moves. Call reset()
// right after placing an area's words to arm them deterministically, without
// relying on a render before the first physics step.
// ─────────────────────────────────────────────────────────────────────────

const TY = CONFIG.type;
const LETTER = CONFIG.physics.dynamicLetter;

/** Glyph used when a character is missing from the typeface (three's own fallback). */
const MISSING_GLYPH = "?";
/** Glyph whose bbox height defines the cap height. */
const CAP_GLYPH = "H";
/** Attempts after the first failed typeface fetch (§6.2: retry once). */
const TYPEFACE_RETRIES = 1;
/** Per-element tolerance when checking that an armed word's group has not moved. */
const MOVED_EPSILON = 1e-6;
const DEV = process.env.NODE_ENV !== "production";

/** A typeface JSON glyph (three's FontLoader format). */
export interface TypefaceGlyph {
    ha: number;
    x_min: number;
    x_max: number;
    o?: string;
}

/** The parts of a typeface JSON the layout maths reads. */
export interface TypefaceData {
    glyphs: Record<string, TypefaceGlyph>;
    resolution: number;
}

/** Glyph metrics in typeface units (y-up, baseline at 0). */
export interface GlyphMetrics {
    advance: number;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
}

/** Number of coordinate pairs each outline command carries. */
const OUTLINE_ARGS: Readonly<Record<string, number>> = { m: 1, l: 1, q: 2, b: 3 };

/**
 * Reads a glyph's metrics from its outline. Bounds include curve control points,
 * which bound the curve (exact for line-only glyphs such as H).
 */
export function glyphMetrics(data: TypefaceData, ch: string): GlyphMetrics | null {
    const g = data.glyphs[ch];
    if (!g) return null;
    let yMin = Infinity;
    let yMax = -Infinity;
    const parts = (g.o ?? "").split(" ").filter(Boolean);
    for (let i = 0; i < parts.length; ) {
        const pairs = OUTLINE_ARGS[parts[i++]] ?? 0;
        for (let p = 0; p < pairs; p++) {
            const y = Number(parts[i + 1]);
            i += 2;
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        }
    }
    if (yMin === Infinity) yMin = yMax = 0;
    return { advance: g.ha, xMin: g.x_min, xMax: g.x_max, yMin, yMax };
}

/** Cap height / em, measured from the 'H' glyph (fallback CONFIG.type.capRatioFallback). */
export function capRatio(data: TypefaceData): number {
    const m = glyphMetrics(data, CAP_GLYPH);
    const r = m ? (m.yMax - m.yMin) / data.resolution : 0;
    return r > 0 ? r : TY.capRatioFallback;
}

/** TextGeometry `size` (= 1 em) that gives the requested cap height. */
export function sizeForCap(data: TypefaceData, cap: number): number {
    return cap / capRatio(data);
}

export interface LetterSlot {
    char: string;
    /** Pen x of the glyph origin, relative to the word's ink centre (world units). */
    penX: number;
    /** Ink centre x (pen + glyph bbox centre), relative to the word's ink centre. */
    inkCenterX: number;
}

export interface WordLayout {
    slots: LetterSlot[];
    /** Ink width (first glyph's left edge to last glyph's right edge). */
    width: number;
    size: number;
}

/**
 * Lays a word out along +X: advance = (ha / resolution + tracking) · size, the
 * whole word centred on its ink extents. Spaces advance but get no slot. Every
 * letter sits on the same baseline (y = 0); nothing here moves glyphs in y.
 */
export function layoutWord(data: TypefaceData, text: string, size: number, tracking: number = TY.tracking): WordLayout {
    const scale = size / data.resolution;
    const slots: LetterSlot[] = [];
    let pen = 0;
    let left = Infinity;
    let right = -Infinity;
    for (const raw of Array.from(text.normalize("NFC"))) {
        const ch = data.glyphs[raw] ? raw : MISSING_GLYPH;
        const g = data.glyphs[ch];
        if (raw.trim() !== "" && g) {
            const inkL = pen + g.x_min * scale;
            const inkR = pen + g.x_max * scale;
            left = Math.min(left, inkL);
            right = Math.max(right, inkR);
            slots.push({ char: ch, penX: pen, inkCenterX: (inkL + inkR) / 2 });
        }
        pen += ((g?.ha ?? 0) / data.resolution + tracking) * size;
    }
    if (slots.length === 0) return { slots, width: 0, size };
    const mid = (left + right) / 2;
    for (const s of slots) {
        s.penX -= mid;
        s.inkCenterX -= mid;
    }
    return { slots, width: right - left, size };
}

export interface LetterGeometryOptions {
    size: number;
    depth: number;
    curveSegments: number;
}

export interface LetterGeometry {
    /** Centred in X and Z; y untouched (baseline at y = 0). */
    geometry: THREE.BufferGeometry;
    /** Bounding box after the X/Z centring. */
    box: THREE.Box3;
    /** The X shift removed from the raw geometry (the glyph's bbox centre x). */
    centerX: number;
}

/** Builds one extruded letter with the §3.3 bevel, centred in X/Z only. */
export function buildLetterGeometry(font: Font, ch: string, o: LetterGeometryOptions): LetterGeometry {
    const B = TY.bevel;
    const geometry = new TextGeometry(ch, {
        font,
        size: o.size,
        depth: o.depth,
        curveSegments: o.curveSegments,
        bevelEnabled: true,
        bevelThickness: B.thickness,
        bevelSize: B.size,
        bevelOffset: 0,
        bevelSegments: B.segments,
    });
    geometry.computeBoundingBox();
    const raw = geometry.boundingBox!;
    const cx = (raw.min.x + raw.max.x) / 2;
    const cz = (raw.min.z + raw.max.z) / 2;
    // X/Z only — y = 0 stays the baseline (never geometry.center()).
    geometry.translate(-cx, 0, -cz);
    geometry.computeBoundingBox();
    return { geometry, box: geometry.boundingBox!.clone(), centerX: cx };
}

/** Loads the Bricolage typeface JSON (CONFIG.text.typeface3D), retrying once (§6.2). */
export async function loadTypeface(url: string = CONFIG.text.typeface3D, retries: number = TYPEFACE_RETRIES): Promise<Font> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await new FontLoader().loadAsync(url);
        } catch (e) {
            if (attempt >= retries) throw e;
        }
    }
}

/** Parses an already-fetched typeface JSON (tests, preloaded data). */
export function parseTypeface(json: unknown): Font {
    return new FontLoader().parse(json as FontData);
}

/**
 * Dynamic letter factory and body removal. W1-A's Physics class provides both
 * (it registers the letter's impact sound and CONFIG.physics.dynamicLetter
 * defaults, and removeBody forgets the colliders' impact sources so a reused
 * Rapier handle never inherits a letter's impact sound); neither is on the
 * frozen PhysicsApi yet (see the W1-B report).
 */
export interface DynamicLetterFactory {
    removeBody(body: RAPIER.RigidBody): void;
    addDynamicLetter(
        halfExtents: Vec3Like,
        pos: Vec3Like,
        opts: {
            offset: Vec3Like;
            mass?: number;
            quat?: QuatLike;
            friction?: number;
            restitution?: number;
            linearDamping?: number;
            angularDamping?: number;
        }
    ): RAPIER.RigidBody;
}

export interface Text3DDeps {
    font: Font;
    materials: MaterialsApi;
    physics: PhysicsApi & DynamicLetterFactory;
}

/** Text3DApi plus teardown of the shared letter geometries. */
export interface Text3DSystem extends Text3DApi {
    word(text: string, opts: Word3DOptions): Word3D & { dispose(): void };
    dispose(): void;
}

interface LetterRecord {
    letter: Letter3D;
    /** Collider half extents and centre (letter-local; x/z centred). */
    half: Vec3Like;
    centerY: number;
    fixedBody?: RAPIER.RigidBody;
}

const matricesClose = (a: THREE.Matrix4, b: THREE.Matrix4): boolean =>
    a.elements.every((v, i) => Math.abs(v - b.elements[i]) <= MOVED_EPSILON);

const isInScene = (obj: THREE.Object3D): boolean => {
    let o: THREE.Object3D | null = obj.parent;
    while (o) {
        if ((o as THREE.Scene).isScene) return true;
        o = o.parent;
    }
    return false;
};

/** Creates the Text3DApi handed to areas (AreaContext.text3d). */
export function createText3D(deps: Text3DDeps): Text3DSystem {
    const data = deps.font.data as unknown as TypefaceData;
    const geometries = new Map<string, LetterGeometry>();
    const words = new Set<{ dispose(): void }>();

    const letterGeometry = (ch: string, o: LetterGeometryOptions): LetterGeometry => {
        const key = `${ch}|${o.size}|${o.depth}|${o.curveSegments}`;
        let g = geometries.get(key);
        if (!g) {
            g = buildLetterGeometry(deps.font, ch, o);
            geometries.set(key, g);
        }
        return g;
    };

    const word = (text: string, opts: Word3DOptions): Word3D & { dispose(): void } => {
        const size = sizeForCap(data, opts.cap);
        const layout = layoutWord(data, text, size);
        const material = deps.materials.lambert(opts.color);
        const group = new THREE.Group();
        group.name = `word3d:${text}`;
        const records: LetterRecord[] = [];
        // Dynamic words sit on the ground: lifted by the bevel that extends
        // below the baseline of flat-bottomed glyphs. Static titles keep y = 0.
        const lift = opts.dynamic ? TY.bevel.size : 0;

        for (const slot of layout.slots) {
            const lg = letterGeometry(slot.char, { size, depth: opts.depth, curveSegments: opts.curveSegments });
            const mesh = new THREE.Mesh(lg.geometry, material);
            mesh.name = `letter:${slot.char}`;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            // Glyph back at its pen position, every letter on ONE baseline.
            mesh.position.set(slot.penX + lg.centerX, lift, 0);
            group.add(mesh);
            // Dynamic colliders stop at the bevel line so they rest on the
            // ground; overshoots and tails (J, Q) may dip into it visually.
            const minY = opts.dynamic ? Math.max(lg.box.min.y, -lift) : lg.box.min.y;
            const half = {
                x: (lg.box.max.x - lg.box.min.x) / 2,
                y: (lg.box.max.y - minY) / 2,
                z: (lg.box.max.z - lg.box.min.z) / 2,
            };
            const centerY = (lg.box.max.y + minY) / 2;
            const letter: Letter3D = {
                mesh,
                home: { position: mesh.position.clone(), quaternion: mesh.quaternion.clone() },
            };
            if (opts.dynamic) {
                const body = deps.physics.addDynamicLetter(half, mesh.position, {
                    offset: { x: 0, y: centerY, z: 0 },
                    mass: opts.mass ?? LETTER.mass,
                    friction: LETTER.friction,
                    restitution: LETTER.restitution,
                    linearDamping: LETTER.linearDamping,
                    angularDamping: LETTER.angularDamping,
                });
                body.setEnabled(false); // until armed with its world pose
                deps.physics.link(body, mesh);
                letter.body = body;
            }
            records.push({ letter, half, centerY });
        }

        /** Moves every dynamic body to its home pose and snaps the interpolation. */
        const place = () => {
            for (const r of records) {
                const { body, home, mesh } = r.letter;
                if (!body) continue;
                body.setTranslation(home.position, true);
                body.setRotation(home.quaternion, true);
                body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                body.setAngvel({ x: 0, y: 0, z: 0 }, true);
                deps.physics.snap(body);
                mesh.position.copy(home.position);
                mesh.quaternion.copy(home.quaternion);
            }
        };

        let armed = false;
        const tmpM = new THREE.Matrix4();
        const tmpL = new THREE.Matrix4();
        const tmpS = new THREE.Vector3();
        const tmpP = new THREE.Vector3();
        const tmpQ = new THREE.Quaternion();

        const arm = () => {
            if (armed) return;
            armed = true;
            group.updateWorldMatrix(true, false);
            const world = group.matrixWorld.clone();
            for (const r of records) {
                const h = r.letter.home;
                tmpL.compose(h.position, h.quaternion, tmpS.set(1, 1, 1));
                tmpM.multiplyMatrices(world, tmpL).decompose(tmpP, tmpQ, tmpS);
                if (opts.dynamic) {
                    // Dynamic homes become world poses (the group turns into identity below).
                    h.position.copy(tmpP);
                    h.quaternion.copy(tmpQ);
                } else {
                    // Static letters stay local under the placed group; only the
                    // fixed collider needs the world pose.
                    r.fixedBody = deps.physics.addFixedCuboid(r.half, tmpP, tmpQ, { x: 0, y: r.centerY, z: 0 });
                }
            }
            if (opts.dynamic) {
                // Make the group's WORLD transform identity: letters are then
                // positioned directly in world space (physics writes world poses).
                const parentWorld = group.parent ? group.parent.matrixWorld : new THREE.Matrix4();
                tmpM.copy(parentWorld).invert().decompose(group.position, group.quaternion, group.scale);
                group.updateMatrix();
                for (const r of records) {
                    r.letter.mesh.position.copy(r.letter.home.position);
                    r.letter.mesh.quaternion.copy(r.letter.home.quaternion);
                    r.letter.body!.setEnabled(true);
                }
                place();
            }
        };

        // Arm on the first render (the renderer updates world matrices from the
        // Scene down, visible or not), once the group is placed in a Scene.
        // Dev builds warn once if the group (or a parent) moves after arming:
        // colliders and baked dynamic homes keep the armed pose.
        const baseUpdate = group.updateMatrixWorld.bind(group);
        const armedWorld = new THREE.Matrix4();
        let movedWarned = false;
        group.updateMatrixWorld = (force?: boolean) => {
            baseUpdate(force);
            if (!armed && isInScene(group)) {
                arm();
                baseUpdate(true);
                armedWorld.copy(group.matrixWorld);
            } else if (DEV && armed && !movedWarned && !matricesClose(group.matrixWorld, armedWorld)) {
                movedWarned = true;
                console.warn(
                    `[world3/text3d] "${text}" moved after its colliders were armed; ` +
                        "place a word's group before the first render or reset() and never move it afterwards"
                );
            }
        };

        let disposed = false;
        const handle = {
            group,
            letters: records.map((r) => r.letter),
            reset() {
                if (disposed) return;
                if (!armed) {
                    arm();
                    baseUpdate(true);
                    armedWorld.copy(group.matrixWorld);
                    return;
                }
                place();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                words.delete(handle);
                for (const r of records) {
                    // removeBody also unlinks and drops the impact sources.
                    const body = r.letter.body ?? r.fixedBody;
                    if (body) deps.physics.removeBody(body);
                }
                group.removeFromParent();
            },
        };
        words.add(handle);
        return handle;
    };

    return {
        word,
        dispose() {
            for (const w of Array.from(words)) w.dispose();
            for (const g of geometries.values()) g.geometry.dispose();
            geometries.clear();
        },
    };
}
