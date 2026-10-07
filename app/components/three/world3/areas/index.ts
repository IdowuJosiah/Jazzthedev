// ─────────────────────────────────────────────────────────────────────────
// Area registry (side-effect imports). Each Wave 2 area module calls
// `registerArea(id, build)` at module load; the integrator adds one import
// per module here, e.g.
//
//     import "./Welcome";
//     import "./Hub";
//
// Experience imports this file before Areas.build(). Empty in Wave 1: the
// world boots with zero areas (plus the interim markers, see Experience.ts).
// ─────────────────────────────────────────────────────────────────────────

export {};
