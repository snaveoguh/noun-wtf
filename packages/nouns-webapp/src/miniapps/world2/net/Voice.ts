// ── Voice chat mesh for World v2 ───────────────────────────────────────
//
// WebRTC audio between every pair of players, signalled over the PartyKit
// socket with the same `world:voip:*` messages as v1. Built to work no
// matter who joins or turns their mic on first:
//
// - Every peer connection gets a sendrecv audio transceiver up front, so
//   enabling the mic later is just `replaceTrack`: no renegotiation, and
//   no "answered as recvonly so my audio never goes out" one-way calls.
// - Only one side ever starts a call (the lower id), and offers that do
//   collide are resolved with the "perfect negotiation" pattern, so
//   crossed offers can't wedge a connection.
// - ICE candidates that arrive before the remote description are queued.
// - Connections are never torn down while still connecting; a dropped
//   connection gets an ICE restart before it's rebuilt.
// - Remote audio plays through plain <audio> elements, retried on the
//   next user gesture if autoplay blocks them.

import type PartySocket from 'partysocket';

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

const VAD_THRESHOLD = 15;

interface Peer {
  pc: RTCPeerConnection;
  sender: RTCRtpSender | null;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[];
  audio: HTMLAudioElement | null;
  restartTimer: number | null;
}

export class Voice {
  private peers = new Map<string, Peer>();
  private ws: PartySocket | null = null;
  private myId = '';
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadBuf: Uint8Array<ArrayBuffer> | null = null;
  isMuted = false;
  isSpeaking = false;
  get micOn() {
    return this.track !== null;
  }

  constructor() {
    // Autoplay can block remote audio until the page has a gesture: retry
    // any paused element on the next interaction.
    const kick = () => {
      for (const p of this.peers.values()) if (p.audio?.paused === true) void p.audio.play().catch(() => undefined);
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
  }

  bind(ws: PartySocket, myId: string) {
    this.ws = ws;
    this.myId = myId;
  }

  /** Make sure we have a connection to `id`; idempotent. */
  ensurePeer(id: string) {
    if (!this.ws || !this.myId || id === this.myId) return;
    const existing = this.peers.get(id);
    if (existing && existing.pc.connectionState !== 'closed' && existing.pc.connectionState !== 'failed') return;
    if (existing) this.dropPeer(id);
    const peer = this.createPeer(id, this.myId < id);
    if (peer.polite) {
      // The leader normally calls us. If it hasn't noticed us yet, call it.
      peer.restartTimer = window.setTimeout(() => {
        peer.restartTimer = null;
        if (peer.pc.remoteDescription === null && peer.pc.signalingState === 'stable') this.addAudio(peer);
      }, 2500);
    }
  }

  /** Add our own sendrecv audio transceiver (triggers an offer). */
  private addAudio(peer: Peer) {
    const tr = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    peer.sender = tr.sender;
    if (this.track) void tr.sender.replaceTrack(this.track);
  }

  /**
   * After applying a remote offer: answer on the caller's audio m-line with
   * our mic, and drop any transceiver of ours that never got negotiated
   * (otherwise the mic sits on a dead sender and the call is one-way).
   */
  private adoptAudio(peer: Peer) {
    const trs = peer.pc.getTransceivers().filter(t => t.receiver.track.kind === 'audio');
    const live = trs.find(t => t.mid !== null && t.currentDirection !== 'stopped' && t.direction !== 'stopped');
    if (!live) return;
    live.direction = 'sendrecv';
    peer.sender = live.sender;
    if (this.track && live.sender.track !== this.track) void live.sender.replaceTrack(this.track);
    for (const t of trs) if (t !== live && t.mid === null && t.currentDirection !== 'stopped' && t.direction !== 'stopped') t.stop();
  }

  dropPeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.restartTimer !== null) window.clearTimeout(p.restartTimer);
    p.pc.close();
    if (p.audio) {
      p.audio.pause();
      p.audio.srcObject = null;
      p.audio.remove();
    }
    this.peers.delete(id);
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ ...msg, from: this.myId }));
  }

  private createPeer(id: string, initiate: boolean): Peer {
    const pc = new RTCPeerConnection(ICE);
    const peer: Peer = {
      pc,
      sender: null,
      // Lower id leads; the other side yields on collisions
      polite: this.myId > id,
      makingOffer: false,
      ignoreOffer: false,
      pendingIce: [],
      audio: null,
      restartTimer: null,
    };
    this.peers.set(id, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: 'world:voip:offer', to: id, sdp: JSON.stringify(pc.localDescription) });
      } catch (err) {
        console.warn('[voice] offer failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = e => {
      if (e.candidate) this.send({ type: 'world:voip:ice', to: id, candidate: JSON.stringify(e.candidate) });
    };

    pc.ontrack = e => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (!peer.audio) {
        const a = document.createElement('audio');
        a.autoplay = true;
        a.setAttribute('playsinline', '');
        a.style.display = 'none';
        document.body.appendChild(a);
        peer.audio = a;
      }
      peer.audio.srcObject = stream;
      void peer.audio.play().catch(() => undefined);
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected' && peer.restartTimer !== null) {
        window.clearTimeout(peer.restartTimer);
        peer.restartTimer = null;
      }
      if (s === 'disconnected' && peer.restartTimer === null) {
        // Often recovers on its own; nudge ICE, rebuild if it doesn't
        peer.restartTimer = window.setTimeout(() => {
          peer.restartTimer = null;
          if (pc.connectionState !== 'connected') pc.restartIce();
        }, 3000);
      }
      if (s === 'failed') {
        if (!peer.polite) pc.restartIce();
        peer.restartTimer ??= window.setTimeout(() => {
          peer.restartTimer = null;
          if (pc.connectionState === 'failed') {
            this.dropPeer(id);
            this.ensurePeer(id);
          }
        }, 6000);
      }
    };

    if (initiate) this.addAudio(peer);
    return peer;
  }

  async handleOffer(from: string, sdp: string) {
    if (!this.ws || !this.myId) return;
    let peer = this.peers.get(from);
    if (!peer || peer.pc.connectionState === 'closed') peer = this.createPeer(from, false);
    const { pc } = peer;
    const desc = JSON.parse(sdp) as RTCSessionDescriptionInit;
    const collision = peer.makingOffer || pc.signalingState !== 'stable';
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) return;
    try {
      await pc.setRemoteDescription(desc); // rolls back our own offer if polite
      if (desc.type === 'offer') this.adoptAudio(peer);
      await this.flushIce(peer);
      await pc.setLocalDescription();
      this.send({ type: 'world:voip:answer', to: from, sdp: JSON.stringify(pc.localDescription) });
    } catch (err) {
      console.warn('[voice] answer failed', err);
    }
  }

  async handleAnswer(from: string, sdp: string) {
    const peer = this.peers.get(from);
    if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
    try {
      await peer.pc.setRemoteDescription(JSON.parse(sdp) as RTCSessionDescriptionInit);
      await this.flushIce(peer);
    } catch (err) {
      console.warn('[voice] bad answer', err);
    }
  }

  async handleIce(from: string, candidate: string) {
    let peer = this.peers.get(from);
    if (!peer) {
      // Their ICE beat their offer here: hold it until the offer lands
      this.ensurePeer(from);
      peer = this.peers.get(from);
      if (!peer) return;
    }
    const c = JSON.parse(candidate) as RTCIceCandidateInit;
    if (peer.pc.remoteDescription === null) {
      peer.pendingIce.push(c);
      return;
    }
    try {
      await peer.pc.addIceCandidate(c);
    } catch (err) {
      if (!peer.ignoreOffer) console.warn('[voice] ice failed', err);
    }
  }

  private async flushIce(peer: Peer) {
    const q = peer.pendingIce.splice(0);
    for (const c of q) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch {
        // stale candidate
      }
    }
  }

  /** Turn the mic on (first call) or toggle mute. */
  async toggleMic(): Promise<'on' | 'muted' | 'denied'> {
    if (this.track) {
      this.isMuted = !this.isMuted;
      this.track.enabled = !this.isMuted;
      return this.isMuted ? 'muted' : 'on';
    }
    // Create/resume the analyser context inside the gesture, before awaiting
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      console.warn('[voice] mic denied', err);
      return 'denied';
    }
    this.track = this.stream.getAudioTracks()[0] ?? null;
    if (!this.track) return 'denied';
    this.isMuted = false;
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.5;
    src.connect(this.analyser);
    this.vadBuf = new Uint8Array(this.analyser.frequencyBinCount);
    for (const p of this.peers.values()) if (p.sender) void p.sender.replaceTrack(this.track);
    return 'on';
  }

  /** Update and return local voice activity. */
  checkSpeaking(): boolean {
    if (!this.analyser || !this.vadBuf || this.isMuted) {
      this.isSpeaking = false;
      return false;
    }
    this.analyser.getByteFrequencyData(this.vadBuf);
    let sum = 0;
    for (const v of this.vadBuf) sum += v;
    this.isSpeaking = sum / this.vadBuf.length > VAD_THRESHOLD;
    return this.isSpeaking;
  }

  /** Debug lines for the voice HUD / console. */
  debug(): string[] {
    const lines = [`mic ${this.micOn ? (this.isMuted ? 'muted' : 'on') : 'off'}, peers ${this.peers.size}`];
    for (const [id, p] of this.peers)
      lines.push(
        `${id.slice(0, 6)} ${p.pc.connectionState}/${p.pc.iceConnectionState} ${p.audio?.paused === false ? 'playing' : 'silent'}`,
      );
    return lines;
  }

  destroy() {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.track = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
