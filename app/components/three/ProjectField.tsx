"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";

export interface FieldProject {
    title: string;
    subtitle: string;
    image: string;
    url: string | null;
}

const ACCENT = 0x1d4ed8;
const ACCENT_LIGHT = 0x3b82f6;

/**
 * A small walkable 3D field. Each project is a framed panel on a pedestal
 * arranged in an arc; walk up, look at one, and click / press E to open it.
 *
 * Raw three.js with hand-rolled pointer-lock FPS controls (desktop) and a
 * touch look + walk fallback (mobile). Everything is disposed on unmount.
 */
export default function ProjectField({ projects }: { projects: FieldProject[] }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [started, setStarted] = useState(false);
    const [paused, setPaused] = useState(false);
    const [isTouch, setIsTouch] = useState(false);
    const [active, setActive] = useState<number | null>(null);

    // Shared handles the R3-less scene exposes to React overlay buttons.
    const apiRef = useRef<{
        start: () => void;
        openActive: () => void;
        setForward: (on: boolean) => void;
    } | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const touch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
        setIsTouch(touch);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

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

        // ---- label helper (title drawn to a canvas texture) ----
        const makeLabel = (title: string, subtitle: string) => {
            const w = 1024;
            const h = 256;
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d")!;
            ctx.clearRect(0, 0, w, h);
            ctx.textAlign = "center";
            ctx.lineJoin = "round";
            // white outline keeps the title legible against sky or buildings
            ctx.strokeStyle = "rgba(255,255,255,0.92)";
            ctx.fillStyle = "#141826";
            ctx.font = "700 92px Poppins, system-ui, sans-serif";
            ctx.lineWidth = 12;
            ctx.strokeText(title, w / 2, 104);
            ctx.fillText(title, w / 2, 104);
            ctx.font = "500 44px Poppins, system-ui, sans-serif";
            ctx.lineWidth = 8;
            ctx.strokeText(subtitle, w / 2, 180);
            ctx.fillStyle = "#1d4ed8";
            ctx.fillText(subtitle, w / 2, 180);
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            track(tex);
            const mat = track(new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
            const geo = track(new THREE.PlaneGeometry(4.2, 1.05));
            return new THREE.Mesh(geo, mat);
        };

        // ---- build project stations ----
        const loader = new THREE.TextureLoader();
        const interactables: THREE.Mesh[] = [];
        const stations: Array<{ group: THREE.Group; baseY: number; phase: number }> = [];

        const count = projects.length;
        const radius = 13;
        const spread = Math.PI * 1.15; // arc in front of the spawn
        const start = -spread / 2 - Math.PI / 2;

        const panelW = 4.4;
        const panelH = 2.9;

        projects.forEach((project, i) => {
            const angle = count > 1 ? start + (spread * i) / (count - 1) : -Math.PI / 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            const group = new THREE.Group();
            group.position.set(x, 0, z);
            // face the center (spawn point)
            group.lookAt(0, 0, 0);

            // pedestal
            const pedestal = new THREE.Mesh(
                track(new THREE.BoxGeometry(1.1, 1.2, 1.1)),
                track(new THREE.MeshStandardMaterial({ color: dark ? 0x1b2136 : 0x2a2f45, roughness: 0.7 }))
            );
            pedestal.position.y = 0.6;
            pedestal.castShadow = true;
            group.add(pedestal);

            // post
            const post = new THREE.Mesh(
                track(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 12)),
                track(new THREE.MeshStandardMaterial({ color: 0x3a3f57 }))
            );
            post.position.y = 1.9;
            group.add(post);

            const panelGroup = new THREE.Group();
            panelGroup.position.y = 3.0;

            // blue backing frame
            const frame = new THREE.Mesh(
                track(new THREE.BoxGeometry(panelW + 0.28, panelH + 0.28, 0.12)),
                track(new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.35, metalness: 0.1 }))
            );
            panelGroup.add(frame);

            // image panel
            const tex = track(loader.load(project.image));
            tex.colorSpace = THREE.SRGBColorSpace;
            const panel = new THREE.Mesh(
                track(new THREE.PlaneGeometry(panelW, panelH)),
                track(new THREE.MeshBasicMaterial({ map: tex }))
            );
            panel.position.z = 0.08;
            panel.userData.index = i;
            panelGroup.add(panel);
            interactables.push(panel);

            // glow ring shown when focused
            const halo = new THREE.Mesh(
                track(new THREE.PlaneGeometry(panelW + 0.9, panelH + 0.9)),
                track(new THREE.MeshBasicMaterial({ color: ACCENT_LIGHT, transparent: true, opacity: 0 }))
            );
            halo.position.z = -0.12;
            halo.userData.isHalo = true;
            panelGroup.add(halo);

            // label above
            const label = makeLabel(project.title, project.subtitle);
            label.position.y = panelH / 2 + 0.85;
            panelGroup.add(label);

            group.add(panelGroup);
            scene.add(group);

            stations.push({ group: panelGroup, baseY: panelGroup.position.y, phase: i * 1.7 });
        });

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

        // ---- controls state ----
        const keys = new Set<string>();
        const move = { forward: false }; // touch forward button
        let yaw = 0;
        let pitch = 0;
        const euler = new THREE.Euler(0, 0, 0, "YXZ");
        const velocity = new THREE.Vector3();
        const BOUND = 34;
        const SPEED = 9;

        let locked = false;
        let dragLook = false; // fallback when pointer lock is unavailable
        let dragging = false;
        let movedDist = 0;
        let playing = false; // true while the player is actively in the scene
        let activeIndex: number | null = null;

        const applyLook = () => {
            pitch = Math.max(-1.2, Math.min(1.2, pitch));
            euler.set(pitch, yaw, 0);
            camera.quaternion.setFromEuler(euler);
        };
        applyLook();

        const openActive = () => {
            if (activeIndex === null) return;
            const url = projects[activeIndex]?.url;
            if (url) window.open(url, "_blank", "noopener,noreferrer");
        };

        const enterDragMode = () => {
            dragLook = true;
            playing = true;
            setStarted(true);
            setPaused(false);
        };

        // ---- desktop pointer lock (with drag fallback) ----
        const onPointerMove = (e: MouseEvent) => {
            if (locked) {
                yaw -= e.movementX * 0.0022;
                pitch -= e.movementY * 0.0022;
                applyLook();
            } else if (dragLook && dragging) {
                yaw -= e.movementX * 0.0026;
                pitch -= e.movementY * 0.0026;
                movedDist += Math.abs(e.movementX) + Math.abs(e.movementY);
                applyLook();
            }
        };
        const onMouseDown = (e: MouseEvent) => {
            if (dragLook && e.button === 0) {
                dragging = true;
                movedDist = 0;
            }
        };
        const onMouseUp = () => {
            if (dragLook && dragging) {
                dragging = false;
                if (movedDist < 6) openActive(); // a click, not a drag
            }
        };
        const onLockChange = () => {
            locked = document.pointerLockElement === renderer.domElement;
            if (locked) {
                playing = true;
                setStarted(true);
                setPaused(false);
            } else if (!touch && !dragLook) {
                playing = false;
                setPaused(true);
            }
        };
        document.addEventListener("pointerlockchange", onLockChange);
        document.addEventListener("mousemove", onPointerMove);
        renderer.domElement.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mouseup", onMouseUp);

        const onClick = () => {
            if (locked) openActive();
        };
        renderer.domElement.addEventListener("click", onClick);

        const onKeyDown = (e: KeyboardEvent) => {
            keys.add(e.code);
            if (e.code === "KeyE") openActive();
        };
        const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        // ---- touch controls (look by dragging, walk via button) ----
        let lastTouch: { x: number; y: number } | null = null;
        const onTouchStart = (e: TouchEvent) => {
            const t = e.touches[0];
            lastTouch = { x: t.clientX, y: t.clientY };
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!lastTouch) return;
            const t = e.touches[0];
            yaw -= (t.clientX - lastTouch.x) * 0.005;
            pitch -= (t.clientY - lastTouch.y) * 0.005;
            applyLook();
            lastTouch = { x: t.clientX, y: t.clientY };
        };
        const onTouchEnd = () => {
            lastTouch = null;
        };
        if (touch) {
            renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
            renderer.domElement.addEventListener("touchmove", onTouchMove, { passive: true });
            renderer.domElement.addEventListener("touchend", onTouchEnd);
        }

        // ---- expose API to React overlay ----
        apiRef.current = {
            start: () => {
                if (touch) {
                    playing = true;
                    setStarted(true);
                    setPaused(false);
                    return;
                }
                // Try pointer lock; fall back to drag-look if it's blocked
                // (embedded frames, some browsers).
                try {
                    const result = renderer.domElement.requestPointerLock() as unknown as
                        | Promise<void>
                        | undefined;
                    if (result && typeof result.then === "function") {
                        result.then(undefined, () => enterDragMode());
                    }
                } catch {
                    enterDragMode();
                }
                window.setTimeout(() => {
                    if (!locked && !dragLook) enterDragMode();
                }, 400);
            },
            openActive,
            setForward: (on: boolean) => {
                move.forward = on;
            },
        };

        // ---- resize ----
        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", onResize);

        // ---- interaction raycaster ----
        const raycaster = new THREE.Raycaster();
        const forwardVec = new THREE.Vector3();

        // ---- main loop ----
        let raf = 0;
        const clock = new THREE.Clock();
        let reportedActive: number | null = null;

        const loop = () => {
            const dt = Math.min(clock.getDelta(), 0.05);
            const t = clock.elapsedTime;
            const canMove = playing;

            // movement
            const dir = new THREE.Vector3();
            if (canMove) {
                if (keys.has("KeyW") || keys.has("ArrowUp") || move.forward) dir.z -= 1;
                if (keys.has("KeyS") || keys.has("ArrowDown")) dir.z += 1;
                if (keys.has("KeyA") || keys.has("ArrowLeft")) dir.x -= 1;
                if (keys.has("KeyD") || keys.has("ArrowRight")) dir.x += 1;
            }
            const damp = 1 - Math.min(1, dt * 10);
            velocity.x *= damp;
            velocity.z *= damp;
            if (dir.lengthSq() > 0) {
                dir.normalize();
                // rotate by yaw into world space
                const sin = Math.sin(yaw);
                const cos = Math.cos(yaw);
                const wx = dir.x * cos - dir.z * sin;
                const wz = dir.x * sin + dir.z * cos;
                velocity.x += wx * SPEED * dt;
                velocity.z += wz * SPEED * dt;
            }
            camera.position.x += velocity.x * dt * 6;
            camera.position.z += velocity.z * dt * 6;
            camera.position.x = Math.max(-BOUND, Math.min(BOUND, camera.position.x));
            camera.position.z = Math.max(-BOUND, Math.min(BOUND, camera.position.z));
            camera.position.y = EYE;

            // idle float on stations + halo fade
            stations.forEach((s, i) => {
                if (!reduceMotion) s.group.position.y = s.baseY + Math.sin(t * 0.9 + s.phase) * 0.12;
                const halo = s.group.children.find((c) => (c as THREE.Mesh).userData.isHalo) as THREE.Mesh | undefined;
                if (halo) {
                    const targetOpacity = activeIndex === i ? 0.55 + Math.sin(t * 4) * 0.12 : 0;
                    const mat = halo.material as THREE.MeshBasicMaterial;
                    mat.opacity += (targetOpacity - mat.opacity) * 0.2;
                }
            });
            if (orbs && !reduceMotion) orbs.rotation.y = t * 0.02;

            // drift clouds slowly and wrap them around the park
            if (!reduceMotion) {
                for (const cloud of clouds) {
                    cloud.position.x += dt * 0.6;
                    if (cloud.position.x > 70) cloud.position.x = -70;
                }
            }

            // focus raycast from screen center
            camera.getWorldDirection(forwardVec);
            raycaster.set(camera.position, forwardVec);
            raycaster.far = 20;
            const hits = raycaster.intersectObjects(interactables, false);
            activeIndex = hits.length > 0 ? (hits[0].object.userData.index as number) : null;

            if (activeIndex !== reportedActive) {
                reportedActive = activeIndex;
                setActive(activeIndex);
            }

            renderer.render(scene, camera);
            raf = requestAnimationFrame(loop);
        };
        loop();

        // ---- cleanup ----
        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener("pointerlockchange", onLockChange);
            document.removeEventListener("mousemove", onPointerMove);
            renderer.domElement.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);
            renderer.domElement.removeEventListener("click", onClick);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("resize", onResize);
            renderer.domElement.removeEventListener("touchstart", onTouchStart);
            renderer.domElement.removeEventListener("touchmove", onTouchMove);
            renderer.domElement.removeEventListener("touchend", onTouchEnd);
            if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            disposables.forEach((d) => d.dispose());
            renderer.dispose();
            apiRef.current = null;
            if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
        };
        // projects is stable for the lifetime of the page
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const activeProject = active !== null ? projects[active] : null;

    return (
        <div className="field-root">
            <div ref={containerRef} className="field-canvas" />

            {/* crosshair (desktop, while playing) */}
            {started && !paused && !isTouch && <div className="field-reticle" aria-hidden="true" />}

            {/* focused-project prompt */}
            {started && activeProject && (
                <div className="field-prompt">
                    <div className="field-prompt-title">{activeProject.title}</div>
                    <div className="field-prompt-sub">{activeProject.subtitle}</div>
                    {activeProject.url ? (
                        isTouch ? (
                            <button type="button" className="field-open-btn" onClick={() => apiRef.current?.openActive()}>
                                Open project ↗
                            </button>
                        ) : (
                            <div className="field-prompt-hint">Click or press E to open ↗</div>
                        )
                    ) : (
                        <div className="field-prompt-hint muted">Coming soon</div>
                    )}
                </div>
            )}

            {/* touch move button */}
            {started && isTouch && (
                <button
                    type="button"
                    className="field-walk-btn"
                    aria-label="Walk forward"
                    onTouchStart={() => apiRef.current?.setForward(true)}
                    onTouchEnd={() => apiRef.current?.setForward(false)}
                >
                    ▲ Walk
                </button>
            )}

            {/* exit link */}
            {started && (
                <Link href="/projects" className="field-exit">
                    ✕ Exit
                </Link>
            )}

            {/* start / paused overlay */}
            {(!started || paused) && (
                <div className="field-overlay">
                    <div className="field-overlay-card">
                        <p className="field-kicker">Interactive Gallery</p>
                        <h1 className="field-overlay-title">Walk through my work</h1>
                        <p className="field-overlay-desc">
                            Stroll around the field and walk up to any project. Look at it and
                            {isTouch ? " tap Open" : " click (or press E)"} to visit the live site.
                        </p>
                        <ul className="field-controls">
                            {isTouch ? (
                                <>
                                    <li>Drag anywhere to look around</li>
                                    <li>Hold <b>▲ Walk</b> to move</li>
                                    <li>Tap <b>Open</b> when a project is centered</li>
                                </>
                            ) : (
                                <>
                                    <li><b>W A S D</b> / arrows to move</li>
                                    <li><b>Mouse</b> to look around</li>
                                    <li><b>Click</b> / <b>E</b> to open · <b>Esc</b> to pause</li>
                                </>
                            )}
                        </ul>
                        <button type="button" className="field-enter-btn" onClick={() => apiRef.current?.start()}>
                            {paused ? "Resume" : isTouch ? "Tap to start" : "Click to enter"}
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
