// ── WhiteFlash — Suspense fallback for FriedWorld lazy chunk ─────────
//
// Rendered inside the Canvas as a fallback while FriedWorld's chunk
// streams. Full-white scene: white background + ambient fog. No
// geometry, no lights that cast. Matches the "swap" phase visually so
// the transition feels seamless.

export function WhiteFlash() {
  return (
    <>
      <color attach="background" args={['#ffffff']} />
      <fog attach="fog" args={['#ffffff', 1, 4]} />
      <ambientLight intensity={1} />
    </>
  );
}

export default WhiteFlash;
