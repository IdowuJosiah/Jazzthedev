import type { Metadata } from "next";
import ProjectField from "@/app/components/three/ProjectField";
import "./field.css";

export const metadata: Metadata = {
    title: "Explore · Jazz's Interactive 3D World",
    description:
        "Drive through a 3D world of Jazz's work — enter themed sectors and pull up to each project.",
};

export default function FieldPage() {
    return <ProjectField />;
}
