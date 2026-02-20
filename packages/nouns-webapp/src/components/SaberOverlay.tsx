import { useCallback, useEffect, useRef, useState } from 'react';
import PartySocket from 'partysocket';

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

/** Remote player state received from PartyKit */
interface RemotePlayer {
  x: number; y: number;
  angle: number;
  swinging: boolean;
  color: string;
  name: string;
  lastSeen: number;
  // Interpolation targets
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

// PartyKit config
const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'noun-wtf-saber.snaveoguh.partykit.dev';
const SEND_INTERVAL = 3; // Send update every N frames (~20fps at 60fps)
const REMOTE_STALE_MS = 5000; // Remove remote players after 5s of silence

// Saber color palette for multiplayer — each player gets a random one
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

// Parse hex color to rgb components for alpha blending
const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ── Draw helpers ──────────────────────────────────────────────────────

/** Draw a lightsaber blade + hilt at given position/angle/color */
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

  // Outer glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 25;
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 * alpha})`;
  ctx.lineWidth = SABER_WIDTH + 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Core beam
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

  // Bright core
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Hilt
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

/** Draw a pixel-art Noun head */
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

      // Handle hex/named colors
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
      // Disconnect when deactivated
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      remotePlayersRef.current.clear();
      playerCountRef.current = 1;
      setPlayerCount(1);
      return;
    }

    // Connect to PartyKit
    const ws = new PartySocket({
      host: PARTYKIT_HOST,
      room: 'saber-arena',
    });

    ws.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === 'player') {
          // Single player update (most common)
          const existing = remotePlayersRef.current.get(data.id);
          if (existing) {
            existing.targetX = data.x;
            existing.targetY = data.y;
            existing.targetAngle = data.angle;
            existing.swinging = data.swinging;
            existing.color = data.color;
            existing.name = data.name;
            existing.lastSeen = Date.now();
          } else {
            remotePlayersRef.current.set(data.id, {
              x: data.x, y: data.y,
              angle: data.angle,
              swinging: data.swinging,
              color: data.color,
              name: data.name,
              lastSeen: Date.now(),
              targetX: data.x, targetY: data.y,
              targetAngle: data.angle,
            });
          }
        } else if (data.type === 'sync') {
          // Full state sync (on connect)
          const players = data.players as Record<string, RemotePlayer>;
          for (const [id, p] of Object.entries(players)) {
            remotePlayersRef.current.set(id, {
              ...p,
              targetX: p.x, targetY: p.y,
              targetAngle: p.angle,
              lastSeen: Date.now(),
            });
          }
          if (data.count) {
            playerCountRef.current = data.count;
            setPlayerCount(data.count);
          }
        } else if (data.type === 'join') {
          playerCountRef.current = data.count;
          setPlayerCount(data.count);
        } else if (data.type === 'leave') {
          remotePlayersRef.current.delete(data.id);
          playerCountRef.current = data.count;
          setPlayerCount(data.count);
        }
      } catch {
        // Ignore bad messages
      }
    });

    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
      remotePlayersRef.current.clear();
    };
  }, [active]);

  // Reset game state when activated
  useEffect(() => {
    if (active) {
      sithsRef.current = [];
      particlesRef.current = [];
      floatingTextsRef.current = [];
      trailRef.current = [];
      scoreRef.current = 0;
      playerHpRef.current = PLAYER_HP;
      hitFlashRef.current = 0;
      gameOverRef.current = false;
      waveRef.current = 1;
      killsInWaveRef.current = 0;
      lastSpawnRef.current = Date.now();
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
      id: Date.now() + Math.random(),
      x, y, vx: 0, vy: 0,
      hp: 30 + hpBonus, maxHp: 30 + hpBonus,
      angle: 0, state: 'chase',
      stunTimer: 0, attackCooldown: 0,
      saberAngle: 0, saberSwing: 0,
      deathTime: 0,
    });
  }, []);

  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x, y,
        vx: randomInRange(-4, 4), vy: randomInRange(-4, 4),
        life: randomInRange(15, 40), maxLife: 40,
        color, size: randomInRange(1, 4),
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

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
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
          scoreRef.current = 0;
          playerHpRef.current = PLAYER_HP;
          hitFlashRef.current = 0;
          gameOverRef.current = false;
          waveRef.current = 1;
          killsInWaveRef.current = 0;
          lastSpawnRef.current = Date.now();
        }
      }
    };

    const onMouseUp = () => { isSwinging.current = false; };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    const t1 = setTimeout(() => spawnSith(canvas.width, canvas.height), 800);
    const t2 = setTimeout(() => spawnSith(canvas.width, canvas.height), 2500);

    const pixSize = 3;

    const tick = () => {
      if (!activeRef.current) return;

      frameRef.current++;
      const frame = frameRef.current;
      const mouse = mouseRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const now = Date.now();

      ctx.clearRect(0, 0, w, h);

      // Hit flash
      if (hitFlashRef.current > 0) {
        ctx.fillStyle = `rgba(255, 0, 0, ${hitFlashRef.current * 0.15})`;
        ctx.fillRect(0, 0, w, h);
        hitFlashRef.current = Math.max(0, hitFlashRef.current - 0.02);
      }

      // Game over
      if (gameOverRef.current) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, w, h);
        ctx.font = 'bold 48px monospace';
        ctx.fillStyle = '#ff0000';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', w / 2, h / 2 - 40);
        ctx.font = 'bold 24px monospace';
        ctx.fillStyle = '#ff6666';
        ctx.fillText(`SCORE: ${scoreRef.current}`, w / 2, h / 2 + 10);
        ctx.fillText(`WAVE: ${waveRef.current}`, w / 2, h / 2 + 45);
        ctx.font = '16px monospace';
        ctx.fillStyle = '#aaa';
        ctx.fillText('CLICK TO RESTART • ESC TO EXIT', w / 2, h / 2 + 90);
        requestAnimationFrame(tick);
        return;
      }

      // Spawn timer
      const spawnInterval = Math.max(3000, SITH_SPAWN_INTERVAL - waveRef.current * 500);
      if (now - lastSpawnRef.current > spawnInterval) {
        spawnSith(w, h);
        lastSpawnRef.current = now;
      }

      // Player saber angle
      const dx = mouse.x - prevMouseRef.current.x;
      const dy = mouse.y - prevMouseRef.current.y;
      const saberAngle = Math.atan2(dy, dx);

      if (isSwinging.current) {
        swingAngle.current += 0.3;
        if (swingAngle.current > Math.PI) {
          isSwinging.current = false;
          swingAngle.current = 0;
        }
      }

      const effectiveAngle = saberAngle + (isSwinging.current ? Math.sin(swingAngle.current) * 1.2 : 0);

      // ── Send position to PartyKit ──
      if (frame % SEND_INTERVAL === 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'update',
          x: mouse.x,
          y: mouse.y,
          angle: effectiveAngle,
          swinging: isSwinging.current,
          color: myColorRef.current,
          name: 'Noun',
        }));
      }

      // ── Interpolate + draw remote players ──
      remotePlayersRef.current.forEach((rp, id) => {
        if (now - rp.lastSeen > REMOTE_STALE_MS) {
          remotePlayersRef.current.delete(id);
          return;
        }

        // Smooth interpolation
        rp.x = lerp(rp.x, rp.targetX, 0.15);
        rp.y = lerp(rp.y, rp.targetY, 0.15);
        rp.angle = lerpAngle(rp.angle, rp.targetAngle, 0.15);

        // Staleness → fade out
        const age = now - rp.lastSeen;
        const alpha = age > 3000 ? Math.max(0, 1 - (age - 3000) / 2000) : 1;

        // Draw remote saber
        drawSaber(ctx, rp.x, rp.y, rp.angle, rp.color, SABER_LENGTH, alpha);

        // Draw remote Noun head
        const headX = rp.x - Math.cos(rp.angle) * 30;
        const headY = rp.y - Math.sin(rp.angle) * 30;
        drawNounHead(ctx, headX, headY, rp.color, '#e0d7c8', rp.color, alpha);

        // Name tag
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
        ctx.textAlign = 'center';
        ctx.fillText(rp.name, headX, headY - 18);

        // Swing flash effect
        if (rp.swinging) {
          const [r, g, b] = hexToRgb(rp.color);
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, 15, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.15 * alpha})`;
          ctx.fill();
        }
      });

      // ── Saber trail ──
      const trail = trailRef.current;
      for (let i = 1; i < trail.length; i++) {
        const t = trail[i];
        const alpha = (1 - t.age / 30) * 0.4;
        t.age += 0.5;
        const [r, g, b] = hexToRgb(myColorRef.current);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
      trailRef.current = trail.filter(t => t.age < 30);

      // ── Player saber ──
      drawSaber(ctx, mouse.x, mouse.y, effectiveAngle, myColorRef.current);

      const saberTipX = mouse.x + Math.cos(effectiveAngle) * SABER_LENGTH;
      const saberTipY = mouse.y + Math.sin(effectiveAngle) * SABER_LENGTH;

      // Player Noun head
      const headX = mouse.x - Math.cos(effectiveAngle) * 30;
      const headY = mouse.y - Math.sin(effectiveAngle) * 30;
      drawNounHead(ctx, headX, headY, myColorRef.current, '#e0d7c8', myColorRef.current);

      // ── Siths ──────────────────────────────────────────────────────

      sithsRef.current.forEach(sith => {
        if (sith.state === 'dead') {
          if (sith.deathTime > 0 && now - sith.deathTime < 100) {
            spawnParticles(sith.x, sith.y, '#ff4444', 3);
          }
          return;
        }

        const distToPlayer = dist(sith, mouse);

        if (sith.stunTimer > 0) {
          sith.stunTimer--;
          sith.state = 'stunned';
        } else if (distToPlayer < ATTACK_RANGE) {
          sith.state = 'attack';
        } else {
          sith.state = 'chase';
        }

        if (sith.state === 'chase') {
          const angle = Math.atan2(mouse.y - sith.y, mouse.x - sith.x);
          sith.angle = angle;
          const speed = SITH_CHASE_SPEED + waveRef.current * 0.12;
          sith.vx = lerp(sith.vx, Math.cos(angle) * speed, 0.05);
          sith.vy = lerp(sith.vy, Math.sin(angle) * speed, 0.05);
          sith.x += sith.vx;
          sith.y += sith.vy;
        } else if (sith.state === 'attack') {
          const angle = Math.atan2(mouse.y - sith.y, mouse.x - sith.x);
          sith.angle = angle;
          sith.x += Math.cos(angle + Math.PI / 2) * 1.5;
          sith.y += Math.sin(angle + Math.PI / 2) * 1.5;
          sith.saberSwing += 0.15;

          if (sith.attackCooldown <= 0 && distToPlayer < ATTACK_RANGE) {
            const dmg = 8 + waveRef.current;
            playerHpRef.current = Math.max(0, playerHpRef.current - dmg);
            hitFlashRef.current = 1;
            spawnParticles(mouse.x, mouse.y, '#ff0000', 8);
            spawnFloatingText(mouse.x, mouse.y - 20, `-${dmg}`, '#ff4444');
            if (playerHpRef.current <= 0) gameOverRef.current = true;
            sith.attackCooldown = Math.max(30, 60 - waveRef.current * 2);
          } else {
            sith.attackCooldown = Math.max(0, sith.attackCooldown - 1);
          }
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

        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 20;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sith.x, sith.y);
        ctx.lineTo(sTipX, sTipY);
        ctx.stroke();

        const sGrad = ctx.createLinearGradient(sith.x, sith.y, sTipX, sTipY);
        sGrad.addColorStop(0, 'rgba(255, 50, 50, 0.3)');
        sGrad.addColorStop(0.5, 'rgba(255, 0, 0, 0.9)');
        sGrad.addColorStop(1, 'rgba(255, 180, 180, 1)');
        ctx.strokeStyle = sGrad;
        ctx.lineWidth = SABER_WIDTH;
        ctx.beginPath();
        ctx.moveTo(sith.x, sith.y);
        ctx.lineTo(sTipX, sTipY);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 200, 200, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sith.x, sith.y);
        ctx.lineTo(sTipX, sTipY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Sith hilt
        const sHiltX = sith.x - Math.cos(sith.saberAngle) * 12;
        const sHiltY = sith.y - Math.sin(sith.saberAngle) * 12;
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(sHiltX, sHiltY);
        ctx.lineTo(sith.x, sith.y);
        ctx.stroke();

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
            ctx.fillRect(
              sHeadX - (row.length * pixSize) / 2 + rx * pixSize,
              sHeadY - (SITH_HEAD.length * pixSize) / 2 + ry * pixSize,
              pixSize, pixSize,
            );
          }
        });
        ctx.shadowBlur = 0;

        // HP bar
        const hpPct = sith.hp / sith.maxHp;
        ctx.fillStyle = 'rgba(60, 0, 0, 0.8)';
        ctx.fillRect(sHeadX - 15, sHeadY - 18, 30, 3);
        ctx.fillStyle = hpPct > 0.5 ? '#ff4444' : '#ff0000';
        ctx.fillRect(sHeadX - 15, sHeadY - 18, 30 * hpPct, 3);
      });

      // ── Swing hits ──
      if (isSwinging.current) {
        sithsRef.current.forEach(sith => {
          if (sith.state === 'dead') return;
          if (dist(sith, mouse) < PLAYER_REACH && dist({ x: saberTipX, y: saberTipY }, sith) < 50) {
            const dmg = 12 + Math.floor(Math.random() * 8);
            sith.hp -= dmg;
            sith.stunTimer = 20;
            sith.vx = (sith.x - mouse.x) * 0.15;
            sith.vy = (sith.y - mouse.y) * 0.15;
            spawnParticles(sith.x, sith.y, '#ff8800', 6);
            spawnParticles(sith.x, sith.y, '#ffff00', 4);
            spawnFloatingText(sith.x, sith.y - 30, `-${dmg}`, '#ffaa00');

            if (sith.hp <= 0) {
              sith.state = 'dead';
              sith.deathTime = now;
              spawnParticles(sith.x, sith.y, '#ff0000', 20);
              spawnParticles(sith.x, sith.y, '#ffff00', 10);
              const pts = 100 * waveRef.current;
              scoreRef.current += pts;
              spawnFloatingText(sith.x, sith.y - 40, `+${pts}`, '#00ff00');
              killsInWaveRef.current++;

              if (killsInWaveRef.current >= 3 + waveRef.current) {
                waveRef.current++;
                killsInWaveRef.current = 0;
                spawnFloatingText(w / 2, h / 2, `WAVE ${waveRef.current}`, '#00ccff');
                for (let i = 0; i < Math.min(waveRef.current, 3); i++) {
                  setTimeout(() => spawnSith(w, h), i * 400);
                }
              }
            }
          }
        });
      }

      // Clean dead siths
      sithsRef.current = sithsRef.current.filter(s => s.state !== 'dead' || now - s.deathTime < 2000);

      // ── Particles ──
      particlesRef.current.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.97; p.vy *= 0.97;
        p.life--;
        const alpha = p.life / p.maxLife;
        ctx.fillStyle = p.color.includes('rgba')
          ? p.color
          : p.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      });
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);

      // ── Floating texts ──
      floatingTextsRef.current.forEach(ft => {
        ft.y -= 1; ft.life--;
        const alpha = ft.life / 60;
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = ft.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
      });
      floatingTextsRef.current = floatingTextsRef.current.filter(ft => ft.life > 0);

      // ── HUD ──
      // HP bar
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(16, 60, 204, 24);
      ctx.strokeStyle = myColorRef.current;
      ctx.lineWidth = 1;
      ctx.strokeRect(16, 60, 204, 24);
      const hpPct = playerHpRef.current / PLAYER_HP;
      const [hr, hg, hb] = hexToRgb(myColorRef.current);
      ctx.fillStyle = hpPct > 0.5 ? `rgb(${hr}, ${hg}, ${hb})` : hpPct > 0.25 ? '#ff8800' : '#ff0000';
      ctx.fillRect(18, 62, 200 * hpPct, 20);
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(`HP: ${playerHpRef.current}/${PLAYER_HP}`, 24, 77);

      // Score + wave + player count
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(w - 180, 60, 164, 40);
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#00ccff';
      ctx.textAlign = 'right';
      ctx.fillText(`SCORE: ${scoreRef.current}`, w - 24, 77);
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#ff6666';
      ctx.fillText(`WAVE ${waveRef.current}`, w - 80, 95);
      // Live player count
      ctx.fillStyle = '#00ff88';
      ctx.fillText(`${playerCountRef.current} ONLINE`, w - 24, 95);

      // Crosshair
      ctx.strokeStyle = `rgba(${hr}, ${hg}, ${hb}, 0.2)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 5, 0, Math.PI * 2);
      ctx.stroke();

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(t1);
      clearTimeout(t2);
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
        pointerEvents: 'none',
        cursor: 'none',
      }}
    />
  );
};

export default SaberOverlay;
