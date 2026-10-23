"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiArrowUpRight } from "react-icons/fi";
import { EMAIL, MENU_LINKS, SOCIALS } from "@/app/components/site/SiteHeader";
import VinylBadge from "@/app/components/site/VinylBadge";

/** The "Encore": a big invitation, the email, the spinning record and the small print. */
export default function SiteFooter() {
    const pathname = usePathname();
    const currentYear = new Date().getFullYear();

    // Hidden in the full-screen 3D field experience.
    if (pathname === "/field") return null;

    return (
        <footer className="sf">
            <div className="page-width sf-inner">
                <p className="label-mono">( Encore )</p>
                <h2 className="sf-title">
                    <span>Let&apos;s build</span>
                    <span>
                        something <em>together.</em>
                    </span>
                </h2>
                <div className="sf-row">
                    <div className="sf-actions-col">
                        <a href={`mailto:${EMAIL}`} className="sf-email">
                            {EMAIL}
                            <FiArrowUpRight aria-hidden="true" />
                        </a>
                        <div className="sf-actions">
                            <Link href="/contact" className="sf-pill">
                                Get in touch
                            </Link>
                            <Link href="/projects" className="sf-pill">
                                Browse projects
                            </Link>
                        </div>
                    </div>
                    <VinylBadge />
                </div>
                <div className="sf-bottom">
                    <nav className="sf-links" aria-label="Footer">
                        {MENU_LINKS.map((l) => (
                            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
                                {l.label}
                            </Link>
                        ))}
                    </nav>
                    <div className="sf-socials">
                        {SOCIALS.map(({ href, label, Icon }) => (
                            <a key={href} href={href} aria-label={label} target="_blank" rel="noopener noreferrer">
                                <Icon />
                            </a>
                        ))}
                    </div>
                    <p>&copy; {currentYear} Jazz · Made in Lagos</p>
                </div>
            </div>
        </footer>
    );
}
