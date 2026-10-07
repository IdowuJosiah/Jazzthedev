"use client";

import "./world.css";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Experience, detectRenderProfile } from "@/app/components/three/world3/Experience";
import { WorldStore } from "@/app/components/three/world3/State";
import { CONFIG } from "@/app/components/three/world3/Config";
import type { AreaId } from "@/app/components/three/world3/types";
import Hud, { Announcer, PhotoBar } from "@/app/components/three/world3/ui/Hud";
import { Loader, StartCard, mutedOnStart, readSoundPref, writeSoundPref } from "@/app/components/three/world3/ui/StartScreen";
import { ContentPanel, MenuModal } from "@/app/components/three/world3/ui/Panels";
import MapModal from "@/app/components/three/world3/ui/MapModal";
import TouchControls from "@/app/components/three/world3/ui/TouchControls";
import FailCard from "@/app/components/three/world3/ui/FailCard";

// ─────────────────────────────────────────────────────────────────────────
// v3 shell. Mounts Experience through the frozen API (constructor → init →
// interact / dispose), mirrors the WorldStore into React with
// useSyncExternalStore, and wires the HTML UI (§6) to store.commands.
//
// Layer order (bottom → top): canvas, HUD, touch, panel, map, menu, then the
// loader / start / failure overlays. Dialogs render only while the world runs,
// so a failure card never sits over a hidden dialog that holds the focus trap.
// Only the topmost dialog traps focus; when the last one closes, focus returns
// to the canvas so WASD keeps working.
// ─────────────────────────────────────────────────────────────────────────

const detectTouch = () =>
    window.matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints ?? 0) > 0;

export default function FieldExperience() {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [store] = useState(() => new WorldStore());
    const [localTouch] = useState(detectTouch);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    // ── Engine lifecycle ─────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        const exp = new Experience(canvas, container, store);
        let disposed = false;

        // interact() must stay synchronous inside the key / click handler (§4.3).
        store.wire({ interact: () => exp.interact() });

        if (new URLSearchParams(window.location.search).has("debug")) {
            (window as unknown as { __world3Store?: WorldStore }).__world3Store = store;
        }

        const onMotionChange = (e: MediaQueryListEvent) => store.commands.setReducedMotion(e.matches);
        motionQuery.addEventListener("change", onMotionChange);

        (async () => {
            store.set({ phase: "loading" });
            try {
                const profile = await detectRenderProfile();
                if (disposed) return;
                await exp.init({ profile, reducedMotion: motionQuery.matches, isTouch: detectTouch() });
            } catch (err) {
                // init() never throws by contract; this guards the profile step.
                console.error("[world3] boot failed", err);
                if (!disposed) store.fail("asset");
            }
        })();

        return () => {
            disposed = true;
            motionQuery.removeEventListener("change", onMotionChange);
            exp.dispose();
        };
    }, [store]);

    const { phase, panel, mapOpen, menuTab, photoMode } = state;
    const running = phase === "running";
    const isTouch = state.isTouch || localTouch;
    const overlayOpen = panel !== null || mapOpen || menuTab !== null;

    // ── Focus returns to the canvas when the last dialog closes ─────────
    const wasOpen = useRef(false);
    useEffect(() => {
        if (wasOpen.current && !overlayOpen) canvasRef.current?.focus({ preventScroll: true });
        wasOpen.current = overlayOpen;
    }, [overlayOpen]);

    // ── Toasts expire in the store, not the HUD, so a HUD remount (photo
    // mode, context restore) never replays an old toast ──────────────────
    const { toast } = state;
    useEffect(() => {
        if (!toast) return;
        const t = window.setTimeout(() => {
            if (store.snapshot.toast?.id === toast.id) store.set({ toast: null });
        }, CONFIG.ui.toastMs);
        return () => window.clearTimeout(t);
    }, [store, toast]);

    // ── Desktop controls hint: the first CONFIG.ui.controlsHintMs after Start ──
    const [hintDone, setHintDone] = useState(false);
    useEffect(() => {
        if (!running) return;
        const t = window.setTimeout(() => setHintDone(true), CONFIG.ui.controlsHintMs);
        return () => window.clearTimeout(t);
    }, [running]);

    // ── Sound choice persists whatever toggled it (HUD, menu, or the N key) ──
    useEffect(() => {
        if (running) writeSoundPref(state.muted ? "off" : "on");
    }, [running, state.muted]);

    // ── Commands ─────────────────────────────────────────────────────────
    const onStart = useCallback(() => {
        // All inside the click: the audio context may only start on a user gesture.
        const muted = mutedOnStart(readSoundPref());
        store.commands.start();
        store.commands.setMuted(muted);
        writeSoundPref(muted ? "off" : "on");
        canvasRef.current?.focus({ preventScroll: true });
    }, [store]);

    const onToggleSound = useCallback(() => store.commands.setMuted(!store.snapshot.muted), [store]);

    const onTravel = useCallback(
        (id: AreaId) => {
            store.commands.travelTo(id);
            store.commands.closeMap();
        },
        [store]
    );

    const focusCanvas = useCallback(() => canvasRef.current?.focus({ preventScroll: true }), []);
    const onOpenMap = useCallback(() => store.commands.openMap(), [store]);
    const onOpenMenu = useCallback(() => store.commands.openMenu("settings"), [store]);
    const onClosePanel = useCallback(() => store.commands.closePanel(), [store]);
    const onCloseMap = useCallback(() => store.commands.closeMap(), [store]);
    const onCloseMenu = useCallback(() => store.commands.closeMenu(), [store]);
    const onKeepWaiting = useCallback(() => store.set({ failReason: undefined }), [store]);

    const rootClass = ["w3-root", isTouch ? "is-touch" : "", state.reducedMotion ? "is-reduced-motion" : ""]
        .filter(Boolean)
        .join(" ");

    return (
        <div ref={containerRef} className={rootClass}>
            <canvas
                ref={canvasRef}
                className={`w3-canvas${phase === "ready" || running ? " is-visible" : ""}`}
                style={{ transitionDuration: `${CONFIG.loading.canvasFadeMs}ms` }}
                // Not in the tab order until the world runs: "Skip to classic portfolio" comes first.
                tabIndex={running ? 0 : -1}
                role="application"
                aria-label="3D world. Drive with W A S D or the arrow keys, press E to open what you reach, M for the map."
            />

            {running && !photoMode && (
                <Hud
                    areaId={state.areaId}
                    prompt={state.prompt}
                    toast={state.toast}
                    muted={state.muted}
                    isTouch={isTouch}
                    showHint={!hintDone}
                    focusCanvas={focusCanvas}
                    onOpenMap={onOpenMap}
                    onToggleSound={onToggleSound}
                    onOpenMenu={onOpenMenu}
                />
            )}

            {running && photoMode && (
                <PhotoBar onCapture={() => store.commands.capturePhoto()} onExit={() => store.commands.togglePhotoMode()} />
            )}

            {running && isTouch && !overlayOpen && !photoMode && <TouchControls store={store} prompt={state.prompt} />}

            {running && panel && (
                <ContentPanel
                    content={panel}
                    areaId={state.areaId}
                    topmost={!mapOpen && menuTab === null}
                    onClose={onClosePanel}
                />
            )}

            {running && mapOpen && (
                <MapModal
                    store={store}
                    visited={state.visited}
                    areaId={state.areaId}
                    topmost={menuTab === null}
                    onTravel={onTravel}
                    onClose={onCloseMap}
                />
            )}

            {running && menuTab !== null && (
                <MenuModal
                    state={state}
                    commands={store.commands}
                    topmost
                    onToggleSound={onToggleSound}
                    onClose={onCloseMenu}
                />
            )}

            {(phase === "boot" || phase === "loading") && (
                <Loader
                    progress={state.loadProgress}
                    label={state.loadLabel}
                    engineTimedOut={state.failReason === "timeout"}
                    onKeepWaiting={onKeepWaiting}
                />
            )}

            {phase === "ready" && <StartCard isTouch={isTouch} onStart={onStart} />}

            {phase === "failed" && (
                <div className="w3-overlay is-opaque">
                    <FailCard reason={state.failReason} />
                </div>
            )}

            <Announcer
                areaId={state.areaId}
                prompt={state.prompt}
                toast={state.toast}
                isTouch={isTouch}
                active={running}
            />
        </div>
    );
}
