# Jazz — Portfolio

Next.js 16 (App Router) + React 19 + TypeScript portfolio, with two ways in:

- **Classic site** — `/`, `/projects`, `/about`, `/contact`. Fast, accessible,
  recruiter-friendly. This is also the fallback if WebGL is unavailable.
- **Èkó Nights** — `/field`, a drivable 3D world where the portfolio lives as a
  neon night island. Built on raw three.js + Rapier physics.

---

## Run & build

```bash
npm install
npm run dev     # http://localhost:3000  (world at /field)
npm run build   # production build
npm start       # serve the build
npm run lint    # eslint
```

Node 20+ recommended. The 3D world loads client-side only (`ssr:false`), so the
rest of the site prerenders as static HTML.

---

## Èkó Nights — the 3D world (`/field`)

A stylized Afro-futurist Lagos-at-night island you drive around. Each portfolio
area is a physical **district** with interactive billboards; collect Yoruba
words, find the physics playground, and pull up to any project.

### Controls

| Action | Keyboard | Touch |
|---|---|---|
| Drive / steer | `W A S D` or arrows | left joystick |
| Boost | `Shift` | ⏵⏵ button |
| Handbrake / drift | `Space` | ✦ button |
| Interact / open panel | `E` or `Enter` | `E` button |
| Respawn | `R` | — |
| Photo mode | `P` | ◉ (top-right) |
| Mute | `M` | 🔊 (top-right) |
| Menu (travel / settings / controls / credits) | `Esc` | ☰ (top-right) |

Add `?debug` to the URL for a lil-gui tuning panel + stats.js FPS, and to expose
`window.__ekoStore` for scripting.

### Features

- **Driving** — Rapier raycast-vehicle with suspension, grip, drift, respawn;
  damped follow-cam with a cinematic intro and fast-travel swoops.
- **Portfolio as place** — four districts (Frontend, Music, Eko, Journey & Skills)
  with landmarks + billboards that open animated content panels. Content comes
  from one file (below).
- **World** — procedural island terrain (shared physics trimesh), stylized water
  + sky shaders, day↔night cycle, volumetric-ish fog, instanced palms/rocks,
  wind-bending grass, fireflies, toggleable rain, a lantern-lit night market,
  and circling birds.
- **Life & play** — Yoruba-word collectibles with a counter, a physics playground
  (jump ramp, knockable crate pyramid, push-ball), and beat-reactive neon that
  pulses to the music bed.
- **Polish** — postprocessing (bloom, SSAO on high, ACES tone-map, colour grade,
  vignette, SMAA); spatial market audio + speed-reactive engine + UI sounds.
- **UX** — real loading progress, minimap, fast-travel, settings (quality, sound,
  reduced motion, time-of-day, rain), controls help, in-world credits.
- **Performance & a11y** — GPU-tier detection + adaptive quality (auto-steps down
  if FPS drops), DPR cap, instancing, proper GPU disposal on unmount; reduced-
  motion support, keyboard-navigable UI, and a graceful WebGL-failure fallback to
  `/projects`.

### Editing portfolio content

All copy, links, tags and images live in **`app/field/content/world.ts`** — no 3D
code changes needed:

- `frontendProjects` → Frontend district billboards
- `musicPillars` → Music district
- `ekoMilestones` → Eko district
- `journeyStops` + `skillTotems` → Journey & Skills district
- `yorubaWords` → the collectible orbs
- `sectors` → district names / blurbs / accent colours

Images are plain paths under `public/images/`. Classic `/projects` content lives
in `app/projects/page.tsx`.

### Architecture

Modular engine under `app/components/three/world/`: `Experience` (root loop),
`Renderer`, `Camera`, `Physics`, `Vehicle`, `Controls`, `Environment`, `Zones`,
`Scenery`, `Particles`, `Creatures`, `Collectibles`, `MiniGames`, `Audio`,
`Postprocess`, `Debug`, with `Config` (all tunables), `State` (store) and
`Assets` (loaders), plus `shaders/` and `utils/`. React UI in `app/field/` +
`world/ui/`. Tunables live in `Config.ts` — no magic numbers in systems.

### Assets

All world assets are local under `public/assets/` (≈7.7 MB, lazy-loaded) and are
CC0 / MIT. Full attribution in **CREDITS.md** and the in-world Credits panel.
Build/creative decisions are logged in **DECISIONS.md**.

### Known limitations / next steps

- FPS target is 60 on a mid laptop; verify on the deployed site (the local
  preview pane throttles when unfocused). Adaptive quality covers weaker GPUs.
- Open-licence **afrobeat** is scarce, so the music bed is a CC0 "cool city"
  loop; the world still pulses to its beat. Swap the file in `public/assets/audio`
  anytime.
- Possible next steps: bake lightmaps for the static props, add KTX2 for larger
  textures if the island grows, and richer NPC behaviour.
