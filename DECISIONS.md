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
