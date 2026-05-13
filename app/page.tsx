"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import "./index.css";
import { MdArrowOutward } from "react-icons/md";

const experiences = [
    {
        company: "SphiderAssWeb",
        role: "Frontend Developer → Operations Officer",
        period: "Oct 2023 - Oct 2024",
        location: "Lagos, Nigeria",
        description:
            "Started as a Frontend Developer before transitioning into an Operations Officer role, contributing to both product development and internal company growth.",
        highlights: [
            "Built and maintained the company’s main website using modern frontend technologies.",
            "Contributed to the development of a ticketing platform that powered an event with 3,000+ ticket sales.",
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
            "Worked with multiple clients in the crypto and NFT space, building fast-paced landing pages and digital experiences for Web3 projects.",
        highlights: [
            "Designed and developed 30+ one-page websites for meme coin and NFT projects.",
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
            "Built and launched Mara Mania, a documentary storytelling platform.",
            "Developed Cafe Riddim, a digital platform for an African electronic music collective.",
            "Integrated Spotify APIs, Cloudinary media management, and Resend email systems.",
            "Translated Figma designs into responsive, high-performance interfaces using Next.js and TypeScript.",
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
    skills: ["Javascript", "ReactJS", "NextJS", "CSS3"],
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
    imageClassName: "pj-image-4",
    alt: "Cafe Riddim project preview",
    description:
        "A cultural hub and digital home for Cafe Riddim, blending music, visuals, artist submissions, and community experiences.",
  },
  {
    title: "Eko",
    image: "/images/eekoo.png",
    imageClassName: "pj-image-6",
    alt: "Eko project preview",
    description:
        "An interactive Yoruba learning platform with mini-games, pronunciation exercises, quizzes, and responsive learning flows.",
  },
  {
    title: "Northstar",
    image: "/images/cRf6OhI78D9fHIZyhDlqODIP0.webp",
    imageClassName: "pj-image-6",
    alt: "Northstar project preview",
    description:
        "A modular product showcase page built around reusable sections, elegant scaling, and premium content transitions.",
  },
  {
    title: "Mara Mania",
    image: "/images/mara.png",
    imageClassName: "pj-image-4",
    alt: "Mara Mania project preview",
    description:
        "A cinematic documentary experience for bold visuals, storytelling-focused layouts, and African street culture presentation.",
  },
];


export default function Home() {
  const [selectedExperience, setSelectedExperience] = useState(0);
  const activeExperience = experiences[selectedExperience];

  return (
      <main className="page-width" id="home">
          <div className="hero-container">
              <section className="hero_details">
                 <div className="hero-first-line">
                    Hey, I&apos;m Jazz
                 </div>
                  <div className="hero-second-line">
                      <p>
                          FrontEnd
                      </p>
                      <p>
                          Developer
                      </p>
                  </div>
                  <div className="hero-third-line">
                      I&apos;m a frontend developer based in Italy, I&apos;ll help you build beautiful websites your users will love.
                  </div>
                  <div className="hero-fourth-line">
                      <Link href="#contact" className="git">
                        Get In Touch
                      </Link>
                      <Link href="#projects" className="bp">
                        Browse Projects
                      </Link>
                  </div>
              </section>
              <section className="hero-profile">
                <div className="hero-profile-circle">
                    <div className="hero-img">
                        <Image className="my-image" src="/images/profile.png" alt="profile" width={200} height={200} />
                    </div>
                </div>
              </section>
          </div>
          <section className="landing-page-projects" id="projects">
            <div className="landing-page-projects-container">
                <h1 className="projects-heading">
                    Projects
                </h1>
                <div className="list-projects-container" >
                    <section className="project-list-top">
                        <div className="project-list-top-left">
                            <Image src={featuredProjects[0].image} className={featuredProjects[0].imageClassName} alt={featuredProjects[0].alt} width={200} height={200} />
                            <p className="landing-project-title">
                               <span className="l-project-name">{featuredProjects[0].title}</span> <span className="l-project-link"> <MdArrowOutward /></span>
                            </p>
                            <p className="landing-project-description">
                                {featuredProjects[0].description}
                            </p>
                        </div>
                        <div className="project-list-top-right">
                            <Image src={featuredProjects[1].image} className={featuredProjects[1].imageClassName} alt={featuredProjects[1].alt} width={200} height={200} />
                            <p className="landing-project-title">
                                <span className="l-project-name">{featuredProjects[1].title}</span> <span className="l-project-link"> <MdArrowOutward /></span>
                            </p>
                            <p className="landing-project-description">
                                {featuredProjects[1].description}
                            </p>
                        </div>
                    </section>
                    <section className="project-list-bottom">
                        <div className="project-list-bottom-left">
                            <Image src={featuredProjects[2].image} className={featuredProjects[2].imageClassName} alt={featuredProjects[2].alt} width={200} height={200} />
                            <p className="landing-project-title">
                                <span className="l-project-name">{featuredProjects[2].title}</span> <span className="l-project-link"> <MdArrowOutward /></span>
                            </p>
                            <p className="landing-project-description">
                                {featuredProjects[2].description}
                            </p>
                        </div>
                        <div className="project-list-bottom-right">
                            <Image src={featuredProjects[3].image} className={featuredProjects[3].imageClassName} alt={featuredProjects[3].alt} width={200} height={200} />
                            <p className="landing-project-title">
                                <span className="l-project-name">{featuredProjects[3].title}</span> <span className="l-project-link"> <MdArrowOutward /></span>
                            </p>
                            <p className="landing-project-description">
                                {featuredProjects[3].description}
                            </p>
                        </div>
                    </section>
                </div>
            </div>
          </section>
          <section id="experience">
            <div className="experience-section">
                <p className="experience-heading">
                    Experience
                </p>
                <div className="experience-content">
                    <div className="experience-company-list">
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
                    <div className="experience-details-card">
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
              <p className="skills-heading">
                  Skills<span className="skills-dot">.</span>
              </p>
              <div className="skills-grid">
                  {skillGroups.map((group) => (
                      <article key={group.title} className="skill-column">
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
              <p className="story-heading">
                  My Story<span className="story-dot">.</span>
              </p>
              <div className="story-content">
                  <p className="story-paragraph">
                      My journey into tech started with curiosity and creativity — building interfaces, experimenting with ideas, and learning how products shape the way people interact online. Over time, I transitioned from simply writing code into understanding how to build experiences people genuinely connect with.
                  </p>

                  <p className="story-paragraph">
                      I started working as a <span className="story-accent">front-end developer</span>, building responsive websites and web applications using modern technologies like ReactJS and NextJS while collaborating with teams on client and in-house products.
                  </p>

                  <p className="story-paragraph">
                      As I gained more experience, I naturally moved into <span className="story-accent">product and project management</span>, helping teams organize workflows, structure development processes, manage timelines, and turn ideas into scalable digital products.
                  </p>

                  <p className="story-paragraph">
                      I’ve worked on projects across different industries — from <span className="story-accent">real estate platforms</span> and fashion-commerce websites to creative cultural platforms like <span className="story-accent">Cafe Riddim</span> and educational experiences like <span className="story-accent">Eko</span>.
                  </p>

                  <p className="story-paragraph">
                      Today, I combine both technical and product thinking to create experiences that are not only visually engaging but also functional, scalable, and user-focused. I genuinely enjoy building products, leading ideas from concept to execution, and continuously improving my craft. <span className="story-heart">💜</span>
                  </p>
              </div>          </section>
      </main>
  );
}
