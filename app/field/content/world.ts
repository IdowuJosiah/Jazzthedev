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
    { id: "journey", name: "Journey & Skills", blurb: "Background & skills", color: 0x0d9488, active: true },
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

// ── Sector D — Background, Skills & Journey Timeline ──
// TODO(jazz): refine dates/wording to taste.
export interface JourneyStop {
    year: string;
    title: string;
    body: string;
}

export const journeyStops: JourneyStop[] = [
    {
        year: "Beginnings",
        title: "Getting into development",
        body: "Started with curiosity and creativity — building interfaces, experimenting with ideas, and learning how products shape the way people interact online.",
    },
    {
        year: "2023 – 24",
        title: "SphiderAss Web",
        body: "Joined as a Frontend Developer and grew into an Operations Officer. Built the company's main site, contributed to a ticketing platform behind 3,000+ ticket sales, and led hiring that grew the team 300%.",
    },
    {
        year: "2024 – 25",
        title: "Freelance & Web3",
        body: "Shipped 30+ landing pages and one-page sites for creative studios, schools, and crypto/NFT projects — fast delivery cycles focused on performance and polish.",
    },
    {
        year: "2025",
        title: "Founding Eko",
        body: "Moved into product: founded and led Eko, an interactive Yoruba learning platform — roadmap, research, and cross-functional delivery. (Full story in the Eko sector.)",
    },
    {
        year: "2025",
        title: "Music & culture platforms",
        body: "Built cultural/music products like Cafe Riddim and Mara Mania, integrating Spotify, Cloudinary, and email systems. (See the Music sector.)",
    },
    {
        year: "Now",
        title: "Product + frontend lead",
        body: "Leading both product direction and frontend for a health-focused platform — balancing UX, accessibility, and strategy.",
    },
];

export interface SkillTotem {
    category: string;
    proof: string;
    skills: string[];
}

export const skillTotems: SkillTotem[] = [
    {
        category: "Frontend Engineering",
        proof: "Shipped Cafe Riddim, Mara Mania, and 30+ sites.",
        skills: ["React", "TypeScript", "Next.js", "Component architecture", "Testing", "CI/CD", "Git"],
    },
    {
        category: "Product Management",
        proof: "Led Eko end to end.",
        skills: ["Roadmapping", "User research", "Prioritization", "Cross-functional delivery"],
    },
    {
        category: "Tools & Collaboration",
        proof: "Day-to-day delivery across teams.",
        skills: ["Figma", "Notion", "Slack", "Analytics"],
    },
];
