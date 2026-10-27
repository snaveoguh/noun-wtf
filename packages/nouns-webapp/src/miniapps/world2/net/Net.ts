// ── Multiplayer + voice for World v2 ────────────────────────────────────
//
// Rides the existing PartyKit server (packages/nouns-party) in its own
// room so v1 clients never see v2 traffic. The deployed server only relays
// whitelisted `world:move` fields, so 3D state is packed into them:
//   x, y          → world X, Z
//   airborneY     → world Y
//   flipRotation  → rider yaw
//   state         → compact JSON blob (anim, rider quat, board pose, …)
// Voice is a WebRTC mesh signalled over the same socket (see Voice.ts).
//
// Voice Booth (audio/voice/booth/): the blob also carries, only when set,
//   vo  the rider's public voice tag (their shared recordings)
//   co  [seq, event, line, clean] their last callout: event and line index
//       only, never audio; listeners play that rider's clip or their TTS
//   cv  [tag, id, seq] their last chat line spoken in their own voice (an
//       ephemeral clip on the world-voice function)
// Respect (respect/): `rs: 'L'` only while the rider is a legend (the
// noggles badge on their name tag; cosmetic, not checked by the server).
// The relay passes the blob through untouched and older clients ignore
// unknown keys, so nothing changes for them.

import type { BreakMsg } from '../breakdance/contract';
import type { HoopsMsg } from '../hoops/contract';

import PartySocket from 'partysocket';
import * as THREE from 'three';

import { PARTYKIT_HOST } from '../../world/engine/types';
import { CHAT_ID_RE, TAG_RE } from '../audio/voice/booth/clips';
import { type CalloutEvent } from '../audio/voice/callouts';
import { SHARE_RE } from '../character/deckSchema';
import { parseBoardType, type BoardType } from '../character/NounCharacter';

import { Voice } from './Voice';

export const V2_ROOM = 'nouns-world-v2';
const SEND_HZ = 15;

export interface NetPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion; // rider frame
  boardQuat: THREE.Quaternion; // board flip offset
  boardLift: number;
  anim: string;
  animTime: number;
  mode: 'foot' | 'board';
  lean: number;
  speed: number;
  name: string;
  seedKey: string;
  trick: string;
  boardType: BoardType;
  weight: number;
  /**
   * Riding something: 'van' (Noun Trade's ice cream van: pos/quat are the
   * van's) or 'dragon' (pos is the rider's seat, quat the dragon's; the
   * dragon itself is placed from those, see dragon/mesh.ts).
   */
  vehicle?: Vehicle;
}

export type Vehicle = 'van' | 'dragon';

/** A blob's `vh` → the vehicle (anything else, or nothing: on foot / board). */
export function parseVehicle(v: unknown): Vehicle | undefined {
  return v === 'van' || v === 'dragon' ? v : undefined;
}

/** Callout events by their wire code (co[1]). */
export const CALLOUT_CODES: readonly CalloutEvent[] = ['bail', 'speed', 'record'];

export interface RemoteCallout {
  ev: CalloutEvent;
  index: number;
  clean: boolean;
}

/** A blob's `co` → the callout (null for anything malformed). */
export function parseCallout(v: unknown): (RemoteCallout & { seq: number }) | null {
  if (!Array.isArray(v) || v.length < 4) return null;
  const [seq, code, index, clean] = v as unknown[];
  const ev = CALLOUT_CODES[Number(code)];
  if (typeof seq !== 'number' || !Number.isInteger(seq) || ev === undefined) return null;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 99) return null;
  return { seq, ev, index, clean: clean === 1 || clean === true };
}

/** A blob's `cv` → the voiced chat clip (null for anything malformed). */
export function parseChatVoice(v: unknown): { tag: string; id: string; seq: number } | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [tag, id, seq] = v as unknown[];
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) return null;
  if (typeof id !== 'string' || !CHAT_ID_RE.test(id)) return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq)) return null;
  return { tag, id, seq };
}

export interface RemotePlayer {
  id: string;
  /** Their public voice tag (Voice Booth), '' when they don't share one. */
  voiceTag: string;
  /** Last callout / voiced chat seq seen (so a joiner doesn't replay old ones). */
  coSeq: number;
  cvSeq: number;
  seedKey: string;
  name: string;
  // Interpolation buffer
  samples: { t: number; pose: NetPose }[];
  current: NetPose;
  lastSeen: number;
  /** Custom deck shared as `address:slot:savedAt` (board shop), '' = stock. */
  deck?: string;
  /** Respect badge ('L' = legend), '' = none. */
  respectBadge?: string;
  speaking: boolean;
  transcript: string;
  transcriptAt: number;
  boardType: BoardType;
  weight: number;
}

function emptyPose(): NetPose {
  return {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    boardQuat: new THREE.Quaternion(),
    boardLift: 0,
    anim: 'idle',
    animTime: 0,
    mode: 'board',
    lean: 0,
    speed: 0,
    name: '',
    seedKey: '0-0-0-0-0',
    trick: '',
    boardType: 'skate',
    weight: 0,
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class Net {
  ws: PartySocket | null = null;
  myId = '';
  players = new Map<string, RemotePlayer>();
  count = 0;
  voip = new Voice();
  get micOn() {
    return this.voip.micOn;
  }
  private sendAcc = 0;
  private lastSent = '';
  onJoin?: (id: string) => void;
  onLeave?: (id: string) => void;
  onChat?: (id: string, text: string) => void;
  onGraffiti?: (wallId: string, tags: { imageData: string; timestamp?: number }[]) => void;
  onOpen?: () => void;
  /** Noun Hoops (hoops/net): every `hoops:*` message goes here. */
  onHoops?: (m: HoopsMsg) => void;
  /** Noun Breaks (breakdance/net): every `break:*` message, raw (its codec checks it). */
  onBreak?: (m: Record<string, unknown>) => void;
  /** Noun Hide & Seek (hideseek/net): every `hideseek:*` message, raw (its codec checks it). */
  onHideSeek?: (m: Record<string, unknown>) => void;
  /** NOUN FM (radio/): every `fm:*` message goes here. */
  onFm?: (m: Record<string, unknown>) => void;
  /** Voice Booth: a remote rider's callout fired. */
  onCallout?: (id: string, c: RemoteCallout) => void;
  /** Voice Booth: a remote rider spoke a chat line in their own voice. */
  onChatVoice?: (id: string, tag: string, clipId: string) => void;
  /** My public voice tag while I share recordings ('' = none). */
  voiceTag = '';
  /** My last callout, relayed in the blob. */
  callout: [number, number, number, number] | null = null;
  /** My last voiced chat line, relayed in the blob. */
  chatVoice: [string, string, number] | null = null;
  /** My respect badge ('L' while a legend), relayed in the blob. */
  respectBadge = '';
  connected = false;
  /** My custom deck's share key (see character/deckStore), sent with each pose. */
  deck = '';

  connect() {
    if (this.ws) return;
    const ws = new PartySocket({ host: PARTYKIT_HOST, room: V2_ROOM });
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.myId = ws.id;
      this.voip.bind(ws, ws.id);
      this.connected = true;
      this.onOpen?.();
    });
    ws.addEventListener('close', () => {
      this.connected = false;
    });
    ws.addEventListener('message', ev => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.handle(data);
    });
  }

  private handle(d: Record<string, unknown>) {
    const type = d.type as string;
    if (typeof type !== 'string') return;
    if (type.startsWith('hoops:')) {
      this.onHoops?.(d as unknown as HoopsMsg);
      return;
    }
    if (type.startsWith('break:')) {
      this.onBreak?.(d);
      return;
    }
    if (type.startsWith('hideseek:')) {
      this.onHideSeek?.(d);
      return;
    }
    if (type.startsWith('fm:')) {
      this.onFm?.(d);
      return;
    }
    if (type === 'world:sync') {
      const players = (d.players ?? {}) as Record<string, Record<string, unknown>>;
      for (const [id, p] of Object.entries(players)) {
        if (id === this.myId) continue;
        this.ingest(id, p);
      }
      this.count = (d.count as number) ?? this.count;
      // Everyone joins the voice mesh (listening works without a mic)
      for (const id of this.players.keys()) this.voip.ensurePeer(id);
    } else if (type === 'world:player') {
      const id = d.id as string;
      if (id && id !== this.myId) this.ingest(id, d);
    } else if (type === 'world:join') {
      this.count = (d.count as number) ?? this.count;
      const id = d.id as string;
      if (id && id !== this.myId) {
        this.onJoin?.(id);
        this.voip.ensurePeer(id);
      }
    } else if (type === 'world:leave') {
      const id = d.id as string;
      this.count = (d.count as number) ?? this.count;
      if (this.players.delete(id)) this.onLeave?.(id);
      this.voip.dropPeer(id);
    } else if (type === 'world:voip:offer') {
      if (d.to !== undefined && d.to !== this.myId) return;
      void this.voip.handleOffer(d.from as string, d.sdp as string);
    } else if (type === 'world:voip:answer') {
      if (d.to !== undefined && d.to !== this.myId) return;
      void this.voip.handleAnswer(d.from as string, d.sdp as string);
    } else if (type === 'world:voip:ice') {
      if (d.to !== undefined && d.to !== this.myId) return;
      void this.voip.handleIce(d.from as string, d.candidate as string);
    } else if (type === 'world:voip:speaking') {
      const rp = this.players.get(d.id as string);
      const speaking = d.speaking === true;
      if (rp) rp.speaking = speaking;
    } else if (type === 'world:graffiti:tags') {
      const tags = Array.isArray(d.tags)
        ? (d.tags as { imageData: string; timestamp?: number }[])
        : [];
      this.onGraffiti?.(String(d.wallId ?? ''), tags);
    } else if (type === 'world:voip:transcript') {
      const id = d.id as string;
      if (id === this.myId) return;
      const rp = this.players.get(id);
      const text = String(d.text ?? '').slice(0, 140);
      if (rp) {
        rp.transcript = text;
        rp.transcriptAt = performance.now();
      }
      if (text) this.onChat?.(id, text);
    }
  }

  private ingest(id: string, d: Record<string, unknown>) {
    let blob: Record<string, unknown> = {};
    if (typeof d.state === 'string' && d.state.startsWith('{')) {
      try {
        blob = JSON.parse(d.state);
      } catch {
        blob = {};
      }
    }
    if (blob.v !== 2) return; // not a v2 client
    const pose = emptyPose();
    pose.pos.set(Number(d.x) || 0, Number(d.airborneY) || 0, Number(d.y) || 0);
    const q = blob.q as number[] | undefined;
    if (q?.length === 4) pose.quat.set(q[0], q[1], q[2], q[3]).normalize();
    const b = blob.b as number[] | undefined;
    if (b?.length === 4) pose.boardQuat.set(b[0], b[1], b[2], b[3]).normalize();
    pose.boardLift = Number(blob.l) || 0;
    pose.anim = String(blob.a ?? 'idle');
    pose.animTime = Number(blob.at) || 0;
    pose.mode = blob.m === 'foot' ? 'foot' : 'board';
    pose.lean = Number(blob.ln) || 0;
    pose.speed = Number(blob.sp) || 0;
    pose.name = String(blob.n ?? '').slice(0, 24);
    pose.trick = String(blob.tr ?? '').slice(0, 60);
    pose.boardType = parseBoardType(blob.bt);
    pose.weight = Math.max(-1, Math.min(1, Number(blob.w) || 0));
    pose.vehicle = parseVehicle(blob.vh);
    pose.seedKey = String(d.seedKey ?? '0-0-0-0-0');
    const co = parseCallout(blob.co);
    const cv = parseChatVoice(blob.cv);
    let rp = this.players.get(id);
    const now = performance.now();
    if (!rp) {
      rp = {
        id,
        voiceTag: '',
        coSeq: co?.seq ?? -1,
        cvSeq: cv?.seq ?? -1,
        seedKey: pose.seedKey,
        name: pose.name,
        samples: [],
        current: emptyPose(),
        lastSeen: now,
        speaking: false,
        transcript: '',
        transcriptAt: 0,
        boardType: pose.boardType,
        weight: pose.weight,
      };
      rp.current.pos.copy(pose.pos);
      rp.current.quat.copy(pose.quat);
      this.players.set(id, rp);
      this.voip.ensurePeer(id);
      this.onJoin?.(id);
    }
    rp.seedKey = pose.seedKey;
    rp.name = pose.name;
    rp.boardType = pose.boardType;
    rp.weight = pose.weight;
    rp.lastSeen = now;
    rp.samples.push({ t: now, pose });
    if (rp.samples.length > 8) rp.samples.shift();
    rp.deck = typeof blob.dk === 'string' && SHARE_RE.test(blob.dk) ? blob.dk : '';
    rp.voiceTag = typeof blob.vo === 'string' && TAG_RE.test(blob.vo) ? blob.vo : '';
    rp.respectBadge = blob.rs === 'L' ? 'L' : '';
    if (co !== null && co.seq !== rp.coSeq) {
      rp.coSeq = co.seq;
      this.onCallout?.(id, co);
    }
    if (cv !== null && cv.seq !== rp.cvSeq) {
      rp.cvSeq = cv.seq;
      this.onChatVoice?.(id, cv.tag, cv.id);
    }
  }

  /** Interpolate remote players ~120ms in the past. */
  tick(dt: number) {
    const now = performance.now();
    const renderT = now - 120;
    for (const [id, rp] of this.players) {
      if (now - rp.lastSeen > 15000) {
        this.players.delete(id);
        this.onLeave?.(id);
        continue;
      }
      const s = rp.samples;
      if (s.length === 0) continue;
      let a = s[0];
      let b = s[s.length - 1];
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i].t <= renderT && s[i + 1].t >= renderT) {
          a = s[i];
          b = s[i + 1];
          break;
        }
      }
      const span = Math.max(1, b.t - a.t);
      const k = THREE.MathUtils.clamp((renderT - a.t) / span, 0, 1.25);
      const c = rp.current;
      c.pos.lerpVectors(a.pose.pos, b.pose.pos, k);
      c.quat.slerpQuaternions(a.pose.quat, b.pose.quat, Math.min(1, k));
      c.boardQuat.slerpQuaternions(a.pose.boardQuat, b.pose.boardQuat, Math.min(1, k));
      c.boardLift = THREE.MathUtils.lerp(a.pose.boardLift, b.pose.boardLift, Math.min(1, k));
      c.lean = THREE.MathUtils.lerp(a.pose.lean, b.pose.lean, Math.min(1, k));
      c.speed = b.pose.speed;
      c.anim = b.pose.anim;
      c.animTime = b.pose.animTime;
      c.mode = b.pose.mode;
      c.trick = b.pose.trick;
      c.name = b.pose.name;
      c.seedKey = b.pose.seedKey;
      c.vehicle = b.pose.vehicle;
    }
    void dt;
  }

  send(dt: number, pose: NetPose, nounId: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendAcc += dt;
    if (this.sendAcc < 1 / SEND_HZ) return;
    this.sendAcc = 0;
    const yaw = Math.atan2(
      2 * (pose.quat.w * pose.quat.y + pose.quat.x * pose.quat.z),
      1 - 2 * (pose.quat.y * pose.quat.y + pose.quat.x * pose.quat.x),
    );
    const blob = JSON.stringify({
      v: 2,
      ...(this.deck !== '' ? { dk: this.deck } : {}),
      q: [r3(pose.quat.x), r3(pose.quat.y), r3(pose.quat.z), r3(pose.quat.w)],
      b: [r3(pose.boardQuat.x), r3(pose.boardQuat.y), r3(pose.boardQuat.z), r3(pose.boardQuat.w)],
      l: r3(pose.boardLift),
      a: pose.anim,
      at: r3(pose.animTime),
      m: pose.mode,
      ln: r3(pose.lean),
      sp: r3(pose.speed),
      n: pose.name,
      tr: pose.trick,
      bt: pose.boardType,
      w: r3(pose.weight),
      // Only while riding, so older clients' blobs are unchanged otherwise
      // (an older client reads 'dragon' as nothing: the rider, no dragon)
      ...(pose.vehicle !== undefined ? { vh: pose.vehicle } : {}),
      // Voice Booth (see the header): only when set
      ...(this.voiceTag !== '' ? { vo: this.voiceTag } : {}),
      ...(this.callout !== null ? { co: this.callout } : {}),
      ...(this.chatVoice !== null ? { cv: this.chatVoice } : {}),
      ...(this.respectBadge !== '' ? { rs: this.respectBadge } : {}),
    });
    const msg = JSON.stringify({
      type: 'world:move',
      x: r3(pose.pos.x),
      y: r3(pose.pos.z),
      airborneY: r3(pose.pos.y),
      flipRotation: r3(yaw),
      direction: 'down',
      state: blob,
      hp: 100,
      nounId,
      seedKey: pose.seedKey,
      scaleX: 1,
      attackType: null,
      attackTimer: 0,
    });
    if (msg === this.lastSent) return;
    this.lastSent = msg;
    this.ws.send(msg);
  }

  // ── Voice ──────────────────────────────────────────────────────────

  toggleMic(): Promise<'on' | 'muted' | 'denied'> {
    return this.voip.toggleMic();
  }

  private vadAcc = 0;
  // Positional audio isn't wired up yet; callers already pass the listener
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tickVoice(dt: number, _listener: THREE.Vector3, _forward: THREE.Vector3) {
    this.vadAcc += dt;
    if (this.vadAcc < 0.1) return;
    this.vadAcc = 0;
    const v = this.voip;
    if (v.micOn && this.ws?.readyState === WebSocket.OPEN) {
      const was = v.isSpeaking;
      v.checkSpeaking();
      if (v.isSpeaking !== was)
        this.ws.send(JSON.stringify({ type: 'world:voip:speaking', speaking: v.isSpeaking }));
    }
  }

  graffitiSave(wallId: string, imageData: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'world:graffiti:save', wallId, imageData }));
    }
  }

  graffitiLoad(wallId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'world:graffiti:load', wallId }));
    }
  }

  sendHoops(m: HoopsMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendBreak(m: BreakMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendHideSeek(m: { type: string }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendFm(m: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendChat(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'world:voip:transcript', text: text.slice(0, 140) }));
    }
  }

  dispose() {
    this.voip.destroy();
    this.ws?.close();
    this.ws = null;
    this.players.clear();
  }
}
