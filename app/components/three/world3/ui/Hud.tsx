"use client";

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { LuArrowUpRight, LuCamera, LuMap, LuMenu, LuVolume2, LuVolumeX, LuX } from "react-icons/lu";
import { AREA_BY_ID } from "../Layout";
import type { Toast } from "../State";
import type { AreaId, Prompt } from "../types";
import { areaCopy, meta } from "@/app/field/content/world";
import { CLASSIC_SITE_URL } from "./FailCard";
import { KbdRow, START_CONTROLS } from "./StartScreen";

// ─────────────────────────────────────────────────────────────────────────
// HUD (§6.2). Top-left: wordmark + area chip. Top-right, always visible:
// Classic site (collapses to an icon at ≤ 640 px), Map, Sound, Menu. Bottom
// centre: the prompt card (the accessible twin of the in-world keycap; on
// touch the tappable E sits in the TouchControls cluster).
// Toasts at the top centre for CONFIG.ui.toastMs; a controls hint for the
// first CONFIG.ui.controlsHintMs (desktop only). No speedometer, no counter,
// no always-on minimap. The aria-live Announcer lives here too.
// ─────────────────────────────────────────────────────────────────────────

/** "Press E to open Clay Studio Creations" (touch: "Tap E ..."); other actions name both. */
export function promptAnnouncement(prompt: Prompt, isTouch: boolean): string {
    const verb = isTouch ? "Tap" : "Press";
    if (/^open\b/i.test(prompt.action)) return `${verb} E to open ${prompt.title}`;
    return `${verb} E: ${prompt.action}, ${prompt.title}`;
}

export function areaAnnouncement(id: AreaId): string {
    return `Entered ${areaCopy[id].name}`;
}

/**
 * Returns focus to the canvas after a POINTER click on a HUD button, so
 * WASD keeps driving (Controls ignores keys while a button has focus).
 * Keyboard activations (detail 0) keep focus where the user put it.
 */
export function refocusAfterPointer(e: ReactMouseEvent, focusCanvas: () => void) {
    if (e.detail > 0) focusCanvas();
}

interface HudProps {
    areaId: AreaId | null;
    prompt: Prompt | null;
    toast: Toast | null;
    muted: boolean;
    isTouch: boolean;
    /** Desktop controls hint (FieldExperience times it from Start). */
    showHint: boolean;
    /** Focuses the world canvas. */
    focusCanvas: () => void;
    onOpenMap: () => void;
    onToggleSound: () => void;
    onOpenMenu: () => void;
}

export default function Hud(p: HudProps) {
    const area = p.areaId ? AREA_BY_ID[p.areaId] : null;

    return (
        <div className="w3-hud">
            <div className="w3-topbar">
                <div className="w3-topleft">
                    <p className="w3-wordmark">{meta.heroWord}</p>
                    {area && (
                        <span className="w3-area-chip">
                            <span className="w3-dot" style={{ background: area.accent }} aria-hidden="true" />
                            <span className="w3-area-chip-label">{areaCopy[area.id].name}</span>
                        </span>
                    )}
                </div>
                <nav className="w3-topright" aria-label="World controls">
                    <a className="w3-classic" href={CLASSIC_SITE_URL} aria-label="Classic site">
                        <span className="w3-classic-text">Classic site</span>
                        <LuArrowUpRight size={20} aria-hidden="true" />
                    </a>
                    <button
                        type="button"
                        className="w3-iconbtn"
                        aria-label="Open map"
                        aria-keyshortcuts="M"
                        onClick={p.onOpenMap}
                    >
                        <LuMap size={20} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="w3-iconbtn"
                        aria-label={p.muted ? "Turn sound on" : "Turn sound off"}
                        aria-keyshortcuts="N"
                        onClick={(e) => {
                            p.onToggleSound();
                            refocusAfterPointer(e, p.focusCanvas);
                        }}
                    >
                        {p.muted ? <LuVolumeX size={20} aria-hidden="true" /> : <LuVolume2 size={20} aria-hidden="true" />}
                    </button>
                    <button
                        type="button"
                        className="w3-iconbtn"
                        aria-label="Open menu"
                        aria-keyshortcuts="Escape"
                        onClick={p.onOpenMenu}
                    >
                        <LuMenu size={20} aria-hidden="true" />
                    </button>
                </nav>
            </div>

            <Toasts toast={p.toast} />

            {p.prompt && <PromptCard prompt={p.prompt} />}

            {p.showHint && !p.isTouch && !p.prompt && <ControlsHint />}
        </div>
    );
}

/**
 * The E chip is a plain kbd everywhere. On touch the tappable E lives in the
 * thumb cluster (TouchControls), so there is exactly one E control per screen.
 */
function PromptCard({ prompt }: { prompt: Prompt }) {
    return (
        <div className="w3-prompt-wrap">
            <div className="w3-prompt">
                <kbd className="w3-prompt-key">E</kbd>
                <div className="w3-prompt-text">
                    <p className="w3-prompt-title">{prompt.title}</p>
                    <p className="w3-prompt-sub">{prompt.action}</p>
                </div>
            </div>
        </div>
    );
}

/**
 * One toast at a time. FieldExperience clears store.toast after
 * CONFIG.ui.toastMs, so a remounted HUD never replays an expired one; a new
 * id restarts the rise animation. Announced by the Announcer, not here.
 */
function Toasts({ toast }: { toast: Toast | null }) {
    if (!toast) return null;
    return (
        <div className="w3-toast-wrap" aria-hidden="true">
            <div key={toast.id} className="w3-toast">
                {toast.text}
            </div>
        </div>
    );
}

/** Desktop-only controls hint (bottom left); hidden while a prompt card shows. */
function ControlsHint() {
    return (
        <div className="w3-hint">
            <KbdRow items={START_CONTROLS} label="Controls" />
        </div>
    );
}

// ── Photo mode ───────────────────────────────────────────────────────────
interface PhotoBarProps {
    onCapture: () => void;
    onExit: () => void;
    /** Focuses the world canvas, so P and WASD work again after a pointer Capture. */
    focusCanvas: () => void;
}

export function PhotoBar({ onCapture, onExit, focusCanvas }: PhotoBarProps) {
    return (
        <div className="w3-hud">
            <div className="w3-photo-bar">
                <button
                    type="button"
                    className="w3-btn w3-btn-primary"
                    onClick={(e) => {
                        onCapture();
                        refocusAfterPointer(e, focusCanvas);
                    }}
                >
                    <LuCamera size={20} aria-hidden="true" />
                    Capture
                </button>
                <button type="button" className="w3-btn w3-btn-secondary" onClick={onExit} aria-keyshortcuts="P">
                    <LuX size={20} aria-hidden="true" />
                    Exit photo mode
                </button>
            </div>
        </div>
    );
}

// ── aria-live region ─────────────────────────────────────────────────────
interface AnnouncerProps {
    areaId: AreaId | null;
    prompt: Prompt | null;
    toast: Toast | null;
    isTouch: boolean;
    active: boolean;
}

/**
 * Polite live region (§9.4): "Entered Projects", "Press E to open ...", and
 * toast text. Written straight into the DOM node so it never re-renders the HUD.
 */
export function Announcer({ areaId, prompt, toast, isTouch, active }: AnnouncerProps) {
    const ref = useRef<HTMLDivElement>(null);
    const say = (text: string) => {
        if (ref.current) ref.current.textContent = text;
    };

    useEffect(() => {
        if (active && areaId) say(areaAnnouncement(areaId));
    }, [areaId, active]);

    useEffect(() => {
        if (active && prompt) say(promptAnnouncement(prompt, isTouch));
    }, [prompt, isTouch, active]);

    useEffect(() => {
        if (active && toast) say(toast.text);
    }, [toast, active]);

    return <div ref={ref} className="w3-sr-only" role="status" aria-live="polite" aria-atomic="true" />;
}
