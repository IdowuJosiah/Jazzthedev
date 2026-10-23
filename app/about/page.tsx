"use client";

import { useEffect, useRef, useState } from "react";
import "../index.css";

const experiences = [
    {
        role: "Frontend Developer → Operations Officer",
        company: "Sphiderass Web",
        period: "Oct 2023 - Oct 2024",
        paragraphs: [
            "Built the company website and a ticketing platform that processed 3,000+ ticket sales. Promoted to Operations Officer within the year, I led recruitment that grew the team's capacity by over 300% and kept clients and developers aligned.",
        ],
    },
    {
        role: "Freelance Frontend Developer",
        company: "Crypto / Web3 Projects",
        period: "2024 - Feb 2025",
        paragraphs: [
            "Shipped 30+ responsive, conversion-focused landing pages for meme-coin and Web3 clients around the world, on tight timelines.",
        ],
    },
    {
        role: "Product Manager",
        company: "Eeko — Yoruba Learning App",
        period: "Apr 2025 - Dec 2025",
        paragraphs: [
            "Owned product planning and feature definition and coordinated development through to release, prioritising engagement and a simpler core learning flow.",
        ],
    },
    {
        role: "Freelance Frontend Developer",
        company: "WeTalkSound",
        period: "2025",
        paragraphs: [
            "Built and launched MaraMania and Cafe Riddim with Next.js and TypeScript, integrating the Spotify API, Cloudinary and Resend, deployed on Vercel.",
        ],
    },
    {
        role: "Freelance Frontend Developer",
        company: "Dorée Jewelry · Clay Studio Creations · Honey Rock School",
        period: "2026",
        paragraphs: [
            "Built Dorée Jewelry's e-commerce store with a custom admin dashboard (Next.js and Supabase), plus the Clay Studio Creations and Honey Rock School websites.",
        ],
    },
    {
        role: "Frontend Developer & Product Lead",
        company: "Health Connect",
        period: "2025 - Present",
        paragraphs: ["Leading product direction and frontend development for a healthcare-focused platform."],
    },
];

const stackItems = [
    "React.js",
    "Next.js",
    "TypeScript",
    "Frontend Development",
    "Product Management",
    "UI/UX Collaboration",
    "API Integration",
    "Agile Workflow",
    "Operations Management",
    "Analytics & User Testing",
    "Responsive Design",
    "Team Leadership",
];

const storyParagraphs = [
    "I started as a frontend developer and grew into product: from developer to Operations Officer at Sphiderass Web, 30+ Web3 landing pages as a freelancer, then product manager for Eeko.",

    "Today I lead product and development for Health Connect and build sites for clients, combining frontend craft with product thinking.",
];

export default function AboutPage() {
    const timelineRefs = useRef<Array<HTMLElement | null>>([]);
    const [timelineProgress, setTimelineProgress] = useState<number[]>(
        () => experiences.map(() => 0)
    );

    useEffect(() => {
        const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

        const updateTimelineProgress = () => {
            const triggerPoint = window.innerHeight * 0.55;

            setTimelineProgress(
                timelineRefs.current.map((item) => {
                    if (!item) return 0;

                    const rect = item.getBoundingClientRect();
                    return clamp((triggerPoint - rect.top) / rect.height);
                })
            );
        };

        updateTimelineProgress();
        window.addEventListener("scroll", updateTimelineProgress, { passive: true });
        window.addEventListener("resize", updateTimelineProgress);

        return () => {
            window.removeEventListener("scroll", updateTimelineProgress);
            window.removeEventListener("resize", updateTimelineProgress);
        };
    }, []);

    return (
        <main className="page-width about-page-shell">
            <section className="about-hero-section">
                <h1 className="about-heading">
                    About Me<span className="story-dot">.</span>
                </h1>
                <p className="about-intro">
                    I build digital products from both sides of the table: the frontend details users feel immediately, and the product decisions that keep teams moving with clarity.
                </p>
            </section>

            {/*<section className="about-stack-section">*/}
            {/*    <h2 className="about-stack-heading">What I Work With</h2>*/}
            {/*    <div className="about-stack-list">*/}
            {/*        {stackItems.map((item) => (*/}
            {/*            <span key={item} className="about-stack-item">*/}
            {/*                {item}*/}
            {/*            </span>*/}
            {/*        ))}*/}
            {/*    </div>*/}
            {/*</section>*/}

            <section className="about-story-section">
                <h2 className="about-section-heading">
                    My Story<span className="story-dot">.</span>
                </h2>
                <div className="story-content">
                    {storyParagraphs.map((paragraph) => (
                        <p key={paragraph} className="story-paragraph">
                            {paragraph}
                        </p>
                    ))}
                </div>
            </section>

            <section className="about-experience-section">
                <h2 className="about-section-heading">
                    Experience<span className="story-dot">.</span>
                </h2>
                <div className="experience-timeline-section">
                    {experiences.map((experience, index) => (
                        <article
                            key={`${experience.company}-${experience.period}`}
                            ref={(element) => {
                                timelineRefs.current[index] = element;
                            }}
                            className="experience-timeline-item"
                        >
                            <div className="experience-timeline-left">
                                <span className="experience-timeline-number">
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                {index < experiences.length - 1 && (
                                    <span className="experience-timeline-line" aria-hidden="true">
                                        <span
                                            className="experience-timeline-line-progress"
                                            style={{ transform: `scaleY(${timelineProgress[index] ?? 0})` }}
                                        />
                                    </span>
                                )}
                            </div>
                            <div className="experience-timeline-right">
                                <p className="experience-timeline-role">{experience.role}</p>
                                <h3 className="experience-timeline-company">{experience.company}</h3>
                                <p className="experience-timeline-period">{experience.period}</p>
                                <div className="experience-timeline-copy">
                                    {experience.paragraphs.map((paragraph) => (
                                        <p key={paragraph} className="experience-timeline-paragraph">
                                            {paragraph}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className="about-story-section">
                <h2 className="about-section-heading">
                    Education<span className="story-dot">.</span>
                </h2>
                <div className="story-content">
                    <p className="story-paragraph">
                        B.Ed, Early Childhood Education, University of Lagos. Final year (400 Level).
                    </p>
                </div>
            </section>
        </main>
    );
}
