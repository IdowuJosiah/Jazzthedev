"use client";

import "./index.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BsChatText } from "react-icons/bs";

const navLinks = [
    { href: "/", label: "Home" },
    { href: "/projects", label: "Projects" },
    { href: "/about", label: "About" },
];

export default function Navbar() {
    const pathname = usePathname();

    return (
        <nav className="navbar">
            <div className="nav-container">
                <div className="navbar-brand">
                    <span>JazzTheDev</span><span className="nav-brand-dot"></span>
                </div>
                <div className="navbar-menu">
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={pathname === link.href ? "nav-link active-nav-link" : "nav-link"}
                        >
                            {link.label}
                        </Link>
                    ))}
                </div>
                <div className="nav-chat-icon">
                    <Link href="/contact"><BsChatText /></Link>
                </div>
            </div>
        </nav>
    )
}
