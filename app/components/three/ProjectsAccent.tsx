"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const ACCENT = 0x1d4ed8;
const ACCENT_LIGHT = 0x3b82f6;

/**
 * Floating wireframe icosahedron with a faint solid core, shown beside the
 * Projects page heading. Spins on its own and nudges toward the cursor.
 */
export default function ProjectsAccent() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.z = 5;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        container.appendChild(renderer.domElement);

        const shell = new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.6, 1),
            new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true })
        );
        scene.add(shell);

        const core = new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.15, 0),
            new THREE.MeshBasicMaterial({ color: ACCENT_LIGHT, transparent: true, opacity: 0.12 })
        );
        scene.add(core);

        const resize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(container);

        const target = { x: 0, y: 0 };
        const onMove = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            target.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            target.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
        };
        if (!reduceMotion) window.addEventListener("mousemove", onMove);

        let raf = 0;
        const clock = new THREE.Clock();
        const loop = () => {
            const t = clock.getElapsedTime();
            if (!reduceMotion) {
                shell.rotation.x = t * 0.2 + target.y * 0.25;
                shell.rotation.y = t * 0.28 + target.x * 0.3;
                core.rotation.x = -t * 0.15;
                core.rotation.y = t * 0.2;
            }
            renderer.render(scene, camera);
            raf = requestAnimationFrame(loop);
        };
        loop();

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener("mousemove", onMove);
            shell.geometry.dispose();
            (shell.material as THREE.Material).dispose();
            core.geometry.dispose();
            (core.material as THREE.Material).dispose();
            renderer.dispose();
            if (renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
        };
    }, []);

    return <div ref={containerRef} className="projects-accent-canvas" aria-hidden="true" />;
}
