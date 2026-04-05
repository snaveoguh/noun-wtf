// ── Multiplayer Protocol — Message Types ─────────────────────────────

import type { Direction, MoveType, PlayerState } from '../engine/types';

// ── Client → Server ───────────────────────────────────────────────────

export interface WorldMoveMessage {
  type: 'world:move';
  x: number;
  y: number;
  direction: Direction;
  state: PlayerState;
  hp: number;
  nounId: number;
  seedKey: string;
  scaleX: number;
  attackType: MoveType | null;
  attackTimer: number;
  airborneY: number;
  flipRotation: number;
}

export interface WorldAttackMessage {
  type: 'world:attack';
  moveType: MoveType;
  x: number;
  y: number;
  angle: number;
}

export interface WorldHitMessage {
  type: 'world:hit';
  targetId: string;
  damage: number;
  knockX: number;
  knockY: number;
  move: MoveType;
  combo: number;
}

export interface WorldForcePushMessage {
  type: 'world:force';
  x: number;
  y: number;
  angle: number;
  color: string;
}

export interface WorldWagerMessage {
  type: 'world:wager';
  action: 'challenge' | 'accept' | 'decline' | 'result';
  targetId?: string;
  amount?: string; // ETH amount as string
  matchId?: string;
  winner?: string;
}

export type ClientMessage =
  | WorldMoveMessage
  | WorldAttackMessage
  | WorldHitMessage
  | WorldForcePushMessage
  | WorldWagerMessage;

// ── Server → Client ───────────────────────────────────────────────────

export interface WorldPlayerState {
  x: number;
  y: number;
  direction: Direction;
  state: PlayerState;
  hp: number;
  nounId: number;
  seedKey: string;
  scaleX: number;
  attackType: MoveType | null;
  attackTimer: number;
  airborneY: number;
  flipRotation: number;
}

export interface WorldSyncMessage {
  type: 'world:sync';
  players: Record<string, WorldPlayerState>;
  count: number;
}

export interface WorldPlayerMessage {
  type: 'world:player';
  id: string;
  x: number;
  y: number;
  direction: Direction;
  state: PlayerState;
  hp: number;
  nounId: number;
  seedKey: string;
  scaleX: number;
  attackType: MoveType | null;
  attackTimer: number;
  airborneY: number;
  flipRotation: number;
}

export interface WorldJoinMessage {
  type: 'world:join';
  id: string;
  count: number;
}

export interface WorldLeaveMessage {
  type: 'world:leave';
  id: string;
  count: number;
}

export interface WorldAttackBroadcast {
  type: 'world:attack';
  id: string;
  moveType: MoveType;
  x: number;
  y: number;
  angle: number;
}

export interface WorldHitBroadcast {
  type: 'world:hit';
  attackerId: string;
  targetId: string;
  damage: number;
  knockX: number;
  knockY: number;
  move: MoveType;
  combo: number;
}

export interface WorldDeathBroadcast {
  type: 'world:death';
  id: string;
  killerId: string;
}

export interface WorldForcePushBroadcast {
  type: 'world:force';
  id: string;
  x: number;
  y: number;
  angle: number;
  color: string;
}

export interface WorldWagerBroadcast {
  type: 'world:wager';
  matchId: string;
  player1: string;
  player2: string;
  amount: string;
  status: 'pending' | 'accepted' | 'active' | 'finished';
  winner?: string;
}

export type ServerMessage =
  | WorldSyncMessage
  | WorldPlayerMessage
  | WorldJoinMessage
  | WorldLeaveMessage
  | WorldAttackBroadcast
  | WorldHitBroadcast
  | WorldDeathBroadcast
  | WorldForcePushBroadcast
  | WorldWagerBroadcast;
