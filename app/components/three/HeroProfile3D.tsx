"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const ACCENT = 0x1d4ed8;
const ACCENT_LIGHT = 0x3b82f6;

/**
 * Hero centerpiece: the profile photo as a circle in 3D space with two
 * blue rings orbiting it and a particle halo. The whole group parallaxes
 * toward the cursor. Raw three.js, fully disposed on unmount.
 */
export default function HeroProfile3D() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.set(0, 0, 6);

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        container.appendChild(renderer.domElement);

        const group = new THREE.Group();
        scene.add(group);

        // Profile photo as a camera-facing circle
        const texture = new THREE.TextureLoader().load("/images/profile.png");
        texture.colorSpace = THREE.SRGBColorSpace;
        const photo = new THREE.Mesh(
            new THREE.CircleGeometry(1.5, 64),
            new THREE.MeshBasicMaterial({ map: texture })
        );
        group.add(photo);

        // Orbiting rings
        const ring1 = new THREE.Mesh(
            new THREE.TorusGeometry(2.05, 0.028, 16, 140),
            new THREE.MeshBasicMaterial({ color: ACCENT })
        );
        ring1.rotation.x = 1.1;
        group.add(ring1);

        const ring2 = new THREE.Mesh(
            new THREE.TorusGeometry(2.35, 0.015, 16, 140),
            new THREE.MeshBasicMaterial({ color: ACCENT_LIGHT, transparent: true, opacity: 0.7 })
        );
        ring2.rotation.set(0.5, 0.6, 0);
        group.add(ring2);

        // Particle halo distributed on a spherical shell
        const particleCount = 280;
        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
            const r = 2.4 + Math.random() * 1.9;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
        }
        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const particles = new THREE.Points(
            particleGeo,
            new THREE.PointsMaterial({ color: ACCENT_LIGHT, size: 0.03, transparent: true, opacity: 0.85 })
        );
        group.add(particles);

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
            target.x = (e.clientX / window.innerWidth) * 2 - 1;
            target.y = (e.clientY / window.innerHeight) * 2 - 1;
        };
        if (!reduceMotion) window.addEventListener("mousemove", onMove);

        let raf = 0;
        const clock = new THREE.Clock();
        const render = () => {
            const t = clock.getElapsedTime();
            if (!reduceMotion) {
                ring1.rotation.z = t * 0.3;
                ring1.rotation.x = 1.1 + Math.sin(t * 0.2) * 0.15;
                ring2.rotation.z = -t * 0.24;
                ring2.rotation.y = 0.6 + Math.cos(t * 0.18) * 0.2;
                particles.rotation.y = t * 0.06;
                group.rotation.y += (target.x * 0.5 - group.rotation.y) * 0.05;
                group.rotation.x += (target.y * 0.3 - group.rotation.x) * 0.05;
            }
            renderer.render(scene, camera);
            raf = requestAnimationFrame(render);
        };
        render();

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener("mousemove", onMove);
            texture.dispose();
            photo.geometry.dispose();
            (photo.material as THREE.Material).dispose();
            ring1.geometry.dispose();
            (ring1.material as THREE.Material).dispose();
            ring2.geometry.dispose();
            (ring2.material as THREE.Material).dispose();
            particleGeo.dispose();
            (particles.material as THREE.Material).dispose();
            renderer.dispose();
            if (renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
        };
    }, []);

    return <div ref={containerRef} className="hero-canvas" aria-hidden="true" />;
}
