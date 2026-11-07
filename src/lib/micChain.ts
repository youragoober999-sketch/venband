// The microphone processing chain used for calls (and the mic test in
// Settings): mic → speech high-pass → [voice isolation] → input volume → out.
//
// Voice isolation = RNNoise, an open-source (BSD) neural network trained to
// keep human speech and drop everything else (fans, keyboards, music, traffic,
// pets, room hum), followed by an adaptive noise gate that closes between your
// words — so quieter, farther-away sounds and voices don't come through either.
// It runs in an AudioWorklet, off the main thread. Volume and isolation can be
// changed live, mid-call, without re-opening the microphone.
import { loadRnnoise, NoiseGateWorkletNode, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import gateWorkletUrl from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export type IsolationStrength = 'standard' | 'strong';
export interface MicChainOptions {
  /** percent, 0–200 */
  volume: number;
  isolation: boolean;
  strength: IsolationStrength;
}
export interface MicChain {
  stream: MediaStream;
  /** true while RNNoise + the gate are actually in the path */
  readonly isolating: boolean;
  setVolume(pct: number): void;
  setIsolation(on: boolean, strength?: IsolationStrength): Promise<void>;
  /** output level 0..1, for meters */
  level(): number;
  close(): void;
}

// gate thresholds (dBFS): "strong" also drops voices / sounds quieter than yours
const GATE: Record<IsolationStrength, { open: number; close: number; holdMs: number }> = {
  standard: { open: -52, close: -58, holdMs: 260 },
  strong: { open: -40, close: -46, holdMs: 200 },
};

let wasm: Promise<ArrayBuffer> | null = null;
const loadedCtx = new WeakSet<BaseAudioContext>();
async function prepare(ctx: AudioContext) {
  wasm ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdUrl }).catch((e) => {
    wasm = null;
    throw e;
  });
  if (!loadedCtx.has(ctx)) {
    await Promise.all([ctx.audioWorklet.addModule(rnnoiseWorkletUrl), ctx.audioWorklet.addModule(gateWorkletUrl)]);
    loadedCtx.add(ctx);
  }
  return wasm;
}

export const isolationSupported = () => typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';

export async function createMicChain(raw: MediaStream, opts: MicChainOptions): Promise<MicChain> {
  // RNNoise works on 48 kHz audio
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const source = ctx.createMediaStreamSource(raw);
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 80; // rumble, desk knocks, mains hum
  const gain = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();
  const meter = ctx.createAnalyser();
  meter.fftSize = 512;
  const buf = new Float32Array(meter.fftSize);
  gain.connect(dest);
  gain.connect(meter);
  source.connect(highpass);

  let iso: AudioNode[] = [];
  let isolating = false;
  const rewire = () => {
    highpass.disconnect();
    iso.forEach((n) => n.disconnect());
    let at: AudioNode = highpass;
    for (const n of iso) {
      at.connect(n);
      at = n;
    }
    at.connect(gain);
  };
  const setVolume = (pct: number) => gain.gain.setTargetAtTime(Math.max(0, Math.min(2, pct / 100)), ctx.currentTime, 0.03);
  const setIsolation = async (on: boolean, strength: IsolationStrength = opts.strength) => {
    iso.forEach((n) => {
      n.disconnect();
      (n as { destroy?: () => void }).destroy?.();
    });
    iso = [];
    isolating = false;
    if (on && isolationSupported()) {
      try {
        const wasmBinary = await prepare(ctx);
        const g = GATE[strength];
        iso = [
          new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 }),
          new NoiseGateWorkletNode(ctx, { openThreshold: g.open, closeThreshold: g.close, holdMs: g.holdMs, maxChannels: 1 }),
        ];
        isolating = true;
      } catch (e) {
        console.warn('voice isolation unavailable', e);
        iso = [];
      }
    }
    rewire();
  };

  setVolume(opts.volume);
  await setIsolation(opts.isolation, opts.strength);
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  // keep the original track's label / settings reachable for device pickers
  const out = dest.stream;
  return {
    stream: out,
    get isolating() {
      return isolating;
    },
    setVolume,
    setIsolation,
    level() {
      meter.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.min(1, Math.sqrt(s / buf.length) * 4);
    },
    close() {
      iso.forEach((n) => (n as { destroy?: () => void }).destroy?.());
      raw.getTracks().forEach((t) => t.stop());
      out.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
