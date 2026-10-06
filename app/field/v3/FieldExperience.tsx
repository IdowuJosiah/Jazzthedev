"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Experience, detectRenderProfile } from "@/app/components/three/world3/Experience";
import { WorldStore, type WorldState } from "@/app/components/three/world3/State";
import { CONFIG, PALETTE } from "@/app/components/three/world3/Config";
import { meta } from "@/app/field/content/world";

// ─────────────────────────────────────────────────────────────────────────
// v3 shell (Step 0 stub). Mounts Experience through the frozen API and shows
// a minimal loader / start / failure overlay so /field?v=3 renders. W1-F
// replaces the overlay with the real UI (world.css, Hud, StartScreen, ...).
// ─────────────────────────────────────────────────────────────────────────

const root: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: PALETTE.background,
    color: PALETTE.ink,
    fontFamily: "system-ui, sans-serif",
};
const canvasStyle: CSSProperties = { display: "block", width: "100%", height: "100%" };
const overlay: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
};
const card: CSSProperties = {
    width: "min(480px, 100%)",
    background: PALETTE.paper,
    borderRadius: 16,
    padding: 24,
    boxShadow: "0 1px 2px rgba(36,34,43,.06), 0 8px 24px rgba(36,34,43,.10)",
    display: "flex",
    flexDirection: "column",
    gap: 16,
};
const primary: CSSProperties = {
    height: 48,
    padding: "0 24px",
    borderRadius: 12,
    border: 0,
    background: PALETTE.ink,
    color: PALETTE.paper,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    alignSelf: "flex-start",
};
const link: CSSProperties = { color: PALETTE.ink2, fontSize: 14 };

const FAIL_COPY: Record<NonNullable<WorldState["failReason"]>, string> = {
    webgl: "Your browser can't show the 3D world",
    "context-lost": "Graphics were reset",
    timeout: "This is taking longer than usual",
    asset: "Something didn't load",
};

function Loader({ state, onKeepWaiting }: { state: WorldState; onKeepWaiting: () => void }) {
    return (
        <div style={{ ...overlay, flexDirection: "column", gap: 16 }} role="status" aria-live="polite">
            <p style={{ margin: 0, fontSize: 56, fontWeight: 800 }}>{meta.heroWord}</p>
            <div style={{ width: 200, height: 4, borderRadius: 2, background: "rgba(36,34,43,.12)" }}>
                <div
                    style={{
                        width: `${Math.round(state.loadProgress * 100)}%`,
                        height: "100%",
                        borderRadius: 2,
                        background: PALETTE.ink,
                    }}
                />
            </div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: PALETTE.ink2 }}>{state.loadLabel}</p>
            {state.failReason === "timeout" && (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <span style={{ fontSize: 14 }}>{FAIL_COPY.timeout}</span>
                    <button
                        type="button"
                        onClick={onKeepWaiting}
                        style={{ ...link, background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" }}
                    >
                        Keep waiting
                    </button>
                    <Link href="/" style={link}>
                        Classic site
                    </Link>
                </div>
            )}
        </div>
    );
}

export default function FieldExperience() {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [store] = useState(() => new WorldStore());
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const isTouch = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
        const exp = new Experience(canvas, container, store);
        let disposed = false;

        if (new URLSearchParams(window.location.search).has("debug")) {
            (window as unknown as { __world3Store?: WorldStore }).__world3Store = store;
        }

        (async () => {
            store.set({ phase: "loading" });
            const profile = await detectRenderProfile();
            if (disposed) return;
            await exp.init({ profile, reducedMotion, isTouch });
        })();

        return () => {
            disposed = true;
            exp.dispose();
        };
    }, [store]);

    const failed = state.phase === "failed";
    const failReason = state.failReason;

    return (
        <div ref={containerRef} style={root}>
            <canvas
                ref={canvasRef}
                style={{
                    ...canvasStyle,
                    opacity: state.phase === "ready" || state.phase === "running" ? 1 : 0,
                    transition: `opacity ${CONFIG.loading.canvasFadeMs}ms linear`,
                }}
                tabIndex={0}
                aria-label="Interactive 3D portfolio world"
            />

            {(state.phase === "boot" || state.phase === "loading") && <Loader state={state} onKeepWaiting={() => store.set({ failReason: undefined })} />}

            {state.phase === "ready" && (
                <div style={overlay}>
                    <div style={card}>
                        <Link href="/" style={link}>
                            Skip to classic portfolio
                        </Link>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: ".08em" }}>
                            INTERACTIVE PORTFOLIO
                        </p>
                        <h1 style={{ margin: 0, fontSize: 40, lineHeight: "44px", fontWeight: 800 }}>
                            Drive through my work
                        </h1>
                        <p style={{ margin: 0, fontSize: 16, lineHeight: "24px", color: PALETTE.ink2 }}>
                            A small world of the projects, products and music I&apos;ve built. Drive up to anything
                            to open it.
                        </p>
                        <button type="button" style={primary} onClick={() => store.commands.start()}>
                            Start
                        </button>
                    </div>
                </div>
            )}

            {failed && (
                <div style={overlay}>
                    <div style={card} role="alert">
                        <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px", fontWeight: 800 }}>
                            {failReason ? FAIL_COPY[failReason] : FAIL_COPY.asset}
                        </h1>
                        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                            {failReason === "webgl" ? (
                                <Link href="/projects" style={{ ...primary, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                                    View projects
                                </Link>
                            ) : (
                                <button type="button" style={primary} onClick={() => window.location.reload()}>
                                    Reload
                                </button>
                            )}
                            <Link href="/" style={link}>
                                Classic site
                            </Link>
                        </div>
                    </div>
                </div>
            )}

            {state.phase === "running" && (
                <div style={{ position: "absolute", top: 16, left: 16, right: 16, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 20, fontWeight: 800 }}>{meta.heroWord}</span>
                    <Link href="/" style={{ ...link, background: PALETTE.paper, borderRadius: 12, padding: "10px 14px" }}>
                        Classic site
                    </Link>
                </div>
            )}
        </div>
    );
}
