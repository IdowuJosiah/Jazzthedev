/** A spinning record with "Available for work · Based in Lagos" around the label (decorative). */
export default function VinylBadge() {
    return (
        <div className="vinyl" aria-hidden="true">
            <svg className="vinyl-disc" viewBox="0 0 140 140">
                <defs>
                    <path id="vinyl-ring" d="M70,70 m-53,0 a53,53 0 1,1 106,0 a53,53 0 1,1 -106,0" />
                </defs>
                <circle cx="70" cy="70" r="69" fill="#0b0b0e" />
                {[62, 56, 50, 44, 38].map((r) => (
                    <circle key={r} cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.06)" />
                ))}
                {/* textLength = the ring's circumference (2π·53 ≈ 333), so the loop closes exactly. */}
                <text className="vinyl-text">
                    <textPath href="#vinyl-ring" textLength="330" lengthAdjust="spacing">
                        Available for work · Based in Lagos ·
                    </textPath>
                </text>
                <circle cx="70" cy="70" r="24" fill="rgb(29, 78, 216)" />
                <circle cx="70" cy="70" r="16" fill="none" stroke="rgba(255,255,255,0.35)" />
                <circle cx="70" cy="70" r="3" fill="#0b0b0e" />
            </svg>
        </div>
    );
}
