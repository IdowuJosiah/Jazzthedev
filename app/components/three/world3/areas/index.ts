// ─────────────────────────────────────────────────────────────────────────
// Area registry (side-effect imports). Each Wave 2 area module calls
// `registerArea(id, build)` at module load; the integrator adds one import
// per module here. Experience imports this file before Areas.build().
//
// Areas without a module here still show their interim 3D title marker
// (Experience.buildInterimMarkers); each marker disappears once its module
// registers.
// ─────────────────────────────────────────────────────────────────────────

import "./Welcome";
import "./Hub";
