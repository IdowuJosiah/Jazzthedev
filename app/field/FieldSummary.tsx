import Link from "next/link";
import {
    about,
    areaCopy,
    contactLinks,
    ekoMilestones,
    frontendProjects,
    journeyStops,
    musicPillars,
} from "@/app/field/content/world";

// ─────────────────────────────────────────────────────────────────────────
// Server-rendered summary of the world (§6.2 "No-JS and SEO"). While the
// world runs it is visually hidden but stays in the accessibility tree
// (sr-only); with JavaScript off a <noscript><style> rule reveals it and
// hides the client-only world placeholder. Its content duplicates the panels.
// ─────────────────────────────────────────────────────────────────────────

/** First sentence of a paragraph (up to and including the first ". "). */
export function firstSentence(text: string): string {
    const i = text.search(/[.!?](\s|$)/);
    return i === -1 ? text : text.slice(0, i + 1);
}

const ekoUrl = ekoMilestones.find((m) => m.liveUrl)?.liveUrl;
const ekoLine = firstSentence((journeyStops.find((s) => /\beko\b/i.test(s.title)) ?? ekoMilestones[0]).body);
const musicUrl = musicPillars.find((p) => p.url)?.url;

// sr-only while the world runs, but its links stay in the tab order after the
// HUD, so keyboard focus reveals it as a scrollable sheet over the world
// (WCAG 2.4.7) instead of landing on invisible links.
const HIDDEN_CSS =
    ".field-summary{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}" +
    ".field-summary:focus-within{position:fixed;inset:16px;z-index:100;width:auto;height:auto;margin:0;padding:24px;overflow:auto;clip:auto;white-space:normal;background:#FFFDF8;color:#24222B;border-radius:16px;font-family:var(--font-inter),system-ui,sans-serif;font-size:16px;line-height:24px}" +
    ".field-summary:focus-within a{color:#24222B}" +
    ".field-summary:focus-within :focus-visible{outline:2px solid #2F6FED;outline-offset:2px}";

// No-JS: show the summary as a plain readable page; hide the world's loader
// (v2's server-rendered placeholder), which can never finish without JS. The
// :focus-within selector cancels the focus reveal above (the page is static).
const NOSCRIPT_CSS = `<style>
.ekoworld-root{display:none!important}
.field-summary,.field-summary:focus-within{position:static;z-index:auto;border-radius:0;width:auto;height:auto;margin:0 auto;overflow:visible;clip:auto;white-space:normal;max-width:720px;padding:48px 24px 64px;background:#F3DCC0;color:#24222B;font-family:var(--font-inter),system-ui,sans-serif;font-size:16px;line-height:24px}
.field-summary h1{font-family:var(--font-bricolage),var(--font-inter),system-ui,sans-serif;font-size:40px;line-height:44px;font-weight:800;margin:0 0 16px}
.field-summary h2{font-size:20px;line-height:28px;font-weight:600;margin:32px 0 8px}
.field-summary h3{font-size:16px;line-height:24px;font-weight:600;margin:0}
.field-summary p{margin:0 0 8px}
.field-summary ul{margin:0;padding:0;list-style:none}
.field-summary li{margin:0 0 16px}
.field-summary a{color:#24222B;text-decoration:underline;text-underline-offset:3px}
</style>`;

export default function FieldSummary() {
    return (
        <article className="field-summary" aria-label="Portfolio summary">
            <style dangerouslySetInnerHTML={{ __html: HIDDEN_CSS }} />
            <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_CSS }} />

            <h1>Jazz — Frontend developer &amp; product lead</h1>
            <p>{about.bio}</p>

            <h2>{areaCopy.projects.name}</h2>
            <ul>
                {frontendProjects.map((p) => (
                    <li key={p.title}>
                        <h3>{p.title}</h3>
                        <p>{p.pitch}</p>
                        {p.liveUrl && (
                            <a href={p.liveUrl} target="_blank" rel="noopener noreferrer">
                                Visit {p.title}
                            </a>
                        )}
                    </li>
                ))}
            </ul>

            <h2>{areaCopy.eko.name}</h2>
            <p>
                {areaCopy.eko.blurb}. {ekoLine}{" "}
                {ekoUrl && (
                    <a href={ekoUrl} target="_blank" rel="noopener noreferrer">
                        Visit Eko
                    </a>
                )}
            </p>

            <h2>{areaCopy.music.name}</h2>
            <p>
                {firstSentence(musicPillars[0].body)}{" "}
                {musicUrl && (
                    <a href={musicUrl} target="_blank" rel="noopener noreferrer">
                        Visit the platform
                    </a>
                )}
            </p>

            <h2>Contact</h2>
            <ul>
                {contactLinks.map((c) => (
                    <li key={c.id}>
                        <a href={c.url} {...(/^https?:/i.test(c.url) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                            {c.display}
                        </a>
                    </li>
                ))}
            </ul>

            <p>
                <Link href="/">Go to the classic portfolio site</Link> · <Link href="/projects">View all projects</Link>
            </p>
        </article>
    );
}
