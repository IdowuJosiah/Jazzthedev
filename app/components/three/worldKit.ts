import * as THREE from "three";
import {
    type SectorMeta,
    type Terminal,
    frontendProjects,
    journeyStops,
    skillTotems,
    ekoMilestones,
    yorubaWords,
    musicPillars,
} from "@/app/field/content/world";

// ─────────────────────────────────────────────────────────────
// Shared 3D kit for the field world: labels, sector gateways
// (hub), and the Sector A "dev workshop" scene with its terminals
// (the ProjectCard3D equivalent). Raw three.js, self-disposing.
// ─────────────────────────────────────────────────────────────

export type Track = <T extends { dispose: () => void }>(o: T) => T;

/** Generic content for an InfoPanel — used by markers/totems. */
export interface InfoContent {
    title: string;
    sub?: string;
    body?: string;
    tags?: string[];
    links?: { label: string; url: string }[];
}

export interface Interactable {
    x: number;
    z: number;
    kind: "gateway" | "terminal" | "marker" | "audio";
    halo: THREE.Mesh;
    // gateway
    sectorId?: SectorMeta["id"];
    sectorName?: string;
    active?: boolean;
    blurb?: string;
    // terminal
    contentIndex?: number;
    screen?: THREE.Mesh;
    booted?: boolean;
    // marker (waypoint / totem / milestone)
    info?: InfoContent;
    promptTitle?: string;
    promptSub?: string;
    /** if set, interacting counts toward the sector's progress meter */
    progressId?: string;
    /** the audio-demo centerpiece toggles playback instead of a panel */
    audio?: boolean;
}

export interface SectorScene {
    scene: THREE.Scene;
    interactables: Interactable[];
    spawn: { x: number; z: number; yaw: number };
    dispose: () => void;
    /** number of milestones for the optional progress meter */
    progressTotal?: number;
}

/**
 * A sector rendered directly into the open world (no portal): a content
 * Group placed at the district position, plus its interactables in local
 * coordinates (the hub offsets them to world space).
 */
export interface SectorDistrict {
    group: THREE.Group;
    interactables: Interactable[];
    dispose: () => void;
}

function hex(c: number) {
    return "#" + c.toString(16).padStart(6, "0");
}

/** Title + subtitle drawn to a canvas texture, with a legible outline. */
export function makeLabel(
    track: Track,
    title: string,
    subtitle: string,
    width = 4.4,
    accent = 0x3b82f6,
    light = false
): THREE.Mesh {
    const w = 1024;
    const h = 256;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.strokeStyle = light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.92)";
    ctx.fillStyle = light ? "#eef2ff" : "#141826";
    ctx.font = "700 92px Poppins, system-ui, sans-serif";
    ctx.lineWidth = 12;
    ctx.strokeText(title, w / 2, 104);
    ctx.fillText(title, w / 2, 104);
    ctx.font = "500 44px Poppins, system-ui, sans-serif";
    ctx.lineWidth = 8;
    ctx.strokeText(subtitle, w / 2, 180);
    ctx.fillStyle = hex(accent);
    ctx.fillText(subtitle, w / 2, 180);
    const tex = track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    const geo = track(new THREE.PlaneGeometry(width, (width / 4) * 1.05));
    return new THREE.Mesh(geo, mat);
}

/**
 * A hub gateway/portal for one sector. Placed by the caller; faces
 * the hub centre. Active gateways glow in the sector colour; inactive
 * ones are dimmed and read as "coming soon".
 */
export function buildGateway(track: Track, sector: SectorMeta): { group: THREE.Group; interactable: Interactable } {
    const group = new THREE.Group();
    const color = sector.active ? sector.color : 0x6b7280;
    const emissive = sector.active ? sector.color : 0x1f2430;

    const pillarGeo = track(new THREE.BoxGeometry(0.45, 4.2, 0.45));
    const pillarMat = track(
        new THREE.MeshStandardMaterial({ color: 0x1b2030, emissive, emissiveIntensity: sector.active ? 0.4 : 0.15, roughness: 0.5, metalness: 0.3 })
    );
    for (const px of [-1.5, 1.5]) {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(px, 2.1, 0);
        pillar.castShadow = true;
        group.add(pillar);
    }
    const beam = new THREE.Mesh(
        track(new THREE.BoxGeometry(3.7, 0.45, 0.45)),
        pillarMat
    );
    beam.position.set(0, 4.2, 0);
    group.add(beam);

    // glowing portal sheet
    const portal = new THREE.Mesh(
        track(new THREE.PlaneGeometry(2.7, 3.8)),
        track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: sector.active ? 0.3 : 0.12, side: THREE.DoubleSide }))
    );
    portal.position.set(0, 2.1, 0);
    group.add(portal);

    // base pad
    const pad = new THREE.Mesh(
        track(new THREE.CylinderGeometry(2, 2.2, 0.2, 32)),
        track(new THREE.MeshStandardMaterial({ color: 0x121722, emissive, emissiveIntensity: sector.active ? 0.5 : 0.12, roughness: 0.6 }))
    );
    pad.position.y = 0.1;
    pad.receiveShadow = true;
    group.add(pad);

    const label = makeLabel(track, sector.name, sector.active ? sector.blurb : "Coming soon", 5, color);
    label.position.set(0, 5.2, 0);
    group.add(label);

    // focus halo
    const halo = new THREE.Mesh(
        track(new THREE.PlaneGeometry(3.6, 5)),
        track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }))
    );
    halo.position.set(0, 2.4, -0.1);
    group.add(halo);

    return {
        group,
        interactable: {
            x: 0,
            z: 0,
            kind: "gateway",
            halo,
            sectorId: sector.id,
            sectorName: sector.name,
            active: sector.active,
            blurb: sector.blurb,
        },
    };
}

/** A single project terminal (monitor + stand + label) for a sector. */
function buildTerminal(track: Track, loader: THREE.TextureLoader, terminal: Terminal, index: number): { group: THREE.Group; interactable: Interactable } {
    const group = new THREE.Group();
    const panelW = 3.4;
    const panelH = 2.15;

    const stand = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.9, 2.4, 0.5)),
        track(new THREE.MeshStandardMaterial({ color: 0x0e1422, roughness: 0.4, metalness: 0.5 }))
    );
    stand.position.y = 1.2;
    stand.castShadow = true;
    group.add(stand);

    const frame = new THREE.Mesh(
        track(new THREE.BoxGeometry(panelW + 0.2, panelH + 0.2, 0.14)),
        track(new THREE.MeshStandardMaterial({ color: 0x0a0e18, emissive: 0x1d4ed8, emissiveIntensity: 0.6, roughness: 0.3 }))
    );
    frame.position.y = 3.1;
    group.add(frame);

    const tex = track(loader.load(terminal.image));
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
        track(new THREE.PlaneGeometry(panelW, panelH)),
        track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.12 }))
    );
    screen.position.set(0, 3.1, 0.09);
    group.add(screen);

    const label = makeLabel(track, terminal.title, terminal.pitch, panelW + 1, 0x3b82f6);
    label.position.y = 4.6;
    group.add(label);

    const halo = new THREE.Mesh(
        track(new THREE.PlaneGeometry(panelW + 0.9, panelH + 0.9)),
        track(new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0 }))
    );
    halo.position.set(0, 3.1, -0.09);
    group.add(halo);

    return {
        group,
        interactable: { x: 0, z: 0, kind: "terminal", halo, contentIndex: index, screen, booted: false },
    };
}

/**
 * Sector A district — a "dev zone": a dark tech pad with glowing rings
 * and monitor terminals for each frontend project, lit by local accent
 * lights so it reads as digital even out on the bright open field.
 */
export function buildFrontendDistrict(loader: THREE.TextureLoader): SectorDistrict {
    const disposables: Array<{ dispose: () => void }> = [];
    const track: Track = (o) => {
        disposables.push(o);
        return o;
    };
    const group = new THREE.Group();

    // dark tech pad + glowing concentric rings
    const floor = new THREE.Mesh(
        track(new THREE.CircleGeometry(15, 56)),
        track(new THREE.MeshStandardMaterial({ color: 0x0c1120, roughness: 0.7, metalness: 0.2 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.05;
    floor.receiveShadow = true;
    group.add(floor);
    for (const rad of [6, 10, 14]) {
        const ring = new THREE.Mesh(
            track(new THREE.RingGeometry(rad - 0.07, rad + 0.07, 80)),
            track(new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }))
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.07;
        group.add(ring);
    }
    for (const [px, pz, col] of [[-8, -8, 0xffa64d], [8, -8, 0x4d7cff], [0, 9, 0x8a5cff]] as const) {
        const pl = new THREE.PointLight(col, 22, 26, 2);
        pl.position.set(px, 4.5, pz);
        group.add(pl);
    }

    // terminals in a shallow arc
    const interactables: Interactable[] = [];
    const count = frontendProjects.length;
    const radius = 9;
    const spread = Math.PI * 1.1;
    const startA = -spread / 2 - Math.PI / 2;
    frontendProjects.forEach((project, i) => {
        const ang = count > 1 ? startA + (spread * i) / (count - 1) : -Math.PI / 2;
        const x = Math.cos(ang) * radius;
        const z = Math.sin(ang) * radius;
        const { group: g, interactable } = buildTerminal(track, loader, project, i);
        g.position.set(x, 0, z);
        g.lookAt(0, g.position.y, 0);
        interactable.x = x;
        interactable.z = z;
        group.add(g);
        interactables.push(interactable);
    });

    return { group, interactables, dispose: () => disposables.forEach((d) => d.dispose()) };
}

// ── Sector D — Background, Skills & Journey Timeline ──

const TEAL = 0x0d9488;
const TEAL_LIGHT = 0x2dd4bf;

/** A timeline waypoint: node on a post with a floating year + title. */
function buildWaypoint(track: Track, index: number): { group: THREE.Group; interactable: Interactable } {
    const stop = journeyStops[index];
    const group = new THREE.Group();

    const plinth = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.7, 0.85, 0.5, 24)),
        track(new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.9 }))
    );
    plinth.position.y = 0.25;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    const post = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 12)),
        track(new THREE.MeshStandardMaterial({ color: 0x9aa08c, roughness: 0.7, metalness: 0.2 }))
    );
    post.position.y = 1.3;
    group.add(post);

    const node = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.4, 20, 20)),
        track(new THREE.MeshStandardMaterial({ color: TEAL_LIGHT, emissive: TEAL, emissiveIntensity: 1.1, roughness: 0.3 }))
    );
    node.position.y = 2.3;
    group.add(node);

    const label = makeLabel(track, stop.title, stop.year, 5.2, TEAL);
    label.position.y = 3.4;
    group.add(label);

    const halo = new THREE.Mesh(
        track(new THREE.PlaneGeometry(2, 2)),
        track(new THREE.MeshBasicMaterial({ color: TEAL_LIGHT, transparent: true, opacity: 0 }))
    );
    halo.position.y = 2.3;
    halo.position.z = -0.05;
    group.add(halo);

    return {
        group,
        interactable: {
            x: 0,
            z: 0,
            kind: "marker",
            halo,
            promptTitle: stop.title,
            promptSub: stop.year,
            info: { title: stop.title, sub: stop.year, body: stop.body },
        },
    };
}

/** A skill totem: an obelisk grouping one skill category. */
function buildTotem(track: Track, index: number): { group: THREE.Group; interactable: Interactable } {
    const totem = skillTotems[index];
    const group = new THREE.Group();

    const base = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.9, 1, 0.4, 6)),
        track(new THREE.MeshStandardMaterial({ color: 0xbfc4b0, roughness: 0.9 }))
    );
    base.position.y = 0.2;
    base.receiveShadow = true;
    group.add(base);

    const shaft = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.8, 3, 0.8)),
        track(new THREE.MeshStandardMaterial({ color: 0x8b9285, roughness: 0.6, metalness: 0.2 }))
    );
    shaft.position.y = 1.9;
    shaft.castShadow = true;
    group.add(shaft);

    const tip = new THREE.Mesh(
        track(new THREE.ConeGeometry(0.6, 0.8, 4)),
        track(new THREE.MeshStandardMaterial({ color: TEAL_LIGHT, emissive: TEAL, emissiveIntensity: 0.9, roughness: 0.35 }))
    );
    tip.position.y = 3.8;
    tip.rotation.y = Math.PI / 4;
    group.add(tip);

    const label = makeLabel(track, totem.category, "Skills", 5, TEAL);
    label.position.y = 4.7;
    group.add(label);

    const halo = new THREE.Mesh(
        track(new THREE.PlaneGeometry(1.6, 4)),
        track(new THREE.MeshBasicMaterial({ color: TEAL_LIGHT, transparent: true, opacity: 0 }))
    );
    halo.position.y = 2;
    halo.position.z = -0.5;
    group.add(halo);

    return {
        group,
        interactable: {
            x: 0,
            z: 0,
            kind: "marker",
            halo,
            promptTitle: totem.category,
            promptSub: totem.proof,
            info: { title: totem.category, sub: totem.proof, tags: totem.skills },
        },
    };
}

/**
 * Sector D — a calm, open "anchor" space: a timeline trail with
 * chronological waypoints joined by a glowing line, plus a cluster of
 * skill totems just off the path. Neutral palette, distinct from the hub
 * and the other sectors.
 */
export function buildJourneyDistrict(loader: THREE.TextureLoader): SectorDistrict {
    void loader;
    const disposables: Array<{ dispose: () => void }> = [];
    const track: Track = (o) => {
        disposables.push(o);
        return o;
    };
    const group = new THREE.Group();

    // pale stone pad so the timeline reads as its own calm plaza
    const pad = new THREE.Mesh(
        track(new THREE.CircleGeometry(16, 56)),
        track(new THREE.MeshStandardMaterial({ color: 0xb9c2a6, roughness: 1 }))
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.04;
    pad.receiveShadow = true;
    group.add(pad);

    // straight timeline path + glowing line down the middle
    const path = new THREE.Mesh(
        track(new THREE.BoxGeometry(3, 0.06, 26)),
        track(new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.95 }))
    );
    path.position.set(0, 0.07, -1);
    path.receiveShadow = true;
    group.add(path);
    const line = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.16, 0.06, 26)),
        track(new THREE.MeshBasicMaterial({ color: TEAL_LIGHT, transparent: true, opacity: 0.85 }))
    );
    line.position.set(0, 0.11, -1);
    group.add(line);

    const interactables: Interactable[] = [];

    // waypoints down the timeline, alternating sides
    journeyStops.forEach((_, i) => {
        const z = 9 - i * 4;
        const x = i % 2 === 0 ? -3.2 : 3.2;
        const { group: g, interactable } = buildWaypoint(track, i);
        g.position.set(x, 0, z);
        interactable.x = x;
        interactable.z = z;
        group.add(g);
        interactables.push(interactable);
    });

    // skill totems clustered off to the side, facing the path
    const totemSpots: Array<[number, number]> = [[11, 5], [13, 0], [11, -5]];
    skillTotems.forEach((_, i) => {
        const [x, z] = totemSpots[i];
        const { group: g, interactable } = buildTotem(track, i);
        g.position.set(x, 0, z);
        g.lookAt(0, g.position.y, z);
        interactable.x = x;
        interactable.z = z;
        group.add(g);
        interactables.push(interactable);
    });

    return { group, interactables, dispose: () => disposables.forEach((d) => d.dispose()) };
}

// ── Sector B — Eko (Yoruba learning app) ──

const OCHRE = 0xd98a3d;
const OCHRE_LIGHT = 0xf0b054;

/** Procedural adire-style indigo textile pattern (white resist motifs). */
function makeAdireTexture(track: Track): THREE.CanvasTexture {
    const s = 256;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1e2657";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(233,238,255,0.55)";
    g.fillStyle = "rgba(233,238,255,0.5)";
    g.lineWidth = 3;
    // concentric-circle motifs at four cells
    for (const [cx, cy] of [[64, 64], [192, 192], [192, 64], [64, 192]] as const) {
        for (let r = 8; r <= 40; r += 10) {
            g.beginPath();
            g.arc(cx, cy, r, 0, Math.PI * 2);
            g.stroke();
        }
        g.beginPath();
        g.arc(cx, cy, 4, 0, Math.PI * 2);
        g.fill();
    }
    // dotted cross-hatch between
    for (let x = 16; x < s; x += 32) {
        for (let y = 16; y < s; y += 32) {
            g.beginPath();
            g.arc(x, y, 2, 0, Math.PI * 2);
            g.fill();
        }
    }
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

/** An Eko milestone monument along the path (ochre/indigo themed). */
function buildMilestone(track: Track, adire: THREE.Texture, index: number): { group: THREE.Group; interactable: Interactable } {
    const m = ekoMilestones[index];
    const group = new THREE.Group();

    const base = new THREE.Mesh(
        track(new THREE.CylinderGeometry(1, 1.15, 0.4, 6)),
        track(new THREE.MeshStandardMaterial({ color: 0x2a2f66, roughness: 0.85 }))
    );
    base.position.y = 0.2;
    base.receiveShadow = true;
    group.add(base);

    // patterned monolith
    const slab = new THREE.Mesh(
        track(new THREE.BoxGeometry(1.8, 2.6, 0.35)),
        track(new THREE.MeshStandardMaterial({ map: adire, roughness: 0.8 }))
    );
    slab.position.y = 1.7;
    slab.castShadow = true;
    group.add(slab);

    // ochre cap
    const cap = new THREE.Mesh(
        track(new THREE.BoxGeometry(2, 0.25, 0.5)),
        track(new THREE.MeshStandardMaterial({ color: OCHRE_LIGHT, emissive: OCHRE, emissiveIntensity: 0.5, roughness: 0.5 }))
    );
    cap.position.y = 3.1;
    group.add(cap);

    const label = makeLabel(track, m.title, m.step, 5, OCHRE_LIGHT);
    label.position.y = 3.9;
    group.add(label);

    const halo = new THREE.Mesh(
        track(new THREE.PlaneGeometry(2.6, 3.4)),
        track(new THREE.MeshBasicMaterial({ color: OCHRE_LIGHT, transparent: true, opacity: 0 }))
    );
    halo.position.set(0, 1.9, -0.2);
    group.add(halo);

    const info: InfoContent = {
        title: m.title,
        sub: m.step,
        body: m.body,
        links: m.liveUrl ? [{ label: "Visit Eko", url: m.liveUrl }] : undefined,
    };

    return {
        group,
        interactable: {
            x: 0,
            z: 0,
            kind: "marker",
            halo,
            promptTitle: m.title,
            promptSub: m.step,
            info,
            progressId: `eko-${index}`,
        },
    };
}

/** A floating vocabulary orb with an always-visible word + translation. */
function buildVocabOrb(track: Track, index: number): THREE.Group {
    const v = yorubaWords[index % yorubaWords.length];
    const group = new THREE.Group();
    const orb = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.35, 18, 18)),
        track(new THREE.MeshStandardMaterial({ color: OCHRE_LIGHT, emissive: OCHRE, emissiveIntensity: 1.1, roughness: 0.3 }))
    );
    group.add(orb);
    const label = makeLabel(track, v.word, v.meaning, 3.2, OCHRE_LIGHT);
    label.position.y = 0.85;
    label.scale.setScalar(0.85);
    group.add(label);
    return group;
}

/**
 * Sector B — Eko: a warm, culturally-rooted product-journey space. A
 * short winding path of milestone monuments (indigo + adire textile
 * patterns, ochre accents) with floating Yoruba vocabulary orbs nearby.
 */
export function buildEkoDistrict(loader: THREE.TextureLoader): SectorDistrict {
    void loader;
    const disposables: Array<{ dispose: () => void }> = [];
    const track: Track = (o) => {
        disposables.push(o);
        return o;
    };
    const group = new THREE.Group();

    // adire-patterned indigo pad
    const adire = makeAdireTexture(track);
    adire.repeat.set(6, 6);
    const pad = new THREE.Mesh(
        track(new THREE.CircleGeometry(16, 56)),
        track(new THREE.MeshStandardMaterial({ map: adire, color: 0x6a74c9, roughness: 0.95 }))
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    group.add(pad);
    const glow = new THREE.PointLight(OCHRE, 26, 32, 2);
    glow.position.set(0, 7, 0);
    group.add(glow);

    // winding path centreline through the milestones
    const milestonePts: Array<[number, number]> = [[0, 10], [4.5, 5], [-3.5, 0], [3.5, -5], [-3, -10]];
    const pathPts = [[0, 14] as [number, number], ...milestonePts];
    const lineMat = track(new THREE.MeshBasicMaterial({ color: OCHRE_LIGHT, transparent: true, opacity: 0.9 }));
    for (let i = 0; i < pathPts.length - 1; i++) {
        const [x1, z1] = pathPts[i];
        const [x2, z2] = pathPts[i + 1];
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len = Math.hypot(dx, dz);
        const seg = new THREE.Mesh(track(new THREE.BoxGeometry(0.18, 0.06, len)), lineMat);
        seg.position.set((x1 + x2) / 2, 0.09, (z1 + z2) / 2);
        seg.rotation.y = Math.atan2(dx, dz);
        group.add(seg);
    }

    const interactables: Interactable[] = [];
    ekoMilestones.forEach((_, i) => {
        const [x, z] = milestonePts[i];
        const { group: g, interactable } = buildMilestone(track, adire, i);
        g.position.set(x, 0, z);
        g.lookAt(0, g.position.y, z + 4);
        interactable.x = x;
        interactable.z = z;
        group.add(g);
        interactables.push(interactable);
    });

    // floating vocabulary orbs scattered near the path
    const orbGroup = new THREE.Group();
    orbGroup.name = "orbs";
    for (let i = 0; i < yorubaWords.length; i++) {
        const orb = buildVocabOrb(track, i);
        const ang = (i / yorubaWords.length) * Math.PI * 2;
        const rad = 7 + (i % 3) * 2;
        orb.position.set(Math.cos(ang) * rad, 1.8 + (i % 3) * 0.5, Math.sin(ang) * rad - 2);
        orb.userData.baseY = orb.position.y;
        orbGroup.add(orb);
    }
    group.add(orbGroup);

    return { group, interactables, dispose: () => disposables.forEach((d) => d.dispose()) };
}

// ── Sector C — Music Platform (Spotify API), audio-reactive stage ──

const MAGENTA = 0xd946ef;
const CYAN = 0x22d3ee;
const AMBER = 0xf59e0b;

/**
 * Sector C — a dark stage/club space: a raised platform ringed by an
 * audio-reactive visualizer of vertical bars, sweeping colored
 * spotlights, and album-art pillars linking out to the platform. The
 * bars/lights are driven by a Web Audio analyser in ProjectField once
 * the player triggers "Play demo" (never autoplays).
 */
export function buildMusicDistrict(loader: THREE.TextureLoader): SectorDistrict {
    void loader;
    const disposables: Array<{ dispose: () => void }> = [];
    const track: Track = (o) => {
        disposables.push(o);
        return o;
    };
    const group = new THREE.Group();
    const scene = group; // keep the body below identical: it just adds to `scene`

    // sweeping colored spotlights aimed at the stage centre
    const target = new THREE.Object3D();
    target.position.set(0, 0, 0);
    scene.add(target);
    const stagelights = new THREE.Group();
    stagelights.name = "stagelights";
    for (const [col, ang] of [[MAGENTA, 0], [CYAN, 2.1], [AMBER, 4.2]] as const) {
        const sp = new THREE.SpotLight(col, 90, 34, Math.PI / 7, 0.4, 1.4);
        sp.position.set(Math.cos(ang) * 14, 16, Math.sin(ang) * 14);
        sp.target = target;
        stagelights.add(sp);
    }
    scene.add(stagelights);

    // pulsing centre light (driven by bass)
    const pulse = new THREE.PointLight(MAGENTA, 6, 34, 2);
    pulse.name = "pulse";
    pulse.position.set(0, 3, 0);
    scene.add(pulse);

    // dark club pad + raised stage
    const floor = new THREE.Mesh(
        track(new THREE.CircleGeometry(16, 56)),
        track(new THREE.MeshStandardMaterial({ color: 0x0d0a18, roughness: 0.4, metalness: 0.5 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.05;
    floor.receiveShadow = true;
    scene.add(floor);

    const stage = new THREE.Mesh(
        track(new THREE.CylinderGeometry(6, 6.3, 0.5, 48)),
        track(new THREE.MeshStandardMaterial({ color: 0x140f22, roughness: 0.3, metalness: 0.6, emissive: MAGENTA, emissiveIntensity: 0.12 }))
    );
    stage.position.y = 0.25;
    scene.add(stage);
    const rim = new THREE.Mesh(
        track(new THREE.TorusGeometry(6.1, 0.08, 12, 64)),
        track(new THREE.MeshBasicMaterial({ color: MAGENTA }))
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.52;
    scene.add(rim);

    // audio-reactive visualizer: ring of vertical bars around the stage
    const visualizer = new THREE.Group();
    visualizer.name = "visualizer";
    const barGeo = track(new THREE.BoxGeometry(0.32, 1, 0.32));
    barGeo.translate(0, 0.5, 0); // pivot at the base so bars grow up
    const barCount = 48;
    for (let i = 0; i < barCount; i++) {
        const ang = (i / barCount) * Math.PI * 2;
        const bar = new THREE.Mesh(
            barGeo,
            track(new THREE.MeshStandardMaterial({ color: 0x2a1240, emissive: MAGENTA, emissiveIntensity: 0.4, roughness: 0.4 }))
        );
        bar.position.set(Math.cos(ang) * 5.5, 0.5, Math.sin(ang) * 5.5);
        bar.scale.y = 0.4;
        visualizer.add(bar);
    }
    scene.add(visualizer);

    // centre console — the "Play demo" trigger
    const console3d = new THREE.Group();
    const pedestal = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.6, 0.8, 1.1, 20)),
        track(new THREE.MeshStandardMaterial({ color: 0x1a1330, roughness: 0.4, metalness: 0.5 }))
    );
    pedestal.position.y = 0.8;
    console3d.add(pedestal);
    const emblem = new THREE.Mesh(
        track(new THREE.IcosahedronGeometry(0.55, 1)),
        track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: MAGENTA, emissiveIntensity: 1.4, roughness: 0.2 }))
    );
    emblem.position.y = 1.9;
    console3d.add(emblem);
    console3d.position.set(0, 0.5, 0);
    scene.add(console3d);
    const audioHalo = new THREE.Mesh(
        track(new THREE.PlaneGeometry(3, 3)),
        track(new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0 }))
    );
    audioHalo.position.set(0, 2, 0);
    scene.add(audioHalo);

    const interactables: Interactable[] = [
        { x: 0, z: 0, kind: "audio", halo: audioHalo, audio: true, promptTitle: "Live demo", promptSub: "Generated tone" },
    ];

    // album-art pillars ringing the stage, each an InfoPanel
    musicPillars.forEach((pillar, i) => {
        const ang = (i / musicPillars.length) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(ang) * 13;
        const z = Math.sin(ang) * 13;
        const group = new THREE.Group();

        const col = [MAGENTA, CYAN, AMBER, 0x8b5cf6][i % 4];
        const disc = new THREE.Mesh(
            track(new THREE.CylinderGeometry(1.5, 1.5, 0.25, 32)),
            track(new THREE.MeshStandardMaterial({ color: 0x14101f, emissive: col, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.4 }))
        );
        disc.rotation.x = Math.PI / 2;
        disc.position.y = 3;
        group.add(disc);
        const stand = new THREE.Mesh(
            track(new THREE.CylinderGeometry(0.12, 0.12, 3, 12)),
            track(new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.5, metalness: 0.4 }))
        );
        stand.position.y = 1.5;
        stand.castShadow = true;
        group.add(stand);

        const label = makeLabel(track, pillar.title, "Track / feature", 4.4, 0xe879f9);
        label.position.y = 4.6;
        group.add(label);

        const halo = new THREE.Mesh(
            track(new THREE.PlaneGeometry(3.4, 3.4)),
            track(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0 }))
        );
        halo.position.set(0, 3, -0.2);
        group.add(halo);

        group.position.set(x, 0, z);
        group.lookAt(0, group.position.y, 0);
        scene.add(group);

        interactables.push({
            x,
            z,
            kind: "marker",
            halo,
            promptTitle: pillar.title,
            promptSub: "Track / feature",
            info: {
                title: pillar.title,
                body: pillar.body,
                links: pillar.url ? [{ label: "Visit platform", url: pillar.url }] : undefined,
            },
        });
    });

    return { group, interactables, dispose: () => disposables.forEach((d) => d.dispose()) };
}
