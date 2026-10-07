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
  `position.y`, which doubled the height to 0.05, above ground text.
  *(Amended in Wave 1 integration.)* `TextApi.flat()` / `onPath()` text already
  sits at its layer height on the inner troika mesh, so callers keep
  `handle.object.position.y = 0`. Setting it to `LAYERS[id].y` doubles the height.
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

## Wave 1 integration (`/field?v=3`)
The integrator wired the Wave 1 modules into `Experience.ts`. These are the
edits outside the integrator's own files, the contract changes and the calls
made along the way.

### Contract changes (types.ts)
- **`PhysicsApi` gains the dynamic-prop helpers**: `addDynamicBox`,
  `addDynamicBall`, `addDynamicCylinder`, `addDynamicLetter` and `removeBody`.
  W1-A's `Physics` already implements all five. Wave 2 areas (Playground
  bricks, pins and ball; any area's dynamic words) can now use them through
  `ctx.physics` without casting. `DynamicBodyOptions` is re-exported from
  types.ts through a type-only import of `Physics.ts`, so there is no runtime cycle.
- **`AssetsApi.boards: BoardLoaderApi`**, with `register`, `request`, `get` and
  `onLoaded`, provides the lazy, distance-gated board images (§5.1). Areas register
  each board's world position. The Experience calls `boards.start()` on Start
  and `boards.update(focus)` every frame. Assets' `BoardTextures` implements it.
  `natureModel()` / `animations()` stay off the contract (W1-D made them
  reachable through `model()` and exported helpers).

### Minimal edits to other streams' files
- **Vehicle.ts**: optional `VehicleDeps.blobTexture`. The Experience passes
  `env.blobTexture("rect")`, so the car blob and the low-profile prop blobs
  share one texture (§1.5). The look chosen is Environment's falloff (corner
  0.6, smoothstep 0..1). The car still owns its MeshBasicMaterial for the
  per-frame lift fade. Without the dep (in tests), the car still builds its own map.
- **Environment.test.ts**: adds the W1-C regression check. There are 22 planks, and no
  plank top overlaps the quay strip top (z ≤ quayZ − strip.depth). The
  test also checks that `scene.background` is null after dispose.
- **Areas.ts** (integrator-owned):
  - Every 3D word an area creates through `ctx.text3d` is `reset()` (armed)
    right after its builder returns, so colliders exist before the first physics step.
  - A builder that throws is logged and skipped. Its group is removed and its
    interactables are unregistered.
  - `builtIds` and `cull(x, z, distance)` are added (text budget, §9.2).
- **New `world3/areas/index.ts`**: the side-effect registry of Wave 2 area
  modules. The integrator adds one `import "./X"` per area. The Experience
  imports it as `"./areas/index"`. On a case-insensitive disk (macOS),
  `"./areas"` resolves to `Areas.ts`.

### Rules for Wave 2 area authors
- **3D words**: place the word's group under `ctx.group` (position and
  rotation) inside the builder, and never move it afterwards. Areas arms it
  when the builder returns (W1-B). Dev builds warn if a group moves after arming.
- **Flat text**: keep `handle.object.position.y = 0` (see the amended layer line above).
- **Welcome**: `handle.reset()` must return the hero letters home. The
  Experience calls `areas.reset("welcome")` after Travel, R, the fall-off
  respawn and the Start drop. The > 60-unit auto-reset (§3.3) belongs in
  Welcome's `update(dt, t, rt)` (rt.carPos), triggered on the near-to-far change.
- **Playground**: `handle.reset()` resets the bricks, pins, ball and PLAY,
  and snaps each one. `commands.resetPlayground()` calls `areas.reset("playground")`.
- Dynamic props come from `ctx.physics.addDynamic*()`. Remove them with
  `ctx.physics.removeBody()`, never with `world.removeRigidBody`, so stale
  impact sources are dropped.

### Experience behaviour
- **Boot**: the React shell detects the profile first, with detect-gpu and a 3 s race.
  Then `Renderer` + `Sizes` start, replacing the Step 0 `createRenderer()` and
  its container ResizeObserver. The fonts load next (`preloadAll` over every content string, plus
  `loadTypeface`), in parallel with `loadRapier()` (one retry). Each of
  the three jobs advances the fonts stage by a third. After that come the assets,
  then the build (Environment, text, the car, tyre dust, Camera, Controls, Areas
  and the interim markers), then `compile` + one render, then `"ready"`.
  - A font, typeface, Rapier or car.glb failure goes to `"asset"`.
  - A renderer constructor that throws goes to `"webgl"`.
  - `webglcontextlost` stops the loop and goes to `"context-lost"`. Restore
    reloads the page.
  - Init stops as soon as the phase is `"failed"`, for example after a context
    loss during loading, so it never overwrites the failure with `"ready"`.
- **Interim markers (Wave 1 only)**: so the world is not empty, every area
  without a registered builder shows its `title3D` at its Layout position:
  - the JAZZ hero word and PLAY, dynamic, in ink;
  - every other title static, in its ACCENT_INK.
  Welcome's role line also shows when Welcome is absent. Each marker
  disappears automatically once its area registers. The interim hero word gets the
  §3.3 auto-reset (> 60 units) and resets after Travel and R. The interim PLAY word
  resets with `resetPlayground`.
- **Avatar**: `avatar.glb` is requested only once the About area is registered,
  so Wave 1 makes no 404 request. Palm and the Nature Kit load as configured.
- **Start**:
  - creates the AudioContext inside the click;
  - drops the car in and plays the intro (which releases Camera's intro hold);
  - enables board loading.
  The spawn area counts as visited without a toast, because the Start card is the welcome.
- **Per frame**:
  - First-visit toasts use `areaCopy[id].name · blurb`.
  - The current area is null between rects, so the HUD chip hides there.
  - Camera zones use `AreaDef.cameraZone` + `cameraShot`, else "default".
    `setShot` is called every frame, and the camera ignores repeats.
  - Area culling is 70 units from the focus to the rect.
  - The occluder segment is parked before Start and in photo mode.
- **Input gating**: Controls (driving, E, R) and camera pan/zoom are enabled
  only while running, unpaused and with no panel, map or menu open. The store
  subscription keeps this in sync. M, N, P and Esc are handled while running.
  Esc is the fallback when no dialog swallowed it: it leaves photo mode, closes
  the top layer (menu, then map, then panel), or opens Settings.
- **Quality (§9.3)**: Menu High = 2048 shadows, Medium = 1024, and Low = no
  shadow map (blobs) and no tyre dust. Scenery tiers are applied by Scenery
  (W2-6) once it is wired. Auto = the profile, plus the adaptive steps when
  adaptive is on. Profiles without a shadow map skip `shadow1024`. Adaptive takes
  the median of 4 s / 10 s windows (fully covered), evaluates once a second, ignores
  the first 5 s, hidden tabs and camera tweens, and makes at most one change every 8 s. Changing
  the setting, or toggling adaptive, resets it to level 0. `sceneryScale` is
  computed but has no consumer until Scenery exists.
- **Next-visit DPR fallback (§9.1)**: on the `mobile` profile, the median frame
  time over seconds 5–15 after Start is checked once. Above 28 ms it writes
  `dprCap = 2` for the next visit and never changes the current session.

### Audio.ts (ported from v2)
- The AudioContext is created in the Start gesture, which avoids Chrome's
  "not allowed to start" warning. The UI and engine sounds and `music.ogg`
  are fetched after Start (§8.2: music lazily). Nothing is fetched before Start.
- **No beat return and no market panner.** `ambient.ogg` is not played; whether
  it suits the day look is the owner's call.
- `getBands(n)` returns log-spaced analyser bands in [0, 1] for the Music
  stage's EQ bars. It returns null while muted, before Start, and until the music plays.
- `playImpact(kind, force)` synthesizes short hits (filtered noise, plus a low
  thump for wood and heavy), with a per-kind 60 ms flood guard and 6 voices. No impact
  files are needed. The Kenney impact pack (P1) can replace the synth later.
  The tuning constants are stream-local in Audio.ts.

### Debug.ts (`?debug`)
lil-gui is loaded with a dynamic import only under `?debug`, so it is not in
the normal bundle. It has these folders:
- Look preset (`env.applyLook` + `renderer.setLook`);
- Lights (intensity and colour per light);
- Shadow (map size, intensity, radius, bias, normal bias);
- Camera (shot, plus zoom, d and fov readouts);
- Text (hide SDF text, hide 3D letters, force the desktopOnly rule);
- Probe: tick "probe on click", then click a pixel. It reads linear r/g/b,
  the hex value, and PASS/FAIL against the active look's band;
- Perf (fps, draw calls, triangles, troika count, bodies, DPR, buffer size and
  path, quality state).

### Verification notes
- `npx tsc --noEmit` is clean, `npm run test` passes 18 files / 255 tests, and
  `npm run lint` has 0 errors.
- The machine had no DNS, so `npm run build` (Turbopack) failed only on the 5
  `next/font/google` fetches: Geist, Geist Mono and Poppins in the root
  layout, and Inter and Bricolage in `/field`. With
  `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, `next build --webpack` compiles,
  type-checks and prerenders every route. Turbopack's font mock does not cover
  font files. Re-run `npm run build` with network before shipping.
- In the browser (dev, `/field?v=3&debug`):
  - the page boots to the Start card with no console errors;
  - after Start the car drives nose-first, north at yaw π;
  - travel teleports and marks the area visited;
  - M, Esc, R, N and P work;
  - the quay, bollards, lagoon foam and jetty render;
  - Chrome uses the device-pixel box (`canvas.width === devicePixelContentBoxSize.width`).
  The preview pane was a hidden document (rAF about 1 fps), so motion and gsap
  tweens could not be judged there. The visual and fps checks belong in a focused browser.

## Wave 2 prep (integrator, before the Wave 2 areas start)
The open contract requests Wave 2 depends on, and the Wave 1 system-review
fixes. Later decisions override earlier ones and the spec.

### Contract requests resolved
- **(a) Dynamic-body helpers on `PhysicsApi`**: `addDynamicBox`,
  `addDynamicBall`, `addDynamicCylinder`, `addDynamicLetter` and `removeBody`
  are on the contract (types.ts, landed with the Wave 1 integration). Areas
  create props through `ctx.physics` with no casts. `DynamicBodyOptions` is a
  type-only re-export from Physics.ts.
- **(b) Lazy board textures reachable from `AreaContext`**: `ctx.assets.boards`
  (`BoardLoaderApi`: `register`, `request`, `get`, `onLoaded`). The Experience
  calls `boards.start()` inside Start and `boards.update(focus.x, focus.z)` every
  frame after the camera update (two numbers, not a vector; the earlier note
  said `update(focus)`).
- **(c) Stream-local tunables moved into Config** (values unchanged):
  - `CONFIG.physics.colliders` (fixed / ground / wall friction + restitution),
    `CONFIG.physics.dynamicDefaults` (box / cylinder / ball / letter, with each
    one's impact family) and `CONFIG.physics.impact` (the moving-prop filter
    speeds). Physics.ts keeps only its numeric guards (`STEP_EPSILON`,
    `MIN_HALF_EXTENT`).
  - `CONFIG.vehicle.chassis` (body damping, collider friction / restitution),
    `CONFIG.vehicle.wheelConnection`, `CONFIG.vehicle.handling` (engine force
    scale, opposing-brake and handbrake factors) and
    `CONFIG.vehicle.driftMetric` (min speed, gain, threshold). The key is
    `driftMetric` because `CONFIG.vehicle.drift` (0.86, rear grip) already
    exists. Fallback-body geometry, lamp placement and the blob map stay
    stream-local in Vehicle.ts: they are presentation, not tuning.
  - `CONFIG.scenery.kitNormalize` (tree height 4.9, bush height 0.9, boulder
    footprint 2). Assets' `NATURE_NORMALIZE` is now that object.
  - `CONFIG.loading.retries` (1). Assets' `REQUIRED_RETRIES` and the Rapier
    init (`withRetries(loadRapier, CONFIG.loading.retries)`) both read it.
- **`AreaContext.runtime: Readonly<RuntimeInfo>`** (additive). It is the same
  live object `update(dt, t, rt)` receives. The Experience now creates it
  before `areas.build()`, so builders can keep it. Build-time animations must
  read `runtime.reducedMotion` when they run, never once at build.
- **`KeycapOptions.reducedMotion?: boolean | (() => boolean)`** (ui3d/Pad.ts).
  Areas pass `reducedMotion: () => ctx.runtime.reducedMotion`, so a Menu or OS
  toggle reaches keycaps that already exist. With reduced motion on, `punch()`
  settles the cap at the raised pose.

### System-review fixes
- **HUD top bar at phone widths (§6.2)**: the bar centres its items; the left
  cluster flexes and the right cluster and wordmark never shrink; the chip name
  sits in `.w3-area-chip-label`, which carries the ellipsis (`text-overflow`
  never applies to an anonymous flex item). The wordmark hides at ≤ 480 px (the
  maths is next to the rule) and the chip at ≤ 299 px; the aria-live Announcer
  still says "Entered …". Checked at 327 px with a coarse pointer: the chip
  gets 87 px, so "Welcome" and "Frontend Projects" both ellipsize ("Front…"),
  nothing overlaps, and the chip and buttons share a centre line. With a fine
  pointer the chip gets about 103 px and "Welcome" fits.
- **Keyboard focus (extends the §4.3 form-control list)**: keys act only while
  focus belongs to the world: nothing, the canvas or `<body>`. Escape still
  passes from anywhere (dialogs stop its propagation). A focused link (the HUD
  "Classic site"), button or the FieldSummary sheet keeps its keys, so Enter
  on a link no longer also runs `interact()`, and Tab-browsing the sheet no
  longer drives the car. `isFormControl` stays exported as the literal §4.3
  rule.
- **Audio**: a hidden tab suspends the AudioContext and a visible one resumes
  it (rAF stops in the background, so the engine loop would drone and the
  music would play). `music.ogg` (3.4 MB) is fetched only once sound is on: at
  Start when the stored preference is on, else on the first unmute.
  FieldExperience now calls `setMuted` before `start()`, so `unlock()` sees the
  real preference.
- **Boot probes release their WebGL contexts**: `webgl2Available()` loses its
  probe context before returning. `detectRenderProfile()` creates one `webgl`
  probe, passes it to detect-gpu as `glContext` (detect-gpu 5.0.70 never
  releases its own), loses it in a `finally`, and clears the 3 s race timer. A
  late detect-gpu rejection is swallowed.
- **One "confirm" per pad interaction**: `commands.openUrl` no longer plays it;
  `interact()` already does for every pad.
- **Travel closes the content panel too** (`mapOpen: false, panel: null`), so
  driving resumes in the new area.
- **Photo mode**: a pointer click on Capture returns focus to the canvas
  (`PhotoBar` takes `focusCanvas`), so P and WASD keep working.
- **Touch targets (§9.4)**: under `(pointer: coarse)`, "Skip to classic
  portfolio" is at least 44 px tall and the Quality pills are 44 px.
- `buildWorld` reads reduced motion from the store, not from `init()`'s
  argument. An OS toggle during loading has already updated the store.

### Tests added
- Assets.test.ts (ported from W1-D's scratch checks): every shipped Nature Kit
  model normalises to 4.9 / 0.9 / 2 with an identity root; an unknown Nature
  Kit material makes `model()` null without rejecting `load()`; only a failed
  car.glb rejects; `dispose()` during loading frees every model on arrival;
  a texture that arrives after `dispose()` is freed and not cached.
- Controls.test.ts: with a link or another element focused, Enter does not
  interact and WASD adds no held input; `<body>` and the canvas restore the keys.
- Audio.test.ts: visibility suspend / resume, and music fetched once, only after unmute.
- Pad.test.ts: the reduced-motion getter is read live.
- Experience.test.ts: `withRetries`.

### Verification
- `npx tsc --noEmit` is clean, `npm run test` passes 18 files / 264 tests,
  ESLint is clean on world3 + app/field, and `npm run build` (Turbopack, with
  network) compiles and prerenders every route.
- In the browser (dev, `/field?v=3&debug`, 327 × 640 with a coarse pointer):
  the top bar measures as described above, there are no console errors, and a
  muted Start fetches the UI sounds and engine.wav but not music.ogg.

## Wave 2a integration (Welcome + Hub + Paths + Scenery)
The integrator wired the W2-1 (Welcome, Hub, Paths) and W2-6 (Scenery)
streams into `/field?v=3`. Later decisions override earlier ones and the spec.

### Wiring
- **`areas/index.ts`** imports `./Welcome` and `./Hub`. Both register, so the
  interim JAZZ, role line and hub markers are no longer built; the other seven
  areas keep their interim 3D titles until their modules land. The Experience
  routes `afterTeleport` / Travel / R to `areas.reset("welcome")`, and Welcome
  owns the > 60-unit auto-reset.
- **Boot order (§10)**: renderer → fonts ∥ Rapier → assets → environment → car,
  camera, controls → areas (+ interim markers) → paths → scenery → warm-up
  render. `planScenery()` (≈ 0.1 s of maths, memoised per seed) runs right
  after the asset downloads start, so it overlaps the network wait, and the
  plan is passed to Scenery as `deps.plan`.
- **Build progress**: `CONFIG.loading.buildSteps` (environment 0.15, core
  0.3, areas 0.6, paths 0.7, scenery 1) splits the 0.25 build weight, and
  `buildWorld` is now async: it yields one macrotask after each step so the
  loader bar can paint, and stops (returns null) when the Experience was
  disposed or failed meanwhile.
- **Paths**: `Paths.build({ materials, text }, { skipOwners: areas.builtIds })`,
  so Welcome and Hub draw their own labels (culled with them) and Paths draws
  only the unowned P5 / P6 labels.
- **Paths and Scenery are optional**: a throw while building either one is
  logged and skipped (`optional()` in Experience.ts). The world still boots,
  the same rule as a failing area builder.
- **Quality (§9.3)**: `applyQuality()` calls `scenery.setQuality(q)` (tier from
  the Menu setting or profile, `sceneryScale` 0.7 after the adaptive
  "scenery-30" step), in the §9.3 order shadow map → scenery −30% → tyre dust.
  The `?debug` quality line now shows the scenery tier and scale.
- **Teardown**: Paths and Scenery are disposed through `own()`. Scenery is
  registered after the Environment, so it is disposed **before** it (its blob
  ranges are hidden on a live Environment) and its colliders are removed
  before Physics is freed.

### Minimal edits to other streams' files
- **Environment.ts**: `isDisposed()` (Scenery's teardown guard already checks
  for it). Environment.test.ts checks it flips on dispose.
- **Config.ts**:
  - `CONFIG.type.greeting = { font: "medium", size: 0.9 }`; Welcome and
    Layout's `GROUND_TEXTS` greeting footprint use it (no longer the borrowed
    `floorCaption.size`).
  - Scenery's stream-local tunables moved to `CONFIG.scenery` (values
    unchanged): `procedural`, `bushClusterSpread`, `foliageDarkShare`,
    `palmCrownReach`, `chunk`. Scenery.ts keeps the exported names
    (`PROCEDURAL`, `BUSH_CLUSTER_SPREAD`, `FOLIAGE_DARK_SHARE`,
    `PALM_CROWN_REACH`, `CHUNK`) as aliases of the Config entries. Hub's tree
    comes from Scenery's `createSceneryTree`, so it reads the same entry.
  - `CONFIG.loading.buildSteps` (above).

### Accepted stream decisions
- **Tile slab is unbevelled** (`Paths.TILE_SLAB = { bevel: 0, curveSegments: 4 }`):
  76 triangles per tile, about 32k for all 426 tiles in one always-in-view
  InstancedMesh (a 0.02 bevel on a 0.08 slab is invisible at this camera and
  cost 236 per tile, about 100k). The single mesh stays (PathsHandle.tiles).
- **Scenery judgement calls (W2-6)**, kept:
  - the north strip (beyond the quay clearance, within 22 of the quay) keeps
    the grove noise mask;
  - at the SW / SE corners the south / east "low" rule wins over the west
    "edge" rule;
  - bush counts are individual bushes (clusters of 2–3 count as 2–3);
  - bushes cast no shadows and get no low-profile blobs;
  - the sun-side strip rule applies to props of every height;
  - tall props test their crown / reach disc against ground-text footprints,
    and their sun strip is lengthened to their shadow (height / tan 52°);
  - only heavy models (> 500 triangles: palm.glb) are chunked into 48 × 48
    cells; light kit models stay one InstancedMesh per variant;
  - band extras ignore the tier but scale with the adaptive density.

## Owner: desktop-first, no on-screen controls
Owner direction (overrides §2.4, §5.3 and §6.2). Desktop shows no on-screen
controls; mobile is not polished now.
- **Welcome's in-world controls card is removed** (plate, keycap outlines and
  the 8 desktopOnly texts), with `Layout.AREA_LAYOUT.welcome.controlsCard` and
  its `GROUND_TEXTS` footprint. Welcome now builds the plaza, hero word, role
  line, greeting and its two path labels only.
- **The floating 3D "E" keycap is deleted**: `buildKeycap`, `Keycap`,
  `KeycapOptions` and `CONFIG.pad.keycap` are gone (no area used them), and so
  are their Pad tests. Pads keep the outline / fill highlight and the optional
  flat label.
- **HUD controls hint removed** (the 20 s bottom-left kbd row,
  `CONFIG.ui.controlsHintMs`, the `showHint` prop and the `.w3-hint` CSS).
- **Start card**: no keyboard-shortcut chip row (`START_CONTROLS` removed).
  One short line instead (`startSubLine`): "All controls are in the menu
  (Esc)." on desktop, "Left pad to drive · tap E to open" on touch.
- **Kept**: the HTML prompt card naming what is in range (title + action with
  a small E kbd chip), the top-right Classic site / Map / Sound / Menu
  buttons, and the full list in Menu → Controls (`KbdRow` stays for it).
- **Touch UI only on genuine touch devices**: `isTouch` is now
  `matchMedia("(hover: none) and (pointer: coarse)")`
  (`TouchControls.isTouchDevice`, `TOUCH_DEVICE_QUERY`), not
  `pointer: coarse` or `maxTouchPoints`. Desktops and touchscreen laptops with a
  mouse or trackpad never get the joystick, touch copy or touch-only text
  rules. The render-profile `isMobile` fallback (detect-gpu timeout) still uses
  the old coarse test; it only picks a profile.

### Verification (Wave 2a integration)
- `npx tsc --noEmit` clean; `npm run test` passes; ESLint clean on
  `app/components/three/world3` and `app/field/v3`; `npm run build`
  (Turbopack) compiles and prerenders every route; v2 files untouched.
- Headless draw-call estimate (throwaway probe, deleted): real Nature Kit
  GLBs, a palm stand-in with palm.glb's triangle count, the real
  Environment / Welcome / Hub / Paths / Scenery, the default shot (d 38, and
  56 at max zoom-out), 1440 × 900. Instanced meshes in the camera frustum:
  36–40 draw calls and 73k–100k triangles over all tiers, of which 26–30
  calls and 27k–53k triangles cast shadows. Add about 8 for the car,
  1 for tyre dust, 4 hero letters, up to 7 interim title letters and 2–4
  troika texts: about 55 in the colour pass and about 95 per frame with the
  shadow pass, against the 180 budget. Troika texts built in total: 10
  (Welcome 4, Hub 4, P5 / P6 labels 2). This is still to be confirmed with
  `renderer.info` in `?debug` in a focused browser.
