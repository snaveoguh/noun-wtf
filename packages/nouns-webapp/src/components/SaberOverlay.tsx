import { useCallback, useEffect, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import { useAccount, useEnsName } from 'wagmi';

import { stripNoggles } from '@/utils/addressAndENSDisplayUtils';

// ── Types ──────────────────────────────────────────────────────────────

interface Vec2 { x: number; y: number }
interface SaberTrail { x: number; y: number; age: number }

interface Sith {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  hp: number; maxHp: number;
  angle: number;
  state: 'chase' | 'attack' | 'stunned' | 'dead';
  stunTimer: number;
  attackCooldown: number;
  saberAngle: number;
  saberSwing: number;
  deathTime: number;
  forceHit: boolean;
}

/** Active Force Push wave (visual + hitbox) */
interface ForcePush {
  x: number; y: number;
  angle: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  isRemote: boolean;
  sourceId?: string;
  damage: number;
  hitIds: Set<number>;
  hitPlayer: boolean;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

interface FloatingText {
  x: number; y: number;
  text: string; color: string;
  life: number;
}

/** Leaderboard entry from server */
interface LeaderboardEntry {
  name: string;
  seconds: number;
  score: number;
  wave: number;
  timestamp: number;
}

/** Remote player state received from PartyKit */
interface RemotePlayer {
  x: number; y: number;
  angle: number;
  swinging: boolean;
  color: string;
  name: string;
  lastSeen: number;
  hp: number;
  targetX: number; targetY: number;
  targetAngle: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const SABER_LENGTH = 80;
const SABER_WIDTH = 4;
const SITH_SABER_LENGTH = 70;
const PLAYER_REACH = 100;
const SITH_CHASE_SPEED = 2.5;
const ATTACK_RANGE = 90;
const SITH_SPAWN_INTERVAL = 10000;
const MAX_SITHS = 5;
const PLAYER_HP = 100;

// Force Push config
const FORCE_CONE_ANGLE = Math.PI / 3;
const FORCE_MAX_RADIUS = 350;
const FORCE_PUSH_LIFE = 30;
const FORCE_COOLDOWN = 90;
const FORCE_DAMAGE = 50;
const FORCE_KNOCKBACK = 18;

// PartyKit config
const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'noun-wtf-saber.snaveoguh.partykit.dev';
const SEND_INTERVAL = 3;
const REMOTE_STALE_MS = 5000;

const SABER_COLORS = [
  '#00aaff', '#00ff88', '#ff00ff', '#ffaa00',
  '#00ffff', '#ff6600', '#aa00ff', '#88ff00',
  '#ff0088', '#00ff00', '#ffff00', '#ff4400',
];

// ── Helpers ────────────────────────────────────────────────────────────

const dist = (a: Vec2, b: Vec2) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
};
const randomInRange = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const angleDiff = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const isInCone = (
  originX: number, originY: number,
  targetX: number, targetY: number,
  coneAngle: number, coneHalfWidth: number, maxDist: number,
): boolean => {
  const ddx = targetX - originX;
  const ddy = targetY - originY;
  const dd = Math.sqrt(ddx * ddx + ddy * ddy);
  if (dd > maxDist || dd < 5) return false;
  const aa = Math.atan2(ddy, ddx);
  return Math.abs(angleDiff(coneAngle, aa)) < coneHalfWidth;
};

const NOUN_HEAD = [
  '  ████  ',
  ' ██████ ',
  '████████',
  '██▓▓██▓▓',
  '██▓▓██▓▓',
  '████████',
  ' ██  ██ ',
  '  ████  ',
];

const SITH_HEAD = [
  '  ████  ',
  ' ██████ ',
  '████████',
  '██░░██░░',
  '██░░██░░',
  '████████',
  ' ██  ██ ',
  '  ████  ',
];

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ── Draw helpers ──────────────────────────────────────────────────────

const drawSaber = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  angle: number,
  color: string,
  length: number = SABER_LENGTH,
  alpha: number = 1,
) => {
  const tipX = x + Math.cos(angle) * length;
  const tipY = y + Math.sin(angle) * length;
  const [r, g, b] = hexToRgb(color);

  ctx.shadowColor = color;
  ctx.shadowBlur = 25;
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 * alpha})`;
  ctx.lineWidth = SABER_WIDTH + 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  const grad = ctx.createLinearGradient(x, y, tipX, tipY);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.2 * alpha})`);
  grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${0.8 * alpha})`);
  grad.addColorStop(1, `rgba(255, 255, 255, ${0.9 * alpha})`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = SABER_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const hiltX = x - Math.cos(angle) * 15;
  const hiltY = y - Math.sin(angle) * 15;
  ctx.strokeStyle = `rgba(170, 170, 170, ${alpha})`;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(hiltX, hiltY);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.strokeStyle = `rgba(102, 102, 102, ${alpha})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(hiltX, hiltY);
  ctx.lineTo(x, y);
  ctx.stroke();
};

const drawNounHead = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  glowColor: string,
  skinColor: string,
  eyeColor: string,
  alpha: number = 1,
) => {
  const pixSize = 3;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 10;
  NOUN_HEAD.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === '█') ctx.fillStyle = skinColor.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
      else if (ch === '▓') ctx.fillStyle = eyeColor.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
      else continue;
      if (!ctx.fillStyle.includes('rgba')) {
        const [r, g, b] = hexToRgb(ch === '█' ? skinColor : eyeColor);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      ctx.fillRect(
        x - (row.length * pixSize) / 2 + rx * pixSize,
        y - (NOUN_HEAD.length * pixSize) / 2 + ry * pixSize,
        pixSize, pixSize,
      );
    }
  });
  ctx.shadowBlur = 0;
};

// ── Component ──────────────────────────────────────────────────────────

interface SaberOverlayProps {
  active: boolean;
  onClose: () => void;
}

const SaberOverlay: React.FC<SaberOverlayProps> = ({ active, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef<Vec2>({ x: 400, y: 300 });
  const prevMouseRef = useRef<Vec2>({ x: 400, y: 300 });
  const isSwinging = useRef(false);
  const swingAngle = useRef(0);
  const trailRef = useRef<SaberTrail[]>([]);
  const sithsRef = useRef<Sith[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const frameRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const scoreRef = useRef(0);
  const playerHpRef = useRef(PLAYER_HP);
  const hitFlashRef = useRef(0);
  const gameOverRef = useRef(false);
  const waveRef = useRef(1);
  const killsInWaveRef = useRef(0);
  const activeRef = useRef(active);
  const saberAngleRef = useRef(0); // current effective saber angle (updated in game loop)

  // Leaderboard + survival timer
  const gameStartRef = useRef(Date.now());
  const survivalSecondsRef = useRef(0);
  const leaderboardRef = useRef<LeaderboardEntry[]>([]);
  const scoreSubmittedRef = useRef(false);

  // Player identity from wallet (use ref so it doesn't restart the game loop)
  const { address } = useAccount();
  const { data: ensName } = useEnsName({ address });
  const displayEnsName = ensName ? stripNoggles(ensName) : null;
  const playerNameRef = useRef('Anon');
  playerNameRef.current = displayEnsName || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Anon');

  // Force Push state
  const forcePushesRef = useRef<ForcePush[]>([]);
  const forceCooldownRef = useRef(0);
  const forceScreenShakeRef = useRef(0);

  // Multiplayer state
  const wsRef = useRef<PartySocket | null>(null);
  const remotePlayersRef = useRef<Map<string, RemotePlayer>>(new Map());
  const myColorRef = useRef(SABER_COLORS[Math.floor(Math.random() * SABER_COLORS.length)]);
  const playerCountRef = useRef(1);
  const [, setPlayerCount] = useState(1);
  const [, setTick] = useState(0);

  useEffect(() => { activeRef.current = active; }, [active]);

  // ── WebSocket connection ──────────────────────────────────────────

  useEffect(() => {
    if (!active) {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      remotePlayersRef.current.clear();
      playerCountRef.current = 1;
      setPlayerCount(1);
      return;
    }

    const ws = new PartySocket({ host: PARTYKIT_HOST, room: 'saber-arena' });

    ws.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === 'player') {
          const existing = remotePlayersRef.current.get(data.id);
          if (existing) {
            existing.targetX = data.x;
            existing.targetY = data.y;
            existing.targetAngle = data.angle;
            existing.swinging = data.swinging;
            existing.color = data.color;
            existing.name = data.name;
            existing.hp = data.hp ?? 100;
            existing.lastSeen = Date.now();
          } else {
            remotePlayersRef.current.set(data.id, {
              x: data.x, y: data.y, angle: data.angle,
              swinging: data.swinging, color: data.color, name: data.name,
              hp: data.hp ?? 100, lastSeen: Date.now(),
              targetX: data.x, targetY: data.y, targetAngle: data.angle,
            });
          }
        } else if (data.type === 'force') {
          // Ignore our own force push echoed back from the server
          if (data.id === ws.id) return;
          forcePushesRef.current.push({
            x: data.x, y: data.y, angle: data.angle,
            radius: 20, maxRadius: FORCE_MAX_RADIUS,
            life: FORCE_PUSH_LIFE, maxLife: FORCE_PUSH_LIFE,
            color: data.color || '#ff0000',
            isRemote: true, sourceId: data.id, damage: FORCE_DAMAGE,
            hitIds: new Set(), hitPlayer: false,
          });
          forceScreenShakeRef.current = Math.max(forceScreenShakeRef.current, 0.6);
          try { navigator.vibrate?.(80); } catch { /* noop */ }
        } else if (data.type === 'sync') {
          const players = data.players as Record<string, RemotePlayer>;
          for (const [id, p] of Object.entries(players)) {
            remotePlayersRef.current.set(id, {
              ...p, hp: p.hp ?? 100,
              targetX: p.x, targetY: p.y, targetAngle: p.angle,
              lastSeen: Date.now(),
            });
          }
          if (data.count) { playerCountRef.current = data.count; setPlayerCount(data.count); }
        } else if (data.type === 'leaderboard') {
          leaderboardRef.current = data.entries ?? [];
        } else if (data.type === 'join') {
          playerCountRef.current = data.count; setPlayerCount(data.count);
        } else if (data.type === 'leave') {
          remotePlayersRef.current.delete(data.id);
          playerCountRef.current = data.count; setPlayerCount(data.count);
        }
      } catch { /* Ignore bad messages */ }
    });

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'leaderboard_get' }));
    });

    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; remotePlayersRef.current.clear(); };
  }, [active]);

  // Reset game state when activated
  useEffect(() => {
    if (active) {
      sithsRef.current = [];
      particlesRef.current = [];
      floatingTextsRef.current = [];
      forcePushesRef.current = [];
      trailRef.current = [];
      scoreRef.current = 0;
      playerHpRef.current = PLAYER_HP;
      hitFlashRef.current = 0;
      forceScreenShakeRef.current = 0;
      forceCooldownRef.current = 0;
      gameOverRef.current = false;
      waveRef.current = 1;
      killsInWaveRef.current = 0;
      lastSpawnRef.current = Date.now();
      gameStartRef.current = Date.now();
      survivalSecondsRef.current = 0;
      scoreSubmittedRef.current = false;
      myColorRef.current = SABER_COLORS[Math.floor(Math.random() * SABER_COLORS.length)];
      setTick(t => t + 1);
    }
  }, [active]);

  const spawnSith = useCallback((w: number, h: number) => {
    if (sithsRef.current.filter(s => s.state !== 'dead').length >= MAX_SITHS) return;
    const edge = Math.floor(Math.random() * 4);
    let x: number, y: number;
    switch (edge) {
      case 0: x = -30; y = randomInRange(50, h - 50); break;
      case 1: x = w + 30; y = randomInRange(50, h - 50); break;
      case 2: x = randomInRange(50, w - 50); y = -30; break;
      default: x = randomInRange(50, w - 50); y = h + 30; break;
    }
    const hpBonus = Math.floor(waveRef.current / 2) * 10;
    sithsRef.current.push({
      id: Date.now() + Math.random(), x, y, vx: 0, vy: 0,
      hp: 30 + hpBonus, maxHp: 30 + hpBonus,
      angle: 0, state: 'chase', stunTimer: 0, attackCooldown: 0,
      saberAngle: 0, saberSwing: 0, deathTime: 0, forceHit: false,
    });
  }, []);

  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x, y, vx: randomInRange(-4, 4), vy: randomInRange(-4, 4),
        life: randomInRange(15, 40), maxLife: 40, color, size: randomInRange(1, 4),
      });
    }
  }, []);

  const spawnFloatingText = useCallback((x: number, y: number, text: string, color: string) => {
    floatingTextsRef.current.push({ x, y, text, color, life: 60 });
  }, []);

  // ── Main game loop ──────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e: MouseEvent) => {
      prevMouseRef.current = { ...mouseRef.current };
      mouseRef.current = { x: e.clientX, y: e.clientY };
      trailRef.current.push({ x: e.clientX, y: e.clientY, age: 0 });
      if (trailRef.current.length > 30) trailRef.current.shift();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isSwinging.current = true;
        swingAngle.current = 0;
        if (gameOverRef.current) {
          sithsRef.current = [];
          particlesRef.current = [];
          floatingTextsRef.current = [];
          forcePushesRef.current = [];
          scoreRef.current = 0;
          playerHpRef.current = PLAYER_HP;
          hitFlashRef.current = 0;
          forceCooldownRef.current = 0;
          gameOverRef.current = false;
          waveRef.current = 1;
          killsInWaveRef.current = 0;
          lastSpawnRef.current = Date.now();
          gameStartRef.current = Date.now();
          survivalSecondsRef.current = 0;
          scoreSubmittedRef.current = false;
        }
      }
    };

    const onMouseUp = () => { isSwinging.current = false; };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();

      // ── Force Push on "Q" ──
      if ((e.key === 'q' || e.key === 'Q') && !gameOverRef.current && forceCooldownRef.current <= 0) {
        e.preventDefault();
        const m = mouseRef.current;
        // Use the current saber direction (stored by game loop), not mouse delta
        const forceAngle = saberAngleRef.current;

        forcePushesRef.current.push({
          x: m.x, y: m.y, angle: forceAngle,
          radius: 20, maxRadius: FORCE_MAX_RADIUS,
          life: FORCE_PUSH_LIFE, maxLife: FORCE_PUSH_LIFE,
          color: myColorRef.current, isRemote: false, damage: FORCE_DAMAGE,
          hitIds: new Set(), hitPlayer: false,
        });

        forceCooldownRef.current = FORCE_COOLDOWN;
        forceScreenShakeRef.current = 1;
        try { navigator.vibrate?.([50, 30, 120]); } catch { /* noop */ }

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'force', x: m.x, y: m.y, angle: forceAngle, color: myColorRef.current,
          }));
        }

        spawnParticles(m.x, m.y, myColorRef.current, 12);
        spawnFloatingText(m.x, m.y - 40, 'FORCE', myColorRef.current);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    const t1 = setTimeout(() => spawnSith(canvas.width, canvas.height), 800);
    const t2 = setTimeout(() => spawnSith(canvas.width, canvas.height), 2500);
    const pixSize = 3;

    let stopped = false;

    const tick = () => {
      if (!activeRef.current || stopped) return;
      frameRef.current++;
      const frame = frameRef.current;
      const mouse = mouseRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const now = Date.now();

      ctx.clearRect(0, 0, w, h);

      if (hitFlashRef.current > 0) {
        ctx.fillStyle = `rgba(255, 0, 0, ${hitFlashRef.current * 0.15})`;
        ctx.fillRect(0, 0, w, h);
        hitFlashRef.current = Math.max(0, hitFlashRef.current - 0.02);
      }

      // Update survival timer
      if (!gameOverRef.current) {
        survivalSecondsRef.current = Math.floor((Date.now() - gameStartRef.current) / 1000);
      }

      if (gameOverRef.current) {
        // Submit score once
        if (!scoreSubmittedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
          scoreSubmittedRef.current = true;
          wsRef.current.send(JSON.stringify({
            type: 'leaderboard_submit',
            name: playerNameRef.current,
            seconds: survivalSecondsRef.current,
            score: scoreRef.current,
            wave: waveRef.current,
          }));
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, w, h);

        // Game over title
        ctx.font = 'bold 48px monospace';
        ctx.fillStyle = '#ff0000';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', w / 2, 80);

        // Stats
        ctx.font = 'bold 20px monospace';
        ctx.fillStyle = '#ff6666';
        ctx.fillText(`SURVIVED: ${survivalSecondsRef.current}s  •  SCORE: ${scoreRef.current}  •  WAVE: ${waveRef.current}`, w / 2, 115);
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#aaa';
        ctx.fillText(`PLAYING AS: ${playerNameRef.current}`, w / 2, 138);

        // Leaderboard
        const lb = leaderboardRef.current;
        if (lb.length > 0) {
          const lbX = w / 2;
          const lbTop = 165;
          const rowH = 22;

          // Header
          ctx.font = 'bold 16px monospace';
          ctx.fillStyle = '#00ccff';
          ctx.fillText('⚔ LEADERBOARD — SECONDS SURVIVED ⚔', lbX, lbTop);

          // Column headers
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = '#888';
          ctx.textAlign = 'left';
          ctx.fillText('#', lbX - 220, lbTop + 22);
          ctx.fillText('PLAYER', lbX - 200, lbTop + 22);
          ctx.textAlign = 'right';
          ctx.fillText('TIME', lbX + 120, lbTop + 22);
          ctx.fillText('SCORE', lbX + 180, lbTop + 22);
          ctx.fillText('WAVE', lbX + 220, lbTop + 22);

          // Entries
          const maxShow = Math.min(lb.length, 15);
          for (let i = 0; i < maxShow; i++) {
            const entry = lb[i];
            const ey = lbTop + 42 + i * rowH;
            const isMe = entry.name === playerNameRef.current && entry.seconds === survivalSecondsRef.current;

            ctx.font = isMe ? 'bold 12px monospace' : '12px monospace';
            ctx.fillStyle = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : isMe ? '#00ff88' : '#ccc';

            ctx.textAlign = 'left';
            ctx.fillText(`${i + 1}.`, lbX - 220, ey);
            // Truncate long names
            const displayName = entry.name.length > 20 ? entry.name.slice(0, 17) + '...' : entry.name;
            ctx.fillText(displayName, lbX - 200, ey);
            ctx.textAlign = 'right';
            ctx.fillText(`${entry.seconds}s`, lbX + 120, ey);
            ctx.fillText(`${entry.score}`, lbX + 180, ey);
            ctx.fillText(`${entry.wave}`, lbX + 220, ey);
          }
        }

        // Restart prompt
        ctx.font = '14px monospace';
        ctx.fillStyle = '#aaa';
        ctx.textAlign = 'center';
        ctx.fillText('CLICK TO RESTART • ESC TO EXIT', w / 2, h - 30);

        requestAnimationFrame(tick);
        return;
      }

      const spawnInterval = Math.max(3000, SITH_SPAWN_INTERVAL - waveRef.current * 500);
      if (now - lastSpawnRef.current > spawnInterval) {
        spawnSith(w, h);
        lastSpawnRef.current = now;
      }

      const dx = mouse.x - prevMouseRef.current.x;
      const dy = mouse.y - prevMouseRef.current.y;
      const saberAngle = Math.atan2(dy, dx);

      if (isSwinging.current) {
        swingAngle.current += 0.3;
        if (swingAngle.current > Math.PI) { isSwinging.current = false; swingAngle.current = 0; }
      }

      const effectiveAngle = saberAngle + (isSwinging.current ? Math.sin(swingAngle.current) * 1.2 : 0);
      saberAngleRef.current = effectiveAngle; // expose to keydown handler

      // Send position to PartyKit
      if (frame % SEND_INTERVAL === 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'update', x: mouse.x, y: mouse.y, angle: effectiveAngle,
          swinging: isSwinging.current, color: myColorRef.current, name: playerNameRef.current,
        }));
      }

      // Interpolate + draw remote players
      remotePlayersRef.current.forEach((rp, id) => {
        if (now - rp.lastSeen > REMOTE_STALE_MS) { remotePlayersRef.current.delete(id); return; }
        rp.x = lerp(rp.x, rp.targetX, 0.15);
        rp.y = lerp(rp.y, rp.targetY, 0.15);
        rp.angle = lerpAngle(rp.angle, rp.targetAngle, 0.15);
        const age = now - rp.lastSeen;
        const rpAlpha = age > 3000 ? Math.max(0, 1 - (age - 3000) / 2000) : 1;
        drawSaber(ctx, rp.x, rp.y, rp.angle, rp.color, SABER_LENGTH, rpAlpha);
        const rpHX = rp.x - Math.cos(rp.angle) * 30;
        const rpHY = rp.y - Math.sin(rp.angle) * 30;
        drawNounHead(ctx, rpHX, rpHY, rp.color, '#e0d7c8', rp.color, rpAlpha);
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = `rgba(255, 255, 255, ${rpAlpha * 0.7})`;
        ctx.textAlign = 'center';
        ctx.fillText(rp.name, rpHX, rpHY - 18);
        if (rp.swinging) {
          const [sr, sg, sb] = hexToRgb(rp.color);
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, 15, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${0.15 * rpAlpha})`;
          ctx.fill();
        }
      });

      // Saber trail
      const trail = trailRef.current;
      for (let i = 1; i < trail.length; i++) {
        const tt = trail[i];
        const trAlpha = (1 - tt.age / 30) * 0.4;
        tt.age += 0.5;
        const [tr, tg, tb] = hexToRgb(myColorRef.current);
        ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${trAlpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(tt.x, tt.y);
        ctx.stroke();
      }
      trailRef.current = trail.filter(tt => tt.age < 30);

      // Player saber
      drawSaber(ctx, mouse.x, mouse.y, effectiveAngle, myColorRef.current);
      const saberTipX = mouse.x + Math.cos(effectiveAngle) * SABER_LENGTH;
      const saberTipY = mouse.y + Math.sin(effectiveAngle) * SABER_LENGTH;
      const headX = mouse.x - Math.cos(effectiveAngle) * 30;
      const headY = mouse.y - Math.sin(effectiveAngle) * 30;
      drawNounHead(ctx, headX, headY, myColorRef.current, '#e0d7c8', myColorRef.current);

      // ── Siths ──
      sithsRef.current.forEach(sith => {
        if (sith.state === 'dead') {
          if (sith.deathTime > 0 && now - sith.deathTime < 100) spawnParticles(sith.x, sith.y, '#ff4444', 3);
          return;
        }
        const distToPlayer = dist(sith, mouse);
        if (sith.stunTimer > 0) { sith.stunTimer--; sith.state = 'stunned'; }
        else if (distToPlayer < ATTACK_RANGE) { sith.state = 'attack'; }
        else { sith.state = 'chase'; }

        if (sith.state === 'chase') {
          const ang = Math.atan2(mouse.y - sith.y, mouse.x - sith.x);
          sith.angle = ang;
          const speed = SITH_CHASE_SPEED + waveRef.current * 0.12;
          sith.vx = lerp(sith.vx, Math.cos(ang) * speed, 0.05);
          sith.vy = lerp(sith.vy, Math.sin(ang) * speed, 0.05);
          sith.x += sith.vx; sith.y += sith.vy;
        } else if (sith.state === 'attack') {
          const ang = Math.atan2(mouse.y - sith.y, mouse.x - sith.x);
          sith.angle = ang;
          sith.x += Math.cos(ang + Math.PI / 2) * 1.5;
          sith.y += Math.sin(ang + Math.PI / 2) * 1.5;
          sith.saberSwing += 0.15;
          if (sith.attackCooldown <= 0 && distToPlayer < ATTACK_RANGE) {
            const dmg = 8 + waveRef.current;
            playerHpRef.current = Math.max(0, playerHpRef.current - dmg);
            hitFlashRef.current = 1;
            spawnParticles(mouse.x, mouse.y, '#ff0000', 8);
            spawnFloatingText(mouse.x, mouse.y - 20, `-${dmg}`, '#ff4444');
            if (playerHpRef.current <= 0) gameOverRef.current = true;
            sith.attackCooldown = Math.max(30, 60 - waveRef.current * 2);
          } else { sith.attackCooldown = Math.max(0, sith.attackCooldown - 1); }
        } else if (sith.state === 'stunned') {
          sith.vx *= 0.9; sith.vy *= 0.9;
          sith.x += sith.vx; sith.y += sith.vy;
        }

        sith.x = clamp(sith.x, 20, w - 20);
        sith.y = clamp(sith.y, 20, h - 20);
        sith.saberAngle = sith.angle + Math.sin(sith.saberSwing) * 0.8;

        // Draw red saber
        const sTipX = sith.x + Math.cos(sith.saberAngle) * SITH_SABER_LENGTH;
        const sTipY = sith.y + Math.sin(sith.saberAngle) * SITH_SABER_LENGTH;
        ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 20;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)'; ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sith.x, sith.y); ctx.lineTo(sTipX, sTipY); ctx.stroke();
        const sGrad = ctx.createLinearGradient(sith.x, sith.y, sTipX, sTipY);
        sGrad.addColorStop(0, 'rgba(255, 50, 50, 0.3)');
        sGrad.addColorStop(0.5, 'rgba(255, 0, 0, 0.9)');
        sGrad.addColorStop(1, 'rgba(255, 180, 180, 1)');
        ctx.strokeStyle = sGrad; ctx.lineWidth = SABER_WIDTH;
        ctx.beginPath(); ctx.moveTo(sith.x, sith.y); ctx.lineTo(sTipX, sTipY); ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 200, 200, 0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sith.x, sith.y); ctx.lineTo(sTipX, sTipY); ctx.stroke();
        ctx.shadowBlur = 0;

        // Sith hilt
        const sHiltX = sith.x - Math.cos(sith.saberAngle) * 12;
        const sHiltY = sith.y - Math.sin(sith.saberAngle) * 12;
        ctx.strokeStyle = '#666'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(sHiltX, sHiltY); ctx.lineTo(sith.x, sith.y); ctx.stroke();

        // Sith head
        const sHeadX = sith.x - Math.cos(sith.saberAngle) * 25;
        const sHeadY = sith.y - Math.sin(sith.saberAngle) * 25;
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = sith.state === 'stunned' ? 2 : 8;
        const flashAlpha = sith.state === 'stunned' ? 0.5 + Math.sin(frame * 0.3) * 0.3 : 1;
        SITH_HEAD.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            const ch = row[rx];
            if (ch === '█') ctx.fillStyle = `rgba(60, 20, 20, ${flashAlpha})`;
            else if (ch === '░') ctx.fillStyle = `rgba(255, 255, 0, ${flashAlpha})`;
            else continue;
            ctx.fillRect(sHeadX - (row.length * pixSize) / 2 + rx * pixSize,
              sHeadY - (SITH_HEAD.length * pixSize) / 2 + ry * pixSize, pixSize, pixSize);
          }
        });
        ctx.shadowBlur = 0;

        const sithHpPct = sith.hp / sith.maxHp;
        ctx.fillStyle = 'rgba(60, 0, 0, 0.8)';
        ctx.fillRect(sHeadX - 15, sHeadY - 18, 30, 3);
        ctx.fillStyle = sithHpPct > 0.5 ? '#ff4444' : '#ff0000';
        ctx.fillRect(sHeadX - 15, sHeadY - 18, 30 * sithHpPct, 3);
      });

      // ── Swing hits ──
      if (isSwinging.current) {
        sithsRef.current.forEach(sith => {
          if (sith.state === 'dead') return;
          if (dist(sith, mouse) < PLAYER_REACH && dist({ x: saberTipX, y: saberTipY }, sith) < 50) {
            const dmg = 12 + Math.floor(Math.random() * 8);
            sith.hp -= dmg; sith.stunTimer = 20;
            sith.vx = (sith.x - mouse.x) * 0.15; sith.vy = (sith.y - mouse.y) * 0.15;
            spawnParticles(sith.x, sith.y, '#ff8800', 6);
            spawnParticles(sith.x, sith.y, '#ffff00', 4);
            spawnFloatingText(sith.x, sith.y - 30, `-${dmg}`, '#ffaa00');
            if (sith.hp <= 0) {
              sith.state = 'dead'; sith.deathTime = now;
              spawnParticles(sith.x, sith.y, '#ff0000', 20);
              spawnParticles(sith.x, sith.y, '#ffff00', 10);
              const pts = 100 * waveRef.current;
              scoreRef.current += pts;
              spawnFloatingText(sith.x, sith.y - 40, `+${pts}`, '#00ff00');
              killsInWaveRef.current++;
              if (killsInWaveRef.current >= 3 + waveRef.current) {
                waveRef.current++; killsInWaveRef.current = 0;
                spawnFloatingText(w / 2, h / 2, `WAVE ${waveRef.current}`, '#00ccff');
                for (let ii = 0; ii < Math.min(waveRef.current, 3); ii++) {
                  setTimeout(() => spawnSith(w, h), ii * 400);
                }
              }
            }
          }
        });
      }

      // ── Force Push cooldown ──
      if (forceCooldownRef.current > 0) forceCooldownRef.current--;

      // ── Force Push waves — update, collide, render ──
      forcePushesRef.current.forEach(fp => {
        fp.radius += (fp.maxRadius - 20) / fp.maxLife;
        fp.life--;
        const progress = 1 - fp.life / fp.maxLife;
        const wAlpha = Math.max(0, 1 - progress * 1.2);
        const [cr, cg, cb] = hexToRgb(fp.color);

        ctx.save();
        ctx.translate(fp.x, fp.y);

        // Cone fill
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, fp.radius, fp.angle - FORCE_CONE_ANGLE / 2, fp.angle + FORCE_CONE_ANGLE / 2);
        ctx.closePath();
        const fGrad = ctx.createRadialGradient(0, 0, fp.radius * 0.3, 0, 0, fp.radius);
        fGrad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${0.02 * wAlpha})`);
        fGrad.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, ${0.12 * wAlpha})`);
        fGrad.addColorStop(0.8, `rgba(255, 255, 255, ${0.18 * wAlpha})`);
        fGrad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, ${0.04 * wAlpha})`);
        ctx.fillStyle = fGrad;
        ctx.fill();

        // Wave front edge
        ctx.beginPath();
        ctx.arc(0, 0, fp.radius, fp.angle - FORCE_CONE_ANGLE / 2, fp.angle + FORCE_CONE_ANGLE / 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * wAlpha})`;
        ctx.lineWidth = 3 + (1 - progress) * 4;
        ctx.shadowColor = fp.color; ctx.shadowBlur = 20;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Inner ripple lines
        for (let rr = 0; rr < 3; rr++) {
          const ripR = fp.radius * (0.3 + rr * 0.25);
          const ripA = wAlpha * (0.4 - rr * 0.12);
          if (ripA > 0) {
            ctx.beginPath();
            ctx.arc(0, 0, ripR, fp.angle - FORCE_CONE_ANGLE / 2 * 0.8, fp.angle + FORCE_CONE_ANGLE / 2 * 0.8);
            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${ripA})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        ctx.restore();

        // Particles along wave front
        if (fp.life % 3 === 0) {
          const sa = fp.angle + (Math.random() - 0.5) * FORCE_CONE_ANGLE;
          spawnParticles(fp.x + Math.cos(sa) * fp.radius, fp.y + Math.sin(sa) * fp.radius, fp.color, 2);
        }

        // Collision with Siths (local force pushes only)
        // Force does reduced damage to Siths (20) but massive knockback + stun
        // Full 50 damage is for PvP only
        if (!fp.isRemote) {
          sithsRef.current.forEach(sith => {
            if (sith.state === 'dead' || fp.hitIds.has(sith.id)) return;
            if (isInCone(fp.x, fp.y, sith.x, sith.y, fp.angle, FORCE_CONE_ANGLE / 2, fp.radius)) {
              fp.hitIds.add(sith.id);
              const sithForceDmg = 20; // reduced vs NPCs
              sith.hp -= sithForceDmg; sith.stunTimer = 40;
              const pa = Math.atan2(sith.y - fp.y, sith.x - fp.x);
              sith.vx = Math.cos(pa) * FORCE_KNOCKBACK;
              sith.vy = Math.sin(pa) * FORCE_KNOCKBACK;
              spawnParticles(sith.x, sith.y, fp.color, 10);
              spawnParticles(sith.x, sith.y, '#ffffff', 5);
              spawnFloatingText(sith.x, sith.y - 30, `-${sithForceDmg}`, '#cc88ff');
              if (sith.hp <= 0) {
                sith.state = 'dead'; sith.deathTime = now;
                spawnParticles(sith.x, sith.y, '#ff0000', 20);
                spawnParticles(sith.x, sith.y, fp.color, 15);
                const pts = 150 * waveRef.current;
                scoreRef.current += pts;
                spawnFloatingText(sith.x, sith.y - 40, `+${pts}`, '#00ff00');
                killsInWaveRef.current++;
                if (killsInWaveRef.current >= 3 + waveRef.current) {
                  waveRef.current++; killsInWaveRef.current = 0;
                  spawnFloatingText(w / 2, h / 2, `WAVE ${waveRef.current}`, '#00ccff');
                  for (let ii = 0; ii < Math.min(waveRef.current, 3); ii++) {
                    setTimeout(() => spawnSith(w, h), ii * 400);
                  }
                }
              }
            }
          });
        }

        // Collision with local player (from remote force pushes)
        if (fp.isRemote && !fp.hitPlayer) {
          if (isInCone(fp.x, fp.y, mouse.x, mouse.y, fp.angle, FORCE_CONE_ANGLE / 2, fp.radius)) {
            fp.hitPlayer = true;
            playerHpRef.current = Math.max(0, playerHpRef.current - fp.damage);
            hitFlashRef.current = 1;
            forceScreenShakeRef.current = 1;
            spawnParticles(mouse.x, mouse.y, fp.color, 15);
            spawnFloatingText(mouse.x, mouse.y - 30, `-${fp.damage} FORCE`, '#cc88ff');
            try { navigator.vibrate?.([100, 50, 200]); } catch { /* noop */ }
            if (playerHpRef.current <= 0) gameOverRef.current = true;
          }
        }
      });
      forcePushesRef.current = forcePushesRef.current.filter(fp => fp.life > 0);

      // Screen-wide Force distortion overlay
      if (forceScreenShakeRef.current > 0) {
        const intensity = forceScreenShakeRef.current;
        ctx.fillStyle = `rgba(200, 180, 255, ${0.06 * intensity})`;
        ctx.fillRect(0, 0, w, h);
        for (let ii = 0; ii < 3; ii++) {
          const ringR = (1 - intensity) * 400 + ii * 100;
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(180, 140, 255, ${0.08 * intensity})`;
          ctx.lineWidth = 20 * intensity;
          ctx.stroke();
        }
        forceScreenShakeRef.current = Math.max(0, forceScreenShakeRef.current - 0.03);
      }

      // Clean dead siths
      sithsRef.current = sithsRef.current.filter(s => s.state !== 'dead' || now - s.deathTime < 2000);

      // Particles
      particlesRef.current.forEach(pp => {
        pp.x += pp.vx; pp.y += pp.vy; pp.vx *= 0.97; pp.vy *= 0.97; pp.life--;
        const pAlpha = pp.life / pp.maxLife;
        ctx.fillStyle = pp.color.includes('rgba') ? pp.color : pp.color + Math.floor(pAlpha * 255).toString(16).padStart(2, '0');
        ctx.beginPath(); ctx.arc(pp.x, pp.y, pp.size * pAlpha, 0, Math.PI * 2); ctx.fill();
      });
      particlesRef.current = particlesRef.current.filter(pp => pp.life > 0);

      // Floating texts
      floatingTextsRef.current.forEach(ft => {
        ft.y -= 1; ft.life--;
        const ftA = ft.life / 60;
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = ft.color + Math.floor(ftA * 255).toString(16).padStart(2, '0');
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
      });
      floatingTextsRef.current = floatingTextsRef.current.filter(ft => ft.life > 0);

      // ── HUD ──
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(16, 60, 204, 24);
      ctx.strokeStyle = myColorRef.current; ctx.lineWidth = 1;
      ctx.strokeRect(16, 60, 204, 24);
      const hpPct = playerHpRef.current / PLAYER_HP;
      const [hr, hg, hb] = hexToRgb(myColorRef.current);
      ctx.fillStyle = hpPct > 0.5 ? `rgb(${hr}, ${hg}, ${hb})` : hpPct > 0.25 ? '#ff8800' : '#ff0000';
      ctx.fillRect(18, 62, 200 * hpPct, 20);
      ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(`HP: ${playerHpRef.current}/${PLAYER_HP}`, 24, 77);

      // Force cooldown bar
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(16, 88, 204, 14);
      if (forceCooldownRef.current > 0) {
        const cdPct = forceCooldownRef.current / FORCE_COOLDOWN;
        ctx.fillStyle = 'rgba(180, 140, 255, 0.7)';
        ctx.fillRect(18, 90, 200 * (1 - cdPct), 10);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#cc88ff';
        ctx.fillText('FORCE [Q]', 24, 98);
      } else {
        ctx.fillStyle = 'rgba(180, 140, 255, 0.9)';
        ctx.fillRect(18, 90, 200, 10);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#fff';
        ctx.fillText('FORCE READY [Q]', 24, 98);
      }

      // Score + wave + player count + timer
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(w - 200, 60, 184, 52);
      ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#00ccff'; ctx.textAlign = 'right';
      ctx.fillText(`SCORE: ${scoreRef.current}`, w - 24, 77);
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#ff6666'; ctx.fillText(`WAVE ${waveRef.current}`, w - 100, 93);
      ctx.fillStyle = '#00ff88'; ctx.fillText(`${playerCountRef.current} ONLINE`, w - 24, 93);
      ctx.fillStyle = '#ffaa00'; ctx.fillText(`${survivalSecondsRef.current}s`, w - 24, 107);

      ctx.strokeStyle = `rgba(${hr}, ${hg}, ${hb}, 0.2)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 5, 0, Math.PI * 2); ctx.stroke();

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);

    return () => {
      stopped = true;
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(t1); clearTimeout(t2);
    };
  }, [active, spawnSith, spawnParticles, spawnFloatingText, onClose]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        pointerEvents: 'auto',
        cursor: 'none',
      }}
    />
  );
};

export default SaberOverlay;
