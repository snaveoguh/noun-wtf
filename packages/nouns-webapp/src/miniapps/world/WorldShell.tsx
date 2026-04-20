// ── WorldShell — default /world entry, wraps the legacy WorldPage ────
//
// In the hybrid rollout, the shell just re-exports the existing
// WorldPage (which internally renders WhiteRoom / fried world via
// `useWorldStore`). When the full extraction lands later, this file is
// where the <Canvas>, <SharedSystems>, <GlitchEntry>, <TransitionOverlay>,
// <GameHUD>, and <MobileControls> wiring will move.

import WorldPage from './WorldPage';

export function WorldShell() {
  return <WorldPage />;
}

export default WorldShell;
