// ─────────────────────────────────────────────────────────────
// World content (CMS layer). Edit copy/links/images here — no 3D
// code changes needed. Consumed by the field scenes.
// ─────────────────────────────────────────────────────────────

import type { AreaId } from "@/app/components/three/world3/types";

/** Shape of an animated content panel opened from an in-world object. */
export interface InfoContent {
    title: string;
    sub?: string;
    body?: string;
    image?: string;
    sections?: { heading: string; text: string }[];
    tags?: string[];
    links?: { label: string; url: string }[];
    accent?: number;
}

export interface Terminal {
    title: string;
    pitch: string;
    description: string;
    tags: string[];
    liveUrl?: string;
    repoUrl?: string;
    /** Board image (1600×900 WebP built by scripts/boards); also the panel image. */
    boardImage: string;
    /** One-line board pitch, ≤ 32 characters. */
    boardPitch: string;
}

// ── Frontend projects (the CV is the source of truth for facts and stacks) ──
export const frontendProjects: Terminal[] = [
    {
        title: "Clay Studio Creations",
        pitch: "Full-service creative studio site — freelance, Aug 2026",
        description:
            "A full-service creative studio website with service pages, a portfolio and a gear rental catalogue, covering video for brands, events, podcasts, music videos and documentaries. Built on a freelance contract.",
        tags: ["Next.js", "TypeScript", "Responsive UI"],
        liveUrl: "https://www.claystudiocreations.com",
        boardImage: "/assets/boards/clay.webp",
        boardPitch: "Creative studio & gear rental",
    },
    {
        title: "Cafe Riddim",
        pitch: "Site for a melodic African electronic & house collective",
        description:
            "Built and launched for WeTalkSound (2025) with Next.js (App Router) and TypeScript: the Spotify API for music data, Cloudinary for media and Resend for email, deployed on Vercel.",
        tags: ["Next.js", "TypeScript", "Spotify API", "Cloudinary", "Resend", "Vercel"],
        liveUrl: "https://www.caferiddim.com",
        boardImage: "/assets/boards/caferiddim.webp",
        boardPitch: "Electronic & house collective",
    },
    {
        title: "MaraMania",
        pitch: "Cinematic documentary storytelling site",
        description:
            "Built and launched for WeTalkSound (2025) with Next.js (App Router) and TypeScript: a visual-first storytelling site with bold layouts and motion, deployed on Vercel.",
        tags: ["Next.js", "TypeScript", "Vercel"],
        liveUrl: "https://www.maramania.live",
        boardImage: "/assets/boards/mara.webp",
        boardPitch: "Cinematic documentary site",
    },
    {
        title: "Sphiderass Web",
        pitch: "Frontend Developer → Operations Officer, 2023 – 24",
        description:
            "Built the company website and a ticketing platform that processed 3,000+ ticket sales for live events, then took ownership of delivery and was promoted to Operations Officer within the year.",
        tags: ["React.js", "REST APIs", "Ticketing"],
        boardImage: "/assets/boards/sphiderass.webp",
        boardPitch: "Company site & ticketing",
    },
];

// ── Journey timeline and skills (from the CV) ──
export interface JourneyStop {
    year: string;
    title: string;
    body: string;
}

export const journeyStops: JourneyStop[] = [
    {
        year: "2023 – 24",
        title: "Sphiderass Web",
        body: "Joined as a frontend developer (Oct 2023 – Oct 2024). Built the company website and a ticketing platform that processed 3,000+ ticket sales for live events, and was promoted to Operations Officer within the year after taking ownership of delivery. Led recruitment that grew the team's capacity by over 300%, and kept clients and developers aligned on scope, goals and timelines.",
    },
    {
        year: "2024 – 25",
        title: "Web3 freelance",
        body: "Shipped 30+ responsive, conversion-focused landing pages for meme-coin and Web3 clients around the world (2024 – Feb 2025): fast, design-led one-pagers on tight timelines.",
    },
    {
        year: "2025",
        title: "Product Manager, Eeko",
        body: "Product manager for Eeko, a Yoruba learning app (Apr – Dec 2025). Owned product planning and feature definition, coordinated development through to release, and prioritised UX improvements around user engagement while streamlining the core learning workflow. (Full story in the Eeko area.)",
    },
    {
        year: "2025",
        title: "WeTalkSound",
        body: "Freelance frontend developer: built and launched MaraMania and Cafe Riddim with Next.js (App Router) and TypeScript, integrating the Spotify API, Cloudinary media handling and Resend email, deployed on Vercel. (See the Music area.)",
    },
    {
        year: "2026",
        title: "Freelance builds",
        body: "Dorée Jewelry: a fully dynamic e-commerce storefront (product catalogue, collections, wishlist, customer accounts) with a custom admin dashboard, built with Next.js and Supabase (shopdoree.co). Plus the Clay Studio Creations and Honey Rock School websites, each built from scratch on a freelance contract.",
    },
    {
        year: "Now",
        title: "Health Connect",
        body: "Leading both product direction and development for Health Connect, a healthcare-focused digital platform, while in the final year of a B.Ed in Early Childhood Education at the University of Lagos.",
    },
];

export interface SkillTotem {
    category: string;
    proof: string;
    skills: string[];
}

export const skillTotems: SkillTotem[] = [
    {
        category: "Frontend",
        proof: "Shipped Dorée, Cafe Riddim and 30+ sites.",
        skills: ["React.js", "Next.js", "TypeScript", "JavaScript", "Responsive UI", "CSS/SCSS", "BEM"],
    },
    {
        category: "Integration & Tooling",
        proof: "Spotify, Cloudinary, Resend on Vercel.",
        skills: ["REST APIs", "Spotify API", "Cloudinary", "Resend", "Supabase", "Vercel", "Git"],
    },
    {
        category: "Product",
        proof: "PM for Eeko; leading Health Connect.",
        skills: ["Product planning", "User testing", "Analytics", "Agile workflows", "Cross-functional collaboration"],
    },
];

// ── Eeko (Yoruba learning app), PM case study ──
export interface EkoMilestone {
    step: string;
    title: string;
    body: string;
    liveUrl?: string;
}

export const ekoMilestones: EkoMilestone[] = [
    {
        step: "01 · Problem",
        title: "The gap",
        body: "Accessible, engaging Yoruba-learning tools are scarce. Most resources are academic or dry — not built for a new, mobile-first generation that wants to actually speak the language.",
    },
    {
        step: "02 · Planning",
        title: "Product planning",
        body: "As product manager (Apr – Dec 2025), owned product planning and feature definition: what the app should do, in what order, and what the first release needed.",
    },
    {
        step: "03 · Delivery",
        title: "Through to release",
        body: "Coordinated development from feature definition through to release, keeping the team aligned on scope and priorities.",
    },
    {
        step: "04 · UX",
        title: "Engagement first",
        body: "Prioritised UX improvements around user engagement and streamlined the core learning workflow.",
    },
    {
        step: "05 · Outcome",
        title: "Live today",
        body: "Eeko is live as a Yoruba learning app.",
        liveUrl: "https://eeko.site",
    },
];

// ── Music & culture: the WeTalkSound work (from the CV) ──
export interface MusicPillar {
    title: string;
    body: string;
    url?: string;
}

export const musicPillars: MusicPillar[] = [
    {
        title: "WeTalkSound",
        body: "Freelance frontend developer for WeTalkSound (2025): built and launched two music and culture sites, MaraMania and Cafe Riddim, with Next.js (App Router) and TypeScript.",
    },
    {
        title: "Cafe Riddim",
        body: "The site for a melodic African electronic & house collective, with music data from the Spotify API.",
        url: "https://www.caferiddim.com",
    },
    {
        title: "MaraMania",
        body: "A cinematic documentary storytelling site with bold layouts and motion.",
        url: "https://www.maramania.live",
    },
    {
        title: "Tech stack",
        body: "Next.js (App Router), TypeScript, the Spotify API, Cloudinary media handling and Resend email, deployed on Vercel.",
    },
];

// ─────────────────────────────────────────────────────────────
// World identity, About, contact, credits and per-area copy.
// ─────────────────────────────────────────────────────────────

export interface WorldMeta {
    /** HTML-only, always set in Inter (the Start card kicker). Owner gate pick. */
    worldName: string;
    /** 3D hero word (ASCII / Latin-1 only: set in Bricolage). */
    heroWord: string;
    /** Flat role line under the hero word. */
    role: string;
    /** Flat greeting on the Welcome plaza (Yoruba: set in Inter). */
    greeting: string;
}

export const meta: WorldMeta = {
    worldName: "Jazz's World",
    heroWord: "JAZZ",
    role: "FRONTEND DEVELOPER · PRODUCT LEAD",
    greeting: "Ẹ káàbọ̀ — welcome",
};

export interface AboutContent {
    /** Full bio for the About panel. */
    bio: string;
    /** In-world bio, ≤ 100 characters (max 3 lines at maxWidth 16). */
    bioShort: string;
    /** Portrait image on the About board. */
    portrait: string;
    /**
     * Optional avatar model (spec §8.3). Unset until the file exists in
     * public/assets/models (e.g. "/assets/models/avatar.glb"), so no visit
     * requests a guaranteed 404; without it the portrait board is used.
     */
    avatarModel?: string;
}

export const about: AboutContent = {
    bio: "I'm a frontend developer in Lagos who ships production web apps with React, Next.js and TypeScript, and I've carried products from planning through launch in startup teams. I went from developer to Operations Officer at Sphiderass Web, shipped 30+ landing pages for Web3 clients, was product manager for Eeko, built MaraMania and Cafe Riddim for WeTalkSound and the Dorée Jewelry store, and now lead product and development for Health Connect. I also make short-form video for small brands and individuals.",
    bioShort: "Frontend developer in Lagos. I ship React and Next.js apps, and own the product direction too.",
    portrait: "/assets/boards/profile.webp",
};

export interface ContactLink {
    id: "email" | "github" | "linkedin" | "cv";
    /** Pad label (uppercase). */
    label: string;
    url: string;
    /** Human-readable value for the Contact tab. */
    display: string;
}

/** From app/contact/page.tsx and app/components/SiteFooter.tsx. The CV pad is
 *  built only when a `cv` link exists (none yet). */
export const contactLinks: ContactLink[] = [
    {
        id: "email",
        label: "EMAIL",
        url: "mailto:josiahidowutioluwanimi@gmail.com",
        display: "josiahidowutioluwanimi@gmail.com",
    },
    { id: "github", label: "GITHUB", url: "https://github.com/IdowuJosiah", display: "github.com/IdowuJosiah" },
    {
        id: "linkedin",
        label: "LINKEDIN",
        url: "https://www.linkedin.com/in/josiah-idowu-7282a6232/",
        display: "linkedin.com/in/josiah-idowu-7282a6232",
    },
];

export interface CreditEntry {
    name: string;
    author: string;
    license: string;
    url: string;
}

/** Credits tab + jetty sign. Mirrors CREDITS.md. */
export const credits: CreditEntry[] = [
    { name: "three.js", author: "mrdoob and contributors", license: "MIT", url: "https://threejs.org" },
    { name: "Rapier (rapier3d-compat)", author: "Dimforge", license: "Apache-2.0", url: "https://rapier.rs" },
    { name: "troika-three-text", author: "Jason Johnston", license: "MIT", url: "https://github.com/protectwise/troika" },
    { name: "GSAP", author: "GreenSock", license: "Standard \"no charge\" license", url: "https://gsap.com" },
    { name: "detect-gpu", author: "pmndrs", license: "MIT", url: "https://github.com/pmndrs/detect-gpu" },
    { name: "Inter", author: "Rasmus Andersson", license: "OFL 1.1", url: "https://github.com/google/fonts/tree/main/ofl/inter" },
    {
        name: "Bricolage Grotesque",
        author: "Mathieu Triay",
        license: "OFL 1.1",
        url: "https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque",
    },
    { name: "Nature Kit", author: "Kenney", license: "CC0 1.0", url: "https://kenney.nl/assets/nature-kit" },
    { name: "Interface Sounds", author: "Kenney", license: "CC0 1.0", url: "https://kenney.nl/assets/interface-sounds" },
    { name: "Palm Tree", author: "Quaternius", license: "CC0 1.0", url: "https://poly.pizza/m/P0tgwyXBgr" },
    { name: "Cool City (music bed)", author: "mintodog", license: "CC0 1.0", url: "https://opengameart.org/content/cool-city" },
    {
        name: "Racing car engine loop",
        author: "domasx2",
        license: "CC0 1.0",
        url: "https://opengameart.org/content/racing-car-engine-sound-loops",
    },
];

/** One-line sign text on the Credits jetty. */
export const creditsSignLine = "three.js · Rapier · Kenney · Inter · Bricolage Grotesque";

export interface AreaCopy {
    name: string;
    /** Short line used by the first-visit toast and the map list. */
    blurb: string;
}

export const areaCopy: Record<AreaId, AreaCopy> = {
    welcome: { name: "Welcome", blurb: "Start here" },
    hub: { name: "Crossroads", blurb: "Every path starts here" },
    projects: { name: "Frontend Projects", blurb: `${frontendProjects.length} projects` },
    journey: { name: "Journey & Skills", blurb: `${journeyStops.length} milestones · ${skillTotems.length} skill sets` },
    eko: { name: "Eeko", blurb: "Product case study" },
    music: { name: "Music & Culture", blurb: `${musicPillars.length} records` },
    about: { name: "About & Contact", blurb: "Say hello" },
    playground: { name: "Playground", blurb: "Ramp, bowling and a brick wall" },
    credits: { name: "Credits", blurb: "Who made what" },
};
