"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { sectors, frontendProjects, type Terminal } from "@/app/field/content/world";
import { type Interactable, type InfoContent } from "@/app/components/three/worldKit";
import { buildHub, type HubMap } from "@/app/components/three/hubKit";

const ACCENT = 0x1d4ed8;

type Toast = { id: number; text: string } | null;
type PromptInfo = { title: string; sub: string; action: string } | null;
type PanelInfo =
    | { kind: "terminal"; project: Terminal }
    | { kind: "info"; content: InfoContent }
    | { kind: "soon"; name: string }
    | null;

const MINIMAP_SIZE = 148;
const hexColor = (c: number, alpha = "") => "#" + c.toString(16).padStart(6, "0") + alpha;

/** North-up hub minimap: roads, districts (✓ once explored), and the car. */
function drawMinimap(
    canvas: HTMLCanvasElement,
    map: HubMap,
    x: number,
    z: number,
    yaw: number,
    visited: Set<string>
) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(MINIMAP_SIZE * dpr);
    if (canvas.width !== px) {
        canvas.width = canvas.height = px;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const half = MINIMAP_SIZE / 2;
    const k = (half - 4) / (map.bound + 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.save();
    ctx.translate(half, half);
    ctx.beginPath();
    ctx.arc(0, 0, half - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#5fb04a";
    ctx.fill();
    ctx.clip();

    for (const d of map.districts) {
        ctx.beginPath();
        ctx.arc(d.x * k, d.z * k, d.r * k, 0, Math.PI * 2);
        ctx.fillStyle = hexColor(d.color, "99");
        ctx.fill();
    }
    ctx.lineCap = "round";
    ctx.strokeStyle = "#4a5160";
    ctx.lineWidth = (map.ring[1] - map.ring[0]) * k;
    ctx.beginPath();
    ctx.arc(0, 0, ((map.ring[0] + map.ring[1]) / 2) * k, 0, Math.PI * 2);
    ctx.stroke();
    for (const [x1, z1, x2, z2, w] of map.roads) {
        ctx.lineWidth = w * k;
        ctx.beginPath();
        ctx.moveTo(x1 * k, z1 * k);
        ctx.lineTo(x2 * k, z2 * k);
        ctx.stroke();
    }
    {
        const [x1, z1, x2, z2, w] = map.lane;
        ctx.strokeStyle = "#e9cf9a";
        ctx.lineCap = "butt";
        ctx.lineWidth = w * k;
        ctx.beginPath();
        ctx.moveTo(x1 * k, z1 * k);
        ctx.lineTo(x2 * k, z2 * k);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, map.plaza * k, 0, Math.PI * 2);
    ctx.fillStyle = "#e3d3a4";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 3.5 * k, 0, Math.PI * 2);
    ctx.fillStyle = "#5ec8ff";
    ctx.fill();

    ctx.font = "700 10px Poppins, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const d of map.districts) {
        ctx.beginPath();
        ctx.arc(d.x * k, d.z * k, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = hexColor(d.color);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(visited.has(d.id) ? "✓" : d.name[0], d.x * k, d.z * k + 0.5);
    }

    // car arrow
    ctx.translate(x * k, z * k);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#141826";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();
}

/**
 * The field world. A drivable car (third-person follow-cam) explores a
 * single open park (see hubKit) where every sector lives out in the field
 * as its own themed district; drive up to a terminal / milestone / stage
 * and press E / click to open its InfoPanel. Raw three.js; disposed on unmount.
 */
export default function ProjectField() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [started, setStarted] = useState(false);
    const [isTouch, setIsTouch] = useState(false);
    const [prompt, setPrompt] = useState<PromptInfo>(null);
    const [panel, setPanel] = useState<PanelInfo>(null);
    const [explored, setExplored] = useState(0);
    const [toast, setToast] = useState<Toast>(null);
    const minimapRef = useRef<HTMLCanvasElement>(null);

    // Shared handles the scene exposes to React overlay buttons.
    const apiRef = useRef<{
        start: () => void;
        interact: () => void;
        setDrive: (dir: "forward" | "back" | "left" | "right", on: boolean) => void;
        closePanel: () => void;
        reset: () => void;
    } | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const touch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
        setIsTouch(touch);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        // ---- renderer / scene / camera ----
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.domElement.style.display = "block";
        container.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 400);

        // ---- disposable registry (car + effects; the hub disposes its own) ----
        const disposables: Array<{ dispose: () => void }> = [];
        const track = <T extends { dispose: () => void }>(o: T) => {
            disposables.push(o);
            return o;
        };
        const mat = (opts: THREE.MeshStandardMaterialParameters) =>
            track(new THREE.MeshStandardMaterial(opts));

        // ---- open-field world: hub layout + all sector districts, colliders, props ----
        const hub = buildHub();
        const scene = hub.scene;
        const hubInteractables = hub.interactables;

        // ---- drivable car (third-person, Bruno-Simon style) ----
        const car = new THREE.Group();
        // chassis leans/pitches for juice; wheels stay on the ground
        const chassis = new THREE.Group();
        car.add(chassis);
        // Cybertruck: faceted stainless wedge from an extruded side profile.
        // Forward is -Z; the profile is built along X (front→rear) then rotated.
        const CT_LEN = 3.4;
        const CT_BOTTOM = 0.34;
        const bodyMat = mat({ color: 0xd2d6de, metalness: 0.25, roughness: 0.5, flatShading: true });
        const glassMat = mat({ color: 0x0b0e16, metalness: 0.3, roughness: 0.12 });
        const extrudeBody = (pts: Array<[number, number]>, depth: number, material: THREE.Material) => {
            const shape = new THREE.Shape();
            shape.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
            shape.closePath();
            const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
            geo.translate(-CT_LEN / 2, 0, -depth / 2);
            track(geo);
            const mesh = new THREE.Mesh(geo, material);
            mesh.rotation.y = -Math.PI / 2; // profile X (length) → world Z
            mesh.castShadow = true;
            return mesh;
        };
        // lower stainless body
        chassis.add(
            extrudeBody(
                [[0.1, CT_BOTTOM], [0.0, 0.62], [0.66, 0.85], [3.02, 0.85], [3.4, 0.66], [3.4, CT_BOTTOM]],
                1.8,
                bodyMat
            )
        );
        // dark angular greenhouse (glass), inset so silver pillars show
        chassis.add(extrudeBody([[0.66, 0.85], [2.05, 1.34], [3.02, 0.85]], 1.6, glassMat));
        // signature full-width light bars
        const frontBar = new THREE.Mesh(
            track(new THREE.BoxGeometry(1.74, 0.09, 0.06)),
            mat({ color: 0xffffff, emissive: 0xe6f3ff, emissiveIntensity: 1.7 })
        );
        frontBar.position.set(0, 0.62, -CT_LEN / 2 + 0.02);
        chassis.add(frontBar);
        const rearBar = new THREE.Mesh(
            track(new THREE.BoxGeometry(1.74, 0.09, 0.06)),
            mat({ color: 0x5c0000, emissive: 0xff2b2b, emissiveIntensity: 1.3 })
        );
        rearBar.position.set(0, 0.6, CT_LEN / 2 - 0.02);
        chassis.add(rearBar);
        // subtle brand-blue underglow
        const underglow = new THREE.Mesh(
            track(new THREE.BoxGeometry(1.5, 0.04, 2.9)),
            mat({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.9 })
        );
        underglow.position.y = 0.16;
        chassis.add(underglow);

        // chunky wheels in steer pivots (front axle steers)
        const wheelGeo = track(new THREE.CylinderGeometry(0.46, 0.46, 0.42, 20));
        const wheelMat = mat({ color: 0x0c0d11, roughness: 0.8 });
        const hubGeo = track(new THREE.CylinderGeometry(0.2, 0.2, 0.44, 12));
        const hubMat = mat({ color: 0x9096a1, metalness: 0.4, roughness: 0.4 });
        const frontPivots: THREE.Group[] = [];
        for (const [wx, wz] of [[-0.92, 1.15], [0.92, 1.15], [-0.92, -1.15], [0.92, -1.15]] as const) {
            const pivot = new THREE.Group();
            pivot.position.set(wx, 0.46, wz);
            const w = new THREE.Mesh(wheelGeo, wheelMat);
            w.rotation.z = Math.PI / 2;
            w.castShadow = true;
            pivot.add(w);
            const hub = new THREE.Mesh(hubGeo, hubMat);
            hub.rotation.z = Math.PI / 2;
            pivot.add(hub);
            car.add(pivot);
            if (wz < 0) frontPivots.push(pivot);
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
        const BOOST_SPEED = 40;
        const REVERSE_SPEED = 12;
        const ACCEL = 36;
        const BOOST_ACCEL = 54;
        const FRICTION = 18;
        const TURN = 2.3;
        const CAM_DIST = 9;
        const CAM_HEIGHT = 5;

        let activeIt: Interactable | null = null;
        let panelOpen = false;
        let uiLocked = false; // panel open → freeze driving

        const hubSpawn = hub.spawn;
        const visitedSectors = new Set<string>();
        // sector-district centres, for the "explored on approach" counter
        const districtSpots = hub.map.districts.map((d) => ({ id: d.id, x: d.x, z: d.z, r: d.r }));
        const body = { pos: carPos, yaw: 0, speed: 0 };
        let shake = 0;
        let lastPins = 0;
        let toastId = 0;
        let toastTimer = 0;
        const showToast = (text: string) => {
            setToast({ id: ++toastId, text });
            clearTimeout(toastTimer);
            toastTimer = window.setTimeout(() => setToast(null), 1900);
        };

        // ---- dust puffs kicked up by the tyres (hub only) ----
        const dustTex = (() => {
            const c = document.createElement("canvas");
            c.width = c.height = 64;
            const g = c.getContext("2d")!;
            const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, "rgba(255,255,255,1)");
            grad.addColorStop(1, "rgba(255,255,255,0)");
            g.fillStyle = grad;
            g.fillRect(0, 0, 64, 64);
            return track(new THREE.CanvasTexture(c));
        })();
        const dust: Array<{ s: THREE.Sprite; life: number; vx: number; vz: number }> = [];
        for (let i = 0; i < 48; i++) {
            const s = new THREE.Sprite(
                track(new THREE.SpriteMaterial({ map: dustTex, color: 0xe6dfcc, transparent: true, opacity: 0, depthWrite: false }))
            );
            s.visible = false;
            scene.add(s);
            dust.push({ s, life: 0, vx: 0, vz: 0 });
        }
        let dustIdx = 0;
        let dustTimer = 0;
        const emitDust = (x: number, z: number, vx: number, vz: number) => {
            const p = dust[dustIdx++ % dust.length];
            p.life = 1;
            p.vx = vx + (Math.random() - 0.5) * 1.5;
            p.vz = vz + (Math.random() - 0.5) * 1.5;
            p.s.position.set(x, 0.3, z);
            p.s.visible = true;
        };

        // ---- Web Audio demo (Sector C) — generated tone, never autoplays ----
        let audioCtx: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        let freqData: Uint8Array<ArrayBuffer> | null = null;
        let bassOsc: OscillatorNode | null = null;
        let masterGain: GainNode | null = null;
        let arpTimer = 0;
        let audioOn = false;

        const startDemo = () => {
            if (audioOn) return;
            try {
                const AC =
                    window.AudioContext ||
                    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
                const ctx = new AC();
                audioCtx = ctx;
                void ctx.resume();
                analyser = ctx.createAnalyser();
                analyser.fftSize = 128;
                freqData = new Uint8Array(analyser.frequencyBinCount);
                masterGain = ctx.createGain();
                masterGain.gain.value = 0;
                masterGain.connect(analyser);
                analyser.connect(ctx.destination);
                // bass drone
                bassOsc = ctx.createOscillator();
                bassOsc.type = "sawtooth";
                bassOsc.frequency.value = 55;
                const bGain = ctx.createGain();
                bGain.gain.value = 0.12;
                bassOsc.connect(bGain);
                bGain.connect(masterGain);
                bassOsc.start();
                // arpeggiated melody
                const notes = [220, 277.18, 329.63, 440, 329.63, 277.18];
                let step = 0;
                arpTimer = window.setInterval(() => {
                    if (!audioCtx || !masterGain) return;
                    const now = audioCtx.currentTime;
                    const o = audioCtx.createOscillator();
                    o.type = "triangle";
                    o.frequency.value = notes[step % notes.length];
                    step++;
                    const g = audioCtx.createGain();
                    g.gain.setValueAtTime(0.0001, now);
                    g.gain.linearRampToValueAtTime(0.3, now + 0.02);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
                    o.connect(g);
                    g.connect(masterGain);
                    o.start(now);
                    o.stop(now + 0.4);
                }, 250);
                masterGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.3);
                audioOn = true;
            } catch {
                audioOn = false;
            }
        };
        const stopDemo = () => {
            audioOn = false;
            if (arpTimer) {
                clearInterval(arpTimer);
                arpTimer = 0;
            }
            try {
                bassOsc?.stop();
            } catch {
                /* already stopped */
            }
            bassOsc = null;
            const ctx = audioCtx;
            audioCtx = null;
            analyser = null;
            freqData = null;
            masterGain = null;
            if (ctx) ctx.close().catch(() => {});
        };

        const placeCar = (sx: number, sz: number, yaw: number) => {
            if (car.parent !== scene) scene.add(car);
            carPos.set(sx, 0, sz);
            carYaw = yaw;
            speed = 0;
            camera.position.set(sx + Math.sin(yaw) * CAM_DIST, CAM_HEIGHT, sz + Math.cos(yaw) * CAM_DIST);
            camera.lookAt(sx, 1.3, sz);
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

        const resetCar = () => {
            if (!playing || uiLocked) return;
            placeCar(hubSpawn.x, hubSpawn.z, hubSpawn.yaw);
            hub.resetProps();
            lastPins = 0;
        };

        const handleInteract = () => {
            if (!playing || uiLocked) return;
            const it = activeIt;
            if (!it) return;
            if (it.kind === "terminal" && it.contentIndex != null) {
                openPanel({ kind: "terminal", project: frontendProjects[it.contentIndex] });
            } else if (it.kind === "marker" && it.info) {
                openPanel({ kind: "info", content: it.info });
            } else if (it.kind === "audio") {
                if (audioOn) stopDemo();
                else startDemo();
            }
        };

        const onClick = () => handleInteract();
        renderer.domElement.addEventListener("click", onClick);

        const onKeyDown = (e: KeyboardEvent) => {
            keys.add(e.code);
            if (e.code === "KeyE") handleInteract();
            if (e.code === "KeyR" && !e.metaKey && !e.ctrlKey) resetCar();
            if (e.code === "Escape" && panelOpen) closePanel();
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
                e.preventDefault();
            }
        };
        const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        // If focus is lost (alt-tab, clicking away), a key-up can be missed and
        // the car would keep driving — so drop all held inputs on blur/hide.
        const clearInputs = () => {
            keys.clear();
            drive.forward = drive.back = drive.left = drive.right = false;
        };
        const onVisibility = () => {
            if (document.hidden) clearInputs();
        };
        window.addEventListener("blur", clearInputs);
        document.addEventListener("visibilitychange", onVisibility);

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
            reset: resetCar,
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

            const boosting = controls && accelInput > 0 && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
            const topSpeed = boosting ? BOOST_SPEED : MAX_SPEED;
            if (accelInput > 0) speed += (boosting ? BOOST_ACCEL : ACCEL) * dt;
            else if (accelInput < 0) speed -= ACCEL * dt;
            else {
                const drop = FRICTION * dt;
                speed = Math.abs(speed) <= drop ? 0 : speed - Math.sign(speed) * drop;
            }
            // over the normal top speed (boost released): bleed off gently
            if (speed > topSpeed) speed = Math.max(topSpeed, speed - FRICTION * 1.5 * dt);
            speed = Math.max(-REVERSE_SPEED, speed);

            const speedFactor = Math.min(1, Math.abs(speed) / 4);
            if (Math.abs(speed) > 0.01) {
                carYaw -= steerInput * TURN * dt * speedFactor * Math.sign(speed);
            }

            const fx = -Math.sin(carYaw);
            const fz = -Math.cos(carYaw);
            carPos.x += fx * speed * dt;
            carPos.z += fz * speed * dt;

            // bump into trees, lamps, fountain… and shove props
            body.yaw = carYaw;
            body.speed = speed;
            shake = Math.max(shake, hub.collide(body));
            speed = body.speed;

            // keep the car inside the park
            const bound = hub.map.bound;
            const r = Math.hypot(carPos.x, carPos.z);
            if (r > bound) {
                carPos.x = (carPos.x / r) * bound;
                carPos.z = (carPos.z / r) * bound;
                if (Math.abs(speed) > 8) shake = Math.max(shake, 0.25);
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
            if (shake > 0.01) {
                const k = reduceMotion ? 0.15 : 0.5;
                camera.position.x += (Math.random() - 0.5) * shake * k;
                camera.position.y += (Math.random() - 0.5) * shake * k;
                shake *= Math.exp(-7 * dt);
            }

            const targetFov = 64 + Math.min(1, absSpeed / MAX_SPEED) * 10 + (boosting ? 6 : 0);
            if (Math.abs(camera.fov - targetFov) > 0.01) {
                camera.fov += (targetFov - camera.fov) * 0.08;
                camera.updateProjectionMatrix();
            }

            // nearest interactable across the whole world → focus
            let nearestDist = Infinity;
            activeIt = null;
            for (const it of hubInteractables) {
                const d = Math.hypot(carPos.x - it.x, carPos.z - it.z);
                if (d < nearestDist) {
                    nearestDist = d;
                    activeIt = d < (it.kind === "audio" ? 12 : 8) ? it : null;
                }
            }

            // report prompt to React only when it changes
            const key = activeIt
                ? activeIt.kind === "audio"
                    ? `audio:${audioOn}`
                    : `${activeIt.kind}:${activeIt.sectorId ?? activeIt.contentIndex ?? activeIt.promptTitle}`
                : null;
            if (key !== reportedKey) {
                reportedKey = key;
                if (!activeIt) setPrompt(null);
                else if (activeIt.kind === "audio") {
                    setPrompt({
                        title: activeIt.promptTitle ?? "Live demo",
                        sub: audioOn ? "Playing — generated tone" : activeIt.promptSub ?? "",
                        action: audioOn ? "Stop demo" : "Play demo",
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
            for (const it of hubInteractables) {
                const isActive = it === activeIt;
                const hmat = it.halo.material as THREE.MeshBasicMaterial;
                hmat.opacity += ((isActive ? 0.6 + Math.sin(t * 4) * 0.12 : 0) - hmat.opacity) * 0.2;
                if (it.kind === "terminal" && it.screen) {
                    if (isActive) it.booted = true;
                    const smat = it.screen.material as THREE.MeshBasicMaterial;
                    smat.opacity += ((it.booted ? 1 : 0.12) - smat.opacity) * 0.12;
                }
            }

            {
                hub.update(t, dt, reduceMotion);

                // mark a sector "explored" when you drive into its area
                for (const dsp of districtSpots) {
                    if (!visitedSectors.has(dsp.id) && Math.hypot(carPos.x - dsp.x, carPos.z - dsp.z) < dsp.r) {
                        visitedSectors.add(dsp.id);
                        hub.markVisited(dsp.id);
                        setExplored(visitedSectors.size);
                    }
                }

                // tyre dust on hard launches, drifts and boosts
                const launching = accelInput > 0 && speed > 0.5 && speed < 12;
                const drifting = Math.abs(steerInput) > 0 && absSpeed > 14;
                dustTimer -= dt;
                if ((launching || drifting || boosting || shake > 0.3) && dustTimer <= 0) {
                    dustTimer = 0.035;
                    const rx = Math.cos(carYaw);
                    const rz = -Math.sin(carYaw);
                    for (const side of [-1, 1]) {
                        emitDust(
                            carPos.x - fx * 1.25 + rx * 0.92 * side,
                            carPos.z - fz * 1.25 + rz * 0.92 * side,
                            -fx * 2,
                            -fz * 2
                        );
                    }
                }
                for (const p of dust) {
                    if (p.life <= 0) continue;
                    p.life -= dt * 1.5;
                    if (p.life <= 0) {
                        p.s.visible = false;
                        continue;
                    }
                    p.s.position.x += p.vx * dt;
                    p.s.position.z += p.vz * dt;
                    p.s.position.y += dt * 0.6;
                    p.s.scale.setScalar(0.6 + (1 - p.life) * 1.8);
                    (p.s.material as THREE.SpriteMaterial).opacity = p.life * 0.5;
                }

                // bowling score
                const down = hub.pinsDown();
                if (down !== lastPins) {
                    if (down > lastPins) {
                        showToast(down === hub.pinCount ? "STRIKE! All pins down" : `${down} / ${hub.pinCount} pins down`);
                    }
                    lastPins = down;
                }

                const mm = minimapRef.current;
                if (mm) drawMinimap(mm, hub.map, carPos.x, carPos.z, carYaw, visitedSectors);
            }

            // ambient motion in the sector districts (orbs bob, stage lights sweep)
            if (!reduceMotion) {
                const orbGroup = scene.getObjectByName("orbs");
                if (orbGroup) {
                    orbGroup.children.forEach((o, i) => {
                        const baseY = (o.userData.baseY as number) ?? o.position.y;
                        o.position.y = baseY + Math.sin(t * 0.9 + i) * 0.18;
                    });
                }
                const sl = scene.getObjectByName("stagelights");
                if (sl) sl.rotation.y = t * 0.25;
            }

            // audio-reactive visualizer at the music stage (reacts only while
            // the user-triggered demo is playing)
            {
                const vis = scene.getObjectByName("visualizer");
                const pulseLight = scene.getObjectByName("pulse") as THREE.PointLight | null;
                if (vis) {
                    if (audioOn && analyser && freqData) {
                        analyser.getByteFrequencyData(freqData);
                        vis.children.forEach((bar, i) => {
                            const v = freqData![i % freqData!.length] / 255;
                            bar.scale.y = 0.4 + v * 7;
                            ((bar as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + v * 2.4;
                        });
                        if (pulseLight) pulseLight.intensity = 6 + (freqData[2] / 255) * 34;
                    } else if (!reduceMotion) {
                        vis.children.forEach((bar, i) => {
                            const target = 0.4 + (Math.sin(t * 2 + i * 0.4) * 0.5 + 0.5) * 0.6;
                            bar.scale.y += (target - bar.scale.y) * 0.1;
                        });
                    }
                }
            }

            renderer.render(scene, camera);
            raf = requestAnimationFrame(loop);
        };
        placeCar(hubSpawn.x, hubSpawn.z, hubSpawn.yaw);
        loop();

        // ---- cleanup ----
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(toastTimer);
            stopDemo();
            renderer.domElement.removeEventListener("click", onClick);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", clearInputs);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("resize", onResize);
            stopDemo();
            hub.dispose();
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

            {/* HUD: minimap, sectors explored, extra controls */}
            {started && (
                <div className="field-hud">
                    <canvas
                        ref={minimapRef}
                        className="field-minimap"
                        style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
                        aria-label="Map of the park"
                        role="img"
                    />
                    <div className="field-hud-chip">
                        <b>{explored}</b> / {sectors.length} sectors explored
                    </div>
                    <div className="field-hud-row">
                        {!isTouch && <span className="field-hud-keys">Shift boost · R reset</span>}
                        <button type="button" className="field-hud-btn" onClick={() => apiRef.current?.reset()}>
                            ↺ Reset
                        </button>
                    </div>
                </div>
            )}

            {/* transient toast (bowling score) */}
            {started && toast && (
                <div key={toast.id} className="field-toast" role="status">
                    {toast.text}
                </div>
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
                            Drive the open park and roll up to any area — projects, my journey,
                            Eko, and the music stage all live out here. Get close to something and
                            {isTouch ? " tap the button" : " press E"} to read more, or hit
                            <b> Play demo</b> at the stage. Watch the minimap — and try the bowling lane.
                        </p>
                        <ul className="field-controls">
                            {isTouch ? (
                                <>
                                    <li><b>▲ / ▼</b> accelerate &amp; reverse</li>
                                    <li><b>◄ / ►</b> to steer</li>
                                    <li>Tap the prompt to <b>view</b></li>
                                </>
                            ) : (
                                <>
                                    <li><b>W / ↑</b> drive · <b>S / ↓</b> reverse · <b>Shift</b> boost</li>
                                    <li><b>A D</b> or <b>← →</b> to steer · <b>R</b> reset</li>
                                    <li><b>Click</b> or <b>E</b> to view</li>
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
