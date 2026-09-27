import * as THREE from "three";
import { type SectorMeta, type Terminal, frontendProjects } from "@/app/field/content/world";

// ─────────────────────────────────────────────────────────────
// Shared 3D kit for the field world: labels, sector gateways
// (hub), and the Sector A "dev workshop" scene with its terminals
// (the ProjectCard3D equivalent). Raw three.js, self-disposing.
// ─────────────────────────────────────────────────────────────

export type Track = <T extends { dispose: () => void }>(o: T) => T;

export interface Interactable {
    x: number;
    z: number;
    kind: "gateway" | "terminal";
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
}

export interface SectorScene {
    scene: THREE.Scene;
    interactables: Interactable[];
    spawn: { x: number; z: number; yaw: number };
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
 * Sector A — the "dev workshop / control room": a dark, digital space
 * with floating monitor terminals for each frontend project, warm
 * accent glow, and drifting code-glyph particles. Own THREE.Scene so
 * its palette/lighting are fully distinct from the hub.
 */
export function buildFrontendSector(loader: THREE.TextureLoader): SectorScene {
    const disposables: Array<{ dispose: () => void }> = [];
    const track: Track = (o) => {
        disposables.push(o);
        return o;
    };

    const scene = new THREE.Scene();
    const bg = 0x0a0e17;
    scene.background = new THREE.Color(bg);
    scene.fog = new THREE.Fog(bg, 16, 64);

    scene.add(new THREE.HemisphereLight(0x2a3a66, 0x05070d, 0.55));
    const key = new THREE.DirectionalLight(0x9ab4ff, 0.5);
    key.position.set(8, 16, 6);
    scene.add(key);
    // warm accent fills
    for (const [px, pz, col] of [[-9, -9, 0xffa64d], [9, -9, 0x4d7cff], [0, 10, 0x8a5cff]] as const) {
        const pl = new THREE.PointLight(col, 40, 40, 2);
        pl.position.set(px, 5, pz);
        scene.add(pl);
    }

    // floor: dark disc + glowing concentric rings + faint grid
    const floor = new THREE.Mesh(
        track(new THREE.CircleGeometry(70, 64)),
        track(new THREE.MeshStandardMaterial({ color: 0x0c1120, roughness: 0.7, metalness: 0.2 }))
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(80, 40, 0x1d4ed8, 0x141b30);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = 0.02;
    scene.add(grid);
    disposables.push(grid.geometry, grid.material as THREE.Material);
    for (const rad of [7, 12, 18]) {
        const ring = new THREE.Mesh(
            track(new THREE.RingGeometry(rad - 0.06, rad + 0.06, 80)),
            track(new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.4, side: THREE.DoubleSide }))
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        scene.add(ring);
    }

    // terminals arranged in a shallow arc in front of the spawn
    const interactables: Interactable[] = [];
    const count = frontendProjects.length;
    const radius = 11;
    const spread = Math.PI * 0.95;
    const startA = -spread / 2 - Math.PI / 2;
    frontendProjects.forEach((project, i) => {
        const ang = count > 1 ? startA + (spread * i) / (count - 1) : -Math.PI / 2;
        const x = Math.cos(ang) * radius;
        const z = Math.sin(ang) * radius;
        const { group, interactable } = buildTerminal(track, loader, project, i);
        group.position.set(x, 0, z);
        group.lookAt(0, group.position.y, 0);
        interactable.x = x;
        interactable.z = z;
        scene.add(group);
        interactables.push(interactable);
    });

    // drifting code-glyph particles
    const glyphCount = 220;
    const gpos = new Float32Array(glyphCount * 3);
    for (let i = 0; i < glyphCount; i++) {
        gpos[i * 3] = (Math.random() - 0.5) * 60;
        gpos[i * 3 + 1] = Math.random() * 14 + 1;
        gpos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const ggeo = track(new THREE.BufferGeometry());
    ggeo.setAttribute("position", new THREE.BufferAttribute(gpos, 3));
    const glyphs = new THREE.Points(
        ggeo,
        track(new THREE.PointsMaterial({ color: 0x4d7cff, size: 0.08, transparent: true, opacity: 0.6 }))
    );
    glyphs.name = "glyphs";
    scene.add(glyphs);

    return {
        scene,
        interactables,
        spawn: { x: 0, z: 16, yaw: 0 },
        dispose: () => {
            disposables.forEach((d) => d.dispose());
        },
    };
}
