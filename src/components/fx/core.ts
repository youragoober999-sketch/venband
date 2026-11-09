// Shared procedural-art toolkit for Venband's profile effects.
//
// Every shape below is drawn with Canvas 2D paths — there are no images,
// sprites, videos or external libraries. Effects compose these primitives
// with palette colours to build layered, animated scenes.
export interface FxP {
  x: number; y: number; vx: number; vy: number; size: number; rot: number; vr: number;
  life: number; max: number; hue: number; phase: number; depth: number; k?: number;
}
export interface FxLayer {
  count: number;
  additive?: boolean;
  spawn: (w: number, h: number, initial: boolean) => FxP;
  step?: (p: FxP, dt: number, t: number, w: number, h: number) => void;
  draw: (c: CanvasRenderingContext2D, p: FxP, t: number) => void;
}
export interface FxDef extends FxLayer {
  layers?: FxLayer[];
  backdrop?: (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}

export const R = Math.random;
export const TAU = Math.PI * 2;
export const P = (o: Partial<FxP>): FxP => ({
  x: 0, y: 0, vx: 0, vy: 0, size: 3, rot: R() * TAU, vr: 0,
  life: 0, max: 8, hue: 0, phase: R() * TAU, depth: 0.4 + R() * 0.6, ...o,
});
export const fade = (p: FxP) => Math.max(0, Math.min(1, p.life / 0.6, (p.max - p.life) / 0.8));
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const pick = <T,>(a: readonly T[]): T => a[Math.floor(R() * a.length)];
/** Stable pseudo-random in [0,1) — used by backdrops so details don't flicker. */
export const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Deterministic value in [a,b) from an integer seed. */
export const h = (i: number, a = 0, b = 1) => a + hash(i) * (b - a);

// ------------------------------------------------------------------ colours --
const hex2rgb = (hex: string): [number, number, number] => {
  const s = hex.replace('#', '');
  const n = s.length === 3 ? s.split('').map((x) => x + x).join('') : s;
  const v = parseInt(n.slice(0, 6) || 'ffffff', 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const rgb2hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
/** Blend two hex colours (t=0 -> a, t=1 -> b). */
export function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = hex2rgb(a);
  const [r2, g2, b2] = hex2rgb(b);
  return rgb2hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
export const lighten = (hex: string, t: number) => mix(hex, '#ffffff', t);
export const darken = (hex: string, t: number) => mix(hex, '#000000', t);
/** Hex colour + alpha (0..1) as an 8-digit hex. */
export const A = (hex: string, a: number) =>
  `${hex}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0')}`;
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
};
/** A soft radial glow centred on the current origin. */
export function glow(c: CanvasRenderingContext2D, radius: number, colour: string, alpha = 1) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, radius);
  g.addColorStop(0, rgba(colour, alpha));
  g.addColorStop(0.32, rgba(colour, alpha * 0.5));
  g.addColorStop(1, rgba(colour, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, radius, 0, TAU);
  c.fill();
}

// ------------------------------------------------------------------- shapes --
export function star(c: CanvasRenderingContext2D, s: number, points = 5, inner = 0.44, spin = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? s * inner : s;
    const a = spin + (i * Math.PI) / points;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}
export function star4(c: CanvasRenderingContext2D, s: number, thin = 0.26) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? s * thin : s;
    const a = (i * Math.PI) / 4;
    i ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
}
export function heart(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, s * 0.35);
  c.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
  c.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
  c.closePath();
}
export function petal(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, -s);
  c.bezierCurveTo(s * 0.95, -s * 0.45, s * 0.68, s * 0.82, 0, s);
  c.bezierCurveTo(-s * 0.68, s * 0.82, -s * 0.95, -s * 0.45, 0, -s);
  c.closePath();
}
export function leaf(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, -s);
  c.quadraticCurveTo(s * 0.95, -s * 0.18, 0, s);
  c.quadraticCurveTo(-s * 0.95, -s * 0.18, 0, -s);
  c.closePath();
}
export function feather(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, s);
  c.bezierCurveTo(s * 0.5, s * 0.18, s * 0.4, -s * 0.72, 0, -s * 1.25);
  c.bezierCurveTo(-s * 0.4, -s * 0.72, -s * 0.5, s * 0.18, 0, s);
  c.closePath();
}
export function diamond(c: CanvasRenderingContext2D, s: number, ratio = 0.66) {
  c.beginPath();
  c.moveTo(0, -s);
  c.lineTo(s * ratio, 0);
  c.lineTo(0, s);
  c.lineTo(-s * ratio, 0);
  c.closePath();
}
export function polygon(c: CanvasRenderingContext2D, s: number, sides: number, spin = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = spin + (i * TAU) / sides;
    const x = Math.cos(a) * s;
    const y = Math.sin(a) * s;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}
export const hexagon = (c: CanvasRenderingContext2D, s: number) => polygon(c, s, 6);
export const triangle = (c: CanvasRenderingContext2D, s: number) => polygon(c, s, 3);
export const square = (c: CanvasRenderingContext2D, s: number) => polygon(c, s, 4, Math.PI / 4);

/** Six-armed snowflake; stroke it rather than filling. */
export function snowflake(c: CanvasRenderingContext2D, s: number, arms = 6) {
  c.beginPath();
  for (let i = 0; i < arms; i++) {
    const a = (i * TAU) / arms;
    const x = Math.cos(a) * s;
    const y = Math.sin(a) * s;
    c.moveTo(0, 0);
    c.lineTo(x, y);
    for (const side of [-1, 1]) {
      const ba = a + side * 0.6;
      c.moveTo(x * 0.58, y * 0.58);
      c.lineTo(Math.cos(ba) * s * 0.78, Math.sin(ba) * s * 0.78);
    }
  }
}
export function flower(c: CanvasRenderingContext2D, s: number, petals = 6, t = 0) {
  for (let i = 0; i < petals; i++) {
    const a = (i * TAU) / petals + t * 0.08;
    c.beginPath();
    c.ellipse(Math.cos(a) * s * 0.56, Math.sin(a) * s * 0.56, s * 0.3, s * 0.5, a, 0, TAU);
  }
}
export function spiral(c: CanvasRenderingContext2D, s: number, turns = 3, phase = 0) {
  c.beginPath();
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * Math.PI * 2 * turns + phase;
    const r = s * (i / 56);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
}
export function crown(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(-s, s * 0.55);
  c.lineTo(-s * 0.82, -s * 0.55);
  c.lineTo(-s * 0.25, -s * 0.05);
  c.lineTo(0, -s);
  c.lineTo(s * 0.28, -s * 0.05);
  c.lineTo(s * 0.82, -s * 0.55);
  c.lineTo(s, s * 0.55);
  c.closePath();
}
export function rune(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, -s);
  c.lineTo(s * 0.68, s);
  c.lineTo(-s * 0.68, s);
  c.closePath();
  c.moveTo(-s * 0.38, 0);
  c.lineTo(s * 0.38, 0);
  c.moveTo(0, -s * 0.45);
  c.lineTo(0, s * 0.62);
}
export function bird(c: CanvasRenderingContext2D, s: number, flap: number) {
  const f = Math.sin(flap) * 0.65;
  c.beginPath();
  c.moveTo(-s, -s * f);
  c.quadraticCurveTo(-s * 0.45, -s * 0.15, 0, s * 0.15);
  c.quadraticCurveTo(s * 0.45, -s * 0.15, s, -s * f);
  c.quadraticCurveTo(s * 0.45, s * 0.12, 0, s * 0.42);
  c.quadraticCurveTo(-s * 0.45, s * 0.12, -s, -s * f);
  c.closePath();
}
export function bat(c: CanvasRenderingContext2D, s: number, flap: number) {
  const f = Math.sin(flap) * 0.5;
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(-s * 0.4, -s * (0.5 + f), -s, -s * f);
  c.lineTo(-s * 0.75, s * 0.2);
  c.lineTo(-s * 0.55, s * 0.05);
  c.lineTo(-s * 0.35, s * 0.3);
  c.quadraticCurveTo(0, s * 0.2, s * 0.35, s * 0.3);
  c.lineTo(s * 0.55, s * 0.05);
  c.lineTo(s * 0.75, s * 0.2);
  c.lineTo(s, -s * f);
  c.quadraticCurveTo(s * 0.4, -s * (0.5 + f), 0, 0);
  c.closePath();
}
export function butterfly(c: CanvasRenderingContext2D, s: number, flap: number, colour: string, accent: string) {
  const f = 0.24 + Math.abs(Math.sin(flap)) * 0.76;
  for (const side of [-1, 1]) {
    c.save();
    c.scale(side * f, 1);
    c.fillStyle = colour;
    c.beginPath();
    c.ellipse(s * 0.56, -s * 0.34, s * 0.62, s * 0.5, 0.42, 0, TAU);
    c.ellipse(s * 0.42, s * 0.36, s * 0.42, s * 0.32, -0.34, 0, TAU);
    c.fill();
    c.fillStyle = accent;
    c.globalAlpha *= 0.7;
    c.beginPath();
    c.arc(s * 0.7, -s * 0.4, s * 0.13, 0, TAU);
    c.arc(s * 0.46, s * 0.34, s * 0.09, 0, TAU);
    c.fill();
    c.restore();
  }
  c.fillStyle = accent;
  c.fillRect(-0.9, -s * 0.6, 1.8, s * 1.2);
  c.beginPath();
  c.moveTo(0, -s * 0.55);
  c.quadraticCurveTo(-s * 0.22, -s * 1, -s * 0.42, -s * 1.08);
  c.moveTo(0, -s * 0.55);
  c.quadraticCurveTo(s * 0.22, -s * 1, s * 0.42, -s * 1.08);
  c.strokeStyle = accent;
  c.lineWidth = Math.max(0.6, s * 0.07);
  c.stroke();
}
export function note(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.ellipse(0, 0, s * 0.55, s * 0.4, -0.4, 0, TAU);
  c.fill();
  c.fillRect(s * 0.42, -s * 1.7, s * 0.16, s * 1.7);
  c.beginPath();
  c.moveTo(s * 0.58, -s * 1.7);
  c.quadraticCurveTo(s * 1.2, -s * 1.3, s * 0.9, -s * 0.8);
  c.lineWidth = s * 0.16;
  c.stroke();
}
export function eye(c: CanvasRenderingContext2D, s: number, open: number, iris: string, pupil = '#08060a') {
  c.save();
  c.scale(1, Math.max(0.04, open));
  c.beginPath();
  c.moveTo(-s, 0);
  c.quadraticCurveTo(0, -s * 0.78, s, 0);
  c.quadraticCurveTo(0, s * 0.78, -s, 0);
  c.fillStyle = '#f5efdf';
  c.fill();
  c.fillStyle = iris;
  c.beginPath();
  c.arc(0, 0, s * 0.42, 0, TAU);
  c.fill();
  c.fillStyle = pupil;
  c.beginPath();
  c.arc(0, 0, s * 0.19, 0, TAU);
  c.fill();
  c.fillStyle = '#ffffffcc';
  c.beginPath();
  c.arc(-s * 0.12, -s * 0.12, s * 0.08, 0, TAU);
  c.fill();
  c.restore();
}
export function puff(c: CanvasRenderingContext2D, s: number, seed: number, colour: string) {
  c.fillStyle = colour;
  for (let i = 0; i < 7; i++) {
    const a = h(seed + i, 0, TAU);
    const rr = s * h(seed + i * 2.7, 0.15, 0.55);
    c.beginPath();
    c.arc(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.3, rr, 0, TAU);
    c.fill();
  }
}
/** Scatter deterministic stars across the card. Keeps backdrops stable. */
export function starfield(c: CanvasRenderingContext2D, w: number, hh: number, t: number, count: number, tint: string, alpha = 0.7) {
  for (let i = 0; i < count; i++) {
    const x = h(i * 3.1 + 0.7) * w;
    const y = h(i * 7.7 + 1.3) * hh;
    const tw = 0.35 + Math.abs(Math.sin(t * (0.7 + h(i) * 1.6) + i * 1.7)) * 0.65;
    const s = 0.5 + h(i * 5.3) * 1.6;
    c.globalAlpha = alpha * tw;
    c.fillStyle = i % 7 ? '#ffffff' : tint;
    c.beginPath();
    c.arc(x, y, s, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}
