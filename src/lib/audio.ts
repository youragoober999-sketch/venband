// Plays everyone's call audio through one Web Audio graph so each voice and
// each screen-share stream can have its own volume (0-200%), be muted, and
// "attenuate" (duck) streams while people are talking.
import { createStore } from './store';
import { getSettings, settingsStore } from './settings';

export interface SinkInput {
  key: string; // "user:<id>" or "stream:<id>"
  stream: MediaStream;
  kind: 'voice' | 'stream';
}

/** Per-call, not saved: streams you stopped watching or muted locally. */
export const callUi = createStore<{ hidden: Record<string, boolean>; muted: Record<string, boolean>; selfPreview: boolean }>({
  hidden: {},
  muted: {},
  // Showing your own screen share to yourself creates a "hall of mirrors"
  // (and gets captured again) when you share your whole screen. Off by default.
  selfPreview: false,
});

export function streamKey(userId: string) {
  return `stream:${userId}`;
}
export function voiceKey(userId: string) {
  return `user:${userId}`;
}

export function volumeOf(key: string): number {
  return getSettings().volumes[key] ?? 100;
}
export function attenuationOf(key: string): number {
  return getSettings().volumes[`att:${key}`] ?? 0;
}

interface Node {
  input: SinkInput;
  el: HTMLAudioElement;
  src: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
  analyser: AnalyserNode | null;
}

class Mixer {
  private ctx: AudioContext | null = null;
  private nodes = new Map<string, Node>();
  private deafened = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf = new Uint8Array(256);
  private sink = '';

  private context(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const resume = () => this.ctx?.resume().catch(() => {});
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
    }
    return this.ctx;
  }

  set(inputs: SinkInput[], deafened: boolean) {
    this.deafened = deafened;
    const ctx = this.context();
    const wanted = new Map(inputs.map((i) => [`${i.key}|${i.stream.id}`, i]));
    for (const [id, n] of this.nodes) {
      if (!wanted.has(id)) {
        n.src?.disconnect();
        n.gain?.disconnect();
        n.el.srcObject = null;
        this.nodes.delete(id);
      }
    }
    for (const [id, input] of wanted) {
      if (this.nodes.has(id)) continue;
      // Chrome only feeds remote WebRTC audio into Web Audio while a media
      // element is also playing it, so keep a muted <audio> attached.
      const el = new Audio();
      el.srcObject = input.stream;
      el.muted = Boolean(ctx);
      el.play().catch(() => {});
      let src: MediaStreamAudioSourceNode | null = null;
      let gain: GainNode | null = null;
      let analyser: AnalyserNode | null = null;
      if (ctx) {
        src = ctx.createMediaStreamSource(input.stream);
        gain = ctx.createGain();
        src.connect(gain).connect(ctx.destination);
        if (input.kind === 'voice') {
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
        }
      }
      this.nodes.set(id, { input, el, src, gain, analyser });
    }
    this.apply();
    this.applySink();
    if (this.nodes.size && !this.timer) this.timer = setInterval(() => this.apply(), 120);
    if (!this.nodes.size && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private someoneTalking(): boolean {
    for (const n of this.nodes.values()) {
      if (!n.analyser) continue;
      n.analyser.getByteFrequencyData(this.buf);
      let sum = 0;
      for (let i = 0; i < 128; i++) sum += this.buf[i];
      if (sum / 128 > 14) return true;
    }
    return false;
  }

  apply() {
    const talking = this.someoneTalking();
    const { muted } = callUi.get();
    for (const n of this.nodes.values()) {
      const off = this.deafened || muted[n.input.key];
      let v = off ? 0 : volumeOf(n.input.key) / 100;
      if (n.input.kind === 'stream' && talking) v *= 1 - attenuationOf(n.input.key) / 100;
      if (n.gain && this.ctx) n.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
      else n.el.volume = Math.min(1, v);
    }
  }

  applySink() {
    const id = getSettings().voice.outputId;
    if (id === this.sink) return;
    this.sink = id;
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    ctx?.setSinkId?.(id).catch(() => {});
    if (!ctx)
      for (const n of this.nodes.values()) (n.el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(id).catch(() => {});
  }
}

export const mixer = new Mixer();
settingsStore.subscribe(() => {
  mixer.apply();
  mixer.applySink();
});
callUi.subscribe(() => mixer.apply());
