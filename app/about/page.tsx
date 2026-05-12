"use client";

import { useEffect, useRef, useState } from "react";
import "../index.css";

const experiences = [
    {
        role: "Frontend Developer → Operations Officer",
        company: "SphiderAssWeb",
        period: "Oct 2023 - Oct 2024",
        paragraphs: [
            "Started as a Frontend Developer, building and maintaining the company’s main website while collaborating with designers and backend engineers to deliver responsive, scalable interfaces for client and in-house products.",

            "Contributed to the development of a ticketing platform that successfully powered an event with over 3,000 ticket sales, helping improve performance, usability, and user experience across the platform.",

            "After months of strong contributions, I was promoted to Operations Officer where I led recruitment efforts that increased the company workforce by over 300%, improved internal workflows, and strengthened communication between departments.",

            "I also managed client relationships, translated business requirements into actionable development tasks, and played a key role in securing the company’s largest client.",
        ],
    },
    {
        role: "Freelance Frontend Developer",
        company: "Crypto / Web3 Projects",
        period: "2024 - Feb 2025",
        paragraphs: [
            "Worked independently with clients in the crypto and NFT space, designing and developing over 30 one-page websites and landing pages for meme coin and Web3 projects.",

            "Focused on building fast, responsive, and visually engaging interfaces optimized for conversions while managing multiple projects across different time zones and tight delivery timelines.",
        ],
    },
    {
        role: "Product Manager",
        company: "Eeko — Yoruba Learning App",
        period: "Apr 2025 - Dec 2025",
        paragraphs: [
            "Led product planning and execution for Eeko, an interactive Yoruba learning platform focused on creating engaging educational experiences through games and immersive learning flows.",

            "Defined product features, user flows, and development priorities while coordinating closely with design and engineering teams to ensure timely and efficient product delivery.",

            "Focused heavily on user engagement, onboarding experience, and making language learning feel more interactive, accessible, and culturally relevant.",
        ],
    },
    {
        role: "Freelance Developer",
        company: "WeTalkSound",
        period: "2025",
        paragraphs: [
            "Built and launched two production-ready platforms: Mara Mania, a documentary storytelling platform, and Cafe Riddim, a digital home for an African electronic music collective.",

            "Used Next.js, TypeScript, and CSS Modules to translate Figma designs into responsive, high-performance interfaces with strong visual storytelling and smooth user experiences.",

            "Integrated Spotify APIs for music functionality, managed media delivery with Cloudinary, implemented email systems using Resend, and deployed applications using Vercel.",
        ],
    },
    {
        role: "Frontend Developer & Product Lead",
        company: "Health Connect",
        period: "2025 - Present",
        paragraphs: [
            "Currently leading both product direction and frontend development for Health Connect, a health-focused platform designed to improve access and connectivity within healthcare systems.",

            "Working across strategy, planning, interface design, and development to shape a scalable product experience that balances usability, accessibility, and real-world healthcare needs.",
        ],
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
    "My journey into tech started with frontend development and a strong curiosity for building interfaces that feel modern, interactive, and intuitive for users.",

    "As I gained more experience, I started moving beyond just writing code and became more involved in how products were planned, structured, and delivered — which naturally pushed me toward product and operations management.",

    "At SphiderAssWeb, I grew from being a frontend developer into an Operations Officer role where I helped scale the team, improve internal workflows, manage client relationships, and contribute to larger business decisions.",

    "Alongside my full-time experience, I worked independently as a freelance developer, building over 30 websites in the crypto and Web3 space while learning how to balance speed, design quality, and client expectations across fast-moving projects.",

    "Over time, I transitioned deeper into product management, leading projects like Eeko while still maintaining a strong frontend engineering foundation. I enjoy bridging the gap between design, development, business goals, and user experience.",

    "Today, I focus on building digital products that are visually strong, technically scalable, and strategically aligned — combining frontend development, product thinking, and operational leadership into the way I work.",
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

            <section className="about-stack-section">
                <h2 className="about-stack-heading">What I Work With</h2>
                <div className="about-stack-list">
                    {stackItems.map((item) => (
                        <span key={item} className="about-stack-item">
                            {item}
                        </span>
                    ))}
                </div>
            </section>

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
        </main>
    );
}
