import * as THREE from "three";
import { sectors, type SectorMeta } from "@/app/field/content/world";
import { buildGateway, makeLabel, type Interactable, type Track } from "@/app/components/three/worldKit";

// ─────────────────────────────────────────────────────────────
// The hub park, laid out like a small town instead of random
// scatter: a fountain plaza in the middle, a ring road, and four
// diagonal avenues that each end at a sector district (gateway +
// landmark). The hub also owns its light physics — static
// colliders the car bumps off, and knockable props (cones, crate
// stacks, a bowling lane). A seeded RNG keeps the layout identical
// on every visit.
// ─────────────────────────────────────────────────────────────

export interface Collider {
    x: number;
    z: number;
    r: number;
}

interface Prop {
    obj: THREE.Object3D;
    vel: THREE.Vector3;
    spin: THREE.Vector3;
    /** footprint radius and upright half-height */
    r: number;
    h: number;
    mass: number;
    home: THREE.Vector3;
    /** props in the same group (a crate stack) wake together */
    group: number;
    asleep: boolean;
    pin?: boolean;
}

export interface MapDistrict {
    id: SectorMeta["id"];
    name: string;
    x: number;
    z: number;
    r: number;
    color: number;
}

/** Flat description of the layout, used to draw the minimap. */
export interface HubMap {
    bound: number;
    plaza: number;
    ring: [number, number];
    /** [x1, z1, x2, z2, width] */
    roads: Array<[number, number, number, number, number]>;
    lane: [number, number, number, number, number];
    districts: MapDistrict[];
}

/** Car state the hub physics reads and corrects in place. */
export interface CarBody {
    pos: THREE.Vector3;
    yaw: number;
    speed: number;
}

export interface HubWorld {
    scene: THREE.Scene;
    interactables: Interactable[];
    spawn: { x: number; z: number; yaw: number };
    map: HubMap;
    /** Where to put the car when it leaves a sector: on that avenue, facing the plaza. */
    exitSpawn: (id: SectorMeta["id"]) => { x: number; z: number; yaw: number };
    /** Resolve car ↔ world contacts. Returns an impact strength 0..1 for camera shake. */
    collide: (car: CarBody) => number;
    update: (t: number, dt: number, reduceMotion: boolean) => void;
    pinsDown: () => number;
    pinCount: number;
    markVisited: (id: SectorMeta["id"]) => void;
    resetProps: () => void;
    dispose: () => void;
}

const GRASS = 0x5fb04a;
const PAVING = 0xe3d3a4;
const ASPHALT = 0x4a5160;
const MARKING = 0xf4efe1;

const PLAZA_R = 9;
const ROAD_W = 5;
const DISTRICT_R = 9.5;
const BOUND = 62;

// the car is treated as two circles (front + rear axle)
const CAR_R = 1.1;
const CAR_OFF = 1.1;

function mulberry32(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function segDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2)) : 0;
    return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

export function buildHub(): HubWorld {
    const disposables: Array<{ dispose: () => void }> = [];
    const track: Track = (o) => {
        disposables.push(o);
        return o;
    };
    const mat = (opts: THREE.MeshStandardMaterialParameters) => track(new THREE.MeshStandardMaterial(opts));
    const rng = mulberry32(7);
    const rand = (a: number, b: number) => a + rng() * (b - a);

    const scene = new THREE.Scene();
    const colliders: Collider[] = [];
    const interactables: Interactable[] = [];
    const spinners: Array<{ obj: THREE.Object3D; speed: number; axis: "x" | "y" | "z" }> = [];
    const bobbers: Array<{ obj: THREE.Object3D; base: number; phase: number }> = [];
    const pulsers: THREE.Object3D[] = [];

    // ---- sky, fog, light ----
    const SKY_TOP = 0x7ab8ff;
    const SKY_HORIZON = 0xd9ecff;
    {
        const c = document.createElement("canvas");
        c.width = 2;
        c.height = 256;
        const g = c.getContext("2d")!;
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, "#" + SKY_TOP.toString(16).padStart(6, "0"));
        grad.addColorStop(1, "#" + SKY_HORIZON.toString(16).padStart(6, "0"));
        g.fillStyle = grad;
        g.fillRect(0, 0, 2, 256);
        const skyTex = track(new THREE.CanvasTexture(c));
        skyTex.colorSpace = THREE.SRGBColorSpace;
        scene.background = skyTex;
    }
    scene.fog = new THREE.Fog(SKY_HORIZON, 70, 190);

    scene.add(new THREE.HemisphereLight(0xcfe6ff, GRASS, 1.15));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
    sun.position.set(30, 44, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 130;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const ground = new THREE.Mesh(track(new THREE.CircleGeometry(170, 64)), mat({ color: GRASS, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ---- layout: four districts spread asymmetrically across the park,
    // at their own directions and distances (no ring, no symmetry) ----
    const DIRS: Array<[number, number]> = [
        [0.94, -0.34], // frontend — east-northeast
        [-0.9, 0.44], // eko — west, set back
        [-0.26, -0.97], // music — far north
        [0.62, 0.78], // journey — southeast
    ];
    const DIST = [36, 42, 50, 30];
    const GATE = DIST.map((d) => d - 9);
    const districts: MapDistrict[] = sectors.map((s, i) => ({
        id: s.id,
        name: s.name,
        x: DIRS[i % 4][0] * DIST[i % 4],
        z: DIRS[i % 4][1] * DIST[i % 4],
        r: DISTRICT_R,
        color: s.color,
    }));

    const roads: HubMap["roads"] = sectors.map((_, i) => {
        const [dx, dz] = DIRS[i % 4];
        return [dx * (PLAZA_R - 0.5), dz * (PLAZA_R - 0.5), dx * (GATE[i % 4] + 1), dz * (GATE[i % 4] + 1), ROAD_W];
    });
    // south promenade: the open entrance you spawn on (leads to no district)
    roads.push([0, PLAZA_R - 0.5, 0, 56, ROAD_W]);
    const lane: HubMap["lane"] = [0, -18.5, 0, -44, 4.4];

    // ---- roads: open avenues from the plaza to each district ----
    const asphalt = mat({ color: ASPHALT, roughness: 0.92 });
    const dashGeo = track(new THREE.BoxGeometry(0.22, 0.02, 1.3));
    const dashMatrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const addStrip = (seg: [number, number, number, number, number], material: THREE.Material, y: number) => {
        const [x1, z1, x2, z2, w] = seg;
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len = Math.hypot(dx, dz);
        const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.04, len)), material);
        m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
        m.rotation.y = Math.atan2(dx, dz);
        m.receiveShadow = true;
        scene.add(m);
        return { len, angle: m.rotation.y };
    };
    for (const seg of roads) {
        const { len, angle } = addStrip(seg, asphalt, 0.03);
        const [x1, z1, x2, z2] = seg;
        for (let d = 2; d < len - 1; d += 3.2) {
            const px = x1 + ((x2 - x1) * d) / len;
            const pz = z1 + ((z2 - z1) * d) / len;
            dummy.position.set(px, 0.065, pz);
            dummy.rotation.set(0, angle, 0);
            dummy.updateMatrix();
            dashMatrices.push(dummy.matrix.clone());
        }
    }
    {
        const dashes = new THREE.InstancedMesh(dashGeo, mat({ color: MARKING, roughness: 0.8 }), dashMatrices.length);
        dashMatrices.forEach((m, i) => dashes.setMatrixAt(i, m));
        dashes.instanceMatrix.needsUpdate = true;
        scene.add(dashes);
        disposables.push(dashes);
    }

    // ---- plaza + fountain ----
    {
        const plaza = new THREE.Mesh(track(new THREE.CircleGeometry(PLAZA_R, 64)), mat({ color: PAVING, roughness: 1 }));
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = 0.06; // above the avenue tops (0.05)
        plaza.receiveShadow = true;
        scene.add(plaza);
        for (const [a, b, c] of [[PLAZA_R - 0.4, PLAZA_R, 0xbfae80], [5.4, 5.8, 0xf3e9cb]] as const) {
            const band = new THREE.Mesh(track(new THREE.RingGeometry(a, b, 64)), mat({ color: c, roughness: 1 }));
            band.rotation.x = -Math.PI / 2;
            band.position.y = 0.07;
            scene.add(band);
        }

        const stone = mat({ color: 0xdcd5c3, roughness: 0.85 });
        const basin = new THREE.Mesh(track(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 40)), stone);
        basin.position.y = 0.35;
        basin.castShadow = true;
        basin.receiveShadow = true;
        scene.add(basin);
        const water = new THREE.Mesh(
            track(new THREE.CircleGeometry(2.9, 40)),
            mat({ color: 0x5ec8ff, emissive: 0x1d7fd6, emissiveIntensity: 0.25, roughness: 0.15, metalness: 0.1 })
        );
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.66;
        scene.add(water);
        const column = new THREE.Mesh(track(new THREE.CylinderGeometry(0.4, 0.6, 2.2, 16)), stone);
        column.position.y = 1.5;
        column.castShadow = true;
        scene.add(column);
        const bowl = new THREE.Mesh(track(new THREE.CylinderGeometry(1.3, 0.5, 0.4, 24)), stone);
        bowl.position.y = 2.7;
        bowl.castShadow = true;
        scene.add(bowl);
        const jet = new THREE.Mesh(
            track(new THREE.CylinderGeometry(0.12, 0.3, 1.6, 12)),
            track(new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.7 }))
        );
        jet.position.y = 3.6;
        scene.add(jet);
        pulsers.push(jet);
        const gem = new THREE.Mesh(
            track(new THREE.IcosahedronGeometry(0.7, 0)),
            mat({ color: 0x9cc0ff, emissive: 0x1d4ed8, emissiveIntensity: 0.8, roughness: 0.2, flatShading: true })
        );
        gem.position.y = 5.3;
        gem.castShadow = true;
        scene.add(gem);
        spinners.push({ obj: gem, speed: 0.8, axis: "y" });
        bobbers.push({ obj: gem, base: 5.3, phase: 0 });
        colliders.push({ x: 0, z: 0, r: 3.5 });
    }

    // ---- entrance arch over the south avenue ----
    {
        const ARCH_Z = 30;
        const archMat = mat({ color: 0x1b2030, emissive: 0x1d4ed8, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3 });
        for (const px of [-4.2, 4.2]) {
            const pillar = new THREE.Mesh(track(new THREE.BoxGeometry(0.8, 8, 0.8)), archMat);
            pillar.position.set(px, 4, ARCH_Z);
            pillar.castShadow = true;
            scene.add(pillar);
            colliders.push({ x: px, z: ARCH_Z, r: 0.6 });
        }
        const beam = new THREE.Mesh(track(new THREE.BoxGeometry(9.2, 0.8, 0.8)), archMat);
        beam.position.set(0, 8.2, ARCH_Z); // high enough for the chase cam to pass under
        beam.castShadow = true;
        scene.add(beam);
        const sign = makeLabel(track, "Jazz's World", "Frontend · Product · Music", 8, 0x1d4ed8);
        sign.position.set(0, 9.9, ARCH_Z);
        scene.add(sign);
    }

    // ---- street furniture ----
    const lampPostGeo = track(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8));
    const lampPostMat = mat({ color: 0x2b2f3a, roughness: 0.5, metalness: 0.4 });
    const bulbGeo = track(new THREE.SphereGeometry(0.22, 12, 12));
    const bulbMat = mat({ color: 0xfff2c4, emissive: 0xffe08a, emissiveIntensity: 1.4 });
    const addLamp = (x: number, z: number) => {
        const post = new THREE.Mesh(lampPostGeo, lampPostMat);
        post.position.set(x, 1.7, z);
        post.castShadow = true;
        scene.add(post);
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, 3.5, z);
        scene.add(bulb);
        colliders.push({ x, z, r: 0.3 });
    };
    // along each avenue, both sides
    for (const [x1, z1, x2, z2] of roads) {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const ux = (x2 - x1) / len;
        const uz = (z2 - z1) / len;
        for (const r of [13, 18, 24, 30, 37, 44]) {
            const along = r - Math.hypot(x1, z1);
            if (along > len - 1) continue;
            for (const side of [-1, 1]) {
                addLamp(x1 + ux * along - uz * 3.3 * side, z1 + uz * along + ux * 3.3 * side);
            }
        }
    }

    const benchSeatGeo = track(new THREE.BoxGeometry(2, 0.15, 0.7));
    const benchLegGeo = track(new THREE.BoxGeometry(0.15, 0.5, 0.6));
    const benchMat = mat({ color: 0x8a5a2b, roughness: 0.8 });
    // plaza edge, in the open grass wedges between the avenues
    for (const a of [2.13, 3.58, 5.24]) {
        const x = Math.cos(a) * 10.8;
        const z = Math.sin(a) * 10.8;
        const bench = new THREE.Group();
        bench.position.set(x, 0, z);
        bench.lookAt(0, 0, 0);
        const seat = new THREE.Mesh(benchSeatGeo, benchMat);
        seat.position.y = 0.55;
        seat.castShadow = true;
        bench.add(seat);
        for (const lx of [-0.8, 0.8]) {
            const leg = new THREE.Mesh(benchLegGeo, benchMat);
            leg.position.set(lx, 0.28, 0);
            bench.add(leg);
        }
        scene.add(bench);
        colliders.push({ x, z, r: 1.1 });
    }

    // ---- flowers: raised beds in the open wedges between avenues ----
    const flowerColors = [0xff5d8f, 0xffd23f, 0xff8c42, 0xa66bff, 0xffffff, 0xff4d6d];
    const flowerSpots: Array<Array<[number, number, number]>> = flowerColors.map(() => []);
    {
        const soilMat = mat({ color: 0x6b4a2f, roughness: 1 });
        const rimMat = mat({ color: 0x3f8f3a, roughness: 0.9 });
        // angles chosen to fall between the (asymmetric) avenues
        for (const a of [2.13, 3.58, 5.24]) {
            const bx = Math.cos(a) * 15;
            const bz = Math.sin(a) * 15;
            const soil = new THREE.Mesh(track(new THREE.CylinderGeometry(2.2, 2.3, 0.3, 28)), soilMat);
            soil.position.set(bx, 0.15, bz);
            soil.receiveShadow = true;
            scene.add(soil);
            const rim = new THREE.Mesh(track(new THREE.TorusGeometry(2.25, 0.22, 8, 36)), rimMat);
            rim.rotation.x = -Math.PI / 2;
            rim.position.set(bx, 0.3, bz);
            scene.add(rim);
            colliders.push({ x: bx, z: bz, r: 2.4 });
            for (let i = 0; i < 26; i++) {
                const fa = rng() * Math.PI * 2;
                const fr = Math.sqrt(rng()) * 1.9;
                flowerSpots[i % flowerColors.length].push([bx + Math.cos(fa) * fr, 0.42, bz + Math.sin(fa) * fr]);
            }
        }
    }

    // ---- sector districts: pad, gateway, landmark, signpost ----
    const badges = new Map<SectorMeta["id"], THREE.Object3D>();
    const worldPoint = (g: THREE.Object3D, lx: number, lz: number) => {
        g.updateMatrixWorld(true);
        return new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
    };
    sectors.forEach((sector, i) => {
        const [dx, dz] = DIRS[i % 4];
        const d = districts[i];
        const tint = new THREE.Color(GRASS).lerp(new THREE.Color(sector.color), 0.35);

        const pad = new THREE.Mesh(track(new THREE.CircleGeometry(DISTRICT_R, 48)), mat({ color: tint, roughness: 1 }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(d.x, 0.02, d.z);
        pad.receiveShadow = true;
        scene.add(pad);
        const border = new THREE.Mesh(
            track(new THREE.RingGeometry(DISTRICT_R - 0.3, DISTRICT_R, 64)),
            track(new THREE.MeshBasicMaterial({ color: sector.color, transparent: true, opacity: 0.85 }))
        );
        border.rotation.x = -Math.PI / 2;
        border.position.set(d.x, 0.035, d.z);
        scene.add(border);

        // gateway where the avenue meets the district
        const { group, interactable } = buildGateway(track, sector);
        const gx = dx * GATE[i % 4];
        const gz = dz * GATE[i % 4];
        group.scale.setScalar(1.35);
        group.position.set(gx, 0, gz);
        group.lookAt(0, 0, 0);
        interactable.x = gx;
        interactable.z = gz;
        scene.add(group);
        interactables.push(interactable);
        for (const px of [-1.5, 1.5]) {
            const p = worldPoint(group, px, 0);
            colliders.push({ x: p.x, z: p.z, r: 0.55 });
        }
        // "explored" badge, revealed once the sector's been entered
        const badge = makeLabel(track, "Explored", "✓ visited", 3.2, 0x16a34a);
        badge.position.set(0, 6.9, 0);
        badge.visible = false;
        group.add(badge);
        badges.set(sector.id, badge);
        bobbers.push({ obj: badge, base: 6.9, phase: i });

        // landmark in the middle of the district
        const lm = buildLandmark(sector.id, sector.color);
        const lx = dx * (DIST[i % 4] + 1.5);
        const lz = dz * (DIST[i % 4] + 1.5);
        lm.group.position.set(lx, 0, lz);
        lm.group.lookAt(0, 0, 0);
        scene.add(lm.group);
        for (const [cx, cz, cr] of lm.colliders) {
            const p = worldPoint(lm.group, cx, cz);
            colliders.push({ x: p.x, z: p.z, r: cr });
        }

        // signpost at the plaza pointing down this avenue, on the side
        // facing the E/W wedges (the N/S wedges hold flower beds)
        const [sx, sz] = dx * dz > 0 ? [dz, -dx] : [-dz, dx];
        const px = dx * 12.5 + sx * 4.3;
        const pz = dz * 12.5 + sz * 4.3;
        const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.09, 0.11, 2.6, 8)), lampPostMat);
        post.position.set(px, 1.3, pz);
        post.castShadow = true;
        scene.add(post);
        const signLabel = makeLabel(track, sector.name, "this way →", 3.8, sector.color);
        signLabel.position.set(px, 3.1, pz);
        signLabel.lookAt(0, 3.1, 0);
        scene.add(signLabel);
        colliders.push({ x: px, z: pz, r: 0.3 });
    });

    function buildLandmark(id: SectorMeta["id"], color: number) {
        const group = new THREE.Group();
        const cols: Array<[number, number, number]> = [];
        if (id === "frontend") {
            // stacked "server tower" with a spinning </> on top
            const body = mat({ color: 0x16203a, emissive: color, emissiveIntensity: 0.22, roughness: 0.4, metalness: 0.4 });
            let y = 0;
            for (const [w, h] of [[3.2, 1.6], [2.5, 1.4], [1.8, 1.2]] as const) {
                const tier = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, w)), body);
                tier.position.y = y + h / 2;
                tier.castShadow = true;
                group.add(tier);
                const edges = new THREE.LineSegments(
                    track(new THREE.EdgesGeometry(tier.geometry)),
                    track(new THREE.LineBasicMaterial({ color: 0x7aa2ff }))
                );
                edges.position.copy(tier.position);
                group.add(edges);
                y += h;
            }
            const code = new THREE.Group();
            const front = makeLabel(track, "</>", "frontend", 3, color);
            const back = front.clone();
            back.rotation.y = Math.PI;
            code.add(front, back);
            code.position.y = y + 1.4;
            group.add(code);
            spinners.push({ obj: code, speed: 0.6, axis: "y" });
            cols.push([0, 0, 2.1]);
        } else if (id === "eko") {
            // a small compound of round huts around a glowing orb
            const wall = mat({ color: 0xe7b772, roughness: 0.9 });
            const roof = mat({ color: 0x9a6a35, roughness: 0.95, flatShading: true });
            const door = mat({ color: 0x3a2618, roughness: 1 });
            for (const [hx, hz] of [[-2.9, 0.8], [2.9, 0.8], [0, -2.6]] as const) {
                const hut = new THREE.Group();
                const w = new THREE.Mesh(track(new THREE.CylinderGeometry(1.3, 1.4, 1.6, 16)), wall);
                w.position.y = 0.8;
                w.castShadow = true;
                hut.add(w);
                const r = new THREE.Mesh(track(new THREE.ConeGeometry(1.9, 1.6, 12)), roof);
                r.position.y = 2.4;
                r.castShadow = true;
                hut.add(r);
                const dr = new THREE.Mesh(track(new THREE.BoxGeometry(0.6, 1, 0.1)), door);
                dr.position.set(0, 0.5, 1.33);
                hut.add(dr);
                hut.position.set(hx, 0, hz);
                hut.lookAt(0, 0, 3);
                group.add(hut);
                cols.push([hx, hz, 1.5]);
            }
            const orb = new THREE.Mesh(
                track(new THREE.SphereGeometry(0.55, 20, 20)),
                mat({ color: 0xf0b054, emissive: 0xd98a3d, emissiveIntensity: 1.2, roughness: 0.3 })
            );
            orb.position.y = 2.2;
            group.add(orb);
            bobbers.push({ obj: orb, base: 2.2, phase: 1.3 });
        } else if (id === "music") {
            // speaker stacks flanking a giant spinning record
            const cab = mat({ color: 0x1c1826, roughness: 0.6 });
            const cone = mat({ color: 0x2a2238, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
            for (const sx of [-2.8, 2.8]) {
                const spk = new THREE.Group();
                const box = new THREE.Mesh(track(new THREE.BoxGeometry(1.6, 3, 1.3)), cab);
                box.position.y = 1.5;
                box.castShadow = true;
                spk.add(box);
                for (const [cy, cr] of [[1.05, 0.55], [2.25, 0.3]] as const) {
                    const c = new THREE.Mesh(track(new THREE.CircleGeometry(cr, 24)), cone);
                    c.position.set(0, cy, 0.66);
                    spk.add(c);
                }
                spk.position.x = sx;
                group.add(spk);
                pulsers.push(spk);
                cols.push([sx, 0, 1.1]);
            }
            const stand = new THREE.Mesh(track(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 10)), lampPostMat);
            stand.position.y = 1.1;
            group.add(stand);
            const disc = new THREE.Group();
            const vinyl = new THREE.Mesh(track(new THREE.CylinderGeometry(1.8, 1.8, 0.1, 48)), mat({ color: 0x111114, roughness: 0.35, metalness: 0.3 }));
            vinyl.rotation.x = Math.PI / 2;
            disc.add(vinyl);
            const centre = new THREE.Mesh(track(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 24)), mat({ color, emissive: color, emissiveIntensity: 0.7 }));
            centre.rotation.x = Math.PI / 2;
            disc.add(centre);
            disc.position.y = 3.9;
            group.add(disc);
            spinners.push({ obj: disc, speed: 1.6, axis: "z" });
            cols.push([0, 0, 0.5]);
        } else {
            // journey: stepping stones up to an obelisk ringed by a halo
            const stoneMat = mat({ color: 0xd8d3c4, roughness: 0.9 });
            const shaft = new THREE.Mesh(track(new THREE.BoxGeometry(1, 4.5, 1)), stoneMat);
            shaft.position.y = 2.25;
            shaft.castShadow = true;
            group.add(shaft);
            const tip = new THREE.Mesh(
                track(new THREE.ConeGeometry(0.72, 0.9, 4)),
                mat({ color: 0x2dd4bf, emissive: color, emissiveIntensity: 0.9, roughness: 0.35 })
            );
            tip.position.y = 4.95;
            tip.rotation.y = Math.PI / 4;
            group.add(tip);
            const halo = new THREE.Mesh(
                track(new THREE.TorusGeometry(1.6, 0.06, 8, 48)),
                track(new THREE.MeshBasicMaterial({ color: 0x2dd4bf }))
            );
            halo.position.y = 3;
            halo.rotation.x = Math.PI / 2.4;
            group.add(halo);
            spinners.push({ obj: halo, speed: 0.7, axis: "z" });
            for (let s = 0; s < 4; s++) {
                const st = new THREE.Mesh(track(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 14)), stoneMat);
                st.position.set(s % 2 ? 0.4 : -0.4, 0.06, 1.8 + s * 1.3);
                st.receiveShadow = true;
                group.add(st);
            }
            cols.push([0, 0, 0.9]);
        }
        return { group, colliders: cols };
    }

    // ---- bowling lane (north of the ring) ----
    {
        const [x1, z1, x2, z2, w] = lane;
        addStrip([x1, z1, x2, z2, w], mat({ color: 0xe9cf9a, roughness: 0.6 }), 0.035);
        for (const side of [-1, 1]) {
            addStrip([x1 + side * (w / 2 + 0.15), z1, x2 + side * (w / 2 + 0.15), z2, 0.3], mat({ color: 0x3b2a1c, roughness: 0.8 }), 0.06);
        }
        // backstop at the end of the lane, with the sign mounted above it
        const wall = new THREE.Mesh(track(new THREE.BoxGeometry(6, 1.3, 0.8)), mat({ color: 0x2b2f3a, roughness: 0.7 }));
        wall.position.set(0, 0.65, -46);
        wall.castShadow = true;
        scene.add(wall);
        for (const px of [-2.25, -0.75, 0.75, 2.25]) colliders.push({ x: px, z: -46, r: 0.75 });
        for (const px of [-2.7, 2.7]) {
            const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.09, 0.11, 3.4, 8)), lampPostMat);
            post.position.set(px, 1.7, -46);
            scene.add(post);
        }
        const sign = makeLabel(track, "Bowling lane", "floor it into the pins", 5, 0xdc2626);
        sign.position.set(0, 4.2, -46);
        scene.add(sign);
    }

    // ---- trees: only in open park land, never on roads or districts ----
    const trunkGeo = track(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 8));
    const trunkMat = mat({ color: 0x7a5230, roughness: 0.9 });
    const foliageGeo = track(new THREE.IcosahedronGeometry(1, 0));
    const foliageMats = [0x3aa64a, 0x2f8f43, 0x57c65b, 0x6fce74].map((c) => mat({ color: c, roughness: 0.85, flatShading: true }));
    const propSpots: Array<[number, number, number]> = [[36, 0, 5], [-36, 0, 5]];
    const allSegs = [...roads, lane];
    const clearOf = (x: number, z: number, roadGap: number) =>
        allSegs.every(([a, b, c, d]) => segDist(x, z, a, b, c, d) > roadGap) &&
        districts.every((d) => Math.hypot(x - d.x, z - d.z) > d.r + 2.5) &&
        propSpots.every(([px, pz, pr]) => Math.hypot(x - px, z - pz) > pr);
    const addTree = (x: number, z: number, scale: number, k0: number) => {
        const tree = new THREE.Group();
        tree.position.set(x, 0, z);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.8;
        trunk.castShadow = true;
        tree.add(trunk);
        for (let k = 0; k < 3; k++) {
            const f = new THREE.Mesh(foliageGeo, foliageMats[(k0 + k) % foliageMats.length]);
            f.scale.setScalar(rand(1.1, 1.7) - k * 0.25);
            f.position.set(rand(-0.4, 0.4), 1.7 + k * 0.7, rand(-0.4, 0.4));
            f.castShadow = true;
            tree.add(f);
        }
        tree.scale.setScalar(scale);
        scene.add(tree);
        colliders.push({ x, z, r: 0.45 * scale });
    };
    {
        const trees: Array<[number, number]> = [];
        for (let attempt = 0; attempt < 3000 && trees.length < 62; attempt++) {
            const a = rng() * Math.PI * 2;
            const r = rand(PLAZA_R + 8, BOUND - 1);
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            if (!clearOf(x, z, 5.8)) continue;
            if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 3.6)) continue;
            trees.push([x, z]);
            addTree(x, z, rand(0.9, 1.5), trees.length);
        }
        // a few shade trees near the plaza, only where they clear the avenues
        for (const a of [0, Math.PI, Math.PI * 1.5]) {
            for (const off of [-0.36, 0.36]) {
                const tx = Math.cos(a + off) * 15.5;
                const tz = Math.sin(a + off) * 15.5;
                if (clearOf(tx, tz, 4.5)) addTree(tx, tz, rand(0.8, 1.05), Math.round(a));
            }
        }
        // dense tree line at the park edge frames the world
        for (let i = 0; i < 44; i++) {
            const a = (i / 44) * Math.PI * 2 + rand(-0.03, 0.03);
            addTree(Math.cos(a) * (BOUND + 3.5), Math.sin(a) * (BOUND + 3.5), rand(1.2, 1.7), i);
        }
        // park-land flowers
        for (let i = 0; i < 240; i++) {
            const a = rng() * Math.PI * 2;
            const r = rand(PLAZA_R + 6, BOUND);
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            if (!clearOf(x, z, 3.5)) continue;
            flowerSpots[i % flowerColors.length].push([x, 0.16, z]);
        }
    }
    {
        const flowerGeo = track(new THREE.SphereGeometry(0.16, 6, 6));
        flowerColors.forEach((col, ci) => {
            const spots = flowerSpots[ci];
            const inst = new THREE.InstancedMesh(flowerGeo, mat({ color: col, roughness: 0.9 }), spots.length);
            spots.forEach(([x, y, z], i) => {
                dummy.position.set(x, y, z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.setScalar(rand(0.6, 1.3));
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
            });
            dummy.scale.setScalar(1);
            inst.instanceMatrix.needsUpdate = true;
            scene.add(inst);
            disposables.push(inst);
        });
    }

    // ---- skyline ringing the park (upright, outside the drivable area) ----
    {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 128;
        const g = c.getContext("2d")!;
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, 64, 128);
        g.fillStyle = "rgba(20,26,45,0.82)";
        for (let y = 6; y < 128; y += 12) {
            for (let x = 6; x < 64; x += 12) {
                if (rng() > 0.28) g.fillRect(x, y, 7, 7);
            }
        }
        const windowTex = track(new THREE.CanvasTexture(c));
        windowTex.colorSpace = THREE.SRGBColorSpace;
        const buildingColors = [0x4f7cff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xb892ff, 0xf4a261, 0x2ec4b6, 0xff8fab];
        const buildingMats = buildingColors.map((color) => mat({ color, roughness: 0.6, metalness: 0.1, map: windowTex }));
        const buildingGeo = track(new THREE.BoxGeometry(1, 1, 1));
        const count = 36;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + rand(-0.04, 0.04);
            const dist = rand(70, 84);
            const h = rand(12, 36);
            const w = rand(6, 10);
            const b = new THREE.Mesh(buildingGeo, buildingMats[i % buildingMats.length]);
            b.position.set(Math.cos(a) * dist, h / 2, Math.sin(a) * dist);
            b.scale.set(w, h, w);
            b.rotation.y = -a;
            scene.add(b);
        }
    }

    // ---- clouds + floating motes ----
    const clouds: THREE.Group[] = [];
    {
        const cloudMat = mat({ color: 0xffffff, roughness: 1, emissive: 0x223344, emissiveIntensity: 0.05 });
        const cloudGeo = track(new THREE.SphereGeometry(2.4, 10, 10));
        for (let i = 0; i < 10; i++) {
            const cloud = new THREE.Group();
            cloud.position.set(rand(-80, 80), rand(30, 44), rand(-80, 80));
            for (let k = 0; k < 4; k++) {
                const p = new THREE.Mesh(cloudGeo, cloudMat);
                p.position.set(rand(-3, 3), rand(-0.6, 0.6), rand(-2, 2));
                p.scale.setScalar(rand(0.7, 1.4));
                cloud.add(p);
            }
            clouds.push(cloud);
            scene.add(cloud);
        }
    }
    let motes: THREE.Points;
    {
        const n = 70;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            pos[i * 3] = rand(-50, 50);
            pos[i * 3 + 1] = rand(1, 13);
            pos[i * 3 + 2] = rand(-50, 50);
        }
        const g = track(new THREE.BufferGeometry());
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        motes = new THREE.Points(g, track(new THREE.PointsMaterial({ color: 0x3b82f6, size: 0.12, transparent: true, opacity: 0.5 })));
        scene.add(motes);
    }

    // ---- knockable props ----
    const props: Prop[] = [];
    let groupId = 0;
    const addProp = (obj: THREE.Object3D, x: number, y: number, z: number, r: number, h: number, mass: number, group: number, pin = false) => {
        obj.position.set(x, y, z);
        obj.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        scene.add(obj);
        props.push({
            obj,
            vel: new THREE.Vector3(),
            spin: new THREE.Vector3(),
            r,
            h,
            mass,
            home: new THREE.Vector3(x, y, z),
            group,
            asleep: true,
            pin,
        });
    };
    {
        // traffic cones lining the entrance avenue
        const coneGeo = track(new THREE.ConeGeometry(0.34, 0.9, 14));
        const coneMat = mat({ color: 0xff7a1a, roughness: 0.6 });
        const baseGeo = track(new THREE.BoxGeometry(0.7, 0.08, 0.7));
        const stripeGeo = track(new THREE.CylinderGeometry(0.19, 0.25, 0.14, 14));
        const white = mat({ color: 0xffffff, roughness: 0.6 });
        for (const z of [11, 13.5, 16]) {
            for (const x of [-2.1, 2.1]) {
                const cone = new THREE.Group();
                cone.add(new THREE.Mesh(coneGeo, coneMat));
                const base = new THREE.Mesh(baseGeo, coneMat);
                base.position.y = -0.41;
                cone.add(base);
                const stripe = new THREE.Mesh(stripeGeo, white);
                stripe.position.y = 0.02;
                cone.add(stripe);
                addProp(cone, x, 0.45, z, 0.4, 0.45, 0.4, groupId++);
            }
        }

        // crate pyramids east and west of the ring
        const crateGeo = track(new THREE.BoxGeometry(1.1, 1.1, 1.1));
        const crateMat = mat({ color: 0xb07a3c, roughness: 0.85 });
        const crateEdges = track(new THREE.EdgesGeometry(crateGeo));
        const edgeMat = track(new THREE.LineBasicMaterial({ color: 0x6b4420 }));
        for (const cx of [36, -36]) {
            const g = groupId++;
            const rows: Array<[number, number[]]> = [[0.55, [-1.2, 0, 1.2]], [1.65, [-0.6, 0.6]], [2.75, [0]]];
            for (const [y, zs] of rows) {
                for (const z of zs) {
                    const crate = new THREE.Group();
                    crate.add(new THREE.Mesh(crateGeo, crateMat));
                    crate.add(new THREE.LineSegments(crateEdges, edgeMat));
                    addProp(crate, cx, y, z, 0.6, 0.55, 1, g);
                }
            }
        }

        // ten pins at the end of the lane
        const pinProfile = [
            [0, -0.55], [0.17, -0.5], [0.21, -0.25], [0.16, 0.05], [0.09, 0.22],
            [0.12, 0.38], [0.09, 0.52], [0, 0.56],
        ].map(([x, y]) => new THREE.Vector2(x, y));
        const pinGeo = track(new THREE.LatheGeometry(pinProfile, 16));
        const pinMat = mat({ color: 0xf7f6f0, roughness: 0.35 });
        const bandGeo = track(new THREE.TorusGeometry(0.1, 0.025, 6, 16));
        const bandMat = mat({ color: 0xdc2626, roughness: 0.5 });
        for (let row = 0; row < 4; row++) {
            for (let k = 0; k <= row; k++) {
                const pin = new THREE.Group();
                pin.add(new THREE.Mesh(pinGeo, pinMat));
                const band = new THREE.Mesh(bandGeo, bandMat);
                band.rotation.x = Math.PI / 2;
                band.position.y = 0.26;
                pin.add(band);
                addProp(pin, (k - row / 2) * 0.95, 0.56, -38 - row * 0.9, 0.22, 0.56, 0.35, groupId++, true);
            }
        }
    }
    const pinCount = props.filter((p) => p.pin).length;

    const wake = (p: Prop) => {
        if (!p.asleep) return;
        for (const q of props) if (q.group === p.group) q.asleep = false;
    };

    // ---- physics ----
    const collide = (car: CarBody) => {
        const fx = -Math.sin(car.yaw);
        const fz = -Math.cos(car.yaw);
        let hit = 0;
        for (const s of [1, -1]) {
            for (const col of colliders) {
                const cx = car.pos.x + fx * CAR_OFF * s;
                const cz = car.pos.z + fz * CAR_OFF * s;
                const dx = cx - col.x;
                const dz = cz - col.z;
                const min = CAR_R + col.r;
                const d2 = dx * dx + dz * dz;
                if (d2 >= min * min || d2 < 1e-6) continue;
                const d = Math.sqrt(d2);
                const nx = dx / d;
                const nz = dz / d;
                car.pos.x += nx * (min - d);
                car.pos.z += nz * (min - d);
                const vn = (fx * nx + fz * nz) * car.speed;
                if (vn < 0) hit = Math.max(hit, -vn);
            }
        }
        if (hit > 0) car.speed = hit > 7 ? -car.speed * 0.3 : car.speed * 0.55;

        let bump = 0;
        const vx = fx * car.speed;
        const vz = fz * car.speed;
        for (const p of props) {
            if (p.obj.position.y - p.h > 1.4) continue; // airborne above the roof line
            for (const s of [1, -1]) {
                const cx = car.pos.x + fx * CAR_OFF * s;
                const cz = car.pos.z + fz * CAR_OFF * s;
                const dx = p.obj.position.x - cx;
                const dz = p.obj.position.z - cz;
                const min = CAR_R + p.r;
                const d2 = dx * dx + dz * dz;
                if (d2 >= min * min || d2 < 1e-6) continue;
                const d = Math.sqrt(d2);
                const nx = dx / d;
                const nz = dz / d;
                wake(p);
                p.obj.position.x += nx * (min - d);
                p.obj.position.z += nz * (min - d);
                const rel = vx * nx + vz * nz;
                if (rel > 0.3) {
                    const k = 1 / p.mass;
                    p.vel.x += (nx * rel * 1.3 + vx * 0.35) * k * 0.6;
                    p.vel.z += (nz * rel * 1.3 + vz * 0.35) * k * 0.6;
                    p.vel.y = Math.max(p.vel.y, Math.min(6.5, 1.5 + rel * 0.16));
                    p.spin.set((Math.random() - 0.5) * rel * 1.4, (Math.random() - 0.5) * rel, (Math.random() - 0.5) * rel * 1.4);
                    car.speed *= 1 - 0.05 * p.mass;
                    bump = Math.max(bump, rel * p.mass);
                }
            }
        }
        return Math.min(1, hit / 22 + bump / 40);
    };

    const up = new THREE.Vector3();
    const stepProps = (dt: number) => {
        for (const p of props) {
            if (p.asleep) continue;
            const o = p.obj;
            p.vel.y -= 22 * dt;
            o.position.addScaledVector(p.vel, dt);
            o.rotation.x += p.spin.x * dt;
            o.rotation.y += p.spin.y * dt;
            o.rotation.z += p.spin.z * dt;
            up.set(0, 1, 0).applyQuaternion(o.quaternion);
            const uy = Math.abs(up.y);
            const rest = p.h * uy + p.r * Math.sqrt(Math.max(0, 1 - uy * uy));
            if (o.position.y <= rest) {
                o.position.y = rest;
                p.vel.y = p.vel.y < -3 ? -p.vel.y * 0.3 : 0;
                const f = Math.exp(-3 * dt);
                p.vel.x *= f;
                p.vel.z *= f;
                p.spin.multiplyScalar(Math.exp(-4 * dt));
            }
            for (const col of colliders) {
                const dx = o.position.x - col.x;
                const dz = o.position.z - col.z;
                const min = col.r + p.r;
                const d2 = dx * dx + dz * dz;
                if (d2 >= min * min || d2 < 1e-6) continue;
                const d = Math.sqrt(d2);
                const nx = dx / d;
                const nz = dz / d;
                o.position.x += nx * (min - d);
                o.position.z += nz * (min - d);
                const vn = p.vel.x * nx + p.vel.z * nz;
                if (vn < 0) {
                    p.vel.x -= 1.5 * vn * nx;
                    p.vel.z -= 1.5 * vn * nz;
                }
            }
            const r = Math.hypot(o.position.x, o.position.z);
            if (r > BOUND + 2) {
                o.position.x *= (BOUND + 2) / r;
                o.position.z *= (BOUND + 2) / r;
                p.vel.x *= -0.3;
                p.vel.z *= -0.3;
            }
        }
        // prop ↔ prop: lets a hit crate topple its stack or a pin take out its neighbours
        for (let i = 0; i < props.length; i++) {
            const a = props[i];
            for (let j = i + 1; j < props.length; j++) {
                const b = props[j];
                if (a.asleep && b.asleep) continue;
                const pa = a.obj.position;
                const pb = b.obj.position;
                if (Math.abs(pa.y - pb.y) > a.h + b.h) continue;
                const dx = pa.x - pb.x;
                const dz = pa.z - pb.z;
                const min = a.r + b.r;
                const d2 = dx * dx + dz * dz;
                if (d2 >= min * min || d2 < 1e-6) continue;
                const d = Math.sqrt(d2);
                const nx = dx / d;
                const nz = dz / d;
                const push = (min - d) / 2;
                pa.x += nx * push;
                pa.z += nz * push;
                pb.x -= nx * push;
                pb.z -= nz * push;
                const rv = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
                if (rv >= 0) continue;
                for (const [q, sign] of [[a, 1], [b, -1]] as const) {
                    if (q.asleep) {
                        wake(q);
                        q.vel.y = Math.max(q.vel.y, 1.2);
                        q.spin.set((Math.random() - 0.5) * -rv * 2.4, 0, (Math.random() - 0.5) * -rv * 2.4);
                    }
                    q.vel.x -= sign * rv * nx * 0.9;
                    q.vel.z -= sign * rv * nz * 0.9;
                }
            }
        }
    };

    const update = (t: number, dt: number, reduceMotion: boolean) => {
        stepProps(dt);
        if (reduceMotion) return;
        for (const s of spinners) s.obj.rotation[s.axis] += s.speed * dt;
        for (const b of bobbers) b.obj.position.y = b.base + Math.sin(t * 1.6 + b.phase) * 0.18;
        pulsers.forEach((p, i) => {
            const k = 1 + Math.max(0, Math.sin(t * 7.5 + i * 0.6)) * 0.05;
            p.scale.set(k, i === 0 ? 0.8 + Math.sin(t * 3) * 0.2 : k, k);
        });
        motes.rotation.y = t * 0.02;
        for (const cloud of clouds) {
            cloud.position.x += dt * 0.6;
            if (cloud.position.x > 90) cloud.position.x = -90;
        }
    };

    return {
        scene,
        interactables,
        spawn: { x: 0, z: 44, yaw: 0 },
        map: { bound: BOUND, plaza: PLAZA_R, ring: [0, 0], roads, lane, districts },
        exitSpawn: (id) => {
            const i = Math.max(0, sectors.findIndex((s) => s.id === id));
            const [dx, dz] = DIRS[i % 4];
            return { x: dx * (GATE[i % 4] - 10), z: dz * (GATE[i % 4] - 10), yaw: Math.atan2(dx, dz) };
        },
        collide,
        update,
        pinCount,
        pinsDown: () =>
            props.reduce((n, p) => {
                if (!p.pin) return n;
                up.set(0, 1, 0).applyQuaternion(p.obj.quaternion);
                const moved = Math.hypot(p.obj.position.x - p.home.x, p.obj.position.z - p.home.z);
                return n + (up.y < 0.6 || moved > 1 ? 1 : 0);
            }, 0),
        markVisited: (id) => {
            const b = badges.get(id);
            if (b) b.visible = true;
        },
        resetProps: () => {
            for (const p of props) {
                p.obj.position.copy(p.home);
                p.obj.rotation.set(0, 0, 0);
                p.vel.set(0, 0, 0);
                p.spin.set(0, 0, 0);
                p.asleep = true;
            }
        },
        dispose: () => disposables.forEach((d) => d.dispose()),
    };
}
