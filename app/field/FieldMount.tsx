"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CONFIG, LOOK } from "@/app/components/three/world3/Config";

/** v2's loading markup (styled by world.css). Also the version-pending placeholder. */
function V2Loading() {
    return (
        <div className="ekoworld-root">
            <div className="ekoworld-overlay">
                <div className="ekoworld-loadbox">
                    <p className="ekoworld-kicker">ÈKÓ NIGHTS</p>
                    <p className="ekoworld-loadlabel">Loading…</p>
                </div>
            </div>
        </div>
    );
}

// Load the whole WebGL world client-side only — three.js, Rapier WASM and
// postprocessing never run during SSR/prerender.
const FieldExperience = dynamic(() => import("./FieldExperience"), {
    ssr: false,
    loading: () => <V2Loading />,
});

// v3 "clean diorama" world, reachable behind /field?v=3 until Wave 3.
const FieldExperienceV3 = dynamic(() => import("./v3/FieldExperience"), {
    ssr: false,
    loading: () => (
        <div style={{ position: "fixed", inset: 0, background: LOOK[CONFIG.look].background }} aria-busy="true" />
    ),
});

type WorldVersion = "v2" | "v3";

export default function FieldMount() {
    // Decided after mount (in an effect) so the server HTML and the first
    // client render match — no hydration mismatch from reading location.search.
    // Until then v2's loader shows (v2 is the default), so v2's first paint is unchanged.
    const [version, setVersion] = useState<WorldVersion | null>(null);

    useEffect(() => {
        const v = new URLSearchParams(window.location.search).get("v") === "3" ? "v3" : "v2";
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot client-only decision
        setVersion(v);
    }, []);

    if (version === null) return <V2Loading />;
    return version === "v3" ? <FieldExperienceV3 /> : <FieldExperience />;
}
