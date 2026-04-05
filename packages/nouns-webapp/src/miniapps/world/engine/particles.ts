// ── Particle System — Hit sparks, dust, effects ─────────────────────

import type { Particle, FloatingText, ScreenShake, SlowMo, ForcePush } from './types';
import { FORCE_PUSH_LIFE } from './types';
import { randRange } from './physics';

// ── Particle spawn helpers ───────────���────────────────────────────────

export function spawnHitSparks(
  particles: Particle[],
  x: number,
  y: number,
  count = 10,
) {
  const colors = ['#ff8800', '#ffaa00', '#ffffff', '#ffdd44', '#ff4400'];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(2, 6);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randRange(10, 25),
      maxLife: 25,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: randRange(2, 5),
      gravity: 0.15,
    });
  }
}

export function spawnDustTrail(
  particles: Particle[],
  x: number,
  y: number,
  count = 5,
) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x + randRange(-8, 8),
      y: y + randRange(-4, 4),
      vx: randRange(-1, 1),
      vy: randRange(-2, -0.5),
      life: randRange(15, 30),
      maxLife: 30,
      color: `rgba(180,160,120,${randRange(0.3, 0.7)})`,
      size: randRange(3, 7),
    });
  }
}

export function spawnDeathExplosion(
  particles: Particle[],
  x: number,
  y: number,
) {
  const colors = ['#ff0000', '#ff4400', '#ff8800', '#ffcc00', '#ffffff'];
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(3, 10);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randRange(20, 45),
      maxLife: 45,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: randRange(3, 8),
      gravity: 0.1,
    });
  }
}

export function spawnComboFlash(
  particles: Particle[],
  x: number,
  y: number,
) {
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(4, 8);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randRange(15, 30),
      maxLife: 30,
      color: `hsl(${Math.random() * 60 + 30}, 100%, ${randRange(60, 90)}%)`,
      size: randRange(2, 6),
    });
  }
}

export function spawnGroundSlamWave(
  particles: Particle[],
  x: number,
  y: number,
) {
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const speed = randRange(4, 7);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.5,
      life: 20,
      maxLife: 20,
      color: '#ffaa00',
      size: 4,
    });
  }
}

// ── Floating damage text ──────────────────────────────────────────────

export function spawnDamageText(
  texts: FloatingText[],
  x: number,
  y: number,
  damage: number,
  isCrit: boolean,
) {
  texts.push({
    x: x + randRange(-10, 10),
    y: y - 20,
    vy: -1.5,
    text: `${damage}`,
    color: isCrit ? '#ff0000' : '#ffffff',
    size: isCrit ? 18 : 14,
    life: 60,
    maxLife: 60,
  });
}

export function spawnComboText(
  texts: FloatingText[],
  x: number,
  y: number,
  comboCount: number,
) {
  texts.push({
    x,
    y: y - 40,
    vy: -1,
    text: `${comboCount} HIT COMBO!`,
    color: '#ffdd00',
    size: 16 + Math.min(comboCount, 10) * 2,
    life: 90,
    maxLife: 90,
  });
}

export function spawnSpecialText(
  texts: FloatingText[],
  x: number,
  y: number,
  name: string,
) {
  texts.push({
    x,
    y: y - 50,
    vy: -0.8,
    text: name.toUpperCase(),
    color: '#ff4400',
    size: 24,
    life: 100,
    maxLife: 100,
  });
}

// ── Force push creation ───────────────────���───────────────────────────

export function createForcePush(
  x: number,
  y: number,
  angle: number,
  color: string,
  isRemote = false,
  sourceId?: string,
): ForcePush {
  return {
    x,
    y,
    angle,
    radius: 20,
    maxRadius: 200,
    life: FORCE_PUSH_LIFE,
    maxLife: FORCE_PUSH_LIFE,
    color,
    isRemote,
    sourceId,
    damage: 15,
    hitIds: new Set(),
  };
}

// ── Screen effects ────────────────────────────────────────────────────

export function createScreenShake(intensity: number, duration: number): ScreenShake {
  return { intensity, duration, timer: duration };
}

export function createSlowMo(factor: number, duration: number): SlowMo {
  return { factor, timer: duration };
}

// ── Update functions ───────────────────���──────────────────────────────

export function updateParticles(particles: Particle[]): Particle[] {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    if (p.gravity) p.vy += p.gravity;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life--;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
  return particles;
}

export function updateFloatingTexts(texts: FloatingText[]): FloatingText[] {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.y += t.vy;
    t.life--;
    if (t.life <= 0) {
      texts.splice(i, 1);
    }
  }
  return texts;
}

export function updateForcePushes(pushes: ForcePush[]): ForcePush[] {
  for (let i = pushes.length - 1; i >= 0; i--) {
    const fp = pushes[i];
    fp.radius += (fp.maxRadius - 20) / fp.maxLife;
    fp.life--;
    if (fp.life <= 0) {
      pushes.splice(i, 1);
    }
  }
  return pushes;
}

export function updateScreenShake(shake: ScreenShake | null): ScreenShake | null {
  if (!shake) return null;
  shake.timer--;
  return shake.timer <= 0 ? null : shake;
}

export function updateSlowMo(slowMo: SlowMo | null): SlowMo | null {
  if (!slowMo) return null;
  slowMo.timer--;
  return slowMo.timer <= 0 ? null : slowMo;
}
