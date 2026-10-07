import type { ReactNode } from "react";
import { Bricolage_Grotesque, Inter } from "next/font/google";

// /field fonts (§3.2 "DOM fonts"): Inter for reading, Bricolage Grotesque for
// display, exposed as CSS variables on a plain wrapper div. The v3 UI reads
// them through --w-font / --w-display; v2's styles never reference them, and
// its full-screen root is position: fixed, so the wrapper doesn't affect it.

const inter = Inter({
    subsets: ["latin", "latin-ext", "vietnamese"],
    variable: "--font-inter",
    display: "swap",
});

const bricolage = Bricolage_Grotesque({
    subsets: ["latin", "latin-ext", "vietnamese"],
    variable: "--font-bricolage",
    display: "swap",
});

export default function FieldLayout({ children }: Readonly<{ children: ReactNode }>) {
    return <div className={`${inter.variable} ${bricolage.variable}`}>{children}</div>;
}
