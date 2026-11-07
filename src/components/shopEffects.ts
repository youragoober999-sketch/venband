// Profile effects from the Venband Shop: palette-driven particle systems for
// the profile-card canvas in Cosmetics.tsx (same EffectDef shape).
import { ITEMS } from '../lib/shop';
import { LOGO_PATH } from './logoPath';

export interface FxP {
  x: number; y: number; vx: number; vy: number; size: number; rot: number; vr: number;
  life: number; max: number; hue: number; phase: number; depth: number; k?: number;
}
export interface FxDef {
  count: number;
  additive?: boolean;
  spawn: (w: number, h: number, initial: boolean) => FxP;
  step?: (p: FxP, dt: number, t: number, w: number, h: number) => void;
  draw: (c: CanvasRenderingContext2D, p: FxP, t: number) => void;
  backdrop?: (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}
const R = Math.random;
const TAU = Math.PI * 2;
const P = (o: Partial<FxP>): FxP => ({ x: 0, y: 0, vx: 0, vy: 0, size: 3, rot: R() * TAU, vr: 0, life: 0, max: 8, hue: 0, phase: R() * TAU, depth: 0.4 + R() * 0.6, ...o });
const fade = (p: FxP) => Math.max(0, Math.min(1, p.life / 0.6, (p.max - p.life) / 0.8));
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];

// ------------------------------------------------------------------ shapes --
function star4(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.28 : s; const a = (i * Math.PI) / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  c.closePath();
}
function heart(c: CanvasRenderingContext2D, s: number) {
  c.beginPath(); c.moveTo(0, s * 0.35);
  c.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
  c.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35); c.closePath();
}
function petal(c: CanvasRenderingContext2D, s: number) {
  c.beginPath(); c.moveTo(0, -s); c.bezierCurveTo(s * 0.9, -s * 0.4, s * 0.6, s * 0.8, 0, s); c.bezierCurveTo(-s * 0.6, s * 0.8, -s * 0.9, -s * 0.4, 0, -s); c.closePath();
}
function feather(c: CanvasRenderingContext2D, s: number) {
  c.beginPath(); c.moveTo(0, s); c.bezierCurveTo(s * 0.45, s * 0.2, s * 0.35, -s * 0.7, 0, -s * 1.2); c.bezierCurveTo(-s * 0.35, -s * 0.7, -s * 0.45, s * 0.2, 0, s); c.closePath();
}
function bird(c: CanvasRenderingContext2D, s: number, flap: number) {
  const f = Math.sin(flap) * 0.6;
  c.beginPath(); c.moveTo(-s, -s * f); c.quadraticCurveTo(-s * 0.45, -s * 0.15, 0, s * 0.15); c.quadraticCurveTo(s * 0.45, -s * 0.15, s, -s * f);
  c.quadraticCurveTo(s * 0.45, s * 0.12, 0, s * 0.42); c.quadraticCurveTo(-s * 0.45, s * 0.12, -s, -s * f); c.closePath();
}
function batShape(c: CanvasRenderingContext2D, s: number, flap: number) {
  const f = Math.sin(flap) * 0.5;
  c.beginPath(); c.moveTo(0, 0);
  c.quadraticCurveTo(-s * 0.4, -s * (0.5 + f), -s, -s * f); c.lineTo(-s * 0.75, s * 0.2); c.lineTo(-s * 0.55, s * 0.05); c.lineTo(-s * 0.35, s * 0.3);
  c.quadraticCurveTo(0, s * 0.2, s * 0.35, s * 0.3); c.lineTo(s * 0.55, s * 0.05); c.lineTo(s * 0.75, s * 0.2); c.lineTo(s, -s * f);
  c.quadraticCurveTo(s * 0.4, -s * (0.5 + f), 0, 0); c.closePath();
}
function note(c: CanvasRenderingContext2D, s: number) {
  c.beginPath(); c.ellipse(0, 0, s * 0.55, s * 0.4, -0.4, 0, TAU); c.fill();
  c.fillRect(s * 0.42, -s * 1.7, s * 0.16, s * 1.7);
  c.beginPath(); c.moveTo(s * 0.58, -s * 1.7); c.quadraticCurveTo(s * 1.2, -s * 1.3, s * 0.9, -s * 0.8); c.lineWidth = s * 0.16; c.stroke();
}

// --------------------------------------------------------------- factories --
type Col = string[];
const faller = (n: number, size: [number, number], speed: [number, number], draw: (c: CanvasRenderingContext2D, p: FxP, t: number, col: Col) => void, col: Col, sway = 30): FxDef => ({
  count: n,
  spawn: (w, h, init) => P({ x: R() * w, y: init ? R() * h : -20, vy: speed[0] + R() * (speed[1] - speed[0]), size: size[0] + R() * (size[1] - size[0]), vr: (R() - 0.5) * 3, max: 14, hue: Math.floor(R() * col.length) }),
  step: (p, dt, t) => { p.y += p.vy * dt * p.depth; p.x += Math.sin(t * 1.3 + p.phase) * sway * dt * p.depth; p.rot += p.vr * dt; },
  draw: (c, p, t) => { c.globalAlpha = fade(p) * (0.45 + p.depth * 0.55); c.rotate(p.rot); draw(c, p, t, col); },
});
const riser = (n: number, size: [number, number], speed: [number, number], draw: (c: CanvasRenderingContext2D, p: FxP, t: number, col: Col) => void, col: Col, additive = false): FxDef => ({
  count: n,
  additive,
  spawn: (w, h, init) => P({ x: R() * w, y: init ? R() * h : h + 15, vy: -(speed[0] + R() * (speed[1] - speed[0])), size: size[0] + R() * (size[1] - size[0]), max: 5 + R() * 5, hue: Math.floor(R() * col.length) }),
  step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 2 + p.phase) * 14 * dt; },
  draw: (c, p, t) => { c.globalAlpha = fade(p); draw(c, p, t, col); },
});
const flyer = (n: number, size: [number, number], draw: (c: CanvasRenderingContext2D, p: FxP, t: number, col: Col) => void, col: Col, backdrop?: FxDef['backdrop']): FxDef => ({
  count: n,
  backdrop,
  spawn: (w, h, init) => {
    const dir = R() < 0.5 ? 1 : -1;
    return P({ x: init ? R() * w : dir > 0 ? -30 : w + 30, y: h * (0.08 + R() * 0.6), vx: dir * (40 + R() * 50), vy: (R() - 0.5) * 12, size: size[0] + R() * (size[1] - size[0]), max: 30, hue: Math.floor(R() * col.length) });
  },
  step: (p, dt, t) => { p.x += p.vx * dt * p.depth; p.y += (p.vy + Math.sin(t * 2 + p.phase) * 10) * dt; },
  draw: (c, p, t) => { c.globalAlpha = Math.min(1, p.life / 0.5) * (0.5 + p.depth * 0.5); if (p.vx < 0) c.scale(-1, 1); draw(c, p, t, col); },
});
const twinkler = (n: number, draw: (c: CanvasRenderingContext2D, p: FxP, t: number, col: Col) => void, col: Col, backdrop?: FxDef['backdrop'], additive = true): FxDef => ({
  count: n,
  additive,
  backdrop,
  spawn: (w, h) => P({ x: R() * w, y: R() * h, size: 2 + R() * 4, max: 2 + R() * 3, hue: Math.floor(R() * col.length) }),
  draw: (c, p, t) => { c.globalAlpha = Math.sin((p.life / p.max) * Math.PI); draw(c, p, t, col); },
});

// --------------------------------------------------------------- the bases --
type Base = (col: Col) => FxDef;
const BASES: Record<string, Base> = {
  petals: (col) => faller(26, [4, 8], [25, 55], (c, p, t, k) => { c.scale(1, Math.abs(Math.sin(t * 2 + p.phase)) * 0.7 + 0.3); petal(c, p.size); c.fillStyle = k[p.hue % 3]; c.fill(); c.globalAlpha *= 0.5; c.strokeStyle = k[3]; c.lineWidth = 0.6; c.stroke(); }, col, 40),
  snowfall: (col) => faller(60, [1, 3.4], [14, 40], (c, p, _t, k) => { c.beginPath(); c.arc(0, 0, p.size, 0, TAU); c.fillStyle = k[p.hue % 3 === 2 ? 2 : 0]; c.shadowColor = k[0]; c.shadowBlur = 6; c.fill(); }, col, 18),
  embers: (col) => riser(40, [1, 2.6], [30, 70], (c, p, t, k) => { c.beginPath(); c.arc(0, 0, p.size * (0.7 + 0.3 * Math.sin(t * 9 + p.phase)), 0, TAU); c.fillStyle = k[p.hue % 2]; c.shadowColor = k[1]; c.shadowBlur = 10; c.fill(); }, col, true),
  storm: (col) => ({
    count: 90,
    spawn: (w, h, init) => P({ x: R() * (w + 60), y: init ? R() * h : -20, vy: 380 + R() * 260, size: 8 + R() * 14, max: 3 }),
    step: (p, dt) => { p.y += p.vy * dt; p.x -= p.vy * 0.2 * dt; },
    draw: (c, p) => { c.globalAlpha = 0.25 + p.depth * 0.35; c.strokeStyle = col[0]; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 0); c.lineTo(-p.size * 0.2, p.size); c.stroke(); },
    backdrop: (c, w, h, t) => {
      const cycle = t % 5.5;
      const f = cycle < 0.08 || (cycle > 0.16 && cycle < 0.22) ? 1 : 0;
      if (f) { c.fillStyle = `${col[2]}55`; c.fillRect(0, 0, w, h); c.strokeStyle = col[2]; c.lineWidth = 2; c.shadowColor = col[1]; c.shadowBlur = 14; c.beginPath(); let x = w * (0.3 + ((Math.floor(t / 5.5) * 0.37) % 0.5)), y = 0; c.moveTo(x, y); while (y < h * 0.6) { x += (R() - 0.5) * 30; y += 14 + R() * 12; c.lineTo(x, y); } c.stroke(); c.shadowBlur = 0; }
    },
  }),
  crows: (col) => flyer(9, [9, 16], (c, p, t, k) => { bird(c, p.size, t * 9 + p.phase); c.fillStyle = k[3]; c.fill(); }, col, (c, w, h, t) => {
    for (let i = 0; i < 3; i++) { const g = c.createRadialGradient(((t * 12 + i * 160) % (w + 200)) - 100, h * (0.3 + i * 0.25), 0, ((t * 12 + i * 160) % (w + 200)) - 100, h * (0.3 + i * 0.25), w * 0.45); g.addColorStop(0, `${col[2]}2a`); g.addColorStop(1, `${col[2]}00`); c.fillStyle = g; c.fillRect(0, 0, w, h); }
  }),
  butterflies: (col) => flyer(10, [6, 10], (c, p, t, k) => {
    const f = Math.abs(Math.sin(t * 10 + p.phase));
    c.fillStyle = k[p.hue % 3];
    for (const s of [-1, 1]) { c.save(); c.scale(s * (0.25 + f * 0.75), 1); c.beginPath(); c.ellipse(p.size * 0.55, -p.size * 0.3, p.size * 0.6, p.size * 0.45, 0.4, 0, TAU); c.ellipse(p.size * 0.4, p.size * 0.35, p.size * 0.38, p.size * 0.3, -0.3, 0, TAU); c.fill(); c.restore(); }
    c.fillStyle = k[3]; c.fillRect(-0.8, -p.size * 0.6, 1.6, p.size * 1.2);
  }, col),
  bats: (col) => flyer(14, [6, 12], (c, p, t, k) => { batShape(c, p.size, t * 14 + p.phase); c.fillStyle = k[3]; c.fill(); }, col, (c, w, h) => {
    const x = w * 0.78, y = h * 0.2, r = Math.min(w, h) * 0.18;
    const g = c.createRadialGradient(x, y, r * 0.2, x, y, r * 2.2); g.addColorStop(0, `${col[0]}66`); g.addColorStop(1, `${col[0]}00`); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.globalAlpha = 0.85; c.fillStyle = col[0]; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.globalAlpha = 1;
  }),
  wisps: (col) => ({
    count: 9, additive: true,
    spawn: (w, h) => P({ x: R() * w, y: R() * h, size: 3 + R() * 4, max: 6 + R() * 4, hue: Math.floor(R() * 3) }),
    step: (p, dt, t) => { p.x += Math.sin(t * 0.8 + p.phase) * 18 * dt; p.y += Math.cos(t * 0.6 + p.phase) * 14 * dt - 6 * dt; },
    draw: (c, p) => { const a = Math.sin((p.life / p.max) * Math.PI); const g = c.createRadialGradient(0, 0, 0, 0, 0, p.size * 5); g.addColorStop(0, col[2]); g.addColorStop(0.25, `${col[p.hue % 2]}cc`); g.addColorStop(1, `${col[p.hue % 2]}00`); c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.arc(0, 0, p.size * 5, 0, TAU); c.fill(); },
  }),
  fireflies: (col) => ({
    count: 22, additive: true,
    spawn: (w, h) => P({ x: R() * w, y: h * 0.3 + R() * h * 0.7, size: 1.4 + R() * 1.6, max: 4 + R() * 4, hue: Math.floor(R() * 2) }),
    step: (p, dt, t) => { p.x += Math.sin(t + p.phase) * 12 * dt; p.y += Math.cos(t * 1.3 + p.phase) * 10 * dt; },
    draw: (c, p, t) => { c.globalAlpha = Math.max(0, Math.sin(t * 2.4 + p.phase)) * fade(p); c.fillStyle = col[p.hue]; c.shadowColor = col[p.hue]; c.shadowBlur = 12; c.beginPath(); c.arc(0, 0, p.size, 0, TAU); c.fill(); },
  }),
  stardust: (col) => twinkler(40, (c, p, t, k) => { c.rotate(t * 0.5 + p.phase); star4(c, p.size * 1.4); c.fillStyle = k[p.hue % 3]; c.shadowColor = k[0]; c.shadowBlur = 8; c.fill(); }, col),
  meteors: (col) => ({
    count: 5, additive: true,
    spawn: (w, h, init) => P({ x: w * (0.3 + R() * 0.9), y: init ? R() * h * 0.4 : -20, vx: -(260 + R() * 160), vy: 130 + R() * 80, size: 50 + R() * 50, max: 1.6 + R(), life: init ? -R() * 3 : -R() * 2.5 }),
    step: (p, dt) => { if (p.life > 0) { p.x += p.vx * dt; p.y += p.vy * dt; } },
    draw: (c, p) => { if (p.life < 0) return; const a = Math.atan2(p.vy, p.vx); c.rotate(a); const g = c.createLinearGradient(0, 0, -p.size, 0); g.addColorStop(0, col[2]); g.addColorStop(0.3, col[0]); g.addColorStop(1, `${col[1]}00`); c.globalAlpha = fade(p); c.strokeStyle = g; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(-p.size, 0); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 1.8, 0, TAU); c.fill(); },
    backdrop: (c, w, h, t) => { for (let i = 0; i < 30; i++) { c.globalAlpha = 0.25 + 0.25 * Math.sin(t * 2 + i); c.fillStyle = '#fff'; c.fillRect(((i * 97) % 100) / 100 * w, ((i * 53) % 100) / 100 * h, 1.2, 1.2); } c.globalAlpha = 1; },
  }),
  nebula: (col) => twinkler(30, (c, p, _t, k) => { c.fillStyle = k[2]; c.beginPath(); c.arc(0, 0, p.size * 0.35, 0, TAU); c.fill(); }, col, (c, w, h, t) => {
    for (let i = 0; i < 4; i++) {
      const x = w * (0.5 + 0.35 * Math.sin(t * 0.13 + i * 1.7)), y = h * (0.45 + 0.3 * Math.cos(t * 0.11 + i * 2.3)), r = Math.max(w, h) * (0.35 + 0.08 * Math.sin(t * 0.4 + i));
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `${col[i % 2]}55`); g.addColorStop(1, `${col[i % 2]}00`); c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
  }),
  aurora_veil: (col) => ({
    count: 0,
    spawn: () => P({}),
    draw: () => {},
    backdrop: (c, w, h, t) => {
      c.globalCompositeOperation = 'lighter';
      for (let r = 0; r < 3; r++) {
        c.beginPath();
        for (let x = 0; x <= w; x += 8) { const y = h * (0.18 + r * 0.1) + Math.sin(x * 0.012 + t * (0.6 + r * 0.2) + r) * 18 + Math.sin(x * 0.03 - t) * 6; x === 0 ? c.moveTo(x, y) : c.lineTo(x, y); }
        c.lineTo(w, 0); c.lineTo(0, 0); c.closePath();
        const g = c.createLinearGradient(0, 0, 0, h * 0.5); g.addColorStop(0, `${col[r % 2]}00`); g.addColorStop(0.7, `${col[r % 2]}44`); g.addColorStop(1, `${col[r % 2]}00`);
        c.fillStyle = g; c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    },
  }),
  confetti: (col) => faller(50, [3, 6], [40, 90], (c, p, t, k) => { c.scale(1, Math.sin(t * 6 + p.phase)); c.fillStyle = k[p.hue % 3]; c.fillRect(-p.size / 2, -p.size, p.size, p.size * 2); }, [...col.slice(0, 3), '#ffd166'], 40),
  hearts: (col) => riser(16, [4, 9], [20, 45], (c, p, t, k) => { c.rotate(Math.sin(t * 2 + p.phase) * 0.3); heart(c, p.size); c.fillStyle = k[p.hue % 2]; c.shadowColor = k[0]; c.shadowBlur = 6; c.fill(); }, col),
  bubbles: (col) => riser(22, [3, 9], [18, 40], (c, p, t, k) => { c.beginPath(); c.arc(0, 0, p.size, 0, TAU); const g = c.createRadialGradient(-p.size * 0.3, -p.size * 0.3, 0, 0, 0, p.size); g.addColorStop(0, '#ffffff10'); g.addColorStop(0.8, `${k[p.hue % 2]}55`); g.addColorStop(1, `${k[2]}cc`); c.fillStyle = g; c.fill(); c.strokeStyle = '#ffffffaa'; c.lineWidth = 1; c.beginPath(); c.arc(-p.size * 0.35, -p.size * 0.35, p.size * 0.35, Math.PI, Math.PI * 1.5); c.stroke(); void t; }, col),
  cipher_rain: (col) => ({
    count: 34,
    spawn: (w, h, init) => P({ x: Math.floor(R() * (w / 12)) * 12, y: init ? R() * h : -20, vy: 60 + R() * 90, size: 10, max: 10, hue: Math.floor(R() * 1e6) }),
    step: (p, dt) => { p.y += p.vy * dt; },
    draw: (c, p, t) => {
      c.font = '700 11px ui-monospace, Consolas, monospace'; c.textAlign = 'center';
      for (let i = 0; i < 7; i++) { const G = '01ABCDEF#$%&+/=▲◆●'; const ch = G[(p.hue + i * 7 + Math.floor(t * 10)) % G.length]; c.globalAlpha = (1 - i / 7) * (i ? 0.55 : 1); c.fillStyle = i ? col[0] : col[2]; c.fillText(ch, 0, -i * 12); }
    },
  }),
  blocks: (col) => faller(14, [5, 8], [30, 60], (c, p, _t, k) => {
    const shapes = [[[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[1, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]]];
    const s = shapes[p.hue % 4]; c.fillStyle = [k[0], k[1], '#ffd166', '#2dd4bf'][p.hue % 4];
    for (const [x, y] of s) { c.fillRect(x * p.size - p.size, y * p.size - p.size / 2, p.size - 1, p.size - 1); }
  }, col, 0),
  notes: (col) => riser(14, [5, 8], [20, 40], (c, p, t, k) => { c.rotate(Math.sin(t * 2 + p.phase) * 0.4); c.fillStyle = k[p.hue % 3]; c.strokeStyle = k[p.hue % 3]; note(c, p.size); }, col),
  hands: (col) => ({
    count: 0, spawn: () => P({}), draw: () => {},
    backdrop: (c, w, h, t) => {
      c.fillStyle = `${col[0]}55`;
      c.strokeStyle = `${col[0]}aa`;
      c.lineWidth = 1.2;
      c.shadowColor = col[0];
      c.shadowBlur = 10;
      for (let i = 0; i < 5; i++) {
        const cx = w * (0.1 + i * 0.2), rise = (Math.sin(t * 0.7 + i * 1.9) * 0.5 + 0.5) * h * 0.22, base = h + 6 - rise;
        c.globalAlpha = 0.55 + 0.25 * Math.sin(t + i);
        c.beginPath(); c.moveTo(cx - 12, h + 10); c.lineTo(cx - 10, base);
        for (let f = 0; f < 4; f++) { const fx = cx - 9 + f * 6, len = 22 + (f === 1 || f === 2 ? 8 : 0) + Math.sin(t * 2 + f + i) * 3; c.lineTo(fx, base - len); c.lineTo(fx + 3, base - len - 2); c.lineTo(fx + 4, base - 4); }
        c.lineTo(cx + 14, base + 4); c.lineTo(cx + 12, h + 10); c.closePath(); c.fill(); c.stroke();
      }
      c.shadowBlur = 0;
      c.globalAlpha = 1;
      const g = c.createLinearGradient(0, h * 0.5, 0, h); g.addColorStop(0, '#00000000'); g.addColorStop(1, '#000000cc'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    },
  }),
  dark_eyes: (col) => ({
    count: 7,
    spawn: (w, h) => P({ x: 20 + R() * (w - 40), y: 20 + R() * (h - 40), size: 5 + R() * 5, max: 3 + R() * 3 }),
    draw: (c, p, t) => {
      const open = Math.min(1, Math.sin((p.life / p.max) * Math.PI) * 2.2) * (Math.sin(t * 3 + p.phase) > 0.97 ? 0.1 : 1);
      c.globalAlpha = 0.9;
      for (const dx of [-p.size * 1.3, p.size * 1.3]) {
        c.save(); c.translate(dx, 0); c.scale(1, Math.max(0.05, open)); c.beginPath(); c.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, TAU); c.fillStyle = col[0]; c.shadowColor = col[0]; c.shadowBlur = 12; c.fill(); c.shadowBlur = 0; c.fillStyle = '#000'; c.beginPath(); c.ellipse(Math.sin(t + p.phase) * p.size * 0.3, 0, p.size * 0.18, p.size * 0.45, 0, 0, TAU); c.fill(); c.restore();
      }
    },
  }),
  feathers: (col) => faller(10, [6, 10], [16, 30], (c, p, t, k) => { c.rotate(Math.sin(t * 1.5 + p.phase) * 0.8); feather(c, p.size); c.fillStyle = k[p.hue % 3 === 2 ? 2 : 0]; c.fill(); c.strokeStyle = k[3]; c.globalAlpha *= 0.5; c.lineWidth = 0.7; c.beginPath(); c.moveTo(0, p.size); c.lineTo(0, -p.size * 1.1); c.stroke(); }, col, 50),
  sunbeams: (col) => ({
    count: 30, additive: true,
    spawn: (w, h) => P({ x: R() * w, y: R() * h, size: 1 + R() * 1.6, max: 6 + R() * 6, vx: 4 + R() * 6, vy: -2 - R() * 4 }),
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; },
    draw: (c, p) => { c.globalAlpha = Math.sin((p.life / p.max) * Math.PI) * 0.8; c.fillStyle = col[2]; c.beginPath(); c.arc(0, 0, p.size, 0, TAU); c.fill(); },
    backdrop: (c, w, h, t) => { c.globalCompositeOperation = 'lighter'; for (let i = 0; i < 5; i++) { const a = -0.5 + i * 0.22 + Math.sin(t * 0.3 + i) * 0.04; c.save(); c.translate(w * 0.95, -10); c.rotate(a + Math.PI / 2); const g = c.createLinearGradient(0, 0, h * 1.4, 0); g.addColorStop(0, `${col[0]}55`); g.addColorStop(1, `${col[0]}00`); c.fillStyle = g; c.fillRect(0, -10 - i * 2, h * 1.4, 20 + i * 4); c.restore(); } c.globalCompositeOperation = 'source-over'; },
  }),
  coins: (col) => faller(16, [5, 8], [60, 110], (c, p, t, k) => { const sx = Math.cos(t * 5 + p.phase); c.scale(Math.max(0.15, Math.abs(sx)), 1); c.beginPath(); c.arc(0, 0, p.size, 0, TAU); c.fillStyle = sx > 0 ? k[0] : k[1]; c.fill(); c.strokeStyle = k[3]; c.lineWidth = 1; c.stroke(); c.fillStyle = k[2]; c.font = `900 ${p.size * 1.1}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('✦', 0, 0); }, col, 6),
  lava: (col) => ({
    count: 7,
    spawn: (w, h, init) => P({ x: w * (0.1 + R() * 0.8), y: init ? R() * h : h + 40, vy: -(8 + R() * 14), size: 18 + R() * 22, max: 30, hue: Math.floor(R() * 2) }),
    step: (p, dt, t, _w, h) => { p.y += p.vy * dt; p.x += Math.sin(t * 0.5 + p.phase) * 8 * dt; if (p.y < -40) p.y = h + 40; },
    draw: (c, p, t) => { c.globalAlpha = 0.55; const r = p.size * (1 + 0.12 * Math.sin(t * 1.2 + p.phase)); const g = c.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, col[2]); g.addColorStop(0.5, col[p.hue]); g.addColorStop(1, `${col[p.hue]}00`); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, r, r * (1.1 + 0.15 * Math.sin(t + p.phase)), 0, 0, TAU); c.fill(); },
  }),
  starry_swirl: (col) => ({
    count: 12, additive: true,
    spawn: (w, h) => P({ x: R() * w, y: R() * h * 0.7, size: 3 + R() * 5, max: 999 }),
    draw: (c, p, t) => { const s = p.size * (1 + 0.15 * Math.sin(t * 2 + p.phase)); for (let i = 3; i > 0; i--) { c.globalAlpha = 0.2 * i; c.fillStyle = i === 1 ? '#fffbe0' : col[0]; c.beginPath(); c.arc(0, 0, s * (1 + (3 - i) * 0.9), 0, TAU); c.fill(); } },
    backdrop: (c, w, h, t) => {
      c.lineCap = 'round';
      for (let i = 0; i < 22; i++) {
        const cx = (((i * 67) % 100) / 100) * w + Math.sin(t * 0.2 + i) * 8, cy = (((i * 41) % 70) / 100) * h, r = 10 + (i % 4) * 7;
        c.strokeStyle = i % 3 ? `${col[1]}aa` : `${col[0]}88`; c.lineWidth = 3;
        c.beginPath(); c.arc(cx, cy, r, t * (0.3 + (i % 3) * 0.1) + i, t * (0.3 + (i % 3) * 0.1) + i + Math.PI * 1.3); c.stroke();
      }
    },
  }),
  wave_spray: (col) => ({
    count: 40,
    spawn: (w, h, init) => P({ x: R() * w, y: h * 0.75, vx: (R() - 0.3) * 60, vy: -(50 + R() * 90), size: 1.4 + R() * 2.4, max: 1.6 + R() * 1.2, life: init ? R() * 1.5 : 0 }),
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; },
    draw: (c, p) => { c.globalAlpha = fade(p); c.fillStyle = col[2]; c.beginPath(); c.arc(0, 0, p.size, 0, TAU); c.fill(); },
    backdrop: (c, w, h, t) => {
      for (let L = 0; L < 2; L++) {
        c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) c.lineTo(x, h * (0.78 + L * 0.08) + Math.sin(x * 0.03 + t * (1.4 - L * 0.4) + L) * 8);
        c.lineTo(w, h); c.closePath(); c.fillStyle = L ? col[1] : `${col[1]}aa`; c.fill();
        c.strokeStyle = col[0]; c.lineWidth = 2; c.stroke();
      }
    },
  }),
  moon_rocket: (col) => twinkler(24, (c, p, _t, k) => { star4(c, p.size); c.fillStyle = k[2]; c.fill(); }, col, (c, w, h, t) => {
    const mx = w * 0.82, my = h * 0.22, r = Math.min(w, h) * 0.16;
    c.fillStyle = col[0]; c.beginPath(); c.arc(mx, my, r, 0, TAU); c.fill();
    c.strokeStyle = col[3]; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(mx - r * 0.35, my - r * 0.1, r * 0.12, 0, TAU); c.moveTo(mx + r * 0.2, my - r * 0.1); c.arc(mx + r * 0.35, my - r * 0.1, r * 0.12, Math.PI, TAU); c.stroke();
    c.beginPath(); c.arc(mx, my + r * 0.2, r * 0.4, 0.2, Math.PI - 0.2); c.stroke();
    const k = (t % 6) / 6; const x = w * 0.05 + (mx - w * 0.05) * k, y = h * 0.85 - (h * 0.85 - my) * Math.sin(k * Math.PI * 0.5);
    c.save(); c.translate(x, y); c.rotate(-0.6); c.fillStyle = '#c9ccd3'; c.strokeStyle = col[3]; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-10, -5); c.lineTo(8, -5); c.quadraticCurveTo(16, 0, 8, 5); c.lineTo(-10, 5); c.closePath(); c.fill(); c.stroke();
    c.globalAlpha = 0.5; c.fillStyle = col[2]; for (let i = 1; i < 6; i++) { c.beginPath(); c.arc(-10 - i * 7, Math.sin(t * 8 + i) * 2, 3 - i * 0.4, 0, TAU); c.fill(); } c.restore();
  }, false),
  silent_film: (col) => ({
    count: 0, spawn: () => P({}), draw: () => {},
    backdrop: (c, w, h, t) => {
      const f = Math.floor(t * 18);
      c.fillStyle = `${col[1]}${['30', '3a', '26'][f % 3]}`; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { c.fillStyle = (f + i) % 2 ? '#ffffff38' : '#00000055'; c.fillRect(((i * 7919 + f * 131) % 1000) / 1000 * w, ((i * 104729 + f * 71) % 1000) / 1000 * h, 1.4, 1.4); }
      if (f % 7 < 4) { c.strokeStyle = `${col[2]}99`; c.lineWidth = 1.2; const x = (((f * 37) % 100) / 100) * w; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 6, h); c.stroke(); }
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); g.addColorStop(0, '#0000'); g.addColorStop(1, `${col[3]}cc`); c.fillStyle = g; c.fillRect(0, 0, w, h);
    },
  }),
  card_shower: (col) => faller(14, [7, 10], [40, 70], (c, p, t, k) => {
    c.scale(Math.cos(t * 2.4 + p.phase), 1); c.fillStyle = '#fff'; c.strokeStyle = '#333'; c.lineWidth = 0.8;
    c.beginPath(); c.roundRect(-p.size * 0.7, -p.size, p.size * 1.4, p.size * 2, 2); c.fill(); c.stroke();
    c.fillStyle = p.hue % 2 ? k[0] : '#111'; c.font = `${p.size * 1.1}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('♥♠♦♣'[p.hue % 4], 0, 1);
  }, col, 30),
  clocks: (col) => faller(9, [8, 13], [14, 26], (c, p, t, k) => {
    c.beginPath(); c.arc(0, 0, p.size, 0, TAU); c.fillStyle = k[0]; c.fill(); c.strokeStyle = k[3]; c.lineWidth = 1.4; c.stroke();
    c.beginPath(); c.arc(0, 0, p.size * 0.78, 0, TAU); c.fillStyle = '#fffaf0'; c.fill();
    c.strokeStyle = '#222'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(t * 3 + p.phase) * p.size * 0.6, Math.sin(t * 3 + p.phase) * p.size * 0.6); c.moveTo(0, 0); c.lineTo(Math.cos(t * 0.3) * p.size * 0.4, Math.sin(t * 0.3) * p.size * 0.4); c.stroke();
  }, col, 20),
  emerald_glow: (col) => twinkler(36, (c, p, t, k) => { c.rotate(t + p.phase); star4(c, p.size * 1.3); c.fillStyle = k[p.hue % 3]; c.shadowColor = k[0]; c.shadowBlur = 10; c.fill(); }, col, (c, w, h) => {
    const g = c.createLinearGradient(0, h * 0.6, 0, h); g.addColorStop(0, `${col[0]}00`); g.addColorStop(1, `${col[0]}55`); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = `${col[1]}aa`;
    for (let i = 0; i < 9; i++) { const x = w * (0.15 + i * 0.09), bh = h * (0.12 + ((i * 37) % 5) * 0.04); c.beginPath(); c.moveTo(x - 7, h); c.lineTo(x - 7, h - bh); c.lineTo(x, h - bh - 12); c.lineTo(x + 7, h - bh); c.lineTo(x + 7, h); c.fill(); }
  }),
  lab_lightning: (col) => ({
    count: 0, spawn: () => P({}), draw: () => {},
    backdrop: (c, w, h, t) => {
      const seed = Math.floor(t * 12);
      c.globalCompositeOperation = 'lighter';
      for (let b = 0; b < 2; b++) {
        if ((seed + b * 3) % 5 > 2) continue;
        let x = w * (0.1 + b * 0.8), y = h * 0.85; const tx = w * (0.9 - b * 0.8), ty = h * 0.85;
        c.strokeStyle = col[b]; c.shadowColor = col[2]; c.shadowBlur = 16; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x, y);
        for (let i = 1; i <= 14; i++) { x = x + (tx - x) / (15 - i); y = ty - Math.sin((i / 14) * Math.PI) * h * 0.35 + (((seed * 13 + i * 7 + b) % 9) - 4) * 4; c.lineTo(x, y); }
        c.stroke();
      }
      c.shadowBlur = 0; c.globalCompositeOperation = 'source-over';
      c.fillStyle = col[3]; c.fillRect(w * 0.08, h * 0.85, 8, h * 0.15); c.fillRect(w * 0.9, h * 0.85, 8, h * 0.15);
    },
  }),
  raven_feathers: (col) => faller(12, [7, 11], [14, 26], (c, p, t, k) => { c.rotate(Math.sin(t * 1.2 + p.phase) * 0.9); feather(c, p.size); const g = c.createLinearGradient(0, -p.size, 0, p.size); g.addColorStop(0, k[0]); g.addColorStop(1, k[3]); c.fillStyle = g; c.fill(); }, col, 50),
  scream_swirl: (col) => ({
    count: 0, spawn: () => P({}), draw: () => {},
    backdrop: (c, w, h, t) => {
      for (let i = 0; i < 9; i++) {
        c.beginPath();
        for (let x = 0; x <= w; x += 8) { const y = h * (0.05 + i * 0.07) + Math.sin(x * 0.02 + t * 0.9 + i * 0.7) * 10 + Math.sin(x * 0.007 - t * 0.5) * 14; x === 0 ? c.moveTo(x, y) : c.lineTo(x, y); }
        c.strokeStyle = [col[0], col[1], col[2]][i % 3]; c.globalAlpha = 0.35; c.lineWidth = 7; c.stroke();
      }
      c.globalAlpha = 1;
    },
  }),
};


// ---------------------------------------------- owner-only "Special": Genesis --
let sigil: Path2D | null = null;
// the sigil hovers over the banner like a crest, clear of the name and bio
const genesisCenter = (w: number, h: number) => [w / 2, h * 0.2, Math.min(w, h) * 0.2] as const;
BASES.sovereign = (col) => {
  const [gold, violet, light] = col;
  return {
    count: 70,
    additive: true,
    // golden motes spiralling into the sigil (polar coords in vx = angle, vy = radius)
    spawn: (w, h) => {
      const [cx, cy] = genesisCenter(w, h);
      const x = R() * w, y = R() * h;
      return P({ x, y, vx: Math.atan2(y - cy, x - cx), vy: Math.hypot(x - cx, y - cy), size: 0.8 + R() * 1.8, max: 30, hue: R() < 0.25 ? 1 : 0 });
    },
    step: (p, dt, _t, w, h) => {
      const [cx, cy, r0] = genesisCenter(w, h);
      p.k = p.vx;
      p.vx += (0.9 + 40 / Math.max(20, p.vy)) * dt;
      p.vy -= (26 + 2200 / Math.max(30, p.vy)) * dt;
      p.x = cx + Math.cos(p.vx) * p.vy;
      p.y = cy + Math.sin(p.vx) * p.vy * 0.82;
      if (p.vy < r0 * 0.35) p.life = p.max + 1; // swallowed: respawn
    },
    draw: (c, p) => {
      const a = Math.min(1, p.life / 0.5);
      const tx = -Math.sin(p.vx) * 9, ty = Math.cos(p.vx) * 9 * 0.82; // trail along the orbit
      const g = c.createLinearGradient(0, 0, -tx, -ty);
      g.addColorStop(0, p.hue ? violet : gold);
      g.addColorStop(1, '#00000000');
      c.globalAlpha = a;
      c.strokeStyle = g;
      c.lineWidth = p.size;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(-tx, -ty); c.stroke();
      c.fillStyle = p.hue ? light : '#fff6d6';
      c.beginPath(); c.arc(0, 0, p.size * 0.8, 0, TAU); c.fill();
    },
    backdrop: (c, w, h, t) => {
      const [cx, cy, R0] = genesisCenter(w, h);
      const big = Math.hypot(w, h);
      // vortex glow
      let g = c.createRadialGradient(cx, cy, 0, cx, cy, big * 0.7);
      g.addColorStop(0, `${violet}55`); g.addColorStop(0.35, `${violet}22`); g.addColorStop(1, '#00000000');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.save();
      c.globalCompositeOperation = 'lighter';
      // god rays
      c.translate(cx, cy);
      c.rotate(t * 0.12);
      for (let i = 0; i < 14; i++) {
        c.rotate(TAU / 14);
        const rg = c.createLinearGradient(0, 0, big * 0.7, 0);
        rg.addColorStop(0, i % 2 ? `${gold}2a` : `${violet}30`); rg.addColorStop(1, '#00000000');
        c.fillStyle = rg;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(big * 0.7, -big * 0.05); c.lineTo(big * 0.7, big * 0.05); c.closePath(); c.fill();
      }
      c.rotate(-t * 0.12 * 2.6);
      // spiral arms
      for (let arm = 0; arm < 3; arm++) {
        c.beginPath();
        for (let k = 0; k < 60; k++) {
          const th = k * 0.11 + arm * (TAU / 3) - t * 0.5, rr = R0 * 0.5 + k * (big * 0.006);
          const x = Math.cos(th) * rr, y = Math.sin(th) * rr * 0.82;
          k ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.strokeStyle = arm === 1 ? `${violet}66` : `${gold}55`;
        c.lineWidth = 2;
        c.stroke();
      }
      c.restore();
      // rune ring
      c.save();
      c.translate(cx, cy);
      c.globalCompositeOperation = 'lighter';
      c.rotate(-t * 0.35);
      c.strokeStyle = `${gold}cc`; c.lineWidth = 1.6; c.setLineDash([R0 * 0.18, R0 * 0.06, 3, R0 * 0.06]);
      c.beginPath(); c.arc(0, 0, R0 * 1.12, 0, TAU); c.stroke();
      c.setLineDash([]);
      for (let i = 0; i < 12; i++) {
        c.rotate(TAU / 12);
        c.fillStyle = i % 3 ? gold : light;
        c.beginPath(); c.moveTo(R0 * 1.12, -4); c.lineTo(R0 * 1.12 + 4, 0); c.lineTo(R0 * 1.12, 4); c.lineTo(R0 * 1.12 - 4, 0); c.closePath(); c.fill();
      }
      c.rotate(t * 0.9);
      c.strokeStyle = `${violet}bb`; c.lineWidth = 1.2; c.setLineDash([2, 7]);
      c.beginPath(); c.arc(0, 0, R0 * 0.95, 0, TAU); c.stroke();
      c.setLineDash([]);
      c.restore();
      // shockwave every 3.2s
      const sw = (t % 3.2) / 3.2;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = gold; c.globalAlpha = (1 - sw) * 0.7; c.lineWidth = 3 * (1 - sw) + 0.5;
      c.beginPath(); c.ellipse(cx, cy, R0 * 0.6 + sw * big * 0.6, (R0 * 0.6 + sw * big * 0.6) * 0.82, 0, 0, TAU); c.stroke();
      if (sw < 0.06) { c.globalAlpha = (0.06 - sw) * 3; c.fillStyle = light; c.fillRect(0, 0, w, h); }
      c.restore();
      // the sigil
      sigil ??= new Path2D(LOGO_PATH);
      const pulse = 1 + 0.05 * Math.sin(t * 3) + (sw < 0.1 ? (0.1 - sw) * 1.2 : 0);
      const sz = R0 * 1.25 * pulse;
      c.save();
      c.translate(cx - sz / 2, cy - (sz * 609) / 696 / 2);
      c.scale(sz / 696, sz / 696);
      const sg = c.createLinearGradient(0, 0, 696, 609);
      sg.addColorStop(0, light); sg.addColorStop(0.45, gold); sg.addColorStop(1, '#c08a10');
      c.shadowColor = gold; c.shadowBlur = 30 + 14 * Math.sin(t * 3);
      c.globalAlpha = 0.82;
      c.fillStyle = sg;
      c.fill(sigil, 'evenodd');
      c.shadowBlur = 0;
      c.restore();
      // lightning from the sigil to the edge
      const bolt = Math.floor(t / 1.7), phase = t % 1.7;
      if (phase < 0.14) {
        const ang = ((bolt * 2.399) % TAU), len = big * 0.6;
        c.save(); c.globalCompositeOperation = 'lighter';
        c.strokeStyle = light; c.shadowColor = violet; c.shadowBlur = 14; c.lineWidth = 1.8; c.globalAlpha = 1 - phase / 0.14;
        c.beginPath();
        let x = cx + Math.cos(ang) * R0 * 0.7, y = cy + Math.sin(ang) * R0 * 0.6;
        c.moveTo(x, y);
        for (let i = 1; i <= 10; i++) {
          const rr = R0 * 0.7 + (len * i) / 10;
          x = cx + Math.cos(ang) * rr + Math.sin(bolt * 7 + i * 3.1) * 12;
          y = cy + Math.sin(ang) * rr * 0.82 + Math.cos(bolt * 5 + i * 2.3) * 12;
          c.lineTo(x, y);
        }
        c.stroke(); c.restore();
      }
    },
  };
};

export const EFFECT_BASES = Object.keys(BASES);
const cache = new Map<string, FxDef>();
/** The particle system for a shop effect id ("effect.petals.sakura"), cached. */
export function shopEffect(id: string): FxDef | undefined {
  const hit = cache.get(id);
  if (hit) return hit;
  const item = ITEMS.get(id);
  const base = item && item.kind === 'effect' ? BASES[item.base] : undefined;
  if (!item || !base) return undefined;
  const def = base([...item.palette.c]);
  cache.set(id, def);
  return def;
}
void pick;
