import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

interface Vec2 {
  x: number;
  y: number;
}

interface SaberTrail {
  x: number;
  y: number;
  age: number;
}

interface Sith {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  angle: number;
  state: 'patrol' | 'chase' | 'attack' | 'stunned' | 'dead';
  stunTimer: number;
  attackCooldown: number;
  saberAngle: number;
  saberSwing: number;
  spawnTime: number;
  deathTime: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const SABER_LENGTH = 80;
const SABER_WIDTH = 4;
const SITH_SABER_LENGTH = 70;
const PLAYER_REACH = 100;
const SITH_CHASE_SPEED = 2.8;
const ATTACK_RANGE = 90;
const SITH_SPAWN_INTERVAL = 8000;
const MAX_SITHS = 6;
const PLAYER_HP = 100;

// ── Helpers ────────────────────────────────────────────────────────────

const dist = (a: Vec2, b: Vec2) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const randomInRange = (min: number, max: number) => min + Math.random() * (max - min);

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// Noun-style pixel head (8x8)
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

// ── Component ──────────────────────────────────────────────────────────

const SaberArenaPage: React.FC = () => {
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
  const lastSpawnRef = useRef(Date.now());
  const scoreRef = useRef(0);
  const playerHpRef = useRef(PLAYER_HP);
  const hitFlashRef = useRef(0);
  const [, setScore] = useState(0);
  const [, setPlayerHp] = useState(PLAYER_HP);
  const [, setGameOver] = useState(false);
  const [, setWaveNum] = useState(1);
  const gameOverRef = useRef(false);
  const waveRef = useRef(1);
  const killsInWaveRef = useRef(0);

  // ── Spawn Sith ──────────────────────────────────────────────────────

  const spawnSith = useCallback((canvas: HTMLCanvasElement) => {
    if (sithsRef.current.filter(s => s.state !== 'dead').length >= MAX_SITHS) return;

    // Spawn from edges
    const edge = Math.floor(Math.random() * 4);
    let x: number, y: number;
    switch (edge) {
      case 0: x = -30; y = randomInRange(0, canvas.height); break;
      case 1: x = canvas.width + 30; y = randomInRange(0, canvas.height); break;
      case 2: x = randomInRange(0, canvas.width); y = -30; break;
      default: x = randomInRange(0, canvas.width); y = canvas.height + 30; break;
    }

    const hpBonus = Math.floor(waveRef.current / 2) * 10;

    sithsRef.current.push({
      id: Date.now() + Math.random(),
      x, y,
      vx: 0, vy: 0,
      hp: 30 + hpBonus,
      maxHp: 30 + hpBonus,
      angle: 0,
      state: 'chase',
      stunTimer: 0,
      attackCooldown: 0,
      saberAngle: 0,
      saberSwing: 0,
      spawnTime: Date.now(),
      deathTime: 0,
    });
  }, []);

  // ── Particles ─────────────────────────────────────────────────────

  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x, y,
        vx: randomInRange(-4, 4),
        vy: randomInRange(-4, 4),
        life: randomInRange(15, 40),
        maxLife: 40,
        color,
        size: randomInRange(1, 4),
      });
    }
  }, []);

  const spawnFloatingText = useCallback((x: number, y: number, text: string, color: string) => {
    floatingTextsRef.current.push({ x, y, text, color, life: 60 });
  }, []);

  // ── Restart ─────────────────────────────────────────────────────

  const restart = useCallback(() => {
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
    setScore(0);
    setPlayerHp(PLAYER_HP);
    setGameOver(false);
    setWaveNum(1);
  }, []);

  // ── Main game loop ──────────────────────────────────────────────

  useEffect(() => {
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

    // Mouse handlers
    const onMouseMove = (e: MouseEvent) => {
      prevMouseRef.current = { ...mouseRef.current };
      mouseRef.current = { x: e.clientX, y: e.clientY };
      // Add trail
      trailRef.current.push({ x: e.clientX, y: e.clientY, age: 0 });
      if (trailRef.current.length > 30) trailRef.current.shift();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isSwinging.current = true;
        swingAngle.current = 0;
      }
    };

    const onMouseUp = () => {
      isSwinging.current = false;
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);

    // Spawn initial Siths
    setTimeout(() => { spawnSith(canvas); }, 500);
    setTimeout(() => { spawnSith(canvas); }, 2000);

    // ── Game tick ────────────────────────────────────────────────

    const tick = () => {
      frameRef.current++;
      const frame = frameRef.current;
      const mouse = mouseRef.current;
      const w = canvas.width;
      const h = canvas.height;

      // ── Clear ──
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      // Hit flash overlay
      if (hitFlashRef.current > 0) {
        ctx.fillStyle = `rgba(255, 0, 0, ${hitFlashRef.current * 0.3})`;
        ctx.fillRect(0, 0, w, h);
        hitFlashRef.current = Math.max(0, hitFlashRef.current - 0.02);
      }

      // ── Background grid ──
      ctx.strokeStyle = 'rgba(0, 100, 255, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // ── Ambient particles ──
      if (frame % 10 === 0) {
        particlesRef.current.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: randomInRange(-0.3, 0.3),
          vy: randomInRange(-0.5, -0.1),
          life: 60,
          maxLife: 60,
          color: 'rgba(0, 80, 255, 0.3)',
          size: 1,
        });
      }

      if (gameOverRef.current) {
        // ── Game Over Screen ──
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
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
        ctx.fillStyle = '#888';
        ctx.fillText('CLICK TO RESTART', w / 2, h / 2 + 90);

        frameRef.current = requestAnimationFrame(tick) as unknown as number;
        return;
      }

      // ── Spawn timer ──
      const now = Date.now();
      const spawnInterval = Math.max(3000, SITH_SPAWN_INTERVAL - waveRef.current * 500);
      if (now - lastSpawnRef.current > spawnInterval) {
        spawnSith(canvas);
        lastSpawnRef.current = now;
      }

      // ── Player saber angle ──
      const dx = mouse.x - prevMouseRef.current.x;
      const dy = mouse.y - prevMouseRef.current.y;
      const saberAngle = Math.atan2(dy, dx);

      // Swing animation
      if (isSwinging.current) {
        swingAngle.current += 0.3;
        if (swingAngle.current > Math.PI) {
          isSwinging.current = false;
          swingAngle.current = 0;
        }
      }

      const effectiveAngle = saberAngle + (isSwinging.current ? Math.sin(swingAngle.current) * 1.2 : 0);

      // ── Draw player saber trail ──
      const trail = trailRef.current;
      for (let i = 1; i < trail.length; i++) {
        const t = trail[i];
        const alpha = (1 - t.age / 30) * 0.5;
        t.age += 0.5;
        ctx.strokeStyle = `rgba(0, 150, 255, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
      trailRef.current = trail.filter(t => t.age < 30);

      // ── Draw player saber ──
      const saberTipX = mouse.x + Math.cos(effectiveAngle) * SABER_LENGTH;
      const saberTipY = mouse.y + Math.sin(effectiveAngle) * SABER_LENGTH;

      // Saber glow
      const grad = ctx.createLinearGradient(mouse.x, mouse.y, saberTipX, saberTipY);
      grad.addColorStop(0, 'rgba(100, 180, 255, 0.2)');
      grad.addColorStop(0.5, 'rgba(0, 150, 255, 0.8)');
      grad.addColorStop(1, 'rgba(200, 230, 255, 1)');

      // Outer glow
      ctx.shadowColor = '#0088ff';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = 'rgba(0, 100, 255, 0.4)';
      ctx.lineWidth = SABER_WIDTH + 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mouse.x, mouse.y);
      ctx.lineTo(saberTipX, saberTipY);
      ctx.stroke();

      // Core beam
      ctx.strokeStyle = grad;
      ctx.lineWidth = SABER_WIDTH;
      ctx.beginPath();
      ctx.moveTo(mouse.x, mouse.y);
      ctx.lineTo(saberTipX, saberTipY);
      ctx.stroke();

      // Bright core
      ctx.strokeStyle = 'rgba(200, 230, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mouse.x, mouse.y);
      ctx.lineTo(saberTipX, saberTipY);
      ctx.stroke();

      ctx.shadowBlur = 0;

      // ── Hilt ──
      const hiltX = mouse.x - Math.cos(effectiveAngle) * 15;
      const hiltY = mouse.y - Math.sin(effectiveAngle) * 15;
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(hiltX, hiltY);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.stroke();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hiltX, hiltY);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.stroke();

      // ── Draw player Noun head ──
      const headX = mouse.x - Math.cos(effectiveAngle) * 30;
      const headY = mouse.y - Math.sin(effectiveAngle) * 30;
      const pixSize = 3;
      ctx.shadowColor = '#0088ff';
      ctx.shadowBlur = 8;
      NOUN_HEAD.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch === '█') ctx.fillStyle = '#e0d7c8';
          else if (ch === '▓') ctx.fillStyle = '#ff2222';
          else continue;
          ctx.fillRect(
            headX - (row.length * pixSize) / 2 + rx * pixSize,
            headY - (NOUN_HEAD.length * pixSize) / 2 + ry * pixSize,
            pixSize, pixSize,
          );
        }
      });
      ctx.shadowBlur = 0;

      // ── Update and draw Siths ──────────────────────────────────

      sithsRef.current.forEach(sith => {
        if (sith.state === 'dead') {
          // Death particles
          if (sith.deathTime > 0 && now - sith.deathTime < 100) {
            spawnParticles(sith.x, sith.y, '#ff4444', 3);
          }
          return;
        }

        const distToPlayer = dist(sith, mouse);

        // ── AI State machine ──
        if (sith.stunTimer > 0) {
          sith.stunTimer--;
          sith.state = 'stunned';
        } else if (distToPlayer < ATTACK_RANGE) {
          sith.state = 'attack';
        } else {
          sith.state = 'chase';
        }

        // ── Movement ──
        if (sith.state === 'chase') {
          const angle = Math.atan2(mouse.y - sith.y, mouse.x - sith.x);
          sith.angle = angle;
          const speed = SITH_CHASE_SPEED + waveRef.current * 0.15;
          sith.vx = lerp(sith.vx, Math.cos(angle) * speed, 0.05);
          sith.vy = lerp(sith.vy, Math.sin(angle) * speed, 0.05);
          sith.x += sith.vx;
          sith.y += sith.vy;
        } else if (sith.state === 'attack') {
          // Circle strafe
          const angle = Math.atan2(mouse.y - sith.y, mouse.x - sith.x);
          sith.angle = angle;
          const strafeAngle = angle + Math.PI / 2;
          sith.x += Math.cos(strafeAngle) * 1.5;
          sith.y += Math.sin(strafeAngle) * 1.5;

          // Swing saber
          sith.saberSwing += 0.15;

          // Attack cooldown
          if (sith.attackCooldown <= 0) {
            if (distToPlayer < ATTACK_RANGE) {
              // Hit player!
              playerHpRef.current = Math.max(0, playerHpRef.current - 8 - waveRef.current);
              hitFlashRef.current = 1;
              setPlayerHp(playerHpRef.current);
              spawnParticles(mouse.x, mouse.y, '#ff0000', 8);
              spawnFloatingText(mouse.x, mouse.y - 20, `-${8 + waveRef.current}`, '#ff4444');

              if (playerHpRef.current <= 0) {
                gameOverRef.current = true;
                setGameOver(true);
              }
              sith.attackCooldown = 60 - waveRef.current * 2; // Faster attacks in later waves
            }
          } else {
            sith.attackCooldown--;
          }
        } else if (sith.state === 'stunned') {
          sith.vx *= 0.9;
          sith.vy *= 0.9;
          sith.x += sith.vx;
          sith.y += sith.vy;
        }

        // Keep in bounds
        sith.x = clamp(sith.x, 20, w - 20);
        sith.y = clamp(sith.y, 20, h - 20);

        sith.saberAngle = sith.angle + Math.sin(sith.saberSwing) * 0.8;

        // ── Draw Sith ──

        // Red saber glow
        const sTipX = sith.x + Math.cos(sith.saberAngle) * SITH_SABER_LENGTH;
        const sTipY = sith.y + Math.sin(sith.saberAngle) * SITH_SABER_LENGTH;

        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 15;

        // Outer glow
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sith.x, sith.y);
        ctx.lineTo(sTipX, sTipY);
        ctx.stroke();

        // Red blade
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

        // Core
        ctx.strokeStyle = 'rgba(255, 200, 200, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sith.x, sith.y);
        ctx.lineTo(sTipX, sTipY);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Hilt
        const sHiltX = sith.x - Math.cos(sith.saberAngle) * 12;
        const sHiltY = sith.y - Math.sin(sith.saberAngle) * 12;
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(sHiltX, sHiltY);
        ctx.lineTo(sith.x, sith.y);
        ctx.stroke();

        // Sith Noun head
        const sHeadX = sith.x - Math.cos(sith.saberAngle) * 25;
        const sHeadY = sith.y - Math.sin(sith.saberAngle) * 25;

        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = sith.state === 'stunned' ? 2 : 6;

        const flashAlpha = sith.state === 'stunned' ? 0.5 + Math.sin(frame * 0.3) * 0.3 : 1;
        SITH_HEAD.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            const ch = row[rx];
            if (ch === '█') {
              ctx.fillStyle = `rgba(60, 20, 20, ${flashAlpha})`;
            } else if (ch === '░') {
              ctx.fillStyle = `rgba(255, 255, 0, ${flashAlpha})`;
            } else continue;
            ctx.fillRect(
              sHeadX - (row.length * pixSize) / 2 + rx * pixSize,
              sHeadY - (SITH_HEAD.length * pixSize) / 2 + ry * pixSize,
              pixSize, pixSize,
            );
          }
        });

        ctx.shadowBlur = 0;

        // HP bar
        const hpBarW = 30;
        const hpBarH = 3;
        const hpPct = sith.hp / sith.maxHp;
        ctx.fillStyle = 'rgba(60, 0, 0, 0.7)';
        ctx.fillRect(sHeadX - hpBarW / 2, sHeadY - 18, hpBarW, hpBarH);
        ctx.fillStyle = hpPct > 0.5 ? '#ff4444' : '#ff0000';
        ctx.fillRect(sHeadX - hpBarW / 2, sHeadY - 18, hpBarW * hpPct, hpBarH);
      });

      // ── Check player swing hits ──
      if (isSwinging.current) {
        sithsRef.current.forEach(sith => {
          if (sith.state === 'dead') return;
          const d = dist(sith, mouse);
          if (d < PLAYER_REACH) {
            // Check if saber tip is near sith
            const tipDist = dist({ x: saberTipX, y: saberTipY }, sith);
            if (tipDist < 50) {
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
                setScore(scoreRef.current);
                spawnFloatingText(sith.x, sith.y - 40, `+${pts}`, '#00ff00');
                killsInWaveRef.current++;

                // Wave progression
                if (killsInWaveRef.current >= 3 + waveRef.current) {
                  waveRef.current++;
                  killsInWaveRef.current = 0;
                  setWaveNum(waveRef.current);
                  spawnFloatingText(w / 2, h / 2, `WAVE ${waveRef.current}`, '#00ccff');
                  // Spawn burst
                  for (let i = 0; i < Math.min(waveRef.current, 3); i++) {
                    setTimeout(() => spawnSith(canvas), i * 400);
                  }
                }
              }
            }
          }
        });
      }

      // Clean up dead siths after a while
      sithsRef.current = sithsRef.current.filter(
        s => s.state !== 'dead' || now - s.deathTime < 2000,
      );

      // ── Update and draw particles ──
      particlesRef.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.97;
        p.vy *= 0.97;
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
        ft.y -= 1;
        ft.life--;
        const alpha = ft.life / 60;
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = ft.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
      });
      floatingTextsRef.current = floatingTextsRef.current.filter(ft => ft.life > 0);

      // ── HUD ──
      // Player HP bar
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(16, 16, 204, 24);
      ctx.strokeStyle = '#0088ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(16, 16, 204, 24);
      const hpPct = playerHpRef.current / PLAYER_HP;
      ctx.fillStyle = hpPct > 0.5 ? '#0088ff' : hpPct > 0.25 ? '#ff8800' : '#ff0000';
      ctx.fillRect(18, 18, 200 * hpPct, 20);
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(`HP: ${playerHpRef.current}/${PLAYER_HP}`, 24, 33);

      // Score
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#00ccff';
      ctx.textAlign = 'right';
      ctx.fillText(`SCORE: ${scoreRef.current}`, w - 20, 32);

      // Wave
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ff6666';
      ctx.fillText(`WAVE ${waveRef.current}`, w - 20, 52);

      // Crosshair (subtle since saber is cursor)
      ctx.strokeStyle = 'rgba(0, 150, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 5, 0, Math.PI * 2);
      ctx.stroke();

      frameRef.current = requestAnimationFrame(tick) as unknown as number;
    };

    frameRef.current = requestAnimationFrame(tick) as unknown as number;

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
    };
  }, [spawnSith, spawnParticles, spawnFloatingText]);

  // Click-to-restart handler
  const handleClick = useCallback(() => {
    if (gameOverRef.current) {
      restart();
    }
  }, [restart]);

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black"
      style={{ cursor: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onClick={handleClick}
      />

      {/* Title overlay */}
      <div className="pointer-events-none absolute left-0 right-0 top-12 text-center">
        <h1
          className="text-2xl tracking-widest"
          style={{
            fontFamily: 'monospace',
            color: '#0088ff',
            textShadow: '0 0 20px rgba(0, 136, 255, 0.5)',
          }}
        >
          ⚔ SABER ARENA ⚔
        </h1>
        <p
          className="mt-1 text-xs"
          style={{
            fontFamily: 'monospace',
            color: '#446',
          }}
        >
          CLICK TO SWING | DEFEAT THE SITH | SURVIVE THE WAVES
        </p>
      </div>

      {/* Mobile controls hint */}
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 text-center">
        <p
          className="text-xs"
          style={{
            fontFamily: 'monospace',
            color: '#333',
          }}
        >
          MOVE MOUSE TO AIM • LEFT CLICK TO SLASH • SURVIVE
        </p>
      </div>
    </div>
  );
};

export default SaberArenaPage;
