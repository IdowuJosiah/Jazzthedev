# /field v3: clean diorama redesign spec

Scope: the `/field` route. The v3 engine is built in a new folder, `app/components/three/world3/`. The v2 engine in `app/components/three/world/` is left alone, and must keep building, until Wave 3. Wave 3 switches `/field` to v3 and deletes v2.

Status: ready to implement. One owner sign-off is needed at the look-dev gate (§10, Gate). Every value below is a starting value. Tune values only through `?debug`, and copy any tuned value back into `world3/Config.ts`.

Repo root: `/Users/jazzthedev/WebstormProjects/untitled6/portfolio`

---

## 0. Decisions at a glance

1. **Mood: a bright Lagos afternoon, not neon night.**
   - The world has warm sand ground, ink-coloured type, white toy-like objects, one accent colour per area, a terracotta-red car and a teal lagoon.
   - The day/night cycle, rain, fireflies and neon are deleted.
   - The owner confirms the mood at the look-dev gate. There the day look is shown next to a `dusk` preset that uses the same pipeline with no post-processing (§1.7).
2. **No post-processing.**
   - Draw directly with `renderer.render(scene, camera)`.
   - No tone mapping, no N8AO, no bloom, no ACES, no colour grading, no vignette, no SMAA, no DOF.
   - These effects are the main cause of the blurry text.
3. **DPR never drops below `min(devicePixelRatio, 2)`.**
   - DPR is fixed at boot by a render profile (§9.1).
   - Desktop renders at `min(dpr, 2)` with MSAA.
   - Phones render at their native DPR, up to 3, without MSAA.
   - Neither the Quality setting nor adaptive quality ever changes DPR or MSAA.
4. **Text comes in three tiers:**
   - Extruded 3D letters for the hero name and the area titles.
   - troika SDF text for readable copy in the world.
   - HTML for anything read for longer than about a second.
   - Canvas sprites are deleted.
5. **Fonts (both OFL 1.1):** Bricolage Grotesque ExtraBold for display, Inter for reading.
   - Both are self-hosted.
   - A Node script builds them (no Python).
   - Yoruba text is always set in Inter.
6. **Camera: a fixed-azimuth 3/4 diorama view.**
   - Yaw 45°, FOV 30, elevation 36°, distance 38.
   - The camera never rotates with the car.
   - Portrait screens switch to FOV 42 at a distance that keeps 22 units visible across the screen.
   - Projects and Music switch to a lower "gallery" shot.
7. **Layout: a flat, non-circular hub-and-spoke map.**
   - A crossroads hub in the middle.
   - A gallery street to the east.
   - A timeline trail to the north, with Eko on one side and Music on the other.
   - The playground to the west.
   - About & Contact beside the spawn point.
   - A straight lagoon quay along the north edge, with a Credits jetty.
8. **Shading: one shared palette of `MeshLambertMaterial`s, lit by a 3-light rig.**
   - The rig is a hemisphere light at 1.7, a sun at 1.2 and a camera fill at 1.0.
   - It is calibrated so that sun-lit white paper renders at `#F9F7F6` and nothing clips.
   - Shadows use PCF with intensity 0.9.
   - The car does not cast a real shadow; it uses a blob shadow only.
9. **Minimal HUD:**
   - A wordmark and an area chip.
   - A **Classic site** link that is always visible.
   - Map, Sound and Menu buttons.
   - A prompt card.
   - A map modal (`M`) with teleport replaces the always-on circular minimap.
10. **Physics:**
    - The car and every dynamic body are drawn at an interpolated position between physics steps (render alpha).
    - Fix the Rapier vehicle forward axis (`setIndexForwardAxis = 2`), so the speed sign is correct in reverse.
11. **Build safety:**
    - v3 is built in a parallel tree, reachable behind `/field?v=3`.
    - All deletions happen in Wave 3.
    - The repo type-checks and builds at every step.
12. **Owner avatar:** optional in v1. v1 uses `profile.png` on a portrait board. The brief for generating the avatar is in §8.3.

---

## 1. Art direction

### 1.1 Mood: bright and clean, not night

The "shabby" feedback comes from the night art direction:

- A dark scene only reads through emissive materials and bloom. With bloom threshold 0.5 and intensity 1.15, every sign, frame and label glows and smears.
- The muddy navy midtones then needed ACES, +0.14 saturation and a 0.52 vignette. Those turned white text grey and gave it halos.
- Neon on navy reads as "gamer", not as a product lead's portfolio.
- Ten point lights cost enough frame time to trigger the adaptive DPR drop, which made the text blurrier still.

**The Bruno Simon reference, stated accurately:**

- His 2019 folio is a bright, matte, matcap-shaded toy world with soft fake shadows and almost no screen effects.
- His current site (2025; source at `github.com/brunosimon/folio-2025`) is richer. It has a day/night cycle and weather, palette-texture materials, and some screen-space effects on desktop, including depth-of-field/blur.
- **We adopt:** the bright toy base, flat palette materials, soft tinted shadows, physics props, a fixed 3/4 camera, and signs built as geometry in the world.
- **We reject:** depth-of-field, blur and every other full-screen effect, because the owner's complaint is blur.

A bright, matte world with soft shadows gives:

- dark ink text on a light ground at 10:1 contrast;
- clean silhouettes;
- no need for bloom;
- far lower GPU cost.

Lagos identity comes from:

- the palette: sand, terracotta, lagoon teal, and danfo yellow on the car rims and the ramp;
- the lagoon quay;
- the Yoruba word tokens;
- the content.

**Naming:**

- `meta.worldName` in `content/world.ts` defaults to `"Èkó"`. The owner picks the final name at the gate: `"Èkó"`, `"Èkó Nights"` (only if the dusk look is chosen) or `"Jazz's World"`.
- The world name is HTML-only and always set in Inter.
- Set the `page.tsx` metadata title to `"Jazz · Drive through my work"`.
- Do not show "Nights" anywhere in the UI unless the owner keeps it.

### 1.2 Palette (exact hex values)

| Token | Hex | Use |
|---|---|---|
| `background` | `#F3DCC0` | `scene.background`, fog colour, renderer clear colour, loader background |
| `ground` | `#EFCFA6` | Ground albedo. Renders `#EACAA4` when lit and `#CAB092` in shadow |
| `groundEdge` | `#E6BC8C` | Ground tint in the last 24 units before the bounds (P1) |
| `plaza` | `#F8E7CF` | Area plaza plates, bowling lane strip |
| `path` | `#FBEDDC` | Stepping-stone tiles |
| `paper` | `#FFFDF8` | "Toy white": board frames, plates, coins, bricks |
| `ink` | `#24222B` | All small in-world text, hero letters, legs, stage, tyres |
| `ink2` | `#45414C` | Secondary text. **Only on plaza or paper plates** |
| `stone` | `#3B3A45` | Speakers, posts |
| `wood` | `#C99A6B` | Jetty planks |
| `foliage` / `foliageDark` | `#8DBF5A` / `#6FA64B` | Tree crowns (chosen at random per instance) |
| `trunk` | `#9C6B4A` | Trunks |
| `bush` | `#7DB356` | Bushes |
| `boulder` | `#CDBBA7` | Boulders (flat shading) |
| `quay` | `#E9DCCB` | Quay edge |
| `waterShallow` / `water` / `waterDeep` / `foam` | `#8EDAD1` / `#3FAFBE` / `#2A8EA3` / `#FFFFFF` | Lagoon |
| `carBody` | `#E2553F` | Brand terracotta. Gate option: `danfo` `#F6C21C` (§4.2) |
| `carTrim` / `carTyre` / `carRim` / `carLight` | `#24222B` / `#2E2C35` / `#F6C21C` / `#FFF6D8` | Car |
| `brake` | `#FF3B30` | Brake light (unlit, on an ink backing) |
| `blobShadow` | `#3B2F45` | Contact-shadow decal |

**Area accents.** `ACCENT` is for shapes. `ACCENT_INK` is for text and 3D titles. The contrast columns are for `ACCENT_INK`, measured against **rendered** colours. troika text is unlit while the surfaces under it are lit, so contrast must be measured against what the surface actually renders as.

| Area | `ACCENT` | `ACCENT_INK` | vs HTML paper | vs lit paper plate (`#F9F7F6`) | vs lit ground (`#EACAA4`) |
|---|---|---|---|---|---|
| brand (Welcome, About & Contact, CTAs) | `#E2553F` | `#B63A26` | 5.70 | 5.42 | 3.71 |
| projects | `#2F6FED` | `#1F55C9` | 6.45 | 6.13 | 4.20 |
| eko (matches the Eko app's indigo) | `#5B4CF0` | `#4436D6` | 7.53 | 7.15 | 4.90 |
| music | `#D6457E` | `#B02A62` | 6.16 | 5.85 | 4.01 |
| journey | `#12A387` | `#0B7A65` | 5.18 | 4.92 | 3.37 |
| play | `#F6C21C` | `#24222B` | — | — | — |

**Colour rules** (each one is checked in Wave 4):

- **Ink text:** small in-world text is `ink`, at ≥ 7.5:1 on every surface, lit or shadowed. Measured values: lit ground 10.05, shadowed ground 7.56, lit plaza 12.3, lit paper plate 14.7, upright paper face 12.1.
- **ink2 text:** `ink2` appears only on plaza or paper. It measures ≥ 5.8:1 there, including in shadow (shadowed plaza 5.84).
- **Accent text:** `ACCENT_INK` text sits only on paper (HTML or paper plates), never on bare ground. Accent colours never carry text smaller than 1.5 units. 3D titles are geometry and are exempt.
- **Sun-side strip:** no prop taller than 1.5 units may stand in the 6-unit strip that runs from any ground text toward the sun, along horizontal direction `(−0.42, 0, 0.91)`. Its shadow would fall on the text.
- **No black, no effects:** no pure black anywhere. No glow, no outline, no text-shadow.

### 1.3 Material strategy: flat-palette Lambert (not matcap, not toon)

New file `world3/Materials.ts`:

- `lambert(hex, { flat?, occluder? })` caches one `MeshLambertMaterial` per (hex, variant).
  - `occluder: true` adds a screen-door dither fade. It is used on all scenery (§2.6).
  - The shader receives uniforms `uOccA` (camera position) and `uOccB` (car position + (0, 1, 0)).
  - For each fragment, compute the distance `d` to the segment from `uOccA` to `uOccB`, and how far along it the fragment is, `t ∈ [0, 1]`.
  - Then `keep = smoothstep(2.0, 3.5, d) + step(0.97, t)`.
  - Discard the fragment when `keep < bayer4(gl_FragCoord.xy)`.
  - Shadow depth passes are unaffected.
- `basic(hex, { fog = true })` caches one `MeshBasicMaterial` per hex value.

In r186, Lambert shading is per-fragment and receives shadow maps.

Why not the alternatives:

- **Matcaps** cannot receive shadow maps, and the obvious free set (nidorx) has no licence.
- **Toon gradients** show colour bands on curved props.

**GLB conversion.** Traverse every loaded GLB and replace each `MeshStandardMaterial` with a `MeshLambertMaterial`. Copy across `map`, `color`, `side`, `vertexColors`, `alphaTest`, `transparent` and `opacity`. The car's material is double-sided. This also fixes the 0.4 metalness on the Quaternius models.

Unlit `MeshBasicMaterial` is used only for:

- project images;
- troika text;
- the brake light;
- blob shadows;
- the water (with an `onBeforeCompile` gradient).

**Rounded shapes.** In r186, `RoundedBoxGeometry` clamps its radius to half the shortest side. So:

- Thin objects that need rounded corners seen from above or from the front (path tiles, the phone, plates, plazas) use `utils/shapes.ts`:
  - `roundedRectShape(w, h, r)`;
  - `roundedSlab(w, d, h, r, { bevel = min(0.04, h/4), curveSegments = 4 })`, an extruded `Shape`;
  - `flatPlate(w, d, r, layer)`.
- Every `RoundedBoxGeometry` in this spec is given a radius at or below the clamp.

### 1.4 Lighting rig (three 0.186, physical intensities, NoToneMapping)

| Light | Colour | Intensity | Direction (from target toward light) | Notes |
|---|---|---|---|---|
| `HemisphereLight` | sky `#EEF2FF`, ground `#F5DCC4` | 1.7 | — | Cool from above, so shadows read slightly cool. Warm bounce from below. |
| `DirectionalLight` "sun" | `#FFF5EB` | 1.2 | `(−0.26, 0.79, 0.56)` normalised, about 52° elevation, from camera-left | The only shadow caster. Shadows fall to screen-right, slightly up-screen. |
| `DirectionalLight` "fill" | `#FFFFFF` | 1.0 | `(0.57, 0.59, 0.57)`, the camera direction | `castShadow = false`. Keeps faces that point at the camera from going grey. |

**Delete:** the ambient light, the moon, all `PointLight`s (zones, lanterns, headlight, tail light) and the HDRI environment.

**Renderer:** `renderer.toneMapping = NoToneMapping`, `outputColorSpace = SRGBColorSpace`.

**Calibration.** These values use three's Lambert maths (Σ intensity·colour·max(0, n·l) / π × albedo, with hemisphere weight `0.5·n_y + 0.5`). The colours include the light tints.

| Surface (albedo) | Lit top | Top in shadow (0.9) | Face toward camera |
|---|---|---|---|
| paper `#FFFDF8` | `#F9F7F6` (linear 0.952 / 0.927 / 0.919) | `#D7D8DB` | `#E9E1DA` |
| ground `#EFCFA6` | `#EACAA4` | `#CAB092` | `#DAB891` |
| plaza `#F8E7CF` | `#F3E1CD` | `#D1C5B6` | — |
| path `#FBEDDC` | `#F6E7DA` | `#D4CAC2` | — |
| car body `#E2553F` | `#DD533E` | — | `#CF4B36` |

**Rule (written as a comment in Config):** each channel of the brightest sun-lit `paper` top must stay between 0.88 and 0.96 linear. Check every channel separately with the `?debug` pixel probe (§10, W1-A). The day rig passes at 0.952 / 0.927 / 0.919.

### 1.5 Shadows

- `renderer.shadowMap.type = THREE.PCFShadowMap`. `PCFSoftShadowMap` was removed in r186: three warns and falls back to PCF.
- Sun shadow settings:
  - `mapSize` comes from the render profile: 2048 on desktop-high, desktop-medium and mobile. The low profiles have no shadow map (§9.1).
  - `radius 3`
  - `bias −0.0005`
  - `normalBias 0.04`
  - `intensity 0.9`. The hemisphere and fill lights keep shadows from going black.
- **Shadow box**, an orthographic camera fitted to the view:
  - **When to refit:** when the zoom factor changes by more than 0.1, or when the aspect ratio, FOV or camera shot changes. Do not refit every frame, so the texel size stays stable while the speed pull-back moves the camera.
  - **Corner points:** intersect the four frustum corner rays with y = 0, at distance `base·zoom + 6·base/38`. This includes the full speed pull-back. Clamp each ray at 140 units.
  - **Box size:** add the same 4 points raised by 8 units, for tall casters. Transform all 8 points into light space and take their AABB. Pad it by 4, and round the half-extents up to a multiple of 4.
  - **Centring:** store the offset from the focus to the box centre. Each frame, centre the box at `focus + offset`, snapped to the texel grid in light space so shadow edges never crawl.
  - At default zoom this gives about ±46 units, a texel of about 0.045 at 2048.
  - `near 1`, `far 200`; the light sits at `centre + dir·100`.
- **Who casts and receives:**
  - Static props (letters, boards, trees, boulders, stage, plinths, bricks, pins) cast and receive shadows.
  - Ground, plazas, plates, tiles and paths only receive.
  - Text casts nothing.
  - **The car does not cast a shadow** (`castShadow = false` on every car mesh). Its only shadow is the blob.
- **Blob shadows:**
  - The car blob is a `PlaneGeometry(2.6, 4.6)`, flat at **y 0.10** (above the path tiles), following the car's x/z and yaw.
  - Its alpha map is a 128² canvas rounded-rect radial gradient with a `smoothstep` falloff.
  - Material: `MeshBasicMaterial({ color: #3B2F45, transparent, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: −1, polygonOffsetUnits: −4 })`, with `renderOrder 1`.
  - Opacity is multiplied by `clamp(1 − h/3, 0, 1)²`, where `h` is the chassis height above its resting height.
  - The ball and the dynamic letters also get following blobs (round, 0.30).
- **Low profiles** (no shadow map): one `InstancedMesh` of the same blob texture sits under every static prop (trees, palms, boulders, boards, sleeves, phone plinth, stage, titles), at opacity 0.30.

### 1.6 Fog and background

- `scene.background = new Color('#F3DCC0')`.
- `scene.fog = new THREE.Fog('#F3DCC0', near, far)`, linear fog. Delete `FogExp2`.
- **Fog distances scale with the camera distance `d`** (zoom and pull-back included), updated every frame: `near = 1.18·d`, `far = 3.0·d`. At default (d = 38) that is 45 to 115.
  - The top edge of the screen sits about 60 units away, so the far ground fades about 20% toward cream.
  - The fade looks the same at every zoom level.
  - At the focus there is no fog.
- The camera's top ray points 21° below the horizon, so the horizon and the bare background never show. The fade is the only depth cue.
- **All world materials fog consistently.** Troika text, project images, plates and props all use `fog: true`, so text fades exactly as much as the surface it sits on.
- Delete `shaders/sky.ts` and the sky sphere.

### 1.7 Look presets (owner gate)

`Config.LOOK` holds two presets. Switching between them changes one Config value. Albedos are shared, and neither preset uses emissives or bloom.

| Preset | Background / fog | Hemisphere (sky / ground, ×) | Sun | Fill | Renders |
|---|---|---|---|---|---|
| `day` (default) | `#F3DCC0` | `#EEF2FF` / `#F5DCC4`, ×1.7 | `#FFF5EB` ×1.2 | `#FFFFFF` ×1.0 | paper top `#F9F7F6`, ground `#EACAA4`; ink on ground 10.1:1 (7.6 in shadow) |
| `dusk` (look-dev) | `#E8BD9C` | `#D9D3F5` / `#F2C29C`, ×1.45 | `#FFC08A` ×1.5 | `#FFE4D0` ×0.8 | paper top `#EDCCC8`, ground `#DEA785`; ink on ground 7.4:1 (5.3 in shadow) |

The probe rule for `dusk`: the highest channel of a lit paper top must be between 0.80 and 0.90 linear.

---

## 2. Layout (non-circular)

### 2.1 Conventions (used by every module)

- **Axes:** Y is up. The ground is the XZ plane at y = 0, and the world is **flat**: `heightAt()` returns 0 at every playable point.
- **Compass:** north is −Z, east is +X.
- **Camera yaw:** `CAMERA_YAW = π/4`. The camera sits at +X+Z of the focus and looks north-west. On screen, **north points up-right and east points down-right**. Screen-up is north-west.
- **Screen vectors on the ground:**
  - `R` (screen-right) = `(0.7071, 0, −0.7071)`
  - `S` (screen-down, toward the camera) = `(0.7071, 0, 0.7071)`
  - "Behind" = `−S`
- **faceCamera:** any upright object meant to be read gets `rotation.y = π/4`. Its local +X then maps to R and its local +Z to S.
- **Flat text and plates:** use a parent group with `rotation.y = π/4` and a child with `rotation.x = −π/2`, so the text reads horizontally on screen.
- **Path labels** are the one exception. They use `rotation.y = atan2(−t.z, t.x)`, where `t` is the path tangent, flipped if needed so that `dot(t, R) > 0`.
- **Vehicle yaw:** forward = `(sin yaw, 0, cos yaw)`. Facing −Z is `yaw = π`; facing +X is `yaw = π/2`.
- **"Row along R" convention.** For n items centred at `c` with spacing `s`, item i sits at `c + R·(i − (n−1)/2)·s`.

### 2.2 Ground, bounds, water and bands

**Ground**

- Visual: one `PlaneGeometry` covering x ∈ [−700, 700], z ∈ [−176, 700] at y = 0, using `lambert(ground)` with `receiveShadow`.
- Physics: one fixed cuboid with half extents `(700, 1, 438)`, centred at `(0, −1, 262)`.
- The terrain trimesh, dunes and normal map are not ported.

**Bounds:** x ∈ [−150, 170], z ∈ [−176, 40].

- Invisible fixed cuboid walls, 4 units high, stand at x = −150, x = 170 and z = 40.
- The quay forms the north edge.

**Quay and lagoon (north edge, z = −176)**

- **Quay strip:** `Box(1400, 1.2, 1.0)` in `quay`, top at y = 0, spanning z −176 to −177.
- **Bollards:** paper `Cylinder(0.35, 0.35, 0.9)`, instanced every 8 units along the quay, skipping x ∈ [−6, 6].
- **Sea-wall colliders:** two fixed cuboids 1.0 high along the quay, leaving a gap at x ∈ [−4, 4] for the jetty.
- **Water plane:** y = −1.1, covering x ∈ [−700, 700], z ∈ [−900, −176].
  - Material: `MeshBasicMaterial` with an `onBeforeCompile` shader, so it gets fog for free.
  - Colour: with `d = −176 − worldZ`, the colour is `mix(#8EDAD1, #3FAFBE, smoothstep(2, 14, d))`, then mixed toward `#2A8EA3` by `smoothstep(14, 60, d)`.
  - Foam: a solid white band where `d < 0.7`, plus moving contour lines:
    - `f = fract(d·0.35 − t·0.25)`
    - `line = smoothstep(0.93 − fwidth(f), 0.93 + fwidth(f), f) · (1 − smoothstep(4, 16, d))`
  - No waves and no normal map. `shaders/water.ts` exports only this patch.
- **Jetty (Credits):**
  - Deck spans x −4 to 4, z −176 to −200.
  - Planks: instanced `Box(7.6, 0.25, 0.9)` in `wood`, with a 0.15 gap.
  - Posts every 4 units.
  - Colliders: a fixed deck cuboid (top at y = 0), side rails 0.8 high, and an end bumper.
- `vehicle.respawnBelowY = −2`.

**Decorative bands outside the bounds** (no colliders; §2.6 sets the counts):

- West band: x −210 to −150, z −176 to 40. All prop types.
- South band (z 40 to 80) and east band (x 170 to 210): bushes and boulders only, because they sit between the camera and the car.
- Nothing is needed past the north bound, which is the lagoon.

### 2.3 Area table (world coordinates; rects are world-axis aligned)

The current area is the first rect in this table that contains the car's centre. Every arrival point lies inside its own rect; `Layout.test.ts` asserts this.

| id | Name | Rect: centre (x, z), size w×d | Arrival (x, z, yaw) | Camera shot |
|---|---|---|---|---|
| `welcome` | Welcome / Spawn | (0, 2), 44×36 | (0, 12, π) | default |
| `hub` | Crossroads | (0, −56), 26×26 | (0, −46, π) | default |
| `projects` | Frontend Projects | (83, −66), 138×40 | (22, −56, π/2) | `gallery`, zone x 28..152, z −92..−44 |
| `journey` | Journey & Skills | (0, −119), 36×98 | (0, −74, π) | default |
| `eko` | Eko (product case study) | (64, −122), 48×44 | (44, −120, π/2) | default |
| `music` | Music & Culture | (−64, −122), 48×44 | (−44, −124, −π/2) | `gallery`, zone equal to the rect |
| `about` | About & Contact | (−56, 4), 44×32 | (−38, 4, −π/2) | default |
| `playground` | Playground | (−106, −56), 56×44 | (−82, −56, −π/2) | default |
| `credits` | Credits (jetty) | (0, −188), 8×24 | (0, −180, π) | default |

Map (north up; this is world-up, not screen-up):

```
z -200          [CREDITS jetty]
z -176 ~~~~~~~~~~~~~~~~~~~~~~ LAGOON (quay) ~~~~~~~~~~~~~~~~~~~~~~
                         |
z -122  [MUSIC]=====[JOURNEY trail x=0]=====[EKO]
                         |
z  -56  [PLAYGROUND]==[HUB]==========[PROJECTS gallery street → x 152]
z  -40  (ramp corridor, x -145..-40)
                         |
z    2  [ABOUT & CONTACT]==[WELCOME / SPAWN]
z  +40 ---------------------- south bound ---------------------------
x:  -150     -64       0          64            152   170
```

### 2.4 Area contents

Offsets use R and S from §2.1. Every upright object is faceCamera. Coordinates are world (x, z).

**Welcome (0, 2)**

- **Spawn:** the car spawns at (0, 12), yaw π. On Start it drops from y + 6.
- **Hero word** `meta.heroWord` (default `JAZZ`):
  - **Dynamic** 3D letters in `ink`, cap height 4.0, depth 1.2.
  - Word centre (−11, 4), laid out along R.
  - This puts the word 13 units up-screen and 2 units left of the spawn point. It frames above the car on every aspect ratio, including portrait (about 15 wide, against 22 visible).
- **Role line** (flat): `meta.role` (default `FRONTEND DEVELOPER · PRODUCT LEAD`), Inter Bold 1.1, letterSpacing 0.1, `ink`, at word centre + S·5.5.
- **Greeting** (flat, on the plaza): `meta.greeting` (default `Ẹ káàbọ̀ — welcome`), Inter Medium 0.9, `ink2`, at word centre + S·7.6.
- **Controls card** (desktop only) at (13, 10):
  - A flush paper plate 10×5.2 (plates layer).
  - 4 rows of Inter SemiBold 0.8 `ink2`, each with a rounded-rect keycap outline: `W A S D  DRIVE`, `SHIFT  BOOST`, `SPACE  BRAKE / DRIFT`, `E  OPEN`.
- **Plaza plate:** `flatPlate` in `plaza`, sized to the rect, radius 3.
- **Path labels:** P1 `CROSSROADS`, P7 `ABOUT & CONTACT` (§2.5).

**Hub (0, −56)**

- **Planter:** paper `RoundedBox(6, 1, 6, 3, 0.3)` at the centre, holding one tree (from the scenery source), with a fixed collider.
- **Plaza plate** over the rect.
- **Path labels**, each 6 units outside the hub edge on its spoke:
  - P2 `PROJECTS`
  - P3 `PLAYGROUND`
  - P4 `JOURNEY · EKO · MUSIC`
  - P1 `START` (points back to spawn)

**Projects**

- **3D title** `PROJECTS`: static, `ACCENT_INK.projects`, cap 2.4, at (24, −78).
- **Boards:** four, one per `frontendProjects[i]`, base centre (44 + 30i, −76). The board build is in §5.1.
- **Pads:** pad i is centred at board + S·12, i.e. (52.5 + 30i, −67.5). Size 8 (along R) × 5 (along S). Label `E  OPEN PROJECT`.

**Journey**

- **Trail:** 3-wide tiles along x = 0 (P4).
- **3D title** `JOURNEY`: static, `ACCENT_INK.journey`, at (−11, −76).
- **Milestone plates:** six flush paper decals, 9×4.6, faceCamera, at (8, z) for z = −84, −97, −110, −130, −143, −156. The gap around z −120 leaves room for P5/P6. Each shows:
  - the year in Bricolage SDF 1.5, `ACCENT_INK.journey` (4.92:1 on the plate);
  - the title in Inter Bold 0.8, `ink`, maxWidth 8.
  - The plate is also the pad.
- **Skill plates:** three, 10×6, at (−9, z) for z = −92, −106, −146. Each shows:
  - the category in Inter Bold 0.9, `ink`;
  - the proof line in Inter Medium 0.8, `ink2`.
  - The plate is also the pad, and it opens the full skills list.
- **End marker:** flat `NOW` in Bricolage SDF 1.8, `ink`, at (0, −168). It sits on the trail tiles, so it is at y 0.10.

**Eko**

- **3D title** `EKO`: static, `ACCENT_INK.eko`, at (50, −138).
- **Milestone tiles:** five flush paper tiles, 7×7, at (52 + 6k, −110 − 6k) for k = 0..4. That puts them in a row along R. Each shows:
  - a number `01`–`05` in Bricolage SDF 2.4, `#5B4CF0` (5.25:1 on the plate);
  - a title in Inter Bold 0.8, `ink`.
- **Hero prop, a phone:**
  - Body: `roundedSlab` of a 4.4×8.8 front-view rounded rect, radius 0.5, extruded 0.5, upright and faceCamera, in `ink`.
  - Plinth: paper `RoundedBox(6, 0.8, 6, 3, 0.3)` at (80, −112). The phone stands on it.
  - Screen: a `3.9×8.2` plane, 0.01 in front of the face, showing `eko-phone.webp`.
  - Static collider.
- **Pad** `E  OPEN EKO`, 6×5, at phone + S·8. It opens a panel with the eeko.site link.

**Music** (centre C = (−64, −122))

- **3D title** `MUSIC`: static, `ACCENT_INK.music`, at (−80, −110).
- **Stage:** `RoundedBox(18 along R, 1, 8 along S, 3, 0.3)` in `ink`, faceCamera. Centre `stageC = C − S·5` = (−67.5, −125.5). Fixed collider.
- **Vinyl:** `Cylinder(3.2, 3.2, 0.3, 48)` in `ink`, lying on the stage top at `stageC + S·0.5`.
  - A label disc (r 1.1, `#D6457E`) sits on top.
  - It rotates about Y at 0.6 rad/s. It is static under reduced motion.
- **Speakers:** two `Box(2.4, 4.4, 2)` in `stone`, faceCamera, on the stage top at `stageC ± R·7 − S·1.5`.
- **EQ bars:** nine `Box(0.9, 1, 0.9)` scaled in y, in `#D6457E`, on the stage top at `stageC + R·(i − 4)·1.3 − S·3.3`.
  - When sound is on, `audio.getBands(9)` drives their heights.
  - Otherwise they hold static heights 1, 2, 3, 4, 3, 2, 3, 2, 1.
- **Record sleeves** (the four `musicPillars`):
  - Row centre `C + S·12 − R·2` = (−56.9, −112.1), spacing 6.5 along R. The sleeves stand 13 units in front of the stage front edge, so they never hide the stage in the gallery shot.
  - Each sleeve is an upright paper `RoundedBox(5, 5, 0.3, 2, 0.12)` with a 5×0.8 `#D6457E` strip along the top of its front face.
  - Title in Inter Bold 0.7, `ink`, maxWidth 4.4.
  - Pad, 6×4.4, at sleeve + S·5.

**About & Contact**

- **3D title** `ABOUT`: static, `ACCENT_INK.brand`, at (−64, −6).
- **Portrait board** at (−52, −4):
  - Frame `RoundedBox(5, 6.2, 0.3, 2, 0.14)` in paper, on two `ink` legs `Box(0.3, 1.2, 0.3)`.
  - `profile.webp` at 4.4×4.4 on the frame.
  - If `avatar.glb` exists, it replaces the board (§8.3).
- **Bio** (flat, on the plaza): `about.bioShort` (≤ 100 characters), Inter Medium 0.85, `ink`, maxWidth 16, lineHeight 1.35, at C + S·2 = (−54.6, 5.4). Maximum 3 lines; the full bio lives in the panel.
- **Contact pads:** flush plates 5×3.6, in a row along R centred at (−52, 12), spacing 6. Labels `EMAIL`, `GITHUB`, `LINKEDIN`, `CV`.
  - The `CV` pad is built only when `contactLinks` has a CV URL. There is none in the repo today, so v1 shows 3 pads.
  - On interact, call `commands.openUrl(url)` synchronously inside the input handler (§4.3).
  - URLs come from `content.contactLinks`. Fill them from `app/contact/page.tsx` and `app/components/SiteFooter.tsx`.

**Playground** (rect x −134..−78, z −78..−34)

- **3D title** `PLAY`: **dynamic** letters in `ink`, word centre (−90, −70).
- **Ramp:**
  - A wedge (custom prism `BufferGeometry`) 10 long (x) × 8 wide (z) × 2.4 high, centred at (−84, −40).
  - It rises toward −X: the low edge is at x −79 and the lip at x −89.
  - Colour `#F6C21C`, with three `ink` chevron strips pointing −X.
  - Collider: `ColliderDesc.convexHull` of its 6 vertices, via `addFixedConvexHull` (§4.4).
- **Ramp corridor** `RAMP_CORRIDOR`: x −145..−40, z −46..−34. It holds the run-up and the landing zone, and contains no props, scenery or tokens.
  - A boosted jump (48 u/s, 13.5° lip, gravity −24) flies about 52 units.
  - An unboosted jump (32 u/s) flies about 27.
- **Bowling lane** along z −56, continuing straight on from P3:
  - Lane strip: a flush `plaza` strip, 4×30, from x −86 to −116 (plates layer).
  - Ball: sphere r 1.3 in `ink`, mass 140, at (−90, −56).
  - Pins: 10 pins (`LatheGeometry`, 2.2 high, paper with a `#E2553F` band, cylinder collider r 0.42, mass 8) in a triangle. Apex at (−110, −56), pointing east; rows 1.3 apart toward −X; pins 1.5 apart along z.
- **Brick wall:** running bond, 6 bricks wide × 5 high, along R, centred at (−112, −70), front facing the camera.
  - Full bricks: `RoundedBox(2.0, 1.0, 1.0, 2, 0.06)` in paper, mass 25.
  - Odd rows: 5 full bricks plus a half brick `RoundedBox(1.0, 1.0, 1.0, 2, 0.06)` (mass 12.5) at each end.
  - 32 bodies in total.
- **Reset pad** `RESET`, 5×5, at (−84, −63). It resets the bricks, pins, ball and the `PLAY` letters, then calls `physics.snap` on each.

**Credits**

- **Sign:** paper `RoundedBox(7, 3.6, 0.3, 2, 0.14)` on two `ink` posts, at (0, −196). Text:
  - `CREDITS` in Inter Bold 0.9;
  - `three.js · Rapier · Kenney · Inter · Bricolage Grotesque` in Inter Medium 0.55.
- **Pad** on the deck at (0, −190), 6×5. It calls `commands.openMenu('credits')`.

### 2.5 Paths (Bruno-style stepping stones; no colliders)

| Path | From → To | Width (tiles) | Label (at d from `from`) |
|---|---|---|---|
| P1 | (0, −16) → (0, −43) | 2 | `CROSSROADS` (d 4); `START` (6 outside the hub edge) |
| P2 | (13, −56) → (152, −56) | 2 | `PROJECTS` (d 6) |
| P3 | (−13, −56) → (−78, −56) | 2 | `PLAYGROUND` (d 6) |
| P4 (timeline) | (0, −69) → (0, −176) | 3 | `JOURNEY · EKO · MUSIC` (d 6) |
| P5 | (−3, −120) → (−40, −120) | 2 | `MUSIC` (d 6) |
| P6 | (3, −120) → (40, −120) | 2 | `EKO` (d 6) |
| P7 | (−22, 4) → (−34, 4) | 2 | `ABOUT & CONTACT` (d 4) |

**Tiles**

- One `InstancedMesh` of `roundedSlab(1.6, 1.6, 0.08, r 0.4)` in `path`, from y 0 to 0.08, with `receiveShadow`.
- The first tile centre is at `from + t·1.1`, so a path's tiles never pass its endpoints. Tiles then step every 2.2 units.
- Lateral offset ±0.95 for 2-wide paths, or −1.9 / 0 / 1.9 for 3-wide.
- Variation:
  - alternating ±0.3 zigzag along the tangent;
  - position jitter ±0.15;
  - yaw jitter ±0.06 rad;
  - all seeded from `CONFIG.world.seed`.
- A tile's outer edge sits at ±1.75 from the centre line on 2-wide paths, and ±2.7 on 3-wide.

**Path labels**

- Inter Bold 1.0, letterSpacing 0.12, `ink`, on bare ground (10.05:1).
- They sit **beside** the path, never on the tiles.
- Offset = tile edge + 0.9: 2.65 for 2-wide paths and 3.6 for 3-wide. They go on the camera side, where `dot(normal, S) > 0`.
- Baseline along the tangent (§2.1).

**Flat layers** (layered to avoid z-fighting)

| Layer | y | polygonOffset (factor/units) | Other |
|---|---|---|---|
| Plazas | 0.015 | −1/−1 | — |
| Plates, pads, lane strip | 0.025 | −2/−2 | — |
| Ground text (on ground, plaza, plates) | 0.035 | −4/−4 | `depthWrite: false`, `renderOrder 2` |
| Path tiles | 0 → 0.08 (solid) | — | `receiveShadow` |
| Blob shadows; text on tiles (`NOW`) | 0.10 | blob −1/−4; text −4/−4 | blob `renderOrder 1`, text `renderOrder 2` |

### 2.6 Scenery scatter (`world3/Scenery.ts`)

**Sampling.** Seeded Bridson Poisson-disk sampling (`utils/math.ts`) inside the bounds, shrunk by 2, plus the decorative bands. A candidate is accepted only if it is:

- outside every area rect expanded by 4;
- more than (path half-width + 3) from every path segment;
- outside the lagoon, the jetty and `RAMP_CORRIDOR`;
- more than 4 from every token, 3D title footprint and pad;
- outside every ground-text sun-side strip (§1.2);
- and, for interior candidates only, inside a grove, where `valueNoise(x/45, z/45) > 0.15`.

**Zones**

| Zone | Allowed props |
|---|---|
| Interior (more than 22 from any bound) | Groves only (noise mask): trees, palms, bushes, boulders |
| Within 22 of the west bound | Edge forest: all props, no noise mask |
| Within 22 of the south or east bound | Bushes and boulders only (≤ 1.5 high), no noise mask. These bounds sit between the camera and the car. |
| Within 4 of the quay | Nothing |
| West band (outside bounds) | All props, no colliders |
| South and east bands (outside bounds) | Bushes and boulders only, no colliders |

**Source** (`CONFIG.scenery.source`, chosen at the gate; default `'kit'`):

- `'kit'`: Kenney Nature Kit (CC0).
  - Use 3 tree models, 2 bush models and 3 rock models, for example `tree_default`, `tree_oak`, `tree_fat`, `plant_bush`, `plant_bushLarge`, `rock_largeA`, `rock_largeB`, `rock_smallA`. Confirm the file names in the download.
  - Recolour through `Materials.ts` by mapping each source material name to a palette token: leaf names to `foliage`/`foliageDark`, wood/bark to `trunk`, stone/rock to `boulder`. The build fails on unknown names.
- `'procedural'` (fallback):
  - Round tree: trunk `Cylinder(0.28, 0.38, 2.4, 6)` in `trunk`, crown `Sphere(1.7, 16, 12)` at y 3.2.
  - Bush: `Sphere(1, 12, 8)` scaled (1.4, 0.9, 1.4).
  - Boulder: `Dodecahedron(1, 0)`, flatShading.

| Prop | Scale | Counts in bounds (high / medium & mobile / low) | Extra in bands | Collider (in bounds only) |
|---|---|---|---|---|
| Tree | 0.8–1.4 | 160 / 120 / 70 | +40 (west) | fixed cylinder r 0.45, h 3 |
| Palm (`palm.glb` via `buildInstances`, Lambert + original atlas) | height 7–9, lean ±8° | 60 / 45 / 25 | +15 (west) | cylinder r 0.5 |
| Bush (clusters of 2–3) | 1.0–1.6 | 220 / 160 / 80 | +80 (all bands) | none |
| Boulder (≤ 1.5 high) | (1.2–2.2, 0.8–1.4, 1.2–2.0) | 40 / 30 / 20 | +20 (all bands) | fixed cuboid from bbox |

- Minimum Poisson radius: 6 for trees and palms, 3.5 for bushes.
- Reduce counts at runtime through `InstancedMesh.count`.
- **Every scenery material uses `lambert(…, { occluder: true })`**, so a prop between the camera and the car dithers out (§1.3).
- **Not ported:** the grass shader, the market, the lanterns, the houses, `rock.glb` (a flat path stone) and `crate.glb` (a leather bag).

### 2.7 Discovery

1. **Spawn:** the car faces north toward P1. The hero word sits directly above it on screen, and the `CROSSROADS` label at the start of P1 names where the path goes.
2. **Signposts instead of distance rules:**
   - Every spoke has a destination label where it leaves the hub, and P5/P6 have labels where they leave the trail.
   - The `M` map is always one key away.
   - Areas are not all visible from each other, and the spec does not claim they are.
3. **First visit to an area:**
   - an HTML toast, for example `Projects · 4 projects`;
   - an aria-live announcement;
   - a tick for that area in the map.
4. **Travel** (map) teleports to the arrival point, calls `physics.snap`, re-runs area detection at once and marks the area visited.
5. **Eight Yoruba-word tokens** are hand-placed as small detours off the paths, at:
   - (16, −30), (−30, −26), (90, −40), (160, −80)
   - (−30, −150), (30, −152), (−140, −60), (−20, 30)
   - All are outside every area rect and `RAMP_CORRIDOR`.
6. **The `M` map** lists all 9 areas, each with a visited tick and a Travel button.

---

## 3. Text

### 3.1 Three tiers

| Tier | What | Technique | Why it's crisp |
|---|---|---|---|
| A. Hero and area titles | `JAZZ`, `PROJECTS`, `EKO`, `MUSIC`, `JOURNEY`, `ABOUT`, `PLAY` | `TextGeometry` + `FontLoader` (three/addons), Bricolage ExtraBold typeface JSON, Lambert, cast and receive shadows | Real geometry; MSAA or a high DPR; no textures |
| B. Readable copy in the world | role line, path labels, board title / pitch / tags, numerals, plate text, pad labels, coin words | `troika-three-text` `Text` (SDF), `MeshBasicMaterial({ fog: true })`; ground text adds `depthWrite: false` | Distance-field edges at any distance; never billboarded; fixed camera azimuth |
| C. Anything read for more than about 1 s | prompts, panels, map, menu, toasts, glossary, credits, failure cards | HTML/CSS with Inter via `next/font` | Browser-hinted text; accessible |

Tier rules:

- No `THREE.Sprite`, no canvas textures for text, no billboarding. `utils/labels.ts` is not ported.
- Every piece of in-world copy smaller than 1.0 world unit is decorative or also exists in HTML.
- Text created with `desktopOnly: true` is hidden on touch devices and on portrait screens (`aspect < 1`).
- On phones, board and plate copy is decorative; the panels carry the real content.

### 3.2 Fonts, files and licences

**Bricolage Grotesque** (Mathieu Triay, OFL 1.1)

- Source: `github.com/google/fonts/tree/main/ofl/bricolagegrotesque`, file `BricolageGrotesque[opsz,wdth,wght].ttf`.
- Verified: axes opsz 12–96, wdth 75–100, wght 200–800; GPOS present.
- Glyph coverage: it has ẹ ọ Ẹ Ọ È Ó and the combining marks U+0300, U+0301 and U+0323. It **lacks precomposed ṣ (U+1E63)**, so use it only for ASCII and Latin-1 display text.

**Inter** (Rasmus Andersson, OFL 1.1)

- Source: `github.com/google/fonts/tree/main/ofl/inter`, file `Inter[opsz,wght].ttf`.
- Verified: covers ẹ ọ ṣ Ẹ Ọ Ṣ and the combining marks. All Yoruba text uses Inter.

**Source files.** Commit both variable TTFs and their `OFL.txt` files under `scripts/fonts/src/`, so builds are reproducible.

**Build script** `scripts/fonts/build-fonts.mjs` (run with `node scripts/fonts/build-fonts.mjs`; devDependencies `subset-font@2.9.0` and `opentype.js@2.0.0`). It instances the variable fonts and subsets them with HarfBuzz. It outputs **WOFF**, because troika does not read woff2.

```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import subsetFont from 'subset-font';
import { parse } from 'opentype.js';
import { toTypefaceJSON } from './typeface.mjs';

const RANGES = [[0x20,0x7E],[0xA0,0xFF],[0x300,0x304],[0x306,0x308],[0x30A,0x30C],[0x323,0x323],
  [0x1E62,0x1E63],[0x1EA0,0x1EF9],[0x2013,0x2014],[0x2018,0x201E],[0x2022,0x2022],[0x2026,0x2026],
  [0x2190,0x2193],[0x2197,0x2197],[0x20A6,0x20A6]];
const TEXT = RANGES.flatMap(([a,b]) => Array.from({length:b-a+1}, (_,i) => String.fromCodePoint(a+i))).join('');
const keepFeatures = ['kern','mark','mkmk','ccmp','locl','liga','calt'];
const CHARSET_3D = "ABCDEFGHIJKLMNOPQRSTUVWXYZÈÓ0123456789&·!?-'";
const JOBS = [
  ['Inter[opsz,wght].ttf', { wght: 700, opsz: 32 }, 'Inter-Bold'],
  ['Inter[opsz,wght].ttf', { wght: 600, opsz: 32 }, 'Inter-SemiBold'],
  ['Inter[opsz,wght].ttf', { wght: 500, opsz: 14 }, 'Inter-Medium'],
  ['BricolageGrotesque[opsz,wdth,wght].ttf', { wght: 800, opsz: 96, wdth: 100 }, 'BricolageGrotesque-ExtraBold'],
];
await mkdir('public/fonts', { recursive: true });
for (const [file, variationAxes, out] of JOBS) {
  const src = await readFile(`scripts/fonts/src/${file}`);
  await writeFile(`public/fonts/${out}.woff`, await subsetFont(src, TEXT, { variationAxes, keepFeatures, targetFormat: 'woff' }));
  if (out.startsWith('Bricolage')) {
    const sfnt = await subsetFont(src, CHARSET_3D, { variationAxes, keepFeatures, targetFormat: 'sfnt' });
    const font = parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength));
    await writeFile(`public/fonts/${out}.typeface.json`,
      JSON.stringify(toTypefaceJSON(font, CHARSET_3D, { reverse: process.argv.includes('--reverse') })));
  }
}
```

**`scripts/fonts/typeface.mjs`** is a port of facetype.js's `convert()` (MIT licence) to Node and opentype.js 2.0:

- Use `scale = 1000 / unitsPerEm` with `resolution: 1000`, so that `size` equals 1 em. Do not use facetype's `100000/(upm·72)` factor.
- Per glyph, emit `ha`, `x_min`, `x_max` and an outline `o` made of `m`, `l`, `q` and `b` commands. Write `q` and `b` **with the end point first, then the control point(s)**, which is the order three's `Font` expects.
- `--reverse` reverses the command order of each contour. Use it only if the counters of A or O fill in.
- Also write `familyName`, `ascender`, `descender`, `underlinePosition`, `underlineThickness`, `boundingBox` and `original_font_information`.
- Do **not** use three's `TTFLoader`: in r186 it imports opentype.js from jsDelivr, which breaks Turbopack and any CSP.

**Coverage test** `world3/fonts.test.ts` (vitest):

- Parse each woff with opentype.js.
- Assert that every code point of every string in `content/world.ts` (NFC-normalised) is in the right font's cmap. Yoruba strings are checked against Inter only.

**Licences:**

- Copy both `OFL.txt` files to `public/fonts/OFL-BricolageGrotesque.txt` and `public/fonts/OFL-Inter.txt`.
- Check each `OFL.txt` for a Reserved Font Name before shipping subsets under the original name.

**DOM fonts:** a new `app/field/layout.tsx` uses `next/font/google`:

- `Inter({ subsets: ['latin','latin-ext','vietnamese'], variable: '--font-inter', display: 'swap' })`
- `Bricolage_Grotesque({ subsets: ['latin','latin-ext','vietnamese'], variable: '--font-bricolage', display: 'swap' })`

Both are present in Next's font data. Apply the variables on a wrapper `div`. This layout does not affect v2.

**troika setup** (in `utils/text.ts`, before any `Text` is created):

```ts
configureTextBuilder({ defaultFontURL: '/fonts/Inter-SemiBold.woff', sdfGlyphSize: 64, useWorker: true })
```

- `defaultFontURL` must be set, or troika fetches Roboto from a CDN.
- During loading, call `preloadFont({ font, characters })` for each of the 4 woffs. `characters` is every string in `content/world.ts`, NFC-normalised.

### 3.3 Type scale (world units)

"px" means the cap height on a 1000-CSS-px-tall landscape viewport at the default camera:

- 49 px per unit perpendicular to the view;
- 40 px per unit on upright faces;
- 29 px per unit flat on the ground.

The gallery shot gives 52 px per unit on upright faces. Phones in portrait get roughly 0.6× these values, which is why copy there is decorative.

| Use | Font | Size | Colour | Orientation | px |
|---|---|---|---|---|---|
| Hero word | Bricolage 800 3D, depth 1.2, curveSegments 12 | cap 4.0 | `ink` | upright | 160 |
| Area title | Bricolage 800 3D, depth 0.6, curveSegments 8 | cap 2.4 | `ACCENT_INK[area]` | upright | 96 |
| Role line, area subtitle | Inter Bold SDF, letterSpacing 0.1 | 1.1 | `ink` | flat | 23 |
| Path label | Inter Bold SDF, letterSpacing 0.12 | 1.0 | `ink` | flat, along path | 21 |
| Pad label, floor caption | Inter Bold SDF | 0.9 | `ink` | flat | 19 |
| Floor detail (desktopOnly, on a plate) | Inter SemiBold SDF | 0.8 (minimum flat size) | `ink2` | flat | 17 |
| Numerals and years | Bricolage 800 SDF | 1.5–2.4 | accent / `ACCENT_INK` on paper | flat | 31–51 |
| Board title | Inter Bold SDF, auto-fit 0.85 → minimum 0.7 at maxWidth 9.6 | 0.85 | `ink` | upright | 25 (gallery 32) |
| Board pitch | Inter Medium SDF, 1 line, `boardPitch` (≤ 32 characters) | 0.5 | `ink2` | upright | 15 (gallery 19) |
| Board tags | Inter SemiBold, uppercase, letterSpacing 0.08 | 0.42 | `ink2` | upright | 12 (gallery 16) |
| Sleeve title | Inter Bold | 0.7 | `ink` | upright | 20 |
| Coin word | Inter Bold | 0.42 | `ink` | upright | decorative |

**3D text geometry** (`utils/text3d.ts`)

- `size = cap / capRatio`. `capRatio` = height of the 'H' glyph's bbox / `resolution`, measured from the JSON (about 0.70 with the 1-em scale above).
- `curveSegments`: 12 for the hero word, 8 for titles.
- `bevelEnabled true`, `bevelThickness 0.06`, `bevelSize 0.05`, `bevelSegments 2`. Tracking 0.06 em.
- Build one geometry per distinct letter and reuse it for repeated letters.
- **Keep the baseline.** Translate each letter geometry so its bbox is centred in X and Z only. y = 0 stays the baseline. Do **not** call `geometry.center()`; it misaligns J, Q and accented letters.
- **Collider:** a cuboid sized from the letter's bbox, offset by the bbox centre's y (`ColliderDesc.cuboid(...).setTranslation(0, cy, 0)`). The rigid body's origin stays at the letter's baseline position.

**Dynamic letters** (hero word and `PLAY`):

- `mass 80` (the car is 900), `friction 0.6`, `restitution 0.1`, `linearDamping 0.3`, `angularDamping 0.4`.
- **Auto-reset** (hero word only): letters return to their layout poses and are snapped when the car is more than 60 units away, and after Travel or `R`.

Other titles get fixed cuboid colliders.

### 3.4 Crispness checklist (each item is an acceptance test)

1. DPR equals the render profile's cap (§9.1) and is never below `min(devicePixelRatio, 2)`. The cap never changes during a session. When the window moves to another screen, the buffer follows the new device DPR up to the same cap.
2. The canvas buffer is exactly device pixels:
   - Use a `ResizeObserver` with `{ box: 'device-pixel-content-box' }`.
   - Buffer size = `min(devicePixelContentBoxSize, round(cssSize × dprCap))`.
   - Safari has no `device-pixel-content-box`. There, fall back to `round(contentRect × min(dpr, dprCap))`.
   - Apply with `renderer.setPixelRatio(1)` and `renderer.setSize(bufW, bufH, false)`.
   - Re-measure on `matchMedia('(resolution: Xdppx)')` change.
3. `antialias` comes from the profile. No composer, no FXAA/SMAA, no bloom, no tone mapping, no vignette, no DOF, no CSS transform or scale on the canvas.
4. No `backdrop-filter` anywhere in the v3 CSS. No text-shadow, no glows.
5. Text never billboards.
   - All troika materials use `fog: true`, matching their surface.
   - Ground text sits at y 0.035, and text on tiles at 0.10, both with polygonOffset (§2.5).
   - No ground text is ever covered by a tile.
6. Physics transforms are interpolated (§4.4), so there is no 60-on-120 Hz judder.
7. HTML:
   - whole-pixel font sizes;
   - centre with flex rows, not `left: 50%` + `translateX(−50%)`;
   - animate only opacity and integer `translateY`, and end at `transform: none`.
8. All copy is NFC-normalised. Yoruba strings are never set in Bricolage.

---

## 4. Camera and vehicle

### 4.1 Camera (`world3/Camera.ts`)

- `PerspectiveCamera(fov, aspect, near 1, far 400)`. FOV is 30, or 42 when `aspect < 1`.
- Offset = `d × (cos(el)·sin(yaw), sin(el), cos(el)·cos(yaw))`, with `yaw = π/4`. Then `lookAt(focus)`.
- `d = base·zoom + pullback`:
  - `zoom ∈ [0.74, 1.47]`, changed by the wheel (0.0005 per deltaY unit, multiplicative) and by pinch, eased with λ 8.
  - `pullback = 6·(base/38)·clamp(speed/32, 0, 1)`, eased with λ 2.

| Shot | Elevation | Landscape base distance | Notes |
|---|---|---|---|
| `default` | 36° | 38 | — |
| `gallery` | 26° | 32 | Focus shifted by −S·4, so boards sit centre-frame and the car sits low in frame |
| `intro` | 44° | 64 | Tweens to `default` over 1.6 s (power3.inOut) after Start |

- **Portrait** (`aspect < 1`):
  - FOV 42 and elevation +4° on every shot.
  - `base = max(shotBase, 22 / (2·tan(21°)·aspect))`, which is about 62 at 390×844. This keeps 22 units visible across the screen at the focus.
- **Shot change:** gsap, 1.2 s, power2.inOut, on camera-zone enter and exit. Under reduced motion it is an instant cut.
- **Follow:**
  - `lead = vel·0.3 + S·max(0, dot(v̂, S))·6·clamp(speed/12, 0, 1)`. The second term adds extra look-ahead when driving toward the camera (east or south).
  - `lead = clampLen(lead, min(10, 0.25·W))`, where `W = 2·d·tan(fov/2)·aspect` is the visible width at the focus.
  - `focus = damp(focus, carInterpPos + lead, λ 6)`.
  - `focus.y = 0`, so there is no vertical bob.
- **Drag to pan:**
  - Pointer drag on the canvas only, raycast against the plane y = 0.
  - Pan offset clamped to 24.
  - The offset eases back with λ 1.5 after 1.2 s idle, or as soon as car speed is above 4.
  - Cursor `grab` / `grabbing`.
- No orbit, no roll, no shake.
- Keep `flyTo` (gsap) for travel cuts.
- **Shared state:** expose `cameraState { fov, aspect, elevation, base, zoom, d, focus }` for Environment, which uses it for the shadow-box refit and the fog distances.

### 4.2 Vehicle (`world3/Vehicle.ts`)

Keep:

- the Kenney `car.glb` (`body` plus 4 `wheel-*` nodes; it faces +Z);
- the Rapier `DynamicRayCastVehicleController` and its suspension, grip and drift tuning.

Fix:

1. **Forward axis.** Right after `world.createVehicleController(body)`, set `controller.setIndexForwardAxis = 2`.
   - It is a setter *property*; assigning `indexForwardAxis` does nothing.
   - Without it, `currentVehicleSpeed()` measures along X and is never negative for this +Z car. Tested: chassis velocity z = −10 gives +10 by default, and −10 with axis 2.
2. **Model rotation.** Delete `model.rotation.y = Math.PI`. The GLB already faces +Z.
3. **Wheels:** `rotation.order = 'YXZ'`, and spin with `+= speed / wheelRadius × dt`, where `speed` is now signed.
4. **Brakes:**
   - `throttle < 0 && speed > 1` → brake.
   - `throttle > 0 && speed < −1` → brake.
   - Otherwise the throttle drives the car forward or in reverse.
5. **Control timing:** `control(h, input)` runs **per fixed substep** and calls `updateVehicle(h)` (§4.4).
6. **Delete `addNeon()`:** the underglow plane and both point lights.
7. **No real shadow:** `castShadow = false` on every car mesh; add the blob (§1.5).
8. **Brake and reverse lights:**
   - Two `Box(0.28, 0.14, 0.05)` at the rear in model space, each on an `ink` backing `Box(0.4, 0.24, 0.04)`.
   - The light is `basic(#FF3B30)` while braking, `basic(#FFF6D8)` while reversing (`speed < −0.5 && throttle < 0`), and hidden otherwise.
9. **Auto-flip:** if the car's up vector has y < 0.3 for 1.5 s, set the rotation to yaw only, lift the car by 1.5, zero the angular velocity and call `physics.snap`.
10. **R** respawns at the arrival point of the nearest area, by rect distance, then calls `physics.snap`.
11. **Config:** `maxSpeed 32`, `boostMultiplier 1.5`, `paint: 'brand' | 'danfo'` (gate; default `'brand'`). Everything else is unchanged; gravity stays −24.

**Repaint the palette** (the car material becomes Lambert):

- The car UV-maps into Kenney's 512² colormap, a grid of 8 × 4 cells, each 64×128 px.
- Cell usage, verified from the UVs:

| Mesh | Cells (col, row) | Current colour |
|---|---|---|
| body | (7,1) | blue paint |
| body | (3,2) | dark trim |
| body | (6,2), (0,3) | white lights |
| wheels | (2,2) | tyre |
| wheels | (3,2) | dark |
| wheels | (4,1) | yellow rim |

Repaint at runtime in `Assets.ts`:

```ts
const c = document.createElement('canvas'); c.width = c.height = 512;
const g = c.getContext('2d')!; g.drawImage(colormapImage, 0, 0);
const fill = (col: number, row: number, hex: string) => { g.fillStyle = hex; g.fillRect(col*64, row*128, 64, 128); };
const body = CONFIG.vehicle.paint === 'danfo' ? '#F6C21C' : '#E2553F';
fill(7,1,body); fill(3,2,'#24222B'); fill(2,2,'#2E2C35'); fill(4,1,'#F6C21C'); fill(6,2,'#FFF6D8'); fill(0,3,'#FFF6D8');
const tex = new THREE.CanvasTexture(c); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
// body + wheels: new MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }), castShadow false
```

- The red body measures 2.5:1 against the lit ground. The yellow `danfo` option measures 1.12:1, so if the owner picks it, raise the blob opacity to 0.45.

### 4.3 Controls (`world3/Controls.ts`)

| Input | Action |
|---|---|
| `KeyW/A/S/D`, `ArrowUp/Left/Down/Right` (by `e.code`) | drive |
| `ShiftLeft`/`ShiftRight` (by `e.code`) | boost |
| `Space` (by `e.code`) | brake / drift |
| `e`, `Enter` (by `e.key`) | interact |
| `r` (by `e.key`) | respawn |
| `m` (by `e.key`) | map |
| `n` (by `e.key`) | mute |
| `p` (by `e.key`) | photo mode |
| `Escape` | menu, or close the topmost panel/map |

- **Movement uses `e.code`**, so the physical WASD positions work on AZERTY and other layouts.
- **Mnemonic shortcuts use `e.key`** (lower-cased), so `M` means the key labelled M.
- **Ignore keys when focus is in a form control:** if `document.activeElement` is a `button`, `input`, `textarea`, `select` or `[contenteditable]`, the key is ignored, except `Escape`. This stops Enter and Space firing twice.
- Call `preventDefault` for Space and the arrow keys only while the canvas has focus. Ignore `e.repeat` for interact.
- **Interact runs synchronously in the keydown or click handler:**
  - `Areas` keeps the active interactable updated every tick.
  - The handler calls `experience.interact()`.
  - That can call `commands.openUrl(url)`, which runs `window.open(url, '_blank', 'noopener')`, or `location.href = url` for `mailto:`.
  - It must never be deferred to the render loop, or Safari blocks the popup.
- Delete `H`/`?`. Keep clearing input on blur and on visibility change.

### 4.4 Physics interpolation (`world3/Physics.ts`)

```ts
step(dt: number, beforeEachStep: (h: number) => void): number // returns alpha in [0, 1)
link(body: RAPIER.RigidBody, obj: THREE.Object3D): void        // registry of prev/curr pos+quat
interpolate(alpha: number): void   // obj.position.lerpVectors(prev,curr,α); obj.quaternion.slerpQuaternions(prev,curr,α)
snap(body: RAPIER.RigidBody): void // prev = curr; after teleport/respawn/reset/auto-flip/travel
addFixedCuboid(halfExtents, pos, quat?, offset?), addFixedCylinder(halfH, r, pos),
addFixedConvexHull(points, pos, quat) // if ColliderDesc.convexHull returns null, falls back to a bbox cuboid and logs a warning
addGroundSlab(), addWall(...)
onImpact(cb: (kind: ImpactKind, force: number) => void): () => void
```

- **Each substep:**
  1. run `beforeEachStep(h)` (vehicle control);
  2. snapshot `prev`;
  3. call `world.step(eventQueue)`;
  4. store `curr`;
  5. drain contact-force events.
- **Accumulator:**
  - `fixedStep 1/60`, at most `maxSubSteps 4` per frame.
  - If `acc ≥ h` remains after the last allowed substep, drop the remainder (`acc %= h`), so alpha stays in [0, 1).
- **Linking:** every dynamic body is linked: car, letters, bricks, pins, ball.
- **Contact forces (P1, used for impact sounds):** dynamic props get `ActiveEvents.CONTACT_FORCE_EVENTS` with `setContactForceEventThreshold(mass × 40)`, so resting bodies do not flood the queue.

---

## 5. Portfolio presentation in-world

### 5.1 Project board (`world3/areas/Projects.ts`)

- **Legs:** 2 × `Box(0.35, 2.0, 0.35)` in `ink`, at local x ±3.6.
- **Frame:**
  - `RoundedBoxGeometry(10.8, 8.4, 0.35, 4, 0.17)` in `paper`, bottom at y 2.0.
  - Casts and receives shadows.
  - One static collider covers the frame and legs.
- **Image:**
  - `PlaneGeometry(10, 5.625)` at the top of the frame (0.4 margin), z +0.18.
  - `MeshBasicMaterial({ map, fog: true })`.
  - Texture: sRGB, mipmaps on, `anisotropy = min(8, maxAnisotropy)`.
  - **Lazy load:** start loading after Start, once the board is within 120 units of the focus.
  - Until then, show the placeholder colour `#E9DCCB`, then fade the image in over 0.6 s.
- **Text strip** below the image: title, `boardPitch` and tags (§3.3), left-aligned at local x −4.8.
- **Pad:** see §5.3.

### 5.2 Other presentations

| Content | Form | Where |
|---|---|---|
| Eko milestones (5) | Flush numbered tiles in a row (01–05) plus the phone prop | Eko |
| Journey stops (6) | Flush plates along the timeline trail (year + title) | Journey |
| Skills (3) | Flush category plates (category + proof) | West side of Journey |
| Music pillars (4) | Upright record sleeves, plus the stage, vinyl and EQ | Music |
| About / Contact | Portrait board or avatar, bio lines, 3–4 contact pads | About |
| Yoruba words (8) | Upright coins with a short wobble | §2.7 positions |

**Coins**

- Build: `Cylinder(1.1, 1.1, 0.28, 40)` with `geometry.rotateX(π/2)` so its axis points along local Z, then faceCamera.
- Paper face with a `#F6C21C` rim. The word is in Inter Bold 0.42 at local z +0.15.
- Animation: bob 0.3 at 1.2 Hz, plus a yaw wobble of ±20°. It never spins fully, so the word stays readable.
- Pickup radius 2.8:
  - show a toast `Ọ̀rẹ́ — Friend · 3 of 8 words`;
  - add the word to the glossary.

### 5.3 Interaction language (one consistent system)

Shared builders live in `world3/ui3d/Pad.ts` (Step 0).

- **Pad:** a faceCamera rounded-rect outline, line width 0.22, on the plates layer.
  - Idle: `ink` at opacity 0.35.
  - Active: the car centre is inside the rect, tested in the pad's local frame. The outline turns `ACCENT[area]` at opacity 1 and width 0.32, and a `paper` fill appears at opacity 0.55.
- **Keycap** (desktop only):
  - Paper `RoundedBox(1.4, 1.4, 0.5, 2, 0.2)` with an `ink` troika "E".
  - It rises from y 0 to 2.2 with gsap `back.out(3)` in 0.35 s, and drops with `back.in(2)` in 0.25 s.
  - On interact it punches down to y 1.6 in 0.05 s, then recovers with `back.out(2)`.
- **HTML prompt card** (always shown; it is the accessible version): `E  Clay Studio Creations — Open project`. On touch, the "E" is a button whose click handler calls `interact()` synchronously.
- **Results:**
  - Projects, Eko, Music, Journey and Skills open a content panel.
  - Contact pads call `openUrl`.
  - Reset runs `resetPlayground`.
  - Credits runs `openMenu('credits')`.
- No halo rings, no beat-pulsing emissives.

---

## 6. UI / HUD cleanup

### 6.1 Tokens (`app/field/v3/world.css`)

```css
--w-bg:#F3DCC0; --w-paper:#FFFDF8; --w-ink:#24222B; --w-ink-2:#45414C; --w-line:rgba(36,34,43,.10);
--w-chip:#F1EAE0; --w-focus:#2F6FED; --w-brand:#E2553F;
--w-r-s:8px; --w-r-m:12px; --w-r-l:16px;
--w-shadow:0 1px 2px rgba(36,34,43,.06), 0 8px 24px rgba(36,34,43,.10);
--w-font:var(--font-inter), system-ui, sans-serif; --w-display:var(--font-bricolage), var(--w-font);
```

Type scale:

| Style | Spec |
|---|---|
| Kicker | 12/16, 600, uppercase, letter-spacing .08em |
| Small | 14/20 |
| Body | 16/24 |
| H3 | 20/28, 600 |
| Panel title | 28/34, Bricolage 800 |
| Start title | 40/44, Bricolage 800 |

General rules:

- 8 px spacing grid, only the 3 radii above.
- No gradients on controls, no glows, no `backdrop-filter`, no emoji or unicode glyph icons.
- Icons: `react-icons/lu` at 20 px — LuMap, LuVolume2, LuVolumeX, LuMenu, LuX, LuArrowUpRight, LuCheck, LuCamera, LuRotateCcw, LuZap. All of these exist in react-icons 5.6.0.
- Focus ring: 2 px `--w-focus`, offset 2.
- Contrast: `--w-ink-2` measures 9.8:1 on paper and 7.5:1 on `--w-bg`. Chip text `#3A3741` on `--w-chip` measures 9.8:1.

### 6.2 Screens

**Loader** (HTML, background `--w-bg`, centred):

- Wordmark `JAZZ`, Bricolage 800 56 px, `ink`.
- Progress bar 200×4, radius 2, track `rgba(36,34,43,.12)`, fill `ink`.
- Label 13 px, 500, `ink2`: "Loading fonts", then "Loading models", then "Building the world". No percentage.
- Progress weights: fonts and troika preload 0.15, assets 0.55, world build 0.25, warm-up render 0.05. Progress only ever increases.
- When done, fade the canvas from opacity 0 to 1 over 400 ms.
- **Timeout:** if the world is not ready after 15 s, show a card: "This is taking longer than usual", with the buttons **Keep waiting** and **Classic site** (`/`). Loading continues in the background.

**Failure cards** (paper card, same style as the start card):

- `webglFailed` (no WebGL2): "Your browser can't show the 3D world", with buttons **Classic site** and **View projects** (`/projects`).
- `webglcontextlost`:
  - call `preventDefault()` and stop the loop;
  - show "Graphics were reset", with buttons **Reload** and **Classic site**;
  - on `webglcontextrestored`, call `location.reload()`.
- A required asset fails (a font, `car.glb`, or the Rapier init): retry once, then show "Something didn't load", with buttons **Reload** and **Classic site**.
- Optional assets (avatar, Nature Kit, impact sounds, board images) degrade silently to their fallbacks.

**Start card** (paper, radius 16, `--w-shadow`, width `min(480px, 100vw − 32px)`, over the live world):

- Kicker `INTERACTIVE PORTFOLIO`.
- Title "Drive through my work".
- Sub, 16/24 `ink2`: "A small world of the projects, products and music I've built. Drive up to anything to open it."
- Primary button `Start`: ink background, paper text, 48 px tall, radius 12, padding 0 24.
- Text link "Skip to classic portfolio" → `/`. It is the first focusable element.
- Kbd chip row: `WASD Drive · Shift Boost · Space Brake · E Open · M Map`. On touch: "Left pad to drive · tap E to open".
- Start enables sound and saves the choice in localStorage (wrapped in try/catch).

**HUD** (`world3/ui/Hud.tsx`):

- **Top-left:** the wordmark `JAZZ` (Bricolage 800 20 px) and an area chip (paper, 13 px 600, with an 8 px accent dot).
- **Top-right, always visible:**
  - a **Classic site** text button (40 px tall, paper, radius 12, 1 px `--w-line`, LuArrowUpRight) → `/`. At ≤ 640 px it collapses to a 40×40 LuArrowUpRight with `aria-label="Classic site"`.
  - Map, Sound and Menu icon buttons: 40×40, paper, radius 12, 1 px `--w-line`.
- **Bottom-centre prompt card:**
  - full-width flex row, paper, radius 12, padding 10/14;
  - a 28×28 kbd chip (ink background, paper "E");
  - title 15/20 600, sub 13/18 `ink2`.
- Toasts at the top centre, for 3 s.
- A controls hint at the bottom left for the first 20 s (desktop only).
- **Removed:** speedometer, collectible counter pill, always-on minimap.

**Content panel** (`world3/ui/Panels.tsx`):

- Desktop: a right-hand sheet, width 440, inset 12 px, height `100dvh − 24px`, no scrim.
- Mobile (≤ 640 px): a bottom sheet, max-height 78dvh, scrim `rgba(36,34,43,.25)`.
- Contents:
  - 16:9 image, radius 10;
  - kicker in `ACCENT_INK`;
  - title in Bricolage;
  - body 16/24;
  - tags as chips (`--w-chip` background, `#3A3741` text, 13 px);
  - links as primary ink buttons with LuArrowUpRight.
- Close with LuX, Esc, or a click on the scrim. Focus is trapped inside and returned to the canvas on close.

**Map modal** (`world3/ui/MapModal.tsx`; replaces `Minimap.tsx`):

- Card size `min(880, 100vw − 32) × min(620, 100dvh − 32)`, paper, radius 16.
- A vector canvas, sized by `ResizeObserver` at the uncapped `devicePixelRatio`.
- The north-up drawing is rotated with `ctx.rotate(+π/4)`, so north-west (screen-up in the world) points up. This matches the fixed camera.
- What it draws:
  - lagoon `#8EDAD1`;
  - paths as 4 px `#FBEDDC` lines with a 1 px `--w-line` stroke;
  - area rects filled with their accent at 18%, with a 2 px accent stroke;
  - unrotated labels in Inter 600 13 px;
  - a player arrow in ink, 14 px, updated from `store.live` via rAF.
- **Side list** (stacked below the map on mobile): one button for each of the **9 areas**, showing its name, a visited LuCheck and "Travel".
- Toggle with `M`; close with Esc.

**Menu** (Esc):

- Tabs:
  - Settings: Quality (Auto / High / Medium / Low; this affects shadows and scenery only), Sound, Reduced motion, Adaptive quality.
  - Controls.
  - Words: the glossary, with word, meaning and pronunciation if present.
  - Contact: email, GitHub, LinkedIn, and the CV link when it exists.
  - Credits.
- Opened programmatically with `openMenu(tab)`.
- No Rain, no Time of day. Fast travel lives in the map.

**Touch:**

- Joystick: base 120 px, paper at 0.6 opacity, 2 px border `rgba(36,34,43,.2)`; knob 52 px in ink.
- Right side: Boost (LuZap) and Brake buttons, 56 px.
- The "E" button appears only when a pad is in range.

**No-JS and SEO** (`app/field/page.tsx` + `app/field/FieldSummary.tsx`, a server component):

- Server-render an accessible summary:
  - an `h1` ("Jazz — Frontend developer & product lead");
  - one paragraph;
  - the projects (name, one line, link);
  - Eko and Music (one line each);
  - contact links;
  - a link to the classic site.
- With JavaScript off, it is visible (a `<noscript><style>` rule reveals it).
- While the world runs, it is visually hidden but stays in the accessibility tree (`.sr-only`). Its content duplicates the panels.
- Set the metadata title (§1.1) and a description.

---

## 7. Post-processing

- **Nothing to remove in v3; it is never added.** Wave 3 deletes v2's `Postprocess.ts` and `n8ao.d.ts`, and removes `n8ao` and `postprocessing` from `package.json`.
- Render with `renderer.render(scene, camera)`, using the profile's DPR and `antialias`.
- Photo mode stays: render one frame, then call `toDataURL` in the same tick.
- Do not add tilt-shift, DOF or blur. Bruno's current site uses some of these on desktop; we deliberately do not, because the owner's complaint is blur.
- If a glow is ever wanted later, the only acceptable form is bloom with threshold ≥ 1.0 and intensity ≤ 0.3, on HDR emissives that never sit behind text.

---

## 8. Assets

### 8.1 Download / add

| Asset | Source | Licence | Output |
|---|---|---|---|
| Bricolage Grotesque variable TTF | github.com/google/fonts `ofl/bricolagegrotesque` | OFL 1.1 | `scripts/fonts/src/`; built: `public/fonts/BricolageGrotesque-ExtraBold.woff`, `.typeface.json`, `OFL-BricolageGrotesque.txt` |
| Inter variable TTF | github.com/google/fonts `ofl/inter` | OFL 1.1 | `scripts/fonts/src/`; built: `public/fonts/Inter-{Bold,SemiBold,Medium}.woff`, `OFL-Inter.txt` |
| `troika-three-text@0.52.5` (resolves `troika-three-utils@0.52.5`) | npm | MIT | Dependency, plus an ambient `world3/troika.d.ts` |
| `subset-font@2.9.0`, `opentype.js@2.0.0` | npm | MIT | devDependencies (font build) |
| `sharp@0.34.5` | npm | Apache-2.0 | Explicit devDependency (today it is only installed through Next) |
| `vitest@5.0.3` | npm | MIT | devDependency, plus a `"test": "vitest run"` script |
| Kenney Nature Kit (subset, §2.6) | kenney.nl/assets/nature-kit | CC0 | `public/assets/models/nature/*.glb` (≤ 250 KB total) |
| Kenney "Impact Sounds" (P1) | kenney.nl/assets/impact-sounds | CC0 | `public/assets/audio/impact_{soft,wood,heavy}.ogg` for letters, bricks, pins, ball |
| detect-gpu benchmarks | `node_modules/detect-gpu/dist/benchmarks/*.json` (16 files, 712 KB; only one is fetched) | MIT | `public/detect-gpu/` |

**Board images:** `scripts/boards/build-boards.mjs` uses `sharp`. Each image is resized to 1600×900 with `fit: 'cover'`, saved as WebP quality 82 into `public/assets/boards/`:

- `clay.webp` ← `claystudiocreations.jpg`
- `caferiddim.webp` ← `caferridim.png`
- `mara.webp` ← `mara.png`
- `sphiderass.webp` ← `cRf6OhI78D9fHIZyhDlqODIP0.webp`
- `eko.webp` ← `eekoo.png`
- `profile.webp`: 800×800 ← `profile.png` (1254², 1.67 MB today)
- `eko-phone.webp`, 720×1500:
  - It **cannot** be cropped from the landscape `eekoo.png` (1666×944) without a blurry upscale.
  - Preferred source: a phone screenshot from the owner.
  - Fallback: capture eeko.site at 390×812 @2x in Chrome device mode (780×1624), then resize.

No matcaps and no HDRI. Trees and rocks come from the Nature Kit, or are procedural as a fallback.

### 8.2 Delete (Wave 3 only, after `/field` is switched to v3)

| Category | Files |
|---|---|
| v2 engine | All of `app/components/three/world/`. That includes `Postprocess.ts`, `n8ao.d.ts`, `Creatures.ts`, `Particles.ts`, `Zones.ts`, `MiniGames.ts`, `utils/labels.ts`, `shaders/sky.ts`, `shaders/grass.ts` and `ui/Minimap.tsx`. |
| v2 route files | `app/field/FieldExperience.tsx`, `app/field/world.css` |
| Models | `bird.glb`, `house.glb`, `market.glb`, `lantern.glb`, `crate.glb`, `rock.glb` |
| HDRI | `hdri/night_1k.hdr` |
| Textures | `sand_color.webp`, `sand_normal.webp`, `water_normal.jpg` |
| Dependencies | `n8ao`, `postprocessing` |
| Content | `sectors` and any other fields used only by v2 in `content/world.ts` |

**Keep:**

- `car.glb`, `palm.glb`, `engine.wav`, `ui_*.ogg`;
- `music.ogg`, loaded lazily after Start;
- `ambient.ogg`, only if it suits daytime. Remove the market panner either way.

### 8.3 Avatar: optional, and exactly what to generate

**Value:** About & Contact is the only area without a hero object. A recognisable toy figure of the owner, waving, makes it the memorable stop and personalises the world without clutter.

Not recommended: a driver inside the car. The canopy is closed, and the figure would be about 0.3 units tall.

v1 ships with `profile.webp` on a portrait board. Drop in the files below, in this order, and the About module swaps the board for the figure automatically.

1. **`public/images/avatar-portrait.png`** (make this first; the 3D model is generated from it):
   - 1024×1024, transparent background.
   - The character from the waist up, in a 3/4 view, in a flat-shaded vector style.
   - Colours as in step 2.
   - Used in the About panel, the start card (optional) and Credits.
2. **`public/assets/models/avatar.glb`**:
   - **Style:** a stylised low-poly "designer vinyl toy", with Animal-Crossing-like proportions (head ≈ 30% of height). Matte flat colours only. No realistic skin texture, no baked lighting or shadows, no outlines, no text or logos.
   - **Pose:** standing, relaxed, weight even, right hand raised in a friendly wave, left hand in pocket. Facing +Z toward the viewer, feet flat.
   - **Geometry:** ≤ 12,000 triangles, 1–3 meshes. Y-up, origin at the centre between the feet, height 1.8 m. File ≤ 1.5 MB.
   - **Scale in the world:** the engine scales the figure to 5.5 units, next to a 3.8-unit car. This is deliberate toy scale: the figure reads like a vinyl figure standing next to a toy car.
   - **Material:** one material. Base-colour texture ≤ 1024² (512² preferred), or vertex colours. No normal, roughness or metal maps.
   - **Colours:** the owner's real skin tone; top `#24222B` or `#E2553F`; trousers `#3B3A45`; sneakers `#FFFDF8` with a `#F6C21C` accent.
   - **Optional rig:**
     - A Mixamo-compatible humanoid with clips `Idle` (2–4 s loop) and `Wave` (1.5 s), at 30 fps.
     - The engine plays `Wave` once when the car comes within 12 units.
     - Load it with `SkeletonUtils.clone` plus an `AnimationMixer`.
   - **Tooling:** image-to-3D (Meshy, Tripo or Rodin) from the step 1 portrait, then Blender Decimate. Confirm that the tool's terms allow commercial/portfolio use.
3. **`public/images/avatar-head.png`:** 512×512, transparent, head and shoulders. Used in the menu header.

**The owner should also provide or confirm:**

- fresh 1600×900 light-mode screenshots of each project (no browser chrome);
- a phone screenshot of eeko.site (for `eko-phone.webp`);
- the CV URL (the CV pad stays hidden until it exists);
- `bioShort` (≤ 100 characters) and the full bio for the panel;
- the real `musicPillars` copy (it is still marked TODO);
- the four gate decisions (§10, Gate).

**Content fixes (Step 0):**

- In `journeyStops`, replace "sector" with "area".
- Rewrite the Music "Tech stack" line to "…the Web Audio API powering the visualiser on the stage (with sound on)". The current copy says "the live visualizer you're standing in", which is untrue when sound is muted.

---

## 9. Performance budget and accessibility

### 9.1 Render profiles (decided once at boot, before the renderer is created)

`getGPUTier({ benchmarksURL: '/detect-gpu' })` runs in a race against a 3 s timeout. On timeout or error, the tier is 2.

| Profile | When | DPR cap | `antialias` | Shadow map | Scenery |
|---|---|---|---|---|---|
| `desktop-high` | not mobile, tier 3 | 2 | true | 2048 | 100% |
| `desktop-medium` | not mobile, tier 2 | 2 | true | 2048 | 100% (medium counts) |
| `desktop-low` | not mobile, tier ≤ 1 | 2 | true when device DPR < 2, otherwise false | none (blobs) | low counts |
| `mobile` | mobile, tier ≥ 2 | 3 (native) | false | 2048 | medium counts |
| `mobile-low` | mobile, tier ≤ 1 | 2 | false | none (blobs) | low counts |

- The effective DPR is `min(devicePixelRatio, cap)`. It is never lower than `min(devicePixelRatio, 2)`.
- The Quality setting and adaptive quality never change DPR or `antialias`.
- **Next-visit fallback:** if a `mobile` session's median frame time is above 28 ms during seconds 5–15 after Start, save `dprCap = 2` in localStorage for the **next** visit. Never change it mid-session.

### 9.2 Budget (desktop 1440p at DPR 2, 60 fps; iPhone 12-class on the `mobile` profile at DPR 3, ≥ 45 fps)

| Item | Budget |
|---|---|
| Draw calls in view | ≤ 180. Everything repeated is instanced: tiles, trees, bushes, boulders, bollards, planks, bricks, pins, blobs |
| Triangles in view | ≤ 350k |
| Lights | 3 (hemisphere, sun, fill); 0 point lights |
| Shadow map | One, 2048² (1024² after adaptive downgrade); none on the low profiles |
| troika Text meshes | ≤ 110 in total. `raycast` disabled. Hidden with their area when the area rect is more than 70 units from the focus |
| Dynamic bodies | 52 (32 bricks, 10 pins, 1 ball, 8 letters, car), ≤ 70; Rapier step < 2 ms |
| First-load transfer before Start (compressed, everything included) | ≤ 3.5 MB. JS ≈ 2.1 MB, of which `@dimforge/rapier3d-compat` is 1.66 MB gzipped (its WASM is inlined; dynamically imported at mount so it downloads alongside fonts and models). Models ≈ 0.55 MB (car 183 KB, palm 112 KB, Nature Kit ≤ 250 KB). Fonts ≈ 0.45 MB (4 woff, typeface JSON ≤ 120 KB, 2 next/font woff2). `profile.webp` ≤ 100 KB |
| After Start | Board WebPs (6 × ≤ 160 KB) loaded by distance; `music.ogg` (3.4 MB) loaded lazily |
| Added JS | troika ≤ 80 KB gzip |

### 9.3 Adaptive rules

- Never touch DPR or MSAA.
- Downgrade order:
  1. shadow map 2048 → 1024 (profiles that have one);
  2. scenery count −30%;
  3. tyre dust off.
- Trigger: median frame time above 22 ms over 4 s.
- Ignore the first 5 s after Start, hidden tabs and active camera tweens.
- Upgrade after the median stays below 14 ms for 10 s.
- At most one change every 8 s.

### 9.4 Accessibility

- **`prefers-reduced-motion`:**
  - no intro tween (cut instead);
  - shot changes are cuts;
  - coins don't bob;
  - vinyl and EQ are static;
  - camera follow uses λ 12.
- **Keyboard covers everything:**
  - "Skip to classic portfolio" is the first focusable element;
  - Esc closes the top layer;
  - focus is trapped in the panel, menu and map, and returned to the canvas afterwards;
  - keys are ignored while a form control has focus.
- An `aria-live="polite"` region announces messages such as "Entered Projects" and "Press E to open Clay Studio Creations".
- Panels use semantic markup (`h2`, `p`, `ul`, `a`).
- **Every fact in the world also exists in HTML:** panels, map list, glossary, Contact tab, the SSR summary and `/projects`.
- **Contrast**, measured against rendered colours:
  - HTML text ≥ 4.5:1;
  - in-world `ink` copy ≥ 7.5:1 on every surface, including shadow;
  - `ink2` ≥ 5.8:1 (plaza and paper only);
  - `ACCENT_INK` text ≥ 4.9:1 (paper only).
- Touch targets ≥ 44 px.
- No flashing; beat-coupled visuals are removed.
- Sound starts only on the Start gesture, and the toggle state persists.

---

## 10. Implementation plan

**Ground rules:**

- v3 lives in `app/components/three/world3/`, and its React shell in `app/field/v3/`.
- `/field?v=3` loads v3; plain `/field` keeps loading v2 until Wave 3.
- Nothing in v2 is edited or deleted before Wave 3, apart from additive edits to `content/world.ts` and the `?v=3` switch.
- Every stream must pass `npx tsc --noEmit`, `npm run test` and `npm run build` before handing off.

### Step 0: shared contracts (one agent, serial; blocks everything)

After this step, contracts are frozen. Only the integrator (I) may change them, and only with a note in `DECISIONS.md`.

| File | Content |
|---|---|
| `world3/Config.ts` | `CAMERA_YAW`, `SCREEN_RIGHT`, `SCREEN_DOWN`, `PALETTE`, `ACCENT`, `ACCENT_INK` (§1.2). `LOOK` presets (§1.7). `CONFIG.world` (seed, bounds, quayZ). `CONFIG.render` (profile table §9.1). `CONFIG.lights` (from `LOOK`). `CONFIG.shadow` (§1.5). `CONFIG.fog` (near 1.18·d, far 3.0·d). `CONFIG.camera` (§4.1). `CONFIG.vehicle` (maxSpeed 32, boost 1.5, paint, rest copied from v2). `CONFIG.physics` (gravity −24, fixedStep 1/60, maxSubSteps 4). `CONFIG.text` (font URLs, sdfGlyphSize 64, layer heights). `CONFIG.type` (§3.3). `CONFIG.scenery` (source, counts). `CONFIG.quality` (§9.3). `CONFIG.audio`. Comment the calibration rule (§1.4). |
| `world3/types.ts` | `AreaId`; `Rect {x,z,w,d}`; `AreaDef {id,name,accent,accentInk,rect,arrival{x,z,yaw},cameraShot?,cameraZone?,title3D?{text,x,z,dynamic}}`; `PathDef {from,to,width,labels:{text,d}[]}`; `PadDef {x,z,w,d,faceCamera}`; `WorldInteractable {pad,prompt,areaId,content?,onInteract?,setActive?(on)}`; `RuntimeInfo {carPos: Vector3, carSpeed: number, reducedMotion: boolean, muted: boolean, isTouch: boolean}`; `AudioApi {getBands(n): Float32Array \| null, playImpact(kind, force), playUi(kind)}`; `WorldCommands` (subset used by areas: `openMenu(tab)`, `openUrl(url)`, `resetPlayground()`); `AreaContext {group,physics,materials,shapes,text,text3d,assets,audio,commands,disposal,def,layout,addInteractable}`; `AreaHandle {group, update?(dt, t, rt: RuntimeInfo), reset?(), dispose?()}`; `MaterialsApi {lambert(hex,{flat?,occluder?}), basic(hex,{fog?})}`; `TextApi {flat(o), upright(o), onPath(o & {angle})}`; `TextOpts {text, font:'display'\|'bold'\|'semibold'\|'medium', size, color, maxWidth?, letterSpacing?, anchorX?, anchorY?, lineHeight?, desktopOnly?, layer?}`; `Text3DApi {word(text,{cap,depth,color,dynamic,mass?,curveSegments}) → {group, letters[], reset()}}`; `CameraState` (§4.1); `RenderProfile` (§9.1); `ImpactKind`. |
| `world3/Layout.ts` + `Layout.test.ts` | `AREAS` (§2.3/§2.4), `PATHS` (§2.5), `TOKENS` (§2.7), `BOUNDS`, `BANDS`, `JETTY`, `SPAWN`, `RAMP_CORRIDOR`. The test checks: every arrival is inside its rect; no rects overlap; path endpoints lie on a rect edge or another path; P5/P6 tiles don't overlap P4's; tokens are outside all rects and the corridor; the corridor is clear of props; no tall prop is in a ground-text sun-side strip. |
| `world3/State.ts` | `WorldState`. **Keep:** `phase` (adds `'failed'`), `loadProgress`, `loadLabel`, `quality`, `adaptiveQuality`, `muted`, `paused`, `reducedMotion`, `photoMode`, `webglFailed`, `prompt`, `panel`. **Add:** `failReason?: 'webgl'\|'context-lost'\|'timeout'\|'asset'`, `areaId`, `visited: AreaId[]`, `mapOpen`, `menuTab: null\|'settings'\|'controls'\|'words'\|'contact'\|'credits'`, `toast`, `words: {word,meaning,pron?}[]`, `wordsTotal`, `isTouch`. `LiveState {x, z, yaw, fps}`. **Commands:** `start`, `setPaused`, `setMuted`, `setReducedMotion`, `setQuality`, `setAdaptive`, `travelTo(id)`, `interact`, `closePanel`, `openMap`, `closeMap`, `openMenu(tab)`, `closeMenu`, `openUrl(url)`, `respawn`, `setTouchInput`, `setTouchBrake`, `setTouchBoost`, `togglePhotoMode`, `capturePhoto`, `resetPlayground`. |
| `world3/Experience.ts` (skeleton, frozen API) | `constructor(canvas: HTMLCanvasElement, container: HTMLElement, store: WorldStore)`; `init(opts: { profile: RenderProfile; reducedMotion: boolean; isTouch: boolean }): Promise<void>` (on failure it sets `phase: 'failed'` and `failReason`); `interact(): void` (synchronous); `dispose(): void`. Also `pickProfile(gpuTier, isMobile): RenderProfile`. Load contract: weights and labels as in §6.2. |
| `world3/Areas.ts` (skeleton) | Builds every registered area from `AREAS`; registry of interactables; rect tests in the pad's local frame. |
| `world3/utils/math.ts` | `mulberry32` seeded RNG, `valueNoise2D`, `poissonDisk` (Bridson), `damp`, `clampLen`, `smoothstep`, `distToSegment2D` |
| `world3/utils/{instancing,disposal,time}.ts` | Ported from v2 (instancing gains `count` control) |
| `world3/utils/shapes.ts` | `roundedRectShape`, `roundedSlab`, `flatPlate(w, d, r, layer)`, `LAYERS` (§2.5) |
| `world3/ui3d/Pad.ts` | Pad outline and fill, keycap builder (takes `TextApi`, `MaterialsApi`) |
| `world3/troika.d.ts` | Ambient types for `troika-three-text` |
| `app/field/v3/FieldExperience.tsx` (stub) | Mounts `Experience` with the frozen API |
| `app/field/FieldMount.tsx` | After mount, if `URLSearchParams(location.search).get('v') === '3'`, dynamically import v3; otherwise v2 |
| `app/field/content/world.ts` (additive only) | **Add:** `meta {worldName, heroWord, role, greeting}`, `about {bio, bioShort ≤100, portrait, avatarModel?}`, `contactLinks[]` (from `app/contact/page.tsx` and `SiteFooter.tsx`; CV optional), `credits[]`, `yorubaWords[].pron?`, `areaCopy: Record<AreaId,{name,blurb}>`, per project `boardImage` (`/assets/boards/*.webp`) and `boardPitch` (≤ 32 characters). Apply the content fixes in §8.3. **Do not remove** `sectors` (Wave 3). |
| `package.json` | Add `troika-three-text@0.52.5`; devDependencies `vitest@5.0.3`, `sharp@0.34.5`, `opentype.js@2.0.0`, `subset-font@2.9.0`; script `"test": "vitest run"`; plus `vitest.config.ts`. |
| `public/detect-gpu/*.json` | Copied from `node_modules/detect-gpu/dist/benchmarks` |

### Wave 1 (parallel; separate files; built against the Step 0 types)

All paths are under `app/components/three/world3/` unless stated otherwise.

| Stream | Owns (create / edit) | Done when |
|---|---|---|
| W1-A Render core | `Renderer.ts` (profile-driven `antialias`, NoToneMapping, clear `#F3DCC0`, PCF, contextlost/restored hooks), `utils/sizes.ts` (§3.4.2), `utils/probe.ts`, `Physics.ts` (§4.4), `Physics.test.ts` | On Chrome, `canvas.width === devicePixelContentBoxSize.width`; on Safari the fallback path is used. DPR is constant across resize and opening devtools. Interpolation is unit-tested with a simulated 120 Hz dt, including the dropped-substep alpha reset. The convexHull null fallback is tested. The probe returns per-channel linear values. |
| W1-B Text | `utils/text.ts` (TextApi, `configureTextBuilder`, `preloadAll(strings)`, desktopOnly visibility, layers), `utils/text3d.ts` (Text3DApi, baseline-preserving letters), `scripts/fonts/{build-fonts.mjs,typeface.mjs,src/*}`, `public/fonts/*`, `fonts.test.ts` | **Spike first:** one Inter Text and one 3D letter render on `/field?v=3` in Chrome, Safari macOS and iOS Safari. The Yoruba sample `Ẹ káàbọ̀ Ọ̀rẹ́ Ẹ ṣé` renders with its marks placed correctly. The cmap test passes. J, Q and È sit on the baseline. |
| W1-C Environment | `Environment.ts` (flat ground, quay, bollards, water, jetty, lights from `LOOK`, shadow-box refit and texel snap, distance-scaled fog, low-profile prop blobs API), `shaders/water.ts` | Probe: lit paper top is in 0.88–0.96 linear in every channel (`day`). No shadow crawl while panning or driving at full pull-back. The shadow box covers the visible ground at minimum and maximum zoom and in portrait. |
| W1-D Materials & assets | `Materials.ts` (incl. occluder dither), `Assets.ts` (car + palm + Nature Kit + optional avatar; GLB → Lambert copying side/vertexColors/alphaTest/transparent/opacity; car repaint §4.2; board textures, lazy by distance), `scripts/boards/build-boards.mjs`, `public/assets/boards/*`, `public/assets/models/nature/*` | The car is red with ink trim and yellow rims, double-sided. No `MeshStandardMaterial` is left in the scene. Nature Kit materials map to palette tokens, and the build fails on unknown names. |
| W1-E Vehicle / camera / controls | `Vehicle.ts`, `Camera.ts`, `Controls.ts`, `TyreDust.ts` (P1: 48 instanced `Icosahedron(0.35, 0)` in `#EFD9BC`, 0.7 s life, spawned at the rear wheels when speed > 6 and drifting or boosting) | The car drives nose-first. `currentVehicleSpeed()` is negative in reverse, and the reverse light and wheel spin follow it. The front wheels steer without wobble. Camera yaw is constant. Portrait keeps the hero word and the car in frame. The gallery shot tweens. WASD works on an AZERTY layout. |
| W1-F UI | `app/field/v3/FieldExperience.tsx`, `app/field/v3/world.css`, `ui/{Hud,StartScreen,Panels,MapModal,TouchControls,FailCard}.tsx`, `app/field/layout.tsx`, `app/field/page.tsx` (metadata, SSR summary), `app/field/FieldSummary.tsx` | No `backdrop-filter`, emoji or `translateX(−50%)`. Lighthouse a11y ≥ 95 on the overlay states. The summary is readable with JS disabled. The 15 s timeout and failure cards work. |
| I Integrator | `Experience.ts`, `Areas.ts`, `Audio.ts` (ported from v2 without the beat return or the market panner; adds `getBands`, `playImpact`), `Debug.ts` (lil-gui: Look preset, lights, shadow, Camera, Text toggles, probe readout) | `/field?v=3` boots with the Wave 1 modules wired in: car driving on the flat ground with the full rig. |

### Wave 2a (parallel)

| Stream | Owns |
|---|---|
| W2-1 | `areas/Welcome.ts`, `areas/Hub.ts`, `Paths.ts` (tiles + path labels) |
| W2-6 | `Scenery.ts` (§2.6; both sources, bands, occluder materials) |

### Gate: owner look-dev sign-off (blocks Wave 2b)

The integrator wires the Welcome + Hub slice with scenery on `/field?v=3`, and sends the owner screenshots at 1440×900 DPR 2 and 390×844 DPR 3, next to the current v2. The owner decides:

1. **Look:** `day` or `dusk` (§1.7).
2. **Car paint:** `brand` red or `danfo` yellow (with blob opacity 0.45).
3. **Scenery:** Nature Kit or procedural.
4. **World name:** `Èkó`, `Èkó Nights` (dusk only) or `Jazz's World`.

Record the decisions in `DECISIONS.md` and in Config. Wave 2b proceeds only after sign-off.

### Wave 2b (parallel; each agent owns only its own files)

| Stream | Owns |
|---|---|
| W2-2 | `areas/Projects.ts` |
| W2-3 | `areas/Eko.ts`, `areas/Music.ts` |
| W2-4 | `areas/Journey.ts`, `areas/About.ts`, `areas/Credits.ts` |
| W2-5 | `areas/Playground.ts` (wedge ramp, corridor, bowling lane, running-bond wall, reset), `Collectibles.ts` (coins) |

Each area exports `build(ctx: AreaContext): AreaHandle` and uses only `Layout` coordinates and R/S offsets. No magic numbers.

### Wave 3 (integrator)

- **`Experience.ts`:**
  - Boot order:
    1. profile (detect-gpu with timeout);
    2. renderer;
    3. fonts and preload, alongside the dynamic import of Rapier;
    4. assets;
    5. environment;
    6. areas;
    7. scenery;
    8. warm-up render.
  - Tick: `physics.step` (vehicle control per substep) → `interpolate` → `vehicle.syncVisual` → areas → camera → environment (shadow box, fog) → render.
  - Also: area enter and visited tracking, camera zones, area culling at 70 units, `travelTo` (teleport → snap → detect → visited), hero-letter auto-reset, the adaptive rules (§9.3) and the next-visit DPR fallback.
- **Switch:** `/field` renders v3 by default. Remove the `?v=3` switch.
- **Deletions:** everything in §8.2.
- **Docs:** `CREDITS.md` (fonts, Kenney packs, three.js, Rapier, troika, detect-gpu) and `DECISIONS.md`.

### Wave 4: QA (acceptance)

- Screenshots at DPR 1, 2 and 3, zoomed to 400%: no halos and no soft text. DPR 3 is tested on the `mobile` profile.
- Resize, devtools open/close, rotation, and a 1x↔2x monitor move: still sharp.
- Safari macOS and iOS (`device-pixel-content-box` fallback, troika worker, popups opened from E/Enter).
- Perf counters within §9.2 on both reference devices.
- Contrast probe readings match §1.2 / §1.4.
- Reduced-motion pass.
- Keyboard-only pass, including an AZERTY layout.
- No-JS pass on the SSR summary.
- Failure-state pass: block a font, block `car.glb`, force a context loss.
- Owner review with old and new screenshots side by side.

### P2 polish (after acceptance)

1. A Bruno-style "grow from the ground" reveal: a `uReveal` radius uniform injected through `Materials.ts` `onBeforeCompile`.
2. A striped area-fence pop when a pad activates.
3. A spring antenna on the car, with a `#F6C21C` ball.
4. Low-frequency ground colour variation (±3%).
5. An animated browser-tab title.
6. The owner avatar with the `Wave` clip.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| troika fails on Safari/ANGLE, in the Turbopack worker, or under CSP (`worker-src blob:`) | W1-B spike before anything else. Pin troika 0.52.5 / utils 0.52.5. Use plain `Text`, not `BatchedText`. Fallback flag `CONFIG.text.engine = 'canvas'`: flat canvas textures at 200 px per unit, LinearFilter, no mipmaps, never sprites. |
| troika silently fetches fallback fonts from a CDN when a glyph is missing | The subset covers all content characters, `defaultFontURL` is set, and `fonts.test.ts` asserts cmap coverage for every content string. |
| Typeface JSON is wrong: counters fill in, or bevels crease where the variable font's overlapping contours meet | Restricted charset; 1-em scale; `--reverse` option; per-glyph visual check at curveSegments 12. If overlap joins crease, reduce `bevelSize` to 0.02, or fall back to an Inter ExtraBold instance for 3D. |
| NoToneMapping clips if someone raises a light intensity | Calibration rule in the Config comment, plus the per-channel debug probe, plus the Wave 4 probe check. |
| `mobile` profile at DPR 3 misses 45 fps | Lambert, 3 lights and one shadow map keep the cost low. Adaptive drops shadows to 1024 and thins scenery. The next-visit fallback caps DPR at 2 without ever changing it mid-session. |
| Flat world reads empty or like "programmer art" | Nature Kit scenery, grove noise, edge forest and decorative bands, plazas, tile paths, a hero prop per area, and the owner gate on a finished slice before Wave 2b. |
| Props hide the car near the south and east edges | Only low props near those bounds and in those bands; occluder dither on all scenery. |
| Fixed camera feels odd when driving toward it | Extra look-ahead toward the camera (§4.1), speed pull-back, pan, and the map. |
| Car is about 2× Bruno's scale, so the world feels large | Layout spacing is already scaled to the 3.8-unit car. If it still feels slow, reduce distances by 15% in `Layout.ts` only; `Layout.test.ts` re-checks the invariants. |
| Interpolation glitches on teleport, reset or flip | `physics.snap(body)` is called by respawn, teleport, `travelTo`, resets and auto-flip. |
| Too many text meshes or draw calls | Area culling at 70 units, `desktopOnly` text, `raycast` disabled. |
| Long copy overflows boards and plates | `maxWidth` with auto-fit down to the minimum size, `boardPitch` ≤ 32 characters, `bioShort` ≤ 100. The full copy lives in panels. |
| AI-generated avatar is off-style, over budget or has unclear licensing | Strict brief (§8.3), portrait first, Blender decimation, colour check against the palette. v1 does not depend on it. |
| Owner misses the "Èkó Nights" identity | The gate shows `day` and `dusk` side by side with the current v2. The name is the owner's choice. Lagos cues stay either way: lagoon quay, danfo yellow, Yoruba tokens, terracotta. |
| Parallel streams collide, or the build breaks mid-way | v3 lives in a parallel tree behind `?v=3`, with strict file ownership. Contracts are frozen after Step 0. All deletions happen in Wave 3. `tsc`, `test` and `build` must pass at every hand-off. |
| Rapier payload (1.66 MB gzipped) slows first load | Dynamic import at mount, in parallel with the other downloads; budgeted in §9.2. If needed later, evaluate the non-compat `@dimforge/rapier3d`, which ships separate `.wasm`, behind a Turbopack spike. |
| Site-wide `globals.css` still `@import`s Google Fonts (Poppins and Geist load twice) | Out of scope for `/field`. File a separate ticket; do not edit it in this redesign. |

---

## Appendix: critique items not applied as written

- **C19, the proposed ramp at (−100, −36) launching north-west:** not used. Its launch line crosses the pin deck (about (−114, −50) at 20 units). The intent is applied with a new layout instead: the ramp launches west along z −40, the lane runs at z −56, and the corridor is 56 units long. A boosted jump at gravity −24 flies about 52 units, so the 40 units the critique suggested would not be enough.
- **B16, bare sand past the north wall:** north of the bound is the lagoon, not sand. Only a west band is added there, plus low-prop bands to the south and east.
- **E34, `e.code` for every key:** movement uses `e.code`. Mnemonic keys (M, N, P, R, E) keep `e.key`, because with `e.code` "M" would land on the wrong physical key on AZERTY.
- **E40, showing a night option:** no full night variant is built. A night look needs emissives and bloom, which are the main cause of the blur. A `dusk` preset that uses the same pipeline is offered at the gate instead. The name decision is left to the owner, as the critique asked.
- **A4, `antialias: false` on all low-tier devices:** applied only at device DPR ≥ 2. Low-tier screens at DPR 1 keep MSAA, which is cheap there and avoids jagged edges.
- **B12, fitting the shadow box every frame:** the box is refit only when zoom, aspect, FOV or the shot changes, and is sized for the full pull-back. Refitting every frame would change the texel size while driving and make shadows shimmer.
- **B11, keeping the yellow car with a 0.45 blob:** kept only as a gate option. The red body is the default because it measures 2.5:1 against the ground, against 1.12:1 for yellow.
- **B13, fog:** the critique allowed either keeping or dropping it. It is kept, with near/far distances scaled to the camera distance so the fade looks the same at every zoom.
- **A6, the Bruno reference:** limited to what matters for this design, namely that his current site uses some blur/DOF, which is why we reject it. Other details of the 2025 site were not independently verified.
- **B17, mirroring the layout:** not needed once look-ahead toward the camera is added.