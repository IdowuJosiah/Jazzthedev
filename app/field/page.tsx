import type { Metadata } from "next";
import ProjectField, { type FieldProject } from "@/app/components/three/ProjectField";
import "./field.css";

export const metadata: Metadata = {
    title: "Explore · Jazz's Interactive Project Gallery",
    description:
        "Walk through a 3D field of Jazz's projects — approach any one and open the live site.",
};

const projects: FieldProject[] = [
    {
        title: "Cafe Riddim",
        subtitle: "Music & Culture Platform",
        image: "/images/caferridim.png",
        url: "https://www.caferiddim.com",
    },
    {
        title: "Eko",
        subtitle: "Yoruba Learning Platform",
        image: "/images/eekoo.png",
        url: "https://eeko.site",
    },
    {
        title: "Northstar",
        subtitle: "Product Showcase",
        image: "/images/cRf6OhI78D9fHIZyhDlqODIP0.webp",
        url: null,
    },
    {
        title: "Mara Mania",
        subtitle: "Documentary Storytelling",
        image: "/images/mara.png",
        url: "https://www.maramania.live",
    },
];

export default function FieldPage() {
    return <ProjectField projects={projects} />;
}
