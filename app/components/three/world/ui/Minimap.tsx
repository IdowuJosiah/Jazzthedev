"use client";

import { useEffect, useRef } from "react";
import type { Store } from "../State";

const SIZE = 164;
const VIEW = 175; // world units from centre shown to the map edge

/** Canvas minimap: island, districts (✓ when explored), and the player arrow. */
export default function Minimap({ store }: { store: Store }) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d")!;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = SIZE * dpr;
        canvas.height = SIZE * dpr;
        ctx.scale(dpr, dpr);
        const c = SIZE / 2;
        const scale = c / VIEW;
        let raf = 0;

        const toMap = (x: number, z: number) => ({ mx: c + x * scale, my: c + z * scale });

        const draw = () => {
            raf = requestAnimationFrame(draw);
            const { zones } = store.snapshot;
            const live = store.live;
            ctx.clearRect(0, 0, SIZE, SIZE);

            // water + island
            ctx.fillStyle = "rgba(18,33,63,0.9)";
            ctx.beginPath();
            ctx.arc(c, c, c - 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(29,36,64,0.95)";
            ctx.beginPath();
            ctx.arc(c, c, 150 * scale, 0, Math.PI * 2);
            ctx.fill();

            // zones
            for (const z of zones) {
                const { mx, my } = toMap(z.x, z.z);
                ctx.fillStyle = "#" + z.color.toString(16).padStart(6, "0");
                ctx.globalAlpha = z.visited ? 1 : 0.65;
                ctx.beginPath();
                ctx.arc(mx, my, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                if (z.visited) {
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.moveTo(mx - 2, my);
                    ctx.lineTo(mx - 0.5, my + 2);
                    ctx.lineTo(mx + 2.5, my - 2.5);
                    ctx.stroke();
                }
            }

            // player arrow
            const { mx, my } = toMap(live.x, live.z);
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(-live.angle);
            ctx.fillStyle = "#fff4e6";
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(4, 5);
            ctx.lineTo(0, 2.5);
            ctx.lineTo(-4, 5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // border
            ctx.strokeStyle = "rgba(130,150,220,0.4)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(c, c, c - 1, 0, Math.PI * 2);
            ctx.stroke();
        };
        draw();
        return () => cancelAnimationFrame(raf);
    }, [store]);

    return <canvas ref={ref} className="eko-minimap" style={{ width: SIZE, height: SIZE }} />;
}
