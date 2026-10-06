// ─────────────────────────────────────────────────────────────────────────
// Central config for the "Èkó Nights" world. Every tunable lives here so
// there are no magic numbers in the engine and the debug panel can bind to it.
// ─────────────────────────────────────────────────────────────────────────

export type QualityTier = "low" | "medium" | "high";

export const PALETTE = {
    // Afro-futurist Lagos-at-dusk: warm horizon, deep indigo night, neon accents.
    skyTop: 0x0b1028,
    skyBottom: 0x3a2a4d,
    horizon: 0xff7a3c,
    fog: 0x1a1733,
    water: 0x12213f,
    sand: 0xd9b38c,
    ground: 0x1d2440,
    grass: 0x2f6b4f,
    neonPink: 0xff2e88,
    neonCyan: 0x37e0ff,
    neonAmber: 0xffb23e,
    neonLime: 0xb4ff3e,
    white: 0xfff4e6,
} as const;

// Accent used per project zone (ties to the classic site's sector colors).
export const ZONE_ACCENT: Record<string, number> = {
    frontend: 0x37e0ff,
    eko: PALETTE.neonAmber,
    music: PALETTE.neonPink,
    journey: PALETTE.neonLime,
};

export const CONFIG = {
    world: {
        seed: 20260104,
        size: 420, // half-extent of the playable island (world units)
        waterLevel: -0.4,
        shoreRadius: 150, // island radius before water takes over
    },
    camera: {
        fov: 55,
        near: 0.3,
        far: 1200,
        follow: {
            distance: 12,
            height: 5.2,
            stiffness: 4.5, // damping lambda for position
            lookStiffness: 6,
            lookAhead: 3.2,
            speedPullback: 0.12, // extra distance per unit speed
            maxPullback: 7,
        },
        intro: { duration: 5.5 }, // cinematic flyover seconds
    },
    vehicle: {
        mass: 900,
        enginePower: 44,
        reversePower: 22,
        brakePower: 60,
        maxSpeed: 60, // units/s (soft cap)
        boostMultiplier: 1.7,
        steerMax: 0.55, // radians at the wheel
        steerSpeed: 3.2,
        steerReturn: 5,
        grip: 7.5,
        drift: 0.86, // lateral friction retained while sliding (lower = slidier)
        suspensionRest: 0.55,
        suspensionStiffness: 28,
        suspensionDamping: 3.2,
        suspensionTravel: 0.35,
        wheelRadius: 0.42,
        chassisHalf: { x: 1.0, y: 0.35, z: 1.9 },
        respawnBelowY: -3.5, // deep water becomes a soft boundary → respawn
    },
    physics: {
        gravity: -24,
        fixedStep: 1 / 60,
        maxSubSteps: 4,
    },
    dayNight: {
        // 0..1 around the clock; the world starts near dusk.
        start: 0.72,
        speed: 0.004, // cycles per second when auto-advancing (slow)
        autoAdvance: true,
    },
    fog: { near: 60, far: 340, density: 0.0016 },
    foliage: {
        palmCount: { low: 60, medium: 140, high: 240 } as Record<QualityTier, number>,
        grassBlades: { low: 0, medium: 12000, high: 30000 } as Record<QualityTier, number>,
        grassRadius: 70,
    },
    particles: {
        fireflies: { low: 60, medium: 160, high: 320 } as Record<QualityTier, number>,
        rainDrops: { low: 0, medium: 1800, high: 4000 } as Record<QualityTier, number>,
    },
    collectibles: {
        count: 12, // Yoruba-word orbs scattered across the island
        radius: 1.1,
        bobHeight: 0.35,
    },
    quality: {
        dprCap: { low: 1, medium: 1.5, high: 2 } as Record<QualityTier, number>,
        shadowMap: { low: 0, medium: 1024, high: 2048 } as Record<QualityTier, number>,
        bloom: { low: false, medium: true, high: true } as Record<QualityTier, boolean>,
        ssao: { low: false, medium: false, high: true } as Record<QualityTier, boolean>,
        // adaptive: if avg FPS drops below `down` for a while, step quality down.
        adaptDownFps: 42,
        adaptUpFps: 58,
        adaptWindow: 2.5, // seconds
    },
    audio: {
        masterVolume: 0.7,
        musicVolume: 0.45,
        engineVolume: 0.5,
    },
} as const;

export type Config = typeof CONFIG;
