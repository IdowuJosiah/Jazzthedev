"use client";

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import { CAMERA_YAW, CONFIG, PALETTE } from "../Config";
import { AREAS, BOUNDS, JETTY, PATHS, QUAY_Z, rectBounds } from "../Layout";
import type { WorldStore } from "../State";
import type { AreaId, Rect } from "../types";
import { areaCopy } from "@/app/field/content/world";
import { closeOnEscape, useFocusTrap } from "./Panels";

// ─────────────────────────────────────────────────────────────────────────
// Map modal (§6.2; replaces v2's Minimap). A vector canvas sized by a
// ResizeObserver at the UNCAPPED devicePixelRatio. The north-up drawing is
// turned by ctx.rotate(+π/4) so screen-up is world north-west, matching the
// fixed camera (north up-right, east down-right). Labels are drawn upright.
// The player arrow follows store.live through rAF (no React re-renders).
// Side list: all 9 areas with a visited tick and Travel.
// ─────────────────────────────────────────────────────────────────────────

/** Map drawing constants (CSS px unless noted). Stream-local: Config has no map block. */
export const MAP = {
    /** The north-up drawing is rotated by the camera yaw (+π/4). */
    rotation: CAMERA_YAW,
    /** Margin between the world extent and the canvas edge. */
    padding: 24,
    /** World units of lagoon shown past the jetty end. */
    lagoonMargin: 12,
    pathWidth: 4,
    pathStrokeWidth: 1,
    areaFillAlpha: 0.18,
    areaStrokeWidth: 2,
    boundsStrokeWidth: 1,
    labelFont: "600 13px",
    labelLineHeight: 16,
    arrowLength: 14,
    arrowHalfWidth: 6,
    arrowOutline: 2,
    line: "rgba(36,34,43,0.10)",
} as const;

export interface MapView {
    /** Canvas CSS size. */
    width: number;
    height: number;
    /** CSS px per world unit. */
    scale: number;
    /** Canvas position of world (0, 0) after rotation + scale. */
    tx: number;
    ty: number;
}

const COS = Math.cos(MAP.rotation);
const SIN = Math.sin(MAP.rotation);

/** World (x, z) → rotated map axes (canvas-style rotate(+θ), y down = world +z). */
export function rotateXZ(x: number, z: number): { u: number; v: number } {
    return { u: x * COS - z * SIN, v: x * SIN + z * COS };
}

/** The world region the map frames: playable bounds plus the jetty and a strip of lagoon. */
export function mapExtent(): Rect {
    const minZ = Math.min(BOUNDS.minZ, rectBounds(JETTY.rect).minZ) - MAP.lagoonMargin;
    return {
        x: (BOUNDS.minX + BOUNDS.maxX) / 2,
        z: (minZ + BOUNDS.maxZ) / 2,
        w: BOUNDS.maxX - BOUNDS.minX,
        d: BOUNDS.maxZ - minZ,
    };
}

/** Fits the rotated extent into a canvas of CSS size width × height. */
export function fitMap(width: number, height: number, extent: Rect = mapExtent()): MapView {
    const b = rectBounds(extent);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of [
        [b.minX, b.minZ],
        [b.maxX, b.minZ],
        [b.maxX, b.maxZ],
        [b.minX, b.maxZ],
    ]) {
        const { u, v } = rotateXZ(x, z);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
    }
    const availW = Math.max(1, width - 2 * MAP.padding);
    const availH = Math.max(1, height - 2 * MAP.padding);
    const scale = Math.min(availW / (maxU - minU), availH / (maxV - minV));
    return {
        width,
        height,
        scale,
        tx: width / 2 - scale * ((minU + maxU) / 2),
        ty: height / 2 - scale * ((minV + maxV) / 2),
    };
}

/** World (x, z) → canvas CSS px; identical to the ctx transform used for shapes. */
export function worldToMap(view: MapView, x: number, z: number): { x: number; y: number } {
    const { u, v } = rotateXZ(x, z);
    return { x: view.tx + view.scale * u, y: view.ty + view.scale * v };
}

/** Screen-space direction of the car's forward vector (sin yaw, cos yaw), unit length. */
export function headingOnMap(yaw: number): { x: number; y: number } {
    const { u, v } = rotateXZ(Math.sin(yaw), Math.cos(yaw));
    const l = Math.hypot(u, v) || 1;
    return { x: u / l, y: v / l };
}

const hexAlpha = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function drawMap(
    ctx: CanvasRenderingContext2D,
    view: MapView,
    dpr: number,
    fontFamily: string,
    player: { x: number; z: number; yaw: number }
) {
    const s = view.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, view.width, view.height);

    // World-space pass: translate → scale → rotate(+π/4); line widths in px / s.
    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(s, s);
    ctx.rotate(MAP.rotation);

    const W = CONFIG.world;
    // Playable ground.
    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(BOUNDS.minX, BOUNDS.minZ, BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ);
    ctx.strokeStyle = MAP.line;
    ctx.lineWidth = MAP.boundsStrokeWidth / s;
    ctx.strokeRect(BOUNDS.minX, BOUNDS.minZ, BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ);

    // Lagoon (north of the quay) and the jetty.
    ctx.fillStyle = PALETTE.waterShallow;
    ctx.fillRect(W.water.minX, W.water.minZ, W.water.maxX - W.water.minX, QUAY_Z - W.water.minZ);
    const j = rectBounds(JETTY.rect);
    ctx.fillStyle = PALETTE.wood;
    ctx.fillRect(j.minX, j.minZ, j.maxX - j.minX, j.maxZ - j.minZ);

    // Paths: a 1 px line-coloured edge under a 4 px path stroke.
    ctx.lineCap = "round";
    for (const pass of [0, 1] as const) {
        ctx.strokeStyle = pass === 0 ? MAP.line : PALETTE.path;
        ctx.lineWidth = (MAP.pathWidth + (pass === 0 ? 2 * MAP.pathStrokeWidth : 0)) / s;
        for (const p of PATHS) {
            ctx.beginPath();
            ctx.moveTo(p.from.x, p.from.z);
            ctx.lineTo(p.to.x, p.to.z);
            ctx.stroke();
        }
    }

    // Areas: accent at 18% with a 2 px accent stroke.
    ctx.lineWidth = MAP.areaStrokeWidth / s;
    for (const a of AREAS) {
        const r = rectBounds(a.rect);
        ctx.fillStyle = hexAlpha(a.accent, MAP.areaFillAlpha);
        ctx.fillRect(r.minX, r.minZ, a.rect.w, a.rect.d);
        ctx.strokeStyle = a.accent;
        ctx.strokeRect(r.minX, r.minZ, a.rect.w, a.rect.d);
    }
    ctx.restore();

    // Screen-space pass: upright labels, then the player arrow on top.
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `${MAP.labelFont} ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const a of AREAS) {
        const c = worldToMap(view, a.rect.x, a.rect.z);
        ctx.fillText(areaCopy[a.id].name, Math.round(c.x), Math.round(c.y));
    }

    const p = worldToMap(view, player.x, player.z);
    const f = headingOnMap(player.yaw);
    const n = { x: -f.y, y: f.x };
    const L = MAP.arrowLength;
    const H = MAP.arrowHalfWidth;
    ctx.beginPath();
    ctx.moveTo(p.x + f.x * (L / 2), p.y + f.y * (L / 2));
    ctx.lineTo(p.x - f.x * (L / 2) + n.x * H, p.y - f.y * (L / 2) + n.y * H);
    ctx.lineTo(p.x - f.x * (L / 4), p.y - f.y * (L / 4));
    ctx.lineTo(p.x - f.x * (L / 2) - n.x * H, p.y - f.y * (L / 2) - n.y * H);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = MAP.arrowOutline;
    ctx.strokeStyle = PALETTE.paper;
    ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.fill();
}

interface MapModalProps {
    store: WorldStore;
    visited: readonly AreaId[];
    areaId: AreaId | null;
    topmost: boolean;
    onTravel: (id: AreaId) => void;
    onClose: () => void;
}

export default function MapModal({ store, visited, areaId, topmost, onTravel, onClose }: MapModalProps) {
    const ref = useRef<HTMLElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const titleId = useId();
    useFocusTrap(ref, topmost);

    // Canvas: ResizeObserver at the uncapped DPR + an rAF redraw for the arrow.
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        let view = fitMap(1, 1);
        let dpr = 1;
        let fontFamily = "system-ui, sans-serif";

        const measure = () => {
            const rect = canvas.getBoundingClientRect();
            dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, rect.width);
            const h = Math.max(1, rect.height);
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            view = fitMap(w, h);
            fontFamily = getComputedStyle(canvas).fontFamily || fontFamily;
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(canvas);

        let raf = 0;
        const loop = () => {
            raf = requestAnimationFrame(loop);
            drawMap(ctx, view, dpr, fontFamily, store.live);
        };
        loop();
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
        };
    }, [store]);

    // M toggles the map closed (Controls ignores keys while focus is on a button).
    const onKeyDown = (e: ReactKeyboardEvent) => {
        if (e.key.toLowerCase() === "m" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
        }
        closeOnEscape(onClose)(e);
    };

    return (
        <div className="w3-modal-layer w3-map-layer">
            <div className="w3-scrim" onClick={onClose} aria-hidden="true" />
            <section
                ref={ref}
                className="w3-modal w3-map"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={onKeyDown}
            >
                <div className="w3-modal-head">
                    <h2 id={titleId} className="w3-h3">
                        Map
                    </h2>
                    <button type="button" className="w3-iconbtn" onClick={onClose} aria-label="Close map" aria-keyshortcuts="M">
                        <LuX size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="w3-map-body">
                    <div className="w3-map-canvas-wrap">
                        <canvas
                            ref={canvasRef}
                            className="w3-map-canvas"
                            role="img"
                            aria-label="Map of the world, north-west at the top. Use the list to travel."
                        />
                    </div>
                    <ul className="w3-map-list" aria-label="Areas">
                        {AREAS.map((a, i) => {
                            const seen = visited.includes(a.id);
                            const here = a.id === areaId;
                            return (
                                <li key={a.id}>
                                    <button
                                        type="button"
                                        className={`w3-travel${here ? " is-here" : ""}`}
                                        data-autofocus={i === 0 ? "" : undefined}
                                        onClick={() => onTravel(a.id)}
                                    >
                                        <span className="w3-dot" style={{ background: a.accent }} aria-hidden="true" />
                                        <span className="w3-travel-name">
                                            {areaCopy[a.id].name}
                                            <span className="w3-travel-meta">
                                                {here ? "You are here" : areaCopy[a.id].blurb}
                                            </span>
                                        </span>
                                        <span className="w3-travel-check">
                                            {seen && <LuCheck size={20} aria-hidden="true" />}
                                            <span className="w3-sr-only">{seen ? ", visited" : ", not visited yet"}</span>
                                        </span>
                                        <span className="w3-travel-go">Travel</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </section>
        </div>
    );
}
