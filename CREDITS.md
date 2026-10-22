# Credits — Jazz's World

Every external asset and library used in the `/field` 3D world is listed here with its
author, source and license. Assets are stored locally in `public/` (nothing is
hotlinked). The same list is readable in-world from the **Credits** sign on the jetty
(`credits` in `app/field/content/world.ts`).

## 3D models (`public/assets/models/`)

| Asset | File | Author | Source | License |
|---|---|---|---|---|
| Nature Kit (trees, bushes, rocks) | `nature/*.glb` | Kenney | https://kenney.nl/assets/nature-kit | CC0 1.0 |
| Palm Tree | `palm.glb` | Quaternius | https://poly.pizza/m/P0tgwyXBgr | CC0 1.0 |

The red Cybertruck-style truck is procedural (`models/Cybertruck.ts`): no model file,
no logos or brand text.

## Fonts (`public/fonts/`)

| Font | Files | Author | Source | License |
|---|---|---|---|---|
| Inter | `Inter-*.woff` | Rasmus Andersson | https://github.com/google/fonts/tree/main/ofl/inter | OFL 1.1 (`OFL-Inter.txt`) |
| Bricolage Grotesque | `BricolageGrotesque-ExtraBold.*` | Mathieu Triay | https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque | OFL 1.1 (`OFL-BricolageGrotesque.txt`) |

## Audio (`public/assets/audio/`)

| Asset | File | Author | Source | License |
|---|---|---|---|---|
| Cool City (music bed) | `music.ogg` | mintodog | https://opengameart.org/content/cool-city | CC0 1.0 |
| Racing car engine loop | `engine.wav` | domasx2 | https://opengameart.org/content/racing-car-engine-sound-loops | CC0 1.0 |
| UI click / confirm / hover | `ui_click.ogg`, `ui_confirm.ogg`, `ui_hover.ogg` | Kenney | https://kenney.nl/assets/interface-sounds | CC0 1.0 |

Impact sounds are synthesized at runtime (no files).

## Libraries

three.js (MIT), @dimforge/rapier3d-compat (Apache-2.0), troika-three-text (MIT),
gsap (standard "no charge" license), detect-gpu (MIT; its benchmark data is served
from `public/detect-gpu/`), lil-gui (MIT, `?debug` only), stats.js (MIT, `?debug` only).

## Notes

No CC-BY, non-commercial or no-derivatives assets are used, so no attribution is
legally required; this page is a courtesy credit. The fonts are redistributed under
the SIL Open Font License, whose text ships next to them.
