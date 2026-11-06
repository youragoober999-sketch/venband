// Venband's sound set — every sound is synthesised here with Web Audio (FM
// bells, plucked tones, filtered noise, a little room reverb), so there are no
// files to download and nothing borrowed from another app. One master chain
// (soft compressor + short reverb) keeps them consistent and never harsh.
//
//   sfx('mention')   sfx('mute')   sfx('stream_start')   …
//
// Volume: Settings → Notifications (venband:notify-volume). Each sound can be
// switched off on its own (venband:sfx-off = comma-separated names).

export type SfxName =
  | 'message'
  | 'mention'
  | 'dm'
  | 'notification'
  | 'call_connect'
  | 'call_end'
  | 'user_join'
  | 'user_leave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'stream_start'
  | 'stream_stop'
  | 'ring_in'
  | 'ring_out'
  | 'error';

export const SFX_LABEL: Record<SfxName, string> = {
  message: 'New message',
  mention: 'Mentioned / pinged',
  dm: 'Direct message',
  notification: 'Notification',
  call_connect: 'You joined a call',
  call_end: 'You left a call',
  user_join: 'Someone joined the call',
  user_leave: 'Someone left the call',
  mute: 'Mute',
  unmute: 'Unmute',
  deafen: 'Deafen',
  undeafen: 'Undeafen',
  stream_start: 'Screen share started',
  stream_stop: 'Screen share stopped',
  ring_in: 'Incoming call',
  ring_out: 'Calling…',
  error: 'Something went wrong',
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    // a short, soft "room": generated impulse response, mixed in quietly
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    master = ctx.createGain();
    master.connect(comp);
    master.connect(verb).connect(wet).connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return { a: ctx, out: master! };
}

export function sfxVolume() {
  try {
    const v = Number(localStorage.getItem('venband:notify-volume') ?? '0.8');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
  } catch {
    return 0.8;
  }
}
export function sfxOff(): Set<string> {
  try {
    return new Set((localStorage.getItem('venband:sfx-off') ?? '').split(',').filter(Boolean));
  } catch {
    return new Set();
  }
}
export function setSfxEnabled(name: SfxName, on: boolean) {
  const off = sfxOff();
  if (on) off.delete(name);
  else off.add(name);
  try {
    localStorage.setItem('venband:sfx-off', [...off].join(','));
  } catch {
    /* storage blocked */
  }
}

// ---------------------------------------------------------------- voices --
/** A soft FM bell / glass chime: bright strike that mellows as it rings. */
function bell(freq: number, at: number, dur: number, vol: number, bright = 1, pan = 0) {
  const { a, out } = audio();
  const t = a.currentTime + at;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = a.createStereoPanner();
  p.pan.value = pan;
  const carrier = a.createOscillator();
  carrier.frequency.value = freq;
  const mod = a.createOscillator();
  mod.frequency.value = freq * 3.5;
  const index = a.createGain();
  index.gain.setValueAtTime(freq * 2.2 * bright, t);
  index.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur * 0.6);
  mod.connect(index).connect(carrier.frequency);
  carrier.connect(g).connect(p).connect(out);
  carrier.start(t);
  mod.start(t);
  carrier.stop(t + dur + 0.05);
  mod.stop(t + dur + 0.05);
}

/** A round, woody pluck (marimba-ish). */
function pluck(freq: number, at: number, dur: number, vol: number, pan = 0) {
  const { a, out } = audio();
  const t = a.currentTime + at;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(5000, freq * 6), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 1.5), t + dur);
  const p = a.createStereoPanner();
  p.pan.value = pan;
  g.connect(lp).connect(p).connect(out);
  for (const [mult, level, type] of [[1, 1, 'sine'], [4, 0.18, 'sine'], [2, 0.25, 'triangle']] as const) {
    const o = a.createOscillator();
    const og = a.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    og.gain.value = level;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

/** A short pitched blip that bends (mute / unmute). */
function blip(from: number, to: number, at: number, dur: number, vol: number) {
  const { a, out } = audio();
  const t = a.currentTime + at;
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Filtered noise that sweeps (whoosh up / down). */
function whoosh(fromHz: number, toHz: number, at: number, dur: number, vol: number) {
  const { a, out } = audio();
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(fromHz, t);
  bp.frequency.exponentialRampToValueAtTime(toHz, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
}

// ------------------------------------------------------------ the sounds --
const N = (semis: number) => 440 * 2 ** (semis / 12); // 0 = A4
const SOUNDS: Record<SfxName, (v: number) => void> = {
  // two soft glass notes, a fifth apart
  message: (v) => {
    bell(N(5), 0, 0.7, 0.07 * v, 0.6, -0.1);
    bell(N(0), 0.085, 0.9, 0.06 * v, 0.6, 0.1);
  },
  // brighter rising triad with a sparkle on top — you notice it
  mention: (v) => {
    bell(N(3), 0, 0.6, 0.09 * v, 1, -0.2);
    bell(N(7), 0.07, 0.6, 0.09 * v, 1, 0);
    bell(N(10), 0.14, 0.9, 0.1 * v, 1.2, 0.2);
    bell(N(22), 0.2, 0.5, 0.025 * v, 0.4, 0.3);
  },
  // warm marimba pair, distinct from server messages
  dm: (v) => {
    pluck(N(2), 0, 0.55, 0.12 * v, -0.15);
    pluck(N(9), 0.1, 0.8, 0.11 * v, 0.15);
  },
  notification: (v) => bell(N(7), 0, 1.1, 0.08 * v, 0.8),
  // rising major chord, arpeggiated
  call_connect: (v) => [0, 4, 7, 12].forEach((s, i) => pluck(N(s - 2), i * 0.07, 0.7, 0.1 * v, -0.3 + i * 0.2)),
  // falling, resolved
  call_end: (v) => [12, 7, 4, 0].forEach((s, i) => pluck(N(s - 5), i * 0.08, 0.6, 0.09 * v, 0.3 - i * 0.2)),
  user_join: (v) => {
    pluck(N(0), 0, 0.4, 0.09 * v);
    pluck(N(7), 0.09, 0.55, 0.09 * v);
  },
  user_leave: (v) => {
    pluck(N(7), 0, 0.4, 0.08 * v);
    pluck(N(0), 0.09, 0.55, 0.08 * v);
  },
  mute: (v) => blip(N(10), N(3), 0, 0.12, 0.12 * v),
  unmute: (v) => blip(N(3), N(10), 0, 0.12, 0.12 * v),
  deafen: (v) => {
    blip(N(5), N(-7), 0, 0.16, 0.13 * v);
    blip(N(-2), N(-12), 0.05, 0.18, 0.08 * v);
  },
  undeafen: (v) => {
    blip(N(-7), N(5), 0, 0.16, 0.13 * v);
    blip(N(-12), N(-2), 0.05, 0.18, 0.08 * v);
  },
  stream_start: (v) => {
    whoosh(400, 4200, 0, 0.42, 0.1 * v);
    bell(N(12), 0.3, 0.7, 0.07 * v, 0.9);
  },
  stream_stop: (v) => {
    whoosh(3600, 300, 0, 0.42, 0.09 * v);
    bell(N(5), 0.3, 0.6, 0.06 * v, 0.7);
  },
  // a melodic phrase you'd recognise as "Venband is calling"
  ring_in: (v) => [0, 4, 7, 11, 7, 12].forEach((s, i) => bell(N(s), i * 0.16, 0.8, (i === 5 ? 0.11 : 0.08) * v, 0.9, (i % 2 ? 0.25 : -0.25))),
  ring_out: (v) => {
    pluck(N(-2), 0, 1, 0.07 * v);
    pluck(N(2), 0.34, 1.2, 0.07 * v);
  },
  error: (v) => {
    blip(N(-5), N(-9), 0, 0.14, 0.1 * v);
    blip(N(-9), N(-14), 0.12, 0.18, 0.1 * v);
  },
};

const last = new Map<string, number>();
/** Play a Venband sound (rate-limited per sound so bursts don't stack). */
export function sfx(name: SfxName, opts: { force?: boolean } = {}) {
  if (!opts.force && sfxOff().has(name)) return;
  const now = Date.now();
  const gap = name === 'message' || name === 'dm' || name === 'mention' ? 1200 : 120;
  if (!opts.force && now - (last.get(name) ?? 0) < gap) return;
  last.set(name, now);
  const v = sfxVolume();
  if (v <= 0) return;
  try {
    SOUNDS[name](v);
  } catch {
    /* audio is blocked until the person interacts with the page */
  }
}

let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringKind: 'incoming' | 'outgoing' | null = null;
export function startRing(kind: 'incoming' | 'outgoing') {
  if (ringKind === kind) return;
  stopRing();
  ringKind = kind;
  document.documentElement.dataset.ringing = kind; // lets tests (and devtools) see what's ringing
  const play = () => sfx(kind === 'incoming' ? 'ring_in' : 'ring_out', { force: !sfxOff().has(kind === 'incoming' ? 'ring_in' : 'ring_out') });
  play();
  ringTimer = setInterval(play, kind === 'incoming' ? 2400 : 3000);
}
export function stopRing(kind?: 'incoming' | 'outgoing') {
  if (kind && ringKind !== kind) return;
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  ringKind = null;
  document.documentElement.dataset.ringing = '';
}
