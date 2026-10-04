"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Store } from "@/app/components/three/world/State";
import { Experience } from "@/app/components/three/world/Experience";
import type { QualityTier } from "@/app/components/three/world/Config";
import Minimap from "@/app/components/three/world/ui/Minimap";
import TouchControls from "@/app/components/three/world/ui/TouchControls";
import { ContentPanel, MenuOverlay } from "@/app/components/three/world/ui/Panels";

type Tab = "travel" | "settings" | "controls" | "credits";

/** rAF-driven speed/fps readout — reads the live channel without re-rendering. */
function LiveReadout({ store }: { store: Store }) {
    const spd = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        let raf = 0;
        const loop = () => {
            raf = requestAnimationFrame(loop);
            if (spd.current) spd.current.textContent = String(store.live.speedKmh);
        };
        loop();
        return () => cancelAnimationFrame(raf);
    }, [store]);
    return (
        <div className="ekoworld-speed">
            <span ref={spd}>0</span>
            <span className="ekoworld-speed-unit">km/h</span>
        </div>
    );
}

export default function FieldExperience() {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [store] = useState(() => new Store());
    const [isTouch] = useState(
        () =>
            typeof window !== "undefined" &&
            (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window)
    );
    const [menuTab, setMenuTab] = useState<Tab>("travel");

    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        store.set({ reducedMotion });

        let disposed = false;
        const exp = new Experience(canvas, container, store);

        // Debug hook: expose the store for tuning/testing when ?debug is set.
        if (new URLSearchParams(window.location.search).has("debug")) {
            (window as unknown as { __ekoStore?: Store }).__ekoStore = store;
        }

        (async () => {
            let quality: QualityTier = "high";
            try {
                const { getGPUTier } = await import("detect-gpu");
                const tier = await getGPUTier();
                quality = tier.tier >= 3 ? "high" : tier.tier === 2 ? "medium" : "low";
                if (tier.isMobile && quality === "high") quality = "medium";
            } catch {
                /* keep default */
            }
            if (disposed) return;
            store.set({ quality });
            await exp.init(quality, reducedMotion);
        })();

        return () => {
            disposed = true;
            exp.dispose();
        };
    }, [store]);

    const openMenu = (tab: Tab) => {
        setMenuTab(tab);
        store.commands.setPaused?.(true);
    };
    const running = state.phase === "running";

    return (
        <div ref={containerRef} className="ekoworld-root">
            <canvas ref={canvasRef} className="ekoworld-canvas" />

            {/* Loading */}
            {state.phase === "loading" && (
                <div className="ekoworld-overlay">
                    <div className="ekoworld-loadbox">
                        <p className="ekoworld-kicker">ÈKÓ NIGHTS</p>
                        <p className="ekoworld-loadlabel">{state.loadLabel}…</p>
                        <div className="ekoworld-loadbar">
                            <span style={{ width: `${Math.round(state.loadProgress * 100)}%` }} />
                        </div>
                    </div>
                </div>
            )}

            {/* Start */}
            {state.phase === "ready" && !state.webglFailed && (
                <div className="ekoworld-overlay">
                    <div className="ekoworld-loadbox">
                        <p className="ekoworld-kicker">ÈKÓ NIGHTS</p>
                        <h1 className="ekoworld-title">Drive my world</h1>
                        <p className="ekoworld-sub">
                            A neon night island of my work. Pull up to a district to explore it, collect
                            Yoruba words, and find the hidden playground.
                        </p>
                        <button className="ekoworld-enter" onClick={() => store.commands.start?.()}>
                            Enter ▸
                        </button>
                        <p className="ekoworld-controls-hint">
                            WASD / arrows · Shift boost · Space drift · E interact · Esc menu
                        </p>
                        <a className="ekoworld-skip" href="/projects">
                            or skip to the classic portfolio →
                        </a>
                    </div>
                </div>
            )}

            {/* WebGL fallback */}
            {state.webglFailed && (
                <div className="ekoworld-overlay">
                    <div className="ekoworld-loadbox">
                        <h1 className="ekoworld-title">3D isn’t available</h1>
                        <p className="ekoworld-sub">
                            Your browser couldn’t start WebGL. The full portfolio is right here.
                        </p>
                        <a className="ekoworld-enter" href="/projects">
                            View projects →
                        </a>
                    </div>
                </div>
            )}

            {/* HUD */}
            {running && !state.photoMode && (
                <div className="ekoworld-hud">
                    <div className="eko-hud-topleft">
                        <Minimap store={store} />
                        <div className="eko-collect">
                            <span className="eko-collect-icon">◈</span>
                            {state.collectiblesFound}
                            <span className="eko-collect-total">/ {state.collectiblesTotal} words</span>
                        </div>
                    </div>

                    <div className="eko-hud-topright">
                        <button className="eko-hud-btn" onClick={() => openMenu("travel")} aria-label="Menu" title="Menu (Esc)">☰</button>
                        <button className="eko-hud-btn" onClick={() => store.commands.setMuted?.(!state.muted)} aria-label="Sound" title="Mute (M)">
                            {state.muted ? "🔇" : "🔊"}
                        </button>
                        <button className="eko-hud-btn" onClick={() => store.commands.togglePhotoMode?.()} aria-label="Photo" title="Photo mode (P)">◉</button>
                    </div>

                    {state.prompt && (
                        <div className="eko-prompt">
                            <span className="eko-prompt-key">E</span>
                            <span className="eko-prompt-text">
                                <strong>{state.prompt.title}</strong>
                                <em>{state.prompt.sub}</em>
                            </span>
                        </div>
                    )}

                    <LiveReadout store={store} />
                </div>
            )}

            {/* Photo mode */}
            {running && state.photoMode && (
                <div className="eko-photo">
                    <div className="eko-photo-bar eko-photo-top" />
                    <div className="eko-photo-bar eko-photo-bottom" />
                    <div className="eko-photo-actions">
                        <button className="eko-hud-btn" onClick={() => store.commands.capturePhoto?.()}>⤓ Capture</button>
                        <button className="eko-hud-btn" onClick={() => store.commands.togglePhotoMode?.()}>Exit</button>
                    </div>
                </div>
            )}

            {/* Touch controls */}
            {running && isTouch && !state.panel && !state.paused && !state.photoMode && (
                <TouchControls store={store} />
            )}

            {/* Pause / menu */}
            {state.paused && (
                <MenuOverlay
                    store={store}
                    state={state}
                    tab={menuTab}
                    setTab={setMenuTab}
                    onResume={() => store.commands.setPaused?.(false)}
                />
            )}

            {/* Content panel */}
            {state.panel && (
                <ContentPanel content={state.panel} onClose={() => store.commands.closePanel?.()} />
            )}
        </div>
    );
}
