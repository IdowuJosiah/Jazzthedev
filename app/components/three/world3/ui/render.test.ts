import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorldStore, initialWorldState } from "../State";
import FieldSummary from "@/app/field/FieldSummary";
import { contactLinks, frontendProjects } from "@/app/field/content/world";
import FailCard from "./FailCard";
import Hud from "./Hud";
import MapModal from "./MapModal";
import { ContentPanel, MenuModal, MENU_TABS } from "./Panels";
import { Loader, StartCard } from "./StartScreen";
import TouchControls from "./TouchControls";

// Server-render smoke tests: every overlay renders without a browser, with the
// semantics the a11y pass relies on (§6.2, §9.4). Effects don't run here.

const noop = () => {};

describe("SSR summary (§6.2 No-JS)", () => {
    const html = renderToStaticMarkup(h(FieldSummary));

    it("has the h1, projects, contact links and the classic-site link", () => {
        expect(html).toContain("<h1>Jazz — Frontend developer &amp; product lead</h1>");
        for (const p of frontendProjects) expect(html).toContain(p.title);
        for (const c of contactLinks) expect(html).toContain(c.display);
        expect(html).toContain('href="/"');
    });

    it("is sr-only while JS runs and revealed by a noscript style", () => {
        expect(html).toMatch(/<style>\.field-summary\{position:absolute;width:1px/);
        expect(html).toMatch(/<noscript><style>[\s\S]*\.field-summary,\.field-summary:focus-within\{position:static/);
    });

    it("reveals itself when a link inside takes keyboard focus", () => {
        expect(html).toMatch(/\.field-summary:focus-within\{position:fixed;inset:16px/);
    });
});

describe("overlays", () => {
    it("start card: the Skip link is the first focusable element", () => {
        const html = renderToStaticMarkup(h(StartCard, { isTouch: false, onStart: noop }));
        const firstFocusable = html.match(/<(a|button)\b[^>]*>/)?.[0] ?? "";
        expect(firstFocusable).toContain('href="/"');
        expect(html).toContain("Skip to classic portfolio");
        expect(html).toContain("Drive through my work");
        expect(html).toContain("<kbd");
    });

    it("start card on touch uses touch copy", () => {
        const html = renderToStaticMarkup(h(StartCard, { isTouch: true, onStart: noop }));
        expect(html).toContain("Left pad to drive · tap E to open");
        expect(html).not.toContain("<kbd");
    });

    it("loader: labelled progress bar, no percentage text", () => {
        const html = renderToStaticMarkup(
            h(Loader, { progress: 0.4, label: "Loading models", engineTimedOut: false, onKeepWaiting: noop })
        );
        expect(html).toContain('role="progressbar"');
        expect(html).toContain('aria-label="Loading the world"');
        expect(html).toContain("Loading models");
        expect(html).not.toMatch(/>\s*\d+%\s*</);
    });

    it("loader shows the timeout card when the engine flags a slow load", () => {
        const html = renderToStaticMarkup(
            h(Loader, { progress: 0.4, label: "Loading models", engineTimedOut: true, onKeepWaiting: noop })
        );
        expect(html).toContain("This is taking longer than usual");
        expect(html).toContain("Keep waiting");
        expect(html).toContain("Classic site");
    });

    it("failure cards offer the right actions", () => {
        const webgl = renderToStaticMarkup(h(FailCard, { reason: "webgl" }));
        expect(webgl).toContain('href="/projects"');
        expect(webgl).toContain("Classic site");
        const lost = renderToStaticMarkup(h(FailCard, { reason: "context-lost" }));
        expect(lost).toContain("Graphics were reset");
        expect(lost).toContain("Reload");
        expect(lost).toContain('role="alertdialog"');
    });
});

describe("HUD", () => {
    const base = {
        areaId: "projects" as const,
        prompt: { title: "Clay Studio Creations", action: "Open project" },
        toast: { id: 1, text: "Projects · 4 projects" },
        muted: false,
        isTouch: false,
        showHint: true,
        focusCanvas: noop,
        onOpenMap: noop,
        onToggleSound: noop,
        onOpenMenu: noop,
    };

    it("has the always-visible Classic site link and labelled icon buttons, no speedometer", () => {
        const html = renderToStaticMarkup(h(Hud, base));
        expect(html).toContain('aria-label="Classic site"');
        expect(html).toContain('aria-label="Open map"');
        expect(html).toContain('aria-label="Turn sound off"');
        expect(html).toContain('aria-label="Open menu"');
        expect(html).toContain("Frontend Projects");
        expect(html).toContain("Clay Studio Creations");
        expect(html).not.toMatch(/km\/h|speed/i);
    });

    it("prompt E is a kbd chip everywhere; on touch the only E button is the cluster's", () => {
        expect(renderToStaticMarkup(h(Hud, base))).toMatch(/<kbd class="w3-prompt-key">E<\/kbd>/);
        const touch = renderToStaticMarkup(h(Hud, { ...base, isTouch: true }));
        expect(touch).toMatch(/<kbd class="w3-prompt-key">E<\/kbd>/);
        expect(touch).not.toMatch(/<button[^>]*class="w3-prompt-key"/);
    });
});

describe("dialogs", () => {
    it("content panel is a labelled modal dialog with semantic markup", () => {
        const html = renderToStaticMarkup(
            h(ContentPanel, {
                content: {
                    title: "Clay Studio Creations",
                    sub: "Frontend project",
                    body: "Body",
                    tags: ["Next.js"],
                    links: [{ label: "Visit site", url: "https://example.com" }],
                },
                areaId: "projects",
                topmost: true,
                onClose: noop,
            })
        );
        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toMatch(/<h2[^>]*>Clay Studio Creations<\/h2>/);
        expect(html).toContain('aria-label="Close panel"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it("menu renders every tab as a tab with one selected", () => {
        const state = { ...initialWorldState(), menuTab: "words" as const };
        const html = renderToStaticMarkup(
            h(MenuModal, { state, commands: new WorldStore().commands, topmost: true, onToggleSound: noop, onClose: noop })
        );
        for (const t of MENU_TABS) expect(html).toContain(`>${t.label}</button>`);
        expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
        expect(html).toContain("Yoruba words found");
    });

    it("map lists all 9 areas with Travel", () => {
        const html = renderToStaticMarkup(
            h(MapModal, { store: new WorldStore(), visited: ["welcome"], areaId: "welcome", topmost: true, onTravel: noop, onClose: noop })
        );
        expect(html.match(/class="w3-travel( is-here)?"/g)).toHaveLength(9);
        expect(html.match(/>Travel</g)).toHaveLength(9);
        expect(html).toContain("You are here");
    });

    it("touch controls show E only when a pad is in range", () => {
        const store = new WorldStore();
        const without = renderToStaticMarkup(h(TouchControls, { store, prompt: null }));
        expect(without).not.toContain("w3-touch-e");
        expect(without).toContain('aria-label="Boost"');
        expect(without).toContain('aria-label="Brake"');
        const withE = renderToStaticMarkup(h(TouchControls, { store, prompt: { title: "Eko", action: "Open" } }));
        expect(withE).toContain('aria-label="Open: Eko"');
        // Named from the pad's action, not a hard-coded "Open".
        const reset = renderToStaticMarkup(h(TouchControls, { store, prompt: { title: "Playground", action: "Reset" } }));
        expect(reset).toContain('aria-label="Reset: Playground"');
    });
});
