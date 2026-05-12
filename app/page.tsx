"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import "./index.css";
import { MdArrowOutward } from "react-icons/md";

const experiences = [
  {
    company: "ByteCraft",
    role: "Frontend Developer",
    period: "2024 - Present",
    location: "Remote",
    description:
      "Built polished product interfaces for a SaaS platform, focusing on reusable components, responsive layouts, and smoother onboarding flows.",
    highlights: [
      "Shipped modular UI components that reduced duplicated frontend code across product pages.",
      "Improved mobile responsiveness and accessibility for the main customer dashboard.",
      "Partnered closely with design to translate Figma concepts into production-ready experiences.",
    ],
  },
  {
    company: "Nova Studio",
    role: "Frontend Engineer",
    period: "2022 - 2024",
    location: "Milan, Italy",
    description:
      "Worked on marketing websites and internal tools, balancing performance, motion, and visual polish across multiple launches.",
    highlights: [
      "Developed high-converting landing pages with strong Lighthouse performance scores.",
      "Created scalable styling patterns that sped up delivery for new client pages.",
      "Integrated CMS-driven sections so content teams could update pages without code changes.",
    ],
  },
  {
    company: "Pixel Forge",
    role: "Junior Frontend Developer",
    period: "2021 - 2022",
    location: "Hybrid",
    description:
      "Supported product delivery by building feature pages, refining UI states, and fixing layout bugs across desktop and mobile.",
    highlights: [
      "Implemented responsive sections from scratch using React and modern CSS.",
      "Fixed cross-browser UI issues and tightened spacing consistency across the app.",
      "Helped maintain a smoother handoff between design, frontend, and QA.",
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
