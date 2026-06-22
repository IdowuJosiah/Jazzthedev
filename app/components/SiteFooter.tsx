"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiDribbble, FiGithub, FiInstagram, FiLinkedin } from "react-icons/fi";

const footerLinks = [
    { href: "/", label: "Home" },
    { href: "/projects", label: "Projects" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
];

export default function SiteFooter() {
    const pathname = usePathname();
    const currentYear = new Date().getFullYear();

    return (
        <footer className="page-width">
            <section className="cta-footer-section">
                <div className="cta-footer-top">
                    <div className="footer-nav-links">
                        {footerLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={pathname === link.href ? "footer-nav-link active-footer-nav-link" : "footer-nav-link"}
                            >
                                {link.label}
                            </Link>
                        ))}
                    </div>
                    <div className="footer-socials">
                        <Link href="https://www.instagram.com/jazz_thedev/" aria-label="Instagram" className="footer-social-link" target="_blank" rel="noopener noreferrer">
                            <FiInstagram />
                        </Link>
                        <Link href="https://linkedin.com" aria-label="LinkedIn" className="footer-social-link" target="_blank" rel="noopener noreferrer">
                            <FiLinkedin />
                        </Link>
                        <Link href="https://github.com/IdowuJosiah" aria-label="GitHub" className="footer-social-link" target="_blank" rel="noopener noreferrer">
                            <FiGithub />
                        </Link>
                        <Link href="https://dribbble.com" aria-label="Dribbble" className="footer-social-link" target="_blank" rel="noopener noreferrer">
                            <FiDribbble />
                        </Link>
                    </div>
                </div>
                <div className="cta-footer-bottom">
                    <div className="cta-footer-left">
                        <p className="cta-footer-title">
                            Interested in working together<span className="story-dot">?</span>
                        </p>
                        <div className="cta-footer-actions">
                            <Link href="/contact" className="git">
                                Get In Touch
                            </Link>
                            <Link href="/projects" className="bp footer-browse-button">
                                Browse Projects
                            </Link>
                        </div>
                    </div>
                    <div className="cta-footer-right">
                        <p className="footer-copyright">
                            &copy;{currentYear} All Rights Reserved.
                        </p>
                        <p className="footer-credit">
                            Made with <span className="story-heart">💜</span> by Jazz
                        </p>
                    </div>
                </div>
            </section>
        </footer>
    );
}
