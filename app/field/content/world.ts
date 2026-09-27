// ─────────────────────────────────────────────────────────────
// World content (CMS layer). Edit copy/links/images here — no 3D
// code changes needed. Consumed by the field scenes.
// ─────────────────────────────────────────────────────────────

export interface SectorMeta {
    id: "frontend" | "eko" | "music" | "journey";
    name: string;
    blurb: string;
    /** hex accent used for the gateway + sector theming */
    color: number;
    active: boolean;
}

export interface Terminal {
    title: string;
    pitch: string;
    description: string;
    tags: string[];
    liveUrl?: string;
    repoUrl?: string;
    /** screenshot rendered onto the in-world monitor */
    image: string;
}

/** The four sector gateways shown in the hub, in arc order. */
export const sectors: SectorMeta[] = [
    { id: "frontend", name: "Frontend Projects", blurb: "Shipped frontend work", color: 0x1d4ed8, active: true },
    { id: "eko", name: "Eko", blurb: "Product case study", color: 0xd97706, active: false },
    { id: "music", name: "Music Platform", blurb: "Spotify-powered", color: 0x9333ea, active: false },
    { id: "journey", name: "Journey & Skills", blurb: "Background & skills", color: 0x0d9488, active: false },
];

// ── Sector A — Frontend Development Projects ──
// TODO(jazz): swap in the real creative-studio + school-site details,
// screenshots, and links. These are editable placeholders.
export const frontendProjects: Terminal[] = [
    {
        title: "Cafe Riddim",
        pitch: "Culture & music platform for an African electronic collective",
        description:
            "A production frontend for Cafe Riddim — artist submissions, media galleries, and a community hub. Built the responsive UI, integrated Cloudinary media and Resend email, and shipped it end to end.",
        tags: ["Next.js", "TypeScript", "Cloudinary", "Resend"],
        liveUrl: "https://www.caferiddim.com",
        image: "/images/caferridim.png",
    },
    {
        title: "Mara Mania",
        pitch: "Cinematic documentary storytelling site",
        description:
            "A visual-first storytelling platform with bold layouts and motion. Translated design into a performant, responsive Next.js frontend focused on immersive presentation.",
        tags: ["Next.js", "TypeScript", "Motion"],
        liveUrl: "https://www.maramania.live",
        image: "/images/mara.png",
    },
    {
        title: "SphiderAss Web",
        pitch: "Frontend Developer → Operations Officer",
        description:
            "Built and maintained the company's main site and contributed to a ticketing platform that powered 3,000+ ticket sales. Worked across component architecture, REST API integration, and delivery.",
        tags: ["React", "TypeScript", "REST APIs", "CI/CD"],
        image: "/images/cRf6OhI78D9fHIZyhDlqODIP0.webp",
    },
];
