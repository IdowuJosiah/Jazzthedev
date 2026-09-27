"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const ACCENT = 0x1d4ed8;

/**
 * Ambient, site-wide particle field fixed behind all content. Slow drift
 * plus a gentle camera parallax toward the cursor. Deliberately subtle.
 */
export default function SiteBackground() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.z = 8;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.domElement.style.display = "block";
        container.appendChild(renderer.domElement);

        const count = 340;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 22;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: ACCENT,
            size: 0.035,
            transparent: true,
            opacity: 0.55,
        });
        const points = new THREE.Points(geo, mat);
        scene.add(points);

        const target = { x: 0, y: 0 };
        const onMove = (e: MouseEvent) => {
            target.x = (e.clientX / window.innerWidth) * 2 - 1;
            target.y = (e.clientY / window.innerHeight) * 2 - 1;
        };
        if (!reduceMotion) window.addEventListener("mousemove", onMove);

        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", onResize);

        let raf = 0;
        const clock = new THREE.Clock();
        const loop = () => {
            const t = clock.getElapsedTime();
            if (!reduceMotion) {
                points.rotation.y = t * 0.02;
                points.rotation.x = Math.sin(t * 0.05) * 0.05;
                camera.position.x += (target.x * 0.6 - camera.position.x) * 0.03;
                camera.position.y += (-target.y * 0.4 - camera.position.y) * 0.03;
                camera.lookAt(0, 0, 0);
            }
            renderer.render(scene, camera);
            raf = requestAnimationFrame(loop);
        };
        loop();

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("resize", onResize);
            geo.dispose();
            mat.dispose();
            renderer.dispose();
            if (renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
        };
    }, []);

    return <div ref={containerRef} className="site-bg-canvas" aria-hidden="true" />;
}
