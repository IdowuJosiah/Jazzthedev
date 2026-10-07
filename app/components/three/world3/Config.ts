// ─────────────────────────────────────────────────────────────────────────
// Central config for the /field v3 "clean diorama" world.
//
// Every tunable lives here (coordinates live in Layout.ts), so no engine module
// carries magic numbers and the ?debug panel can bind to one place. Values are
// the spec's starting values (docs/field-v3-spec.md); tune them through ?debug
// and copy the tuned value back into this file.
// ─────────────────────────────────────────────────────────────────────────

/** A CSS-style hex colour, e.g. "#F3DCC0". Materials are cached per hex. */
export type HexColor = `#${string}`;

/** A read-only 3-vector (plain object so Layout/tests never need three.js). */
export interface Vec3Like {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

const normalize = (x: number, y: number, z: number): Vec3Like => {
    const l = Math.hypot(x, y, z);
    return Object.freeze({ x: x / l, y: y / l, z: z / l });
};

// ── Camera azimuth and screen vectors (§2.1) ─────────────────────────────
/** Fixed camera yaw: the camera sits at +X+Z of the focus, looking north-west. */
export const CAMERA_YAW = Math.PI / 4;
/** Screen-right on the ground plane: R = (0.7071, 0, −0.7071). */
export const SCREEN_RIGHT: Vec3Like = Object.freeze({
    x: Math.sin(CAMERA_YAW + Math.PI / 2),
    y: 0,
    z: Math.cos(CAMERA_YAW + Math.PI / 2),
});
/** Screen-down (toward the camera) on the ground plane: S = (0.7071, 0, 0.7071). */
export const SCREEN_DOWN: Vec3Like = Object.freeze({
    x: Math.sin(CAMERA_YAW),
    y: 0,
    z: Math.cos(CAMERA_YAW),
});
/** rotation.y that makes an upright object face the camera (local +X → R, +Z → S). */
export const FACE_CAMERA_Y = CAMERA_YAW;

// ── Palette (§1.2) ───────────────────────────────────────────────────────
export const PALETTE = {
    background: "#F3DCC0",
    ground: "#EFCFA6",
    groundEdge: "#E6BC8C",
    plaza: "#F8E7CF",
    path: "#FBEDDC",
    paper: "#FFFDF8",
    ink: "#24222B",
    ink2: "#45414C",
    stone: "#3B3A45",
    wood: "#C99A6B",
    foliage: "#8DBF5A",
    foliageDark: "#6FA64B",
    trunk: "#9C6B4A",
    bush: "#7DB356",
    boulder: "#CDBBA7",
    quay: "#E9DCCB",
    waterShallow: "#8EDAD1",
    water: "#3FAFBE",
    waterDeep: "#2A8EA3",
    foam: "#FFFFFF",
    carBody: "#E2553F",
    carDanfo: "#F6C21C",
    carTrim: "#24222B",
    carTyre: "#2E2C35",
    carRim: "#F6C21C",
    carLight: "#FFF6D8",
    brake: "#FF3B30",
    blobShadow: "#3B2F45",
    /** Board image placeholder until the lazy texture arrives (§5.1). */
    imagePlaceholder: "#E9DCCB",
    /** Tyre dust puffs (W1-E, P1). */
    tyreDust: "#EFD9BC",
} as const satisfies Record<string, HexColor>;

export type PaletteToken = keyof typeof PALETTE;

/** Accent families. `ACCENT` is for shapes, `ACCENT_INK` for text and 3D titles. */
export type AccentKey = "brand" | "projects" | "eko" | "music" | "journey" | "play";

export const ACCENT: Readonly<Record<AccentKey, HexColor>> = Object.freeze({
    brand: "#E2553F",
    projects: "#2F6FED",
    eko: "#5B4CF0",
    music: "#D6457E",
    journey: "#12A387",
    play: "#F6C21C",
});

/**
 * Text-safe accents. Contrast measured against RENDERED colours (troika text is
 * unlit, the surface under it is lit): ACCENT_INK text sits only on paper, never
 * on bare ground, and never below 1.5 units (3D titles are geometry, exempt).
 */
export const ACCENT_INK: Readonly<Record<AccentKey, HexColor>> = Object.freeze({
    brand: "#B63A26",
    projects: "#1F55C9",
    eko: "#4436D6",
    music: "#B02A62",
    journey: "#0B7A65",
    play: "#24222B",
});

// ── Look presets (§1.7) ──────────────────────────────────────────────────
export type LookId = "day" | "dusk";

export interface LookPreset {
    /** scene.background, fog colour, renderer clear colour, loader background. */
    background: HexColor;
    hemisphere: { sky: HexColor; ground: HexColor; intensity: number };
    sun: { color: HexColor; intensity: number };
    fill: { color: HexColor; intensity: number };
    /**
     * Debug-probe acceptance band for a sun-lit `paper` top, in LINEAR units.
     * `perChannel: true` → every channel must sit inside [min, max] (day).
     * `perChannel: false` → only the highest channel is checked (dusk).
     */
    probe: { min: number; max: number; perChannel: boolean };
}

export const LOOK: Readonly<Record<LookId, LookPreset>> = Object.freeze({
    day: {
        background: "#F3DCC0",
        hemisphere: { sky: "#EEF2FF", ground: "#F5DCC4", intensity: 1.7 },
        sun: { color: "#FFF5EB", intensity: 1.2 },
        fill: { color: "#FFFFFF", intensity: 1.0 },
        probe: { min: 0.88, max: 0.96, perChannel: true },
    },
    dusk: {
        background: "#E8BD9C",
        hemisphere: { sky: "#D9D3F5", ground: "#F2C29C", intensity: 1.45 },
        sun: { color: "#FFC08A", intensity: 1.5 },
        fill: { color: "#FFE4D0", intensity: 0.8 },
        probe: { min: 0.8, max: 0.9, perChannel: false },
    },
});

/** The active look. Owner gate (§10): switching looks changes only this value. */
export const ACTIVE_LOOK: LookId = "day";

// ── Render profiles (§9.1) ───────────────────────────────────────────────
export type RenderProfileId = "desktop-high" | "desktop-medium" | "desktop-low" | "mobile" | "mobile-low";
export type SceneryTier = "high" | "medium" | "low";

export interface RenderProfileSpec {
    /** Upper bound for the effective DPR = min(devicePixelRatio, dprCap). */
    dprCap: number;
    /** `"belowDpr2"`: MSAA only when the device DPR is < 2 (desktop-low). */
    antialias: boolean | "belowDpr2";
    /** 0 = no shadow map (blob shadows under every static prop instead). */
    shadowMapSize: number;
    scenery: SceneryTier;
}

// ── Quality / adaptive (§9.3) ────────────────────────────────────────────
/** Menu Quality setting: affects shadows and scenery only, never DPR/MSAA. */
export type QualitySetting = "auto" | "high" | "medium" | "low";

// ── The config tree ──────────────────────────────────────────────────────
export const CONFIG = {
    look: ACTIVE_LOOK,

    world: {
        seed: 20260104,
        /** Playable bounds (§2.2). North is −Z; the quay forms the north edge. */
        bounds: { minX: -150, maxX: 170, minZ: -176, maxZ: 40 },
        quayZ: -176,
        /** Visual ground plane: x ∈ [−700, 700], z ∈ [−176, 700] at y = 0. */
        ground: { minX: -700, maxX: 700, minZ: -176, maxZ: 700, edgeTintWidth: 24 },
        /** Fixed ground slab collider. */
        groundSlab: { halfExtents: { x: 700, y: 1, z: 438 }, center: { x: 0, y: -1, z: 262 } },
        /** Invisible bound walls at x = −150, x = 170 and z = 40. */
        wallHeight: 4,
        quay: {
            strip: { length: 1400, height: 1.2, depth: 1.0 },
            bollard: { radius: 0.35, height: 0.9, spacing: 8, skipHalfWidth: 6 },
            seaWallHeight: 1.0,
            /** Sea-wall gap for the jetty: x ∈ [−4, 4]. */
            jettyGapHalfWidth: 4,
            /** Scenery keeps this far from the quay. */
            sceneryClearance: 4,
        },
        water: {
            y: -1.1,
            minX: -700,
            maxX: 700,
            minZ: -900,
            shallowToMid: [2, 14] as const,
            midToDeep: [14, 60] as const,
            foamBand: 0.7,
            contour: { frequency: 0.35, speed: 0.25, threshold: 0.93, fadeStart: 4, fadeEnd: 16 },
        },
        jetty: {
            plank: { length: 7.6, height: 0.25, depth: 0.9, gap: 0.15 },
            postSpacing: 4,
            railHeight: 0.8,
        },
    },

    render: {
        profiles: {
            "desktop-high": { dprCap: 2, antialias: true, shadowMapSize: 2048, scenery: "high" },
            "desktop-medium": { dprCap: 2, antialias: true, shadowMapSize: 2048, scenery: "medium" },
            "desktop-low": { dprCap: 2, antialias: "belowDpr2", shadowMapSize: 0, scenery: "low" },
            mobile: { dprCap: 3, antialias: false, shadowMapSize: 2048, scenery: "medium" },
            "mobile-low": { dprCap: 2, antialias: false, shadowMapSize: 0, scenery: "low" },
        } satisfies Record<RenderProfileId, RenderProfileSpec>,
        /** DPR is never below min(devicePixelRatio, minDprCap). */
        minDprCap: 2,
        gpu: {
            benchmarksURL: "/detect-gpu",
            timeoutMs: 3000,
            /** Tier used on timeout or error. */
            fallbackTier: 2,
        },
        /** Next-visit DPR fallback for the `mobile` profile (never mid-session). */
        nextVisit: {
            storageKey: "field-v3:dprCap",
            medianFrameMs: 28,
            windowStart: 5,
            windowEnd: 15,
            dprCap: 2,
        },
        clearAlpha: 1,
    },

    /**
     * Lighting rig (§1.4), physical intensities, NoToneMapping.
     *
     * CALIBRATION RULE: each channel of the brightest sun-lit `paper` top must stay
     * between 0.88 and 0.96 LINEAR. Check every channel separately with the ?debug
     * pixel probe (§10, W1-A). The day rig passes at 0.952 / 0.927 / 0.919.
     * (Lambert: Σ intensity·colour·max(0, n·l) / π × albedo, hemisphere weight
     * 0.5·n_y + 0.5.) Raising any intensity without re-probing will clip under
     * NoToneMapping. The dusk preset's rule: the highest channel in 0.80–0.90.
     */
    lights: {
        // The active look's colours/intensities are LOOK[CONFIG.look] — read them
        // there at use time (single source of truth, §1.7); no cached copy here.
        /** From target toward the light; ≈52° elevation, from camera-left. The only shadow caster. */
        sunDirection: normalize(-0.26, 0.79, 0.56),
        /** The camera direction; castShadow = false. */
        fillDirection: normalize(0.57, 0.59, 0.57),
    },

    /** Shadows (§1.5). Map size comes from the render profile. */
    shadow: {
        radius: 3,
        bias: -0.0005,
        normalBias: 0.04,
        intensity: 0.9,
        near: 1,
        far: 200,
        lightDistance: 100,
        /** Adaptive downgrade size (§9.3). */
        downgradedMapSize: 1024,
        box: {
            /** Refit when zoom changes by more than this (or aspect / FOV / shot changes). */
            refitZoomDelta: 0.1,
            /** Frustum corner rays are cut at base·zoom + pullback·base/refBase. */
            pullback: 6,
            refBase: 38,
            rayClamp: 140,
            casterHeight: 8,
            pad: 4,
            roundTo: 4,
        },
        blob: {
            color: PALETTE.blobShadow,
            textureSize: 128,
            car: { width: 2.6, length: 4.6, opacity: 0.35, danfoOpacity: 0.45, liftFade: 3 },
            /** Ball and dynamic letters. */
            round: { opacity: 0.3 },
            /** Low profiles: instanced blob under every static prop. */
            staticProps: { opacity: 0.3 },
        },
    },

    /** Linear fog scaled by the camera distance d (§1.6): 45..115 at d = 38. */
    fog: { nearFactor: 1.18, farFactor: 3.0 },

    camera: {
        fov: 30,
        portraitFov: 42,
        near: 1,
        far: 400,
        yaw: CAMERA_YAW,
        zoom: { min: 0.74, max: 1.47, wheelPerDeltaY: 0.0005, lambda: 8 },
        pullback: { max: 6, refBase: 38, speedRef: 32, lambda: 2 },
        shots: {
            default: { elevationDeg: 36, base: 38, focusShift: 0 },
            /** Focus shifted by −S·4 so boards sit centre-frame. */
            gallery: { elevationDeg: 26, base: 32, focusShift: 4 },
            intro: { elevationDeg: 44, base: 64, focusShift: 0 },
        },
        intro: { duration: 1.6, ease: "power3.inOut" },
        shotTween: { duration: 1.2, ease: "power2.inOut" },
        portrait: {
            /** Added to every shot's elevation when aspect < 1. */
            elevationBonusDeg: 4,
            /** World units kept visible across the screen at the focus. */
            visibleWidth: 22,
            halfAngleDeg: 21,
        },
        follow: {
            velocityLead: 0.3,
            towardCameraLead: 6,
            towardCameraSpeedRef: 12,
            maxLead: 10,
            maxLeadWidthFraction: 0.25,
            lambda: 6,
            reducedMotionLambda: 12,
        },
        pan: { maxOffset: 24, returnLambda: 1.5, idleDelay: 1.2, returnAboveSpeed: 4 },
    },

    vehicle: {
        maxSpeed: 32, // units/s (soft cap)
        boostMultiplier: 1.5,
        /** Gate option (§4.2): "brand" terracotta or "danfo" yellow. */
        paint: "brand" as "brand" | "danfo",
        paints: { brand: PALETTE.carBody, danfo: PALETTE.carDanfo },
        // ── rest copied from v2 ──
        mass: 900,
        enginePower: 44,
        reversePower: 22,
        brakePower: 60,
        steerMax: 0.55, // radians at the wheel
        steerSpeed: 3.2,
        steerReturn: 5,
        grip: 7.5,
        drift: 0.86,
        suspensionRest: 0.55,
        suspensionStiffness: 28,
        suspensionDamping: 3.2,
        suspensionTravel: 0.35,
        wheelRadius: 0.42,
        chassisHalf: { x: 1.0, y: 0.35, z: 1.9 },
        /** Chassis rigid body / collider (v2 Physics.createVehicle). */
        chassis: { linearDamping: 0.12, angularDamping: 0.6, friction: 0.8, restitution: 0.1 },
        /** Wheel connection points in chassis space: y offset, and inset from the chassis ends along z. */
        wheelConnection: { y: -0.05, insetZ: 0.5 },
        handling: {
            /** Engine output → Rapier engine force. */
            engineForceScale: 60,
            /** Brake strength when the throttle opposes the motion (fraction of brakePower). */
            opposingBrakeFactor: 0.8,
            /** Handbrake: rear wheels brake harder and lose grip so the tail slides. */
            handbrakeRearFactor: 1.4,
            handbrakeRearGripFactor: 0.5,
        },
        /** Drift metric: ignored below minSpeed; lateral slip × gain, clamped to 1; drifting above threshold (tyre dust). */
        driftMetric: { minSpeed: 2, gain: 1.4, threshold: 0.35 },
        // ── v3 fixes ──
        /** Rapier `controller.setIndexForwardAxis = 2` (a setter property). */
        forwardAxis: 2,
        respawnBelowY: -2,
        /** On Start the car drops from spawn y + this. */
        spawnDrop: 6,
        brakeAboveSpeed: 1,
        reverseLightBelowSpeed: -0.5,
        autoFlip: { upY: 0.3, seconds: 1.5, lift: 1.5 },
        lights: {
            lamp: { w: 0.28, h: 0.14, d: 0.05 },
            backing: { w: 0.4, h: 0.24, d: 0.04 },
        },
        /** Kenney colormap repaint grid (§4.2): 512², 8 × 4 cells of 64×128 px. */
        colormap: { size: 512, cellW: 64, cellH: 128 },
    },

    physics: {
        gravity: -24,
        fixedStep: 1 / 60,
        maxSubSteps: 4,
        /** setContactForceEventThreshold(mass × this) on dynamic props. */
        contactForcePerMass: 40,
        dynamicLetter: { mass: 80, friction: 0.6, restitution: 0.1, linearDamping: 0.3, angularDamping: 0.4 },
        /** Hero letters reset when the car is further than this. */
        heroLetterResetDistance: 60,
        /** Fixed-collider surfaces: scenery / props, the ground slab (grippy), the bound walls (slide along). */
        colliders: {
            fixed: { friction: 0.9, restitution: 0.2 },
            ground: { friction: 1.0, restitution: 0.05 },
            wall: { friction: 0.2, restitution: 0.2 },
        },
        /** Defaults for the dynamic helpers (v2 box / ball values); options override them. */
        dynamicDefaults: {
            box: { friction: 0.7, restitution: 0.3, linearDamping: 0.4, angularDamping: 0.5, impact: "wood" },
            cylinder: { friction: 0.7, restitution: 0.3, linearDamping: 0.4, angularDamping: 0.5, impact: "wood" },
            ball: { friction: 0.6, restitution: 0.6, linearDamping: 0.3, angularDamping: 0.3, impact: "heavy" },
            letter: { impact: "heavy" },
        },
        /**
         * Impact filter: a contact-force event counts only when a registered prop
         * in the pair moves faster than this (u/s, rad/s) before or after the step,
         * so resting stacks stay silent.
         */
        impact: { minLinearSpeed: 0.5, minAngularSpeed: 0.5 },
    },

    text: {
        /** Fallback engine flag (§11): flat canvas textures, never sprites. */
        engine: "troika" as "troika" | "canvas",
        canvasPxPerUnit: 200,
        fonts: {
            display: "/fonts/BricolageGrotesque-ExtraBold.woff",
            bold: "/fonts/Inter-Bold.woff",
            semibold: "/fonts/Inter-SemiBold.woff",
            medium: "/fonts/Inter-Medium.woff",
        },
        typeface3D: "/fonts/BricolageGrotesque-ExtraBold.typeface.json",
        defaultFontURL: "/fonts/Inter-SemiBold.woff",
        sdfGlyphSize: 64,
        useWorker: true,
        /** Flat-layer heights (§2.5); see utils/shapes.ts LAYERS for offsets/order. */
        layers: {
            plaza: 0.015,
            plate: 0.025,
            /** Pad outline/fill drawn on top of a plate that is also the pad. */
            padOnPlate: 0.03,
            groundText: 0.035,
            tileBottom: 0,
            tileTop: 0.08,
            onTile: 0.1,
        },
        /** troika budget (§9.2): text hidden with its area beyond this distance. */
        cullDistance: 70,
        maxMeshes: 110,
        /** Text marked desktopOnly is hidden on touch and when aspect < 1. */
        desktopOnlyMinAspect: 1,
    },

    /** Type scale in world units (§3.3). */
    type: {
        heroWord: { cap: 4.0, depth: 1.2, curveSegments: 12 },
        areaTitle: { cap: 2.4, depth: 0.6, curveSegments: 8 },
        bevel: { thickness: 0.06, size: 0.05, segments: 2 },
        /** Letter tracking in em. */
        tracking: 0.06,
        /** Fallback cap-height / em ratio if the typeface JSON can't be measured. */
        capRatioFallback: 0.7,
        roleLine: { font: "bold", size: 1.1, letterSpacing: 0.1 },
        areaSubtitle: { font: "bold", size: 1.1, letterSpacing: 0.1 },
        pathLabel: { font: "bold", size: 1.0, letterSpacing: 0.12 },
        padLabel: { font: "bold", size: 0.9 },
        floorCaption: { font: "bold", size: 0.9 },
        /** Welcome greeting (Yoruba, Inter only, ink2 on the plaza). */
        greeting: { font: "medium", size: 0.9 },
        floorDetail: { font: "semibold", size: 0.8 },
        /** Minimum size for any flat text. */
        minFlatSize: 0.8,
        numerals: { font: "display", min: 1.5, max: 2.4 },
        boardTitle: { font: "bold", size: 0.85, minSize: 0.7, maxWidth: 9.6 },
        boardPitch: { font: "medium", size: 0.5, maxChars: 32 },
        boardTags: { font: "semibold", size: 0.42, letterSpacing: 0.08 },
        sleeveTitle: { font: "bold", size: 0.7 },
        coinWord: { font: "bold", size: 0.42 },
    },

    /** Pads (§5.3). */
    pad: {
        lineWidth: 0.22,
        activeLineWidth: 0.32,
        cornerRadius: 0.6,
        curveSegments: 6,
        idleOpacity: 0.35,
        activeOpacity: 1,
        fillOpacity: 0.55,
    },

    /** Scenery scatter (§2.6). Counts per scenery tier; extras go in the bands. */
    scenery: {
        /** Gate decision: Kenney Nature Kit or the procedural fallback. */
        source: "kit" as "kit" | "procedural",
        boundsInset: 2,
        areaClearance: 4,
        pathClearance: 3,
        featureClearance: 4,
        sunStripLength: 6,
        tallPropHeight: 1.5,
        edgeZone: 22,
        grove: { scale: 45, threshold: 0.15 },
        poissonRadius: { tree: 6, palm: 6, bush: 3.5, boulder: 3.5 },
        /** Procedural fallback props (§2.6). Origins sit on the ground (y = 0). */
        procedural: {
            trunk: { radiusTop: 0.28, radiusBottom: 0.38, height: 2.4, radialSegments: 6 },
            crown: { radius: 1.7, widthSegments: 16, heightSegments: 12, y: 3.2 },
            /**
             * Sphere(1, 12, 8) scaled (1.4, 0.9, 1.4), centred on the ground: only the
             * upper half shows, so only the upper half (4 of the 8 rings) is built.
             * Height 0.9 matches the kit bush (kitNormalize).
             */
            bush: { radius: 1, widthSegments: 12, heightSegments: 8, scale: { x: 1.4, y: 0.9, z: 1.4 } },
            /** Dodecahedron(1, 0), flat-shaded, centred on the ground (half sunk). */
            boulder: { radius: 1, detail: 0 },
        },
        /** Bush cluster members sit this far (min, max) from the cluster's first bush. */
        bushClusterSpread: [1.1, 1.7] as const,
        /** Share of trees drawn with the darker foliage token (§1.2 "chosen at random"). */
        foliageDarkShare: 0.5,
        /**
         * palm.glb's widest frond tip from its trunk base, as a fraction of its
         * height (measured from the GLB vertices).
         */
        palmCrownReach: 0.78,
        /**
         * Spatial chunks (§9.2): a model with more than `minTriangles` triangles
         * (palm.glb: 2924) is instanced per `size` × `size` cell so the camera and
         * the shadow camera cull each cell on its own.
         */
        chunk: { size: 48, minTriangles: 500 },
        counts: {
            tree: { high: 160, medium: 120, low: 70 },
            palm: { high: 60, medium: 45, low: 25 },
            bush: { high: 220, medium: 160, low: 80 },
            boulder: { high: 40, medium: 30, low: 20 },
        } satisfies Record<string, Record<SceneryTier, number>>,
        bandExtras: { tree: 40, palm: 15, bush: 80, boulder: 20 },
        scale: {
            tree: [0.8, 1.4] as const,
            palmHeight: [7, 9] as const,
            palmLeanDeg: 8,
            bush: [1.0, 1.6] as const,
            bushCluster: [2, 3] as const,
            boulderX: [1.2, 2.2] as const,
            boulderY: [0.8, 1.4] as const,
            boulderZ: [1.2, 2.0] as const,
        },
        colliders: {
            tree: { radius: 0.45, height: 3 },
            palm: { radius: 0.5, height: 3 },
        },
        /**
         * Size every Nature Kit model is normalised to at load time (Assets
         * normalizeNature), so the scale ranges above mean the same for "kit" and
         * "procedural". Each matches the procedural prop: tree height 4.9 (the
         * crown top, 3.2 + 1.7); bush height 0.9 (scale ≤ 1.6 stays ≤ 1.5 high near
         * the south / east bounds); boulder footprint 2 (Dodecahedron(1)'s
         * diameter: kit rocks are flat slabs, so height would make them 3–4× wider).
         */
        kitNormalize: {
            tree: { measure: "height", size: 4.9 },
            bush: { measure: "height", size: 0.9 },
            boulder: { measure: "footprint", size: 2 },
        } satisfies Record<string, { measure: "height" | "footprint"; size: number }>,
        /** Occluder dither (§1.3): keep = smoothstep(near, far, d) + step(endT, t). */
        occluder: { near: 2.0, far: 3.5, endT: 0.97, carLift: 1 },
    },

    /** Adaptive quality (§9.3). Never touches DPR or MSAA. */
    quality: {
        default: "auto" as QualitySetting,
        adaptive: true,
        downMedianMs: 22,
        downWindow: 4,
        upMedianMs: 14,
        upWindow: 10,
        ignoreFirst: 5,
        minInterval: 8,
        sceneryReduction: 0.3,
        /** Downgrade order. */
        steps: ["shadow1024", "scenery-30", "dustOff"] as const,
    },

    /** Loading contract (§6.2). Progress only ever increases. */
    loading: {
        stages: {
            fonts: { weight: 0.15, label: "Loading fonts" },
            assets: { weight: 0.55, label: "Loading models" },
            build: { weight: 0.25, label: "Building the world" },
            warmup: { weight: 0.05, label: "Building the world" },
        },
        /**
         * Share of the build stage done after each step, in the §10 boot order
         * (environment → car, camera, controls → areas → paths → scenery).
         */
        buildSteps: { environment: 0.15, core: 0.3, areas: 0.6, paths: 0.7, scenery: 1 },
        timeoutMs: 15000,
        /** Attempts after the first failure for a required asset (car.glb, Rapier). */
        retries: 1,
        canvasFadeMs: 400,
    },

    ui: {
        toastMs: 3000,
        mobileMaxWidth: 640,
        soundStorageKey: "field-v3:sound",
    },

    audio: {
        masterVolume: 0.7,
        musicVolume: 0.45,
        engineVolume: 0.5,
        impactVolume: 0.6,
        eqBands: 9,
    },
} as const;

export type Config = typeof CONFIG;
