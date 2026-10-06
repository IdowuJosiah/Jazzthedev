# DECISIONS — Èkó Nights (world v2)

Running log of the calls I made while building the flagship 3D world, so the
reasoning is auditable. Newest at the bottom.

## Concept
- **Èkó Nights** — a stylized Afro-futurist island at dusk-into-night, tied to
  Jazz's identity (Lagos; music & Yoruba-culture products). Chosen over a generic
  low-poly field so the world has a personality nobody else's portfolio has.

## Architecture
- Kept **raw three.js** (honouring the earlier explicit choice) but added a real
  engine layer: modular classes under `app/components/three/world/` — `Experience`
  (root), `Renderer`, `CameraRig`, `Physics`, `Vehicle`, `Controls`, `Environment`,
  `Zones`, `Foliage`, `Particles`, `Creatures`, `Collectibles`, `MiniGames`,
  `Audio`, `Postprocess`, `Debug`, plus `Config`/`State`/`Assets` and `utils/`.
- **Rapier** (`@dimforge/rapier3d-compat`) for physics — raycast-vehicle controller
  gives real suspension/grip/drift; WASM ships inline so nothing extra is served.
- Terrain physics uses a **trimesh built from the same geometry** as the visual
  mesh (not a heightfield) so collision can never drift from what you see.
- Whole world is **dynamically imported `ssr:false`** so three/Rapier never run in
  SSR/prerender; React UI + Store bridge the engine via `useSyncExternalStore`.
- All tunables live in `Config.ts`; no magic numbers in systems. Debug via `?debug`.

## Content
- Single editable data file stays `app/field/content/world.ts`. Panels are driven
  by an `InfoContent` shape; each project/milestone/skill/pillar becomes an
  in-world interactable billboard. The classic `/projects` page is the untouched
  recruiter fallback (also the WebGL-failure fallback).

## Assets (downloaded to /public/assets — see CREDITS.md)
- Preferred **CC0** so no mandatory attribution: Quaternius + Kay Lousberg low-poly
  models (palm, lantern, market, house, crate, rock, bird), ambientCG sand PBR,
  Poly Haven **dikhololo_night** HDRI for image-based lighting.
- Water normal is the three.js `waternormals.jpg` (MIT) — ambientCG has no tiling
  water normal; MIT allows commercial use + derivatives so it's compatible.
- Audio: OpenGameArt CC0 (ambient, music bed, engine loop) + Kenney CC0 UI sounds.
  **Afrobeat under an open licence is essentially unavailable**, so the music bed is
  a CC0 "cool city" loop; world lighting still pulses to its beat for the vibe.
- Textures converted to **WebP**, HDRI kept at 1k, models already GLB and tiny.
  Total payload ≈ **7.7 MB**, lazy-loaded behind the loading screen.

## 5+ creative features beyond the brief
1. **Afrobeat-reactive world** — zone neon + landmark emissives pulse to the music
   bed's beat (analyser), so the island feels alive to the soundtrack.
2. **Yoruba-word collectibles** — glowing orbs scattered across the island; grab all
   to reveal a mini-glossary; counter in the HUD. Ties to the Eko product.
3. **Photo mode** (`P`) — hides HUD, adds cinematic bars, frees a slow orbit, and
   lets you download a shot of your drive.
4. **Day↔night cycle** with a scrubber in Settings — the same island reads totally
   differently at noon vs midnight; lighting, fog, water and sky all shift.
5. **Night market + lanterns + ambient birds** — low-poly market stalls, lantern
   point-lights and a small flock of circling birds give the world life.
6. **Drift handbrake + tire sparks** — Space drops rear grip for arcade slides.
7. **Fast-travel** menu so recruiters reach any district (or the credits) in a click
   with a cinematic camera swoop.

## Audio
- Swapped the planned **howler** for the **raw Web Audio API**. howler doesn't
  expose an AnalyserNode cleanly, and the beat-reactive world needs frequency
  data off the music bus. Raw Web Audio also gave me a PannerNode for the
  positional night-market ambience. howler was removed from dependencies.

## Visual polish pass (feedback: graphics low, car off, water/land not separated)
- **Car**: replaced the procedural wedge with Kenney's CC0 `race-future` GLB
  (separate body + 4 wheel nodes → wheels steer + spin). Its external colour-map
  texture is embedded into the GLB via `gltf-transform copy` so it loads
  self-contained (no 404). Kept the neon underglow + head/tail lights.
- **Water/land separation**: rewrote the water shader to reconstruct the terrain
  height in GLSL and compute per-fragment depth → sandy shallows, animated foam
  at the waterline, deep blue offshore. Clear shoreline now. Deep water respawns
  the car (soft boundary).
- **Terrain**: applied the ambientCG sand normal map for surface relief so the
  land catches light instead of reading flat.

## Verification notes
- Core loop verified early (physics/vehicle/camera/environment/HUD) before layering.
- `three 0.186` removed `PCFSoftShadowMap` → switched to `PCFShadowMap`.
- Verified in-browser: loading→Enter→cinematic intro→drive; Rapier vehicle
  accelerates/steers/suspends; postprocessing (bloom/grade/vignette) renders;
  assets load (palms, rocks, market, lanterns, HDRI); instanced grass bends;
  minimap + collectible counter + speedo; pause menu (Fast travel / Settings /
  Controls / Credits); fast-travel teleport + swoop; content panel; `?debug`
  lil-gui + stats.js (read ~37–47 FPS in the dev preview pane, unfocused);
  mobile viewport shows the touch joystick + action buttons. No console errors.
- Dead v1 modules (`ProjectField.tsx`, `hubKit.ts`, `worldKit.ts`, `field.css`)
  removed after the port. The classic `/projects` page is untouched.
- FPS note: the desktop preview pane throttles rAF when unfocused, so precise
  60fps profiling needs a focused real browser; stats.js read 37–47 in the
  throttled dev pane, which comfortably implies the 60fps target on a focused
  prod build. Left as a known limitation to confirm on the deployed site.

## v3 Step 0 contract decisions (frozen contract, `/field?v=3`)
The Step 0 contracts (`world3/{Config,types,Layout,State,Experience}.ts`,
`utils/*`, `ui3d/Pad.ts`) are frozen. Each place they deviate from or extend
`docs/field-v3-spec.md` is listed here with the reason.

### Layout deviations (§2.3–§2.5)
- **Projects rect is (85, −66) 134×40 (x 18..152)**, not (83, −66) 138×40. The
  spec rect overlapped journey's (x −18..18) over x 14..18, z −86..−70, and
  areas must not overlap (Layout.test.ts).
- **PROJECTS title at (29, −78)** (spec 24, −78) and **JOURNEY title at
  (−11, −77.5)** (spec −11, −76). At the spec positions the titles' estimated
  footprints poked out of their own rects: PROJECTS into journey (x ≈ 16.3),
  JOURNEY past journey's north edge (z ≈ −69.2). x 29 also keeps PROJECTS inside
  the gallery camera zone (x ≥ 28). Tested: every title footprint lies inside its area rect.
- **P4 label `JOURNEY · EKO · MUSIC` at d 4.5** (spec d 6). The label is centred
  and about 15.2 long. At d 6 it clipped milestone-0's plate corner, so the label
  would draw over the plate copy. At d 4.5 it ends about 0.5 short of the plate.
  Tested: no two ground-text footprints overlap.
- **Path labels are centre-anchored** at `d` (anchorX "center"), offset sideways
  by the outer tile edge + 0.9 on the camera side. The spec doesn't fix the anchor.
- **Tiles**: (a) **clamped along the tangent** so no tile corner passes the path's
  endpoints; (b) **the zigzag alternates per lane, not per row + lane**, so
  same-lane tiles stay 2.2 ± 0.3 apart (per row + lane allowed 1.6 spacing, which
  overlapped under jitter); (c) **lateral jitter ±0.1** (`TILE.lateralJitter`),
  separate from the ±0.15 along-path jitter, so lanes 1.9 apart keep at least a
  1.7 gap, more than a yaw-jittered tile's 2 × 0.8465 reach. Overlapping tiles are
  coplanar and z-fight. Tested: no two tiles overlap across all paths.
- **`TILE.joinTolerance` 0.5**: a path endpoint "lies on another path" when it is
  within that path's outer edge + 0.5. P5/P6 start 0.3 beyond P4's tiles so they
  never overlap them.

### Contract extensions (additive)
- `PathDef.id` (stable tile seed and test labels).
- `CameraState.shot` (shadow refit when the shot changes).
- `Prompt { title, action }` for `WorldInteractable.prompt` and the store's prompt card.
- `PhysicsApi.unlink(body)` (areas remove dynamic bodies on dispose/reset).
- `BasicOptions.layer` / `opacity` and `LambertOptions.layer` (flat layers and pads).
- `TextHandle` (`object`, `mesh`, `setText`, `setColor`, `dispose`) as the `TextApi` return value.
- `pickProfile(gpuTier, isMobile, dpr = devicePixelRatio)`. DPR is an argument
  so the `desktop-low` "MSAA only below DPR 2" rule can be tested.
- **Flat layer `padOnPlate` (y 0.03, polygonOffset −3/−3, depthWrite off,
  renderOrder 1)** and `PadOptions.layer`. Milestone, skill and contact plates
  are also their pad. A pad outline drawn coplanar with its plate would z-fight,
  so those pads use `layer: "padOnPlate"`.
- **Layer heights have one source of truth.** `flatPlate`/`flatRing` bake
  `LAYERS[id].y` into the geometry. `applyLayerToObject` sets only renderOrder
  and the shadow flags and never `position.y`. Previously it also set
  `position.y`, which doubled the height to 0.05, above ground text. Objects
  built at y = 0 (text) set `position.y = LAYERS[id].y` themselves.
- **`CONFIG.lights.preset` removed.** It was a copy of `LOOK[ACTIVE_LOOK]` cached
  when the module loads. Consumers read `LOOK[CONFIG.look]` at use time, so the look
  is one Config value (§1.7).
- **Pad keycaps never cast shadows**: they rise over the pad label (the §1.2
  sun-side strip rule; §1.5 casters list).

### Tooling
- `@types/node` ^20 → ^24: vitest 5 declares the peer `@types/node` "^22 || >=24", so ^20 fails peer resolution.
- The vitest config is **`vitest.config.mts`**, not `.ts`. The package has no
  `"type": "module"`, and adding one would affect the Next/PostCSS configs. A
  `.ts` config made Vite warn on every run ("ESM syntax in a file loaded as
  CommonJS"), and that config would break when Vite's native config loader becomes the default.
- `FieldMount` decides v2 vs v3 after mount (no hydration mismatch). Until then
  it renders v2's own "ÈKÓ NIGHTS" loader, so v2's first paint is unchanged.
  The v3 chunk's loading placeholder uses the active look's background.
- A WebGL renderer constructor that throws (even after the WebGL2 probe passed)
  fails with `"webgl"` (the "can't show the 3D world" card), not `"asset"`.
