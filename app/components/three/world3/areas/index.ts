// ─────────────────────────────────────────────────────────────────────────
// Area registry (side-effect imports). Each area module calls
// `registerArea(id, build)` at module load; Experience imports this file
// before Areas.build().
//
// Areas without a module here still show their interim 3D title marker
// (Experience.buildInterimMarkers); since Wave 2b every area has one.
// ─────────────────────────────────────────────────────────────────────────

import "./Welcome";
import "./Hub";
import "./Projects";
import "./Journey";
import "./Eko";
import "./Music";
import "./About";
import "./Playground";
import "./Credits";
