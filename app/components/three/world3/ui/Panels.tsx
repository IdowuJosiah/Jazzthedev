"use client";

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { LuArrowUpRight, LuCamera, LuRotateCcw, LuX } from "react-icons/lu";
import { ACCENT, ACCENT_INK, type AccentKey, type HexColor, type QualitySetting } from "../Config";
import { AREA_BY_ID } from "../Layout";
import type { WorldCommandSet, WorldState } from "../State";
import type { AreaId, MenuTab } from "../types";
import { contactLinks, credits, creditsSignLine, yorubaWords, type InfoContent } from "@/app/field/content/world";
import { KbdRow } from "./StartScreen";

// ─────────────────────────────────────────────────────────────────────────
// Content panel + Menu (§6.2), and the shared focus trap used by every
// dialog (panel, map, menu). Esc is handled inside the dialog and stopped
// there, so the engine's Controls never sees a second Escape for it.
// Focus returns to the canvas on close (FieldExperience owns that).
// ─────────────────────────────────────────────────────────────────────────

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab should wrap to inside a trap of `count` focusables, given the
 * index of the focused one (−1 = focus is on the container / outside).
 * Returns null when the browser's default move stays inside the trap.
 */
export function trapIndex(current: number, count: number, shift: boolean): number | null {
    if (count <= 0) return null;
    if (current < 0) return shift ? count - 1 : 0;
    if (shift && current === 0) return count - 1;
    if (!shift && current === count - 1) return 0;
    return null;
}

function focusablesIn(el: HTMLElement): HTMLElement[] {
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.getClientRects().length > 0);
}

/**
 * Traps focus inside `ref` while `active`. On activation focuses the element
 * marked `data-autofocus`, else the container itself (it needs tabIndex −1).
 * Only the topmost dialog should be active at a time.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
    useEffect(() => {
        const el = ref.current;
        if (!active || !el) return;
        const initial = el.querySelector<HTMLElement>("[data-autofocus]") ?? el;
        if (!el.contains(document.activeElement)) initial.focus({ preventScroll: true });

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            const items = focusablesIn(el);
            if (items.length === 0) {
                e.preventDefault();
                el.focus({ preventScroll: true });
                return;
            }
            const next = trapIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
            if (next !== null) {
                e.preventDefault();
                items[next].focus();
            }
        };
        // Focus that escapes (a click on the world behind a scrim-less sheet)
        // is pulled back into the dialog.
        const onFocusIn = (e: FocusEvent) => {
            if (e.target instanceof Node && !el.contains(e.target)) el.focus({ preventScroll: true });
        };
        el.addEventListener("keydown", onKey);
        document.addEventListener("focusin", onFocusIn);
        return () => {
            el.removeEventListener("keydown", onKey);
            document.removeEventListener("focusin", onFocusIn);
        };
    }, [ref, active]);
}

/**
 * Dialog keydown: Esc closes it. Every key stops here, so the engine's
 * Controls (listening further up) neither drives the car while a dialog has
 * focus nor acts on the same Escape a second time. keyup still reaches it,
 * so a key held when the dialog opened is released normally.
 */
export function closeOnEscape(onClose: () => void) {
    return (e: ReactKeyboardEvent) => {
        e.stopPropagation();
        if (e.key !== "Escape") return;
        e.preventDefault();
        onClose();
    };
}

// ── Accent ───────────────────────────────────────────────────────────────
const ACCENT_KEYS = Object.keys(ACCENT) as AccentKey[];

/**
 * Text-safe accent for a panel kicker: the ACCENT_INK twin of the content's
 * numeric accent, else the current area's accentInk, else brand.
 */
export function panelAccentInk(accent: number | undefined, areaId: AreaId | null): HexColor {
    if (accent !== undefined) {
        const hex = `#${accent.toString(16).padStart(6, "0")}`.toLowerCase();
        const key = ACCENT_KEYS.find((k) => ACCENT[k].toLowerCase() === hex || ACCENT_INK[k].toLowerCase() === hex);
        if (key) return ACCENT_INK[key];
    }
    return areaId ? AREA_BY_ID[areaId].accentInk : ACCENT_INK.brand;
}

const isMailOrTel = (url: string) => /^(mailto|tel):/i.test(url);

/** Primary ink link button with LuArrowUpRight; external links open in a new tab. */
export function LinkButton({ label, url }: { label: string; url: string }) {
    const external = !isMailOrTel(url) && /^https?:/i.test(url);
    return (
        <a
            className="w3-btn w3-btn-primary"
            href={url}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
            {label}
            <LuArrowUpRight size={20} aria-hidden="true" />
            {external && <span className="w3-sr-only"> (opens in a new tab)</span>}
        </a>
    );
}

// ── Content panel ────────────────────────────────────────────────────────
interface ContentPanelProps {
    content: InfoContent;
    areaId: AreaId | null;
    /** True when no dialog sits above the panel (map / menu). */
    topmost: boolean;
    onClose: () => void;
}

/** Desktop: right sheet, no scrim. ≤ 640 px: bottom sheet over a scrim. */
export function ContentPanel({ content, areaId, topmost, onClose }: ContentPanelProps) {
    const ref = useRef<HTMLElement>(null);
    const titleId = useId();
    useFocusTrap(ref, topmost);
    const kickerColor = panelAccentInk(content.accent, areaId);

    return (
        <div className="w3-panel-layer">
            <div className="w3-scrim" onClick={onClose} aria-hidden="true" />
            <section
                ref={ref}
                className="w3-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={closeOnEscape(onClose)}
            >
                <div className="w3-panel-head">
                    <button type="button" className="w3-iconbtn" onClick={onClose} aria-label="Close panel">
                        <LuX size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="w3-panel-scroll">
                    {content.image && (
                        // eslint-disable-next-line @next/next/no-img-element -- local WebP, sized by CSS
                        <img className="w3-panel-image" src={content.image} alt={`${content.title} preview`} />
                    )}
                    <div className="w3-panel-heading">
                        {content.sub && (
                            <p className="w3-kicker" style={{ color: kickerColor }}>
                                {content.sub}
                            </p>
                        )}
                        <h2 id={titleId} className="w3-panel-title">
                            {content.title}
                        </h2>
                    </div>
                    {content.body && <p className="w3-body">{content.body}</p>}
                    {content.sections?.map((s) => (
                        <div key={s.heading} className="w3-panel-section">
                            <h3 className="w3-h3">{s.heading}</h3>
                            <p className="w3-body">{s.text}</p>
                        </div>
                    ))}
                    {content.tags && content.tags.length > 0 && (
                        <ul className="w3-tags" aria-label="Tags">
                            {content.tags.map((t) => (
                                <li key={t} className="w3-tag">
                                    {t}
                                </li>
                            ))}
                        </ul>
                    )}
                    {content.links && content.links.length > 0 && (
                        <ul className="w3-links">
                            {content.links.map((l) => (
                                <li key={l.url}>
                                    <LinkButton label={l.label} url={l.url} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>
        </div>
    );
}

// ── Menu ─────────────────────────────────────────────────────────────────
export const MENU_TABS: readonly { id: MenuTab; label: string }[] = [
    { id: "settings", label: "Settings" },
    { id: "controls", label: "Controls" },
    { id: "words", label: "Words" },
    { id: "contact", label: "Contact" },
    { id: "credits", label: "Credits" },
];

/** Arrow / Home / End movement across the tab list (wraps). */
export function nextTab(current: MenuTab, key: string): MenuTab | null {
    const i = MENU_TABS.findIndex((t) => t.id === current);
    const n = MENU_TABS.length;
    if (key === "ArrowRight") return MENU_TABS[(i + 1) % n].id;
    if (key === "ArrowLeft") return MENU_TABS[(i - 1 + n) % n].id;
    if (key === "Home") return MENU_TABS[0].id;
    if (key === "End") return MENU_TABS[n - 1].id;
    return null;
}

const QUALITY_OPTIONS: readonly { id: QualitySetting; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "high", label: "High" },
    { id: "medium", label: "Medium" },
    { id: "low", label: "Low" },
];

const DESKTOP_CONTROLS = [
    { keys: "WASD", action: "Drive (arrow keys too)" },
    { keys: "Shift", action: "Boost" },
    { keys: "Space", action: "Brake / drift" },
    { keys: "E", action: "Open (Enter too)" },
    { keys: "M", action: "Map" },
    { keys: "N", action: "Sound on / off" },
    { keys: "R", action: "Reset the car" },
    { keys: "P", action: "Photo mode" },
    { keys: "Esc", action: "Menu / close" },
] as const;

const TOUCH_CONTROLS = [
    { keys: "Left pad", action: "Drive and steer" },
    { keys: "Boost", action: "Hold to go faster" },
    { keys: "Brake", action: "Hold to brake or drift" },
    { keys: "E", action: "Appears near something you can open" },
    { keys: "Pinch", action: "Zoom" },
] as const;

interface MenuProps {
    state: WorldState;
    commands: WorldCommandSet;
    topmost: boolean;
    onToggleSound: () => void;
    onClose: () => void;
}

export function MenuModal({ state, commands, topmost, onToggleSound, onClose }: MenuProps) {
    const ref = useRef<HTMLElement>(null);
    const titleId = useId();
    const baseId = useId();
    const tabRefs = useRef<Partial<Record<MenuTab, HTMLButtonElement | null>>>({});
    const tab: MenuTab = state.menuTab ?? "settings";
    useFocusTrap(ref, topmost);

    const onTabKey = (e: ReactKeyboardEvent) => {
        const next = nextTab(tab, e.key);
        if (!next) return;
        e.preventDefault();
        commands.openMenu(next);
        tabRefs.current[next]?.focus();
    };

    const total = state.wordsTotal || yorubaWords.length;

    return (
        <div className="w3-modal-layer w3-menu-layer">
            <div className="w3-scrim" onClick={onClose} aria-hidden="true" />
            <section
                ref={ref}
                className="w3-modal w3-menu"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={closeOnEscape(onClose)}
            >
                <div className="w3-modal-head">
                    <h2 id={titleId} className="w3-h3">
                        Menu
                    </h2>
                    <button type="button" className="w3-iconbtn" onClick={onClose} aria-label="Close menu">
                        <LuX size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="w3-tabs" role="tablist" aria-label="Menu sections" onKeyDown={onTabKey}>
                    {MENU_TABS.map((t) => {
                        const selected = t.id === tab;
                        return (
                            <button
                                key={t.id}
                                ref={(n) => {
                                    tabRefs.current[t.id] = n;
                                }}
                                type="button"
                                role="tab"
                                id={`${baseId}-tab-${t.id}`}
                                aria-selected={selected}
                                aria-controls={`${baseId}-panel`}
                                tabIndex={selected ? 0 : -1}
                                className="w3-tab"
                                data-autofocus={selected ? "" : undefined}
                                onClick={() => commands.openMenu(t.id)}
                            >
                                {t.label}
                            </button>
                        );
                    })}
                </div>
                <div
                    className="w3-tabpanel"
                    role="tabpanel"
                    id={`${baseId}-panel`}
                    aria-labelledby={`${baseId}-tab-${tab}`}
                    tabIndex={0}
                >
                    {tab === "settings" && (
                        <SettingsTab state={state} commands={commands} onToggleSound={onToggleSound} onClose={onClose} />
                    )}
                    {tab === "controls" && (
                        <>
                            <h3 className="w3-h3">{state.isTouch ? "Touch" : "Keyboard"}</h3>
                            <KbdRow items={state.isTouch ? TOUCH_CONTROLS : DESKTOP_CONTROLS} label="Controls" />
                            {!state.isTouch && (
                                <p className="w3-small w3-muted">
                                    Drag the world to look around; scroll to zoom. Keys follow the physical layout,
                                    so WASD works on AZERTY keyboards too.
                                </p>
                            )}
                        </>
                    )}
                    {tab === "words" && (
                        <>
                            <p className="w3-body">
                                {state.words.length} of {total} Yoruba words found.
                            </p>
                            {state.words.length === 0 ? (
                                <p className="w3-small w3-muted">
                                    Drive into the gold-rimmed coins around the world to collect words.
                                </p>
                            ) : (
                                <ul className="w3-list">
                                    {state.words.map((w) => (
                                        <li key={w.word} className="w3-row">
                                            <span className="w3-row-main">
                                                <span className="w3-word" lang="yo">
                                                    {w.word}
                                                </span>
                                                <span className="w3-small w3-muted">{w.meaning}</span>
                                            </span>
                                            {w.pron && <span className="w3-small w3-muted">{w.pron}</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                    {tab === "contact" && (
                        <ul className="w3-list">
                            {contactLinks.map((c) => {
                                const external = /^https?:/i.test(c.url);
                                return (
                                    <li key={c.id} className="w3-row">
                                        <span className="w3-row-main">
                                            <span className="w3-kicker w3-muted">{c.label}</span>
                                            <a
                                                href={c.url}
                                                className="w3-body"
                                                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                            >
                                                {c.display}
                                                {external && <span className="w3-sr-only"> (opens in a new tab)</span>}
                                            </a>
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {tab === "credits" && (
                        <>
                            <p className="w3-small w3-muted">{creditsSignLine}</p>
                            <ul className="w3-list">
                                {credits.map((c) => (
                                    <li key={c.name} className="w3-row">
                                        <span className="w3-row-main">
                                            <a href={c.url} target="_blank" rel="noopener noreferrer" className="w3-body">
                                                {c.name}
                                                <span className="w3-sr-only"> (opens in a new tab)</span>
                                            </a>
                                            <span className="w3-small w3-muted">
                                                {c.author} · {c.license}
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            </section>
        </div>
    );
}

function SettingsTab({
    state,
    commands,
    onToggleSound,
    onClose,
}: {
    state: WorldState;
    commands: WorldCommandSet;
    onToggleSound: () => void;
    onClose: () => void;
}) {
    const qualityName = useId();
    return (
        <>
            <fieldset className="w3-fieldset">
                <legend className="w3-legend w3-small">
                    <strong>Quality</strong> <span className="w3-muted">(shadows and scenery only)</span>
                </legend>
                <div className="w3-segmented">
                    {QUALITY_OPTIONS.map((q) => (
                        <label key={q.id} className="w3-option">
                            <input
                                type="radio"
                                name={qualityName}
                                value={q.id}
                                checked={state.quality === q.id}
                                onChange={() => commands.setQuality(q.id)}
                            />
                            <span>{q.label}</span>
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="w3-fieldset">
                <label className="w3-check">
                    <input type="checkbox" checked={!state.muted} onChange={onToggleSound} />
                    Sound
                </label>
                <label className="w3-check">
                    <input
                        type="checkbox"
                        checked={state.reducedMotion}
                        onChange={(e) => commands.setReducedMotion(e.target.checked)}
                    />
                    Reduced motion
                </label>
                <label className="w3-check">
                    <input
                        type="checkbox"
                        checked={state.adaptiveQuality}
                        onChange={(e) => commands.setAdaptive(e.target.checked)}
                    />
                    Adaptive quality
                </label>
            </div>
            <div className="w3-actions-row">
                <button
                    type="button"
                    className="w3-btn w3-btn-secondary"
                    onClick={() => {
                        commands.respawn();
                        onClose();
                    }}
                >
                    <LuRotateCcw size={20} aria-hidden="true" />
                    Reset car
                </button>
                <button
                    type="button"
                    className="w3-btn w3-btn-secondary"
                    onClick={() => {
                        onClose();
                        commands.togglePhotoMode();
                    }}
                >
                    <LuCamera size={20} aria-hidden="true" />
                    Photo mode
                </button>
            </div>
        </>
    );
}
