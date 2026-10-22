# Jazz — Portfolio

Next.js 16 (App Router) + React 19 + TypeScript portfolio, with two ways in:

- **Classic site** — `/`, `/projects`, `/about`, `/contact`. Fast, accessible,
  recruiter-friendly. This is also the fallback if WebGL is unavailable.
- **Jazz's World** — `/field`, a drivable 3D toy world of the portfolio that
  switches between day and night. Built on raw three.js + Rapier physics.

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

## Jazz's World — the 3D world (`/field`)

A clean, matte diorama you drive a red Cybertruck-style truck around. Each part of
the portfolio is an area off a central Crossroads: pull up to a pad and press `E`
to open it. Collect the eight Yoruba word coins and find the physics playground.

### Controls (desktop first)

| Action | Keyboard |
|---|---|
| Drive / steer | `W A S D` or arrows |
| Boost | `Shift` |
| Handbrake / drift | `Space` |
| Open what you're on | `E` or `Enter` |
| Respawn | `R` |
| Map / fast travel | `M` |
| Mute | `N` |
| Photo mode | `P` |
| Menu (settings, controls, words, contact, credits) / close | `Esc` |

Desktop shows no on-screen controls. Touch devices get a joystick plus `E`.

Add `?debug` for a lil-gui tuning panel and stats.js; it also exposes
`window.__world3Store` and `window.__world3.teleport(x, z, yaw)` for QA.
`?time=day` or `?time=night` forces the time of day for one visit.

### Features

- **Driving**: a Rapier raycast vehicle (suspension, grip, drift, auto-flip,
  respawn) with a fixed 3/4 follow camera, a gallery shot at the project boards
  and map fast travel.
- **Areas**: Welcome (3D JAZZ letters), Crossroads, Frontend Projects (four
  boards), Journey & Skills, Eko (case study + phone), Music & Culture (stage,
  vinyl, sound-reactive EQ), About & Contact, Playground (ramp, bowling, brick
  wall, reset pad) and Credits on the lagoon jetty.
- **Day and night**: follows the visitor's clock (HUD sun/moon button and a
  Settings choice override it), with lamp posts and headlights at night. No
  bloom or glow, so everything stays crisp.
- **Sharp text**: SDF text (troika) and 3D type, rendered at the device pixel
  ratio with no post-processing; anything read for longer than a second is HTML.
- **UX**: real loading progress, Start card, area chip + first-visit toasts,
  map, settings (quality, sound, reduced motion, time of day), content panels,
  photo mode and a Words glossary.
- **Performance and a11y**: GPU-tier render profiles and adaptive quality
  (shadows → scenery → tyre dust, never resolution), instancing, full GPU
  disposal; reduced motion, keyboard-navigable UI, a server-rendered summary
  for no-JS / screen readers, and a WebGL-failure card linking the classic site.

### Editing portfolio content

All copy, links, tags and images live in **`app/field/content/world.ts`**; no 3D
code changes are needed:

- `frontendProjects` → the project boards (`boardImage`, `boardPitch`) and panels
- `ekoMilestones` → Eko; `musicPillars` → Music & Culture
- `journeyStops` + `skillTotems` → Journey & Skills
- `about` + `contactLinks` → About & Contact; `credits` → the Credits sign
- `yorubaWords` → the word coins; `meta` → name, hero word, role, greeting
- `areaCopy` → each area's name and blurb (map, toasts, chips)

Board images are 1600×900 WebP under `public/assets/boards/`. An optional avatar
(`about.avatarModel`, spec §8.3) replaces the About portrait once the file exists.
Classic `/projects` content lives in `app/projects/page.tsx`.

### Architecture

The engine is in `app/components/three/world3/`: `Experience` (boot + loop),
`Renderer`, `Camera`, `Controls`, `Physics`, `Vehicle` (+ `models/Cybertruck`),
`Environment`, `DayNight`, `Lamps`, `Paths`, `Scenery`, `Collectibles`,
`Areas` + `areas/*` (one module per area), `Audio`, `Assets`, `Debug`, with
`Config` (every tunable and the looks), `Layout` (every coordinate), `State`
(store) and `utils/`. The React shell is `app/field/v3/` (+ `world3/ui/`).
Unit tests: `npm run test`.

The full design is in `docs/field-v3-spec.md`; deviations and decisions are
logged in **DECISIONS.md**.

### Assets

All world assets are local (`public/assets` ≈ 4 MB, `public/fonts`,
`public/detect-gpu`) and CC0 / OFL / MIT. Full attribution is in **CREDITS.md**
and on the in-world Credits sign.

### Known limitations / next steps

- The target is 60 fps on a mid laptop; verify on the deployed site (the local
  preview pane throttles when unfocused).
- Open-licence afrobeat is scarce, so the music bed is a CC0 "cool city" loop;
  swap the file in `public/assets/audio` anytime.
- Next: QA at DPR 1/2/3 and in Safari, then mobile polish.
