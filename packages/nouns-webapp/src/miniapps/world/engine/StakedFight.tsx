// ── Staked Fight System — 1v1 ETH Wagered Combat ────────────────────
//
// Walk up to another player, press C to challenge.
// Opponent sees "FIGHT? [Y/N]" prompt.
// Both deposit ETH via wagmi useSendTransaction.
// 3-2-1 countdown, fight begins.
// First to 0 HP loses. Winner claims both deposits.
// Arena boundary: invisible wall during fight.
// State synced via PartyKit messages.

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';

import type { RemotePlayer, Player } from './types';
import { PLAYER_MAX_HP } from './types';
import { dist } from './physics';

// ── Constants ───────────────────────────────────────────────────────

export const CHALLENGE_RANGE = 48;            // pixels — must be close to challenge
export const FIGHT_ARENA_RADIUS = 80;         // pixels — invisible wall during fight
export const COUNTDOWN_SECONDS = 3;
export const MIN_STAKE_ETH = '0.001';
export const MAX_STAKE_ETH = '1';
export const DEFAULT_STAKE_ETH = '0.01';
export const STAKE_PRESETS = ['0.001', '0.005', '0.01', '0.05', '0.1', '0.5', '1'];

// ── Fight Phase ─────────────────────────────────────────────────────

export type FightPhase =
  | 'idle'            // no fight active
  | 'challenging'     // sent challenge, waiting for response
  | 'challenged'      // received challenge, showing Y/N prompt
  | 'staking'         // both accepted, depositing ETH
  | 'countdown'       // 3-2-1 countdown
  | 'fighting'        // combat active
  | 'victory'         // local player won
  | 'defeat'          // local player lost
  | 'draw';           // both died somehow (timeout)

// ── Fight State ─────────────────────────────────────────────────────

export interface StakedFightState {
  phase: FightPhase;
  opponentId: string | null;       // PartyKit player id
  opponentNounId: number | null;
  stakeAmount: string;             // ETH as string
  myDeposited: boolean;
  opponentDeposited: boolean;
  countdownTimer: number;          // seconds remaining
  fightTimer: number;              // seconds elapsed in fight
  myHp: number;
  opponentHp: number;
  arenaCenter: { x: number; y: number } | null;
  ethWon: string;                  // ETH won (for victory screen)
  myTxHash: `0x${string}` | undefined;
}

export function createStakedFightState(): StakedFightState {
  return {
    phase: 'idle',
    opponentId: null,
    opponentNounId: null,
    stakeAmount: DEFAULT_STAKE_ETH,
    myDeposited: false,
    opponentDeposited: false,
    countdownTimer: COUNTDOWN_SECONDS,
    fightTimer: 0,
    myHp: PLAYER_MAX_HP,
    opponentHp: PLAYER_MAX_HP,
    arenaCenter: null,
    ethWon: '0',
    myTxHash: undefined,
  };
}

// ── PartyKit Message Types ──────────────────────────────────────────

export interface FightChallengeMsg {
  type: 'fight:challenge';
  from: string;
  fromNounId: number;
  stakeAmount: string;
}

export interface FightAcceptMsg {
  type: 'fight:accept';
  from: string;
  to: string;
}

export interface FightDeclineMsg {
  type: 'fight:decline';
  from: string;
  to: string;
}

export interface FightDepositMsg {
  type: 'fight:deposit';
  from: string;
  txHash: string;
}

export interface FightCountdownMsg {
  type: 'fight:countdown';
  seconds: number;
}

export interface FightStartMsg {
  type: 'fight:start';
  arenaCenter: { x: number; y: number };
}

export interface FightDamageMsg {
  type: 'fight:damage';
  from: string;
  to: string;
  damage: number;
  newHp: number;
}

export interface FightEndMsg {
  type: 'fight:end';
  winnerId: string;
  loserId: string;
  ethWon: string;
}

export type FightMessage =
  | FightChallengeMsg
  | FightAcceptMsg
  | FightDeclineMsg
  | FightDepositMsg
  | FightCountdownMsg
  | FightStartMsg
  | FightDamageMsg
  | FightEndMsg;

// ── Send fight message via PartyKit ─────────────────────────────────

export function sendFightMessage(ws: WebSocket | null, msg: FightMessage) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

// ── Challenge Logic ─────────────────────────────────────────────────

/** Find the nearest player within challenge range. */
export function findChallengeTarget(
  player: Player,
  remotePlayers: Map<string, RemotePlayer>,
): { id: string; remote: RemotePlayer } | null {
  let nearest: { id: string; remote: RemotePlayer; d: number } | null = null;

  remotePlayers.forEach((remote, id) => {
    if (remote.state === 'dead' || remote.state === 'respawning') return;
    const d = dist(player.x, player.y, remote.x, remote.y);
    if (d < CHALLENGE_RANGE && (!nearest || d < nearest.d)) {
      nearest = { id, remote, d };
    }
  });

  return nearest ? { id: nearest.id, remote: nearest.remote } : null;
}

// ── Arena Boundary Enforcement ──────────────────────────────────────

/**
 * Clamp player position to the fight arena during an active fight.
 * Returns clamped position.
 */
export function enforceArenaBoundary(
  x: number,
  y: number,
  arenaCenter: { x: number; y: number } | null,
): { x: number; y: number } {
  if (!arenaCenter) return { x, y };

  const dx = x - arenaCenter.x;
  const dy = y - arenaCenter.y;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d > FIGHT_ARENA_RADIUS) {
    const scale = FIGHT_ARENA_RADIUS / d;
    return {
      x: arenaCenter.x + dx * scale,
      y: arenaCenter.y + dy * scale,
    };
  }

  return { x, y };
}

// ── Handle Incoming Fight Messages ──────────────────────────────────

export function handleFightMessage(
  msg: FightMessage,
  state: StakedFightState,
  myId: string,
): StakedFightState {
  const next = { ...state };

  switch (msg.type) {
    case 'fight:challenge': {
      if (state.phase !== 'idle') break;
      if (msg.from === myId) break;
      next.phase = 'challenged';
      next.opponentId = msg.from;
      next.opponentNounId = msg.fromNounId;
      next.stakeAmount = msg.stakeAmount;
      break;
    }

    case 'fight:accept': {
      if (msg.to !== myId) break;
      if (state.phase !== 'challenging') break;
      next.phase = 'staking';
      break;
    }

    case 'fight:decline': {
      if (msg.to !== myId) break;
      Object.assign(next, createStakedFightState());
      break;
    }

    case 'fight:deposit': {
      if (msg.from === myId) {
        next.myDeposited = true;
      } else if (msg.from === state.opponentId) {
        next.opponentDeposited = true;
      }
      // Both deposited — start countdown
      if (next.myDeposited && next.opponentDeposited) {
        next.phase = 'countdown';
        next.countdownTimer = COUNTDOWN_SECONDS;
      }
      break;
    }

    case 'fight:countdown': {
      next.countdownTimer = msg.seconds;
      if (msg.seconds <= 0) {
        next.phase = 'fighting';
        next.fightTimer = 0;
        next.myHp = PLAYER_MAX_HP;
        next.opponentHp = PLAYER_MAX_HP;
      }
      break;
    }

    case 'fight:start': {
      next.phase = 'fighting';
      next.arenaCenter = msg.arenaCenter;
      next.fightTimer = 0;
      next.myHp = PLAYER_MAX_HP;
      next.opponentHp = PLAYER_MAX_HP;
      break;
    }

    case 'fight:damage': {
      if (msg.to === myId) {
        next.myHp = Math.max(0, msg.newHp);
        if (next.myHp <= 0) next.phase = 'defeat';
      } else if (msg.from === myId) {
        next.opponentHp = Math.max(0, msg.newHp);
        if (next.opponentHp <= 0) next.phase = 'victory';
      }
      break;
    }

    case 'fight:end': {
      next.ethWon = msg.ethWon;
      if (msg.winnerId === myId) {
        next.phase = 'victory';
      } else {
        next.phase = 'defeat';
      }
      break;
    }
  }

  return next;
}

// ── Tick fight timer (call each frame) ──────────────────────────────

export function tickFight(
  state: StakedFightState,
  deltaSeconds: number,
): StakedFightState {
  if (state.phase !== 'fighting' && state.phase !== 'countdown') return state;

  const next = { ...state };

  if (next.phase === 'countdown') {
    next.countdownTimer -= deltaSeconds;
    if (next.countdownTimer <= 0) {
      next.phase = 'fighting';
      next.countdownTimer = 0;
      next.fightTimer = 0;
    }
  }

  if (next.phase === 'fighting') {
    next.fightTimer += deltaSeconds;
  }

  return next;
}

// ═══════════════════════════════════════════════════════════════════
// ── React UI Components ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// ── Shared Styles ───────────────────────────────────────────────────

const PANEL_BG = 'rgba(0, 0, 0, 0.85)';
const PANEL_BORDER = '1px solid rgba(255, 255, 255, 0.15)';
const ACCENT = '#ff4444';
const GOLD = '#ffd700';
const FONT = "'Press Start 2P', 'Courier New', monospace";

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  background: PANEL_BG,
  border: PANEL_BORDER,
  borderRadius: 8,
  padding: 24,
  color: '#fff',
  fontFamily: FONT,
  fontSize: 12,
  textAlign: 'center',
  pointerEvents: 'auto',
  zIndex: 9999,
};

const buttonStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 11,
  padding: '10px 20px',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: 1,
  transition: 'opacity 0.15s',
};

// ── Challenge Prompt (shown to challenged player) ───────────────────

interface ChallengePromptProps {
  opponentNounId: number | null;
  stakeAmount: string;
  onAccept: () => void;
  onDecline: () => void;
}

function ChallengePrompt({ opponentNounId, stakeAmount, onAccept, onDecline }: ChallengePromptProps) {
  return (
    <div
      style={{
        ...panelStyle,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        minWidth: 340,
      }}
    >
      <div style={{ fontSize: 16, marginBottom: 16, color: ACCENT }}>
        FIGHT?
      </div>
      <div style={{ marginBottom: 8, opacity: 0.7 }}>
        Noun #{opponentNounId ?? '???'} challenges you
      </div>
      <div style={{ marginBottom: 20, fontSize: 14, color: GOLD }}>
        Stake: {stakeAmount} ETH
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button
          onClick={onAccept}
          style={{
            ...buttonStyle,
            background: '#22cc44',
            color: '#000',
          }}
        >
          [Y] Accept
        </button>
        <button
          onClick={onDecline}
          style={{
            ...buttonStyle,
            background: ACCENT,
            color: '#fff',
          }}
        >
          [N] Decline
        </button>
      </div>
    </div>
  );
}

// ── Stake Selector (shown when initiating challenge) ────────────────

interface StakeSelectorProps {
  stakeAmount: string;
  onChangeStake: (amount: string) => void;
  onSendChallenge: () => void;
  onCancel: () => void;
  targetNounId: number | null;
}

function StakeSelector({
  stakeAmount,
  onChangeStake,
  onSendChallenge,
  onCancel,
  targetNounId,
}: StakeSelectorProps) {
  return (
    <div
      style={{
        ...panelStyle,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        minWidth: 380,
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 8, color: ACCENT }}>
        CHALLENGE
      </div>
      <div style={{ marginBottom: 16, opacity: 0.7 }}>
        vs Noun #{targetNounId ?? '???'}
      </div>

      <div style={{ marginBottom: 12, fontSize: 10, opacity: 0.6 }}>
        SELECT STAKE
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 }}>
        {STAKE_PRESETS.map(preset => (
          <button
            key={preset}
            onClick={() => onChangeStake(preset)}
            style={{
              ...buttonStyle,
              fontSize: 10,
              padding: '6px 12px',
              background: stakeAmount === preset ? GOLD : 'rgba(255,255,255,0.1)',
              color: stakeAmount === preset ? '#000' : '#fff',
            }}
          >
            {preset}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 20, fontSize: 16, color: GOLD }}>
        {stakeAmount} ETH
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button
          onClick={onSendChallenge}
          style={{
            ...buttonStyle,
            background: '#22cc44',
            color: '#000',
          }}
        >
          Send Challenge
        </button>
        <button
          onClick={onCancel}
          style={{
            ...buttonStyle,
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── VS Screen ───────────────────────────────────────────────────────

interface VSScreenProps {
  myNounId: number;
  opponentNounId: number | null;
  stakeAmount: string;
  phase: 'staking' | 'countdown';
  countdownTimer: number;
  myDeposited: boolean;
  opponentDeposited: boolean;
}

function VSScreen({
  myNounId,
  opponentNounId,
  stakeAmount,
  phase,
  countdownTimer,
  myDeposited,
  opponentDeposited,
}: VSScreenProps) {
  return (
    <div
      style={{
        ...panelStyle,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        minWidth: 440,
        padding: 32,
      }}
    >
      {/* Noun heads side by side */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32, marginBottom: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80,
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
            border: myDeposited ? `2px solid ${GOLD}` : '2px solid rgba(255,255,255,0.1)',
          }}>
            #{myNounId}
          </div>
          <div style={{ marginTop: 6, fontSize: 9, opacity: 0.6 }}>
            {myDeposited ? 'READY' : 'DEPOSITING...'}
          </div>
        </div>

        <div style={{
          fontSize: 24,
          color: ACCENT,
          fontWeight: 'bold',
          textShadow: `0 0 20px ${ACCENT}`,
        }}>
          VS
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80,
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
            border: opponentDeposited ? `2px solid ${GOLD}` : '2px solid rgba(255,255,255,0.1)',
          }}>
            #{opponentNounId ?? '?'}
          </div>
          <div style={{ marginTop: 6, fontSize: 9, opacity: 0.6 }}>
            {opponentDeposited ? 'READY' : 'DEPOSITING...'}
          </div>
        </div>
      </div>

      {/* Stake amount */}
      <div style={{ fontSize: 14, color: GOLD, marginBottom: 12 }}>
        {stakeAmount} ETH each
      </div>

      {/* Phase-specific text */}
      {phase === 'staking' && (
        <div style={{ fontSize: 10, opacity: 0.5 }}>
          Waiting for deposits...
        </div>
      )}
      {phase === 'countdown' && (
        <div style={{
          fontSize: 48,
          color: ACCENT,
          fontWeight: 'bold',
          textShadow: `0 0 30px ${ACCENT}`,
          animation: 'pulse 1s infinite',
        }}>
          {Math.ceil(countdownTimer)}
        </div>
      )}
    </div>
  );
}

// ── Fight HUD (HP bars + timer) ─────────────────────────────────────

interface FightHUDProps {
  myHp: number;
  opponentHp: number;
  myNounId: number;
  opponentNounId: number | null;
  fightTimer: number;
  stakeAmount: string;
}

function FightHUD({ myHp, opponentHp, myNounId, opponentNounId, fightTimer, stakeAmount }: FightHUDProps) {
  const myPct = Math.max(0, myHp / PLAYER_MAX_HP);
  const opPct = Math.max(0, opponentHp / PLAYER_MAX_HP);
  const mins = Math.floor(fightTimer / 60);
  const secs = Math.floor(fightTimer % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const hpBarStyle = (pct: number, align: 'left' | 'right'): React.CSSProperties => ({
    width: 200,
    height: 18,
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  });

  const hpFillStyle = (pct: number): React.CSSProperties => ({
    width: `${pct * 100}%`,
    height: '100%',
    background: pct > 0.5 ? '#22cc44' : pct > 0.25 ? '#ccaa22' : ACCENT,
    transition: 'width 0.2s, background 0.2s',
    borderRadius: 3,
  });

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      pointerEvents: 'none',
      zIndex: 9999,
      fontFamily: FONT,
      fontSize: 10,
      color: '#fff',
    }}>
      {/* My HP */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ marginBottom: 4, opacity: 0.7 }}>#{myNounId}</div>
        <div style={hpBarStyle(myPct, 'right')}>
          <div style={hpFillStyle(myPct)} />
        </div>
        <div style={{ marginTop: 2, fontSize: 9 }}>{myHp} HP</div>
      </div>

      {/* Center: timer + stake */}
      <div style={{ textAlign: 'center', minWidth: 80 }}>
        <div style={{ fontSize: 14, marginBottom: 2 }}>{timeStr}</div>
        <div style={{ fontSize: 8, color: GOLD }}>{stakeAmount} ETH</div>
      </div>

      {/* Opponent HP */}
      <div style={{ textAlign: 'left' }}>
        <div style={{ marginBottom: 4, opacity: 0.7 }}>#{opponentNounId ?? '?'}</div>
        <div style={hpBarStyle(opPct, 'left')}>
          <div style={hpFillStyle(opPct)} />
        </div>
        <div style={{ marginTop: 2, fontSize: 9 }}>{opponentHp} HP</div>
      </div>
    </div>
  );
}

// ── Victory / Defeat Screen ─────────────────────────────────────────

interface ResultScreenProps {
  isVictory: boolean;
  ethWon: string;
  onClose: () => void;
}

function ResultScreen({ isVictory, ethWon, onClose }: ResultScreenProps) {
  return (
    <div
      style={{
        ...panelStyle,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        minWidth: 380,
        padding: 40,
        borderColor: isVictory ? GOLD : ACCENT,
      }}
    >
      <div style={{
        fontSize: 28,
        color: isVictory ? GOLD : ACCENT,
        marginBottom: 16,
        textShadow: `0 0 30px ${isVictory ? GOLD : ACCENT}`,
      }}>
        {isVictory ? 'VICTORY' : 'DEFEAT'}
      </div>

      {isVictory && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 8 }}>ETH WON</div>
          <div style={{ fontSize: 22, color: GOLD }}>+{ethWon} ETH</div>
        </div>
      )}

      {!isVictory && (
        <div style={{ marginBottom: 20, fontSize: 10, opacity: 0.6 }}>
          Better luck next time
        </div>
      )}

      <button
        onClick={onClose}
        style={{
          ...buttonStyle,
          background: 'rgba(255,255,255,0.15)',
          color: '#fff',
        }}
      >
        Continue
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Main StakedFightUI Component ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export interface StakedFightUIProps {
  fightState: StakedFightState;
  myNounId: number;
  /** Target player when pressing C (nearest player in range) */
  challengeTarget: { id: string; nounId: number } | null;
  /** WebSocket for PartyKit messages */
  ws: WebSocket | null;
  myId: string;
  onFightStateChange: (state: StakedFightState) => void;
}

/** Escrow address for fight stakes — in production this would be a smart contract */
const FIGHT_ESCROW_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function StakedFightUI({
  fightState,
  myNounId,
  challengeTarget,
  ws,
  myId,
  onFightStateChange,
}: StakedFightUIProps) {
  const { address } = useAccount();
  const [localStake, setLocalStake] = useState(DEFAULT_STAKE_ETH);
  const [showStakeSelector, setShowStakeSelector] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Send transaction hook for depositing stake ──
  const {
    sendTransaction,
    data: txHash,
    isPending: isSending,
  } = useSendTransaction();

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // When tx confirms, notify opponent
  useEffect(() => {
    if (txConfirmed && txHash && fightState.phase === 'staking' && !fightState.myDeposited) {
      sendFightMessage(ws, {
        type: 'fight:deposit',
        from: myId,
        txHash,
      });
      onFightStateChange({
        ...fightState,
        myDeposited: true,
        myTxHash: txHash,
      });
    }
  }, [txConfirmed, txHash, fightState.phase, fightState.myDeposited]);

  // ── Countdown timer ──
  useEffect(() => {
    if (fightState.phase === 'countdown') {
      countdownRef.current = setInterval(() => {
        onFightStateChange({
          ...fightState,
          countdownTimer: fightState.countdownTimer - 1,
        });
        if (fightState.countdownTimer <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          // Transition to fighting
          const arenaCenter = fightState.arenaCenter;
          sendFightMessage(ws, {
            type: 'fight:start',
            arenaCenter: arenaCenter ?? { x: 0, y: 0 },
          });
          onFightStateChange({
            ...fightState,
            phase: 'fighting',
            countdownTimer: 0,
            fightTimer: 0,
            myHp: PLAYER_MAX_HP,
            opponentHp: PLAYER_MAX_HP,
          });
        }
      }, 1000);
      return () => {
        if (countdownRef.current) clearInterval(countdownRef.current);
      };
    }
  }, [fightState.phase, fightState.countdownTimer]);

  // ── Keyboard shortcuts (Y/N for challenge response, C to initiate) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();

      // C = open challenge selector (when near a player, idle)
      if (k === 'c' && fightState.phase === 'idle' && challengeTarget) {
        setShowStakeSelector(true);
        return;
      }

      // Y = accept challenge
      if (k === 'y' && fightState.phase === 'challenged') {
        handleAccept();
        return;
      }

      // N = decline challenge
      if (k === 'n' && fightState.phase === 'challenged') {
        handleDecline();
        return;
      }

      // Escape = cancel stake selector or challenge
      if (k === 'escape') {
        if (showStakeSelector) {
          setShowStakeSelector(false);
        } else if (fightState.phase === 'challenging') {
          onFightStateChange(createStakedFightState());
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fightState.phase, challengeTarget, showStakeSelector]);

  // ── Handlers ──

  const handleSendChallenge = useCallback(() => {
    if (!challengeTarget || !ws) return;
    sendFightMessage(ws, {
      type: 'fight:challenge',
      from: myId,
      fromNounId: myNounId,
      stakeAmount: localStake,
    });
    onFightStateChange({
      ...fightState,
      phase: 'challenging',
      opponentId: challengeTarget.id,
      opponentNounId: challengeTarget.nounId,
      stakeAmount: localStake,
    });
    setShowStakeSelector(false);
  }, [challengeTarget, ws, myId, myNounId, localStake, fightState, onFightStateChange]);

  const handleAccept = useCallback(() => {
    if (!fightState.opponentId) return;
    sendFightMessage(ws, {
      type: 'fight:accept',
      from: myId,
      to: fightState.opponentId,
    });
    // Move to staking phase — both need to deposit
    onFightStateChange({
      ...fightState,
      phase: 'staking',
    });
    // Auto-initiate deposit
    depositStake();
  }, [fightState, ws, myId]);

  const handleDecline = useCallback(() => {
    if (!fightState.opponentId) return;
    sendFightMessage(ws, {
      type: 'fight:decline',
      from: myId,
      to: fightState.opponentId,
    });
    onFightStateChange(createStakedFightState());
  }, [fightState, ws, myId, onFightStateChange]);

  const depositStake = useCallback(() => {
    if (!address) return;
    sendTransaction({
      to: FIGHT_ESCROW_ADDRESS,
      value: parseEther(fightState.stakeAmount || localStake),
    });
  }, [address, fightState.stakeAmount, localStake, sendTransaction]);

  const handleClose = useCallback(() => {
    onFightStateChange(createStakedFightState());
  }, [onFightStateChange]);

  // ── Render ──

  return (
    <>
      {/* "Press C to challenge" hint when near a player */}
      {fightState.phase === 'idle' && challengeTarget && !showStakeSelector && (
        <div style={{
          position: 'absolute',
          bottom: 140,
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: FONT,
          fontSize: 10,
          color: 'rgba(255,255,255,0.6)',
          background: 'rgba(0,0,0,0.5)',
          padding: '6px 14px',
          borderRadius: 4,
          pointerEvents: 'none',
          zIndex: 9998,
        }}>
          Press [C] to challenge Noun #{challengeTarget.nounId}
        </div>
      )}

      {/* Stake selector modal */}
      {showStakeSelector && fightState.phase === 'idle' && (
        <StakeSelector
          stakeAmount={localStake}
          onChangeStake={setLocalStake}
          onSendChallenge={handleSendChallenge}
          onCancel={() => setShowStakeSelector(false)}
          targetNounId={challengeTarget?.nounId ?? null}
        />
      )}

      {/* Waiting for response */}
      {fightState.phase === 'challenging' && (
        <div style={{
          ...panelStyle,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          minWidth: 300,
        }}>
          <div style={{ marginBottom: 12, color: ACCENT }}>CHALLENGE SENT</div>
          <div style={{ opacity: 0.6, marginBottom: 16 }}>
            Waiting for Noun #{fightState.opponentNounId ?? '?'}...
          </div>
          <button
            onClick={() => onFightStateChange(createStakedFightState())}
            style={{
              ...buttonStyle,
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Challenge received — Y/N prompt */}
      {fightState.phase === 'challenged' && (
        <ChallengePrompt
          opponentNounId={fightState.opponentNounId}
          stakeAmount={fightState.stakeAmount}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      )}

      {/* VS screen (staking + countdown) */}
      {(fightState.phase === 'staking' || fightState.phase === 'countdown') && (
        <VSScreen
          myNounId={myNounId}
          opponentNounId={fightState.opponentNounId}
          stakeAmount={fightState.stakeAmount}
          phase={fightState.phase}
          countdownTimer={fightState.countdownTimer}
          myDeposited={fightState.myDeposited}
          opponentDeposited={fightState.opponentDeposited}
        />
      )}

      {/* Deposit button during staking if not yet deposited */}
      {fightState.phase === 'staking' && !fightState.myDeposited && (
        <div style={{
          position: 'absolute',
          bottom: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          pointerEvents: 'auto',
        }}>
          <button
            onClick={depositStake}
            disabled={isSending}
            style={{
              ...buttonStyle,
              fontSize: 14,
              padding: '14px 32px',
              background: isSending ? '#666' : GOLD,
              color: '#000',
            }}
          >
            {isSending ? 'Depositing...' : `Deposit ${fightState.stakeAmount} ETH`}
          </button>
        </div>
      )}

      {/* Fight HUD — HP bars + timer */}
      {fightState.phase === 'fighting' && (
        <FightHUD
          myHp={fightState.myHp}
          opponentHp={fightState.opponentHp}
          myNounId={myNounId}
          opponentNounId={fightState.opponentNounId}
          fightTimer={fightState.fightTimer}
          stakeAmount={fightState.stakeAmount}
        />
      )}

      {/* Victory / Defeat screen */}
      {(fightState.phase === 'victory' || fightState.phase === 'defeat') && (
        <ResultScreen
          isVictory={fightState.phase === 'victory'}
          ethWon={fightState.ethWon}
          onClose={handleClose}
        />
      )}
    </>
  );
}
