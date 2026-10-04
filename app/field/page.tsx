import type { Metadata } from "next";
import FieldMount from "./FieldMount";
import "./world.css";

export const metadata: Metadata = {
    title: "Èkó Nights · Jazz's Interactive 3D World",
    description:
        "Drive a neon night island of Jazz's work — explore project districts, collect Yoruba words, and pull up to each build.",
};

export default function FieldPage() {
    return <FieldMount />;
}
