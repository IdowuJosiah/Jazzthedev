# Tripo models: state and integration plan

Branch `tripo-models`. Raw exports live in `assets-src/tripo/<slug>.glb` (git-ignored, ~23 MB);
`node scripts/models/build-models.mjs [slug …]` writes meshopt-compressed GLBs with WebP
textures to `public/assets/models/tripo/` (1.6 MB total). Licence: the owner is on a paid Tripo
plan, so commercial use is fine; add a "Tripo AI (owner's paid plan)" line to CREDITS.md and the
in-world credits when the models ship.

| Slug | Source id | Built tris | Size | Notes |
|---|---|---|---|---|
| truck | 82b72ecf | 23.6k | 392 KB | One mesh in the export: body + fused front wheels + 2 loose rear wheels. The build splits it into `body` + one `wheel` (rear-left, centred on its axle); scene extras carry `wheelRadius` (0.090) and `wheelCentres` (FL, FR, RL, RR, +X = left). **The front axle is assumed to mirror the rear (z = −rearZ) — check visually before wiring.** Model units: length 0.98 (z), width 0.51, height 0.38, faces +Z, wheels on y 0. |
| street-lamp | d469c2bf | 2.6k | 64 KB | One mesh; the globe is not a separate part (night glow needs a procedural globe overlay). |
| palm-tree | c4828c13 | 3.2k | 232 KB | Foliage simplified with Permissive + Prune. |
| tree-broadleaf | ca617849 | 3.5k | 203 KB | |
| bush | d30353a6 | 0.8k | 53 KB | |
| boulder | eb390534 | 0.7k | 63 KB | |
| speaker-stack | 0b1faa8f | 2.3k | 96 KB | |
| turntable | be4cf382 | 6.0k | 176 KB | Record is not a separate part (the Music vinyl spin stays procedural). |
| bench | 70a5fb71 | 2.4k | 113 KB | |
| bowling-pin | 563b0479 | 1.2k | 23 KB | |
| canoe | 41b60048 | 3.6k | 159 KB | |
| (truck-wheel) | 33283982 | — | — | Raw only; not built (the truck's own wheel is used). |

All models are normalised by Tripo to ~1 unit on their longest side, standing on y = 0.

## Integration plan (in order)

Status 2026-11-22: steps 1–2 done on this branch (loader + scenery prefer the Tripo models, Kenney/palm.glb fallback; tests pass). Measured in view: 251k–290k triangles, 60–110 draw calls. To check before merging: bushes read small/dark in the first look; compare day and night; then CREDITS.

1. **Loader.** `Assets.ts`: `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` (three/addons/libs/meshopt_decoder.module.js);
   EXT_texture_webp is native. Convert materials to Lambert keeping `map` **and `normalMap`**
   (MeshLambertMaterial supports normal maps), apply the occluder dither to scenery.
2. **Scenery** (trees, palms, bushes, boulders) replaces the Kenney kit + palm.glb.
   **Triangle budget:** §9.2 allows ≤ 350k in view; instanced counts are tree 160, palm 60,
   bush 220, boulder 40 on high, so at the sizes above the whole world is ~1M triangles.
   Check in-view triangles in `?debug` after wiring; if over, lower the scenery budgets in
   build-models.mjs (tree/palm ~1.5k, bush ~400, boulder ~300) or the counts.
3. **Props:** speakers on the Music stage, benches on plazas, canoe on the lagoon, bowling pins in
   the Playground (they already have Lathe colliders; swap the visual only).
4. **Lamps:** Tripo lamp mesh + keep the procedural globe for the night colour change.
5. **Truck** last: scale so the wheel radius matches CONFIG (0.42) and the wheel centres sit on the
   physics connection points (or move the connection points to the model's `wheelCentres`); four
   wheel instances driven by the existing steer/spin code. Keep the procedural truck as fallback.

Verification each step: `npx tsc --noEmit`, `npm run test`, `npm run build`, browser check at
`/field?debug` (teleport with `window.__world3.teleport(x, z, yaw)`), then PR + merge (owner
asked for auto-merge once verified).
