"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CONFIG } from "../Config";
import { meta } from "@/app/field/content/world";
import FailCard, { CLASSIC_SITE_URL } from "./FailCard";

// ─────────────────────────────────────────────────────────────────────────
// Loader + Start card (§6.2).
//
// Loader: wordmark, a 200×4 bar and a stage label; no percentage. The bar
// never moves backwards even if a stray store write would. After
// CONFIG.loading.timeoutMs a "taking longer" card offers Keep waiting /
// Classic site while loading continues underneath.
//
// Start card: "Skip to classic portfolio" is the first focusable element.
// Start enables sound and persists the choice (localStorage, try/catch). No
// keyboard-shortcut chip row (owner direction, DECISIONS.md "Owner:
// desktop-first, no on-screen controls"): one short sub line instead; the
// full list lives in Menu → Controls.
// ─────────────────────────────────────────────────────────────────────────

// ── Sound preference (persisted across visits) ───────────────────────────
export type SoundPref = "on" | "off";

/** Stored preference, or null when nothing is stored / storage is blocked. */
export function readSoundPref(): SoundPref | null {
    try {
        const v = window.localStorage.getItem(CONFIG.ui.soundStorageKey);
        return v === "on" || v === "off" ? v : null;
    } catch {
        return null;
    }
}

export function writeSoundPref(pref: SoundPref): void {
    try {
        window.localStorage.setItem(CONFIG.ui.soundStorageKey, pref);
    } catch {
        /* storage blocked: the choice lasts for this session only */
    }
}

/**
 * Start turns sound on, unless the visitor turned it off on a previous visit
 * (the toggle state persists, §9.4). Returns the resulting `muted` flag.
 */
export function mutedOnStart(stored: SoundPref | null): boolean {
    return stored === "off";
}

// ── Monotonic progress ───────────────────────────────────────────────────
/** Highest value seen so far (derived state; never decreases). */
export function useMonotonic(value: number): number {
    const [max, setMax] = useState(value);
    if (value > max) setMax(value);
    return Math.max(max, value);
}

/** Bar width in whole percent, clamped to [0, 100]. */
export function progressPercent(progress: number): number {
    return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

// ── Loader ───────────────────────────────────────────────────────────────
interface LoaderProps {
    progress: number;
    label: string;
    /** The engine flagged a slow load (failReason "timeout"). */
    engineTimedOut: boolean;
    onKeepWaiting: () => void;
}

export function Loader({ progress, label, engineTimedOut, onKeepWaiting }: LoaderProps) {
    const shown = useMonotonic(progress);
    const pct = progressPercent(shown);
    const [localTimedOut, setLocalTimedOut] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    // A UI-side backstop: the timeout card appears even if profile detection
    // (before init) is what's slow.
    useEffect(() => {
        const t = window.setTimeout(() => setLocalTimedOut(true), CONFIG.loading.timeoutMs);
        return () => window.clearTimeout(t);
    }, []);

    const showTimeout = (engineTimedOut || localTimedOut) && !dismissed;

    return (
        <div className="w3-overlay is-opaque">
            <div className="w3-loader-stack">
                <div className="w3-loader">
                    <p className="w3-wordmark-xl" aria-hidden="true">
                        {meta.heroWord}
                    </p>
                    <div
                        className="w3-progress"
                        role="progressbar"
                        aria-label="Loading the world"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        aria-valuetext={label}
                    >
                        <div className="w3-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="w3-load-label">{label}</p>
                </div>
                {showTimeout && (
                    <FailCard
                        reason="timeout"
                        onKeepWaiting={() => {
                            setDismissed(true);
                            onKeepWaiting();
                        }}
                    />
                )}
            </div>
        </div>
    );
}

// ── Start card ───────────────────────────────────────────────────────────
export interface ControlChip {
    keys: string;
    action: string;
}

/** A row of kbd chips (Menu → Controls). */
export function KbdRow({ items, label }: { items: readonly ControlChip[]; label: string }) {
    return (
        <ul className="w3-kbd-row" aria-label={label}>
            {items.map((c) => (
                <li key={c.keys} className="w3-kbd-item">
                    <kbd className="w3-kbd">{c.keys}</kbd>
                    {c.action}
                </li>
            ))}
        </ul>
    );
}

/** The Start card's one-line controls note (no chip row). */
export function startSubLine(isTouch: boolean): string {
    return isTouch ? "Left pad to drive · tap E to open" : "All controls are in the menu (Esc).";
}

interface StartCardProps {
    isTouch: boolean;
    onStart: () => void;
}

export function StartCard({ isTouch, onStart }: StartCardProps) {
    const titleId = useId();
    const startRef = useRef<HTMLButtonElement>(null);

    // Focus Start (the Skip link stays first in tab order, one Shift+Tab away).
    useEffect(() => {
        startRef.current?.focus({ preventScroll: true });
    }, []);

    return (
        <div className="w3-overlay">
            <section className="w3-card" aria-labelledby={titleId}>
                <a className="w3-link w3-skip" href={CLASSIC_SITE_URL}>
                    Skip to classic portfolio
                </a>
                <p className="w3-kicker w3-muted">Interactive portfolio</p>
                <h2 id={titleId} className="w3-start-title">
                    Drive through my work
                </h2>
                <p className="w3-body w3-muted">
                    A small world of the projects, products and music I&apos;ve built. Drive up to anything to open
                    it.
                </p>
                <p className="w3-small w3-muted">{startSubLine(isTouch)}</p>
                <div className="w3-card-actions">
                    <button ref={startRef} type="button" className="w3-btn w3-btn-primary" onClick={onStart}>
                        Start
                    </button>
                </div>
            </section>
        </div>
    );
}
