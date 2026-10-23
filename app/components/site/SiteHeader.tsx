"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiGithub, FiInstagram, FiLinkedin } from "react-icons/fi";
import { getLenis } from "./smooth";

export const MENU_LINKS = [
    { href: "/", label: "Home", note: "Side A" },
    { href: "/projects", label: "Projects", note: "Selected work" },
    { href: "/field", label: "3D World", note: "Drive through it" },
    { href: "/about", label: "About", note: "Liner notes" },
    { href: "/contact", label: "Contact", note: "Say hello" },
] as const;

export const EMAIL = "josiahidowutioluwanimi@gmail.com";

export const SOCIALS = [
    { href: "https://www.linkedin.com/in/josiah-idowu-7282a6232/", label: "LinkedIn", Icon: FiLinkedin },
    { href: "https://github.com/IdowuJosiah", label: "GitHub", Icon: FiGithub },
    { href: "https://www.instagram.com/jazz_thedev/", label: "Instagram", Icon: FiInstagram },
] as const;

/** Scrolled past this (px) and moving down: the header tucks away. */
const TUCK_AFTER = 120;

/** Lagos local time ("22:03"), refreshed every 15 s; null until mounted (no hydration mismatch). */
function useLagosTime(): string | null {
    const [time, setTime] = useState<string | null>(null);
    useEffect(() => {
        const format = new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Africa/Lagos",
        });
        const tick = () => setTime(format.format(new Date()));
        const first = window.setTimeout(tick, 0);
        const id = window.setInterval(tick, 15_000);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(id);
        };
    }, []);
    return time;
}

/**
 * Floating pill header (logo · Lagos time · Let's talk · menu) and the
 * full-screen menu, which opens as a circle growing out of the menu button.
 * Hidden on the 3D world, which has its own HUD.
 */
export default function SiteHeader() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [tucked, setTucked] = useState(false);
    const time = useLagosTime();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const close = useCallback(() => setOpen(false), []);

    const toggle = () => {
        const button = buttonRef.current;
        const menu = menuRef.current;
        if (button && menu) {
            const r = button.getBoundingClientRect();
            menu.style.setProperty("--cx", `${r.left + r.width / 2}px`);
            menu.style.setProperty("--cy", `${r.top + r.height / 2}px`);
        }
        setOpen((o) => !o);
    };

    // Tuck the header while scrolling down; bring it back on the way up.
    useEffect(() => {
        let last = window.scrollY;
        let raf = 0;
        const onScroll = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const y = window.scrollY;
                setTucked(y > TUCK_AFTER && y > last);
                last = y;
            });
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("scroll", onScroll);
        };
    }, []);

    // While open: no page scrolling, Escape closes, Tab stays inside, focus goes in and comes back.
    useEffect(() => {
        if (!open) return;
        const root = document.documentElement;
        const lenis = getLenis();
        lenis?.stop();
        root.style.overflow = "hidden";
        const button = buttonRef.current;
        const menu = menuRef.current;
        const focusFirst = window.setTimeout(() => menu?.querySelector<HTMLElement>("a")?.focus(), 60);

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                return;
            }
            if (e.key !== "Tab" || !menu || !button) return;
            const items = [button, ...menu.querySelectorAll<HTMLElement>("a")];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
            e.preventDefault();
            items[next].focus();
        };
        document.addEventListener("keydown", onKey);
        return () => {
            window.clearTimeout(focusFirst);
            document.removeEventListener("keydown", onKey);
            root.style.overflow = "";
            lenis?.start();
            if (menu?.contains(document.activeElement)) button?.focus();
        };
    }, [open]);

    if (pathname === "/field") return null;

    return (
        <>
            <header className={`sh${open ? " is-open" : ""}${tucked && !open ? " is-tucked" : ""}`}>
                <Link href="/" className="sh-logo" onClick={close} aria-label="Jazz, home">
                    Jazz<span className="sh-logo-dot" aria-hidden="true" />
                </Link>
                <p className="sh-time" aria-label={time ? `Lagos time ${time}` : undefined}>
                    <span className="sh-time-dot" aria-hidden="true" />
                    Lagos {time ?? "--:--"}
                </p>
                <div className="sh-actions">
                    <Link href="/contact" className="sh-talk" onClick={close}>
                        Let&apos;s talk
                    </Link>
                    <button
                        ref={buttonRef}
                        type="button"
                        className="sh-burger"
                        aria-expanded={open}
                        aria-controls="site-menu"
                        aria-label={open ? "Close menu" : "Open menu"}
                        onClick={toggle}
                    >
                        <span className="sh-burger-lines" aria-hidden="true">
                            <span />
                            <span />
                        </span>
                    </button>
                </div>
            </header>

            <div
                ref={menuRef}
                id="site-menu"
                className={`sm${open ? " is-open" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label="Site menu"
                inert={!open}
            >
                <nav className="sm-nav" aria-label="Main">
                    <p className="label-mono">( Tracklist )</p>
                    <ul className="sm-list">
                        {MENU_LINKS.map((l, i) => (
                            <li key={l.href}>
                                <Link
                                    href={l.href}
                                    className={`sm-link${pathname === l.href ? " is-current" : ""}`}
                                    aria-current={pathname === l.href ? "page" : undefined}
                                    onClick={close}
                                >
                                    <span className="sm-num">{String(i + 1).padStart(2, "0")}</span>
                                    <span className="sm-text-clip">
                                        <span className="sm-text" style={{ "--i": i } as React.CSSProperties}>
                                            {l.label}
                                        </span>
                                    </span>
                                    <span className="sm-note">{l.note}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
                <aside className="sm-side">
                    <div className="sm-side-block">
                        <p className="label-mono">( Get in touch )</p>
                        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
                    </div>
                    <div className="sm-side-block">
                        <p className="label-mono">( Elsewhere )</p>
                        <div className="sm-socials">
                            {SOCIALS.map((s) => (
                                <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer">
                                    {s.label}
                                </a>
                            ))}
                        </div>
                    </div>
                </aside>
            </div>
            <div className="sh-spacer" aria-hidden="true" />
        </>
    );
}
