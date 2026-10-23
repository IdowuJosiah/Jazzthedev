"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import "./index.css";
import { MdArrowOutward } from "react-icons/md";

const experiences = [
    {
        company: "Sphiderass Web",
        role: "Frontend Developer → Operations Officer",
        period: "Oct 2023 - Oct 2024",
        location: "Lagos, Nigeria",
        description:
            "Started as a Frontend Developer before transitioning into an Operations Officer role, contributing to both product development and internal company growth.",
        highlights: [
            "Built and maintained the company's main website using modern frontend technologies.",
            "Built a ticketing platform that processed 3,000+ ticket sales for live events.",
            "Led recruitment efforts that increased the company workforce by over 300%.",
            "Improved internal workflows and communication between departments.",
            "Managed client relationships and translated business requirements into actionable development tasks.",
        ],
    },
    {
        company: "Freelance / Web3 Projects",
        role: "Frontend Developer",
        period: "2024 - Feb 2025",
        location: "Remote",
        description:
            "Worked with clients around the world in the crypto and Web3 space, building fast-paced landing pages and digital experiences.",
        highlights: [
            "Designed and developed 30+ one-page websites for meme-coin and Web3 projects.",
            "Built responsive and conversion-focused landing pages using React.js and Next.js.",
            "Managed multiple client projects across different time zones and fast delivery cycles.",
            "Focused on performance, responsiveness, and visually engaging UI experiences.",
        ],
    },
    {
        company: "Eeko",
        role: "Product Manager",
        period: "Apr 2025 - Dec 2025",
        location: "Remote",
        description:
            "Led product planning and execution for an interactive Yoruba learning platform focused on engagement and immersive education.",
        highlights: [
            "Defined product features, user flows, and development priorities.",
            "Collaborated closely with design and engineering teams to improve product delivery.",
            "Focused on onboarding, engagement, and improving the learning experience for users.",
            "Managed communication between stakeholders and development teams.",
        ],
    },
    {
        company: "WeTalkSound",
        role: "Freelance Frontend Developer",
        period: "2025",
        location: "Remote",
        description:
            "Developed production-ready cultural and music-focused platforms that blended storytelling, visuals, and performance-driven frontend development.",
        highlights: [
            "Built and launched MaraMania, a documentary storytelling platform.",
            "Developed Cafe Riddim, a digital platform for an African electronic music collective.",
            "Integrated Spotify APIs, Cloudinary media management, and Resend email systems.",
            "Translated Figma designs into responsive, high-performance interfaces using Next.js (App Router) and TypeScript, deployed on Vercel.",
        ],
    },
    {
        company: "Freelance / Client Websites",
        role: "Frontend Developer",
        period: "2026",
        location: "Lagos, Nigeria",
        description:
            "Built three client websites from scratch on freelance contracts, from a full e-commerce store to studio and school sites.",
        highlights: [
            "Dorée Jewelry: a fully dynamic e-commerce storefront with product catalogue, collections, wishlist and customer accounts, plus a custom admin dashboard, built with Next.js and Supabase.",
            "Clay Studio Creations: a full-service creative studio site with service pages, a portfolio and a gear rental catalogue (Aug 2026).",
            "Honey Rock School: the school's website, built start to finish (Aug 2026).",
        ],
    },
    {
        company: "Health Connect",
        role: "Frontend Developer & Product Lead",
        period: "2025 - Present",
        location: "Remote",
        description:
            "Currently leading both product direction and frontend development for a health-focused platform aimed at improving healthcare accessibility and connectivity.",
        highlights: [
            "Leading product planning, feature direction, and frontend architecture.",
            "Building scalable healthcare-focused interfaces with modern frontend technologies.",
            "Balancing user experience, accessibility, and product strategy during development.",
        ],
    },
];
const skillGroups = [

  {
    title: "Frontend",
    skills: ["React.js", "Next.js", "TypeScript", "JavaScript", "Responsive UI", "CSS/SCSS", "BEM"],
  },
    {
        title: "Product Management",
        skills: [
            "Product Strategy",
            "Roadmap Planning",
            "Agile Methodology",
            "User Research",
            "Stakeholder Management",

        ],
    },
  {
    title: "Soft Skills",
    skills: ["Effective communication", "Collaboration", "Commitment", "Leadership"],
  },
];

const featuredProjects = [
  {
    title: "Cafe Riddim",
    image: "/images/caferridim.png",
    alt: "Cafe Riddim project preview",
    url: "https://www.caferiddim.com",
    year: "2025",
    kind: "Music collective",
    stack: "Next.js · TypeScript · Spotify API",
    description:
        "A cultural hub and digital home for Cafe Riddim, blending music, visuals, artist submissions, and community experiences.",
  },
  {
    title: "Eeko",
    image: "/images/eekoo.png",
    alt: "Eeko project preview",
    url: "https://eeko.site",
    year: "2025",
    kind: "Learning app · PM",
    stack: "Product planning · UX",
    description:
        "An interactive Yoruba learning platform with mini-games, pronunciation exercises, quizzes, and responsive learning flows.",
  },
  {
    title: "MaraMania",
    image: "/images/maramaniaimage.png",
    alt: "MaraMania project preview",
    url: "https://www.maramania.live",
    year: "2025",
    kind: "Documentary site",
    stack: "Next.js · TypeScript",
    description:
        "A cinematic documentary experience for bold visuals, storytelling-focused layouts, and African street culture presentation.",
  },
  {
    title: "Clay Studio Creations",
    image: "/images/claystudiocreations.jpg",
    alt: "Clay Studio Creations project preview",
    url: "https://www.claystudiocreations.com",
    year: "2026",
    kind: "Creative studio",
    stack: "Next.js · TypeScript",
    description:
        "A Lagos creative production studio site — brand, event, music video and documentary production plus gear rental, with a consultation-booking flow.",
  },
];

/** The slow ticker under the hero (shown twice so the loop is seamless). */
const tickerItems = ["Frontend developer", "Product lead", "React", "Next.js", "TypeScript", "Based in Lagos"];


export default function Home() {
  const [selectedExperience, setSelectedExperience] = useState(0);
  const activeExperience = experiences[selectedExperience];


  return (
      <main className="page-width" id="home">
          <div className="hero-container">
              <section className="hero_details">
                 <p className="label-mono hero-label">( Side A · Now playing )</p>
                 <div className="hero-first-line">
                    Hey, I&apos;m Jazz
                 </div>
                  <h1 className="hero-second-line">
                      <span className="hero-line"><span className="hero-line-inner">FrontEnd</span></span>
                      <span className="hero-line"><span className="hero-line-inner">Developer</span></span>
                  </h1>
                  <div className="hero-third-line">
                      I&apos;m a frontend developer based in Lagos, I&apos;ll help you build beautiful websites your users will love.
                  </div>
                  <div className="hero-fourth-line">
                      <Link href="/contact" className="git">
                        Get In Touch
                      </Link>
                      <Link href="#projects" className="bp">
                        Browse Projects
                      </Link>
                  </div>
                  <Link href="/field" className="hero-world-link">
                      Or drive through my work in 3D <span aria-hidden="true">→</span>
                  </Link>
              </section>
              <section className="hero-profile">
                <div className="hero-profile-circle">
                    <div className="hero-img">
                        <Image className="my-image" src="/images/profile.png" alt="profile" width={200} height={200} />
                    </div>
                </div>
              </section>
          </div>
          <div className="ticker" aria-hidden="true">
              <div className="ticker-track">
                  {[0, 1].map((copy) => (
                      <div key={copy} className="ticker-group">
                          {tickerItems.map((item) => (
                              <span key={item} className="ticker-item">{item}</span>
                          ))}
                      </div>
                  ))}
              </div>
          </div>
          <section className="landing-page-projects" id="projects">
            <div className="landing-page-projects-container">
                <div className="section-head reveal">
                    <p className="label-mono">( Track 01 — Selected work )</p>
                    <div className="section-head-row">
                        <h2 className="projects-heading">Projects</h2>
                        <Link href="/projects" className="section-link">
                            View all <MdArrowOutward aria-hidden="true" />
                        </Link>
                    </div>
                </div>
                <div className="work-grid">
                    {featuredProjects.map((project, index) => (
                        <Link
                            key={project.title}
                            href={project.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="work-card reveal"
                            data-cursor="View ↗"
                            style={{ transitionDelay: `${(index % 2) * 0.12}s` }}
                        >
                            <div className="work-frame">
                                <Image
                                    src={project.image}
                                    alt={project.alt}
                                    fill
                                    sizes="(max-width: 768px) 100vw, 50vw"
                                    className="work-image"
                                />
                            </div>
                            <p className="work-meta label-mono">
                                <span>Track {String(index + 1).padStart(2, "0")}</span>
                                <span>{project.year}</span>
                                <span>{project.kind}</span>
                            </p>
                            <p className="work-title">
                                {project.title}
                                <MdArrowOutward className="work-arrow" aria-hidden="true" />
                            </p>
                            <p className="work-desc">{project.description}</p>
                            <p className="work-stack label-mono">{project.stack}</p>
                        </Link>
                    ))}
                </div>
            </div>
          </section>
          <section id="experience">
            <div className="experience-section">
                <div className="section-head reveal">
                    <p className="label-mono">( Track 02 — Experience )</p>
                    <h2 className="experience-heading">Experience</h2>
                </div>
                <div className="experience-content">
                    <div className="experience-company-list reveal" style={{ transitionDelay: '0.1s' }}>
                        {experiences.map((experience, index) => (
                            <button
                                key={experience.company}
                                type="button"
                                className={`experience-company-item ${selectedExperience === index ? "active-experience" : ""}`}
                                onClick={() => setSelectedExperience(index)}
                            >
                                <span>{experience.company}</span>
                                {/*<span className="experience-company-period">{experience.period}</span>*/}
                            </button>
                        ))}
                    </div>
                    <div key={selectedExperience} className="experience-details-card">
                        <div className="experience-details-top">
                            <div>
                                <p className="experience-role">{activeExperience.role}</p>
                                <p className="experience-company-name">{activeExperience.company}</p>
                            </div>
                            <div className="experience-meta">
                                <span>{activeExperience.period}</span>
                                <span>{activeExperience.location}</span>
                            </div>
                        </div>
                        <p className="experience-description">
                            {activeExperience.description}
                        </p>
                        <div className="experience-highlights">
                            {activeExperience.highlights.map((highlight) => (
                                <p key={highlight} className="experience-highlight-item">
                                    {highlight}
                                </p>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
          </section>
          <section className="skills-section" id="skills">
              <div className="section-head reveal">
                  <p className="label-mono">( Track 03 — Toolkit )</p>
                  <h2 className="skills-heading">
                      Skills<span className="skills-dot">.</span>
                  </h2>
              </div>
              <div className="skills-grid">
                  {skillGroups.map((group, index) => (
                      <article key={group.title} className="skill-column reveal" style={{ transitionDelay: `${index * 0.12}s` }}>
                          <h3 className="skill-card-title">{group.title}</h3>
                          <div className="skill-list">
                              {group.skills.map((skill) => (
                                  <p key={skill} className="skill-list-item">
                                      {skill}
                                  </p>
                              ))}
                          </div>
                      </article>
                  ))}
              </div>
          </section>
          <section className="story-section" id="about">
              <div className="section-head reveal">
                  <p className="label-mono">( Track 04 — Liner notes )</p>
                  <h2 className="story-heading">
                  My Story<span className="story-dot">.</span>
                  </h2>
              </div>
              <div className="story-content">
                  <p className="story-paragraph reveal" style={{ transitionDelay: '0.05s' }}>
                      My journey into tech started with curiosity and creativity — building interfaces, experimenting with ideas, and learning how products shape the way people interact online. Over time, I transitioned from simply writing code into understanding how to build experiences people genuinely connect with.
                  </p>

                  <p className="story-paragraph reveal" style={{ transitionDelay: '0.1s' }}>
                      I started working as a <span className="story-accent">front-end developer</span>, building responsive websites and web applications using modern technologies like React, Next.js and TypeScript while collaborating with teams on client and in-house products.
                  </p>

                  <p className="story-paragraph reveal" style={{ transitionDelay: '0.15s' }}>
                      As I gained more experience, I naturally moved into <span className="story-accent">product and project management</span>, helping teams organize workflows, structure development processes, manage timelines, and turn ideas into scalable digital products.
                  </p>

                  <p className="story-paragraph reveal" style={{ transitionDelay: '0.2s' }}>
                      I&apos;ve worked on projects across different industries — from a <span className="story-accent">jewelry e-commerce store</span> and a creative studio&apos;s website to cultural platforms like <span className="story-accent">Cafe Riddim</span> and educational experiences like <span className="story-accent">Eeko</span>.
                  </p>

                  <p className="story-paragraph reveal" style={{ transitionDelay: '0.25s' }}>
                      Today, I combine both technical and product thinking to create experiences that are not only visually engaging but also functional, scalable, and user-focused. I genuinely enjoy building products, leading ideas from concept to execution, and continuously improving my craft. <span className="story-heart">💜</span>
                  </p>
              </div>          </section>
      </main>
  );
}
