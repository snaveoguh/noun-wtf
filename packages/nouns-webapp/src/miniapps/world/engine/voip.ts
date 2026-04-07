// ── VOIP System — WebRTC audio with PartyKit signaling ──────────────
//
// Players can talk to each other in the world. During the settlement
// window, if enough people are talking simultaneously, nounirl.eth
// settles the auction.
//
// Architecture:
// - Each player gets a local audio stream (getUserMedia)
// - PartyKit relays WebRTC signaling (offer/answer/ICE)
// - Peer connections form a mesh (each player connects to all others)
// - Voice Activity Detection (VAD) via AudioAnalyser
// - Crowd meter tracks active speakers
// - Settlement trigger when threshold met during settlement window

import PartySocket from 'partysocket';

// ── Types ────────────────────────────────────────────────────────────

export interface VoipState {
  localStream: MediaStream | null;
  peers: Map<string, RTCPeerConnection>;
  remoteStreams: Map<string, MediaStream>;
  isMuted: boolean;
  isSpeaking: boolean;
  activeSpeakers: Set<string>; // peer IDs currently speaking
  analyser: AnalyserNode | null;
  audioContext: AudioContext | null;
  settlementWindow: boolean; // true when auction ended but not settled
  crowdMeter: number; // 0-1, how close to settlement trigger
  settleTriggered: boolean;
}

export function createVoipState(): VoipState {
  return {
    localStream: null,
    peers: new Map(),
    remoteStreams: new Map(),
    isMuted: false,
    isSpeaking: false,
    activeSpeakers: new Set(),
    analyser: null,
    audioContext: null,
    settlementWindow: false,
    crowdMeter: 0,
    settleTriggered: false,
  };
}

// ── Constants ────────────────────────────────────────────────────────

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN relay for NAT traversal (OpenRelay free tier — 500MB/mo)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

const VAD_THRESHOLD = 15; // audio level threshold for "speaking"
const SETTLE_SPEAKER_THRESHOLD = 3; // need 3+ people talking to trigger
const SETTLE_DURATION_MS = 3000; // must sustain for 3 seconds
const VAD_CHECK_INTERVAL = 100; // check voice activity every 100ms

// ── Initialize VOIP ─────────────────────────────────────────────────

export async function initVoip(state: VoipState): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    state.localStream = stream;

    // Setup audio analyser for VAD
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);

    state.audioContext = audioContext;
    state.analyser = analyser;

    return true;
  } catch (err) {
    console.warn('[VOIP] Mic access denied:', err);
    return false;
  }
}

// ── Voice Activity Detection ─────────────────────────────────────────

export function checkVoiceActivity(state: VoipState): boolean {
  if (!state.analyser || state.isMuted) {
    state.isSpeaking = false;
    return false;
  }

  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);

  // Average volume across frequency bands
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  const avg = sum / data.length;

  state.isSpeaking = avg > VAD_THRESHOLD;
  return state.isSpeaking;
}

// ── Peer Connection Management ───────────────────────────────────────

export function createPeerConnection(
  state: VoipState,
  peerId: string,
  ws: PartySocket,
  myId: string,
): RTCPeerConnection {
  const pc = new RTCPeerConnection(ICE_SERVERS);

  // Add local stream tracks
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => {
      pc.addTrack(track, state.localStream!);
    });
  }

  // Handle incoming remote stream — spatial audio
  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    if (remoteStream && state.audioContext) {
      state.remoteStreams.set(peerId, remoteStream);

      // Spatial audio: route through PannerNode for 3D positioning
      const source = state.audioContext.createMediaStreamSource(remoteStream);
      const panner = state.audioContext.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 50;
      panner.rolloffFactor = 1.5;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      source.connect(panner);
      panner.connect(state.audioContext.destination);

      // Store panner for position updates
      (state as any)._panners = (state as any)._panners || new Map();
      (state as any)._panners.set(peerId, panner);

      // Attach VAD for remote speaker detection
      setupRemoteVAD(state, peerId, remoteStream);
    }
  };

  // Send ICE candidates via PartyKit
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: 'world:voip:ice',
        from: myId,
        to: peerId,
        candidate: JSON.stringify(event.candidate),
      }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[VOIP] Peer ${peerId} connection: ${pc.connectionState}`);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      removePeer(state, peerId);
    }
    if (pc.connectionState === 'connected') {
      console.log(`[VOIP] Audio connected to peer ${peerId}`);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[VOIP] Peer ${peerId} ICE: ${pc.iceConnectionState}`);
  };

  state.peers.set(peerId, pc);
  return pc;
}

/** Add local audio tracks to all existing peer connections (after late mic enable) */
export async function addTracksToExistingPeers(
  state: VoipState,
  ws: PartySocket,
  myId: string,
) {
  if (!state.localStream) return;
  const tracks = state.localStream.getTracks();

  for (const [peerId, pc] of state.peers) {
    // Check if tracks already added
    const senders = pc.getSenders();
    const hasAudio = senders.some(s => s.track?.kind === 'audio');
    if (hasAudio) continue;

    // Add tracks and renegotiate
    for (const track of tracks) {
      pc.addTrack(track, state.localStream);
    }
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({
        type: 'world:voip:offer',
        from: myId,
        to: peerId,
        sdp: JSON.stringify(offer),
      }));
      console.log(`[VOIP] Renegotiated with ${peerId} after adding local tracks`);
    } catch (err) {
      console.warn(`[VOIP] Failed to renegotiate with ${peerId}:`, err);
    }
  }
}

/** Initiate a call to a peer (create offer) */
export async function callPeer(
  state: VoipState,
  peerId: string,
  ws: PartySocket,
  myId: string,
) {
  // Skip if we already have an active connection to this peer
  const existing = state.peers.get(peerId);
  if (existing && existing.connectionState !== 'failed' && existing.connectionState !== 'closed') {
    console.log(`[VOIP] Already connected to ${peerId}, skipping callPeer`);
    return;
  }

  const pc = createPeerConnection(state, peerId, ws, myId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: 'world:voip:offer',
    from: myId,
    to: peerId,
    sdp: JSON.stringify(offer),
  }));
}

/** Handle incoming offer (create answer, or renegotiate existing) */
export async function handleOffer(
  state: VoipState,
  peerId: string,
  sdp: string,
  ws: PartySocket,
  myId: string,
) {
  // Reuse existing connection if it exists (renegotiation)
  let pc = state.peers.get(peerId);
  if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
    pc = createPeerConnection(state, peerId, ws, myId);
  }

  await pc.setRemoteDescription(JSON.parse(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  ws.send(JSON.stringify({
    type: 'world:voip:answer',
    from: myId,
    to: peerId,
    sdp: JSON.stringify(answer),
  }));
  console.log(`[VOIP] Answered offer from ${peerId}`);
}

/** Handle incoming answer */
export async function handleAnswer(
  state: VoipState,
  peerId: string,
  sdp: string,
) {
  const pc = state.peers.get(peerId);
  if (pc) {
    await pc.setRemoteDescription(JSON.parse(sdp));
  }
}

/** Handle incoming ICE candidate */
export async function handleIceCandidate(
  state: VoipState,
  peerId: string,
  candidate: string,
) {
  const pc = state.peers.get(peerId);
  if (pc) {
    await pc.addIceCandidate(JSON.parse(candidate));
  }
}

/** Remove a peer connection */
export function removePeer(state: VoipState, peerId: string) {
  const pc = state.peers.get(peerId);
  if (pc) {
    pc.close();
    state.peers.delete(peerId);
  }
  state.remoteStreams.delete(peerId);
  state.activeSpeakers.delete(peerId);
}

// ── Remote speaker VAD ───────────────────────────────────────────────

function setupRemoteVAD(state: VoipState, peerId: string, stream: MediaStream) {
  if (!state.audioContext) return;

  const source = state.audioContext.createMediaStreamSource(stream);
  const analyser = state.audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);

  // Poll for voice activity
  const data = new Uint8Array(analyser.frequencyBinCount);
  const check = () => {
    if (!state.peers.has(peerId)) return; // stop if peer disconnected
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;

    if (avg > VAD_THRESHOLD) {
      state.activeSpeakers.add(peerId);
    } else {
      state.activeSpeakers.delete(peerId);
    }

    setTimeout(check, VAD_CHECK_INTERVAL);
  };
  check();
}

// ── Crowd Settle Logic ───────────────────────────────────────────────

let _settleStartTime = 0;

/**
 * Update crowd settle meter. Call every frame.
 * Returns true if settlement should be triggered.
 */
export function updateCrowdSettle(state: VoipState): boolean {
  if (!state.settlementWindow || state.settleTriggered) {
    state.crowdMeter = 0;
    return false;
  }

  // Count active speakers (including self)
  let speakerCount = state.activeSpeakers.size;
  if (state.isSpeaking) speakerCount++;

  if (speakerCount >= SETTLE_SPEAKER_THRESHOLD) {
    if (_settleStartTime === 0) {
      _settleStartTime = Date.now();
    }
    const elapsed = Date.now() - _settleStartTime;
    state.crowdMeter = Math.min(1, elapsed / SETTLE_DURATION_MS);

    if (elapsed >= SETTLE_DURATION_MS) {
      state.settleTriggered = true;
      state.crowdMeter = 1;
      _settleStartTime = 0;
      return true; // TRIGGER SETTLEMENT!
    }
  } else {
    // Reset if not enough speakers
    _settleStartTime = 0;
    state.crowdMeter = Math.max(0, state.crowdMeter - 0.02);
  }

  return false;
}

// ── Spatial Audio Position Update ─────────────────────────────────────

/**
 * Update the 3D position of a remote speaker for spatial audio.
 * Call each frame with the remote player's world position.
 */
export function updateSpatialPosition(
  state: VoipState,
  peerId: string,
  x: number,
  y: number,
  z: number,
) {
  const panners = (state as any)._panners as Map<string, PannerNode> | undefined;
  if (!panners) return;
  const panner = panners.get(peerId);
  if (panner) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  }
}

/**
 * Update the listener position (local player) for spatial audio.
 */
export function updateListenerPosition(
  state: VoipState,
  x: number,
  y: number,
  z: number,
  forwardX: number,
  forwardZ: number,
) {
  if (!state.audioContext) return;
  const listener = state.audioContext.listener;
  if (listener.positionX) {
    listener.positionX.value = x;
    listener.positionY.value = y;
    listener.positionZ.value = z;
    listener.forwardX.value = forwardX;
    listener.forwardY.value = 0;
    listener.forwardZ.value = forwardZ;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  }
}

// ── Mute/Unmute ──────────────────────────────────────────────────────

export function toggleMute(state: VoipState) {
  state.isMuted = !state.isMuted;
  if (state.localStream) {
    state.localStream.getAudioTracks().forEach(track => {
      track.enabled = !state.isMuted;
    });
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────

export function destroyVoip(state: VoipState) {
  // Close all peer connections
  for (const [, pc] of state.peers) {
    pc.close();
  }
  state.peers.clear();
  state.remoteStreams.clear();
  state.activeSpeakers.clear();

  // Stop local stream
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
  }

  // Close audio context
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }

  state.analyser = null;
  state.isSpeaking = false;
  state.crowdMeter = 0;
  state.settleTriggered = false;
}

// ── Speech-to-Text (floating words above head) ──────────────────────

let _recognition: any = null;
let _currentTranscript = '';
let _transcriptExpiry = 0;

/**
 * Start speech recognition. Transcribed words appear above the player.
 */
export function startSpeechToText(state: VoipState) {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[VOIP] SpeechRecognition not supported in this browser');
    _currentTranscript = 'Speech not supported in this browser';
    _transcriptExpiry = Date.now() + 5000;
    return;
  }

  if (_recognition) _recognition.stop();

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event: any) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        _currentTranscript = transcript.trim();
        _transcriptExpiry = Date.now() + 4000; // show for 4 seconds
      } else {
        interim = transcript;
      }
    }
    if (interim) {
      _currentTranscript = interim.trim();
      _transcriptExpiry = Date.now() + 2000; // interim fades faster
    }
  };

  recognition.onerror = (e: any) => {
    console.warn('[VOIP] Speech recognition error:', e.error);
  };
  recognition.onend = () => {
    // Auto-restart if still speaking
    if (state.localStream && !state.isMuted) {
      try { recognition.start(); } catch {}
    }
  };

  try {
    recognition.start();
    _recognition = recognition;
    console.log('[VOIP] Speech recognition started');
    _currentTranscript = '🎤 Listening...';
    _transcriptExpiry = Date.now() + 2000;
  } catch (e) {
    console.warn('[VOIP] Failed to start speech recognition:', e);
  }
}

export function stopSpeechToText() {
  if (_recognition) {
    _recognition.stop();
    _recognition = null;
  }
  _currentTranscript = '';
}

/** Get current transcript text (empty if expired) */
export function getCurrentTranscript(): string {
  if (Date.now() > _transcriptExpiry) return '';
  return _currentTranscript;
}

export { SETTLE_SPEAKER_THRESHOLD };
