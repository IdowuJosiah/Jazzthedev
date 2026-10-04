"use client";

import dynamic from "next/dynamic";

// Load the whole WebGL world client-side only — three.js, Rapier WASM and
// postprocessing never run during SSR/prerender.
const FieldExperience = dynamic(() => import("./FieldExperience"), {
    ssr: false,
    loading: () => (
        <div className="ekoworld-root">
            <div className="ekoworld-overlay">
                <div className="ekoworld-loadbox">
                    <p className="ekoworld-kicker">ÈKÓ NIGHTS</p>
                    <p className="ekoworld-loadlabel">Loading…</p>
                </div>
            </div>
        </div>
    ),
});

export default function FieldMount() {
    return <FieldExperience />;
}
