import "../index.css";

// About: the CV at a glance. Highlights first, then skills, then one line per
// role (newest first), then education. Facts come from the CV only.

const highlights = [
    { value: "3,000+", label: "tickets sold through the ticketing platform I built at Sphiderass Web" },
    { value: "300%+", label: "growth in team capacity from the recruitment I led" },
    { value: "30+", label: "conversion-focused landing pages shipped for Web3 clients" },
    { value: "2", label: "products led as PM / product lead: Eeko and Health Connect" },
];

const skillGroups = [
    { title: "Frontend", skills: ["React.js", "Next.js", "TypeScript", "JavaScript", "Responsive UI", "CSS/SCSS", "BEM"] },
    {
        title: "Integrations & tooling",
        skills: ["REST APIs", "Spotify API", "Cloudinary", "Resend", "Supabase", "Vercel", "Git"],
    },
    {
        title: "Product",
        skills: ["Product planning", "User testing", "Analytics", "Agile workflows", "Cross-functional collaboration"],
    },
];

const roles = [
    {
        period: "Now",
        role: "Frontend Developer & Product Lead",
        company: "Health Connect",
        line: "Leading product direction and development for a healthcare-focused platform.",
    },
    {
        period: "2026",
        role: "Freelance Frontend Developer",
        company: "Client websites",
        line: "Dorée Jewelry's e-commerce store and admin dashboard (Next.js, Supabase), plus the Clay Studio Creations and Honey Rock School sites.",
    },
    {
        period: "Apr – Dec 2025",
        role: "Product Manager",
        company: "Eeko",
        line: "Owned product planning and feature definition for a Yoruba learning app, through to release.",
    },
    {
        period: "2025",
        role: "Freelance Frontend Developer",
        company: "WeTalkSound",
        line: "Built and launched MaraMania and Cafe Riddim with Next.js, TypeScript and the Spotify API.",
    },
    {
        period: "2024 – Feb 2025",
        role: "Freelance Web Developer",
        company: "Crypto / Web3 projects",
        line: "30+ fast, design-led landing pages for clients around the world.",
    },
    {
        period: "Oct 2023 – Oct 2024",
        role: "Frontend Developer → Operations Officer",
        company: "Sphiderass Web",
        line: "Built the company site and its ticketing platform; promoted within the year and led hiring.",
    },
];

export default function AboutPage() {
    return (
        <main className="page-width about-page-shell">
            <section className="about-hero-section">
                <p className="label-mono">( Liner notes )</p>
                <h1 className="about-heading">
                    About Me<span className="story-dot">.</span>
                </h1>
                <p className="about-intro">
                    Frontend developer in Lagos. I ship production web apps with React, Next.js and TypeScript, and
                    I&apos;ve carried products from planning to launch in startup teams.
                </p>
            </section>

            <section aria-label="Highlights">
                <ul className="ab-stats">
                    {highlights.map((h) => (
                        <li key={h.value} className="ab-stat">
                            <span className="ab-stat-value">{h.value}</span>
                            <span className="ab-stat-label">{h.label}</span>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="ab-section" aria-labelledby="ab-skills">
                <h2 id="ab-skills" className="ab-heading">
                    What I work with<span className="story-dot">.</span>
                </h2>
                <div className="ab-skills">
                    {skillGroups.map((g) => (
                        <div key={g.title}>
                            <h3 className="ab-skill-title">{g.title}</h3>
                            <ul className="ab-chips">
                                {g.skills.map((s) => (
                                    <li key={s} className="ab-chip">
                                        {s}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            <section className="ab-section" aria-labelledby="ab-experience">
                <h2 id="ab-experience" className="ab-heading">
                    Experience<span className="story-dot">.</span>
                </h2>
                <ol className="ab-roles">
                    {roles.map((r) => (
                        <li key={`${r.company}-${r.period}`} className="ab-role">
                            <span className="ab-role-period">{r.period}</span>
                            <span className="ab-role-title">
                                {r.role}
                                <span className="ab-role-company">{r.company}</span>
                            </span>
                            <span className="ab-role-line">{r.line}</span>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="ab-section" aria-labelledby="ab-education">
                <h2 id="ab-education" className="ab-heading">
                    Education<span className="story-dot">.</span>
                </h2>
                <p className="ab-education">
                    B.Ed, Early Childhood Education · University of Lagos · final year (400 Level)
                </p>
            </section>
        </main>
    );
}
