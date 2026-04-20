// ── SlomoPostFX — STUBBED ────────────────────────────────────────────
//
// @react-three/postprocessing's EffectComposer deep-compares its children
// via JSON.stringify in a memo-hash path, which hits React fibers' cyclic
// parent/children refs and crashes the whole Canvas. The crash reliably
// fires on world-swap (fried ↔ white) where the effect stack remounts.
//
// Stubbed to render nothing until the lib is patched or we switch to a
// post-FX path that doesn't rely on JSON.stringify for dep compares.
//
// triggerFocus() still drives the global time-scale ref + audio low-pass
// sweep in audioFx — slo-mo still feels audible + affects game speed,
// just without the vignette / chromatic visual layer.

import type { FC } from 'react';

export const SlomoPostFX: FC = () => null;

export default SlomoPostFX;
