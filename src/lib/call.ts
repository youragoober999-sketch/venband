// Voice / video / screen-share engine.
//
// Media flows peer-to-peer over WebRTC (full mesh). WebRTC always encrypts
// media with DTLS-SRTP; the only way a signaling server could intercept it is
// by swapping the DTLS fingerprints inside the SDP (man-in-the-middle). To
// prevent that every SDP offer/answer is signed with the sender's Venband
// identity key and verified before use, so media is end-to-end encrypted
// between participants. TURN relays (if configured) only ever see ciphertext.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { sdpSignaturePayload, sign, verify, type Identity } from './crypto';
import { getCurrentKey, observeKey } from './directory';
import { setVoiceState } from './presence';

interface CallMeta {
  user_id: string;
  session: string;
  mic: string;
  cam: string | null;
  screen: string | null;
  muted: boolean;
  deafened: boolean;
}

interface Signal {
  from: string;
  fromUser: string;
  to: string;
  /** id of the sender's RTCPeerConnection, so a rebuilt connection is detected */
  pc?: string;
  description?: RTCSessionDescriptionInit;
  sig?: string;
  candidate?: RTCIceCandidateInit | null;
  /** sent when hanging up so others drop us immediately */
  bye?: boolean;
}

export interface RemotePeer {
  session: string;
  userId: string;
  meta: CallMeta | null;
  streams: Map<string, MediaStream>;
  state: RTCPeerConnectionState;
}

interface Peer extends RemotePeer {
  pc: RTCPeerConnection;
  pcId: string;
  remotePcId: string | null;
  missingSince: number | null;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  queue: Promise<void>;
  pendingCandidates: RTCIceCandidateInit[];
  senders: { cam: RTCRtpSender[]; screen: RTCRtpSender[] };
}

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const turn = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turn) {
    servers.push({
      urls: turn.split(',').map((s) => s.trim()),
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
}

export class Call {
  readonly session = crypto.randomUUID();
  private rt: RealtimeChannel | null = null;
  private peers = new Map<string, Peer>();
  private listeners = new Set<() => void>();
  private closed = false;
  version = 0;

  mic: MediaStream | null = null;
  cam: MediaStream | null = null;
  screen: MediaStream | null = null;
  muted = false;
  deafened = false;
  error: string | null = null;
  status: 'connecting' | 'connected' | 'closed' = 'connecting';
  /** someone has been in the call with us at some point */
  everJoined = false;
  /** name-less record of who left most recently (user id) */
  lastLeft: string | null = null;

  constructor(
    readonly identity: Identity,
    readonly channelId: string,
    readonly scopeId: string,
    readonly channelName: string,
  ) {}

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get remotePeers(): RemotePeer[] {
    return [...this.peers.values()];
  }

  private meta(): CallMeta {
    return {
      user_id: this.identity.userId,
      session: this.session,
      mic: this.mic?.id ?? '',
      cam: this.cam?.id ?? null,
      screen: this.screen?.id ?? null,
      muted: this.muted,
      deafened: this.deafened,
    };
  }

  private publishState() {
    this.rt?.track(this.meta());
    setVoiceState({
      scope: this.scopeId,
      voice_channel_id: this.channelId,
      muted: this.muted,
      deafened: this.deafened,
      video: Boolean(this.cam),
      screen: Boolean(this.screen),
    });
    this.changed();
  }

  async join() {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.error = 'Microphone unavailable — joined listen-only.';
      this.mic = new MediaStream();
      this.muted = true;
    }
    const rt = supabase.channel(`call:${this.channelId}`, {
      config: { private: true, presence: { key: this.session }, broadcast: { self: false } },
    });
    this.rt = rt;
    rt.on('presence', { event: 'sync' }, () => this.reconcile());
    this.tick = setInterval(() => this.reconcile(), 3000);
    rt.on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload as Signal));
    rt.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.status = 'connected';
        this.publishState();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.error = 'Could not connect to the voice channel (check your permissions).';
        this.changed();
      }
    });
    this.changed();
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    this.status = 'closed';
    for (const p of this.peers.values()) {
      this.send({ from: this.session, fromUser: this.identity.userId, to: p.session, bye: true });
    }
    if (this.tick) clearInterval(this.tick);
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    for (const s of [this.mic, this.cam, this.screen]) s?.getTracks().forEach((t) => t.stop());
    if (this.rt) {
      this.rt.untrack();
      supabase.removeChannel(this.rt);
    }
    setVoiceState({ scope: null, voice_channel_id: null, muted: false, deafened: false, video: false, screen: false });
    this.changed();
  }

  // ---------------------------------------------------------------- peers --

  /**
   * Restrict the call to these users (current server members). Realtime only
   * authorizes at join time, so a kicked/banned member is dropped here.
   */
  setAllowedUsers(users: Set<string> | null) {
    this.allowed = users;
    this.reconcile();
  }

  private allowed: Set<string> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  /** candidates from a rebuilt remote connection that arrived before its offer */
  private earlyCandidates = new Map<string, RTCIceCandidateInit[]>();

  private reconcile() {
    if (!this.rt || this.closed) return;
    const state = this.rt.presenceState<CallMeta>();
    const seen = new Set<string>();
    for (const [session, metas] of Object.entries(state)) {
      if (session === this.session) continue;
      const meta = metas[metas.length - 1] as unknown as CallMeta;
      if (this.allowed && !this.allowed.has(meta.user_id)) continue;
      seen.add(session);
      const peer = this.peers.get(session) ?? this.createPeer(session, meta.user_id);
      if (peer.userId !== meta.user_id) continue; // presence key/user mismatch: ignore
      peer.meta = meta;
      peer.missingSince = null;
    }
    // Presence blips (e.g. when someone mutes/deafens and re-announces their
    // state) must not tear down a working connection. Only drop a peer after
    // it has been gone for a while, or its connection has actually died.
    const now = Date.now();
    for (const [session, peer] of this.peers) {
      if (seen.has(session)) continue;
      peer.missingSince ??= now;
      const state = peer.pc.connectionState;
      const dead = state === 'failed' || state === 'closed';
      // not in the call list and no live connection → they left
      const gone = state !== 'connected' && now - peer.missingSince > 3_000;
      if (dead || gone || now - peer.missingSince > 45_000) this.dropPeer(session);
    }
    this.changed();
  }

  private dropPeer(session: string) {
    const peer = this.peers.get(session);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(session);
    if (![...this.peers.values()].some((p) => p.userId === peer.userId)) this.lastLeft = peer.userId;
    this.changed();
  }

  private createPeer(session: string, userId: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle' });
    const peer: Peer = {
      session,
      userId,
      pcId: crypto.randomUUID(),
      remotePcId: null,
      missingSince: null,
      meta: null,
      streams: new Map(),
      state: 'new',
      pc,
      polite: this.session < session,
      makingOffer: false,
      ignoreOffer: false,
      queue: Promise.resolve(),
      pendingCandidates: [],
      senders: { cam: [], screen: [] },
    };
    this.peers.set(session, peer);

    if (this.mic?.getAudioTracks().length) {
      for (const t of this.mic.getTracks()) pc.addTrack(t, this.mic);
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' }); // listen-only still negotiates
    }
    if (this.cam) for (const t of this.cam.getTracks()) peer.senders.cam.push(pc.addTrack(t, this.cam));
    if (this.screen) for (const t of this.screen.getTracks()) peer.senders.screen.push(pc.addTrack(t, this.screen));

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        await this.sendDescription(peer, pc.localDescription!);
      } catch (e) {
        console.warn('negotiation failed', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      this.send({ from: this.session, fromUser: this.identity.userId, to: session, pc: peer.pcId, candidate: candidate?.toJSON() ?? null });
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      peer.streams.set(stream.id, stream);
      track.onunmute = () => this.changed();
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) peer.streams.delete(stream.id);
        this.changed();
      };
      this.changed();
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'connected') {
        this.everJoined = true;
        this.lastLeft = null;
      }
      if (pc.connectionState === 'failed') pc.restartIce();
      this.changed();
    };
    return peer;
  }

  private send(signal: Signal) {
    this.rt?.send({ type: 'broadcast', event: 'signal', payload: signal });
  }

  private async sendDescription(peer: Peer, description: RTCSessionDescription | RTCSessionDescriptionInit) {
    const d = { type: description.type, sdp: description.sdp ?? '' };
    const sig = await sign(
      this.identity,
      sdpSignaturePayload(this.channelId, this.session, this.identity.userId, peer.session, d.type!, d.sdp),
    );
    this.send({ from: this.session, fromUser: this.identity.userId, to: peer.session, pc: peer.pcId, description: d, sig });
  }

  private onSignal(s: Signal) {
    if (this.closed || s.to !== this.session || s.from === this.session) return;
    if (s.bye) {
      if (this.peers.get(s.from)?.userId === s.fromUser) this.dropPeer(s.from);
      return;
    }
    if (this.allowed && !this.allowed.has(s.fromUser)) return;
    let peer = this.peers.get(s.from);
    if (peer && s.pc && peer.remotePcId && s.pc !== peer.remotePcId) {
      // The other side rebuilt its connection. Follow it on a fresh offer;
      // anything else from the old connection is stale.
      if (s.description?.type !== 'offer') {
        if (s.candidate) {
          const k = `${s.from}|${s.pc}`;
          this.earlyCandidates.set(k, [...(this.earlyCandidates.get(k) ?? []), s.candidate].slice(-50));
        }
        return;
      }
      const meta = peer.meta;
      this.dropPeer(s.from);
      peer = this.createPeer(s.from, s.fromUser);
      peer.meta = meta;
      const k = `${s.from}|${s.pc}`;
      peer.pendingCandidates.push(...(this.earlyCandidates.get(k) ?? []));
      this.earlyCandidates.delete(k);
    }
    if (!peer) peer = this.createPeer(s.from, s.fromUser);
    if (peer.userId !== s.fromUser) return;
    if (s.pc && !peer.remotePcId) peer.remotePcId = s.pc;
    const p = peer;
    p.queue = p.queue.then(() => this.handleSignal(p, s)).catch((e) => console.warn('signal error', e));
  }

  private async verifyDescription(peer: Peer, s: Signal): Promise<boolean> {
    if (!s.description?.sdp || !s.description.type || !s.sig) return false;
    const payload = sdpSignaturePayload(this.channelId, s.from, s.fromUser, this.session, s.description.type, s.description.sdp);
    let key = await getCurrentKey(peer.userId);
    if (key && (await verify(key.sign_public, s.sig, payload))) {
      observeKey(peer.userId, key.key_id);
      return true;
    }
    key = await getCurrentKey(peer.userId, true); // key may have rotated
    return Boolean(key && (await verify(key.sign_public, s.sig, payload)));
  }

  private async handleSignal(peer: Peer, s: Signal) {
    const pc = peer.pc;
    if (s.description) {
      if (!(await this.verifyDescription(peer, s))) {
        console.warn('Rejected unsigned or forged SDP from', s.fromUser);
        this.error = 'Rejected a forged call connection attempt.';
        this.changed();
        return;
      }
      const offerCollision = s.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(s.description);
      for (const c of peer.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (s.description.type === 'offer') {
        await pc.setLocalDescription();
        await this.sendDescription(peer, pc.localDescription!);
      }
    } else if (s.candidate !== undefined) {
      if (!pc.remoteDescription) {
        if (s.candidate) peer.pendingCandidates.push(s.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(s.candidate ?? undefined);
      } catch (e) {
        if (!peer.ignoreOffer) throw e;
      }
    }
  }

  // -------------------------------------------------------------- controls --

  toggleMute() {
    if (!this.mic?.getAudioTracks().length) return;
    this.muted = !this.muted;
    this.mic.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    this.publishState();
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    // deafening also mutes, like most voice apps
    if (this.mic?.getAudioTracks().length) {
      this.muted = this.deafened;
      this.mic.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    }
    this.publishState();
  }

  async toggleCamera() {
    if (this.cam) {
      for (const p of this.peers.values()) {
        p.senders.cam.forEach((s) => p.pc.removeTrack(s));
        p.senders.cam = [];
      }
      this.cam.getTracks().forEach((t) => t.stop());
      this.cam = null;
      this.publishState();
      return;
    }
    try {
      this.cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch {
      this.error = 'Camera unavailable.';
      this.changed();
      return;
    }
    for (const p of this.peers.values()) {
      for (const t of this.cam.getTracks()) p.senders.cam.push(p.pc.addTrack(t, this.cam));
    }
    this.publishState();
  }

  async toggleScreen() {
    if (this.screen) {
      this.stopScreen();
      return;
    }
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch {
      return; // user cancelled
    }
    this.screen.getVideoTracks()[0]?.addEventListener('ended', () => this.stopScreen());
    for (const p of this.peers.values()) {
      for (const t of this.screen.getTracks()) p.senders.screen.push(p.pc.addTrack(t, this.screen));
    }
    this.publishState();
  }

  private stopScreen() {
    if (!this.screen) return;
    for (const p of this.peers.values()) {
      p.senders.screen.forEach((s) => p.pc.removeTrack(s));
      p.senders.screen = [];
    }
    this.screen.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.publishState();
  }
}

// ------------------------------------------------------------ active call --

let active: Call | null = null;
const activeListeners = new Set<() => void>();
let activeVersion = 0;

export function getActiveCall() {
  return active;
}
export function activeCallVersion() {
  return activeVersion;
}
export function subscribeActiveCall(l: () => void) {
  activeListeners.add(l);
  return () => activeListeners.delete(l);
}
function bump() {
  activeVersion++;
  activeListeners.forEach((l) => l());
}

export async function joinCall(identity: Identity, channelId: string, scopeId: string, channelName: string) {
  if (active?.channelId === channelId) return active;
  active?.leave();
  const call = new Call(identity, channelId, scopeId, channelName);
  active = call;
  call.subscribe(bump);
  bump();
  await call.join();
  return call;
}

/** channel id -> when we hung up there (so the other person staying doesn't "ring" us) */
const recentlyLeft = new Map<string, number>();
export function leftRecently(channelId: string) {
  const t = recentlyLeft.get(channelId);
  return t !== undefined && Date.now() - t < 10 * 60_000;
}

export function leaveCall() {
  if (active) recentlyLeft.set(active.channelId, Date.now());
  active?.leave();
  active = null;
  bump();
}
