// ── GameHUD — Modern Game-Style HUD for Nouns World ──────────────────
//
// Drop-in replacement for the inline HUD in WorldPage.tsx.
// All styles are inline. Monospace throughout. Dark semi-transparent panels.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Tile, MAP_SIZE, MAP_ORIGIN } from './types';
import { ISLAND_MAP } from './tilemap';

// ── Types ────────────────────────────────────────────────────────────

export interface GameHUDProps {
  hp: number;
  maxHp: number;
  playerCount: number;
  comboHits: number;
  controlsVisible: boolean;
  oceanPhase: string;
  oceanAlpha: number;
  majaAlpha: number;
  respawnTimer: number;
  isDead: boolean;
  /** Player position in WORLD tile coords (fractional) — centres the minimap. */
  playerTx?: number;
  playerTy?: number;
  micEnabled?: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
  activeSpeakers?: number;
  crowdMeter?: number;
  settlementWindow?: boolean;
  settleTriggered?: boolean;
  transcript?: string;
  weaponEquipped?: string | null;
  weaponAmmo?: number;
}

// ── Minimap colors ───────────────────────────────────────────────────

const MINI_COLORS: Record<number, string> = {
  [Tile.Water]: '#3b7dd8',
  [Tile.Sand]: '#e8d5a3',
  [Tile.Grass]: '#4a7a30',
  [Tile.Tree]: '#2e5c1a',
  [Tile.Flower]: '#5a8f3c',
  [Tile.Path]: '#c4a56e',
  [Tile.Rock]: '#777',
  [Tile.Spawn]: '#6aa84f',
  [Tile.DeepWater]: '#1a4f8a',
  [Tile.Arena]: '#8b6914',
  [Tile.Shallow]: '#7fb6e6',
};

// ── Emote definitions ────────────────────────────────────────────────

const EMOTES = [
  { key: '1', name: 'Wave', icon: '\u{1F44B}' },
  { key: '2', name: 'Dance', icon: '\u{1F57A}' },
  { key: '3', name: 'Sit', icon: '\u{1FA91}' },
  { key: '4', name: 'Laugh', icon: '\u{1F602}' },
  { key: '5', name: 'Thumbs Up', icon: '\u{1F44D}' },
  { key: '6', name: 'Noggles', icon: '\u2310\u25E7-\u25E7' },
  { key: '7', name: 'Headbang', icon: '\u{1F3B8}' },
  { key: '8', name: 'Dab', icon: '\u{1F938}' },
];

// ── Shared styles ────────────────────────────────────────────────────

const FONT: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
};

const PANEL: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.55)',
  backdropFilter: 'blur(4px)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 6,
};

// ── Minimap canvas renderer (static, only drawn once) ────────────────
//
// Full-resolution 640×640 image of the big island (1px per tile) built
// once via ImageData; the HUD shows a player-centred window of it.

let minimapDataURL: string | null = null;
const MINI_VIEW_TILES = 96; // tiles visible across the 120px window
const MINI_PX_PER_TILE = 120 / MINI_VIEW_TILES;

function hexToRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return hex.length === 4
    ? [((n >> 8) & 0xf) * 17, ((n >> 4) & 0xf) * 17, (n & 0xf) * 17]
    : [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function getMinimapImage(): string {
  if (minimapDataURL) return minimapDataURL;
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
  const rgb: Record<number, [number, number, number]> = {};
  for (const k of Object.keys(MINI_COLORS)) rgb[+k] = hexToRGB(MINI_COLORS[+k]);
  const fallback = hexToRGB('#1a4f8a');
  for (let y = 0; y < MAP_SIZE; y++) {
    const row = ISLAND_MAP[y];
    for (let x = 0; x < MAP_SIZE; x++) {
      const c = rgb[row[x]] ?? fallback;
      const i = (y * MAP_SIZE + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  minimapDataURL = canvas.toDataURL();
  return minimapDataURL;
}

// ── Weapon SVG icons ─────────────────────────────────────────────────

function WeaponIcon({ weapon, size = 24 }: { weapon: string; size?: number }) {
  const color = '#ff8844';
  if (weapon === 'shotgun') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="10" width="18" height="3" rx="1" fill={color} />
        <rect x="2" y="13" width="18" height="2" rx="1" fill={color} opacity={0.7} />
        <rect x="18" y="9" width="4" height="6" rx="1" fill={color} opacity={0.5} />
        <path d="M6 15 L4 20 L8 20 L7 15" fill={color} opacity={0.6} />
      </svg>
    );
  }
  if (weapon === 'uzi') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="4" y="9" width="14" height="3" rx="1" fill={color} />
        <rect x="16" y="8" width="4" height="5" rx="1" fill={color} opacity={0.5} />
        <rect x="8" y="12" width="3" height="6" rx="1" fill={color} opacity={0.6} />
        <rect x="2" y="10" width="3" height="1" fill={color} opacity={0.4} />
      </svg>
    );
  }
  // pistol (default)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="6" y="9" width="12" height="3" rx="1" fill={color} />
      <rect x="16" y="8" width="3" height="5" rx="1" fill={color} opacity={0.5} />
      <rect x="10" y="12" width="3" height="6" rx="1" fill={color} opacity={0.6} />
    </svg>
  );
}

// ── Heart icon ───────────────────────────────────────────────────────

function HeartIcon({ size = 14, color = '#ff4466' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
      <path d="M8 14s-5.5-3.5-6.5-6.5C.5 4.5 2 2 4.5 2 6 2 7.5 3.5 8 4c.5-.5 2-2 3.5-2C14 2 15.5 4.5 14.5 7.5 13.5 10.5 8 14 8 14z" />
    </svg>
  );
}

// ── Keyframes (injected once) ────────────────────────────────────────

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes hud-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    @keyframes hud-dot-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.6); opacity: 0.6; }
    }
    @keyframes hud-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes hud-emote-in {
      from { opacity: 0; transform: scale(0.7); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes hud-controls-fade {
      0% { opacity: 0.85; }
      80% { opacity: 0.85; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// ── Component ────────────────────────────────────────────────────────

export function GameHUD({
  hp,
  maxHp,
  playerCount,
  comboHits,
  controlsVisible: _controlsVisible, // eslint-disable-line @typescript-eslint/no-unused-vars
  oceanPhase: _oceanPhase, // eslint-disable-line @typescript-eslint/no-unused-vars
  oceanAlpha,
  majaAlpha,
  respawnTimer,
  isDead,
  micEnabled = false,
  isMuted = false,
  isSpeaking = false,
  activeSpeakers = 0,
  crowdMeter = 0,
  settlementWindow = false,
  settleTriggered = false,
  transcript = '',
  weaponEquipped = null,
  weaponAmmo = 0,
  playerTx = 32,
  playerTy = 32,
}: GameHUDProps) {
  // inject keyframes once
  useEffect(() => injectStyles(), []);

  const hpPct = maxHp > 0 ? hp / maxHp : 0;

  // ── Controls visibility (fade after 10s, reappear on keypress) ───
  const [controlsShow, setControlsShow] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetControlsFade = useCallback(() => {
    setControlsShow(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsShow(false), 10000);
  }, []);

  useEffect(() => {
    resetControlsFade();
    const handler = () => resetControlsFade();
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [resetControlsFade]);

  // ── Emote wheel (T to toggle) ──────────────────────────────────────
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [hoveredEmote, setHoveredEmote] = useState<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 't' || e.key === 'T') {
        setEmoteOpen(prev => !prev);
        setHoveredEmote(null);
      }
      if (emoteOpen && e.key >= '1' && e.key <= '8') {
        const idx = parseInt(e.key) - 1;
        setHoveredEmote(idx);
        // briefly show selection, then close
        setTimeout(() => {
          setEmoteOpen(false);
          setHoveredEmote(null);
        }, 400);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emoteOpen]);

  // ── HP gradient color ──────────────────────────────────────────────
  const hpGradient =
    hpPct > 0.5
      ? 'linear-gradient(90deg, #22c55e, #86efac)'
      : hpPct > 0.25
        ? 'linear-gradient(90deg, #eab308, #fde047)'
        : 'linear-gradient(90deg, #ef4444, #f87171)';

  const hpBarColor = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#eab308' : '#ef4444';

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10, ...FONT }}>
      {/* ═══════════════════════════════════════════════════════════════
          1. HEALTH BAR — bottom-left
         ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            animation: hpPct <= 0.25 && hpPct > 0 ? 'hud-pulse 1s ease-in-out infinite' : 'none',
          }}
        >
          <HeartIcon size={18} color={hpBarColor} />
        </div>
        <div
          style={{
            width: 180,
            height: 18,
            borderRadius: 9,
            ...PANEL,
            overflow: 'hidden',
            position: 'relative',
            boxShadow:
              hpPct <= 0.25 && hpPct > 0
                ? `0 0 12px ${hpBarColor}40, inset 0 1px 0 rgba(255,255,255,0.1)`
                : 'inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          <div
            style={{
              width: `${hpPct * 100}%`,
              height: '100%',
              background: hpGradient,
              borderRadius: 9,
              transition: 'width 0.15s ease-out',
              boxShadow: `0 0 8px ${hpBarColor}60`,
            }}
          />
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 10,
              fontWeight: 'bold',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              letterSpacing: 0.5,
            }}
          >
            {hp} / {maxHp}
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          2. WEAPON DISPLAY — bottom-right
         ═══════════════════════════════════════════════════════════════ */}
      {weaponEquipped && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            right: 24,
            ...PANEL,
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <WeaponIcon weapon={weaponEquipped} size={28} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              style={{
                color: '#ff8844',
                fontSize: 11,
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {weaponEquipped}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Bullet dots */}
              {Array.from({ length: Math.min(weaponAmmo, 12) }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 4,
                    height: 8,
                    borderRadius: 1,
                    background: '#4ecdc4',
                    opacity: 0.6 + (i / 12) * 0.4,
                  }}
                />
              ))}
              {weaponAmmo > 12 && (
                <span style={{ color: '#4ecdc4', fontSize: 9 }}>+{weaponAmmo - 12}</span>
              )}
              {weaponAmmo === 0 && (
                <span style={{ color: '#ff4444', fontSize: 10, fontWeight: 'bold' }}>EMPTY</span>
              )}
            </div>
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.3)',
              fontSize: 9,
              marginLeft: 4,
              borderLeft: '1px solid rgba(255,255,255,0.1)',
              paddingLeft: 8,
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>F</span> shoot
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          3. MINIMAP — top-right
         ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          ...PANEL,
          width: 128,
          height: 128,
          padding: 4,
          borderRadius: 8,
        }}
      >
        {/* North indicator */}
        <div
          style={{
            position: 'absolute',
            top: -8,
            left: '50%',
            transform: 'translateX(-50%)',
            color: '#fff',
            fontSize: 8,
            fontWeight: 'bold',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            zIndex: 2,
          }}
        >
          N
        </div>
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 4,
            overflow: 'hidden',
            backgroundImage: `url(${getMinimapImage()})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${MAP_SIZE * MINI_PX_PER_TILE}px ${MAP_SIZE * MINI_PX_PER_TILE}px`,
            backgroundPosition: `${60 - (playerTx - MAP_ORIGIN) * MINI_PX_PER_TILE}px ${60 - (playerTy - MAP_ORIGIN) * MINI_PX_PER_TILE}px`,
            backgroundColor: '#1a4f8a',
            imageRendering: 'pixelated',
          }}
        />
        {/* Player dot (center — simplified; real position requires player coords) */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#fff',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 6px #fff',
            animation: 'hud-dot-pulse 2s ease-in-out infinite',
            zIndex: 2,
          }}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          4. COMPASS — top-center
         ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          ...PANEL,
          padding: '3px 0',
          width: 200,
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 20,
            fontSize: 10,
            color: 'rgba(255,255,255,0.4)',
          }}
        >
          <span>W</span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>|</span>
          <span style={{ color: '#fff', fontWeight: 'bold' }}>N</span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>|</span>
          <span>E</span>
        </div>
        {/* Center tick */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 2,
            height: 4,
            background: '#ff4444',
            borderRadius: 1,
          }}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          5. PLAYER COUNT — top-left
         ═══════════════════════════════════════════════════════════════ */}
      {/* Player count + mic — under minimap on right */}
      <div
        style={{
          position: 'absolute',
          top: 200,
          right: 16,
          fontSize: 10,
          color: 'rgba(255,255,255,0.5)',
          fontFamily: 'monospace',
          textAlign: 'right',
          lineHeight: 1.8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: playerCount > 0 ? '#22c55e' : '#666',
            }}
          />
          {playerCount} online
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: !micEnabled
                ? '#555'
                : isMuted
                  ? '#ef4444'
                  : isSpeaking
                    ? '#22c55e'
                    : '#4a7a30',
            }}
          />
          {!micEnabled ? 'M mic' : isMuted ? 'MUTED' : isSpeaking ? 'LIVE' : 'MIC ON'}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          6. COMBO COUNTER — right side
         ═══════════════════════════════════════════════════════════════ */}
      {comboHits >= 2 && (
        <div
          style={{
            position: 'absolute',
            right: 24,
            top: '38%',
            textAlign: 'right',
            animation: 'hud-fade-in 0.15s ease-out',
          }}
        >
          <div
            style={{
              color: '#ffdd00',
              fontWeight: 'bold',
              fontSize: 28 + Math.min(comboHits, 10) * 3,
              textShadow: '0 0 20px rgba(255,221,0,0.4), 0 2px 6px rgba(0,0,0,0.8)',
              lineHeight: 1,
            }}
          >
            {comboHits}x
          </div>
          <div
            style={{
              color: '#ffaa00',
              fontSize: 12,
              fontWeight: 'bold',
              letterSpacing: 3,
              marginTop: 2,
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}
          >
            COMBO
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          7. CONTROLS HINT — bottom-center
         ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          opacity: controlsShow ? 0.85 : 0,
          transition: 'opacity 0.8s ease-out',
        }}
      >
        {/* Combat keys */}
        <div
          style={{
            display: 'flex',
            gap: 3,
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: 520,
          }}
        >
          {[
            { key: 'WASD', label: 'Move', color: '#888' },
            { key: 'J', label: 'Punch', color: '#ff8844' },
            { key: 'K', label: 'Kick', color: '#ff4444' },
            { key: 'H', label: 'Head', color: '#ff2222' },
            { key: 'U', label: 'Upper', color: '#ffaa00' },
            { key: 'Q', label: 'Force', color: '#4488ff' },
            { key: 'R', label: 'Spin', color: '#44ddff' },
            { key: 'Spc', label: 'Flip', color: '#44ff88' },
            { key: 'Shft', label: 'Block', color: '#8888ff' },
            { key: 'F', label: 'Fire', color: '#ff6644' },
            { key: 'E', label: 'Use', color: '#88cc44' },
            { key: 'M', label: 'Mic', color: '#44aaff' },
            { key: 'T', label: 'Emote', color: '#cc88ff' },
          ].map(({ key, label, color }) => (
            <div key={key} style={{ textAlign: 'center', minWidth: 34 }}>
              <div
                style={{
                  ...PANEL,
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 'bold',
                  color,
                  borderColor: `${color}30`,
                  lineHeight: 1.3,
                }}
              >
                {key}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 7, marginTop: 1 }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          8. EMOTE WHEEL — press T
         ═══════════════════════════════════════════════════════════════ */}
      {emoteOpen && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
          }}
        >
          {/* Background ring */}
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.1)',
              position: 'relative',
              animation: 'hud-emote-in 0.15s ease-out',
            }}
          >
            {EMOTES.map((emote, i) => {
              const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
              const radius = 70;
              const x = Math.cos(angle) * radius + 100;
              const y = Math.sin(angle) * radius + 100;
              const isHovered = hoveredEmote === i;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x - 20,
                    top: y - 20,
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: isHovered ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
                    border: isHovered
                      ? '1px solid rgba(255,255,255,0.4)'
                      : '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    transition: 'all 0.1s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={() => setHoveredEmote(i)}
                  onMouseLeave={() => setHoveredEmote(null)}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{emote.icon}</span>
                  <span
                    style={{
                      fontSize: 7,
                      color: 'rgba(255,255,255,0.5)',
                      position: 'absolute',
                      bottom: -12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {emote.key}
                  </span>
                </div>
              );
            })}
            {/* Center label */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'rgba(255,255,255,0.4)',
                fontSize: 9,
                textAlign: 'center',
              }}
            >
              {hoveredEmote !== null ? EMOTES[hoveredEmote].name : 'EMOTE'}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          9. SPEECH BUBBLE
         ═══════════════════════════════════════════════════════════════ */}
      {transcript && (
        <div
          style={{
            position: 'absolute',
            top: '22%',
            left: '50%',
            transform: 'translateX(-50%)',
            ...PANEL,
            background: 'rgba(255, 255, 255, 0.92)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 14,
            padding: '8px 16px',
            color: '#111',
            fontSize: 13,
            fontWeight: 'bold',
            maxWidth: 300,
            textAlign: 'center',
            wordBreak: 'break-word',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            animation: 'hud-fade-in 0.2s ease-out',
            backdropFilter: 'none',
          }}
        >
          {transcript}
          <div
            style={{
              position: 'absolute',
              bottom: -7,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '7px solid transparent',
              borderRight: '7px solid transparent',
              borderTop: '7px solid rgba(255,255,255,0.92)',
            }}
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SETTLEMENT WINDOW — top-center banner
         ═══════════════════════════════════════════════════════════════ */}
      {settlementWindow && (
        <div
          style={{
            position: 'absolute',
            top: 50,
            left: '50%',
            transform: 'translateX(-50%)',
            ...PANEL,
            background: settleTriggered ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
            border: `1px solid ${settleTriggered ? '#22c55e50' : '#ef444450'}`,
            padding: '8px 24px',
            fontWeight: 'bold',
            fontSize: 13,
            color: '#fff',
            textAlign: 'center',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}
        >
          {settleTriggered
            ? '\u2310\u25E7-\u25E7 SETTLED! DROP PARTY!'
            : '\u2310\u25E7-\u25E7 SETTLEMENT WINDOW \u2014 SHOUT TO SETTLE!'}
        </div>
      )}

      {/* Crowd settle meter */}
      {settlementWindow && micEnabled && !settleTriggered && (
        <div
          style={{
            position: 'absolute',
            top: 90,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 200,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              height: 6,
              ...PANEL,
              overflow: 'hidden',
              borderRadius: 3,
              padding: 0,
            }}
          >
            <div
              style={{
                width: `${crowdMeter * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #ef4444, #eab308, #22c55e)',
                transition: 'width 0.1s',
                borderRadius: 3,
              }}
            />
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: 9,
              marginTop: 3,
            }}
          >
            {activeSpeakers} / 3 speakers
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          OCEAN DEATH OVERLAY
         ═══════════════════════════════════════════════════════════════ */}
      {oceanAlpha > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `rgba(0,0,0,${oceanAlpha})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
          }}
        >
          {majaAlpha > 0 && (
            <>
              <div
                style={{
                  color: '#fff',
                  fontSize: 64,
                  fontFamily: 'serif',
                  fontWeight: 'bold',
                  opacity: majaAlpha,
                }}
              >
                Gran Maja
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 24,
                  fontFamily: 'serif',
                  opacity: majaAlpha,
                  marginTop: 8,
                }}
              >
                swallowed you whole
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          RESPAWN OVERLAY
         ═══════════════════════════════════════════════════════════════ */}
      {isDead && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              color: '#fff',
              fontSize: 56,
              fontWeight: 'bold',
              textShadow: '0 0 30px rgba(255,0,0,0.3), 0 2px 8px rgba(0,0,0,0.8)',
            }}
          >
            {Math.ceil(respawnTimer / 60)}
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: 14,
              letterSpacing: 4,
              marginTop: 4,
            }}
          >
            RESPAWNING
          </div>
        </div>
      )}
      {/* PIP3 watermark — PS3 logo style, bottom right */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: 12,
          fontFamily: '"Courier New", monospace',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 900,
            letterSpacing: '-0.5px',
            color: 'rgba(255,255,255,0.12)',
            textShadow: '0 0 8px rgba(255,255,255,0.05)',
            fontStyle: 'italic',
          }}
        >
          P<span style={{ fontSize: 13, verticalAlign: 'super', marginLeft: -1 }}>I</span>P
          <span
            style={{
              fontSize: 22,
              fontWeight: 900,
              marginLeft: 1,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.06))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            3
          </span>
        </span>
      </div>
    </div>
  );
}

export default GameHUD;
