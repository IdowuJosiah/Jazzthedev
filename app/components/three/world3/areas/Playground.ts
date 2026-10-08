import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { ACCENT, CONFIG, FACE_CAMERA_Y, PALETTE } from "../Config";
import { registerArea } from "../Areas";
import { buildOwnedPathLabels } from "../Paths";
import { buildPad, type PadVisual } from "../ui3d/Pad";
import type { AreaContext, AreaHandle, PadDef, Prompt, QuatLike, TextHandle, Vec3Like, Word3D } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Playground (§2.4). Everything comes from Layout (AREA_LAYOUT.playground,
// the playground AreaDef, PADS["reset"]):
//
// - PLAY: DYNAMIC Bricolage letters in ink (area-title size), centred on the
//   title point, faceCamera. Areas arms the word when this builder returns.
// - Ramp: a 10 (x) × 8 (z) × 2.4 wedge prism rising toward −X (low edge at
//   x −79, lip at x −89) in the play accent (#F6C21C), three flush ink
//   chevrons pointing −X on its slope, and ONE fixed convex-hull collider of
//   its 6 vertices (addFixedConvexHull). It is the only thing built inside
//   RAMP_CORRIDOR (run-up + landing stay clear).
// - Bowling lane: a flush plaza strip on the plates layer, the ink ball
//   (r 1.3, mass 140) and 10 Lathe pins (paper with a brand band, cylinder
//   colliders r 0.42, mass 8) in the Layout triangle (apex east).
// - Brick wall: running bond, 26 full + 6 half bricks (32 bodies) along R,
//   front facing the camera.
// - RESET pad: its interaction calls commands.resetPlayground() (→ Areas →
//   reset() here); reset() puts the bricks, pins, ball and PLAY home and
//   snaps every body (physics.snap), so nothing interpolates across the jump.
//
// Repeated props are instanced (§9.2): one InstancedMesh per brick size and
// per pin part. Each body is linked to an unparented proxy Object3D (the
// physics interpolation writes its world pose there) and update() copies the
// proxies into the instance matrices. The ball is a plain linked mesh.
//
// Impact sounds: every body here registers an impact family (CONFIG.physics.
// dynamicDefaults: bricks / pins "wood", ball "heavy"). The Experience routes
// physics.onImpact → audio.playImpact for every prop in the world, so this
// area does not subscribe again (a second subscription would double each hit).
// Nothing here animates on its own, so reduced motion has nothing to stop.
// ─────────────────────────────────────────────────────────────────────────

/** Prompt card for the reset pad (`E  Playground — Reset`). */
const RESET_PROMPT: Prompt = { title: "Playground", action: "Reset" };
/** Lane strip corner radius. */
const LANE_CORNER = 0.5;
/** Ball tessellation. */
const BALL_SEGMENTS = { width: 32, height: 16 } as const;
/** Lathe segments around a pin. */
const PIN_RADIAL_SEGMENTS = 20;
/**
 * Pin silhouette as (radius / pin radius, height / pin height), bottom to top:
 * flat base, belly, neck, head, rounded top. The band (brand red) runs over
 * the neck, between profile points PIN_BAND[0] and PIN_BAND[1].
 */
const PIN_PROFILE: readonly (readonly [number, number])[] = [
    [0, 0],
    [0.55, 0],
    [0.68, 0.03],
    [0.88, 0.12],
    [1, 0.25],
    [0.9, 0.38],
    [0.62, 0.5],
    [0.42, 0.6],
    [0.38, 0.66],
    [0.4, 0.72],
    [0.55, 0.8],
    [0.58, 0.88],
    [0.45, 0.95],
    [0.2, 0.99],
    [0, 1],
];
const PIN_BAND = [7, 9] as const;
/**
 * Ramp chevrons, in slope units: each is a "<" of two arms meeting at a tip
 * pointing up the slope (−X). `depth` runs along the slope, `halfSpan` across
 * it (z), `thickness` is the arm width along the slope, `spacing` the pitch
 * between chevrons and `lift` the offset above the slope (plus the plate
 * layer's polygonOffset) so they never z-fight with the ramp face.
 */
const CHEVRON = { depth: 1.5, halfSpan: 2.6, thickness: 0.65, spacing: 2.6, lift: 0.012 } as const;

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO_V: Vec3Like = Object.freeze({ x: 0, y: 0, z: 0 });
const IDENTITY_QUAT: QuatLike = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** One physics-driven prop: its body, home pose and the object the interpolation writes. */
export interface PlaygroundProp {
    body: RAPIER.RigidBody;
    /** The ball mesh, or an unparented proxy for an instanced brick / pin. */
    object: THREE.Object3D;
    home: { position: THREE.Vector3; quaternion: THREE.Quaternion };
}

/** An instanced prop family: proxies[i] drives instance i of every mesh. */
interface InstancedFamily {
    meshes: THREE.InstancedMesh[];
    props: PlaygroundProp[];
}

export interface PlaygroundHandle extends AreaHandle {
    /** The PLAY word (null only if the AreaDef carries no title3D). */
    play: Word3D | null;
    ramp: { mesh: THREE.Mesh; chevrons: THREE.Mesh; collider: RAPIER.RigidBody };
    lane: THREE.Mesh;
    ball: PlaygroundProp;
    pins: PlaygroundProp[];
    bricks: PlaygroundProp[];
    /** Full-brick, half-brick, pin-body and pin-band instanced meshes. */
    instanced: { fullBricks: THREE.InstancedMesh; halfBricks: THREE.InstancedMesh; pinBodies: THREE.InstancedMesh; pinBands: THREE.InstancedMesh };
    resetPad: PadVisual;
    pathLabels: TextHandle[];
    /** Copies the interpolated body poses into the instance matrices (update() calls it). */
    syncInstances(): void;
}

// ── Pure geometry helpers (exported for tests) ───────────────────────────
/**
 * The wedge's 6 vertices in ramp-local space (centre of the footprint at the
 * origin, ground at y = 0), flat xyz: the low edge at +length/2 (y 0), the lip
 * at −length/2 (bottom and top). Order: low+z, low−z, lipBottom+z,
 * lipBottom−z, lipTop+z, lipTop−z.
 */
export function wedgeVertices(length: number, width: number, height: number): Float32Array {
    const hl = length / 2;
    const hw = width / 2;
    return new Float32Array([
        hl, 0, hw,
        hl, 0, -hw,
        -hl, 0, hw,
        -hl, 0, -hw,
        -hl, height, hw,
        -hl, height, -hw,
    ]);
}

/** Flat-shaded wedge prism (non-indexed, outward normals) from wedgeVertices(). */
export function wedgeGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
    const v = wedgeVertices(length, width, height);
    const p = (i: number): [number, number, number] => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
    const [lowP, lowN, botP, botN, topP, topN] = [0, 1, 2, 3, 4, 5].map(p);
    // Counter-clockwise seen from outside.
    const tris = [
        // Slope (faces up and toward +X).
        lowN, topN, topP,
        lowN, topP, lowP,
        // Back (vertical, faces −X).
        botN, botP, topP,
        botN, topP, topN,
        // Bottom (faces −Y).
        lowP, botP, botN,
        lowP, botN, lowN,
        // Side +Z.
        lowP, topP, botP,
        // Side −Z.
        lowN, botN, topN,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
    geo.computeVertexNormals();
    return geo;
}

/**
 * Chevron strips on the wedge slope, in ramp-local space: `count` "<" shapes
 * pointing up the slope (−X), centred on the slope and spaced along it.
 */
export function chevronGeometry(length: number, height: number, count: number): THREE.BufferGeometry {
    const C = CHEVRON;
    const shapes: THREE.Shape[] = [];
    // Chevron i is centred at u = (i − (count − 1)/2)·spacing along the slope.
    for (let i = 0; i < count; i++) {
        const u0 = (i - (count - 1) / 2) * C.spacing - (C.depth - C.thickness) / 2;
        const s = new THREE.Shape();
        s.moveTo(u0 + C.depth, 0); // outer tip
        s.lineTo(u0, C.halfSpan);
        s.lineTo(u0 - C.thickness, C.halfSpan);
        s.lineTo(u0 + C.depth - C.thickness, 0); // inner tip
        s.lineTo(u0 - C.thickness, -C.halfSpan);
        s.lineTo(u0, -C.halfSpan);
        s.closePath();
        shapes.push(s);
    }
    const geo = new THREE.ShapeGeometry(shapes);
    // Shape X → up the slope (−X, rising), shape Y → +Z, shape normal → slope normal.
    const dir = new THREE.Vector3(-length, height, 0).normalize();
    const z = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3().crossVectors(dir, z);
    const centre = new THREE.Vector3(0, height / 2, 0).addScaledVector(n, C.lift);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(dir, z, n).setPosition(centre));
    return geo;
}

/** The pin lathe split into its paper body (base + head, merged) and its band; origin at the pin centre. */
export function pinGeometries(height: number, radius: number): { body: THREE.BufferGeometry; band: THREE.BufferGeometry } {
    const pts = PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r * radius, y * height - height / 2));
    const lathe = (a: number, b: number) => new THREE.LatheGeometry(pts.slice(a, b + 1), PIN_RADIAL_SEGMENTS);
    const lower = lathe(0, PIN_BAND[0]);
    const upper = lathe(PIN_BAND[1], pts.length - 1);
    const body = mergeGeometries([lower, upper]);
    lower.dispose();
    upper.dispose();
    if (!body) throw new Error("[world3/playground] pin geometry merge failed");
    return { body, band: lathe(PIN_BAND[0], PIN_BAND[1]) };
}

// ── Builder ──────────────────────────────────────────────────────────────
export function build(ctx: AreaContext): PlaygroundHandle {
    const { group, materials, physics, shapes } = ctx;
    const PG = ctx.layout.AREA_LAYOUT.playground;
    const TY = CONFIG.type;
    const geometries: THREE.BufferGeometry[] = [];
    const instancedMeshes: THREE.InstancedMesh[] = [];
    const bodies: RAPIER.RigidBody[] = [];
    const texts: TextHandle[] = [];
    const unregister: (() => void)[] = [];
    let pad: PadVisual | null = null;
    let play: Word3D | null = null;

    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
        geometries.push(g);
        return g;
    };
    const body = (b: RAPIER.RigidBody): RAPIER.RigidBody => {
        bodies.push(b);
        return b;
    };
    const noRaycast = (o: THREE.Object3D) => {
        o.raycast = () => {};
        return o;
    };

    // Frees everything built so far: on dispose, and when a later step throws
    // (Areas then only detaches the group, so nothing else would free these).
    const release = () => {
        for (const off of unregister) off();
        unregister.length = 0;
        // Text3DSystem words carry dispose() (removes their bodies); the contract type doesn't.
        (play as (Word3D & { dispose?: () => void }) | null)?.dispose?.();
        play = null;
        pad?.dispose();
        pad = null;
        for (const b of bodies) physics.removeBody(b);
        bodies.length = 0;
        for (const h of texts) h.dispose();
        texts.length = 0;
        for (const m of instancedMeshes) m.dispose();
        instancedMeshes.length = 0;
        for (const g of geometries) g.dispose();
        geometries.length = 0;
        group.clear();
    };

    try {
        const faceQuat = new THREE.Quaternion().setFromAxisAngle(UP, FACE_CAMERA_Y);
        const faceQuatLike: QuatLike = { x: faceQuat.x, y: faceQuat.y, z: faceQuat.z, w: faceQuat.w };

        /** Links a body to `object` and records its home pose. */
        const prop = (b: RAPIER.RigidBody, object: THREE.Object3D): PlaygroundProp => {
            const t = b.translation();
            const r = b.rotation();
            physics.link(b, object);
            return {
                body: b,
                object,
                home: {
                    position: new THREE.Vector3(t.x, t.y, t.z),
                    quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
                },
            };
        };

        /** An instanced mesh (cast + receive, never frustum-culled: its instances move). */
        const instanced = (g: THREE.BufferGeometry, m: THREE.Material, count: number, name: string) => {
            const mesh = new THREE.InstancedMesh(g, m, count);
            mesh.name = name;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            noRaycast(mesh);
            instancedMeshes.push(mesh);
            group.add(mesh);
            return mesh;
        };

        // ── PLAY (dynamic, ink) ──────────────────────────────────────────
        const title = ctx.def.title3D;
        if (title) {
            play = ctx.text3d.word(title.text, {
                cap: TY.areaTitle.cap,
                depth: TY.areaTitle.depth,
                curveSegments: TY.areaTitle.curveSegments,
                color: PALETTE.ink,
                dynamic: title.dynamic,
            });
            play.group.position.set(title.x, 0, title.z);
            play.group.rotation.y = FACE_CAMERA_Y;
            group.add(play.group); // placed once; Areas arms it when build() returns
        }

        // ── Ramp: wedge + chevrons + convex-hull collider ────────────────
        const R = PG.ramp;
        const rampGroup = new THREE.Group();
        rampGroup.name = "playground-ramp";
        rampGroup.position.set(R.x, 0, R.z);
        group.add(rampGroup);
        const rampMesh = new THREE.Mesh(
            geo(wedgeGeometry(R.length, R.width, R.height)),
            materials.lambert(ACCENT.play, { flat: true })
        );
        rampMesh.name = "ramp";
        rampMesh.castShadow = true;
        rampMesh.receiveShadow = true;
        rampGroup.add(noRaycast(rampMesh));
        const chevrons = new THREE.Mesh(
            geo(chevronGeometry(R.length, R.height, R.chevrons)),
            materials.lambert(PALETTE.ink, { layer: "plate" })
        );
        chevrons.name = "ramp-chevrons";
        chevrons.receiveShadow = true;
        chevrons.renderOrder = shapes.LAYERS.plate.renderOrder;
        rampGroup.add(noRaycast(chevrons));
        const rampCollider = body(
            physics.addFixedConvexHull(wedgeVertices(R.length, R.width, R.height), { x: R.x, y: 0, z: R.z }, IDENTITY_QUAT)
        );

        // ── Bowling lane strip (plates layer) ────────────────────────────
        const L = PG.lane;
        const lane = new THREE.Mesh(
            geo(shapes.flatPlate(Math.abs(L.toX - L.fromX), L.width, LANE_CORNER, "plate")),
            materials.lambert(PALETTE.plaza, { layer: "plate" })
        );
        lane.name = "bowling-lane";
        lane.position.set((L.fromX + L.toX) / 2, 0, L.z);
        shapes.applyLayerToObject(lane, "plate");
        group.add(noRaycast(lane));

        // ── Ball (ink, mass 140) ─────────────────────────────────────────
        const B = PG.ball;
        const ballMesh = new THREE.Mesh(
            geo(new THREE.SphereGeometry(B.radius, BALL_SEGMENTS.width, BALL_SEGMENTS.height)),
            materials.lambert(PALETTE.ink)
        );
        ballMesh.name = "bowling-ball";
        ballMesh.castShadow = true;
        ballMesh.receiveShadow = true;
        group.add(noRaycast(ballMesh));
        const ball = prop(body(physics.addDynamicBall(B.radius, { x: B.x, y: B.radius, z: B.z }, { mass: B.mass })), ballMesh);

        // ── Pins (paper + brand band, cylinder colliders) ────────────────
        const P = PG.pin;
        const pinGeo = pinGeometries(P.height, P.radius);
        geo(pinGeo.body);
        geo(pinGeo.band);
        const pinFamily: InstancedFamily = {
            meshes: [
                instanced(pinGeo.body, materials.lambert(PALETTE.paper), PG.pins.length, "pin-bodies"),
                instanced(pinGeo.band, materials.lambert(ACCENT.brand), PG.pins.length, "pin-bands"),
            ],
            props: PG.pins.map((p) =>
                prop(
                    body(physics.addDynamicCylinder(P.height / 2, P.radius, { x: p.x, y: P.height / 2, z: p.z }, { mass: P.mass })),
                    new THREE.Object3D()
                )
            ),
        };

        // ── Brick wall (running bond, faceCamera) ────────────────────────
        const W = PG.wall;
        const fullSpots = PG.bricks.filter((b) => !b.half);
        const halfSpots = PG.bricks.filter((b) => b.half);
        const brickFamily = (spots: typeof fullSpots, w: number, mass: number, name: string): InstancedFamily => ({
            meshes: [
                instanced(
                    geo(new RoundedBoxGeometry(w, W.brick.h, W.brick.d, W.segments, W.radius)),
                    materials.lambert(PALETTE.paper),
                    spots.length,
                    name
                ),
            ],
            props: spots.map((s) =>
                prop(
                    body(
                        physics.addDynamicBox(
                            { x: w / 2, y: W.brick.h / 2, z: W.brick.d / 2 },
                            { x: s.x, y: s.y, z: s.z },
                            { mass, quat: faceQuatLike }
                        )
                    ),
                    new THREE.Object3D()
                )
            ),
        });
        const fullBricks = brickFamily(fullSpots, W.brick.w, W.mass, "bricks-full");
        const halfBricks = brickFamily(halfSpots, W.halfBrickW, W.halfMass, "bricks-half");
        const families = [pinFamily, fullBricks, halfBricks];

        // ── RESET pad ────────────────────────────────────────────────────
        const resetSpot = ctx.layout.PADS.find((p) => p.id === "reset" && p.areaId === ctx.def.id);
        if (!resetSpot) throw new Error("[world3/playground] no reset pad in Layout.PADS");
        const padDef: PadDef = resetSpot.pad;
        const resetPad = buildPad(padDef, { materials, text: ctx.text }, { accent: ctx.def.accent, label: resetSpot.label });
        pad = resetPad;
        group.add(resetPad.group);
        unregister.push(
            ctx.addInteractable({
                pad: padDef,
                prompt: RESET_PROMPT,
                areaId: ctx.def.id,
                // Through the command so the store, Areas and any interim marker agree.
                onInteract: () => ctx.commands.resetPlayground(),
                setActive: (on) => resetPad.setActive(on),
            })
        );

        // ── Path labels this area owns (none in the current Layout) ──────
        for (const h of buildOwnedPathLabels(ctx.text, ctx.def.id)) {
            texts.push(h);
            group.add(h.object);
        }

        // ── Instance sync + reset ────────────────────────────────────────
        const tmpM = new THREE.Matrix4();
        const toLocal = new THREE.Matrix4();
        const syncInstances = () => {
            for (const f of families) {
                const parent = f.meshes[0].parent;
                if (parent) {
                    parent.updateWorldMatrix(true, false);
                    toLocal.copy(parent.matrixWorld).invert();
                } else toLocal.identity();
                f.props.forEach((p, i) => {
                    tmpM.compose(p.object.position, p.object.quaternion, ONE).premultiply(toLocal);
                    for (const m of f.meshes) m.setMatrixAt(i, tmpM);
                });
                for (const m of f.meshes) m.instanceMatrix.needsUpdate = true;
            }
        };

        const allProps = [ball, ...pinFamily.props, ...fullBricks.props, ...halfBricks.props];
        const resetProps = () => {
            for (const p of allProps) {
                p.body.setTranslation(p.home.position, true);
                p.body.setRotation(p.home.quaternion, true);
                p.body.setLinvel(ZERO_V, true);
                p.body.setAngvel(ZERO_V, true);
                physics.snap(p.body);
            }
            syncInstances();
        };
        syncInstances();

        let disposed = false;
        return {
            group,
            play,
            ramp: { mesh: rampMesh, chevrons, collider: rampCollider },
            lane,
            ball,
            pins: pinFamily.props,
            bricks: [...fullBricks.props, ...halfBricks.props],
            instanced: {
                pinBodies: pinFamily.meshes[0],
                pinBands: pinFamily.meshes[1],
                fullBricks: fullBricks.meshes[0],
                halfBricks: halfBricks.meshes[0],
            },
            resetPad,
            pathLabels: [...texts],
            syncInstances,
            update() {
                if (!disposed) syncInstances();
            },
            reset() {
                if (disposed) return;
                resetProps();
                play?.reset();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                release();
            },
        };
    } catch (err) {
        release();
        throw err;
    }
}

registerArea("playground", build);
