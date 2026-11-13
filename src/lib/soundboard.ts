// Soundboard: built-in sounds (made on the fly with Web Audio, so there are no
// files to download) plus server sounds. In a call, pressing a sound tells the
// others which sound to play; each person plays it locally at their own
// volume for you (or not at all if they muted your soundboard).
import { getSettings } from './settings';
import { supabase } from './supabase';

export interface SoundRef {
  kind: 'default' | 'custom';
  id: string;
  name: string;
  emoji: string;
  url?: string;
}

export const DEFAULT_SOUNDS: SoundRef[] = [
  { kind: 'default', id: 'airhorn', name: 'Airhorn', emoji: '📯' },
  { kind: 'default', id: 'fart', name: 'Fart', emoji: '💨' },
  { kind: 'default', id: 'quack', name: 'Quack', emoji: '🦆' },
  { kind: 'default', id: 'cricket', name: 'Cricket', emoji: '🦗' },
  { kind: 'default', id: 'clap', name: 'Clap', emoji: '👏' },
  { kind: 'default', id: 'sadhorn', name: 'Sad Horn', emoji: '🎺' },
  { kind: 'default', id: 'badumtss', name: 'Ba Dum Tss', emoji: '🥁' },
  { kind: 'default', id: 'tada', name: 'Ta-da!', emoji: '🎉' },
  { kind: 'default', id: 'drumroll', name: 'Drumroll', emoji: '🪘' },
  { kind: 'default', id: 'boing', name: 'Boing', emoji: '🌀' },
  { kind: 'default', id: 'laser', name: 'Laser', emoji: '🔫' },
  { kind: 'default', id: 'whoosh', name: 'Whoosh', emoji: '💨' },
  { kind: 'default', id: 'applause', name: 'Applause', emoji: '🙌' },
  { kind: 'default', id: 'ding', name: 'Ding', emoji: '🔔' },
  { kind: 'default', id: 'heartbeat', name: 'Heartbeat', emoji: '💓' },
  { kind: 'default', id: 'levelup', name: 'Level Up', emoji: '⭐' },
  { kind: 'default', id: 'thunder', name: 'Thunder', emoji: '⛈️' },
];

const RATE = 44100;
let ctx: AudioContext | null = null;
function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function noise(c: OfflineAudioContext, dur: number) {
  const buf = c.createBuffer(1, Math.ceil(RATE * dur), RATE);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(c: OfflineAudioContext, at: number, attack: number, hold: number, release: number, peak = 1) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + attack + Math.max(0, hold));
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + Math.max(0, hold) + release);
  return g;
}

/** Build each built-in sound once. */
async function synth(id: string): Promise<AudioBuffer> {
  const len = { airhorn: 1.6, fart: 0.9, quack: 0.6, cricket: 1.6, clap: 0.5, sadhorn: 2.4, badumtss: 1.6, tada: 1.8, drumroll: 2.6, boing: 0.9, laser: 0.6, whoosh: 0.9, applause: 2.6, ding: 1.8, heartbeat: 1.8, levelup: 1.3, thunder: 3 }[id] ?? 1;
  const c = new OfflineAudioContext(1, Math.ceil(RATE * len), RATE);
  const out = c.createDynamicsCompressor();
  out.connect(c.destination);
  const osc = (type: OscillatorType, freq: number, at: number, dur: number, g: AudioNode) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    o.connect(g);
    o.start(at);
    o.stop(at + dur);
    return o;
  };
  // Early room reflections give short acoustic hits space without washing out the attack.
  const percussion = c.createGain();
  percussion.connect(out);
  for (const [time, level] of [[0.019, 0.15], [0.033, 0.09], [0.053, 0.06]]) {
    const delay = c.createDelay();
    const gain = c.createGain();
    delay.delayTime.value = time;
    gain.gain.value = level;
    percussion.connect(delay).connect(gain).connect(out);
  }

  const noiseHit = (at: number, decay: number, frequency: number, level: number, type: BiquadFilterType, q = 0.8) => {
    const source = noise(c, decay + 0.01);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    source.connect(filter).connect(env(c, at, 0.0015, 0.003, decay, level)).connect(percussion);
    source.start(at);
  };

  const drumHit = (at: number, pitch: number, strength: number, rim = false) => {
    // Drumhead modes are inharmonic, and the initial strike pulls the pitch sharp briefly.
    for (const [ratio, level, decay] of [[1, 0.44, 0.17], [1.59, 0.18, 0.11], [2.14, 0.1, 0.075], [2.92, 0.045, 0.045]]) {
      const envelope = env(c, at, 0.001, 0.003, decay, level * strength);
      envelope.connect(percussion);
      const voice = osc('sine', pitch * ratio * 1.16, at, decay + 0.006, envelope);
      voice.frequency.exponentialRampToValueAtTime(pitch * ratio, at + 0.025);
    }
    noiseHit(at, rim ? 0.15 : 0.07, rim ? 2400 : 1750, strength * (rim ? 0.82 : 0.25), 'bandpass');
    if (rim) noiseHit(at, 0.024, 4200, strength * 0.44, 'highpass');
  };

  const cymbalHit = (at: number, strength: number) => {
    noiseHit(at, 0.83, 4600, strength * 0.54, 'highpass');
    noiseHit(at, 0.42, 7600, strength * 0.45, 'bandpass', 1.2);
    noiseHit(at, 0.055, 9400, strength * 0.35, 'highpass');
    for (const [frequency, decay] of [[2749, 0.19], [3427, 0.31], [4817, 0.24], [6211, 0.17], [8171, 0.13]]) {
      const envelope = env(c, at, 0.003, 0.008, decay, 0.022 * strength);
      envelope.connect(percussion);
      osc('sine', frequency, at, decay + 0.012, envelope);
    }
  };

  const handClap = (at: number, strength: number, pitch: number) => {
    noiseHit(at, 0.035, pitch, strength * 0.64, 'bandpass');
    noiseHit(at + 0.004, 0.027, pitch * 2.4, strength * 0.4, 'highpass');
    noiseHit(at + 0.012, 0.105, pitch * 0.73, strength * 0.23, 'bandpass');
  };

  if (id === 'airhorn') {
    // three bursts of a brassy chord
    for (const [at, dur] of [[0, 0.22], [0.27, 0.22], [0.54, 0.95]]) {
      const g = env(c, at, 0.01, dur - 0.05, 0.08, 0.25);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      g.connect(lp).connect(out);
      for (const f of [311, 466, 622, 932]) osc('sawtooth', f, at, dur + 0.1, g);
    }
  } else if (id === 'fart') {
    const g = env(c, 0, 0.03, 0.5, 0.3, 0.9);
    const bp = c.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 400;
    g.connect(bp).connect(out);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, 0);
    o.frequency.linearRampToValueAtTime(70, 0.8);
    const wobble = c.createOscillator();
    const wg = c.createGain();
    wobble.frequency.value = 23;
    wg.gain.value = 30;
    wobble.connect(wg).connect(o.frequency);
    o.connect(g);
    const n = noise(c, 0.85);
    const ng = c.createGain();
    ng.gain.value = 0.25;
    n.connect(ng).connect(g);
    o.start(0);
    wobble.start(0);
    n.start(0);
    o.stop(0.85);
    wobble.stop(0.85);
  } else if (id === 'quack') {
    for (const at of [0, 0.28]) {
      const g = env(c, at, 0.01, 0.1, 0.1, 0.5);
      const f1 = c.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 1100;
      f1.Q.value = 3;
      g.connect(f1).connect(out);
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(420, at);
      o.frequency.exponentialRampToValueAtTime(260, at + 0.2);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.25);
    }
  } else if (id === 'cricket') {
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < 6; i++) {
        const at = k * 0.75 + i * 0.045;
        const g = env(c, at, 0.004, 0.015, 0.02, 0.18);
        g.connect(out);
        osc('sine', 4400, at, 0.05, g);
      }
  } else if (id === 'clap') {
    handClap(0.012, 0.95, 1350);
    handClap(0.18, 0.72, 1480);
  } else if (id === 'sadhorn') {
    // wah wah wah waaah
    const notes: [number, number, number][] = [[392, 0, 0.42], [370, 0.46, 0.42], [349, 0.92, 0.42], [330, 1.38, 0.95]];
    for (const [f, at, dur] of notes) {
      const g = env(c, at, 0.04, dur - 0.12, 0.1, 0.3);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(500, at);
      lp.frequency.linearRampToValueAtTime(1600, at + 0.15);
      lp.frequency.linearRampToValueAtTime(500, at + dur);
      g.connect(lp).connect(out);
      const o = osc('sawtooth', f, at, dur, g);
      if (f === 330) {
        const vib = c.createOscillator();
        const vg = c.createGain();
        vib.frequency.value = 6;
        vg.gain.value = 9;
        vib.connect(vg).connect(o.frequency);
        vib.start(at + 0.2);
        vib.stop(at + dur);
      }
    }
  } else if (id === 'badumtss') {
    drumHit(0.012, 155, 0.78);
    drumHit(0.158, 116, 1, true);
    cymbalHit(0.301, 0.9);
  } else if (id === 'tada') {
    // a quick pickup, then a big bright brass chord
    for (const [at, dur, fs] of [[0, 0.14, [523, 659]], [0.16, 1.5, [523, 659, 784, 1047]]] as [number, number, number[]][]) {
      const g = env(c, at, 0.015, dur - 0.3, 0.3, 0.22);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      g.connect(lp).connect(out);
      for (const f of fs) {
        osc('sawtooth', f, at, dur, g);
        osc('sawtooth', f * 1.004, at, dur, g); // slight detune = fuller section
      }
    }
  } else if (id === 'drumroll') {
    for (let i = 0; i < 27; i++) {
      const at = 0.012 + i * 0.063 + (Math.random() - 0.5) * 0.012;
      const accent = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.84 : 0.62;
      drumHit(at, 166 + Math.random() * 12, (0.21 + i * 0.021) * accent, true);
    }
    drumHit(1.78, 138, 1, true);
    cymbalHit(1.78, 0.9);
  } else if (id === 'boing') {
    const g = env(c, 0, 0.005, 0.1, 0.75, 0.6);
    g.connect(out);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, 0);
    o.frequency.exponentialRampToValueAtTime(520, 0.12);
    o.frequency.exponentialRampToValueAtTime(260, 0.8);
    const wob = c.createOscillator();
    const wg = c.createGain();
    wob.frequency.value = 14;
    wg.gain.value = 40;
    wob.connect(wg).connect(o.frequency);
    o.connect(g);
    o.start(0);
    wob.start(0);
    o.stop(0.9);
    wob.stop(0.9);
  } else if (id === 'laser') {
    const g = env(c, 0, 0.002, 0.05, 0.45, 0.4);
    g.connect(out);
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1800, 0);
    o.frequency.exponentialRampToValueAtTime(140, 0.5);
    o.connect(g);
    o.start(0);
    o.stop(0.6);
  } else if (id === 'whoosh') {
    const n = noise(c, 0.9);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, 0);
    bp.frequency.exponentialRampToValueAtTime(3000, 0.45);
    bp.frequency.exponentialRampToValueAtTime(500, 0.9);
    const g = env(c, 0, 0.35, 0.05, 0.45, 0.8);
    n.connect(bp).connect(g).connect(out);
    n.start(0);
  } else if (id === 'applause') {
    for (let person = 0; person < 9; person++) {
      const interval = 0.19 + Math.random() * 0.16;
      const pitch = 1000 + Math.random() * 1000;
      for (let at = 0.04 + Math.random() * 0.28; at < 2.35; at += interval + Math.random() * 0.035) {
        const swell = Math.sin(Math.PI * at / 2.4) ** 0.55;
        handClap(at, (0.2 + Math.random() * 0.26) * swell, pitch);
      }
    }
  } else if (id === 'ding') {
    for (const [mult, level] of [[1, 0.5], [2.76, 0.18], [5.4, 0.08]]) {
      const g = env(c, 0, 0.002, 0.01, 1.7, level);
      g.connect(out);
      osc('sine', 1318 * mult, 0, 1.8, g);
    }
  } else if (id === 'heartbeat') {
    for (const beat of [0, 0.85]) {
      for (const [d, f] of [[0, 70], [0.18, 58]]) {
        const g = env(c, beat + d, 0.005, 0.03, 0.18, 0.9);
        g.connect(out);
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * 1.6, beat + d);
        o.frequency.exponentialRampToValueAtTime(f, beat + d + 0.06);
        o.connect(g);
        o.start(beat + d);
        o.stop(beat + d + 0.3);
      }
    }
  } else if (id === 'levelup') {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      const g = env(c, i * 0.09, 0.005, 0.05, i === 4 ? 0.6 : 0.12, 0.18);
      g.connect(out);
      osc('square', f, i * 0.09, i === 4 ? 0.8 : 0.2, g);
    });
  } else if (id === 'thunder') {
    const n = noise(c, 3);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, 0);
    lp.frequency.exponentialRampToValueAtTime(120, 2.8);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(1, 0.04);
    g.gain.exponentialRampToValueAtTime(0.35, 0.5);
    g.gain.setValueAtTime(0.35, 0.6);
    g.gain.exponentialRampToValueAtTime(0.7, 0.75); // second rumble
    g.gain.exponentialRampToValueAtTime(0.0001, 3);
    n.connect(lp).connect(g).connect(out);
    n.start(0);
  }
  return c.startRendering();
}

const buffers = new Map<string, Promise<AudioBuffer>>();

async function bufferFor(s: SoundRef): Promise<AudioBuffer | null> {
  const key = s.kind === 'default' ? `d:${s.id}` : `u:${s.url}`;
  let b = buffers.get(key);
  if (!b) {
    if (s.kind === 'default') b = synth(s.id);
    else {
      if (!s.url || !isOurAsset(s.url)) return null;
      b = fetch(s.url)
        .then((r) => {
          if (!r.ok || Number(r.headers.get('content-length') ?? 0) > 1.5 * 1024 * 1024) throw new Error('bad sound');
          return r.arrayBuffer();
        })
        .then((a) => audio().decodeAudioData(a));
    }
    buffers.set(key, b);
    b.catch(() => buffers.delete(key));
  }
  return b;
}

/** Only sounds stored by Venband (never arbitrary URLs that would leak your IP). */
export function isOurAsset(url: string) {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  return Boolean(base) && url.startsWith(`${base.replace(/\/$/, '')}/storage/v1/object/public/server-assets/`);
}

/** Play a sound locally. `from` is who played it (for per-person volume / mute). */
export async function playSound(s: SoundRef, from?: string) {
  const sb = getSettings().soundboard;
  if (from && sb.muted.includes(from)) return;
  const vol = (sb.volume / 100) * ((from ? (sb.perUser[from] ?? 100) : 100) / 100);
  if (vol <= 0) return;
  const buf = await bufferFor(s).catch(() => null);
  if (!buf) return;
  const a = audio();
  const src = a.createBufferSource();
  src.buffer = buf;
  // even out loud and quiet uploads so nobody's headphones get blasted
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 6;
  const g = a.createGain();
  g.gain.value = Math.min(1, vol) * 0.8;
  src.connect(comp).connect(g).connect(a.destination);
  src.start();
}

export function playExpressionSound(url: string, volume = 1) {
  return playSound({ kind: 'custom', id: url, name: '', emoji: '', url }).then(() => void volume);
}

/** Sounds from servers you're in. */
export async function serverSounds(): Promise<(SoundRef & { server: string })[]> {
  const { data } = await supabase.rpc('my_expressions');
  return ((data ?? []) as { id: string; kind: string; name: string; url: string; emoji: string | null; server_name: string }[])
    .filter((x) => x.kind === 'sound')
    .map((x) => ({ kind: 'custom' as const, id: x.id, name: x.name, emoji: x.emoji ?? '🔊', url: x.url, server: x.server_name }));
}
