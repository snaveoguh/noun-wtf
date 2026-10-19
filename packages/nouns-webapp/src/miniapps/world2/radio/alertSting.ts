// ── WORLDWIDE ALERT: the news-break sting (synthesised, nothing recorded) ─
//
// Teletype stabs over a rising siren and a sub hit: the "breaking news" cue
// before the DJ reads the latest on-chain item. Returns its length (s).

export function alertSting(ctx: BaseAudioContext, out: AudioNode, t: number): number {
  // siren: a square sweeping up twice
  const siren = ctx.createOscillator();
  siren.type = 'square';
  siren.frequency.setValueAtTime(520, t);
  siren.frequency.linearRampToValueAtTime(980, t + 0.45);
  siren.frequency.setValueAtTime(520, t + 0.5);
  siren.frequency.linearRampToValueAtTime(980, t + 0.95);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.07, t + 0.03);
  sg.gain.setValueAtTime(0.07, t + 0.9);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
  siren.connect(lp).connect(sg).connect(out);
  siren.start(t);
  siren.stop(t + 1.05);
  // teletype stabs
  for (let i = 0; i < 6; i++) {
    const at = t + 1.05 + i * 0.11;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = i % 3 === 2 ? 1568 : 1175;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.16, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.1);
  }
  // sub hit under the last stab
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(110, t + 1.7);
  sub.frequency.exponentialRampToValueAtTime(40, t + 2.3);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, t + 1.7);
  bg.gain.exponentialRampToValueAtTime(0.5, t + 1.71);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  sub.connect(bg).connect(out);
  sub.start(t + 1.7);
  sub.stop(t + 2.45);
  return 2.45;
}
