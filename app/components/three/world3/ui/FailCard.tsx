"use client";

import { useEffect, useId, useRef } from "react";
import type { FailReason } from "../State";

// ─────────────────────────────────────────────────────────────────────────
// Failure + timeout cards (§6.2). Paper cards in the start-card style. Every
// card offers the classic site; Reload / View projects / Keep waiting depend
// on the reason. Optional assets never reach here (they degrade silently).
// ─────────────────────────────────────────────────────────────────────────

export const CLASSIC_SITE_URL = "/";
export const PROJECTS_URL = "/projects";

export type FailAction = "reload" | "projects" | "keepWaiting";

export interface FailCopy {
    title: string;
    body: string;
    /** The primary (ink) button; the secondary is always "Classic site". */
    primary: FailAction;
}

/** Copy per failure reason. A failed phase without a reason reads as "asset". */
export function failCopy(reason: FailReason | undefined): FailCopy {
    switch (reason) {
        case "webgl":
            return {
                title: "Your browser can't show the 3D world",
                body: "It needs WebGL 2, which isn't available here. Everything in the world is also on the classic site.",
                primary: "projects",
            };
        case "context-lost":
            return {
                title: "Graphics were reset",
                body: "Your device paused the 3D graphics. Reload to drive again.",
                primary: "reload",
            };
        case "timeout":
            return {
                title: "This is taking longer than usual",
                body: "The world is still loading in the background. You can keep waiting or use the classic site.",
                primary: "keepWaiting",
            };
        case "asset":
        default:
            return {
                title: "Something didn't load",
                body: "Part of the world failed to download. Reloading usually fixes it.",
                primary: "reload",
            };
    }
}

const PRIMARY_LABEL: Record<FailAction, string> = {
    reload: "Reload",
    projects: "View projects",
    keepWaiting: "Keep waiting",
};

interface FailCardProps {
    reason: FailReason | undefined;
    /** Only used for the timeout card. */
    onKeepWaiting?: () => void;
}

/** A paper alert card. The primary action takes focus so keyboard users land on it. */
export default function FailCard({ reason, onKeepWaiting }: FailCardProps) {
    const copy = failCopy(reason);
    const titleId = useId();
    const bodyId = useId();
    const primaryRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);

    useEffect(() => {
        primaryRef.current?.focus({ preventScroll: true });
    }, [reason]);

    const primary =
        copy.primary === "projects" ? (
            <a ref={primaryRef} className="w3-btn w3-btn-primary" href={PROJECTS_URL}>
                {PRIMARY_LABEL.projects}
            </a>
        ) : (
            <button
                ref={primaryRef}
                type="button"
                className="w3-btn w3-btn-primary"
                onClick={copy.primary === "reload" ? () => window.location.reload() : onKeepWaiting}
            >
                {PRIMARY_LABEL[copy.primary]}
            </button>
        );

    return (
        <section className="w3-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
            <h2 id={titleId} className="w3-panel-title">
                {copy.title}
            </h2>
            <p id={bodyId} className="w3-body w3-muted">
                {copy.body}
            </p>
            <div className="w3-card-actions">
                {primary}
                <a className="w3-btn w3-btn-secondary" href={CLASSIC_SITE_URL}>
                    Classic site
                </a>
            </div>
        </section>
    );
}
