"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import "../index.css";
import { MdArrowOutward } from "react-icons/md";

const projects = [
    {
        title: "Cafe Riddim",
        subtitle: "African Electronic Music Collective",
        year: "2026",
        image: "/images/caferridim.png",
        description:
            "A cultural hub and digital home for Cafe Riddim — blending music, visuals, artist submissions, and community experiences into an immersive platform rooted in African electronic and house music culture.",
        tags: ["Next.js", "Spotify API", "Cloudinary", "Resend"],
    },
    {
        title: "Eko",
        subtitle: "Interactive Yoruba Learning Platform",
        year: "2026",
        image: "/images/eekoo.png",
        description:
            "An engaging educational platform designed to make learning Yoruba fun and interactive through mini-games, pronunciation exercises, quizzes, and immersive language-learning experiences.",
        tags: ["Frontend", "Gamification", "UX Design", "Responsive UI"],
    },
    {
        title: "Northstar",
        subtitle: "Product Showcase Platform",
        year: "2026",
        image: "/images/cRf6OhI78D9fHIZyhDlqODIP0.webp",
        description:
            "A modular product presentation page designed around reusable sections, elegant scaling across devices, and premium-feeling content transitions.",
        tags: ["React", "Component Systems", "Accessibility"],
    },
    {
        title: "Mara Mania",
        subtitle: "Documentary & Cultural Storytelling Platform",
        year: "2026",
        image: "/images/mara.png",
        description:
            "A cinematic documentary experience built to showcase Mara Mania through bold visuals, storytelling-focused layouts, and immersive presentation of African street culture, music, and movement.",
        tags: ["Creative Direction", "Visual Storytelling", "UI Design", "Motion"],
    },
];

export default function ProjectsPage() {
    const cardRefs = useRef<Array<HTMLElement | null>>([]);
    const [visibleCards, setVisibleCards] = useState<number[]>([]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const index = Number((entry.target as HTMLElement).dataset.index);

                    if (entry.isIntersecting) {
                        setVisibleCards((current) =>
                            current.includes(index) ? current : [...current, index]
                        );
                    }
                });
            },
            {
                threshold: 0.18,
                rootMargin: "0px 0px -4% 0px",
            }
        );

        cardRefs.current.forEach((card) => {
            if (card) observer.observe(card);
        });

        return () => observer.disconnect();
    }, []);

    return (
        <main className="page-width projects-page-shell">
            <section className="projects-page-hero">
                <div className="projects-page-hero-copy">
                    <p className="projects-page-kicker">Selected Work</p>
                    <h1 className="projects-page-heading">
                        My Projects<span className="story-dot">.</span>
                    </h1>
                    <p className="projects-page-description">
                        A curated look at the interfaces and visual experiences I&apos;ve been shaping. I wanted this page to feel more immersive, so each project reveals itself gradually as you scroll.
                    </p>
                </div>

            </section>

            <section className="projects-showcase-section">
                {projects.map((project, index) => (
                    <article
                        key={project.title}
                        ref={(element) => {
                            cardRefs.current[index] = element;
                        }}
                        data-index={index}
                        className={`project-showcase-card ${visibleCards.includes(index) ? "project-showcase-card-visible" : ""}`}
                        style={{ top: `${7 + index * 1.5}rem` }}
                    >
                        <div className="project-showcase-image-wrap">
                            <Image
                                src={project.image}
                                alt={project.title}
                                width={1400}
                                height={900}
                                className="project-showcase-image"
                            />
                            <div className="project-showcase-image-overlay" />
                            <div className="project-showcase-meta">
                                <span className="project-showcase-year">{project.year}</span>
                                <span className="project-showcase-subtitle">{project.subtitle}</span>
                            </div>
                        </div>

                        <div className="project-showcase-content">
                            <div className="project-showcase-heading-row">
                                <div>
                                    <p className="project-showcase-title">{project.title}</p>
                                    <p className="project-showcase-description">{project.description}</p>
                                </div>
                                <Link href="/contact" className="project-showcase-link">
                                    <span>Discuss Project</span>
                                    <span className="l-project-link">
                                        <MdArrowOutward />
                                    </span>
                                </Link>
                            </div>

                            <div className="project-showcase-tags">
                                {project.tags.map((tag) => (
                                    <span key={tag} className="project-showcase-tag">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </article>
                ))}
            </section>
        </main>
    );
}
