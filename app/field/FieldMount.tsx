"use client";

import dynamic from "next/dynamic";
import { CONFIG, LOOK } from "@/app/components/three/world3/Config";

// Load the whole WebGL world client-side only: three.js and Rapier's WASM
// never run during SSR / prerender. Until the chunk arrives, a plain
// background-coloured placeholder (also the server HTML; FieldSummary's
// no-JS style hides it).
const FieldExperience = dynamic(() => import("./v3/FieldExperience"), {
    ssr: false,
    loading: () => (
        <div
            className="field-boot"
            style={{ position: "fixed", inset: 0, background: LOOK[CONFIG.look].background }}
            aria-busy="true"
        />
    ),
});

export default function FieldMount() {
    return <FieldExperience />;
}
