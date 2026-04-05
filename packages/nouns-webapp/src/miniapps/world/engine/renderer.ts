// ── World Renderer — Canvas draw orchestrator ────────────────────────

import type {
  Player,
  RemotePlayer,
  Camera,
  ForcePush,
  ScreenShake,
  MoveType,
} from './types';
import {
  TILE_SIZE,
  SPRITE_SIZE,
  GROUND_Y,
  FORCE_CONE_ANGLE,
} from './types';
import { worldToScreen, getVisibleTileRange } from './camera';
import { drawTile } from './tilemap';
import { ISLAND_MAP } from './tilemap';
import { getSprite, getSpriteFromKey } from './sprites';
import { getDayNightOverlay } from './daynight';
import { getOceanOverlayAlpha, getGranMajaTextAlpha, type OceanDeathState } from './ocean';
import type { CombatState } from './combat';

// ── Main render function ──────────────────────────────────────────────

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number,
  cam: Camera,
  player: Player,
  remotePlayers: Map<string, RemotePlayer>,
  combat: CombatState,
  oceanState: OceanDeathState,
  playerCount: number,
) {
  ctx.clearRect(0, 0, w, h);

  // ── 1. Draw tiles ──
  const { minTX, maxTX, minTY, maxTY } = getVisibleTileRange(cam, w, h);
  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      const tile = ISLAND_MAP[ty]?.[tx];
      if (tile === undefined) continue;
      const { sx, sy } = worldToScreen(tx * TILE_SIZE, ty * TILE_SIZE, cam, w, h, combat.shake);
      drawTile(ctx, tile, sx, sy, frame);
    }
  }

  // ── 2. Collect all players for Y-sorting ──
  interface Drawable {
    x: number;
    y: number;
    isLocal: boolean;
    player?: Player;
    remote?: RemotePlayer;
  }

  const drawables: Drawable[] = [];

  // Local player
  if (player.state !== 'dead' || player.deathTimer > 0) {
    drawables.push({ x: player.x, y: player.y, isLocal: true, player });
  }

  // Remote players
  remotePlayers.forEach(rp => {
    drawables.push({ x: rp.x, y: rp.y, isLocal: false, remote: rp });
  });

  // Sort by Y for depth
  drawables.sort((a, b) => a.y - b.y);

  // ── 3. Draw players ──
  for (const d of drawables) {
    if (d.isLocal && d.player) {
      drawPlayer(ctx, d.player, cam, w, h, frame, combat.shake);
    } else if (d.remote) {
      drawRemotePlayer(ctx, d.remote, cam, w, h, frame, combat.shake);
    }
  }

  // ── 4. Force push waves ──
  for (const fp of combat.forcePushes) {
    drawForcePush(ctx, fp, cam, w, h, combat.shake);
  }

  // ── 5. Particles ──
  for (const p of combat.particles) {
    const { sx, sy } = worldToScreen(p.x, p.y, cam, w, h, combat.shake);
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // ── 6. Floating text ──
  for (const t of combat.floatingTexts) {
    const { sx, sy } = worldToScreen(t.x, t.y, cam, w, h);
    const alpha = t.life / t.maxLife;
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${t.size}px monospace`;
    ctx.textAlign = 'center';

    // Outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, sx, sy);
    // Fill
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, sx, sy);
  }
  ctx.globalAlpha = 1;

  // ── 7. Day/night overlay ──
  const dn = getDayNightOverlay();
  if (dn.alpha > 0) {
    ctx.fillStyle = dn.color;
    ctx.globalAlpha = dn.alpha;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // ── 8. Ocean death overlay ──
  const oceanAlpha = getOceanOverlayAlpha(oceanState);
  if (oceanAlpha > 0) {
    ctx.fillStyle = '#000';
    ctx.globalAlpha = oceanAlpha;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  const majaAlpha = getGranMajaTextAlpha(oceanState);
  if (majaAlpha > 0) {
    ctx.globalAlpha = majaAlpha;
    ctx.font = 'bold 64px serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('Gran Maja', w / 2, h / 2 - 20);
    ctx.font = '24px serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('swallowed you whole', w / 2, h / 2 + 20);
    ctx.globalAlpha = 1;
  }

  // ── 9. Hit flash overlay ──
  if (player.hitFlash > 0) {
    ctx.fillStyle = `rgba(255, 0, 0, ${player.hitFlash * 0.15})`;
    ctx.fillRect(0, 0, w, h);
  }

  // ── 10. Slow-mo vignette ──
  if (combat.slowMo) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);
  }

  // ── 11. HUD ──
  drawHUD(ctx, w, h, player, playerCount, combat, frame);
}

// ── Draw local player ─────────────────────────────────────────────────

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  cam: Camera,
  w: number,
  h: number,
  frame: number,
  shake?: ScreenShake | null,
) {
  const { sx, sy } = worldToScreen(player.x, player.y, cam, w, h, shake);
  const drawY = sy + player.airborneY;
  const spriteSize = SPRITE_SIZE;
  const half = spriteSize / 2;

  ctx.save();
  ctx.translate(sx, drawY);

  // Backflip rotation
  if (player.state === 'backflip' && player.flipRotation > 0) {
    ctx.rotate(player.flipRotation * player.scaleX);
  }

  // Scale for facing direction
  ctx.scale(player.scaleX, 1);

  // i-frame blink
  if (player.iFrames > 0 && frame % 4 < 2) {
    ctx.globalAlpha = 0.4;
  }

  // Death fade
  if (player.state === 'dead') {
    ctx.globalAlpha = Math.max(0, player.deathTimer / 60);
    ctx.rotate(0.3); // tilt on death
  }

  // Respawn pulse
  if (player.state === 'respawning') {
    ctx.globalAlpha = 0.3 + Math.sin(frame * 0.15) * 0.2;
  }

  // Hit flash tint
  if (player.hitFlash > 0) {
    ctx.filter = `brightness(${1 + player.hitFlash * 0.5})`;
  }

  // Draw the sprite
  try {
    const seed = {
      background: parseInt(player.seedKey.split('-')[0]),
      body: parseInt(player.seedKey.split('-')[1]),
      accessory: parseInt(player.seedKey.split('-')[2]),
      head: parseInt(player.seedKey.split('-')[3]),
      glasses: parseInt(player.seedKey.split('-')[4]),
    };
    const sprite = getSprite(seed);
    ctx.drawImage(sprite, -half, -half, spriteSize, spriteSize);
  } catch {
    // Fallback: draw a colored square
    ctx.fillStyle = '#e04040';
    ctx.fillRect(-half, -half, spriteSize, spriteSize);
  }

  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  // ── Attack visuals ──
  if (player.attackTimer > 0 && player.attackType) {
    drawAttackEffect(ctx, player.attackType, player.attackTimer, half, frame);
  }

  // ── Block shield ──
  if (player.state === 'blocking') {
    ctx.strokeStyle = 'rgba(100,200,255,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, half + 6, 0, Math.PI * 2);
    ctx.stroke();
    // Parry flash in first frames
    if (player.blockTimer <= 8) {
      ctx.fillStyle = `rgba(100,200,255,${0.3 - player.blockTimer * 0.03})`;
      ctx.beginPath();
      ctx.arc(0, 0, half + 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  // ── Shadow (when airborne) ──
  if (player.airborneY < GROUND_Y - 2) {
    const shadowScale = Math.max(0.3, 1 + player.airborneY / 50);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + half - 2, half * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── HP bar ──
  if (player.hp < player.maxHp && player.state !== 'dead') {
    const barW = 30;
    const barH = 4;
    const barX = sx - barW / 2;
    const barY = drawY - half - 8;
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);
    const hpRatio = player.hp / player.maxHp;
    ctx.fillStyle = hpRatio > 0.5 ? '#4a4' : hpRatio > 0.25 ? '#ca4' : '#c44';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
  }

  // ── Walking bob ──
  // (handled by slight y oscillation in the sprite draw)
}

// ── Draw remote player ────────────────────────────────────────────────

function drawRemotePlayer(
  ctx: CanvasRenderingContext2D,
  rp: RemotePlayer,
  cam: Camera,
  w: number,
  h: number,
  frame: number,
  shake?: ScreenShake | null,
) {
  const { sx, sy } = worldToScreen(rp.x, rp.y, cam, w, h, shake);
  const drawY = sy + rp.airborneY;
  const half = SPRITE_SIZE / 2;

  ctx.save();
  ctx.translate(sx, drawY);

  if (rp.flipRotation > 0) {
    ctx.rotate(rp.flipRotation * rp.scaleX);
  }

  ctx.scale(rp.scaleX, 1);

  if (rp.state === 'dead') {
    ctx.globalAlpha = 0.3;
    ctx.rotate(0.3);
  }

  if (rp.hitFlash > 0) {
    ctx.filter = `brightness(${1 + rp.hitFlash * 0.5})`;
  }

  // Draw sprite
  try {
    const sprite = getSpriteFromKey(rp.seedKey);
    ctx.drawImage(sprite, -half, -half, SPRITE_SIZE, SPRITE_SIZE);
  } catch {
    ctx.fillStyle = '#4040e0';
    ctx.fillRect(-half, -half, SPRITE_SIZE, SPRITE_SIZE);
  }

  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  // Attack effects
  if (rp.attackTimer > 0 && rp.attackType) {
    drawAttackEffect(ctx, rp.attackType, rp.attackTimer, half, frame);
  }

  ctx.restore();

  // Shadow when airborne
  if (rp.airborneY < GROUND_Y - 2) {
    const shadowScale = Math.max(0.3, 1 + rp.airborneY / 50);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + half - 2, half * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // HP bar
  if (rp.hp < rp.maxHp && rp.state !== 'dead') {
    const barW = 30;
    const barH = 4;
    const barX = sx - barW / 2;
    const barY = drawY - half - 8;
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);
    const hpRatio = rp.hp / rp.maxHp;
    ctx.fillStyle = hpRatio > 0.5 ? '#4a4' : hpRatio > 0.25 ? '#ca4' : '#c44';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
  }

  // Name label
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  const label = `Noun #${rp.nounId}`;
  ctx.strokeText(label, sx, drawY - half - 12);
  ctx.fillText(label, sx, drawY - half - 12);
}

// ── Attack visual effects ─────────────────────────────────────────────

function drawAttackEffect(
  ctx: CanvasRenderingContext2D,
  move: MoveType,
  timer: number,
  half: number,
  _frame: number,
) {
  const progress = 1 - timer / 20; // rough normalized progress

  switch (move) {
    case 'punch': {
      // Quick jab line
      const extend = progress * 20;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half + extend, 0);
      ctx.stroke();
      break;
    }
    case 'kick': {
      // Arc sweep
      const angle = progress * Math.PI * 0.8 - Math.PI * 0.4;
      ctx.strokeStyle = 'rgba(255,200,100,0.6)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 4, half + 10, -Math.PI * 0.4, angle);
      ctx.stroke();
      break;
    }
    case 'uppercut': {
      // Upward slash
      const extent = progress * 28;
      ctx.strokeStyle = 'rgba(255,255,100,0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(6, 4);
      ctx.lineTo(10, -extent);
      ctx.stroke();
      // Star at tip
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(10, -extent, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'groundSlam': {
      // Radial shockwave rings
      const radius = progress * 50;
      ctx.strokeStyle = `rgba(255,150,0,${1 - progress})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, half, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,200,50,${(1 - progress) * 0.5})`;
      ctx.beginPath();
      ctx.arc(0, half, radius * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'spinAttack': {
      // Full rotation sweep
      const angle = progress * Math.PI * 4; // 2 full rotations
      ctx.strokeStyle = `rgba(100,200,255,${1 - progress * 0.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, half + 12, angle - 1, angle);
      ctx.stroke();
      // Trail
      ctx.strokeStyle = `rgba(100,200,255,${(1 - progress) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, half + 12, angle - 2, angle - 1);
      ctx.stroke();
      break;
    }
    case 'roundhouse': {
      // Big circular sweep
      const angle = progress * Math.PI * 2;
      ctx.strokeStyle = `rgba(255,100,0,${1 - progress * 0.3})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, half + 16, 0, angle);
      ctx.stroke();
      // Fire trail
      ctx.strokeStyle = `rgba(255,200,0,${(1 - progress) * 0.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, half + 20, Math.max(0, angle - 1), angle);
      ctx.stroke();
      break;
    }
    case 'meteor': {
      // Huge AoE ring expanding
      const radius = progress * 60;
      ctx.strokeStyle = `rgba(255,50,0,${1 - progress})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, half, radius, 0, Math.PI * 2);
      ctx.stroke();
      // Inner fire
      ctx.fillStyle = `rgba(255,100,0,${(1 - progress) * 0.2})`;
      ctx.beginPath();
      ctx.arc(0, half, radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cyclone': {
      // Spiral outward
      const angle = progress * Math.PI * 6;
      const radius = 10 + progress * 40;
      ctx.strokeStyle = `rgba(0,200,255,${1 - progress * 0.5})`;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const a = angle + (i * Math.PI * 2) / 3;
        const r = radius;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
      // Vortex circle
      ctx.strokeStyle = `rgba(0,200,255,${(1 - progress) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

// ── Force push wave ───────────────────────────────────────────────────

function drawForcePush(
  ctx: CanvasRenderingContext2D,
  fp: ForcePush,
  cam: Camera,
  w: number,
  h: number,
  shake?: ScreenShake | null,
) {
  const { sx, sy } = worldToScreen(fp.x, fp.y, cam, w, h, shake);
  const progress = 1 - fp.life / fp.maxLife;
  const alpha = 1 - progress;

  ctx.save();
  ctx.translate(sx, sy);

  // Cone fill
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, fp.radius, fp.angle - FORCE_CONE_ANGLE / 2, fp.angle + FORCE_CONE_ANGLE / 2);
  ctx.closePath();

  const grad = ctx.createRadialGradient(0, 0, fp.radius * 0.2, 0, 0, fp.radius);
  grad.addColorStop(0, `rgba(68,136,255,${0.02 * alpha})`);
  grad.addColorStop(0.5, `rgba(68,136,255,${0.1 * alpha})`);
  grad.addColorStop(0.8, `rgba(255,255,255,${0.15 * alpha})`);
  grad.addColorStop(1, `rgba(68,136,255,${0.03 * alpha})`);
  ctx.fillStyle = grad;
  ctx.fill();

  // Wave front edge
  ctx.strokeStyle = `rgba(150,200,255,${0.6 * alpha})`;
  ctx.lineWidth = 2 + (1 - progress) * 3;
  ctx.beginPath();
  ctx.arc(0, 0, fp.radius, fp.angle - FORCE_CONE_ANGLE / 2, fp.angle + FORCE_CONE_ANGLE / 2);
  ctx.stroke();

  // Inner ripples
  for (let r = 0; r < 3; r++) {
    const ripR = fp.radius * (0.3 + r * 0.25);
    ctx.strokeStyle = `rgba(100,180,255,${(0.3 - r * 0.1) * alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, ripR, fp.angle - FORCE_CONE_ANGLE / 2, fp.angle + FORCE_CONE_ANGLE / 2);
    ctx.stroke();
  }

  ctx.restore();
}

// ── HUD ───────────────────────────────────────────────────────────────

function drawHUD(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  player: Player,
  playerCount: number,
  combat: CombatState,
  frame: number,
) {
  // ── HP bar (bottom center) ──
  const hpBarW = 200;
  const hpBarH = 12;
  const hpBarX = (w - hpBarW) / 2;
  const hpBarY = h - 40;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(hpBarX - 2, hpBarY - 2, hpBarW + 4, hpBarH + 4);
  ctx.fillStyle = '#222';
  ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
  const hpRatio = player.hp / player.maxHp;
  const hpColor = hpRatio > 0.5 ? '#44aa44' : hpRatio > 0.25 ? '#ccaa44' : '#cc4444';
  ctx.fillStyle = hpColor;
  ctx.fillRect(hpBarX, hpBarY, hpBarW * hpRatio, hpBarH);
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${player.hp} / ${player.maxHp}`, w / 2, hpBarY + hpBarH - 2);

  // ── Player count (top right) ──
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(`${playerCount} online`, w - 16, 24);

  // ── Combo counter (right side) ──
  if (player.comboHits >= 2) {
    const comboSize = 20 + Math.min(player.comboHits, 10) * 3;
    ctx.font = `bold ${comboSize}px monospace`;
    ctx.textAlign = 'right';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(`${player.comboHits}x`, w - 20, h / 2);
    ctx.fillStyle = '#ffdd00';
    ctx.fillText(`${player.comboHits}x`, w - 20, h / 2);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#ffaa00';
    ctx.fillText('COMBO', w - 20, h / 2 + 20);
  }

  // ── Force push cooldown (bottom right) ──
  if (combat.cooldowns.forcePush > 0) {
    const cd = combat.cooldowns.forcePush;
    const cdRatio = cd / 90;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(w - 50, h - 50, 34, 34);
    ctx.fillStyle = `rgba(68,136,255,${0.3 + cdRatio * 0.5})`;
    ctx.fillRect(w - 50, h - 50, 34, 34 * cdRatio);
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('Q', w - 33, h - 28);
  }

  // ── Controls hint (bottom left, fades after 5 seconds) ──
  if (frame < 300) {
    const alpha = frame < 240 ? 0.7 : 0.7 * (1 - (frame - 240) / 60);
    ctx.globalAlpha = alpha;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    const hints = [
      'WASD — move',
      'Click — punch    RClick — kick',
      'W+Click — uppercut    Space+S — backflip',
      'Space+Click — spin    Q — force push',
      'Shift — block/parry    Space+Dir — dash',
      'ESC — exit',
    ];
    hints.forEach((h, i) => {
      ctx.fillText(h, 16, h.length > 0 ? 28 + i * 16 : 28 + i * 16);
    });
    ctx.globalAlpha = 1;
  }

  // ── Kill feed (top right) ──
  const now = Date.now();
  const recentKills = combat.killFeed.filter(k => now - k.timestamp < 8000);
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  recentKills.slice(-5).forEach((k, i) => {
    const age = (now - k.timestamp) / 8000;
    ctx.globalAlpha = 1 - age;
    ctx.fillStyle = '#ff4444';
    ctx.fillText(`${k.killer} killed ${k.victim}`, w - 16, 44 + i * 16);
  });
  ctx.globalAlpha = 1;

  // ── Respawn timer ──
  if (player.state === 'dead' || player.state === 'respawning') {
    const seconds = player.state === 'dead'
      ? Math.ceil(player.deathTimer / 60) + 3
      : Math.ceil(player.respawnTimer / 60);
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText(`${seconds}`, w / 2, h / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${seconds}`, w / 2, h / 2);
    ctx.font = '18px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('RESPAWNING', w / 2, h / 2 + 30);
  }
}
