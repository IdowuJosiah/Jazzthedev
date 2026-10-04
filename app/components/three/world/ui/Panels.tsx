"use client";

import { useState } from "react";
import type { Store, WorldState } from "../State";
import type { InfoContent } from "@/app/field/content/world";
import type { QualityTier } from "../Config";

const hex = (n?: number) => "#" + (n ?? 0x37e0ff).toString(16).padStart(6, "0");

/** Animated content panel opened from an in-world billboard. */
export function ContentPanel({ content, onClose }: { content: InfoContent; onClose: () => void }) {
    const accent = hex(content.accent);
    return (
        <div className="eko-panel-scrim" onClick={onClose}>
            <div
                className="eko-panel"
                style={{ borderColor: accent, boxShadow: `0 0 50px ${accent}44` }}
                onClick={(e) => e.stopPropagation()}
            >
                <button className="eko-panel-close" onClick={onClose} aria-label="Close">
                    ✕
                </button>
                {content.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="eko-panel-image" src={content.image} alt={content.title} />
                )}
                <div className="eko-panel-body">
                    {content.sub && (
                        <p className="eko-panel-kicker" style={{ color: accent }}>
                            {content.sub}
                        </p>
                    )}
                    <h2 className="eko-panel-title">{content.title}</h2>
                    {content.body && <p className="eko-panel-text">{content.body}</p>}
                    {content.sections?.map((s) => (
                        <div key={s.heading} className="eko-panel-section">
                            <h3>{s.heading}</h3>
                            <p>{s.text}</p>
                        </div>
                    ))}
                    {content.tags && (
                        <div className="eko-panel-tags">
                            {content.tags.map((t) => (
                                <span key={t} style={{ borderColor: accent }}>
                                    {t}
                                </span>
                            ))}
                        </div>
                    )}
                    {content.links && (
                        <div className="eko-panel-links">
                            {content.links.map((l) => (
                                <a
                                    key={l.url}
                                    href={l.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="eko-panel-link"
                                    style={{ background: accent }}
                                >
                                    {l.label} ↗
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const CREDITS = [
    { name: "Low-poly models (palm, lantern, market, house, crate, rock, bird)", by: "Quaternius, Kay Lousberg · CC0", src: "poly.pizza" },
    { name: "Dikhololo Night HDRI", by: "Greg Zaal · CC0", src: "polyhaven.com" },
    { name: "Ground sand PBR", by: "ambientCG · CC0", src: "ambientcg.com" },
    { name: "Water normal", by: "three.js · MIT", src: "threejs.org" },
    { name: "Ambient / music / engine audio", by: "tinyworlds, mintodog, domasx2 · CC0", src: "opengameart.org" },
    { name: "UI sounds", by: "Kenney · CC0", src: "kenney.nl" },
];

type Tab = "travel" | "settings" | "controls" | "credits";

/** Unified pause menu: fast-travel, settings, controls help, credits. */
export function MenuOverlay({
    store,
    state,
    tab,
    setTab,
    onResume,
}: {
    store: Store;
    state: WorldState;
    tab: Tab;
    setTab: (t: Tab) => void;
    onResume: () => void;
}) {
    const [day, setDay] = useState(store.live.dayTime);
    const c = store.commands;

    return (
        <div className="eko-menu-scrim">
            <div className="eko-menu">
                <div className="eko-menu-head">
                    <p className="ekoworld-kicker">ÈKÓ NIGHTS</p>
                    <button className="eko-menu-resume" onClick={onResume}>
                        Resume ▸
                    </button>
                </div>
                <div className="eko-menu-tabs">
                    {(["travel", "settings", "controls", "credits"] as Tab[]).map((t) => (
                        <button
                            key={t}
                            className={`eko-menu-tab ${tab === t ? "is-active" : ""}`}
                            onClick={() => setTab(t)}
                        >
                            {t === "travel"
                                ? "Fast travel"
                                : t[0].toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="eko-menu-content">
                    {tab === "travel" && (
                        <div className="eko-travel-grid">
                            {state.zones.map((z) => (
                                <button
                                    key={z.id}
                                    className="eko-travel-card"
                                    style={{ borderColor: hex(z.color) }}
                                    onClick={() => {
                                        c.fastTravel?.(z.id);
                                        onResume();
                                    }}
                                >
                                    <span className="eko-travel-dot" style={{ background: hex(z.color) }} />
                                    <span className="eko-travel-name">{z.name}</span>
                                    <span className="eko-travel-state">{z.visited ? "✓ explored" : "unexplored"}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {tab === "settings" && (
                        <div className="eko-settings">
                            <label className="eko-set-row">
                                <span>Quality</span>
                                <select
                                    value={state.quality}
                                    onChange={(e) => c.setQuality?.(e.target.value as QualityTier)}
                                >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                </select>
                            </label>
                            <label className="eko-set-row">
                                <span>Adaptive quality</span>
                                <input
                                    type="checkbox"
                                    checked={state.adaptiveQuality}
                                    onChange={(e) => c.setAdaptive?.(e.target.checked)}
                                />
                            </label>
                            <label className="eko-set-row">
                                <span>Sound</span>
                                <input
                                    type="checkbox"
                                    checked={!state.muted}
                                    onChange={(e) => c.setMuted?.(!e.target.checked)}
                                />
                            </label>
                            <label className="eko-set-row">
                                <span>Reduced motion</span>
                                <input
                                    type="checkbox"
                                    checked={state.reducedMotion}
                                    onChange={(e) => c.setReducedMotion?.(e.target.checked)}
                                />
                            </label>
                            <label className="eko-set-row">
                                <span>Rain</span>
                                <input type="checkbox" onChange={() => c.toggleRain?.()} />
                            </label>
                            <label className="eko-set-row">
                                <span>Time of day</span>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={day}
                                    onChange={(e) => {
                                        const v = parseFloat(e.target.value);
                                        setDay(v);
                                        c.setDayTime?.(v);
                                    }}
                                />
                            </label>
                            <button className="eko-set-btn" onClick={() => c.resetPlayground?.()}>
                                Reset playground
                            </button>
                        </div>
                    )}

                    {tab === "controls" && (
                        <div className="eko-controls-help">
                            <div><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / arrows — drive</div>
                            <div><kbd>Shift</kbd> — boost</div>
                            <div><kbd>Space</kbd> — handbrake / drift</div>
                            <div><kbd>E</kbd> — interact / open panel</div>
                            <div><kbd>R</kbd> — respawn</div>
                            <div><kbd>P</kbd> — photo mode</div>
                            <div><kbd>M</kbd> — mute</div>
                            <div><kbd>Esc</kbd> — this menu</div>
                            <div className="eko-controls-touch">On touch: joystick to drive, ⏵⏵ boost, ✦ drift, E interact.</div>
                        </div>
                    )}

                    {tab === "credits" && (
                        <div className="eko-credits">
                            <p className="eko-credits-intro">
                                Built with three.js + Rapier. All world assets are CC0 / MIT — courtesy credit:
                            </p>
                            {CREDITS.map((cr) => (
                                <div key={cr.name} className="eko-credit-row">
                                    <span className="eko-credit-name">{cr.name}</span>
                                    <span className="eko-credit-by">{cr.by} · {cr.src}</span>
                                </div>
                            ))}
                            <a className="eko-panel-link" href="/projects" style={{ background: "#37e0ff", marginTop: 12, display: "inline-block" }}>
                                View the classic portfolio →
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
