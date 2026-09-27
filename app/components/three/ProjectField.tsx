"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { sectors, frontendProjects, type SectorMeta, type Terminal } from "@/app/field/content/world";
import {
    buildGateway,
    buildFrontendSector,
    buildJourneySector,
    type Interactable,
    type SectorScene,
    type InfoContent,
} from "@/app/components/three/worldKit";

const ACCENT = 0x1d4ed8;
const ACCENT_LIGHT = 0x3b82f6;

type AreaId = "hub" | SectorMeta["id"];
type PromptInfo = { title: string; sub: string; action: string } | null;
type PanelInfo =
    | { kind: "terminal"; project: Terminal }
    | { kind: "info"; content: InfoContent }
    | { kind: "soon"; name: string }
    | null;

/**
 * The field world. A drivable car (third-person follow-cam) explores a
 * hub park whose gateways lead into themed sector scenes. Sector A (a
 * dark "dev workshop") is built; approach a terminal and press E / click
 * to open its InfoPanel. Raw three.js; everything disposed on unmount.
 */
export default function ProjectField() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [started, setStarted] = useState(false);
    const [isTouch, setIsTouch] = useState(false);
    const [prompt, setPrompt] = useState<PromptInfo>(null);
    const [panel, setPanel] = useState<PanelInfo>(null);
    const [area, setArea] = useState<AreaId>("hub");
    const [transitioning, setTransitioning] = useState(false);

    // Shared handles the scene exposes to React overlay buttons.
    const apiRef = useRef<{
        start: () => void;
        interact: () => void;
        setDrive: (dir: "forward" | "back" | "left" | "right", on: boolean) => void;
        closePanel: () => void;
        exitSector: () => void;
    } | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const touch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
        setIsTouch(touch);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        // Bright daytime park palette — kept vivid regardless of theme.
        const SKY_TOP = 0x7ab8ff;
        const SKY_HORIZON = 0xd9ecff;
        const GRASS = 0x5fb04a;
        const PATH = 0xe3d3a4;

        // ---- renderer / scene / camera ----
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.domElement.style.display = "block";
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(SKY_HORIZON, 55, 150);

        const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
        const EYE = 1.7;
        camera.position.set(0, EYE, 0);

        // ---- disposable registry ----
        const disposables: Array<{ dispose: () => void }> = [];
        const track = <T extends { dispose: () => void }>(o: T) => {
            disposables.push(o);
            return o;
        };

        // ---- gradient sky ----
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

        // ---- lighting ----
        scene.add(new THREE.HemisphereLight(0xcfe6ff, GRASS, 1.15));
        const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
        sun.position.set(24, 34, 14);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 90;
        sun.shadow.camera.left = -45;
        sun.shadow.camera.right = 45;
        sun.shadow.camera.top = 45;
        sun.shadow.camera.bottom = -45;
        sun.shadow.bias = -0.0004;
        scene.add(sun);

        // ---- grass ground ----
        const ground = new THREE.Mesh(
            track(new THREE.CircleGeometry(160, 64)),
            track(new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1, metalness: 0 }))
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // ---- helpers to keep material/geo tracked ----
        const mat = (opts: THREE.MeshStandardMaterialParameters) =>
            track(new THREE.MeshStandardMaterial(opts));

        // ---- paths: central plaza + a spoke to each project ----
        const pathMat = mat({ color: PATH, roughness: 1 });
        const plaza = new THREE.Mesh(track(new THREE.CircleGeometry(6, 48)), pathMat);
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = 0.02;
        plaza.receiveShadow = true;
        scene.add(plaza);

        // ---- trees (trunk + layered foliage), scattered on the grass ----
        const trunkGeo = track(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 8));
        const trunkMat = mat({ color: 0x7a5230, roughness: 0.9 });
        const foliageGeo = track(new THREE.IcosahedronGeometry(1, 0));
        const foliageMats = [0x3aa64a, 0x2f8f43, 0x57c65b, 0x6fce74].map((c) =>
            mat({ color: c, roughness: 0.85, flatShading: true })
        );
        const rand = (a: number, b: number) => a + Math.random() * (b - a);
        const treeSpots: Array<[number, number]> = [];
        for (let i = 0; i < 46; i++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = rand(9, 40);
            const x = Math.cos(ang) * dist;
            const z = Math.sin(ang) * dist;
            treeSpots.push([x, z]);
            const tree = new THREE.Group();
            tree.position.set(x, 0, z);
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = 0.8;
            trunk.castShadow = true;
            tree.add(trunk);
            const clusters = 3;
            for (let k = 0; k < clusters; k++) {
                const f = new THREE.Mesh(foliageGeo, foliageMats[(i + k) % foliageMats.length]);
                const s = rand(1.1, 1.7) - k * 0.25;
                f.scale.setScalar(s);
                f.position.set(rand(-0.4, 0.4), 1.7 + k * 0.7, rand(-0.4, 0.4));
                f.castShadow = true;
                tree.add(f);
            }
            const scale = rand(0.8, 1.5);
            tree.scale.setScalar(scale);
            scene.add(tree);
        }

        // ---- colorful city skyline ringing the park ----
        const windowTex = (() => {
            const c = document.createElement("canvas");
            c.width = 64;
            c.height = 128;
            const g = c.getContext("2d")!;
            g.fillStyle = "#ffffff";
            g.fillRect(0, 0, 64, 128);
            g.fillStyle = "rgba(20,26,45,0.82)";
            for (let y = 6; y < 128; y += 12) {
                for (let x = 6; x < 64; x += 12) {
                    if (Math.random() > 0.28) g.fillRect(x, y, 7, 7);
                }
            }
            const t = track(new THREE.CanvasTexture(c));
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        })();
        const buildingColors = [
            0x4f7cff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xb892ff, 0xf4a261, 0x2ec4b6, 0xff8fab,
        ];
        const buildingGeo = track(new THREE.BoxGeometry(1, 1, 1));
        const ringCount = 30;
        for (let i = 0; i < ringCount; i++) {
            const ang = (i / ringCount) * Math.PI * 2 + rand(-0.05, 0.05);
            const dist = rand(50, 66);
            const h = rand(10, 34);
            const w = rand(5, 9);
            const b = new THREE.Mesh(
                buildingGeo,
                mat({
                    color: buildingColors[i % buildingColors.length],
                    roughness: 0.6,
                    metalness: 0.1,
                    map: windowTex,
                })
            );
            b.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist);
            b.scale.set(w, h, w);
            b.lookAt(0, h / 2, 0);
            scene.add(b);
        }

        // ---- lampposts around the plaza ----
        const lampPostGeo = track(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8));
        const lampPostMat = mat({ color: 0x2b2f3a, roughness: 0.5, metalness: 0.4 });
        const bulbGeo = track(new THREE.SphereGeometry(0.22, 12, 12));
        const bulbMat = mat({ color: 0xfff2c4, emissive: 0xffe08a, emissiveIntensity: 1.4 });
        for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2;
            const lamp = new THREE.Group();
            lamp.position.set(Math.cos(ang) * 7.5, 0, Math.sin(ang) * 7.5);
            const post = new THREE.Mesh(lampPostGeo, lampPostMat);
            post.position.y = 1.7;
            post.castShadow = true;
            lamp.add(post);
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.y = 3.5;
            lamp.add(bulb);
            scene.add(lamp);
        }

        // ---- benches near the plaza ----
        const benchSeatGeo = track(new THREE.BoxGeometry(2, 0.15, 0.7));
        const benchMat = mat({ color: 0x8a5a2b, roughness: 0.8 });
        const benchLegGeo = track(new THREE.BoxGeometry(0.15, 0.5, 0.6));
        for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * Math.PI * 2 + 0.3;
            const bench = new THREE.Group();
            const r = 9.5;
            bench.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
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
        }

        // ---- flowers: instanced colorful dots on the grass ----
        const flowerColors = [0xff5d8f, 0xffd23f, 0xff8c42, 0xa66bff, 0xffffff, 0xff4d6d];
        const flowerGeo = track(new THREE.SphereGeometry(0.16, 6, 6));
        flowerColors.forEach((col) => {
            const inst = new THREE.InstancedMesh(flowerGeo, mat({ color: col, roughness: 0.9 }), 60);
            const dummy = new THREE.Object3D();
            for (let i = 0; i < 60; i++) {
                const ang = Math.random() * Math.PI * 2;
                const dist = rand(8, 42);
                dummy.position.set(Math.cos(ang) * dist, 0.16, Math.sin(ang) * dist);
                dummy.scale.setScalar(rand(0.6, 1.3));
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
            }
            inst.instanceMatrix.needsUpdate = true;
            scene.add(inst);
            disposables.push(inst);
        });

        // ---- clouds drifting overhead ----
        const cloudMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x223344, emissiveIntensity: 0.05 }));
        const cloudGeo = track(new THREE.SphereGeometry(2.4, 10, 10));
        const clouds: THREE.Group[] = [];
        for (let i = 0; i < 9; i++) {
            const cloud = new THREE.Group();
            cloud.position.set(rand(-60, 60), rand(26, 40), rand(-60, 60));
            const puffs = 4;
            for (let k = 0; k < puffs; k++) {
                const p = new THREE.Mesh(cloudGeo, cloudMat);
                p.position.set(rand(-3, 3), rand(-0.6, 0.6), rand(-2, 2));
                p.scale.setScalar(rand(0.7, 1.4));
                cloud.add(p);
            }
            clouds.push(cloud);
            scene.add(cloud);
        }

        // ---- hub sector gateways (arc of portals leading into sectors) ----
        const loader = new THREE.TextureLoader();
        const hubInteractables: Interactable[] = [];
        {
            const gCount = sectors.length;
            const gRadius = 16;
            const gSpread = Math.PI * 1.3;
            const gStart = -gSpread / 2 - Math.PI / 2;
            sectors.forEach((sector, i) => {
                const angle = gCount > 1 ? gStart + (gSpread * i) / (gCount - 1) : -Math.PI / 2;
                const x = Math.cos(angle) * gRadius;
                const z = Math.sin(angle) * gRadius;
                const { group, interactable } = buildGateway(track, sector);
                group.position.set(x, 0, z);
                group.lookAt(0, 0, 0);
                interactable.x = x;
                interactable.z = z;
                scene.add(group);
                hubInteractables.push(interactable);
            });
        }

        // ambient floating orbs for depth
        const orbCount = reduceMotion ? 0 : 60;
        let orbs: THREE.Points | null = null;
        if (orbCount > 0) {
            const pos = new Float32Array(orbCount * 3);
            for (let i = 0; i < orbCount; i++) {
                pos[i * 3] = (Math.random() - 0.5) * 70;
                pos[i * 3 + 1] = Math.random() * 12 + 1;
                pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
            }
            const g = track(new THREE.BufferGeometry());
            g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            const m = track(new THREE.PointsMaterial({ color: ACCENT_LIGHT, size: 0.12, transparent: true, opacity: 0.5 }));
            orbs = new THREE.Points(g, m);
            scene.add(orbs);
        }

        // ---- drivable car (third-person, Bruno-Simon style) ----
        const car = new THREE.Group();
        // chassis leans/pitches for juice; wheels stay on the ground
        const chassis = new THREE.Group();
        car.add(chassis);
        const body = new THREE.Mesh(
            track(new THREE.BoxGeometry(1.7, 0.5, 3.1)),
            mat({ color: ACCENT, roughness: 0.35, metalness: 0.35 })
        );
        body.position.y = 0.55;
        body.castShadow = true;
        chassis.add(body);
        const cabin = new THREE.Mesh(
            track(new THREE.BoxGeometry(1.35, 0.55, 1.5)),
            mat({ color: 0x121a30, roughness: 0.15, metalness: 0.5 })
        );
        cabin.position.set(0, 1.0, -0.1);
        cabin.castShadow = true;
        chassis.add(cabin);
        const hlMat = mat({ color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 1.3 });
        for (const hx of [-0.5, 0.5]) {
            const hl = new THREE.Mesh(track(new THREE.SphereGeometry(0.14, 10, 10)), hlMat);
            hl.position.set(hx, 0.6, -1.6);
            chassis.add(hl);
        }
        const wheelGeo = track(new THREE.CylinderGeometry(0.36, 0.36, 0.32, 16));
        const wheelMat = mat({ color: 0x0e0f14, roughness: 0.85 });
        // each wheel sits in a steer pivot so front wheels can turn cleanly
        const frontPivots: THREE.Group[] = [];
        for (const [wx, wz] of [[-0.9, 1], [0.9, 1], [-0.9, -1], [0.9, -1]] as const) {
            const pivot = new THREE.Group();
            pivot.position.set(wx, 0.36, wz);
            const w = new THREE.Mesh(wheelGeo, wheelMat);
            w.rotation.z = Math.PI / 2;
            w.castShadow = true;
            pivot.add(w);
            car.add(pivot);
            if (wz < 0) frontPivots.push(pivot); // front axle steers
        }
        const carPos = new THREE.Vector3(0, 0, 14);
        let carYaw = 0; // forward is local -Z
        let speed = 0;
        car.position.copy(carPos);
        scene.add(car);

        // ---- controls + interaction + area management ----
        const keys = new Set<string>();
        const drive = { forward: false, back: false, left: false, right: false };
        let playing = false;

        const MAX_SPEED = 27;
        const REVERSE_SPEED = 12;
        const ACCEL = 36;
        const FRICTION = 18;
        const TURN = 2.3;
        const HUB_BOUND = 44;
        const SECTOR_BOUND = 26;
        const CAM_DIST = 9;
        const CAM_HEIGHT = 5;

        let activeScene: THREE.Scene = scene;
        let activeList: Interactable[] = hubInteractables;
        let currentArea: AreaId = "hub";
        let activeIt: Interactable | null = null;
        let panelOpen = false;
        let uiLocked = false; // panel open or mid-transition → freeze driving
        const sectorCache = new Map<string, SectorScene>();
        const sectorBuilders: Partial<Record<SectorMeta["id"], (l: THREE.TextureLoader) => SectorScene>> = {
            frontend: buildFrontendSector,
            journey: buildJourneySector,
        };

        const hubSpawn = { x: 0, z: 22, yaw: 0 };

        const placeCar = (into: THREE.Scene, sx: number, sz: number, yaw: number) => {
            car.parent?.remove(car);
            into.add(car);
            carPos.set(sx, 0, sz);
            carYaw = yaw;
            speed = 0;
            camera.position.set(sx, CAM_HEIGHT, sz + CAM_DIST);
            camera.lookAt(sx, 1.3, sz);
        };

        const enterSector = (id: SectorMeta["id"]) => {
            if (uiLocked) return;
            uiLocked = true;
            setTransitioning(true);
            window.setTimeout(() => {
                let s = sectorCache.get(id);
                if (!s) {
                    s = sectorBuilders[id]!(loader);
                    sectorCache.set(id, s);
                }
                activeScene = s.scene;
                activeList = s.interactables;
                currentArea = id;
                placeCar(s.scene, s.spawn.x, s.spawn.z, s.spawn.yaw);
                setArea(id);
                setPrompt(null);
                setTransitioning(false);
                uiLocked = false;
            }, 340);
        };

        const exitSector = () => {
            if (currentArea === "hub" || uiLocked) return;
            uiLocked = true;
            panelOpen = false;
            setPanel(null);
            setTransitioning(true);
            window.setTimeout(() => {
                activeScene = scene;
                activeList = hubInteractables;
                currentArea = "hub";
                placeCar(scene, hubSpawn.x, hubSpawn.z, hubSpawn.yaw);
                setArea("hub");
                setPrompt(null);
                setTransitioning(false);
                uiLocked = false;
            }, 340);
        };

        const openPanel = (info: PanelInfo) => {
            panelOpen = true;
            uiLocked = true;
            setPanel(info);
        };
        const closePanel = () => {
            panelOpen = false;
            uiLocked = false;
            setPanel(null);
        };

        const handleInteract = () => {
            if (!playing || uiLocked) return;
            const it = activeIt;
            if (!it) return;
            if (it.kind === "gateway") {
                if (it.active && it.sectorId && sectorBuilders[it.sectorId]) enterSector(it.sectorId);
                else openPanel({ kind: "soon", name: it.sectorName ?? "This area" });
            } else if (it.kind === "terminal" && it.contentIndex != null) {
                openPanel({ kind: "terminal", project: frontendProjects[it.contentIndex] });
            } else if (it.kind === "marker" && it.info) {
                openPanel({ kind: "info", content: it.info });
            }
        };

        const onClick = () => handleInteract();
        renderer.domElement.addEventListener("click", onClick);

        const onKeyDown = (e: KeyboardEvent) => {
            keys.add(e.code);
            if (e.code === "KeyE") handleInteract();
            if (e.code === "Escape" && panelOpen) closePanel();
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
                e.preventDefault();
            }
        };
        const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        // ---- expose API to React overlay ----
        apiRef.current = {
            start: () => {
                playing = true;
                setStarted(true);
            },
            interact: handleInteract,
            setDrive: (dir, on) => {
                drive[dir] = on;
            },
            closePanel,
            exitSector,
        };

        // ---- resize ----
        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", onResize);

        // ---- main loop ----
        let raf = 0;
        const clock = new THREE.Clock();
        let reportedKey: string | null = null;

        const loop = () => {
            const dt = Math.min(clock.getDelta(), 0.05);
            const t = clock.elapsedTime;

            // freeze driving while a panel is open or during a transition
            const controls = playing && !uiLocked;
            const accelInput = controls
                ? (keys.has("KeyW") || keys.has("ArrowUp") || drive.forward ? 1 : 0) -
                  (keys.has("KeyS") || keys.has("ArrowDown") || drive.back ? 1 : 0)
                : 0;
            const steerInput = controls
                ? (keys.has("KeyD") || keys.has("ArrowRight") || drive.right ? 1 : 0) -
                  (keys.has("KeyA") || keys.has("ArrowLeft") || drive.left ? 1 : 0)
                : 0;

            if (accelInput > 0) speed += ACCEL * dt;
            else if (accelInput < 0) speed -= ACCEL * dt;
            else {
                const drop = FRICTION * dt;
                speed = Math.abs(speed) <= drop ? 0 : speed - Math.sign(speed) * drop;
            }
            speed = Math.max(-REVERSE_SPEED, Math.min(MAX_SPEED, speed));

            const speedFactor = Math.min(1, Math.abs(speed) / 4);
            if (Math.abs(speed) > 0.01) {
                carYaw -= steerInput * TURN * dt * speedFactor * Math.sign(speed);
            }

            const fx = -Math.sin(carYaw);
            const fz = -Math.cos(carYaw);
            carPos.x += fx * speed * dt;
            carPos.z += fz * speed * dt;

            // keep the car inside the current area
            const bound = currentArea === "hub" ? HUB_BOUND : SECTOR_BOUND;
            const r = Math.hypot(carPos.x, carPos.z);
            if (r > bound) {
                carPos.x = (carPos.x / r) * bound;
                carPos.z = (carPos.z / r) * bound;
                speed *= 0.4;
            }
            car.position.set(carPos.x, 0, carPos.z);
            car.rotation.y = carYaw;

            // juice: bank into turns, pitch on accel, steer front wheels
            const turning = steerInput * speedFactor * Math.sign(speed || 1);
            chassis.rotation.z += (-turning * 0.13 - chassis.rotation.z) * 0.12;
            chassis.rotation.x += (-accelInput * 0.05 - chassis.rotation.x) * 0.1;
            const steerAngle = steerInput * 0.5;
            for (const p of frontPivots) p.rotation.y += (steerAngle - p.rotation.y) * 0.25;

            // follow camera: trails, pulls back + looks ahead with speed
            const absSpeed = Math.abs(speed);
            const dynDist = CAM_DIST + absSpeed * 0.14;
            const dynHeight = CAM_HEIGHT + absSpeed * 0.035;
            const lerp = 1 - Math.pow(0.0016, dt);
            camera.position.x += (carPos.x - fx * dynDist - camera.position.x) * lerp;
            camera.position.z += (carPos.z - fz * dynDist - camera.position.z) * lerp;
            camera.position.y += (dynHeight - camera.position.y) * lerp;
            const lookAhead = Math.max(0, speed) * 0.22;
            camera.lookAt(carPos.x + fx * lookAhead, 1.5, carPos.z + fz * lookAhead);

            const targetFov = 68 + Math.min(1, absSpeed / MAX_SPEED) * 14;
            if (Math.abs(camera.fov - targetFov) > 0.01) {
                camera.fov += (targetFov - camera.fov) * 0.08;
                camera.updateProjectionMatrix();
            }

            // nearest interactable in the current area → focus
            let nearestDist = Infinity;
            activeIt = null;
            for (const it of activeList) {
                const d = Math.hypot(carPos.x - it.x, carPos.z - it.z);
                if (d < nearestDist) {
                    nearestDist = d;
                    activeIt = d < (it.kind === "gateway" ? 9 : 8) ? it : null;
                }
            }

            // report prompt to React only when it changes
            const key = activeIt
                ? `${activeIt.kind}:${activeIt.sectorId ?? activeIt.contentIndex ?? activeIt.promptTitle}`
                : null;
            if (key !== reportedKey) {
                reportedKey = key;
                if (!activeIt) setPrompt(null);
                else if (activeIt.kind === "gateway") {
                    setPrompt({
                        title: activeIt.sectorName ?? "",
                        sub: activeIt.active ? activeIt.blurb ?? "" : "Coming soon",
                        action: activeIt.active ? "Enter" : "Preview",
                    });
                } else if (activeIt.kind === "terminal") {
                    const p = frontendProjects[activeIt.contentIndex ?? 0];
                    setPrompt({ title: p.title, sub: p.pitch, action: "View" });
                } else {
                    setPrompt({
                        title: activeIt.promptTitle ?? "",
                        sub: activeIt.promptSub ?? "",
                        action: "View",
                    });
                }
            }

            // halo highlight + terminal screen boot-up
            for (const it of activeList) {
                const isActive = it === activeIt;
                const hmat = it.halo.material as THREE.MeshBasicMaterial;
                hmat.opacity += ((isActive ? 0.6 + Math.sin(t * 4) * 0.12 : 0) - hmat.opacity) * 0.2;
                if (it.kind === "terminal" && it.screen) {
                    if (isActive) it.booted = true;
                    const smat = it.screen.material as THREE.MeshBasicMaterial;
                    smat.opacity += ((it.booted ? 1 : 0.12) - smat.opacity) * 0.12;
                }
            }

            // ambient motion (hub vs sector)
            if (!reduceMotion) {
                if (currentArea === "hub") {
                    if (orbs) orbs.rotation.y = t * 0.02;
                    for (const cloud of clouds) {
                        cloud.position.x += dt * 0.6;
                        if (cloud.position.x > 70) cloud.position.x = -70;
                    }
                } else {
                    const glyphs = activeScene.getObjectByName("glyphs");
                    if (glyphs) glyphs.rotation.y = t * 0.03;
                }
            }

            renderer.render(activeScene, camera);
            raf = requestAnimationFrame(loop);
        };
        placeCar(scene, hubSpawn.x, hubSpawn.z, hubSpawn.yaw);
        loop();

        // ---- cleanup ----
        return () => {
            cancelAnimationFrame(raf);
            renderer.domElement.removeEventListener("click", onClick);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("resize", onResize);
            sectorCache.forEach((s) => s.dispose());
            disposables.forEach((d) => d.dispose());
            renderer.dispose();
            apiRef.current = null;
            if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
        };
    }, []);

    return (
        <div className="field-root">
            <div ref={containerRef} className="field-canvas" />

            {/* proximity prompt */}
            {started && prompt && !panel && (
                <div className="field-prompt">
                    <div className="field-prompt-title">{prompt.title}</div>
                    <div className="field-prompt-sub">{prompt.sub}</div>
                    {isTouch ? (
                        <button type="button" className="field-open-btn" onClick={() => apiRef.current?.interact()}>
                            {prompt.action}
                        </button>
                    ) : (
                        <div className="field-prompt-hint">
                            Click or press E to {prompt.action.toLowerCase()}
                        </div>
                    )}
                </div>
            )}

            {/* docked InfoPanel */}
            {panel && (
                <div className="field-panel-backdrop" onClick={() => apiRef.current?.closePanel()}>
                    <div className="field-panel" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="field-panel-close"
                            aria-label="Close"
                            onClick={() => apiRef.current?.closePanel()}
                        >
                            ✕
                        </button>
                        {panel.kind === "terminal" ? (
                            <>
                                <h2 className="field-panel-title">{panel.project.title}</h2>
                                <p className="field-panel-pitch">{panel.project.pitch}</p>
                                <p className="field-panel-desc">{panel.project.description}</p>
                                <div className="field-panel-tags">
                                    {panel.project.tags.map((tag) => (
                                        <span key={tag} className="field-panel-tag">{tag}</span>
                                    ))}
                                </div>
                                <div className="field-panel-actions">
                                    {panel.project.liveUrl && (
                                        <a className="field-panel-link" href={panel.project.liveUrl} target="_blank" rel="noopener noreferrer">
                                            Live site ↗
                                        </a>
                                    )}
                                    {panel.project.repoUrl && (
                                        <a className="field-panel-link ghost" href={panel.project.repoUrl} target="_blank" rel="noopener noreferrer">
                                            GitHub ↗
                                        </a>
                                    )}
                                </div>
                            </>
                        ) : panel.kind === "info" ? (
                            <>
                                <h2 className="field-panel-title">{panel.content.title}</h2>
                                {panel.content.sub && <p className="field-panel-pitch">{panel.content.sub}</p>}
                                {panel.content.body && <p className="field-panel-desc">{panel.content.body}</p>}
                                {panel.content.tags && panel.content.tags.length > 0 && (
                                    <div className="field-panel-tags">
                                        {panel.content.tags.map((tag) => (
                                            <span key={tag} className="field-panel-tag">{tag}</span>
                                        ))}
                                    </div>
                                )}
                                {panel.content.links && panel.content.links.length > 0 && (
                                    <div className="field-panel-actions">
                                        {panel.content.links.map((l) => (
                                            <a key={l.url} className="field-panel-link" href={l.url} target="_blank" rel="noopener noreferrer">
                                                {l.label} ↗
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <h2 className="field-panel-title">{panel.name}</h2>
                                <p className="field-panel-desc">This sector is coming soon.</p>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* sector transition fade */}
            <div className={`field-transition ${transitioning ? "on" : ""}`} aria-hidden="true" />

            {/* sector banner + back-to-hub */}
            {started && area !== "hub" && (
                <>
                    <div className="field-sector-banner">{sectors.find((s) => s.id === area)?.name}</div>
                    <button type="button" className="field-back-btn" onClick={() => apiRef.current?.exitSector()}>
                        ← Hub
                    </button>
                </>
            )}

            {/* touch driving controls */}
            {started && isTouch && (
                <div className="field-drive-pad">
                    <button
                        type="button"
                        className="field-drive-btn steer"
                        aria-label="Steer left"
                        onTouchStart={() => apiRef.current?.setDrive("left", true)}
                        onTouchEnd={() => apiRef.current?.setDrive("left", false)}
                    >
                        ◄
                    </button>
                    <div className="field-drive-col">
                        <button
                            type="button"
                            className="field-drive-btn"
                            aria-label="Accelerate"
                            onTouchStart={() => apiRef.current?.setDrive("forward", true)}
                            onTouchEnd={() => apiRef.current?.setDrive("forward", false)}
                        >
                            ▲
                        </button>
                        <button
                            type="button"
                            className="field-drive-btn"
                            aria-label="Reverse"
                            onTouchStart={() => apiRef.current?.setDrive("back", true)}
                            onTouchEnd={() => apiRef.current?.setDrive("back", false)}
                        >
                            ▼
                        </button>
                    </div>
                    <button
                        type="button"
                        className="field-drive-btn steer"
                        aria-label="Steer right"
                        onTouchStart={() => apiRef.current?.setDrive("right", true)}
                        onTouchEnd={() => apiRef.current?.setDrive("right", false)}
                    >
                        ►
                    </button>
                </div>
            )}

            {/* exit link */}
            {started && (
                <Link href="/projects" className="field-exit">
                    ✕ Exit
                </Link>
            )}

            {/* start overlay */}
            {!started && (
                <div className="field-overlay">
                    <div className="field-overlay-card">
                        <p className="field-kicker">Interactive World</p>
                        <h1 className="field-overlay-title">Explore my world</h1>
                        <p className="field-overlay-desc">
                            Drive up to a glowing <b>gateway</b> to enter a sector, then roll up to a
                            terminal and {isTouch ? "tap the button" : "press E"} to read more.
                        </p>
                        <ul className="field-controls">
                            {isTouch ? (
                                <>
                                    <li><b>▲ / ▼</b> accelerate &amp; reverse</li>
                                    <li><b>◄ / ►</b> to steer</li>
                                    <li>Tap the prompt to <b>enter / view</b></li>
                                </>
                            ) : (
                                <>
                                    <li><b>W / ↑</b> drive · <b>S / ↓</b> reverse</li>
                                    <li><b>A D</b> or <b>← →</b> to steer</li>
                                    <li><b>Click</b> or <b>E</b> to enter / view</li>
                                </>
                            )}
                        </ul>
                        <button type="button" className="field-enter-btn" onClick={() => apiRef.current?.start()}>
                            {isTouch ? "Tap to drive" : "Start driving"}
                        </button>
                        <Link href="/projects" className="field-overlay-back">
                            or view the classic list →
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
