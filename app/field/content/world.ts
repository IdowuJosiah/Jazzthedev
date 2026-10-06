// ─────────────────────────────────────────────────────────────
// World content (CMS layer). Edit copy/links/images here — no 3D
// code changes needed. Consumed by the field scenes.
// ─────────────────────────────────────────────────────────────

import type { AreaId } from "@/app/components/three/world3/types";

export interface SectorMeta {
    id: "frontend" | "eko" | "music" | "journey";
    name: string;
    blurb: string;
    /** hex accent used for the gateway + sector theming */
    color: number;
    active: boolean;
}

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
    /** screenshot rendered onto the in-world monitor */
    image: string;
    /** v3 board image (1600×900 WebP built by scripts/boards). */
    boardImage: string;
    /** v3 one-line board pitch, ≤ 32 characters. */
    boardPitch: string;
}

/** The four sector gateways shown in the hub, in arc order. */
export const sectors: SectorMeta[] = [
    { id: "frontend", name: "Frontend Projects", blurb: "Shipped frontend work", color: 0x1d4ed8, active: true },
    { id: "eko", name: "Eko", blurb: "Product case study", color: 0xd97706, active: true },
    { id: "music", name: "Music Platform", blurb: "Spotify-powered", color: 0x9333ea, active: true },
    { id: "journey", name: "Journey & Skills", blurb: "Background & skills", color: 0x0d9488, active: true },
];

// ── Sector A — Frontend Development Projects ──
// TODO(jazz): swap in the real creative-studio + school-site details,
// screenshots, and links. These are editable placeholders.
export const frontendProjects: Terminal[] = [
    {
        title: "Clay Studio Creations",
        pitch: "Creative production studio & gear rental — Lagos",
        description:
            "A full-service creative production studio: video for brands, events, YouTube & podcasts, music videos and documentaries, plus professional gear rental — all under one roof. Built the end-to-end site around a 'Create. Curate. Connect.' identity, with dark mode, a consultation-booking flow, and a gear catalogue.",
        tags: ["Next.js", "TypeScript", "Dark Mode", "Booking Flow"],
        liveUrl: "https://www.claystudiocreations.com",
        image: "/images/claystudiocreations.jpg",
        boardImage: "/assets/boards/clay.webp",
        boardPitch: "Creative studio & gear rental",
    },
    {
        title: "Cafe Riddim",
        pitch: "Culture & music platform for an African electronic collective",
        description:
            "A production frontend for Cafe Riddim — artist submissions, media galleries, and a community hub. Built the responsive UI, integrated Cloudinary media and Resend email, and shipped it end to end.",
        tags: ["Next.js", "TypeScript", "Cloudinary", "Resend"],
        liveUrl: "https://www.caferiddim.com",
        image: "/images/caferridim.png",
        boardImage: "/assets/boards/caferiddim.webp",
        boardPitch: "Platform for a music collective",
    },
    {
        title: "Mara Mania",
        pitch: "Cinematic documentary storytelling site",
        description:
            "A visual-first storytelling platform with bold layouts and motion. Translated design into a performant, responsive Next.js frontend focused on immersive presentation.",
        tags: ["Next.js", "TypeScript", "Motion"],
        liveUrl: "https://www.maramania.live",
        image: "/images/mara.png",
        boardImage: "/assets/boards/mara.webp",
        boardPitch: "Cinematic documentary site",
    },
    {
        title: "SphiderAss Web",
        pitch: "Frontend Developer → Operations Officer",
        description:
            "Built and maintained the company's main site and contributed to a ticketing platform that powered 3,000+ ticket sales. Worked across component architecture, REST API integration, and delivery.",
        tags: ["React", "TypeScript", "REST APIs", "CI/CD"],
        image: "/images/cRf6OhI78D9fHIZyhDlqODIP0.webp",
        boardImage: "/assets/boards/sphiderass.webp",
        boardPitch: "Main site & ticketing platform",
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
        body: "Moved into product: founded and led Eko, an interactive Yoruba learning platform — roadmap, research, and cross-functional delivery. (Full story in the Eko area.)",
    },
    {
        year: "2025",
        title: "Music & culture platforms",
        body: "Built cultural/music products like Cafe Riddim and Mara Mania, integrating Spotify, Cloudinary, and email systems. (See the Music area.)",
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

// ── Sector B — Eko (Yoruba Learning App), PM case study ──
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
        step: "02 · Discovery",
        title: "Research & insights",
        body: "Talked to learners and diaspora users. The core insight: motivation collapses without play and pronunciation feedback — people needed quick wins, not grammar drills.",
    },
    {
        step: "03 · Roadmap",
        title: "Scope & priorities",
        body: "Sequenced the core loops — vocabulary, pronunciation, quizzes, and mini-games — and deliberately cut scope to ship a focused, delightful MVP first.",
    },
    {
        step: "04 · Delivery",
        title: "Cross-functional build",
        body: "Partnered with design and engineering to ship onboarding, interactive lessons, and gamified practice — balancing learning outcomes with engagement.",
    },
    {
        step: "05 · Outcome",
        title: "Where Eko is now",
        body: "A live, interactive learning platform. Next up: expanding content depth and strengthening retention loops.",
        liveUrl: "https://eeko.site",
    },
];

/** Floating vocabulary orbs scattered near the path — playful texture. */
export interface YorubaWord {
    word: string;
    meaning: string;
    /** Optional pronunciation guide (shown in the v3 glossary when present). */
    pron?: string;
}

export const yorubaWords: YorubaWord[] = [
    { word: "Ẹ káàbọ̀", meaning: "Welcome", pron: "eh kah-ah-baw" },
    { word: "Ọmọ", meaning: "Child", pron: "aw-maw" },
    { word: "Ilé", meaning: "Home", pron: "ee-lay" },
    { word: "Omi", meaning: "Water", pron: "oh-mee" },
    { word: "Oúnjẹ", meaning: "Food", pron: "oh-oon-jeh" },
    { word: "Ọ̀rẹ́", meaning: "Friend", pron: "aw-reh" },
    { word: "Ìfẹ́", meaning: "Love", pron: "ee-feh" },
    { word: "Ẹ ṣé", meaning: "Thank you", pron: "eh sheh" },
];

// ── Sector C — Music Platform (Spotify API) ──
// TODO(jazz): confirm the real Spotify features/data used + the live URL.
export interface MusicPillar {
    title: string;
    body: string;
    url?: string;
}

export const musicPillars: MusicPillar[] = [
    {
        title: "The platform",
        body: "A music product built on the Spotify Web API — search Spotify's catalogue, browse playlists, and surface rich track detail with 30-second previews. Frontend in Next.js / TypeScript.",
        url: "https://www.caferiddim.com",
    },
    {
        title: "Spotify Search",
        body: "Debounced search across artists, albums, and tracks, returning artwork, metadata, and preview URLs from the Spotify Web API.",
    },
    {
        title: "Playlists & Previews",
        body: "Browse curated playlists and audition tracks with in-app 30-second previews — no Premium account required.",
    },
    {
        title: "Tech stack",
        body: "Next.js, TypeScript, the Spotify Web API for data, and the Web Audio API powering the visualiser on the stage (with sound on).",
    },
];

// ─────────────────────────────────────────────────────────────
// v3 world (/field?v=3) — additive content. v2 ignores these.
// ─────────────────────────────────────────────────────────────

export interface WorldMeta {
    /** HTML-only, always set in Inter. Owner picks the final name at the gate. */
    worldName: string;
    /** 3D hero word (ASCII / Latin-1 only: set in Bricolage). */
    heroWord: string;
    /** Flat role line under the hero word. */
    role: string;
    /** Flat greeting on the Welcome plaza (Yoruba: set in Inter). */
    greeting: string;
}

export const meta: WorldMeta = {
    worldName: "Èkó",
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
    /** Optional avatar model; when the file is absent the portrait board is used. */
    avatarModel?: string;
}

export const about: AboutContent = {
    bio: "I build digital products from both sides of the table: the frontend details users feel immediately, and the product decisions that keep teams moving with clarity. I grew from frontend developer to operations officer at SphiderAssWeb, shipped 30+ sites as a freelancer, led Eko as product manager, and today lead product and frontend for Health Connect.",
    bioShort: "Frontend developer and product lead. I build the details users feel and the decisions behind them.",
    portrait: "/assets/boards/profile.webp",
    avatarModel: "/assets/models/avatar.glb",
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

/** Credits tab + jetty sign. Mirrors CREDITS.md for the assets v3 uses. */
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
    { name: "Car Kit (car)", author: "Kenney", license: "CC0 1.0", url: "https://kenney.nl/assets/car-kit" },
    { name: "Nature Kit", author: "Kenney", license: "CC0 1.0", url: "https://kenney.nl/assets/nature-kit" },
    { name: "Impact Sounds", author: "Kenney", license: "CC0 1.0", url: "https://kenney.nl/assets/impact-sounds" },
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
    eko: { name: "Eko", blurb: "Product case study" },
    music: { name: "Music & Culture", blurb: `${musicPillars.length} records` },
    about: { name: "About & Contact", blurb: "Say hello" },
    playground: { name: "Playground", blurb: "Ramp, bowling and a brick wall" },
    credits: { name: "Credits", blurb: "Who made what" },
};
