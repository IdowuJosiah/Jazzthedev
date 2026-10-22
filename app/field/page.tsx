import type { Metadata } from "next";
import FieldMount from "./FieldMount";
import FieldSummary from "./FieldSummary";

export const metadata: Metadata = {
    title: "Jazz · Drive through my work",
    description:
        "An interactive portfolio: drive a small toy world of Jazz's frontend projects, the Eko product case study, music work and contact links, or skip to the classic site.",
};

export default function FieldPage() {
    return (
        <>
            <FieldMount />
            {/* After the world in DOM order so "Skip to classic portfolio" stays the first focusable. */}
            <FieldSummary />
        </>
    );
}
