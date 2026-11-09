// Profile effects from the Venband Shop: palette-driven, layered canvas scenes
// for the profile card (see ProfileEffect in Cosmetics.tsx).
//
// Each scene paints its own little world: a backdrop (sky, weather, scenery),
// one main particle group, and optional extra layers (glows, sparks, debris).
// Everything is procedural Canvas 2D — no images, video or animation files.
import { ITEMS } from '../lib/shop';
import { LOGO_PATH } from './logoPath';
import {
  A, R, TAU, P, fade, hash, h, pick, mix, lighten, darken, rgba, glow,
  star, star4, heart, petal, feather, diamond, snowflake, flower,
  bird, bat, butterfly, note, eye, puff, starfield,
  type FxP, type FxDef, type FxLayer,
} from './fx/core';

export type { FxP, FxDef, FxLayer };

type Col = string[];
type Base = (col: Col) => FxDef;
const C = (col: Col, i: number) => col[((i % col.length) + col.length) % col.length];

// ------------------------------------------------------------- scene helpers --
/** Soft vertical wash. */
function wash(c: CanvasRenderingContext2D, w: number, hh: number, top: string, bottom: string) {
  const g = c.createLinearGradient(0, 0, 0, hh);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, w, hh);
}
/** Soft radial light. */
function bloom(c: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, alpha = 1) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(colour, alpha));
  g.addColorStop(0.35, rgba(colour, alpha * 0.45));
  g.addColorStop(1, rgba(colour, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}
function vignette(c: CanvasRenderingContext2D, w: number, hh: number, colour = '#000000', strength = 0.45) {
  const g = c.createRadialGradient(w / 2, hh / 2, Math.min(w, hh) * 0.28, w / 2, hh / 2, Math.max(w, hh) * 0.72);
  g.addColorStop(0, rgba(colour, 0));
  g.addColorStop(1, rgba(colour, strength));
  c.fillStyle = g;
  c.fillRect(0, 0, w, hh);
}
/** Rolling fog / mist band. */
function mist(c: CanvasRenderingContext2D, w: number, hh: number, y: number, colour: string, alpha: number, t: number, speed = 0.35, amp = 9) {
  c.beginPath();
  c.moveTo(0, hh);
  for (let x = 0; x <= w + 8; x += 7) {
    const yy = y + Math.sin(x / 34 + t * speed) * amp + Math.sin(x / 13 - t * speed * 0.7) * amp * 0.28;
    c.lineTo(x, yy);
  }
  c.lineTo(w, hh);
  c.closePath();
  const g = c.createLinearGradient(0, y - amp, 0, hh);
  g.addColorStop(0, rgba(colour, alpha));
  g.addColorStop(1, rgba(colour, 0));
  c.fillStyle = g;
  c.fill();
}
/** Layered hill / mountain silhouette. */
function ridge(c: CanvasRenderingContext2D, w: number, hh: number, baseY: number, amp: number, colour: string, seed: number, t: number) {
  c.beginPath();
  c.moveTo(0, hh);
  c.lineTo(0, baseY);
  for (let x = 0; x <= w + 6; x += 6) {
    const y = baseY
      - Math.sin(x / (28 + hash(seed) * 22) + seed) * amp
      - Math.sin(x / (9 + hash(seed + 3) * 7) + t * 0.08 + seed) * amp * 0.25;
    c.lineTo(x, y);
  }
  c.lineTo(w, hh);
  c.closePath();
  c.fillStyle = colour;
  c.fill();
}
/** Deterministic tiny specks. */
function speckle(c: CanvasRenderingContext2D, w: number, hh: number, t: number, n: number, colour: string, alpha = 0.5, size = 1.2, seed = 0) {
  c.fillStyle = colour;
  for (let i = 0; i < n; i++) {
    const x = h(seed + i * 4.1) * w;
    const y = h(seed + i * 8.3 + 1.7) * hh;
    c.globalAlpha = alpha * (0.45 + Math.abs(Math.sin(t * (0.5 + h(seed + i) * 1.4) + i)) * 0.55);
    c.beginPath();
    c.arc(x, y, size * (0.5 + h(seed + i * 2.2)), 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}
/** Sparkling four-point star with a soft halo. */
/** Crescent moon. */
function crescent(c: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) {
  c.beginPath();
  c.arc(x, y, r, Math.PI * 0.38, Math.PI * 1.62, false);
  c.arc(x + r * 0.42, y, r * 0.92, Math.PI * 1.5, Math.PI * 0.5, true);
  c.closePath();
  c.fillStyle = colour;
  c.fill();
}
/** Forked lightning between two points (deterministic per seed). */
function bolt(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, seed: number, colour: string, width = 2) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = colour;
  c.shadowColor = colour;
  c.shadowBlur = 18;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x1, y1);
  for (let i = 1; i <= 12; i++) {
    const k = i / 12;
    const nx = x1 + (x2 - x1) * k + (hash(seed + i * 3.3) - 0.5) * 18 * Math.sin(k * Math.PI);
    const ny = y1 + (y2 - y1) * k + (hash(seed + i * 5.1) - 0.5) * 14 * Math.sin(k * Math.PI);
    c.lineTo(nx, ny);
    if (i === 5 || i === 8) {
      const ba = Math.atan2(y2 - y1, x2 - x1) + (i === 5 ? 0.7 : -0.6);
      c.moveTo(nx, ny);
      c.lineTo(nx + Math.cos(ba) * 26, ny + Math.sin(ba) * 26);
      c.moveTo(nx, ny);
    }
  }
  c.stroke();
  c.restore();
}

// --------------------------------------------------------------- the bases --
const BASES: Record<string, Base> = {
  // ---- Nature -----------------------------------------------------------------
  petals: (col) => ({
    count: 42,
    spawn: (w, hh, init) => P({
      x: R() * w * 1.3 - w * 0.15, y: init ? R() * hh : -18,
      vx: -14 - R() * 30, vy: 20 + R() * 34,
      size: 3.5 + R() * 5.5, max: 9 + R() * 5,
      vr: (R() - 0.5) * 4, hue: Math.floor(R() * col.length),
      k: R() < 0.2 ? 1 : 0, depth: 0.25 + R() * 0.75,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 1.4 + p.phase) * 30) * dt * p.depth;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const a = fade(p) * (0.5 + p.depth * 0.5);
      c.globalAlpha = a;
      c.rotate(p.rot);
      c.scale(0.2 + Math.abs(Math.cos(t * (1.6 + p.depth) + p.phase)) * 0.8, 1);
      const main = C(col, p.hue);
      if (p.k === 1) {
        c.fillStyle = main;
        c.shadowColor = main;
        c.shadowBlur = 7;
        flower(c, p.size * 0.9, 5, t + p.phase);
        c.fill();
        c.fillStyle = lighten(main, 0.55);
        c.beginPath();
        c.arc(0, 0, p.size * 0.22, 0, TAU);
        c.fill();
      } else {
        const g = c.createLinearGradient(-p.size, -p.size, p.size, p.size);
        g.addColorStop(0, lighten(main, 0.55));
        g.addColorStop(0.55, main);
        g.addColorStop(1, darken(main, 0.2));
        c.fillStyle = g;
        c.shadowColor = main;
        c.shadowBlur = 6;
        petal(c, p.size);
        c.fill();
        c.globalAlpha *= 0.5;
        c.strokeStyle = '#fff';
        c.lineWidth = 0.55;
        c.beginPath();
        c.moveTo(0, -p.size * 0.75);
        c.quadraticCurveTo(p.size * 0.18, 0, 0, p.size * 0.85);
        c.stroke();
      }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.2), A(col[3], 0.02));
      bloom(c, w * (0.2 + Math.sin(t * 0.12) * 0.08), hh * 0.18, w * 0.7, col[0], 0.13);
      c.save();
      c.strokeStyle = A(lighten(col[0], 0.3), 0.22);
      c.lineWidth = 1.1;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        for (let x = -20; x <= w + 20; x += 10) {
          const y = hh * (0.1 + i * 0.17) + Math.sin(x / 55 + t * (0.35 + i * 0.07) + i) * 18;
          x === -20 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
      }
      c.restore();
      speckle(c, w, hh, t, 26, lighten(col[0], 0.5), 0.4, 1.1, 11);
      vignette(c, w, hh, col[3], 0.3);
    },
    layers: [
      {
        count: 5,
        spawn: (w, hh, init) => P({ x: R() * w, y: init ? R() * hh : hh + 20, vy: -(7 + R() * 9), size: 10 + R() * 9, max: 999, rot: R() * TAU, vr: (R() - 0.5) * 0.2 }),
        step: (p, dt) => { p.y += p.vy * dt; p.rot += p.vr * dt; },
        draw: (c, p) => {
          c.rotate(p.rot);
          flower(c, p.size, 6, p.phase);
          c.fillStyle = A(lighten(col[0], 0.35), 0.26);
          c.fill();
        },
      },
      {
        count: 34, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.8 + R() * 1.7, max: 4 + R() * 5 }),
        step: (p, dt, t) => {
          p.y -= 5 * dt;
          p.x += Math.sin(t * 0.9 + p.phase) * 6 * dt;
        },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2 + p.phase)) * fade(p) * 0.9;
          c.fillStyle = lighten(col[0], 0.7);
          c.shadowColor = col[0];
          c.shadowBlur = 6;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  snowfall: (col) => ({
    count: 46,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh : -12,
      vy: 12 + R() * 24, vx: (R() - 0.5) * 8,
      size: 1 + R() * 3.2, max: 14 + R() * 8,
      depth: 0.2 + R() * 0.8, k: R() < 0.34 ? 1 : 0,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 0.7 + p.phase) * 8) * dt * p.depth;
      p.rot += p.vr * dt * 0.4;
    },
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * (0.35 + p.depth * 0.65);
      c.fillStyle = '#ffffff';
      c.shadowColor = col[1];
      c.shadowBlur = 4 + p.size * 2;
      c.rotate(p.rot + t * 0.15);
      if (p.k === 1) {
        snowflake(c, p.size * p.depth * 2.6);
        c.strokeStyle = '#f4fbff';
        c.lineWidth = 0.7;
        c.stroke();
      } else {
        c.beginPath();
        c.arc(0, 0, p.size * p.depth, 0, TAU);
        c.fill();
      }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.28), A(col[1], 0.08));
      bloom(c, w * 0.74, hh * 0.16, w * 0.5, col[0], 0.22);
      c.globalAlpha = 0.9;
      crescent(c, w * 0.76, hh * 0.15, Math.min(w, hh) * 0.09, A(col[2], 0.85));
      c.globalAlpha = 1;
      ridge(c, w, hh, hh * 0.78, 15, A(mix(col[1], col[3], 0.7), 0.5), 2.1, t);
      ridge(c, w, hh, hh * 0.87, 10, A(mix(col[1], col[3], 0.85), 0.7), 5.7, t);
      mist(c, w, hh, hh * 0.8, col[0], 0.16, t, 0.2, 12);
      starfield(c, w, hh * 0.6, t, 24, col[0], 0.4);
      vignette(c, w, hh, col[3], 0.4);
    },
    layers: [
      {
        count: 18, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 2 + R() * 6, max: 3 + R() * 4, depth: 0.2 + R() * 0.5 }),
        draw: (c, p) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.16;
          c.fillStyle = lighten(col[0], 0.7);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
      {
        count: 26,
        spawn: (w, hh, init) => P({ x: R() * w, y: init ? R() * hh : -8, vy: 28 + R() * 40, vx: (R() - 0.5) * 12, size: 0.5 + R() * 1, max: 9 + R() * 5 }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += (p.vx + Math.sin(t + p.phase) * 7) * dt; },
        draw: (c, p) => {
          c.globalAlpha = fade(p) * 0.75;
          c.fillStyle = '#fff';
          c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        },
      },
    ],
  }),

  embers: (col) => ({
    count: 48, additive: true,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? hh * (0.3 + R() * 0.7) : hh + 10,
      vx: (R() - 0.5) * 18, vy: -(18 + R() * 46),
      size: 0.7 + R() * 2.4, max: 2.5 + R() * 4.5,
      hue: Math.floor(R() * col.length), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 2.6 + p.phase) * 18) * dt;
    },
    draw: (c, p, t) => {
      const flick = 0.45 + Math.pow(Math.max(0, Math.sin(t * 13 + p.phase * 4)), 1.4) * 0.55;
      const cc = C(col, p.hue);
      c.globalAlpha = fade(p) * flick;
      glow(c, p.size * 4.4, cc, 0.35);
      c.fillStyle = lighten(cc, 0.35 + flick * 0.35);
      c.shadowColor = cc;
      c.shadowBlur = 9;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.12), A(col[1], 0.2));
      const g = c.createLinearGradient(0, hh, 0, hh * 0.36);
      g.addColorStop(0, rgba(col[1], 0.38 + Math.sin(t * 1.6) * 0.06));
      g.addColorStop(0.5, rgba(col[0], 0.11));
      g.addColorStop(1, rgba(col[0], 0));
      c.fillStyle = g;
      c.fillRect(0, hh * 0.36, w, hh * 0.64);
      bloom(c, w * 0.5, hh * 1.02, w * 0.7, col[1], 0.35);
      for (let i = 0; i < 4; i++) {
        const x = w * (0.12 + i * 0.25) + Math.sin(t * 0.4 + i) * 12;
        const y = hh * (0.86 + Math.sin(t * 0.7 + i * 2) * 0.03);
        c.globalAlpha = 0.16;
        c.fillStyle = col[3];
        c.beginPath();
        c.ellipse(x, y, 26 + i * 5, 10 + i * 2, 0.2, 0, TAU);
        c.ellipse(x + 14, y - 12, 20, 8, -0.3, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
      speckle(c, w, hh, t, 42, col[0], 0.45, 1.1, 23);
      vignette(c, w, hh, col[3], 0.38);
    },
    layers: [
      {
        count: 10,
        spawn: (w, hh) => P({ x: R() * w, y: hh + 12, size: 6 + R() * 8, max: 5 + R() * 3, vy: -(12 + R() * 16) }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 1.2 + p.phase) * 6 * dt; },
        draw: (c, p, t) => {
          const a = Math.sin((p.life / p.max) * Math.PI) * 0.2;
          c.globalAlpha = a;
          c.fillStyle = col[1];
          c.beginPath();
          c.ellipse(0, 0, p.size * 2.2, p.size, Math.sin(t + p.phase) * 0.4, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  storm: (col) => ({
    count: 110,
    spawn: (w, hh, init) => P({
      x: R() * (w + 80) - 30, y: init ? R() * hh : -24,
      vx: -70 - R() * 90, vy: 340 + R() * 240,
      size: 7 + R() * 13, max: 2.2,
    }),
    step: (p, dt) => { p.y += p.vy * dt; p.x += p.vx * dt; },
    draw: (c, p) => {
      c.globalAlpha = 0.18 + p.depth * 0.32;
      c.strokeStyle = col[0];
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(p.vx * 0.035, p.size);
      c.stroke();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.55), A(mix(col[3], col[2], 0.2), 0.35));
      for (let i = 0; i < 6; i++) {
        const x = ((i * 97 + t * 9) % (w + 180)) - 90;
        const y = hh * (0.08 + (i % 3) * 0.07);
        c.globalAlpha = 0.35;
        c.save();
        c.translate(x, y);
        puff(c, 46 + (i % 3) * 18, i * 7.3, A(mix(col[2], col[3], 0.45), 0.8));
        puff(c, 34 + (i % 2) * 12, i * 11.1, A(col[3], 0.7));
        c.restore();
      }
      c.globalAlpha = 1;
      const cycle = t % 5.2;
      const flash = cycle < 0.07 || (cycle > 0.15 && cycle < 0.2);
      if (cycle < 0.7) {
        const seed = Math.floor(t / 5.2);
        const x = w * (0.15 + hash(seed) * 0.7);
        bolt(c, x, 0, x + (hash(seed + 2) - 0.5) * w * 0.5, hh * (0.55 + hash(seed + 3) * 0.2), seed, col[2], 2.2);
      }
      if (flash) {
        c.fillStyle = rgba(col[2], 0.2);
        c.fillRect(0, 0, w, hh);
      }
      ridge(c, w, hh, hh * 0.91, 9, A(darken(col[3], 0.2), 0.75), 8.2, t);
      mist(c, w, hh, hh * 0.74, col[2], 0.1, t, 0.5, 16);
      speckle(c, w, hh, t, 52, col[0], 0.28, 1.1, 37);
      vignette(c, w, hh, col[3], 0.55);
    },
    layers: [
      {
        count: 36, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: hh * (0.2 + R() * 0.8), size: 2 + R() * 4, max: 0.5 + R() * 0.6, vy: 120 + R() * 200 }),
        step: (p, dt) => { p.y += p.vy * dt; },
        draw: (c, p) => {
          c.globalAlpha = 0.4;
          c.strokeStyle = lighten(col[2], 0.4);
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(-4, 16 + p.size * 4);
          c.stroke();
        },
      },
    ],
  }),
  // ---- Gothic & spooky --------------------------------------------------------
  crows: (col) => ({
    count: 10,
    spawn: (w, hh, init) => {
      const dir = R() < 0.5 ? 1 : -1;
      return P({
        x: init ? R() * w : dir > 0 ? -40 : w + 40,
        y: hh * (0.1 + R() * 0.55), vx: dir * (46 + R() * 62), vy: (R() - 0.5) * 14,
        size: 7 + R() * 11, max: 999, k: R() < 0.3 ? 1 : 0,
      });
    },
    step: (p, dt, t) => {
      p.x += p.vx * dt;
      p.y += (p.vy + Math.sin(t * 1.6 + p.phase) * 16) * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = 0.82;
      if (p.vx < 0) c.scale(-1, 1);
      c.fillStyle = darken(col[3], 0.25);
      bird(c, p.size, t * (7 + p.depth * 4) + p.phase);
      c.fill();
      c.globalAlpha *= 0.5;
      c.fillStyle = col[2];
      c.beginPath();
      c.arc(p.size * 0.18, -p.size * 0.1, p.size * 0.13, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[1], col[3], 0.35), 0.5), A(col[3], 0.2));
      bloom(c, w * 0.22, hh * 0.2, w * 0.55, col[2], 0.16);
      c.globalAlpha = 0.5;
      crescent(c, w * 0.22, hh * 0.19, Math.min(w, hh) * 0.11, A(col[2], 0.8));
      c.globalAlpha = 1;
      for (let i = 0; i < 5; i++) {
        const x = ((i * 53 + t * 7) % (w + 140)) - 70;
        bloom(c, x, hh * (0.25 + (i % 3) * 0.18), w * 0.3, col[3], 0.1);
      }
      mist(c, w, hh, hh * 0.55, col[2], 0.08, t, 0.25, 14);
      // bare branches reaching in from the edges
      c.save();
      c.strokeStyle = A(darken(col[3], 0.35), 0.85);
      c.lineCap = 'round';
      for (const side of [0, 1]) {
        c.save();
        if (side) { c.translate(w, 0); c.scale(-1, 1); }
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(-4, hh * 0.92);
        c.quadraticCurveTo(w * 0.1, hh * 0.62, w * 0.19, hh * 0.3);
        c.stroke();
        c.lineWidth = 2.4;
        for (let i = 1; i <= 4; i++) {
          c.beginPath();
          c.moveTo(w * (0.04 + i * 0.03), hh * (0.78 - i * 0.09));
          c.quadraticCurveTo(w * (0.1 + i * 0.02), hh * (0.62 - i * 0.05), w * (0.18 + i * 0.015), hh * (0.5 - i * 0.06));
          c.stroke();
        }
        c.restore();
      }
      c.restore();
      speckle(c, w, hh, t, 34, col[2], 0.3, 1, 7);
      vignette(c, w, hh, col[3], 0.48);
    },
    layers: [
      {
        count: 16,
        spawn: (w, hh) => P({ x: R() * w, y: hh * (0.08 + R() * 0.45), size: 1.5 + R() * 2.5, max: 2 + R() * 3, vx: (R() - 0.5) * 20 }),
        step: (p, dt, t) => { p.x += (p.vx + Math.sin(t + p.phase) * 8) * dt; },
        draw: (c, p) => {
          c.globalAlpha = 0.35;
          c.strokeStyle = darken(col[3], 0.2);
          c.lineWidth = 0.9;
          c.beginPath();
          c.moveTo(-p.size, 0);
          c.quadraticCurveTo(0, -p.size * 0.6, p.size, 0);
          c.stroke();
        },
      },
    ],
  }),

  butterflies: (col) => ({
    count: 14,
    spawn: (w, hh, init) => P({
      x: init ? R() * w : -20, y: hh * (0.15 + R() * 0.65),
      vx: 20 + R() * 26, vy: (R() - 0.5) * 18,
      size: 5 + R() * 8, max: 999, hue: Math.floor(R() * col.length),
      k: R() < 0.4 ? 1 : 0,
    }),
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t * 1.2 + p.phase) * 22) * dt;
      p.y += (p.vy + Math.cos(t * 1.7 + p.phase) * 24) * dt;
      if (p.x > 40 + 0 && p.vx < 0) p.vx *= -1;
    },
    draw: (c, p, t) => {
      c.globalAlpha = 0.9;
      if (p.vx < 0) c.scale(-1, 1);
      butterfly(c, p.size, t * (8 + p.depth * 3) + p.phase, C(col, p.hue), lighten(C(col, p.hue), 0.5));
      c.globalAlpha *= 0.5;
      c.strokeStyle = '#ffffff88';
      c.lineWidth = 0.6;
      c.beginPath();
      c.moveTo(-p.size * 0.2, -p.size * 0.3);
      c.quadraticCurveTo(-p.size * 0.5, -p.size * 0.8, -p.size * 0.7, -p.size * 0.9);
      c.stroke();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.32), A(mix(col[3], col[1], 0.28), 0.14));
      bloom(c, w * 0.72, hh * 0.18, w * 0.6, col[0], 0.2);
      // sun shafts
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.translate(w * 0.95, -10);
      for (let i = 0; i < 6; i++) {
        c.save();
        c.rotate(2.25 + i * 0.16 + Math.sin(t * 0.3 + i) * 0.03);
        const g = c.createLinearGradient(0, 0, hh * 0.9, 0);
        g.addColorStop(0, rgba(col[2], 0.18));
        g.addColorStop(1, rgba(col[2], 0));
        c.fillStyle = g;
        c.fillRect(0, -6 - i * 3, hh * 0.9, 12 + i * 6);
        c.restore();
      }
      c.restore();
      // meadow
      wash(c, w, hh * 0.22, A(mix(col[3], col[1], 0.35), 0), A(mix(col[3], col[1], 0.25), 0.6));
      for (let i = 0; i < 26; i++) {
        const x = h(i * 2.7) * w;
        const bh = hh * (0.08 + h(i * 5.1) * 0.18);
        const sway = Math.sin(t * 0.7 + i) * 4;
        c.strokeStyle = A(mix(col[1], col[3], 0.4), 0.55);
        c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(x, hh);
        c.quadraticCurveTo(x + sway, hh - bh * 0.5, x + sway * 1.6, hh - bh);
        c.stroke();
        if (i % 4 === 0) {
          c.fillStyle = A(C(col, i), 0.5);
          c.beginPath();
          c.arc(x + sway * 1.6, hh - bh, 2 + h(i) * 2.5, 0, TAU);
          c.fill();
        }
      }
      speckle(c, w, hh, t, 30, col[2], 0.4, 1.1, 71);
      vignette(c, w, hh, col[3], 0.35);
    },
    layers: [
      {
        count: 28, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.6 + R() * 1.4, max: 3 + R() * 4 }),
        step: (p, dt, t) => { p.y -= 6 * dt; p.x += Math.sin(t + p.phase) * 8 * dt; },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.4 + p.phase)) * 0.8;
          c.fillStyle = lighten(col[0], 0.5);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  bats: (col) => ({
    count: 20,
    spawn: (w, hh, init) => {
      const dir = R() < 0.5 ? 1 : -1;
      return P({
        x: init ? R() * w : dir > 0 ? -30 : w + 30, y: hh * (0.12 + R() * 0.72),
        vx: dir * (55 + R() * 70), vy: (R() - 0.5) * 30,
        size: 4 + R() * 8, max: 999, depth: 0.3 + R() * 0.7,
      });
    },
    step: (p, dt, t) => {
      p.x += p.vx * dt * p.depth;
      p.y += (p.vy + Math.sin(t * 2.2 + p.phase) * 26) * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = 0.55 + p.depth * 0.4;
      if (p.vx > 0) c.scale(-1, 1);
      c.fillStyle = darken(col[3], 0.35);
      bat(c, p.size, t * (10 + p.depth * 6) + p.phase);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.55), A(mix(col[3], col[0], 0.18), 0.28));
      const mx = w * 0.76, my = hh * 0.2, mr = Math.min(w, hh) * 0.22;
      bloom(c, mx, my, mr * 3.2, col[0], 0.24);
      c.fillStyle = col[0];
      c.beginPath();
      c.arc(mx, my, mr, 0, TAU);
      c.fill();
      c.fillStyle = rgba(lighten(col[0], 0.4), 0.45);
      for (const [ox, oy, rr] of [[-0.32, -0.1, 0.12], [0.2, -0.2, 0.08], [0.3, 0.24, 0.16], [-0.1, 0.36, 0.09]]) {
        c.beginPath();
        c.arc(mx + mr * ox, my + mr * oy, mr * rr, 0, TAU);
        c.fill();
      }
      // distant castle
      c.fillStyle = A(darken(col[3], 0.4), 0.9);
      c.beginPath();
      c.moveTo(0, hh);
      c.lineTo(0, hh * 0.82);
      for (let i = 0; i < 7; i++) {
        const x = w * (0.03 + i * 0.035);
        const top = hh * (0.74 + (i % 3) * 0.035);
        c.lineTo(x, top);
        c.lineTo(x + w * 0.012, top - hh * 0.025);
        c.lineTo(x + w * 0.024, top);
      }
      c.lineTo(w * 0.28, hh * 0.82);
      c.lineTo(w * 0.28, hh);
      c.closePath();
      c.fill();
      for (let i = 0; i < 4; i++) {
        const x = ((i * 61 + t * 5) % (w + 120)) - 60;
        bloom(c, x, hh * (0.3 + (i % 2) * 0.22), w * 0.28, col[3], 0.12);
      }
      mist(c, w, hh, hh * 0.62, col[1], 0.07, t, 0.3, 12);
      speckle(c, w, hh, t, 30, col[2], 0.28, 1, 17);
      vignette(c, w, hh, col[3], 0.6);
    },
  }),

  wisps: (col) => ({
    count: 11, additive: true,
    spawn: (w, hh) => P({
      x: R() * w, y: hh * (0.15 + R() * 0.75),
      size: 2.5 + R() * 4.5, max: 6 + R() * 5, hue: Math.floor(R() * 3),
      vx: (R() - 0.5) * 12, vy: -(3 + R() * 7),
    }),
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t * 0.8 + p.phase) * 20) * dt;
      p.y += (p.vy + Math.cos(t * 0.6 + p.phase) * 15) * dt;
      p.rot = Math.sin(t * 0.9 + p.phase) * 0.8;
    },
    draw: (c, p, t) => {
      const a = Math.min(1, Math.sin((p.life / p.max) * Math.PI) * 2.2) * (0.55 + 0.45 * Math.sin(t * 1.3 + p.phase));
      const cc = C(col, p.hue);
      c.globalAlpha = a;
      glow(c, p.size * 6, cc, 0.55);
      // wispy tail
      c.strokeStyle = rgba(cc, 0.55);
      c.lineCap = 'round';
      c.lineWidth = p.size * 0.7;
      c.beginPath();
      c.moveTo(0, p.size * 0.5);
      c.bezierCurveTo(p.size * 1.2, p.size * 1.3, -p.size * 1.4, p.size * 2.2, Math.sin(t + p.phase) * p.size, p.size * 3);
      c.stroke();
      c.fillStyle = lighten(cc, 0.55);
      c.shadowColor = cc;
      c.shadowBlur = 14;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.48), A(mix(col[3], col[0], 0.15), 0.16));
      // dark treeline
      c.fillStyle = A(darken(col[3], 0.45), 0.9);
      for (let i = 0; i < 9; i++) {
        const x = (i / 8) * w + Math.sin(i * 7.1) * 12;
        const bh = hh * (0.14 + h(i * 2.3) * 0.18);
        c.beginPath();
        c.moveTo(x - 9, hh);
        c.lineTo(x - 5, hh - bh);
        c.lineTo(x, hh - bh - 18);
        c.lineTo(x + 5, hh - bh);
        c.lineTo(x + 9, hh);
        c.closePath();
        c.fill();
      }
      mist(c, w, hh, hh * 0.7, col[1], 0.09, t, 0.3, 18);
      bloom(c, w * 0.3, hh * 0.5, w * 0.4, col[2], 0.08);
      speckle(c, w, hh, t, 24, col[1], 0.28, 1.1, 41);
      vignette(c, w, hh, col[3], 0.55);
    },
    layers: [
      {
        count: 34, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: hh * (0.2 + R() * 0.8), size: 0.6 + R() * 1.4, max: 3 + R() * 4 }),
        step: (p, dt, t) => { p.y -= 9 * dt; p.x += Math.sin(t * 1.4 + p.phase) * 12 * dt; },
        draw: (c, p) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.55;
          c.fillStyle = C(col, p.hue % 3);
          c.shadowColor = C(col, p.hue % 3);
          c.shadowBlur = 7;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  fireflies: (col) => ({
    count: 26, additive: true,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? hh * (0.25 + R() * 0.7) : hh * (0.5 + R() * 0.5),
      vx: (R() - 0.5) * 16, vy: (R() - 0.5) * 12,
      size: 1.2 + R() * 1.8, max: 5 + R() * 6, hue: Math.floor(R() * 2),
    }),
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t * 0.8 + p.phase) * 16) * dt;
      p.y += (p.vy + Math.cos(t * 0.7 + p.phase) * 12) * dt;
    },
    draw: (c, p, t) => {
      const blink = Math.pow(Math.max(0, Math.sin(t * (1.4 + p.depth) + p.phase * 2.4)), 2);
      const cc = p.hue ? col[1] : col[2];
      c.globalAlpha = fade(p) * (0.08 + blink * 0.92);
      glow(c, p.size * 7, cc, 0.55);
      c.fillStyle = lighten(cc, 0.65);
      c.shadowColor = cc;
      c.shadowBlur = 10;
      c.beginPath();
      c.arc(0, 0, p.size * 0.75, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.5), A(mix(col[3], col[1], 0.3), 0.2));
      starfield(c, w, hh * 0.75, t, 58, col[2], 0.7);
      c.globalAlpha = 0.75;
      crescent(c, w * 0.18, hh * 0.14, Math.min(w, hh) * 0.08, A(col[2], 0.9));
      c.globalAlpha = 1;
      // grass and wildflowers
      wash(c, w, hh * 0.3, A(mix(col[1], col[3], 0.6), 0), A(mix(col[1], col[3], 0.7), 0.65));
      for (let i = 0; i < 34; i++) {
        const x = h(i * 3.3) * w;
        const bh = hh * (0.05 + h(i * 6.1) * 0.2);
        const sway = Math.sin(t * 0.9 + i * 0.7) * 5;
        c.strokeStyle = A(mix(col[1], col[3], 0.5), 0.6);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, hh);
        c.quadraticCurveTo(x + sway * 0.4, hh - bh * 0.6, x + sway, hh - bh);
        c.stroke();
      }
      mist(c, w, hh, hh * 0.78, col[2], 0.08, t, 0.4, 8);
      vignette(c, w, hh, col[3], 0.5);
    },
    layers: [
      {
        count: 44, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: hh * (0.3 + R() * 0.7), size: 0.5 + R() * 1.2, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.6 + p.phase * 3)) * 0.6;
          c.fillStyle = lighten(col[1], 0.6);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  // ---- Celestial ---------------------------------------------------------------
  stardust: (col) => ({
    count: 42, additive: true,
    spawn: (w, hh) => P({
      x: R() * w, y: R() * hh,
      size: 1.2 + R() * 4.2, max: 2 + R() * 4,
      hue: Math.floor(R() * col.length), depth: 0.3 + R() * 0.7,
      k: R() < 0.3 ? 1 : 0,
    }),
    step: (p, dt, t) => {
      p.y -= (3 + p.depth * 6) * dt;
      p.x += Math.sin(t * 0.7 + p.phase) * 4 * dt;
      p.rot += dt * (0.2 + p.depth * 0.5);
    },
    draw: (c, p, t) => {
      const pulse = Math.pow(Math.max(0, Math.sin((p.life / p.max) * Math.PI)), 0.7);
      const shimmer = 0.7 + Math.sin(t * 4 + p.phase) * 0.3;
      const cc = C(col, p.hue);
      c.globalAlpha = pulse * shimmer;
      c.rotate(p.rot + Math.sin(t + p.phase) * 0.25);
      c.fillStyle = lighten(cc, 0.35);
      c.shadowColor = cc;
      c.shadowBlur = 10 + p.size * 2;
      if (p.k === 1) star(c, p.size * (0.5 + pulse * 0.7), 5);
      else star4(c, p.size * (0.5 + pulse * 0.8));
      c.fill();
      c.globalAlpha *= 0.3;
      c.beginPath();
      c.arc(0, 0, p.size * 2, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.4), A(mix(col[3], col[2], 0.16), 0.12));
      bloom(c, w * 0.3, hh * 0.25, w * 0.65, col[0], 0.16);
      bloom(c, w * 0.8, hh * 0.6, w * 0.5, col[1], 0.12);
      starfield(c, w, hh, t, 72, col[2], 0.8);
      // constellation lines between deterministic stars
      c.save();
      c.strokeStyle = rgba(col[2], 0.28);
      c.lineWidth = 0.8;
      c.beginPath();
      let px = h(2.5) * w, py = h(8.1) * hh * 0.7;
      for (let i = 0; i < 12; i++) {
        const nx = h(i * 7.3 + 2) * w;
        const ny = h(i * 11.7 + 4) * hh * 0.8;
        c.moveTo(px, py);
        c.lineTo(nx, ny);
        px = nx;
        py = ny;
      }
      c.stroke();
      for (let i = 0; i < 12; i++) {
        const x = h(i * 7.3 + 2) * w, y = h(i * 11.7 + 4) * hh * 0.8;
        c.fillStyle = lighten(col[2], 0.5);
        c.beginPath();
        c.arc(x, y, 1.5, 0, TAU);
        c.fill();
      }
      c.restore();
      vignette(c, w, hh, col[3], 0.4);
    },
    layers: [
      {
        count: 60, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.6 + R() * 1.4, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2 + p.phase * 2)) * 0.45;
          c.fillStyle = lighten(col[1], 0.5);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  meteors: (col) => ({
    count: 7, additive: true,
    spawn: (w, hh, init) => {
      const angle = Math.PI * (0.18 + R() * 0.16);
      const speed = 260 + R() * 280;
      return P({
        x: init ? R() * w : w * (0.35 + R() * 0.9), y: init ? R() * hh * 0.55 : -40,
        vx: -Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: 30 + R() * 90, max: 1.1 + R() * 0.9, rot: angle,
      });
    },
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; },
    draw: (c, p) => {
      const a = fade(p);
      const len = p.size;
      const g = c.createLinearGradient(0, 0, -p.vx / Math.hypot(p.vx, p.vy) * len, -p.vy / Math.hypot(p.vx, p.vy) * len);
      g.addColorStop(0, lighten(col[2], 0.6));
      g.addColorStop(0.25, col[0]);
      g.addColorStop(1, rgba(col[1], 0));
      c.globalAlpha = a;
      c.strokeStyle = g;
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-p.vx / Math.hypot(p.vx, p.vy) * len, -p.vy / Math.hypot(p.vx, p.vy) * len);
      c.stroke();
      glow(c, 8, col[2], 0.8);
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(0, 0, 1.8, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.62), A(mix(col[3], col[1], 0.28), 0.2));
      // milky way band
      c.save();
      c.translate(w * 0.5, hh * 0.42);
      c.rotate(-0.5);
      const g = c.createLinearGradient(0, -hh * 0.16, 0, hh * 0.16);
      g.addColorStop(0, rgba(col[0], 0));
      g.addColorStop(0.5, rgba(col[1], 0.2));
      g.addColorStop(1, rgba(col[0], 0));
      c.fillStyle = g;
      c.fillRect(-w, -hh * 0.16, w * 2, hh * 0.32);
      c.restore();
      starfield(c, w, hh, t, 88, col[2], 0.9);
      bloom(c, w * 0.5, hh * 0.92, w * 0.6, col[1], 0.16);
      ridge(c, w, hh, hh * 0.92, 12, A(darken(col[3], 0.3), 0.8), 3.3, t);
      vignette(c, w, hh, col[3], 0.45);
    },
    layers: [
      {
        count: 46, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.5 + R() * 1.4, max: 2 + R() * 4 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.8 + p.phase * 2)) * 0.65;
          c.fillStyle = '#ffffff';
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  nebula: (col) => ({
    count: 34, additive: true,
    spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.8 + R() * 2.4, max: 2 + R() * 4, hue: Math.floor(R() * 2) }),
    draw: (c, p, t) => {
      const a = Math.max(0, Math.sin((p.life / p.max) * Math.PI));
      c.globalAlpha = a * 0.85;
      c.fillStyle = lighten(C(col, p.hue), 0.55);
      c.shadowColor = C(col, p.hue);
      c.shadowBlur = 9;
      star4(c, p.size * (0.6 + a * 0.5));
      c.fill();
      c.globalAlpha *= 0.4;
      c.beginPath();
      c.arc(0, 0, p.size * 2.2, 0, TAU);
      c.fill();
      void t;
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.55), A(mix(col[3], col[2], 0.2), 0.14));
      for (let i = 0; i < 7; i++) {
        const x = w * (0.5 + 0.36 * Math.sin(t * (0.09 + i * 0.012) + i * 1.7));
        const y = hh * (0.46 + 0.3 * Math.cos(t * (0.08 + i * 0.01) + i * 2.3));
        bloom(c, x, y, Math.max(w, hh) * (0.3 + 0.06 * Math.sin(t * 0.3 + i)), C(col, i), 0.16);
      }
      // dust ribbons
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let r = 0; r < 4; r++) {
        c.beginPath();
        for (let x = -20; x <= w + 20; x += 8) {
          const y = hh * (0.28 + r * 0.13) + Math.sin(x / (48 + r * 16) + t * 0.18 + r) * 14 + Math.sin(x / 19 - t * 0.3) * 4;
          x === -20 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.strokeStyle = rgba(C(col, r), 0.16);
        c.lineWidth = 9 - r;
        c.stroke();
      }
      c.restore();
      starfield(c, w, hh, t, 100, col[0], 0.9);
      vignette(c, w, hh, col[3], 0.5);
    },
    layers: [
      {
        count: 54, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.4 + R() * 1.1, max: 2 + R() * 4 }),
        step: (p, dt, t) => {
          p.x += Math.sin(t * 0.2 + p.phase) * 2 * dt;
          p.y -= 1.5 * dt;
        },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.4 + p.phase * 2)) * 0.55;
          c.fillStyle = lighten(col[2], 0.6);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
      {
        count: 2, additive: true,
        spawn: (w, hh, init) => P({ x: init ? R() * w : w * (0.5 + R() * 0.6), y: init ? R() * hh * 0.5 : -20, vx: -(160 + R() * 140), vy: 70 + R() * 60, size: 24 + R() * 30, max: 0.8 + R() * 0.6 }),
        step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; },
        draw: (c, p) => {
          c.globalAlpha = fade(p) * 0.75;
          const g = c.createLinearGradient(0, 0, p.size * 2, -p.size);
          g.addColorStop(0, '#fff');
          g.addColorStop(0.3, col[2]);
          g.addColorStop(1, rgba(col[0], 0));
          c.strokeStyle = g;
          c.lineWidth = 1.2;
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(p.size * 2, -p.size);
          c.stroke();
        },
      },
    ],
  }),

  aurora_veil: (col) => ({
    count: 26, additive: true,
    spawn: (w, hh) => P({ x: R() * w, y: R() * hh * 0.45, size: 0.6 + R() * 1.6, max: 3 + R() * 5 }),
    step: (p, dt, t) => {
      p.x += Math.sin(t * 0.3 + p.phase) * 5 * dt;
      p.phase += dt * 0.4;
    },
    draw: (c, p, t) => {
      c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * (0.4 + 0.3 * Math.sin(t + p.phase));
      c.fillStyle = lighten(col[1], 0.45);
      c.shadowColor = col[0];
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.62), A(mix(col[3], col[1], 0.2), 0.12));
      starfield(c, w, hh * 0.55, t, 62, col[2], 0.7);
      c.save();
      c.globalCompositeOperation = 'lighter';
      const bands = [
        { hue: col[0], y: 0.12, amp: 18, speed: 0.36, width: 0.24 },
        { hue: col[1], y: 0.19, amp: 24, speed: 0.28, width: 0.2 },
        { hue: col[2], y: 0.24, amp: 14, speed: 0.46, width: 0.16 },
        { hue: mix(col[0], col[2], 0.5), y: 0.08, amp: 10, speed: 0.2, width: 0.12 },
      ];
      for (const [i, band] of bands.entries()) {
        const top = hh * band.y;
        const g = c.createLinearGradient(0, top - 10, 0, top + hh * band.width);
        g.addColorStop(0, rgba(band.hue, 0));
        g.addColorStop(0.3, rgba(band.hue, 0.12 + Math.sin(t * 0.6 + i) * 0.03));
        g.addColorStop(0.66, rgba(band.hue, 0.07 + Math.sin(t * 0.45 + i) * 0.02));
        g.addColorStop(1, rgba(band.hue, 0));
        c.beginPath();
        c.moveTo(0, 0);
        for (let x = 0; x <= w + 8; x += 6) {
          const wave = Math.sin(x / (56 + i * 17) + t * band.speed) * band.amp
            + Math.sin(x / (21 + i * 6) - t * 0.65) * 5;
          c.lineTo(x, top + wave);
        }
        c.lineTo(w, 0);
        c.closePath();
        c.fillStyle = g;
        c.fill();
        // shimmering vertical streaks
        for (let s = 0; s < 7; s++) {
          const x = ((s * 41 + i * 17 + t * (12 + i * 5)) % (w + 60)) - 30;
          const a = 0.05 + 0.05 * Math.abs(Math.sin(t * 0.8 + s + i));
          const sg = c.createLinearGradient(x, top, x, top + hh * band.width * 0.9);
          sg.addColorStop(0, rgba(band.hue, 0));
          sg.addColorStop(0.4, rgba(lighten(band.hue, 0.5), a));
          sg.addColorStop(1, rgba(band.hue, 0));
          c.fillStyle = sg;
          c.fillRect(x, top, 3 + s * 0.6, hh * band.width);
        }
      }
      c.restore();
      ridge(c, w, hh, hh * 0.86, 18, A(mix(col[3], col[0], 0.12), 0.85), 1.3, t);
      ridge(c, w, hh, hh * 0.94, 10, A(col[3], 0.95), 4.8, t);
      mist(c, w, hh, hh * 0.82, col[1], 0.09, t, 0.3, 12);
      vignette(c, w, hh, col[3], 0.45);
    },
  }),
  // ---- Cute & party ------------------------------------------------------------
  confetti: (col) => ({
    count: 58,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh * 0.9 : -14,
      vy: 34 + R() * 62, vx: (R() - 0.5) * 44,
      size: 2 + R() * 4, max: 7 + R() * 4,
      vr: (R() - 0.5) * 10, hue: Math.floor(R() * 4),
      k: Math.floor(R() * 3), depth: 0.4 + R() * 0.6,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 2.4 + p.phase) * 24) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * (0.6 + p.depth * 0.4);
      c.rotate(p.rot);
      const flip = Math.max(0.12, Math.abs(Math.cos(t * 5 + p.phase)));
      c.scale(flip, 1);
      const cc = C(col, p.hue);
      c.fillStyle = cc;
      c.shadowColor = cc;
      c.shadowBlur = 4;
      if (p.k === 0) c.fillRect(-p.size, -p.size * 0.42, p.size * 2, p.size * 0.84);
      else if (p.k === 1) { c.beginPath(); c.arc(0, 0, p.size * 0.66, 0, TAU); c.fill(); }
      else { c.beginPath(); c.moveTo(-p.size, p.size * 0.5); c.lineTo(0, -p.size * 0.7); c.lineTo(p.size, p.size * 0.5); c.closePath(); c.fill(); }
      c.fillStyle = 'rgba(255,255,255,.45)';
      c.fillRect(-p.size * 0.6, -p.size * 0.25, p.size * 0.4, p.size * 0.18);
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.18), A(mix(col[3], col[1], 0.2), 0.1));
      bloom(c, w * 0.5, hh * 0.38, w * 0.7, col[2], 0.13);
      // celebration light rays
      c.save();
      c.translate(w * 0.5, hh * 0.35);
      c.globalCompositeOperation = 'lighter';
      c.rotate(t * 0.1);
      for (let i = 0; i < 16; i++) {
        c.rotate(TAU / 16);
        const g = c.createLinearGradient(0, 0, w * 0.8, 0);
        g.addColorStop(0, rgba(C(col, i), 0.16));
        g.addColorStop(1, rgba(C(col, i), 0));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(w * 0.8, -w * 0.025);
        c.lineTo(w * 0.8, w * 0.025);
        c.closePath();
        c.fill();
      }
      c.restore();
      // drifting bokeh
      for (let i = 0; i < 14; i++) {
        const x = h(i * 4.2) * w + Math.sin(t * 0.4 + i) * 10;
        const y = h(i * 8.4) * hh;
        bloom(c, x, y, 5 + h(i * 2.1) * 13, C(col, i), 0.2);
      }
      vignette(c, w, hh, col[3], 0.28);
    },
    layers: [
      {
        count: 34, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.7 + R() * 1.8, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 3 + p.phase * 2)) * 0.8;
          const cc = C(col, p.hue);
          c.fillStyle = lighten(cc, 0.45);
          c.shadowColor = cc;
          c.shadowBlur = 4;
          star4(c, p.size);
          c.fill();
        },
      },
    ],
  }),

  hearts: (col) => ({
    count: 20,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh : hh + 16,
      vx: (R() - 0.5) * 14, vy: -(18 + R() * 30),
      size: 4 + R() * 7, max: 5 + R() * 6, hue: Math.floor(R() * 3),
      depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 1.8 + p.phase) * 16) * dt;
      p.rot = Math.sin(t * 1.3 + p.phase) * 0.34;
    },
    draw: (c, p) => {
      const cc = C(col, p.hue);
      c.globalAlpha = fade(p) * (0.58 + p.depth * 0.42);
      c.rotate(p.rot);
      c.save();
      c.scale(1 + Math.sin(p.phase * 3 + p.life * 2) * 0.06, 1);
      const g = c.createLinearGradient(-p.size, -p.size, p.size, p.size);
      g.addColorStop(0, lighten(cc, 0.6));
      g.addColorStop(0.46, cc);
      g.addColorStop(1, darken(cc, 0.18));
      c.fillStyle = g;
      c.shadowColor = cc;
      c.shadowBlur = 10 + p.size;
      heart(c, p.size);
      c.fill();
      c.globalAlpha *= 0.55;
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(0.5, p.size * 0.08);
      c.stroke();
      c.globalAlpha *= 0.7;
      c.fillStyle = 'rgba(255,255,255,.65)';
      c.beginPath();
      c.ellipse(-p.size * 0.32, -p.size * 0.38, p.size * 0.16, p.size * 0.1, -0.5, 0, TAU);
      c.fill();
      c.restore();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.24), A(mix(col[3], col[1], 0.24), 0.12));
      bloom(c, w * 0.5, hh * 0.55, w * 0.7, col[1], 0.2);
      // soft heart bokeh
      for (let i = 0; i < 9; i++) {
        const x = h(i * 3.7) * w;
        const y = hh - ((t * (7 + h(i) * 9) + h(i * 8.1) * hh) % (hh + 40));
        c.save();
        c.translate(x + Math.sin(t * 0.6 + i) * 8, y);
        c.rotate(Math.sin(t * 0.5 + i) * 0.25);
        c.globalAlpha = 0.08 + h(i * 2.3) * 0.08;
        c.fillStyle = lighten(C(col, i), 0.35);
        heart(c, 8 + h(i * 5.2) * 14);
        c.fill();
        c.restore();
      }
      vignette(c, w, hh, col[3], 0.34);
    },
    layers: [
      {
        count: 10, additive: true,
        spawn: (w, hh) => P({ x: w * 0.5, y: hh * 0.62, size: 4 + R() * 4, max: 1.8 + R() * 1.2, k: Math.floor(R() * 3) }),
        step: (p, dt) => { p.size += 26 * dt; },
        draw: (c, p) => {
          c.globalAlpha = (1 - p.life / p.max) * 0.4;
          c.strokeStyle = C(col, p.k ?? 0);
          c.lineWidth = 1.2;
          heart(c, p.size);
          c.stroke();
        },
      },
      {
        count: 26, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.5 + R() * 1.4, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.4 + p.phase * 2)) * 0.65;
          c.fillStyle = lighten(col[2], 0.4);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  bubbles: (col) => ({
    count: 24,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh : hh + 14,
      vx: (R() - 0.5) * 9, vy: -(14 + R() * 28),
      size: 2.5 + R() * 9, max: 8 + R() * 6, hue: Math.floor(R() * 3),
      depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 1.7 + p.phase) * 12) * dt;
      p.size += Math.sin(t * 2.2 + p.phase) * 0.15 * dt;
    },
    draw: (c, p) => {
      const cc = C(col, p.hue);
      const s = p.size;
      c.globalAlpha = fade(p) * (0.5 + p.depth * 0.5);
      const g = c.createRadialGradient(-s * 0.36, -s * 0.4, s * 0.04, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,.85)');
      g.addColorStop(0.28, rgba(lighten(cc, 0.55), 0.22));
      g.addColorStop(0.78, rgba(cc, 0.1));
      g.addColorStop(1, rgba(lighten(cc, 0.3), 0.38));
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, s, 0, TAU);
      c.fill();
      c.strokeStyle = rgba(lighten(cc, 0.7), 0.65);
      c.lineWidth = Math.max(0.7, s * 0.055);
      c.stroke();
      c.globalAlpha *= 0.8;
      c.fillStyle = 'rgba(255,255,255,.75)';
      c.beginPath();
      c.ellipse(-s * 0.32, -s * 0.36, s * 0.2, s * 0.11, -0.65, 0, TAU);
      c.fill();
      c.beginPath();
      c.arc(s * 0.3, s * 0.26, s * 0.08, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.18), A(mix(col[3], col[1], 0.3), 0.12));
      // caustic arcs
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        c.strokeStyle = rgba(C(col, i), 0.07 + 0.04 * Math.sin(t * 0.7 + i));
        c.lineWidth = 2 + (i % 3) * 2;
        c.beginPath();
        const y = hh * (0.14 + i * 0.12) + Math.sin(t * 0.4 + i) * 12;
        for (let x = 0; x <= w; x += 12) c.lineTo(x, y + Math.sin(x / 36 + t * 0.6 + i) * 9);
        c.stroke();
      }
      c.restore();
      for (let i = 0; i < 10; i++) {
        bloom(c, h(i * 3.9) * w, h(i * 7.1) * hh, 10 + h(i) * 22, C(col, i), 0.08);
      }
      vignette(c, w, hh, col[3], 0.28);
    },
    layers: [
      {
        count: 40, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: hh + 8, vy: -(22 + R() * 40), size: 0.5 + R() * 1.5, max: 3 + R() * 3 }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 2 + p.phase) * 8 * dt; },
        draw: (c, p) => {
          c.globalAlpha = fade(p) * 0.75;
          c.fillStyle = lighten(col[1], 0.55);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  // ---- Gamer ------------------------------------------------------------------
  cipher_rain: (col) => ({
    count: 42,
    spawn: (w, hh, init) => P({
      x: Math.floor(R() * (w / 13)) * 13 + 6,
      y: init ? R() * hh : -30,
      vy: 46 + R() * 100, size: 9 + R() * 4, max: 999,
      hue: Math.floor(R() * 1e6), depth: 0.4 + R() * 0.6,
    }),
    step: (p, dt) => { p.y += p.vy * dt * p.depth; },
    draw: (c, p, t) => {
      const glyphs = '01ABCDEF#$%&+/=<>▲◆●▮';
      c.font = `700 ${p.size}px ui-monospace, Consolas, monospace`;
      c.textAlign = 'center';
      for (let i = 0; i < 9; i++) {
        const ch = glyphs[(p.hue + i * 7 + Math.floor(t * 11)) % glyphs.length];
        c.globalAlpha = (1 - i / 9) * (i ? 0.4 : 1);
        c.fillStyle = i === 0 ? lighten(col[2], 0.35) : C(col, p.hue % 3);
        if (i === 0) { c.shadowColor = col[2]; c.shadowBlur = 10; }
        else c.shadowBlur = 0;
        c.fillText(ch, 0, -i * 12);
      }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.6), A(mix(col[3], col[0], 0.2), 0.2));
      // circuit / grid
      c.save();
      c.strokeStyle = rgba(col[0], 0.1);
      c.lineWidth = 1;
      for (let x = 0; x <= w; x += 26) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hh); c.stroke(); }
      for (let y = 0; y <= hh; y += 26) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.strokeStyle = rgba(col[2], 0.22);
      for (let i = 0; i < 7; i++) {
        const y = hh * (0.12 + i * 0.13);
        const x = ((t * (12 + i * 3) + i * 41) % (w + 80)) - 40;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 44, y);
        c.lineTo(x + 54, y + 12);
        c.stroke();
        c.fillStyle = rgba(col[2], 0.5);
        c.fillRect(x + 44, y - 1.5, 3, 3);
      }
      c.restore();
      // scanlines
      c.fillStyle = 'rgba(0,0,0,.16)';
      for (let y = 0; y < hh; y += 4) c.fillRect(0, y, w, 1);
      const flicker = 0.03 + Math.random() * 0.02;
      c.fillStyle = rgba(col[2], flicker);
      c.fillRect(0, 0, w, hh);
      starfield(c, w, hh, t, 20, col[1], 0.35);
      vignette(c, w, hh, col[3], 0.5);
    },
    layers: [
      {
        count: 18, additive: true,
        spawn: (w, hh) => P({ x: Math.floor(R() * (w / 13)) * 13 + 6, y: R() * hh, size: 2 + R() * 4, max: 0.6 + R() * 0.6, vy: 90 + R() * 120 }),
        step: (p, dt) => { p.y += p.vy * dt; },
        draw: (c, p) => {
          c.globalAlpha = 0.55;
          c.fillStyle = col[2];
          c.shadowColor = col[2];
          c.shadowBlur = 9;
          c.fillRect(-1, 0, 2, 10 + p.size * 4);
        },
      },
    ],
  }),

  blocks: (col) => ({
    count: 20,
    spawn: (w, hh, init) => P({
      x: 12 + R() * (w - 24), y: init ? R() * hh : -30,
      vy: 34 + R() * 52, vx: (R() - 0.5) * 14,
      size: 5 + R() * 3, max: 999, k: Math.floor(R() * 7), hue: Math.floor(R() * 4),
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 0.8 + p.phase) * 7 * dt;
      p.rot = 0;
    },
    draw: (c, p, t) => {
      const shapes = [
        [[0, 0], [1, 0], [2, 0], [3, 0]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[0, 0], [1, 0], [2, 0], [2, 1]],
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
      ];
      const s = p.size;
      const cells = shapes[p.k ?? 0];
      const cc = C(col, p.hue);
      c.globalAlpha = Math.min(1, p.life / 0.4) * 0.85;
      for (const [gx, gy] of cells) {
        const x = gx * s;
        const y = gy * s;
        c.fillStyle = cc;
        c.shadowColor = cc;
        c.shadowBlur = 5;
        c.fillRect(x, y, s - 1, s - 1);
        c.fillStyle = rgba(lighten(cc, 0.55), 0.6);
        c.fillRect(x + 1, y + 1, s - 3, 1.5);
        c.fillStyle = 'rgba(0,0,0,.22)';
        c.fillRect(x + 1, y + s - 3, s - 2, 2);
      }
      c.globalAlpha = 0.3;
      c.fillStyle = lighten(cc, 0.5);
      c.fillRect(0, 0, s * 2, 1);
      void t;
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.45), A(mix(col[3], col[1], 0.16), 0.12));
      // neon grid
      c.save();
      c.strokeStyle = rgba(col[1], 0.22);
      c.lineWidth = 1;
      for (let x = 0; x <= w; x += 22) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hh); c.stroke(); }
      for (let y = 0; y <= hh; y += 22) {
        const flash = 0.14 + Math.max(0, Math.sin(t * 1.4 - y / 40)) * 0.12;
        c.strokeStyle = rgba(col[1], flash);
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      }
      // side walls
      c.fillStyle = rgba(col[1], 0.16);
      c.fillRect(0, 0, 4, hh);
      c.fillRect(w - 4, 0, 4, hh);
      c.restore();
      bloom(c, w * 0.5, hh * 0.42, w * 0.6, col[2], 0.12);
      starfield(c, w, hh, t, 22, col[2], 0.4);
      vignette(c, w, hh, col[3], 0.45);
    },
    layers: [
      {
        count: 30, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.5 + R() * 1.2, max: 0.5 + R() * 0.8 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 4 + p.phase * 2)) * 0.6;
          c.fillStyle = C(col, p.hue);
          c.fillRect(0, 0, p.size * 2, p.size * 2);
        },
      },
    ],
  }),

  notes: (col) => ({
    count: 18,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh : hh + 16,
      vy: -(20 + R() * 36), vx: (R() - 0.5) * 16,
      size: 4 + R() * 6, max: 6 + R() * 5, hue: Math.floor(R() * 3),
      k: R() < 0.3 ? 1 : 0,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 1.6 + p.phase) * 18) * dt;
    },
    draw: (c, p, t) => {
      const cc = C(col, p.hue);
      c.globalAlpha = fade(p) * 0.92;
      c.rotate(Math.sin(t * 2 + p.phase) * 0.35);
      c.fillStyle = cc;
      c.strokeStyle = cc;
      c.shadowColor = cc;
      c.shadowBlur = 8;
      if (p.k === 1) {
        c.save();
        c.translate(-p.size * 0.5, 0);
        note(c, p.size * 0.7);
        c.restore();
        c.save();
        c.translate(p.size * 0.5, p.size * 0.2);
        note(c, p.size * 0.7);
        c.restore();
        c.lineWidth = p.size * 0.12;
        c.beginPath();
        c.moveTo(-p.size * 0.2, -p.size * 1.1);
        c.lineTo(p.size * 0.8, -p.size * 0.9);
        c.stroke();
      } else {
        note(c, p.size);
      }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.38), A(mix(col[3], col[1], 0.2), 0.12));
      // staff lines
      c.save();
      c.strokeStyle = rgba(col[0], 0.16);
      c.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        const y = hh * (0.24 + i * 0.035);
        c.moveTo(0, y);
        c.lineTo(w, y + Math.sin(t * 0.6 + i) * 5);
        c.stroke();
      }
      c.restore();
      // waveform
      c.save();
      c.strokeStyle = rgba(col[2], 0.4);
      c.lineWidth = 1.6;
      c.beginPath();
      for (let x = 0; x <= w; x += 5) {
        const y = hh * 0.52 + Math.sin(x * 0.055 + t * 2.2) * 16 * Math.sin(x * 0.011 + t * 0.4);
        x ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
      c.restore();
      // equalizer bars
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const x = (i / 13) * w;
        const bh = hh * (0.06 + Math.abs(Math.sin(t * 2.4 + i * 0.7)) * 0.16);
        const g = c.createLinearGradient(0, hh, 0, hh - bh);
        g.addColorStop(0, rgba(col[1], 0.38));
        g.addColorStop(1, rgba(col[2], 0));
        c.fillStyle = g;
        c.fillRect(x, hh - bh, w / 18, bh);
      }
      c.restore();
      bloom(c, w * 0.5, hh * 0.55, w * 0.55, col[1], 0.1);
      vignette(c, w, hh, col[3], 0.36);
    },
    layers: [
      {
        count: 28, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.5 + R() * 1.3, max: 2 + R() * 3 }),
        step: (p, dt, t) => { p.y -= 7 * dt; p.x += Math.sin(t * 2 + p.phase) * 9 * dt; },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.6 + p.phase * 2)) * 0.55;
          c.fillStyle = lighten(col[2], 0.4);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  // ---- Spooky -----------------------------------------------------------------
  hands: (col) => ({
    count: 12,
    spawn: (w, hh, init) => P({
      x: w * (0.06 + R() * 0.88), y: init ? hh * (0.5 + R() * 0.5) : hh + 40,
      vy: -(6 + R() * 12), vx: (R() - 0.5) * 8,
      size: 9 + R() * 10, max: 999, rot: (R() - 0.5) * 0.5,
      k: R() < 0.3 ? 1 : 0, depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += Math.sin(t * 0.6 + p.phase) * 7 * dt;
      p.rot = Math.sin(t * 0.9 + p.phase) * 0.18;
    },
    draw: (c, p, t) => {
      const s = p.size;
      c.rotate(p.rot);
      c.globalAlpha = Math.min(1, p.life / 1.2) * (0.45 + p.depth * 0.4);
      const g = c.createLinearGradient(0, -s, 0, s * 1.6);
      g.addColorStop(0, lighten(col[0], 0.1));
      g.addColorStop(1, darken(col[0], 0.55));
      c.fillStyle = g;
      c.shadowColor = col[0];
      c.shadowBlur = 8;
      c.beginPath();
      c.moveTo(-s * 0.5, s);
      c.lineTo(-s * 0.55, 0);
      c.lineTo(-s * 0.42, -s * 0.5);
      c.quadraticCurveTo(-s * 0.38, -s * 0.75, -s * 0.22, -s * 0.5);
      c.lineTo(-s * 0.16, -s * 0.1);
      c.lineTo(-s * 0.12, -s * 0.82);
      c.quadraticCurveTo(-s * 0.06, -s * 1.02, s * 0.02, -s * 0.8);
      c.lineTo(s * 0.08, -s * 0.2);
      c.lineTo(s * 0.14, -s * 0.74);
      c.quadraticCurveTo(s * 0.22, -s * 0.96, s * 0.28, -s * 0.72);
      c.lineTo(s * 0.3, -s * 0.08);
      c.lineTo(s * 0.38, -s * 0.6);
      c.quadraticCurveTo(s * 0.48, -s * 0.8, s * 0.5, -s * 0.5);
      c.lineTo(s * 0.46, s * 0.08);
      c.quadraticCurveTo(s * 0.6, s * 0.26, s * 0.54, s * 0.62);
      c.lineTo(s * 0.4, s);
      c.closePath();
      c.fill();
      c.globalAlpha *= 0.4;
      c.strokeStyle = lighten(col[0], 0.5);
      c.lineWidth = 0.8;
      c.stroke();
      if (p.k === 1) {
        c.globalAlpha = 0.65;
        c.fillStyle = col[2];
        c.beginPath();
        c.arc(0, -s * 0.1, 1.3, 0, TAU);
        c.fill();
      }
      void t;
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.62), A(col[0], 0.18));
      bloom(c, w * 0.5, hh * 1.1, w * 0.8, col[1], 0.26);
      for (let i = 0; i < 6; i++) {
        const x = w * (0.1 + i * 0.17) + Math.sin(t * 0.3 + i) * 14;
        const y = hh * (0.7 + Math.sin(t * 0.5 + i * 2) * 0.04);
        c.globalAlpha = 0.12;
        c.fillStyle = col[3];
        c.beginPath();
        c.ellipse(x, y, 34 + i * 4, 13 + i, 0.1, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
      // hanging ropes / chains
      c.strokeStyle = rgba(darken(col[3], 0.4), 0.6);
      c.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const x = w * (0.15 + i * 0.24);
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + Math.sin(t * 0.4 + i) * 5, hh * 0.42);
        c.stroke();
      }
      mist(c, w, hh, hh * 0.68, col[0], 0.12, t, 0.25, 14);
      speckle(c, w, hh, t, 36, col[2], 0.3, 1, 53);
      vignette(c, w, hh, col[3], 0.55);
    },
    layers: [
      {
        count: 22, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: hh * (0.5 + R() * 0.5), size: 1 + R() * 2.4, max: 3 + R() * 4, vy: -(4 + R() * 10) }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t + p.phase) * 8 * dt; },
        draw: (c, p) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.45;
          c.fillStyle = col[2];
          c.shadowColor = col[2];
          c.shadowBlur = 7;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  dark_eyes: (col) => ({
    count: 9,
    spawn: (w, hh) => P({
      x: w * (0.12 + R() * 0.76), y: hh * (0.12 + R() * 0.76),
      size: 4 + R() * 7, max: 4 + R() * 4, rot: R() * 0.3 - 0.15,
    }),
    draw: (c, p, t) => {
      const life = p.life / p.max;
      const open = Math.min(1, Math.sin(life * Math.PI) * 2.4) * (Math.sin(t * 2.4 + p.phase) > 0.93 ? 0.08 : 1);
      c.rotate(p.rot);
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * p.size * 1.35, 0);
        c.shadowColor = col[0];
        c.shadowBlur = 14;
        eye(c, p.size, open, col[0], '#050308');
        c.restore();
      }
      c.globalAlpha = 0.25;
      c.fillStyle = col[0];
      c.fillRect(-p.size * 2.4, p.size * 0.55, p.size * 4.8, 1);
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.72), A(mix(col[3], col[0], 0.14), 0.24));
      // shadow tendrils
      c.save();
      c.strokeStyle = rgba(col[1], 0.35);
      c.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        c.lineWidth = 2 + (i % 3) * 2;
        c.beginPath();
        c.moveTo(w * (0.05 + i * 0.13), hh);
        for (let k = 1; k <= 5; k++) {
          c.lineTo(
            w * (0.05 + i * 0.13) + Math.sin(t * 0.4 + i + k) * 14,
            hh - k * hh * 0.055,
          );
        }
        c.stroke();
      }
      c.restore();
      bloom(c, w * 0.75, hh * 0.2, w * 0.4, col[0], 0.1);
      // faint watching glow
      for (let i = 0; i < 5; i++) {
        bloom(c, h(i * 3.3) * w, h(i * 6.9) * hh, 12 + h(i) * 18, col[0], 0.08);
      }
      speckle(c, w, hh, t, 26, col[2], 0.24, 1, 31);
      vignette(c, w, hh, col[3], 0.7);
    },
    layers: [
      {
        count: 34,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.5 + R() * 1.2, max: 2 + R() * 4 }),
        step: (p, dt, t) => { p.y -= 4 * dt; p.x += Math.sin(t * 0.4 + p.phase) * 4 * dt; },
        draw: (c, p) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.35;
          c.fillStyle = C(col, 0);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  feathers: (col) => ({
    count: 13,
    spawn: (w, hh, init) => P({
      x: R() * w * 1.2 - w * 0.1, y: init ? R() * hh : -18,
      vx: -8 - R() * 16, vy: 14 + R() * 22,
      size: 5 + R() * 8, vr: (R() - 0.5) * 1.8, max: 10 + R() * 6,
      hue: Math.floor(R() * 3), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 1.1 + p.phase) * 22) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const cc = C(col, p.hue);
      c.globalAlpha = fade(p) * (0.5 + p.depth * 0.5);
      c.rotate(p.rot + Math.sin(t * 1.2 + p.phase) * 0.18);
      const g = c.createLinearGradient(-p.size, 0, p.size, 0);
      g.addColorStop(0, darken(cc, 0.24));
      g.addColorStop(0.5, lighten(cc, 0.5));
      g.addColorStop(1, cc);
      c.fillStyle = g;
      c.shadowColor = cc;
      c.shadowBlur = 6;
      feather(c, p.size);
      c.fill();
      c.globalAlpha *= 0.45;
      c.strokeStyle = lighten(cc, 0.8);
      c.lineWidth = 0.6;
      c.beginPath();
      c.moveTo(0, p.size * 0.9);
      c.lineTo(0, -p.size * 1.1);
      for (let i = 1; i < 6; i++) {
        const y = p.size * (0.9 - i * 0.32);
        c.moveTo(0, y);
        c.lineTo((i % 2 ? 1 : -1) * p.size * 0.3, y - p.size * 0.2);
      }
      c.stroke();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.4), A(mix(col[3], col[2], 0.22), 0.12));
      bloom(c, w * 0.72, hh * 0.2, w * 0.5, col[2], 0.18);
      c.globalAlpha = 0.8;
      crescent(c, w * 0.72, hh * 0.19, Math.min(w, hh) * 0.1, A(lighten(col[2], 0.3), 0.9));
      c.globalAlpha = 1;
      // huge wing arcs
      c.save();
      c.strokeStyle = rgba(col[2], 0.14);
      c.lineWidth = 1.2;
      for (let f = 0; f < 9; f++) {
        c.beginPath();
        c.moveTo(w * 0.06, hh * 0.92);
        c.quadraticCurveTo(w * (0.2 + f * 0.05), hh * (0.5 - f * 0.02), w * (0.5 + f * 0.035), hh * (0.2 + Math.sin(t * 0.2 + f) * 0.01));
        c.stroke();
      }
      c.restore();
      mist(c, w, hh, hh * 0.68, col[0], 0.1, t, 0.28, 14);
      speckle(c, w, hh, t, 34, col[2], 0.35, 1, 61);
      vignette(c, w, hh, col[3], 0.42);
    },
    layers: [
      {
        count: 30,
        spawn: (w, hh, init) => P({ x: R() * w, y: init ? R() * hh : -8, vy: 18 + R() * 26, size: 1.4 + R() * 3, max: 8 + R() * 6, vx: (R() - 0.5) * 10 }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t + p.phase) * 10 * dt; },
        draw: (c, p) => {
          c.globalAlpha = fade(p) * 0.45;
          c.fillStyle = lighten(col[2], 0.4);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  sunbeams: (col) => ({
    count: 40, additive: true,
    spawn: (w, hh) => P({
      x: R() * w, y: R() * hh, size: 0.8 + R() * 2, max: 5 + R() * 6,
      vx: 5 + R() * 9, vy: -(2 + R() * 5), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; },
    draw: (c, p, t) => {
      c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.7;
      c.fillStyle = lighten(col[2], 0.4);
      c.shadowColor = col[0];
      c.shadowBlur = 7;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
      void t;
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[0], 0.4), 0.24), A(mix(col[3], col[1], 0.3), 0.2));
      // god rays from top right
      c.save();
      c.translate(w, -20);
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        c.save();
        c.rotate(2.15 + i * 0.13 + Math.sin(t * 0.25 + i) * 0.035);
        const g = c.createLinearGradient(0, 0, hh * 1.5, 0);
        g.addColorStop(0, rgba(col[2], 0.24));
        g.addColorStop(0.5, rgba(col[0], 0.08));
        g.addColorStop(1, rgba(col[0], 0));
        c.fillStyle = g;
        c.fillRect(0, -8 - i * 4, hh * 1.5, 16 + i * 8);
        c.restore();
      }
      c.restore();
      bloom(c, w * 0.88, hh * 0.06, w * 0.42, col[2], 0.5);
      // lens flare
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 1; i < 6; i++) {
        const x = w * (0.88 - i * 0.13);
        const y = hh * (0.06 + i * 0.11);
        c.globalAlpha = 0.1 + 0.06 * Math.sin(t * 1.2 + i);
        c.fillStyle = C(col, i);
        c.beginPath();
        c.arc(x, y, 4 + i * 3, 0, TAU);
        c.fill();
      }
      c.restore();
      c.globalAlpha = 1;
      ridge(c, w, hh, hh * 0.9, 8, A(mix(col[3], col[1], 0.3), 0.5), 6.1, t);
      speckle(c, w, hh, t, 50, col[2], 0.5, 1.3, 71);
      vignette(c, w, hh, mix(col[3], col[1], 0.4), 0.3);
    },
    layers: [
      {
        count: 18, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 5 + R() * 12, max: 3 + R() * 4 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.12;
          c.fillStyle = C(col, 2);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
          void t;
        },
      },
    ],
  }),

  // ---- Royal -----------------------------------------------------------------
  coins: (col) => ({
    count: 18,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh * 0.8 : -16,
      vy: 52 + R() * 85, vx: (R() - 0.5) * 22,
      size: 4 + R() * 5, max: 6 + R() * 4, vr: (R() - 0.5) * 7,
      hue: Math.floor(R() * 2), depth: 0.4 + R() * 0.6,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 2 + p.phase) * 12) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const sx = Math.cos(t * 4 + p.phase);
      const cc = p.hue ? col[0] : col[1];
      c.globalAlpha = fade(p) * (0.65 + p.depth * 0.35);
      c.rotate(p.rot * 0.18);
      c.scale(Math.max(0.12, Math.abs(sx)), 1);
      c.fillStyle = lighten(cc, 0.18);
      c.shadowColor = cc;
      c.shadowBlur = 6;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
      c.strokeStyle = darken(cc, 0.3);
      c.lineWidth = 1;
      c.stroke();
      c.beginPath();
      c.arc(0, 0, p.size * 0.72, 0, TAU);
      c.stroke();
      c.fillStyle = darken(cc, 0.18);
      star4(c, p.size * 0.42);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.beginPath();
      c.ellipse(-p.size * 0.35, -p.size * 0.35, p.size * 0.22, p.size * 0.12, -0.6, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.38), A(mix(col[3], col[0], 0.24), 0.16));
      // golden rays
      c.save();
      c.translate(w * 0.5, hh * 0.32);
      c.globalCompositeOperation = 'lighter';
      c.rotate(t * 0.08);
      for (let i = 0; i < 18; i++) {
        c.rotate(TAU / 18);
        const g = c.createLinearGradient(0, 0, w * 0.8, 0);
        g.addColorStop(0, rgba(col[0], 0.18));
        g.addColorStop(1, rgba(col[0], 0));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(w * 0.8, -w * 0.02);
        c.lineTo(w * 0.8, w * 0.02);
        c.closePath();
        c.fill();
      }
      c.restore();
      bloom(c, w * 0.5, hh * 0.32, w * 0.45, col[2], 0.25);
      // coin stacks
      for (let i = 0; i < 4; i++) {
        const x = w * (0.18 + i * 0.21);
        const bh = hh * (0.04 + (i % 3) * 0.02);
        c.fillStyle = rgba(col[0], 0.5);
        c.fillRect(x - 10, hh - bh, 20, bh);
        c.fillStyle = rgba(darken(col[0], 0.3), 0.5);
        for (let y = hh - bh; y < hh; y += 4) c.fillRect(x - 10, y, 20, 1);
      }
      speckle(c, w, hh, t, 44, col[2], 0.5, 1.3, 83);
      vignette(c, w, hh, col[3], 0.42);
    },
    layers: [
      {
        count: 36, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.6 + R() * 1.8, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 3 + p.phase * 2)) * 0.8;
          c.fillStyle = lighten(col[0], 0.4);
          c.shadowColor = col[0];
          c.shadowBlur = 5;
          star4(c, p.size);
          c.fill();
        },
      },
    ],
  }),

  lava: (col) => ({
    count: 9,
    spawn: (w, hh, init) => P({
      x: w * (0.12 + R() * 0.76), y: init ? R() * hh : hh + 40,
      vy: -(7 + R() * 13), vx: (R() - 0.5) * 6,
      size: 14 + R() * 22, max: 999, hue: Math.floor(R() * 2),
      phase: R() * TAU, depth: 0.5 + R() * 0.5,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += Math.sin(t * 0.4 + p.phase) * 7 * dt;
    },
    draw: (c, p, t) => {
      const r = p.size * (1 + 0.12 * Math.sin(t * 1.2 + p.phase));
      const cc = C(col, p.hue);
      c.globalAlpha = 0.58;
      const g = c.createRadialGradient(-r * 0.2, -r * 0.24, r * 0.1, 0, 0, r);
      g.addColorStop(0, lighten(cc, 0.55));
      g.addColorStop(0.4, cc);
      g.addColorStop(0.82, darken(cc, 0.2));
      g.addColorStop(1, rgba(cc, 0));
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(0, 0, r, r * (1.05 + 0.12 * Math.sin(t + p.phase)), 0, 0, TAU);
      c.fill();
      // inner bubbles
      c.globalAlpha *= 0.5;
      c.fillStyle = lighten(cc, 0.6);
      for (let i = 0; i < 3; i++) {
        const a = p.phase + i * 2.1 + t * 0.2;
        c.beginPath();
        c.arc(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.3, r * (0.08 + i * 0.03), 0, TAU);
        c.fill();
      }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.4), A(mix(col[3], col[1], 0.25), 0.18));
      bloom(c, w * 0.5, hh * 0.85, w * 0.7, col[1], 0.3);
      // glass lamp silhouette
      c.save();
      c.strokeStyle = rgba(col[0], 0.14);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(w * 0.22, hh * 0.88);
      c.quadraticCurveTo(w * 0.12, hh * 0.55, w * 0.28, hh * 0.22);
      c.quadraticCurveTo(w * 0.5, hh * 0.12, w * 0.72, hh * 0.22);
      c.quadraticCurveTo(w * 0.88, hh * 0.55, w * 0.78, hh * 0.88);
      c.closePath();
      c.stroke();
      c.restore();
      for (let i = 0; i < 8; i++) {
        bloom(c, h(i * 4.3) * w, h(i * 7.7) * hh, 10 + h(i) * 18, C(col, i % 2), 0.1);
      }
      speckle(c, w, hh, t, 20, col[2], 0.3, 1.2, 97);
      vignette(c, w, hh, col[3], 0.48);
    },
    layers: [
      {
        count: 26, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: hh + 10, vy: -(14 + R() * 30), size: 0.8 + R() * 2, max: 4 + R() * 4 }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 1.4 + p.phase) * 6 * dt; },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.65;
          c.fillStyle = lighten(col[1], 0.45);
          c.shadowColor = col[1];
          c.shadowBlur = 6;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
          void t;
        },
      },
    ],
  }),
  // ---- Museum & silver screen --------------------------------------------------
  starry_swirl: (col) => ({
    count: 16, additive: true,
    spawn: (w, hh) => P({
      x: R() * w, y: R() * hh * 0.85,
      size: 2 + R() * 4, max: 4 + R() * 5, hue: Math.floor(R() * 3),
      vx: (R() - 0.5) * 6, vy: (R() - 0.5) * 5,
    }),
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t * 0.3 + p.phase) * 4) * dt;
      p.y += (p.vy + Math.cos(t * 0.25 + p.phase) * 4) * dt;
    },
    draw: (c, p, t) => {
      const cc = C(col, p.hue);
      const a = Math.max(0, Math.sin((p.life / p.max) * Math.PI));
      c.globalAlpha = a;
      c.fillStyle = lighten(cc, 0.4);
      c.shadowColor = cc;
      c.shadowBlur = 12;
      star(c, p.size * (0.7 + 0.3 * Math.sin(t * 2 + p.phase)), 5);
      c.fill();
      c.globalAlpha *= 0.22;
      c.beginPath();
      c.arc(0, 0, p.size * 3.2, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[1], 0.35), 0.46), A(mix(col[3], col[0], 0.3), 0.2));
      c.save();
      c.globalCompositeOperation = 'lighter';
      // painterly swirls: nested arcs rotating around drifting centres
      for (let v = 0; v < 4; v++) {
        const cx = w * (0.2 + v * 0.22) + Math.sin(t * 0.09 + v) * w * 0.09;
        const cy = hh * (0.25 + (v % 2) * 0.22);
        for (let a = 0; a < 7; a++) {
          const rot = t * (0.05 + v * 0.008) + a * 0.9;
          c.beginPath();
          for (let i = 0; i <= 34; i++) {
            const th = rot + i * 0.16;
            const rr = 4 + i * (4.4 + v);
            const x = cx + Math.cos(th) * rr;
            const y = cy + Math.sin(th) * rr * 0.62;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
          }
          c.strokeStyle = rgba(C(col, a), 0.1);
          c.lineWidth = 3.2 - (a % 2);
          c.stroke();
        }
      }
      // big glowing stars
      for (let i = 0; i < 11; i++) {
        const x = h(i * 5.3) * w;
        const y = h(i * 9.1) * hh * 0.62;
        const pulse = 0.7 + Math.abs(Math.sin(t * 0.8 + i)) * 0.5;
        c.save();
        c.translate(x, y);
        c.globalAlpha = 0.85;
        c.fillStyle = lighten(col[0], 0.55);
        c.shadowColor = col[0];
        c.shadowBlur = 14 * pulse;
        star4(c, (2.4 + h(i * 2.1) * 3.4) * pulse);
        c.fill();
        c.restore();
      }
      c.restore();
      // crescent moon
      c.globalAlpha = 0.92;
      crescent(c, w * 0.82, hh * 0.16, Math.min(w, hh) * 0.08, lighten(col[0], 0.5));
      c.globalAlpha = 1;
      // cypress silhouette
      c.fillStyle = A(darken(col[3], 0.5), 0.92);
      c.beginPath();
      c.moveTo(w * 0.12, hh);
      c.bezierCurveTo(w * 0.06, hh * 0.7, w * 0.13, hh * 0.32, w * 0.2, hh * -0.02);
      c.bezierCurveTo(w * 0.24, hh * 0.35, w * 0.26, hh * 0.7, w * 0.22, hh);
      c.closePath();
      c.fill();
      // village
      c.fillStyle = A(darken(col[3], 0.55), 0.9);
      c.fillRect(0, hh * 0.86, w, hh * 0.14);
      for (let i = 0; i < 7; i++) {
        c.fillStyle = A(darken(col[3], 0.5), 0.9);
        c.fillRect(w * (0.1 + i * 0.12), hh * (0.78 + (i % 3) * 0.02), 12, hh * 0.08);
        c.fillStyle = rgba(col[0], 0.5);
        c.fillRect(w * (0.1 + i * 0.12) + 3, hh * (0.8 + (i % 3) * 0.02), 2, 2);
      }
      starfield(c, w, hh, t, 60, col[0], 0.55);
      vignette(c, w, hh, col[3], 0.32);
    },
    layers: [
      {
        count: 46, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.5 + R() * 1.4, max: 2 + R() * 4 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.7 + p.phase * 2)) * 0.6;
          c.fillStyle = lighten(col[1], 0.5);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  wave_spray: (col) => ({
    count: 46,
    spawn: (w, hh, init) => P({
      x: R() * w, y: hh * 0.72, vx: (R() - 0.32) * 90, vy: -(60 + R() * 120),
      size: 1 + R() * 2.6, max: 1.4 + R() * 1.4, life: init ? R() * 1.6 : 0,
    }),
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 150 * dt; },
    draw: (c, p) => {
      c.globalAlpha = fade(p);
      c.fillStyle = lighten(col[0], 0.5);
      c.shadowColor = col[0];
      c.shadowBlur = 4;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[0], 0.32), 0.4), A(mix(col[3], col[1], 0.4), 0.26));
      // sun disc
      bloom(c, w * 0.76, hh * 0.2, w * 0.32, col[0], 0.4);
      c.globalAlpha = 0.75;
      c.fillStyle = lighten(col[0], 0.5);
      c.beginPath();
      c.arc(w * 0.76, hh * 0.2, Math.min(w, hh) * 0.065, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
      // Mt Fuji
      c.fillStyle = A(mix(col[1], col[3], 0.45), 0.55);
      c.beginPath();
      c.moveTo(w * 0.04, hh * 0.74);
      c.lineTo(w * 0.28, hh * 0.52);
      c.lineTo(w * 0.36, hh * 0.56);
      c.lineTo(w * 0.52, hh * 0.74);
      c.closePath();
      c.fill();
      c.fillStyle = A(col[0], 0.6);
      c.beginPath();
      c.moveTo(w * 0.245, hh * 0.555);
      c.lineTo(w * 0.28, hh * 0.52);
      c.lineTo(w * 0.315, hh * 0.55);
      c.lineTo(w * 0.29, hh * 0.575);
      c.lineTo(w * 0.268, hh * 0.56);
      c.closePath();
      c.fill();
      // three wave layers, the front one with foam claws
      for (let L = 0; L < 3; L++) {
        const base = hh * (0.7 + L * 0.07);
        const crest = hh * (0.4 - L * 0.03);
        c.beginPath();
        c.moveTo(-10, hh);
        c.lineTo(-10, base);
        c.bezierCurveTo(w * 0.14, base - 12, w * 0.26, crest + 8, w * 0.44, crest);
        c.bezierCurveTo(w * 0.58, crest, w * 0.6, crest + hh * 0.1, w * 0.5, crest + hh * 0.15);
        c.bezierCurveTo(w * 0.64, crest + hh * 0.12, w * 0.72, base - 16, w + 10, base + 6);
        c.lineTo(w + 10, hh);
        c.closePath();
        const g = c.createLinearGradient(0, crest, 0, hh);
        g.addColorStop(0, L === 0 ? lighten(col[1], 0.25) : col[1]);
        g.addColorStop(0.6, darken(col[1], 0.15 + L * 0.08));
        g.addColorStop(1, darken(col[3], 0.15));
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = A(col[0], 0.55);
        c.lineWidth = L === 2 ? 2.4 : 1.4;
        c.stroke();
        // foam along the crest
        c.save();
        c.fillStyle = A(col[0], 0.75);
        for (let i = 0; i < 22; i++) {
          const f = i / 21;
          const x = w * (0.06 + f * 0.86);
          const y = base - 16 - Math.sin(f * Math.PI) * (base - crest) * 0.8;
          c.beginPath();
          c.arc(x + Math.sin(t * 1.2 + i) * 3, y + Math.sin(t + i) * 2, 1 + (i % 3), 0, TAU);
          c.fill();
        }
        c.restore();
      }
      mist(c, w, hh, hh * 0.88, col[0], 0.18, t, 0.6, 6);
      starfield(c, w, hh * 0.5, t, 16, col[0], 0.35);
      vignette(c, w, hh, col[3], 0.3);
    },
    layers: [
      {
        count: 34,
        spawn: (w, hh) => P({ x: R() * w, y: hh * (0.62 + R() * 0.2), vx: (R() - 0.5) * 50, vy: -(20 + R() * 60), size: 0.8 + R() * 2, max: 1.6 + R() * 1.4 }),
        step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; },
        draw: (c, p) => {
          c.globalAlpha = fade(p) * 0.7;
          c.fillStyle = col[0];
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  moon_rocket: (col) => ({
    count: 26, additive: true,
    spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.7 + R() * 2.2, max: 2 + R() * 4, hue: Math.floor(R() * 2) }),
    draw: (c, p, t) => {
      const a = Math.max(0, Math.sin((p.life / p.max) * Math.PI));
      c.globalAlpha = a;
      c.fillStyle = lighten(C(col, p.hue), 0.5);
      c.shadowColor = C(col, p.hue);
      c.shadowBlur = 8;
      c.rotate(t * 0.4 + p.phase);
      star4(c, p.size * 1.5);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[1], 0.28), 0.5), A(col[3], 0.45));
      starfield(c, w, hh, t, 90, col[0], 0.8);
      // smiling moon
      const mx = w * 0.76, my = hh * 0.24, mr = Math.min(w, hh) * 0.19;
      bloom(c, mx, my, mr * 3, col[0], 0.26);
      c.fillStyle = lighten(col[0], 0.3);
      c.beginPath();
      c.arc(mx, my, mr, 0, TAU);
      c.fill();
      c.strokeStyle = A(darken(col[0], 0.25), 0.6);
      c.lineWidth = 1.2;
      c.stroke();
      c.fillStyle = rgba(darken(col[0], 0.25), 0.45);
      c.beginPath();
      c.arc(mx - mr * 0.34, my - mr * 0.2, mr * 0.13, 0, TAU);
      c.arc(mx + mr * 0.28, my - mr * 0.18, mr * 0.1, 0, TAU);
      c.arc(mx + mr * 0.08, my + mr * 0.32, mr * 0.17, 0, TAU);
      c.fill();
      // face
      c.strokeStyle = A(darken(col[0], 0.35), 0.75);
      c.lineWidth = Math.max(1, mr * 0.04);
      c.beginPath();
      c.arc(mx, my + mr * 0.02, mr * 0.38, 0.28, Math.PI - 0.28);
      c.stroke();
      c.fillStyle = A(darken(col[0], 0.35), 0.75);
      c.beginPath();
      c.ellipse(mx - mr * 0.2, my - mr * 0.04, mr * 0.08, mr * 0.13, 0.2, 0, TAU);
      c.ellipse(mx + mr * 0.2, my - mr * 0.04, mr * 0.08, mr * 0.13, -0.2, 0, TAU);
      c.fill();
      // rocket capsule on an arc, with exhaust
      const speed = 0.055;
      const k = (t * speed) % 1;
      const x = w * 0.06 + (mx - w * 0.06) * k;
      const y = hh * 0.82 - (hh * 0.82 - my) * Math.sin(k * Math.PI * 0.5);
      const ang = -0.7 + k * 0.5;
      c.save();
      c.translate(x, y);
      c.rotate(ang);
      // exhaust
      c.globalCompositeOperation = 'lighter';
      for (let i = 1; i < 8; i++) {
        const a = (1 - i / 8) * 0.5;
        c.fillStyle = rgba(C(col, i % 3), a);
        c.beginPath();
        c.arc(-10 - i * 6, Math.sin(t * 8 + i) * 2, 3 - i * 0.25, 0, TAU);
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      // capsule body
      c.fillStyle = '#d7dae0';
      c.strokeStyle = darken(col[3], 0.2);
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(-9, -5);
      c.lineTo(7, -5);
      c.quadraticCurveTo(15, 0, 7, 5);
      c.lineTo(-9, 5);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = col[1];
      c.fillRect(-9, -2, 8, 4);
      c.fillStyle = lighten(col[0], 0.5);
      c.beginPath();
      c.arc(4, 0, 2, 0, TAU);
      c.fill();
      c.restore();
      // shooting star
      const ss = (t % 4.6) / 4.6;
      if (ss < 0.22) {
        const sx = w * (0.82 - ss * 1.6);
        const sy = hh * (0.08 + ss * 0.4);
        c.strokeStyle = rgba(col[2], (1 - ss / 0.22) * 0.7);
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(sx + 26, sy - 8);
        c.stroke();
      }
      mist(c, w, hh, hh * 0.78, col[1], 0.06, t, 0.3, 10);
      vignette(c, w, hh, col[3], 0.4);
    },
    layers: [
      {
        count: 44, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.4 + R() * 1.1, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2 + p.phase * 2)) * 0.65;
          c.fillStyle = '#fff';
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  silent_film: (col) => ({
    count: 34,
    spawn: (w, hh) => P({
      x: R() * w, y: R() * hh, vx: (R() - 0.5) * 4, vy: (R() - 0.5) * 4,
      size: 0.5 + R() * 1.5, max: 999, depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; },
    draw: (c, p) => {
      c.globalAlpha = 0.14 + p.depth * 0.18;
      c.fillStyle = '#fff8e0';
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      const f = Math.floor(t * 16);
      c.fillStyle = mix(col[1], col[3], 0.45 + (f % 3) * 0.04);
      c.fillRect(0, 0, w, hh);
      // film grain
      for (let i = 0; i < 420; i++) {
        const gx = h(i * 3.7 + f * 0.13) * w;
        const gy = h(i * 7.1 + f * 0.21) * hh;
        c.fillStyle = (i + f) % 2 ? 'rgba(255,250,235,.14)' : 'rgba(0,0,0,.18)';
        c.fillRect(gx, gy, 1.3, 1.3);
      }
      // flicker
      const flicker = 0.03 + ((f * 7) % 5) * 0.018;
      c.fillStyle = `rgba(255,244,215,${flicker})`;
      c.fillRect(0, 0, w, hh);
      // scratches
      c.strokeStyle = rgba(col[0], 0.35);
      c.lineWidth = 0.8;
      for (let i = 0; i < 3; i++) {
        if ((f + i * 3) % 9 < 5) {
          const x = h(i * 3.1 + f * 0.05) * w;
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x + 4 + h(i + f) * 7, hh);
          c.stroke();
        }
      }
      // sprocket holes
      c.fillStyle = '#0d0905';
      for (let y = 0; y < hh; y += 16) {
        c.fillRect(3, y, 5, 9);
        c.fillRect(w - 8, y, 5, 9);
      }
      c.fillStyle = rgba(lighten(col[1], 0.35), 0.22);
      c.fillRect(8, 0, 1, hh);
      c.fillRect(w - 9, 0, 1, hh);
      // title card frame
      c.strokeStyle = rgba(col[0], 0.16);
      c.lineWidth = 1;
      c.strokeRect(w * 0.18, hh * 0.22, w * 0.64, hh * 0.4);
      c.fillStyle = rgba(col[0], 0.1);
      c.fillRect(w * 0.2, hh * 0.24, w * 0.6, hh * 0.36);
      // dust beam
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.translate(w * 0.15, 0);
      c.rotate(0.35);
      const g = c.createLinearGradient(0, 0, w * 0.5, 0);
      g.addColorStop(0, rgba(col[2], 0.1));
      g.addColorStop(1, rgba(col[2], 0));
      c.fillStyle = g;
      c.fillRect(0, -20, w * 0.6, hh * 0.8);
      c.restore();
      const vig = c.createRadialGradient(w / 2, hh / 2, Math.min(w, hh) * 0.3, w / 2, hh / 2, Math.max(w, hh) * 0.78);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, rgba(col[3], 0.82));
      c.fillStyle = vig;
      c.fillRect(0, 0, w, hh);
    },
    layers: [
      {
        count: 18, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 1 + R() * 3, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.4 + p.phase * 2)) * 0.14;
          c.fillStyle = lighten(col[2], 0.5);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  card_shower: (col) => ({
    count: 20,
    spawn: (w, hh, init) => P({
      x: R() * w * 1.2 - w * 0.1, y: init ? R() * hh : -26,
      vy: 36 + R() * 50, vx: (R() - 0.5) * 40,
      size: 6 + R() * 5, max: 9 + R() * 4, vr: (R() - 0.5) * 4,
      hue: Math.floor(R() * 4), depth: 0.35 + R() * 0.65,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 1.4 + p.phase) * 24) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const wcard = p.size * 1.45;
      const hcard = p.size * 2.1;
      c.globalAlpha = fade(p) * (0.7 + p.depth * 0.3);
      c.rotate(p.rot);
      c.scale(Math.max(0.14, Math.abs(Math.cos(t * 2.2 + p.phase))), 1);
      c.fillStyle = '#fffdf7';
      c.strokeStyle = '#2b1c2c';
      c.lineWidth = 0.8;
      c.beginPath();
      c.roundRect(-wcard / 2, -hcard / 2, wcard, hcard, 2.4);
      c.fill();
      c.stroke();
      const suits = ['♥', '♠', '♦', '♣'];
      const red = p.hue === 0 || p.hue === 2;
      c.fillStyle = red ? col[1] : '#1a1420';
      c.font = `${p.size * 1.15}px serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(suits[p.hue], 0, 0);
      c.font = `${p.size * 0.5}px serif`;
      c.textAlign = 'left';
      c.fillText(suits[p.hue], -wcard / 2 + 2, -hcard / 2 + 4);
      c.textAlign = 'right';
      c.fillText(suits[p.hue], wcard / 2 - 2, hcard / 2 - 4);
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(darken(col[1], 0.4), 0.42), A(col[3], 0.5));
      // rabbit-hole spiral
      c.save();
      c.translate(w * 0.5, hh * 0.45);
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        c.strokeStyle = rgba(C(col, i), 0.09);
        c.lineWidth = 3 + i;
        c.beginPath();
        for (let k = 0; k <= 70; k++) {
          const th = k * 0.18 - t * 0.25 + i * 0.8;
          const rr = 6 + k * (2.6 + i * 0.5);
          k ? c.lineTo(Math.cos(th) * rr, Math.sin(th) * rr * 0.8) : c.moveTo(Math.cos(th) * rr, Math.sin(th) * rr * 0.8);
        }
        c.stroke();
      }
      c.restore();
      // checkerboard floor
      const fy = hh * 0.8;
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 3; j++) {
          if ((i + j) % 2) continue;
          const x = (i / 10) * w - (j * w) / 20;
          c.fillStyle = rgba(j ? col[3] : col[0], 0.16 + j * 0.05);
          c.beginPath();
          c.moveTo(x, fy + j * hh * 0.07);
          c.lineTo(x + w / 10, fy + j * hh * 0.07);
          c.lineTo(x + w / 10 + w / 18, fy + (j + 1) * hh * 0.07);
          c.lineTo(x - w / 18, fy + (j + 1) * hh * 0.07);
          c.closePath();
          c.fill();
        }
      }
      // floating teacups
      for (let i = 0; i < 4; i++) {
        const x = w * (0.12 + i * 0.25) + Math.sin(t * 0.5 + i) * 8;
        const y = hh * (0.2 + (i % 2) * 0.18) + Math.cos(t * 0.4 + i) * 6;
        c.globalAlpha = 0.2;
        c.fillStyle = col[0];
        c.beginPath();
        c.ellipse(x, y, 8, 5, 0, 0, Math.PI);
        c.fill();
        c.beginPath();
        c.arc(x + 8, y, 3, -Math.PI / 2, Math.PI / 2);
        c.strokeStyle = col[0];
        c.lineWidth = 1;
        c.stroke();
        c.beginPath();
        c.moveTo(x - 2, y - 2);
        c.bezierCurveTo(x, y - 10, x + 4, y - 6, x + 2, y - 2);
        c.fillStyle = rgba(col[0], 0.25);
        c.fill();
        c.globalAlpha = 1;
      }
      mist(c, w, hh, hh * 0.72, col[0], 0.08, t, 0.4, 10);
      speckle(c, w, hh, t, 32, col[2], 0.4, 1.1, 113);
      vignette(c, w, hh, col[3], 0.5);
    },
    layers: [
      {
        count: 26, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.6 + R() * 1.6, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.8 + p.phase * 2)) * 0.7;
          c.fillStyle = lighten(C(col, p.hue), 0.4);
          c.shadowColor = C(col, p.hue);
          c.shadowBlur = 4;
          star4(c, p.size);
          c.fill();
        },
      },
    ],
  }),
  clocks: (col) => ({
    count: 12,
    spawn: (w, hh, init) => P({
      x: R() * w - 10, y: init ? R() * hh : -30,
      vy: 15 + R() * 26, vx: (R() - 0.5) * 14,
      size: 7 + R() * 6, max: 12 + R() * 6, vr: (R() - 0.5) * 1.4,
      depth: 0.35 + R() * 0.65,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 0.8 + p.phase) * 12) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const s = p.size;
      c.globalAlpha = fade(p) * (0.55 + p.depth * 0.45);
      c.rotate(p.rot + Math.sin(t * 0.6 + p.phase) * 0.18);
      // chain
      c.strokeStyle = rgba(col[1], 0.75);
      c.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.ellipse(0, -s - i * 4, 1.6, 2.2, 0, 0, TAU);
        c.stroke();
      }
      // case
      c.fillStyle = col[0];
      c.strokeStyle = darken(col[1], 0.2);
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(0, 0, s, 0, TAU);
      c.fill();
      c.stroke();
      c.fillStyle = '#f7f1df';
      c.beginPath();
      c.arc(0, 0, s * 0.8, 0, TAU);
      c.fill();
      // ticks
      c.strokeStyle = '#3a2a12';
      c.lineWidth = 0.7;
      for (let i = 0; i < 12; i++) {
        const a = (i * TAU) / 12;
        c.beginPath();
        c.moveTo(Math.cos(a) * s * 0.66, Math.sin(a) * s * 0.66);
        c.lineTo(Math.cos(a) * s * 0.75, Math.sin(a) * s * 0.75);
        c.stroke();
      }
      // hands
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(t * 2.2 + p.phase) * s * 0.5, Math.sin(t * 2.2 + p.phase) * s * 0.5);
      c.stroke();
      c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(t * 0.4 + p.phase) * s * 0.38, Math.sin(t * 0.4 + p.phase) * s * 0.38);
      c.stroke();
      c.fillStyle = col[1];
      c.beginPath();
      c.arc(0, 0, 1.3, 0, TAU);
      c.fill();
      // glint
      c.globalAlpha *= 0.5;
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(-s * 0.3, -s * 0.42, s * 0.09, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.4), A(mix(col[3], col[1], 0.2), 0.16));
      // giant clock ring
      c.save();
      c.translate(w * 0.5, hh * 0.4);
      c.rotate(-t * 0.05);
      c.strokeStyle = rgba(col[0], 0.12);
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, Math.min(w, hh) * 0.36, 0, TAU);
      c.stroke();
      for (let i = 0; i < 24; i++) {
        const a = (i * TAU) / 24;
        c.beginPath();
        c.moveTo(Math.cos(a) * Math.min(w, hh) * 0.32, Math.sin(a) * Math.min(w, hh) * 0.32);
        c.lineTo(Math.cos(a) * Math.min(w, hh) * 0.36, Math.sin(a) * Math.min(w, hh) * 0.36);
        c.stroke();
      }
      c.restore();
      // gears
      for (let g = 0; g < 3; g++) {
        const gx = w * (0.2 + g * 0.3);
        const gy = hh * (0.7 + (g % 2) * 0.1);
        const gr = 12 + g * 6;
        c.save();
        c.translate(gx, gy);
        c.rotate(t * (0.2 + g * 0.07) * (g % 2 ? -1 : 1));
        c.strokeStyle = rgba(col[1], 0.28);
        c.lineWidth = 1.4;
        c.beginPath();
        c.arc(0, 0, gr, 0, TAU);
        c.stroke();
        for (let i = 0; i < 10; i++) {
          const a = (i * TAU) / 10;
          c.beginPath();
          c.moveTo(Math.cos(a) * gr, Math.sin(a) * gr);
          c.lineTo(Math.cos(a) * (gr + 4), Math.sin(a) * (gr + 4));
          c.stroke();
        }
        c.restore();
      }
      // tea steam
      c.save();
      c.strokeStyle = rgba(col[0], 0.12);
      c.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        for (let y = hh * 0.92; y > hh * 0.5; y -= 6) {
          const x = w * (0.24 + i * 0.26) + Math.sin(y * 0.05 + t * 1.2 + i) * 8;
          c.lineTo(x, y);
        }
        c.stroke();
      }
      c.restore();
      speckle(c, w, hh, t, 30, col[2], 0.3, 1, 127);
      vignette(c, w, hh, col[3], 0.46);
    },
    layers: [
      {
        count: 26, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.5 + R() * 1.5, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.6 + p.phase * 2)) * 0.65;
          c.fillStyle = lighten(col[0], 0.5);
          c.shadowColor = col[0];
          c.shadowBlur = 4;
          star4(c, p.size);
          c.fill();
        },
      },
    ],
  }),

  emerald_glow: (col) => ({
    count: 38, additive: true,
    spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.8 + R() * 2.6, max: 2 + R() * 4, hue: Math.floor(R() * 3) }),
    draw: (c, p, t) => {
      const a = Math.max(0, Math.sin((p.life / p.max) * Math.PI));
      c.globalAlpha = a;
      c.rotate(t * 0.6 + p.phase);
      c.fillStyle = lighten(C(col, p.hue), 0.4);
      c.shadowColor = C(col, p.hue);
      c.shadowBlur = 10;
      if (p.hue === 1) { diamond(c, p.size * 1.2); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 0.5; c.stroke(); }
      else { star4(c, p.size); c.fill(); }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.4), A(mix(col[3], col[1], 0.32), 0.2));
      bloom(c, w * 0.5, hh * 0.2, w * 0.7, col[0], 0.24);
      // emerald city towers
      for (let i = 0; i < 11; i++) {
        const x = w * (0.04 + i * 0.09);
        const bh = hh * (0.16 + h(i * 3.1) * 0.34);
        const bw = 9 + h(i * 5.7) * 9;
        c.fillStyle = A(mix(col[1], col[3], 0.22 + h(i) * 0.2), 0.85);
        c.beginPath();
        c.moveTo(x, hh * 0.82);
        c.lineTo(x, hh * 0.82 - bh);
        c.lineTo(x + bw / 2, hh * 0.82 - bh - hh * 0.05);
        c.lineTo(x + bw, hh * 0.82 - bh);
        c.lineTo(x + bw, hh * 0.82);
        c.closePath();
        c.fill();
        c.fillStyle = rgba(lighten(col[0], 0.4), 0.55);
        for (let wy = hh * 0.82 - bh + 6; wy < hh * 0.8; wy += 7) {
          for (let wx = x + 2; wx < x + bw - 2; wx += 5) {
            if (h(wx * 1.7 + wy) > 0.55) c.fillRect(wx, wy, 1.8, 2.5);
          }
        }
      }
      // yellow brick road
      c.fillStyle = A(col[0], 0.2);
      c.beginPath();
      c.moveTo(w * 0.44, hh * 0.82);
      c.lineTo(w * 0.56, hh * 0.82);
      c.lineTo(w * 0.76, hh);
      c.lineTo(w * 0.24, hh);
      c.closePath();
      c.fill();
      c.strokeStyle = rgba(col[0], 0.35);
      c.lineWidth = 0.8;
      for (let i = 0; i < 7; i++) {
        c.beginPath();
        const y = hh * (0.83 + i * 0.026);
        c.moveTo(w * (0.44 - i * 0.028), y);
        c.lineTo(w * (0.56 + i * 0.028), y);
        c.stroke();
      }
      // poppies
      for (let i = 0; i < 14; i++) {
        const x = h(i * 2.3) * w;
        const y = hh * (0.86 + h(i * 5.9) * 0.12);
        c.fillStyle = rgba(C(col, i), 0.42);
        c.beginPath();
        c.arc(x, y, 1.5 + h(i) * 1.5, 0, TAU);
        c.fill();
      }
      starfield(c, w, hh * 0.7, t, 30, col[2], 0.5);
      mist(c, w, hh, hh * 0.8, col[0], 0.08, t, 0.3, 8);
      vignette(c, w, hh, col[3], 0.4);
    },
    layers: [
      {
        count: 22,
        spawn: (w, hh, init) => P({ x: R() * w, y: init ? R() * hh : -14, vy: 16 + R() * 30, size: 3 + R() * 5, max: 8 + R() * 5, vx: (R() - 0.5) * 16, k: Math.floor(R() * 2) }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += (p.vx + Math.sin(t * 1.3 + p.phase) * 14) * dt; p.rot += p.vr * dt; },
        draw: (c, p, t) => {
          c.globalAlpha = fade(p) * 0.5;
          c.rotate(p.rot);
          c.fillStyle = p.k ? lighten(col[0], 0.3) : col[1];
          c.shadowColor = col[0];
          c.shadowBlur = 6;
          if (p.k) { diamond(c, p.size); c.fill(); }
          else { c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); }
          void t;
        },
      },
    ],
  }),

  lab_lightning: (col) => ({
    count: 36, additive: true,
    spawn: (w, hh) => P({ x: w * (0.2 + R() * 0.6), y: hh * (0.25 + R() * 0.6), size: 0.6 + R() * 1.8, max: 0.8 + R() * 1.4, vx: (R() - 0.5) * 90, vy: (R() - 0.5) * 90 }),
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; },
    draw: (c, p) => {
      c.globalAlpha = fade(p);
      c.fillStyle = lighten(col[0], 0.6);
      c.shadowColor = col[1];
      c.shadowBlur = 7;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.55), A(mix(col[3], col[0], 0.2), 0.24));
      bloom(c, w * 0.5, hh * 0.62, w * 0.6, col[1], 0.16);
      // apparatus frame
      c.strokeStyle = rgba(col[2], 0.28);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(w * 0.12, hh * 0.88);
      c.lineTo(w * 0.12, hh * 0.2);
      c.lineTo(w * 0.88, hh * 0.2);
      c.lineTo(w * 0.88, hh * 0.88);
      c.stroke();
      // electrodes
      for (const x of [w * 0.28, w * 0.72]) {
        c.fillStyle = rgba(col[2], 0.5);
        c.fillRect(x - 3, hh * 0.24, 6, hh * 0.2);
        c.beginPath();
        c.arc(x, hh * 0.24, 6, 0, TAU);
        c.fill();
      }
      // lightning between electrodes
      const seed = Math.floor(t * 6);
      if (seed % 3 !== 0) {
        bolt(c, w * 0.28, hh * 0.26, w * 0.72, hh * 0.26, seed, col[2], 1.8);
        c.save();
        c.globalCompositeOperation = 'lighter';
        const g = c.createLinearGradient(w * 0.28, 0, w * 0.72, 0);
        g.addColorStop(0, rgba(col[1], 0));
        g.addColorStop(0.5, rgba(col[2], 0.18));
        g.addColorStop(1, rgba(col[1], 0));
        c.fillStyle = g;
        c.fillRect(w * 0.28, hh * 0.2, w * 0.44, hh * 0.14);
        c.restore();
      }
      // bubbling flasks
      for (let i = 0; i < 3; i++) {
        const x = w * (0.2 + i * 0.3);
        const y = hh * 0.78;
        c.strokeStyle = rgba(col[0], 0.4);
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(x - 8, y);
        c.lineTo(x - 5, y - 16);
        c.lineTo(x + 5, y - 16);
        c.lineTo(x + 8, y);
        c.closePath();
        c.stroke();
        c.fillStyle = rgba(col[1], 0.4);
        c.fillRect(x - 6, y - 10, 12, 9);
        for (let b = 0; b < 4; b++) {
          const by = y - 4 - ((t * 16 + b * 5 + i * 7) % 18);
          c.fillStyle = rgba(lighten(col[1], 0.5), 0.5);
          c.beginPath();
          c.arc(x - 3 + b * 2, by, 1 + (b % 2) * 0.6, 0, TAU);
          c.fill();
        }
      }
      // capacitors / coils
      for (let i = 0; i < 5; i++) {
        c.fillStyle = rgba(col[0], 0.3);
        c.fillRect(w * (0.15 + i * 0.15), hh * 0.88, 10, 2);
      }
      speckle(c, w, hh, t, 40, col[0], 0.35, 1.2, 137);
      vignette(c, w, hh, col[3], 0.5);
    },
    layers: [
      {
        count: 18, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: hh * 0.3 + R() * hh * 0.5, size: 1 + R() * 2.6, max: 0.5 + R() * 0.8 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 5 + p.phase * 3)) * 0.65;
          c.strokeStyle = col[2];
          c.lineWidth = 0.9;
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo((hash(p.phase) - 0.5) * 14, (hash(p.phase + 1) - 0.5) * 14);
          c.stroke();
        },
      },
    ],
  }),

  raven_feathers: (col) => ({
    count: 16,
    spawn: (w, hh, init) => P({
      x: R() * w * 1.3 - w * 0.15, y: init ? R() * hh : -20,
      vx: -8 - R() * 18, vy: 12 + R() * 20,
      size: 6 + R() * 9, vr: (R() - 0.5) * 1.8, max: 12 + R() * 6,
      hue: Math.floor(R() * 2), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 0.9 + p.phase) * 24) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * (0.55 + p.depth * 0.45);
      c.rotate(p.rot + Math.sin(t * 1.1 + p.phase) * 0.2);
      const g = c.createLinearGradient(0, -p.size, 0, p.size);
      g.addColorStop(0, p.hue ? col[0] : col[1]);
      g.addColorStop(0.55, p.hue ? darken(col[0], 0.45) : darken(col[1], 0.35));
      g.addColorStop(1, col[3]);
      c.fillStyle = g;
      c.shadowColor = col[0];
      c.shadowBlur = 5;
      feather(c, p.size);
      c.fill();
      c.globalAlpha *= 0.4;
      c.strokeStyle = rgba(lighten(col[0], 0.35), 0.8);
      c.lineWidth = 0.6;
      c.beginPath();
      c.moveTo(0, p.size * 0.9);
      c.lineTo(0, -p.size * 1.1);
      for (let i = 1; i < 7; i++) {
        const y = p.size * (0.85 - i * 0.28);
        c.moveTo(0, y);
        c.lineTo((i % 2 ? 1 : -1) * p.size * 0.32, y - p.size * 0.16);
      }
      c.stroke();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.55), A(mix(col[3], col[0], 0.18), 0.2));
      bloom(c, w * 0.24, hh * 0.2, w * 0.5, col[0], 0.18);
      c.globalAlpha = 0.8;
      crescent(c, w * 0.24, hh * 0.2, Math.min(w, hh) * 0.1, A(lighten(col[0], 0.35), 0.9));
      c.globalAlpha = 1;
      // raven silhouette on a branch
      c.save();
      c.translate(w * 0.58, hh * 0.52);
      c.fillStyle = '#07060a';
      c.beginPath();
      c.ellipse(0, 0, 17, 10, -0.25, 0, TAU);
      c.fill();
      c.beginPath();
      c.arc(-14, -8, 6, 0, TAU);
      c.fill();
      c.beginPath();
      c.moveTo(-20, -8);
      c.lineTo(-29, -5);
      c.lineTo(-20, -3);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(10, -2);
      c.quadraticCurveTo(30, -14, 40, 2);
      c.quadraticCurveTo(26, 1, 12, 6);
      c.closePath();
      c.fill();
      c.fillStyle = col[1];
      c.beginPath();
      c.arc(-16, -9, 1, 0, TAU);
      c.fill();
      c.restore();
      // branch
      c.strokeStyle = '#0a0708';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(w * 0.3, hh * 0.62);
      c.quadraticCurveTo(w * 0.48, hh * 0.56, w * 0.76, hh * 0.58);
      c.stroke();
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(w * 0.45, hh * 0.58);
      c.lineTo(w * 0.5, hh * 0.52);
      c.moveTo(w * 0.64, hh * 0.575);
      c.lineTo(w * 0.67, hh * 0.52);
      c.stroke();
      mist(c, w, hh, hh * 0.66, col[1], 0.1, t, 0.24, 16);
      starfield(c, w, hh * 0.55, t, 28, col[0], 0.45);
      vignette(c, w, hh, col[3], 0.58);
    },
    layers: [
      {
        count: 30,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.4 + R() * 1.2, max: 3 + R() * 5 }),
        step: (p, dt, t) => { p.y -= 3 * dt; p.x += Math.sin(t * 0.3 + p.phase) * 3 * dt; },
        draw: (c, p) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.3;
          c.fillStyle = col[1];
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  scream_swirl: (col) => ({
    count: 22, additive: true,
    spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.8 + R() * 2, max: 3 + R() * 4, hue: Math.floor(R() * 3) }),
    step: (p, dt, t) => {
      p.x += Math.sin(t * 0.7 + p.phase) * 10 * dt;
      p.y += Math.cos(t * 0.5 + p.phase) * 7 * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.55;
      c.fillStyle = lighten(C(col, p.hue), 0.4);
      c.shadowColor = C(col, p.hue);
      c.shadowBlur = 7;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
      void t;
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[0], col[2], 0.3), 0.4), A(col[3], 0.42));
      // swirling bands
      c.save();
      for (let i = 0; i < 11; i++) {
        c.beginPath();
        for (let x = -20; x <= w + 20; x += 7) {
          const y = hh * (0.02 + i * 0.055)
            + Math.sin(x / (30 + i * 2) + t * (0.8 + i * 0.03) + i * 0.7) * (9 + i * 1.4)
            + Math.sin(x / 15 - t * 0.6 + i) * 4;
          x === -20 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.strokeStyle = [col[0], col[1], col[2], col[3]][i % 4];
        c.globalAlpha = 0.26;
        c.lineWidth = 7 - (i % 3) * 1.5;
        c.stroke();
      }
      c.restore();
      // bridge railing
      c.strokeStyle = rgba(darken(col[3], 0.4), 0.9);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, hh * 0.82);
      c.lineTo(w, hh * 0.62);
      c.moveTo(0, hh * 0.88);
      c.lineTo(w, hh * 0.68);
      c.stroke();
      for (let i = 0; i < 9; i++) {
        c.beginPath();
        c.moveTo(w * (i / 9), hh * (0.82 - i * 0.022));
        c.lineTo(w * (i / 9), hh * (0.88 - i * 0.022));
        c.stroke();
      }
      // screaming figure
      c.save();
      c.translate(w * 0.38, hh * 0.7);
      c.fillStyle = '#161a2c';
      c.beginPath();
      c.ellipse(0, -6, 6, 8, 0.1, 0, TAU);
      c.fill();
      c.beginPath();
      c.moveTo(-6, 2);
      c.quadraticCurveTo(-12, 22, -8, 38);
      c.lineTo(8, 38);
      c.quadraticCurveTo(12, 20, 6, 2);
      c.closePath();
      c.fill();
      // hands to cheeks
      c.strokeStyle = '#161a2c';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-5, 6);
      c.lineTo(-10, -6);
      c.moveTo(5, 6);
      c.lineTo(10, -6);
      c.stroke();
      // mouth
      c.fillStyle = '#0a0a12';
      c.beginPath();
      c.ellipse(0, 0, 1.7, 3, 0, 0, TAU);
      c.fill();
      c.restore();
      // water reflection
      c.fillStyle = rgba(col[3], 0.5);
      c.fillRect(0, hh * 0.88, w, hh * 0.12);
      for (let i = 0; i < 6; i++) {
        c.strokeStyle = rgba(C(col, i), 0.2);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, hh * (0.9 + i * 0.015));
        c.lineTo(w, hh * (0.9 + i * 0.015) + Math.sin(t + i) * 2);
        c.stroke();
      }
      vignette(c, w, hh, col[3], 0.42);
    },
    layers: [
      {
        count: 34, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh * 0.7, size: 0.4 + R() * 1.2, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.5 + p.phase * 2)) * 0.55;
          c.fillStyle = lighten(col[2], 0.5);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),
  // ---- New wave ---------------------------------------------------------------
  constellation: (col) => ({
    count: 34, additive: true,
    spawn: (w, hh) => P({
      x: R() * w, y: R() * hh * 0.86,
      size: 0.9 + R() * 2.4, max: 3 + R() * 5,
      hue: Math.floor(R() * 3), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.x += Math.sin(t * 0.24 + p.phase) * 2 * dt;
      p.y += Math.cos(t * 0.19 + p.phase) * 2 * dt;
      p.rot += dt * 0.3;
    },
    draw: (c, p, t) => {
      const a = Math.max(0, Math.sin((p.life / p.max) * Math.PI));
      const tw = 0.55 + Math.abs(Math.sin(t * (1.1 + p.depth) + p.phase)) * 0.45;
      const cc = C(col, p.hue);
      c.globalAlpha = a * tw;
      c.fillStyle = lighten(cc, 0.5);
      c.shadowColor = cc;
      c.shadowBlur = 10;
      c.rotate(p.rot + Math.PI / 4);
      star4(c, p.size * (0.5 + tw * 0.7));
      c.fill();
      c.globalAlpha *= 0.28;
      c.beginPath();
      c.arc(0, 0, p.size * 2.6, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.62), A(mix(col[3], col[1], 0.2), 0.16));
      starfield(c, w, hh, t, 110, col[0], 0.85);
      bloom(c, w * 0.26, hh * 0.24, w * 0.5, col[1], 0.12);
      bloom(c, w * 0.78, hh * 0.62, w * 0.45, col[0], 0.1);
      // three wheeling constellation beasts
      const figures = [
        { x: 0.22, y: 0.26, r: 0.16, n: 8, hue: 0 },
        { x: 0.6, y: 0.18, r: 0.13, n: 7, hue: 1 },
        { x: 0.78, y: 0.52, r: 0.14, n: 9, hue: 2 },
      ];
      for (const [f, fig] of figures.entries()) {
        const spin = t * 0.035 * (f % 2 ? -1 : 1) + f;
        const pts: [number, number][] = [];
        for (let i = 0; i < fig.n; i++) {
          const ang = spin + (i / fig.n) * TAU + h(f * 9 + i * 3.1) * 0.5;
          const rr = Math.min(w, hh) * fig.r * (0.45 + h(f * 7 + i * 5.7) * 0.9);
          pts.push([w * fig.x + Math.cos(ang) * rr, hh * fig.y + Math.sin(ang) * rr * 0.78]);
        }
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = rgba(C(col, fig.hue), 0.26);
        c.lineWidth = 0.9;
        c.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const [x, y] = pts[i];
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
        for (let i = 0; i < pts.length; i++) {
          const [x, y] = pts[i];
          const tw = 0.55 + Math.abs(Math.sin(t * 0.8 + i + f)) * 0.45;
          c.globalAlpha = tw;
          c.fillStyle = i % 3 ? '#ffffff' : lighten(col[0], 0.4);
          c.shadowColor = C(col, fig.hue);
          c.shadowBlur = 9;
          c.beginPath();
          c.arc(x, y, 1.1 + h(i + f * 3) * 1.5, 0, TAU);
          c.fill();
        }
        c.restore();
      }
      // zodiac dial
      c.save();
      c.translate(w * 0.5, hh * 0.5);
      c.rotate(-t * 0.04);
      c.strokeStyle = rgba(col[0], 0.12);
      c.lineWidth = 1;
      c.setLineDash([3, 9]);
      c.beginPath();
      c.arc(0, 0, Math.min(w, hh) * 0.44, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      for (let i = 0; i < 12; i++) {
        c.rotate(TAU / 12);
        c.fillStyle = rgba(C(col, i % 3), 0.28);
        diamond(c, 3.2);
        c.fill();
      }
      c.restore();
      // shooting star
      const ss = (t % 6.4) / 6.4;
      if (ss < 0.18) {
        const x = w * (0.92 - ss * 2.4), y = hh * (0.06 + ss * 0.6);
        c.strokeStyle = rgba(col[2], (1 - ss / 0.18) * 0.8);
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 30, y - 10);
        c.stroke();
      }
      vignette(c, w, hh, col[3], 0.48);
    },
    layers: [
      {
        count: 46, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.4 + R() * 1.2, max: 2 + R() * 4 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.8 + p.phase * 2)) * 0.6;
          c.fillStyle = lighten(col[1], 0.6);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  supernova: (col) => ({
    count: 54, additive: true,
    spawn: (w, hh) => {
      const ang = R() * TAU;
      return P({
        x: w * 0.5, y: hh * 0.44,
        vx: Math.cos(ang) * (10 + R() * 60), vy: Math.sin(ang) * (8 + R() * 52),
        size: 1 + R() * 2.8, max: 1.6 + R() * 2.6,
        hue: Math.floor(R() * 3), rot: ang,
      });
    },
    step: (p, dt) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 + dt * 0.55;
      p.vy *= 1 + dt * 0.55;
    },
    draw: (c, p) => {
      const a = fade(p);
      const cc = C(col, p.hue);
      const sp = Math.hypot(p.vx, p.vy) * 0.09;
      const g = c.createLinearGradient(0, 0, -Math.cos(p.rot) * sp * 8, -Math.sin(p.rot) * sp * 8);
      g.addColorStop(0, lighten(cc, 0.7));
      g.addColorStop(0.4, cc);
      g.addColorStop(1, rgba(cc, 0));
      c.globalAlpha = a;
      c.strokeStyle = g;
      c.lineWidth = p.size;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-Math.cos(p.rot) * sp * 8, -Math.sin(p.rot) * sp * 8);
      c.stroke();
      c.fillStyle = lighten(cc, 0.5);
      c.shadowColor = cc;
      c.shadowBlur = 12;
      c.beginPath();
      c.arc(0, 0, p.size * 0.8, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.72), A(mix(col[3], col[1], 0.16), 0.14));
      starfield(c, w, hh, t, 96, col[2], 0.8);
      const cx = w * 0.5, cy = hh * 0.44;
      // nebular shell
      for (let i = 0; i < 6; i++) {
        bloom(c, cx + Math.sin(t * 0.2 + i * 2) * w * 0.16, cy + Math.cos(t * 0.17 + i) * hh * 0.14, Math.min(w, hh) * (0.18 + i * 0.05), C(col, i % 3), 0.13);
      }
      // expanding shock rings
      for (let i = 0; i < 4; i++) {
        const k = ((t * 0.22 + i / 4) % 1);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = rgba(C(col, i % 3), (1 - k) * 0.35);
        c.lineWidth = 1 + (1 - k) * 2.4;
        c.beginPath();
        c.arc(cx, cy, k * Math.max(w, hh) * 0.62, 0, TAU);
        c.stroke();
        c.restore();
      }
      // accretion ribbons
      c.save();
      c.translate(cx, cy);
      c.globalCompositeOperation = 'lighter';
      for (let r = 0; r < 5; r++) {
        c.beginPath();
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * TAU * 2 + t * (0.3 + r * 0.05) + r;
          const rr = Math.min(w, hh) * (0.05 + (i / 60) * 0.34);
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.62;
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.strokeStyle = rgba(C(col, r), 0.14);
        c.lineWidth = 2 + (r % 2);
        c.stroke();
      }
      c.restore();
      // blazing core
      const pulse = 1 + Math.sin(t * 3.4) * 0.12 + Math.sin(t * 11) * 0.03;
      bloom(c, cx, cy, Math.min(w, hh) * 0.3 * pulse, col[2], 0.7);
      c.fillStyle = lighten(col[2], 0.75);
      c.beginPath();
      c.arc(cx, cy, Math.min(w, hh) * 0.055 * pulse, 0, TAU);
      c.fill();
      // rays
      c.save();
      c.translate(cx, cy);
      c.rotate(t * 0.16);
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        c.rotate(TAU / 18);
        const len = Math.max(w, hh) * (0.3 + h(i * 3.3) * 0.34) * (0.9 + Math.sin(t * 1.6 + i) * 0.1);
        const g = c.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, rgba(col[2], 0.3));
        g.addColorStop(0.5, rgba(col[0], 0.1));
        g.addColorStop(1, rgba(col[0], 0));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(len, -4);
        c.lineTo(len, 4);
        c.closePath();
        c.fill();
      }
      c.restore();
      // foreground debris
      for (let i = 0; i < 24; i++) {
        const a = h(i * 4.7) * TAU + t * 0.05;
        const rr = Math.min(w, hh) * (0.45 + h(i * 2.9) * 0.5);
        c.fillStyle = rgba(C(col, i % 3), 0.2);
        c.beginPath();
        c.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, 0.8 + h(i * 6.1) * 1.4, 0, TAU);
        c.fill();
      }
      vignette(c, w, hh, col[3], 0.5);
    },
    layers: [
      {
        count: 30, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.4 + R() * 1.3, max: 1 + R() * 2 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 3 + p.phase * 2)) * 0.8;
          c.fillStyle = '#ffffff';
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  blizzard: (col) => ({
    count: 116,
    spawn: (w, hh, init) => P({
      x: R() * (w + 140) - 40, y: init ? R() * hh : -24,
      vx: -60 - R() * 130, vy: 120 + R() * 210,
      size: 0.6 + R() * 2.6, max: 3 + R() * 3,
      depth: 0.35 + R() * 0.65, k: R() < 0.3 ? 1 : 0,
    }),
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t * 2.2 + p.phase) * 28) * dt;
      p.y += p.vy * dt;
      p.rot += dt * 2;
    },
    draw: (c, p) => {
      c.globalAlpha = 0.3 + p.depth * 0.55;
      c.strokeStyle = lighten(col[0], 0.5);
      c.lineWidth = Math.max(0.5, p.size * 0.5);
      c.lineCap = 'round';
      const len = 8 + p.size * 5;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-len * 0.55, len);
      c.stroke();
      if (p.k === 1) {
        c.save();
        c.rotate(p.rot);
        snowflake(c, p.size * 1.7);
        c.strokeStyle = '#ffffff';
        c.lineWidth = 0.5;
        c.stroke();
        c.restore();
      }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[0], 0.3), 0.55), A(mix(col[3], col[1], 0.25), 0.3));
      bloom(c, w * 0.6, hh * 0.24, w * 0.65, col[0], 0.2);
      // whiteout gust bands
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const y = hh * (0.1 + i * 0.12) + Math.sin(t * 0.8 + i) * 8;
        const x = ((t * (60 + i * 18) + i * 90) % (w + 300)) - 150;
        const len = w * (0.3 + h(i * 3.1) * 0.45);
        const g = c.createLinearGradient(x, y, x + len, y);
        g.addColorStop(0, rgba(col[2], 0));
        g.addColorStop(0.5, rgba(col[2], 0.16));
        g.addColorStop(1, rgba(col[2], 0));
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(x + len / 2, y, len / 2, 5 + i, 0, 0, TAU);
        c.fill();
      }
      c.restore();
      ridge(c, w, hh, hh * 0.72, 26, A(mix(col[1], col[3], 0.45), 0.55), 4.2, t);
      ridge(c, w, hh, hh * 0.84, 16, A(mix(col[0], col[3], 0.5), 0.7), 1.7, t);
      ridge(c, w, hh, hh * 0.94, 9, A(mix(col[0], col[3], 0.7), 0.85), 7.9, t);
      // dead pines
      c.save();
      c.strokeStyle = A(darken(col[3], 0.3), 0.75);
      for (let i = 0; i < 7; i++) {
        const x = w * (0.03 + i * 0.16) + Math.sin(i * 9.1) * 12;
        const bh = hh * (0.16 + h(i * 3.7) * 0.22);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x, hh * (0.9 - h(i) * 0.06));
        c.lineTo(x, hh * 0.9 - bh);
        c.stroke();
        c.lineWidth = 1;
        for (let k = 1; k < 5; k++) {
          const y = hh * 0.9 - bh * (k / 5);
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x - bh * 0.18, y + bh * 0.1);
          c.moveTo(x, y);
          c.lineTo(x + bh * 0.16, y + bh * 0.08);
          c.stroke();
        }
      }
      c.restore();
      mist(c, w, hh, hh * 0.7, col[2], 0.22, t, 0.7, 20);
      mist(c, w, hh, hh * 0.86, col[0], 0.18, t, -0.5, 14);
      speckle(c, w, hh, t, 40, col[2], 0.5, 1.4, 151);
      vignette(c, w, hh, col[3], 0.4);
    },
    layers: [
      {
        count: 34, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.4 + R() * 1.4, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.3 + p.phase * 2)) * 0.7;
          c.fillStyle = '#ffffff';
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
      {
        count: 22,
        spawn: (w, hh, init) => P({ x: R() * (w + 60) - 20, y: init ? R() * hh : -10, vx: -90 - R() * 90, vy: 180 + R() * 200, size: 0.5 + R() * 1, max: 3 + R() * 2 }),
        step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; },
        draw: (c, p) => {
          c.globalAlpha = 0.5;
          c.fillStyle = '#fff';
          c.fillRect(-1, 0, 2, 10 + p.size * 4);
        },
      },
    ],
  }),

  inferno: (col) => ({
    count: 46, additive: true,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? hh * (0.45 + R() * 0.6) : hh + 16,
      vx: (R() - 0.5) * 22, vy: -(26 + R() * 70),
      size: 2 + R() * 5, max: 1.6 + R() * 2.6,
      hue: Math.floor(R() * 3), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 2.4 + p.phase) * 26) * dt;
    },
    draw: (c, p, t) => {
      const a = fade(p);
      const cc = C(col, p.hue);
      c.globalAlpha = a * 0.9;
      glow(c, p.size * 3.6, cc, 0.35);
      c.fillStyle = lighten(cc, 0.45);
      c.shadowColor = cc;
      c.shadowBlur = 12;
      c.rotate(Math.sin(t * 3 + p.phase) * 0.6);
      c.beginPath();
      c.moveTo(0, -p.size * 1.8);
      c.quadraticCurveTo(p.size * 1.3, -p.size * 0.3, p.size * 0.4, p.size * 1.2);
      c.quadraticCurveTo(0, p.size * 0.4, -p.size * 0.6, p.size * 1.1);
      c.quadraticCurveTo(-p.size * 1.1, -p.size * 0.2, 0, -p.size * 1.8);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.5), A(mix(col[3], col[1], 0.35), 0.3));
      // smoke column
      for (let i = 0; i < 12; i++) {
        const x = h(i * 3.9) * w + Math.sin(t * 0.3 + i) * w * 0.06;
        const y = hh * (0.8 - ((t * (5 + h(i) * 6) + h(i * 8.7) * 200) % 200) / 200 * 0.7);
        c.globalAlpha = 0.13;
        c.save();
        c.translate(x, y);
        puff(c, 40 + h(i * 2.1) * 44, i * 13.7, A(mix(col[3], col[1], 0.3), 0.7));
        puff(c, 26 + h(i * 5.3) * 30, i * 7.1, A(darken(col[3], 0.1), 0.5));
        c.restore();
      }
      c.globalAlpha = 1;
      // burning floor glow
      bloom(c, w * 0.5, hh * 1.06, w * 0.8, col[1], 0.55);
      bloom(c, w * 0.2, hh * 1.06, w * 0.4, col[0], 0.4);
      // fire wall silhouettes
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 16; i++) {
        const x = w * (0.02 + i * 0.065) + Math.sin(t * 1.4 + i * 2.1) * 8;
        const fh = hh * (0.1 + h(i * 4.3) * 0.36) * (0.8 + Math.sin(t * 3 + i) * 0.2);
        const g = c.createLinearGradient(0, hh, 0, hh - fh);
        g.addColorStop(0, rgba(col[1], 0.5));
        g.addColorStop(0.45, rgba(col[0], 0.32));
        g.addColorStop(1, rgba(col[2], 0));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x - 14, hh);
        c.quadraticCurveTo(x - 8, hh - fh * 0.6, x + Math.sin(t * 2 + i) * 5, hh - fh);
        c.quadraticCurveTo(x + 10, hh - fh * 0.5, x + 14, hh);
        c.closePath();
        c.fill();
      }
      c.restore();
      // charred trees
      c.strokeStyle = '#0c0503';
      c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const x = w * (0.14 + i * 0.34);
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(x, hh * 0.86);
        c.quadraticCurveTo(x - 6, hh * 0.6, x + 4, hh * 0.4);
        c.stroke();
        c.lineWidth = 1.6;
        for (let k = 0; k < 3; k++) {
          c.beginPath();
          c.moveTo(x + 2, hh * (0.62 - k * 0.08));
          c.lineTo(x + (k % 2 ? 18 : -16), hh * (0.54 - k * 0.07));
          c.stroke();
        }
      }
      speckle(c, w, hh, t, 46, col[0], 0.55, 1.3, 173);
      vignette(c, w, hh, col[3], 0.55);
    },
    layers: [
      {
        count: 26,
        spawn: (w, hh) => P({ x: R() * w, y: hh * (0.55 + R() * 0.4), size: 0.6 + R() * 1.8, max: 3 + R() * 4, vy: -(14 + R() * 30) }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 1.7 + p.phase) * 12 * dt; },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.6;
          c.fillStyle = lighten(col[0], 0.5);
          c.shadowColor = col[0];
          c.shadowBlur = 7;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
          void t;
        },
      },
    ],
  }),

  tide: (col) => ({
    count: 48,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? hh * (0.55 + R() * 0.4) : hh * (0.7 + R() * 0.3),
      vx: (R() - 0.5) * 30, vy: -(20 + R() * 55),
      size: 0.8 + R() * 2.4, max: 1.4 + R() * 2,
      hue: Math.floor(R() * 2),
    }),
    step: (p, dt) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 70 * dt; },
    draw: (c, p) => {
      c.globalAlpha = fade(p);
      c.fillStyle = p.hue ? col[0] : col[2];
      c.shadowColor = col[0];
      c.shadowBlur = 5;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[1], 0.4), 0.4), A(mix(col[3], col[1], 0.2), 0.34));
      // moon and reflection path
      const mx = w * 0.68, my = hh * 0.2, mr = Math.min(w, hh) * 0.09;
      bloom(c, mx, my, mr * 4, col[0], 0.3);
      c.fillStyle = lighten(col[0], 0.6);
      c.beginPath();
      c.arc(mx, my, mr, 0, TAU);
      c.fill();
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 16; i++) {
        const y = hh * (0.36 + i * 0.04);
        const spread = (i / 16) * w * 0.2 + 6;
        c.fillStyle = rgba(col[0], 0.1 + (1 - i / 16) * 0.16);
        c.fillRect(mx - spread + Math.sin(t * 1.4 + i) * 6, y, spread * 2, 1.4);
      }
      c.restore();
      starfield(c, w, hh * 0.45, t, 40, col[0], 0.6);
      // layered sea
      for (let L = 0; L < 4; L++) {
        const base = hh * (0.56 + L * 0.1);
        c.beginPath();
        c.moveTo(0, hh);
        c.lineTo(0, base);
        for (let x = 0; x <= w + 8; x += 8) {
          const y = base
            + Math.sin(x / (30 + L * 9) + t * (1.2 - L * 0.16) + L) * (6 - L)
            + Math.sin(x / 12 - t * 0.7) * 2;
          c.lineTo(x, y);
        }
        c.lineTo(w, hh);
        c.closePath();
        const g = c.createLinearGradient(0, base - 10, 0, hh);
        g.addColorStop(0, rgba(lighten(col[1], 0.3 + L * 0.1), 0.45 + L * 0.1));
        g.addColorStop(1, rgba(darken(col[3], 0.1), 0.7));
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = rgba(col[0], 0.35 - L * 0.05);
        c.lineWidth = 1;
        c.stroke();
        // foam
        if (L < 2) {
          for (let i = 0; i < 18; i++) {
            const x = ((i / 18) * w + t * 8 * (L + 1)) % w;
            const y = base + Math.sin(x / (30 + L * 9) + t * (1.2 - L * 0.16) + L) * (6 - L);
            c.fillStyle = rgba(col[2], 0.5 - L * 0.12);
            c.beginPath();
            c.arc(x, y, 1 + (i % 3), 0, TAU);
            c.fill();
          }
        }
      }
      // drifting gulls
      for (let i = 0; i < 3; i++) {
        const x = ((t * (14 + i * 6) + i * 90) % (w + 80)) - 40;
        const y = hh * (0.12 + i * 0.07) + Math.sin(t + i) * 4;
        c.strokeStyle = rgba(col[2], 0.5);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x - 5, y);
        c.quadraticCurveTo(x - 2, y - 3, x, y);
        c.quadraticCurveTo(x + 2, y - 3, x + 5, y);
        c.stroke();
      }
      mist(c, w, hh, hh * 0.58, col[0], 0.08, t, 0.5, 8);
      speckle(c, w, hh, t, 24, col[2], 0.3, 1, 181);
      vignette(c, w, hh, col[3], 0.4);
    },
    layers: [
      {
        count: 36, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh * 0.9, size: 0.6 + R() * 1.8, max: 3 + R() * 5, hue: Math.floor(R() * 2) }),
        step: (p, dt, t) => { p.y += Math.sin(t * 0.7 + p.phase) * 6 * dt; p.x += Math.cos(t * 0.5 + p.phase) * 8 * dt; },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.6 + p.phase * 2)) * 0.7;
          c.fillStyle = lighten(C(col, p.hue), 0.5);
          c.shadowColor = C(col, p.hue);
          c.shadowBlur = 7;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  jellyfish: (col) => ({
    count: 9, additive: true,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh : hh + 50,
      vx: (R() - 0.5) * 10, vy: -(7 + R() * 16),
      size: 7 + R() * 13, max: 999, hue: Math.floor(R() * 3), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 0.6 + p.phase) * 8) * dt;
    },
    draw: (c, p, t) => {
      const s = p.size;
      const pulse = 1 + Math.sin(t * 1.8 + p.phase) * 0.16;
      const cc = C(col, p.hue);
      c.globalAlpha = (0.45 + p.depth * 0.4) * Math.min(1, p.life / 1.5);
      // tentacles
      c.strokeStyle = rgba(lighten(cc, 0.4), 0.55);
      c.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        c.lineWidth = 0.8 + (i % 2) * 0.6;
        c.beginPath();
        const off = (i - 3) * s * 0.16;
        c.moveTo(off, s * 0.3);
        for (let k = 1; k <= 5; k++) {
          c.lineTo(
            off + Math.sin(t * 1.4 + k * 0.8 + i + p.phase) * s * 0.2,
            s * 0.3 + k * s * (0.28 + i * 0.015),
          );
        }
        c.stroke();
      }
      // bell
      const g = c.createRadialGradient(-s * 0.2, -s * 0.25, s * 0.08, 0, 0, s * 0.95);
      g.addColorStop(0, rgba(lighten(cc, 0.7), 0.85));
      g.addColorStop(0.5, rgba(cc, 0.4));
      g.addColorStop(1, rgba(cc, 0));
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(0, 0, s * 0.8 * pulse, s * 0.62 / pulse, 0, Math.PI, TAU);
      c.lineTo(s * 0.72 * pulse, s * 0.08);
      c.quadraticCurveTo(0, s * 0.26, -s * 0.72 * pulse, s * 0.08);
      c.closePath();
      c.fill();
      c.strokeStyle = rgba(lighten(cc, 0.6), 0.5);
      c.lineWidth = 0.8;
      c.stroke();
      // inner glow
      c.globalAlpha *= 0.6;
      c.fillStyle = lighten(cc, 0.8);
      c.beginPath();
      c.arc(0, -s * 0.08, s * 0.18, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[1], 0.35), 0.4), A(col[3], 0.6));
      // light shafts
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        const x = ((i * 41 + t * 6) % (w + 100)) - 50;
        const g = c.createLinearGradient(x, 0, x + 30, hh);
        g.addColorStop(0, rgba(col[2], 0.1));
        g.addColorStop(1, rgba(col[0], 0));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 22, 0);
        c.lineTo(x + 60, hh);
        c.lineTo(x + 6, hh);
        c.closePath();
        c.fill();
      }
      c.restore();
      // distant jellies
      for (let i = 0; i < 6; i++) {
        const x = h(i * 5.1) * w;
        const y = hh * (0.15 + h(i * 8.3) * 0.7) + Math.sin(t * 0.4 + i) * 8;
        const s = 5 + h(i * 3.3) * 9;
        c.globalAlpha = 0.16 + h(i) * 0.14;
        c.fillStyle = C(col, i);
        c.beginPath();
        c.ellipse(x, y, s, s * 0.7, 0, Math.PI, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
      // seaweed
      c.strokeStyle = rgba(col[1], 0.3);
      c.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        const x = h(i * 2.9) * w;
        c.lineWidth = 2 + h(i) * 2;
        c.beginPath();
        c.moveTo(x, hh);
        for (let k = 1; k <= 5; k++) {
          c.lineTo(x + Math.sin(t * 0.7 + k + i) * (6 + k * 2), hh - k * hh * 0.06);
        }
        c.stroke();
      }
      // sea floor
      c.fillStyle = rgba(darken(col[3], 0.2), 0.8);
      c.beginPath();
      c.moveTo(0, hh);
      for (let x = 0; x <= w; x += 14) c.lineTo(x, hh * 0.94 + Math.sin(x * 0.04 + 2) * 6);
      c.lineTo(w, hh);
      c.closePath();
      c.fill();
      speckle(c, w, hh, t, 58, col[2], 0.35, 1.2, 191);
      vignette(c, w, hh, col[3], 0.55);
    },
    layers: [
      {
        count: 34,
        spawn: (w, hh) => P({ x: R() * w, y: hh + 10, vy: -(18 + R() * 44), size: 0.8 + R() * 2.4, max: 5 + R() * 5, vx: (R() - 0.5) * 8 }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 2 + p.phase) * 6 * dt; },
        draw: (c, p) => {
          c.globalAlpha = 0.5 * Math.min(1, p.life, (p.max - p.life) / 0.6);
          c.strokeStyle = '#ffffffaa';
          c.lineWidth = 0.8;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.stroke();
          c.fillStyle = '#ffffff22';
          c.fill();
        },
      },
    ],
  }),

  inkbloom: (col) => ({
    count: 8,
    spawn: (w, hh) => P({
      x: w * (0.12 + R() * 0.76), y: hh * (0.14 + R() * 0.7),
      size: 6 + R() * 12, max: 6 + R() * 5, hue: Math.floor(R() * 2),
      depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt) => { p.size += (6 + p.depth * 8) * dt; },
    draw: (c, p, t) => {
      const a = Math.sin((p.life / p.max) * Math.PI) * 0.55;
      const cc = p.hue ? C(col, 1) : C(col, 0);
      c.globalAlpha = Math.max(0, a);
      c.fillStyle = rgba(cc, 0.85);
      // Rorschach lobe
      for (const side of [-1, 1]) {
        c.save();
        c.scale(side, 1);
        c.beginPath();
        c.moveTo(0, 0);
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI - Math.PI / 2;
          const rr = p.size * (0.6 + h(i * 3.7 + p.phase) * 0.7);
          c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr * 0.8 + Math.sin(t * 0.6 + i) * 2);
        }
        c.quadraticCurveTo(p.size * 0.2, p.size * 0.6, 0, p.size * 0.4);
        c.closePath();
        c.fill();
        c.restore();
      }
      // tendrils
      c.strokeStyle = rgba(cc, 0.5);
      c.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * TAU + p.phase;
        c.beginPath();
        c.moveTo(0, 0);
        for (let k = 1; k <= 4; k++) {
          const rr = p.size * (0.4 + k * 0.24);
          c.lineTo(Math.cos(ang + Math.sin(t + i) * 0.2) * rr, Math.sin(ang) * rr * 0.8);
        }
        c.stroke();
      }
      c.globalAlpha *= 0.4;
      c.fillStyle = lighten(cc, 0.5);
      c.beginPath();
      c.arc(0, 0, p.size * 0.16, 0, TAU);
      c.fill();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.18), A(mix(col[3], col[0], 0.18), 0.06));
      // ink clouds
      for (let i = 0; i < 9; i++) {
        const x = h(i * 4.3) * w + Math.sin(t * 0.2 + i) * 8;
        const y = h(i * 7.9) * hh + Math.cos(t * 0.18 + i) * 6;
        c.globalAlpha = 0.1 + h(i * 2.7) * 0.1;
        c.save();
        c.translate(x, y);
        puff(c, 20 + h(i * 5.1) * 34, i * 9.1, A(C(col, i % 2), 0.8));
        c.restore();
      }
      c.globalAlpha = 1;
      // ink drips from top
      c.strokeStyle = rgba(col[0], 0.3);
      for (let i = 0; i < 10; i++) {
        const x = h(i * 3.3) * w;
        const len = hh * (0.05 + h(i * 6.7) * 0.3);
        const drop = (t * (4 + h(i) * 6) + h(i * 9.1) * hh) % hh;
        c.lineWidth = 1 + h(i) * 2;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + Math.sin(t + i) * 3, Math.min(len, drop));
        c.stroke();
        c.fillStyle = rgba(col[0], 0.5);
        c.beginPath();
        c.arc(x + Math.sin(t + i) * 3, Math.min(len, drop), 1 + h(i) * 1.6, 0, TAU);
        c.fill();
      }
      // paper fibre
      speckle(c, w, hh, t, 70, col[0], 0.12, 1, 211);
      // circle vignette
      const g = c.createRadialGradient(w / 2, hh / 2, Math.min(w, hh) * 0.3, w / 2, hh / 2, Math.max(w, hh) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, rgba(col[3], 0.4));
      c.fillStyle = g;
      c.fillRect(0, 0, w, hh);
    },
    layers: [
      {
        count: 26,
        spawn: (w) => P({ x: R() * w, y: -10, vy: 30 + R() * 60, vx: (R() - 0.5) * 10, size: 1 + R() * 2.2, max: 4 + R() * 3 }),
        step: (p, dt) => { p.y += p.vy * dt; p.x += p.vx * dt; },
        draw: (c, p) => {
          c.globalAlpha = 0.5;
          c.fillStyle = lighten(col[0], 0.2);
          c.beginPath();
          c.ellipse(0, 0, p.size * 0.7, p.size * 1.4, 0, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  phantoms: (col) => ({
    count: 7, additive: true,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? hh * (0.2 + R() * 0.7) : hh * (0.8 + R() * 0.3),
      vx: (R() - 0.5) * 12, vy: -(4 + R() * 9),
      size: 8 + R() * 12, max: 9 + R() * 6, hue: Math.floor(R() * 3), depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 0.5 + p.phase) * 14) * dt;
    },
    draw: (c, p, t) => {
      const s = p.size;
      const a = Math.min(1, Math.sin((p.life / p.max) * Math.PI) * 1.8);
      const cc = C(col, p.hue);
      c.globalAlpha = a * (0.3 + p.depth * 0.4);
      glow(c, s * 2.4, cc, 0.4);
      c.fillStyle = rgba(lighten(cc, 0.5), 0.4);
      c.beginPath();
      c.moveTo(-s * 0.6, s * 1.2);
      c.bezierCurveTo(-s * 0.9, s * 0.2, -s * 0.7, -s * 0.9, 0, -s);
      c.bezierCurveTo(s * 0.7, -s * 0.9, s * 0.9, s * 0.2, s * 0.6, s * 1.2);
      for (let i = 0; i < 4; i++) {
        const x = s * 0.6 - (i + 0.5) * (s * 1.2 / 4);
        c.quadraticCurveTo(x, s * (1 + Math.sin(t * 2 + i + p.phase) * 0.18), x - s * 0.15, s * 1.02);
      }
      c.closePath();
      c.fill();
      // eyes
      c.globalAlpha = a * 0.75;
      c.fillStyle = '#05030a';
      c.beginPath();
      c.ellipse(-s * 0.2, -s * 0.28, s * 0.09, s * 0.15, -0.2, 0, TAU);
      c.ellipse(s * 0.2, -s * 0.28, s * 0.09, s * 0.15, 0.2, 0, TAU);
      c.fill();
      c.strokeStyle = rgba(lighten(cc, 0.7), 0.6);
      c.lineWidth = 0.8;
      c.beginPath();
      c.arc(0, s * 0.05, s * 0.2, 0.3, Math.PI - 0.3);
      c.stroke();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.6), A(mix(col[3], col[0], 0.2), 0.2));
      starfield(c, w, hh * 0.5, t, 40, col[0], 0.5);
      // moon
      bloom(c, w * 0.8, hh * 0.18, w * 0.4, col[2], 0.25);
      c.fillStyle = rgba(col[2], 0.75);
      c.beginPath();
      c.arc(w * 0.8, hh * 0.18, Math.min(w, hh) * 0.11, 0, TAU);
      c.fill();
      // graveyard
      c.fillStyle = A(darken(col[3], 0.35), 0.9);
      c.beginPath();
      c.moveTo(0, hh);
      for (let x = 0; x <= w; x += 12) c.lineTo(x, hh * 0.87 + Math.sin(x * 0.03 + 2) * 5);
      c.lineTo(w, hh);
      c.closePath();
      c.fill();
      for (let i = 0; i < 7; i++) {
        const x = w * (0.06 + i * 0.13) + Math.sin(i * 4.1) * 8;
        const gh = hh * (0.06 + h(i * 3.1) * 0.1);
        c.fillStyle = A(darken(col[3], 0.5), 0.95);
        c.beginPath();
        c.roundRect(x - 7, hh * 0.87 - gh, 14, gh + 4, [6, 6, 0, 0]);
        c.fill();
        c.fillStyle = rgba(col[0], 0.15);
        c.fillRect(x - 3, hh * 0.87 - gh * 0.7, 6, 1);
        c.fillRect(x - 0.8, hh * 0.87 - gh * 0.8, 1.6, 8);
      }
      // dead tree
      c.strokeStyle = A(darken(col[3], 0.55), 0.9);
      c.lineCap = 'round';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(w * 0.08, hh * 0.88);
      c.quadraticCurveTo(w * 0.12, hh * 0.6, w * 0.07, hh * 0.4);
      c.stroke();
      c.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo(w * (0.08 + i * 0.006), hh * (0.72 - i * 0.06));
        c.lineTo(w * (0.02 + i * 0.026), hh * (0.66 - i * 0.08));
        c.stroke();
      }
      // drifting fog
      mist(c, w, hh, hh * 0.66, col[0], 0.14, t, 0.35, 16);
      mist(c, w, hh, hh * 0.82, col[2], 0.1, t, -0.28, 12);
      speckle(c, w, hh, t, 30, col[2], 0.3, 1, 223);
      vignette(c, w, hh, col[3], 0.58);
    },
    layers: [
      {
        count: 30,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh * 0.85, size: 0.6 + R() * 1.8, max: 3 + R() * 5 }),
        step: (p, dt, t) => { p.y += 3 * dt; p.x += Math.sin(t * 0.4 + p.phase) * 4 * dt; },
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 1.4 + p.phase * 2)) * 0.5;
          c.fillStyle = lighten(col[2], 0.4);
          c.shadowColor = col[2];
          c.shadowBlur = 6;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),

  pixel_pop: (col) => ({
    count: 26,
    spawn: (w, hh, init) => P({
      x: Math.floor((R() * w) / 4) * 4, y: init ? R() * hh : hh + 16,
      vy: -(22 + R() * 48), vx: (R() - 0.5) * 18,
      size: 2 + Math.floor(R() * 3), max: 999,
      k: Math.floor(R() * 3), hue: Math.floor(R() * 4),
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x = Math.floor((p.x + Math.sin(t * 1.6 + p.phase) * 10 * dt) / 4) * 4;
      p.rot = 0;
    },
    draw: (c, p, t) => {
      const s = p.size;
      const cc = C(col, p.hue);
      c.globalAlpha = Math.min(1, p.life / 0.5);
      c.shadowColor = cc;
      c.shadowBlur = 6;
      c.fillStyle = cc;
      if (p.k === 0) {
        // pixel heart
        const rows = [0b01100110, 0b11111111, 0b11111111, 0b01111110, 0b00111100, 0b00011000];
        for (let y = 0; y < rows.length; y++) {
          for (let x = 0; x < 8; x++) {
            if (rows[y] & (1 << (7 - x))) c.fillRect((x - 4) * s, (y - 3) * s, s, s);
          }
        }
      } else if (p.k === 1) {
        // pixel coin
        c.beginPath();
        c.arc(0, 0, s * 3, 0, TAU);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,.25)';
        c.fillRect(-s, -s * 1.4, s * 2, s * 2.8);
      } else {
        // pixel star
        const pts = [[0, -3], [1, -1], [3, -1], [1, 1], [2, 3], [0, 2], [-2, 3], [-1, 1], [-3, -1], [-1, -1]];
        for (const [x, y] of pts) c.fillRect(x * s, y * s, s, s);
      }
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.fillRect(-s / 2, -s / 2, s, s);
      void t;
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.55), A(mix(col[3], col[1], 0.2), 0.22));
      // CRT grid
      c.strokeStyle = rgba(col[0], 0.08);
      c.lineWidth = 1;
      for (let x = 0; x <= w; x += 12) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hh); c.stroke(); }
      for (let y = 0; y <= hh; y += 12) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      // pixel sun
      const sx = w * 0.72, sy = hh * 0.28, sr = Math.min(w, hh) * 0.18;
      for (let y = -sr; y < sr; y += 6) {
        const half = Math.sqrt(Math.max(0, sr * sr - y * y));
        c.fillStyle = rgba(C(col, Math.floor((y + sr) / 6) % 2 ? 1 : 0), 0.5);
        c.fillRect(sx - half, sy + y, half * 2, 5);
      }
      // pixel mountains
      c.fillStyle = rgba(col[3], 0.8);
      for (let i = 0; i < 9; i++) {
        const x = (i / 9) * w;
        const bh = hh * (0.16 + h(i * 3.1) * 0.24);
        c.beginPath();
        c.moveTo(x, hh);
        c.lineTo(x, hh - bh);
        c.lineTo(x + w / 18, hh - bh - hh * 0.06);
        c.lineTo(x + w / 9, hh - bh);
        c.lineTo(x + w / 9, hh);
        c.closePath();
        c.fill();
      }
      // floor grid
      c.fillStyle = rgba(col[1], 0.16);
      c.fillRect(0, hh * 0.84, w, hh * 0.16);
      // scanlines
      c.fillStyle = 'rgba(0,0,0,.14)';
      for (let y = 0; y < hh; y += 3) c.fillRect(0, y, w, 1);
      // vignette + flash
      const g = c.createRadialGradient(w / 2, hh / 2, Math.min(w, hh) * 0.3, w / 2, hh / 2, Math.max(w, hh) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, rgba(col[3], 0.45));
      c.fillStyle = g;
      c.fillRect(0, 0, w, hh);
      const blink = Math.sin(t * 1.4) > 0.97 ? 0.06 : 0;
      if (blink) {
        c.fillStyle = rgba(col[2], blink);
        c.fillRect(0, 0, w, hh);
      }
    },
    layers: [
      {
        count: 26, additive: true,
        spawn: (w, hh) => P({ x: Math.floor((R() * w) / 4) * 4, y: R() * hh, size: 1 + Math.floor(R() * 2), max: 1 + R() * 2 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 4 + p.phase * 2)) * 0.7;
          c.fillStyle = C(col, p.hue);
          c.fillRect(0, 0, p.size * 2, p.size * 2);
        },
      },
    ],
  }),

  candy: (col) => ({
    count: 40,
    spawn: (w, hh, init) => P({
      x: R() * w, y: init ? R() * hh : -18,
      vy: 26 + R() * 52, vx: (R() - 0.5) * 30,
      size: 3 + R() * 5, max: 8 + R() * 5,
      vr: (R() - 0.5) * 6, hue: Math.floor(R() * 4), depth: 0.3 + R() * 0.7,
      k: Math.floor(R() * 3),
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 1.8 + p.phase) * 18) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const s = p.size;
      const cc = C(col, p.hue);
      c.globalAlpha = fade(p) * (0.65 + p.depth * 0.35);
      c.rotate(p.rot);
      c.fillStyle = cc;
      c.shadowColor = cc;
      c.shadowBlur = 6;
      if (p.k === 0) {
        // wrapped candy
        c.beginPath();
        c.ellipse(0, 0, s, s * 0.7, 0, 0, TAU);
        c.fill();
        for (const side of [-1, 1]) {
          c.beginPath();
          c.moveTo(side * s * 0.85, 0);
          c.lineTo(side * s * 1.6, -s * 0.5);
          c.lineTo(side * s * 1.6, s * 0.5);
          c.closePath();
          c.fill();
        }
        c.strokeStyle = 'rgba(255,255,255,.6)';
        c.lineWidth = 0.8;
        c.beginPath();
        c.arc(0, 0, s * 0.45, -0.8, 0.8);
        c.stroke();
      } else if (p.k === 1) {
        // lollipop
        c.strokeStyle = '#f6f2e8';
        c.lineWidth = s * 0.2;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, s * 2.4);
        c.stroke();
        c.beginPath();
        c.arc(0, 0, s, 0, TAU);
        c.fill();
        c.strokeStyle = lighten(cc, 0.6);
        c.lineWidth = s * 0.16;
        c.beginPath();
        for (let i = 0; i <= 40; i++) {
          const a = (i / 40) * TAU * 2.2 + t;
          const rr = s * (i / 40);
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      } else {
        // gumdrop
        c.beginPath();
        c.moveTo(-s, s);
        c.quadraticCurveTo(-s, -s, 0, -s);
        c.quadraticCurveTo(s, -s, s, s);
        c.closePath();
        c.fill();
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.beginPath();
        c.ellipse(-s * 0.3, -s * 0.3, s * 0.2, s * 0.14, -0.5, 0, TAU);
        c.fill();
      }
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[0], 0.35), 0.3), A(mix(col[3], col[2], 0.25), 0.12));
      bloom(c, w * 0.3, hh * 0.2, w * 0.6, col[0], 0.16);
      bloom(c, w * 0.78, hh * 0.4, w * 0.5, col[1], 0.12);
      // swirled candy clouds
      for (let i = 0; i < 6; i++) {
        const x = ((i * 47 + t * 5) % (w + 120)) - 60;
        const y = hh * (0.12 + (i % 3) * 0.12);
        c.globalAlpha = 0.16;
        c.fillStyle = C(col, i);
        c.save();
        c.translate(x, y);
        puff(c, 22 + i * 6, i * 5.3, rgba(C(col, i), 0.8));
        c.restore();
      }
      c.globalAlpha = 1;
      // candy hills
      for (let L = 0; L < 2; L++) {
        const base = hh * (0.74 + L * 0.1);
        c.beginPath();
        c.moveTo(0, hh);
        for (let x = 0; x <= w; x += 10) {
          c.lineTo(x, base + Math.sin(x / (40 + L * 20) + t * 0.2 + L) * 10);
        }
        c.lineTo(w, hh);
        c.closePath();
        c.fillStyle = rgba(mix(C(col, L), col[3], 0.35), 0.5);
        c.fill();
      }
      // giant lollipops
      for (let i = 0; i < 4; i++) {
        const x = w * (0.08 + i * 0.26);
        const y = hh * (0.62 + (i % 2) * 0.06);
        const r = Math.min(w, hh) * 0.09;
        c.strokeStyle = rgba('#f8f2e6', 0.4);
        c.lineWidth = r * 0.3;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, hh);
        c.stroke();
        c.save();
        c.translate(x, y);
        c.rotate(t * (0.2 + i * 0.05) + i);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, lighten(C(col, i), 0.5));
        g.addColorStop(1, C(col, i));
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, 0, r, 0, TAU);
        c.fill();
        c.strokeStyle = rgba('#ffffff', 0.35);
        c.lineWidth = r * 0.13;
        c.beginPath();
        for (let k = 0; k <= 46; k++) {
          const a = (k / 46) * TAU * 2.6;
          const rr = r * (k / 46);
          k ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        c.stroke();
        c.restore();
      }
      // sprinkles in the air
      for (let i = 0; i < 30; i++) {
        const x = h(i * 3.7) * w;
        const y = hh - ((t * (10 + h(i) * 20) + h(i * 7.1) * hh) % (hh + 20));
        c.save();
        c.translate(x, y);
        c.rotate(h(i * 2.3) * TAU + t * 0.4);
        c.fillStyle = rgba(C(col, i), 0.6);
        c.fillRect(-2, -0.8, 4, 1.6);
        c.restore();
      }
      speckle(c, w, hh, t, 26, col[2], 0.4, 1.1, 233);
      vignette(c, w, hh, col[3], 0.28);
    },
    layers: [
      {
        count: 30, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.6 + R() * 1.8, max: 2 + R() * 3 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.6 + p.phase * 2)) * 0.75;
          const cc = C(col, p.hue);
          c.fillStyle = lighten(cc, 0.4);
          c.shadowColor = cc;
          c.shadowBlur = 4;
          star4(c, p.size);
          c.fill();
        },
      },
    ],
  }),

  leviathan: (col) => ({
    count: 44, additive: true,
    spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.6 + R() * 2, max: 4 + R() * 6, hue: Math.floor(R() * 2), vy: -(4 + R() * 10) }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 0.4 + p.phase) * 6 * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = Math.max(0, Math.sin((p.life / p.max) * Math.PI)) * 0.7;
      const cc = C(col, p.hue);
      c.fillStyle = lighten(cc, 0.5);
      c.shadowColor = cc;
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(0, 0, p.size, 0, TAU);
      c.fill();
      void t;
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(mix(col[3], col[1], 0.4), 0.4), A(col[3], 0.7));
      // abyss light shafts
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const x = w * (0.1 + i * 0.2) + Math.sin(t * 0.2 + i) * 16;
        const g = c.createLinearGradient(x, 0, x - 40, hh);
        g.addColorStop(0, rgba(col[0], 0.12));
        g.addColorStop(1, rgba(col[0], 0));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 20, 0);
        c.lineTo(x - 50, hh);
        c.lineTo(x - 90, hh);
        c.closePath();
        c.fill();
      }
      c.restore();
      // the serpent: a chain of undulating segments
      const segs = 26;
      const yBase = hh * 0.58;
      c.save();
      for (let s = 0; s < segs; s++) {
        const k = s / (segs - 1);
        const x = w * (-0.1 + k * 1.2);
        const y = yBase + Math.sin(k * 5.2 + t * 0.5) * hh * 0.14 + Math.sin(k * 2.1 - t * 0.3) * hh * 0.05;
        const r = Math.min(w, hh) * (0.06 + Math.sin(k * Math.PI) * 0.06);
        c.globalAlpha = 0.85;
        c.fillStyle = A(mix(col[1], col[3], 0.25 + k * 0.3), 0.85);
        c.beginPath();
        c.ellipse(x, y, r * 1.4, r, Math.sin(k * 5.2 + t * 0.5) * 0.3, 0, TAU);
        c.fill();
        // scales
        c.globalAlpha = 0.5;
        c.fillStyle = rgba(lighten(col[1], 0.4), 0.6);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + k * 9;
          c.beginPath();
          c.arc(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.55, r * 0.16, 0, TAU);
          c.fill();
        }
        // dorsal fin spikes
        if (s % 3 === 0) {
          c.globalAlpha = 0.6;
          c.fillStyle = rgba(col[0], 0.55);
          c.beginPath();
          c.moveTo(x - r * 0.3, y - r * 0.8);
          c.lineTo(x, y - r * 1.5);
          c.lineTo(x + r * 0.3, y - r * 0.8);
          c.closePath();
          c.fill();
        }
      }
      // head
      const hx = w * (-0.1 + 0.02 * 1.2);
      void hx;
      c.restore();
      // glowing eye near the head
      const ex = w * 0.03, ey = yBase + Math.sin(0.1 * 5.2 + t * 0.5) * hh * 0.13;
      bloom(c, ex, ey, 16, col[2], 0.5);
      c.fillStyle = lighten(col[2], 0.7);
      c.beginPath();
      c.ellipse(ex, ey, 3.2, 2, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#050a10';
      c.beginPath();
      c.ellipse(ex, ey, 1.4, 2, 0, 0, TAU);
      c.fill();
      // distant ship silhouette
      c.fillStyle = 'rgba(0,0,0,.5)';
      c.beginPath();
      c.moveTo(w * 0.7, hh * 0.14);
      c.lineTo(w * 0.74, hh * 0.14);
      c.lineTo(w * 0.73, hh * 0.17);
      c.lineTo(w * 0.71, hh * 0.17);
      c.closePath();
      c.fill();
      c.fillRect(w * 0.719, hh * 0.08, 1, hh * 0.06);
      // bubbles
      for (let i = 0; i < 16; i++) {
        const x = ((i * 37 + t * 9) % w);
        const y = hh - ((t * (20 + i) + i * 50) % hh);
        c.strokeStyle = rgba(col[2], 0.25);
        c.lineWidth = 0.8;
        c.beginPath();
        c.arc(x, y, 1 + (i % 3), 0, TAU);
        c.stroke();
      }
      mist(c, w, hh, hh * 0.78, col[1], 0.08, t, 0.3, 10);
      speckle(c, w, hh, t, 40, col[2], 0.35, 1.2, 241);
      vignette(c, w, hh, col[3], 0.6);
    },
    layers: [
      {
        count: 22,
        spawn: (w, hh) => P({ x: R() * w, y: hh + 12, vy: -(16 + R() * 40), size: 0.8 + R() * 2.4, max: 4 + R() * 4, vx: (R() - 0.5) * 8 }),
        step: (p, dt, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 1.6 + p.phase) * 7 * dt; },
        draw: (c, p) => {
          c.globalAlpha = 0.4;
          c.strokeStyle = '#ffffff99';
          c.lineWidth = 0.8;
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.stroke();
        },
      },
    ],
  }),

  phoenix: (col) => ({
    count: 52, additive: true,
    spawn: (w, hh, init) => P({
      x: w * (0.2 + R() * 0.6), y: init ? R() * hh : hh + 20,
      vx: (R() - 0.5) * 34, vy: -(20 + R() * 60),
      size: 1.4 + R() * 3.4, max: 2.4 + R() * 3.4,
      hue: Math.floor(R() * 3), rot: R() * TAU, vr: (R() - 0.5) * 3,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 1.7 + p.phase) * 28) * dt;
      p.vy += 14 * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const a = fade(p);
      const cc = C(col, p.hue);
      c.globalAlpha = a;
      c.rotate(p.rot + Math.sin(t * 2 + p.phase) * 0.3);
      const g = c.createLinearGradient(0, -p.size * 1.4, 0, p.size * 1.2);
      g.addColorStop(0, lighten(cc, 0.7));
      g.addColorStop(0.4, cc);
      g.addColorStop(1, rgba(darken(cc, 0.2), 0));
      c.fillStyle = g;
      c.shadowColor = cc;
      c.shadowBlur = 12;
      // feather-flame
      c.beginPath();
      c.moveTo(0, -p.size * 1.8);
      c.quadraticCurveTo(p.size * 0.75, -p.size * 0.4, p.size * 0.3, p.size * 1);
      c.quadraticCurveTo(0, p.size * 0.2, -p.size * 0.3, p.size * 1);
      c.quadraticCurveTo(-p.size * 0.75, -p.size * 0.4, 0, -p.size * 1.8);
      c.fill();
      c.globalAlpha *= 0.55;
      c.strokeStyle = lighten(cc, 0.8);
      c.lineWidth = 0.6;
      c.beginPath();
      c.moveTo(0, p.size * 0.9);
      c.lineTo(0, -p.size * 1.5);
      c.stroke();
    },
    backdrop: (c, w, hh, t) => {
      wash(c, w, hh, A(col[3], 0.35), A(mix(col[3], col[1], 0.4), 0.24));
      // blazing sun
      const sx = w * 0.5, sy = hh * 0.42;
      bloom(c, sx, sy, Math.min(w, hh) * 0.62, col[1], 0.45);
      bloom(c, sx, sy, Math.min(w, hh) * 0.34, col[2], 0.5);
      // rotating rays
      c.save();
      c.translate(sx, sy);
      c.globalCompositeOperation = 'lighter';
      c.rotate(t * 0.12);
      for (let i = 0; i < 22; i++) {
        c.rotate(TAU / 22);
        const len = Math.max(w, hh) * (0.25 + h(i * 3.9) * 0.35) * (0.85 + Math.sin(t * 2 + i) * 0.15);
        const g = c.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, rgba(col[1], 0.28));
        g.addColorStop(0.55, rgba(col[0], 0.1));
        g.addColorStop(1, rgba(col[0], 0));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(len, -5);
        c.lineTo(len, 5);
        c.closePath();
        c.fill();
      }
      c.restore();
      // phoenix silhouette with beating wings
      const beat = Math.sin(t * 0.9) * 0.22;
      c.save();
      c.translate(sx, sy);
      c.fillStyle = rgba(darken(col[1], 0.12), 0.9);
      c.beginPath();
      c.moveTo(0, -hh * 0.04);
      c.bezierCurveTo(-w * 0.1, -hh * 0.3 - beat * hh, -w * 0.34, -hh * 0.34 - beat * hh, -w * 0.46, -hh * 0.06);
      c.bezierCurveTo(-w * 0.32, -hh * 0.12, -w * 0.2, -hh * 0.04, -w * 0.1, hh * 0.06);
      c.bezierCurveTo(-w * 0.05, hh * 0.16, -w * 0.02, hh * 0.22, 0, hh * 0.3);
      c.bezierCurveTo(w * 0.02, hh * 0.22, w * 0.05, hh * 0.16, w * 0.1, hh * 0.06);
      c.bezierCurveTo(w * 0.2, -hh * 0.04, w * 0.32, -hh * 0.12, w * 0.46, -hh * 0.06);
      c.bezierCurveTo(w * 0.34, -hh * 0.34 - beat * hh, w * 0.1, -hh * 0.3 - beat * hh, 0, -hh * 0.04);
      c.fill();
      // head + crest
      c.beginPath();
      c.arc(0, -hh * 0.06, hh * 0.035, 0, TAU);
      c.fill();
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(-hh * 0.02 + i * hh * 0.012, -hh * 0.08);
        c.lineTo(-hh * 0.04 + i * hh * 0.02, -hh * 0.18 - i * hh * 0.02);
        c.lineTo(hh * 0.01 + i * hh * 0.012, -hh * 0.08);
        c.closePath();
        c.fill();
      }
      // tail plume
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo(0, hh * 0.26);
        c.quadraticCurveTo((i - 2) * hh * 0.03, hh * 0.42, (i - 2) * hh * 0.06 + Math.sin(t * 2 + i) * 4, hh * 0.56);
        c.quadraticCurveTo((i - 2) * hh * 0.03, hh * 0.42, 0, hh * 0.3);
        c.fillStyle = rgba(C(col, i), 0.55);
        c.fill();
      }
      c.restore();
      // embers on the ground
      for (let i = 0; i < 14; i++) {
        const x = h(i * 4.7) * w;
        bloom(c, x, hh * 0.94, 8 + h(i) * 12, col[1], 0.18);
      }
      ridge(c, w, hh, hh * 0.95, 8, A(darken(col[3], 0.4), 0.7), 5.3, t);
      speckle(c, w, hh, t, 56, col[0], 0.6, 1.4, 251);
      vignette(c, w, hh, col[3], 0.42);
    },
    layers: [
      {
        count: 34, additive: true,
        spawn: (w, hh) => P({ x: R() * w, y: R() * hh, size: 0.4 + R() * 1.4, max: 1 + R() * 2.4 }),
        draw: (c, p, t) => {
          c.globalAlpha = Math.max(0, Math.sin(t * 2.4 + p.phase * 2)) * 0.8;
          c.fillStyle = lighten(col[1], 0.4);
          c.beginPath();
          c.arc(0, 0, p.size, 0, TAU);
          c.fill();
        },
      },
    ],
  }),
};

// ---------------------------------------------- owner-only "Special": Genesis --
let sigil: Path2D | null = null;
// the sigil hovers over the banner like a crest, clear of the name and bio
const genesisCenter = (w: number, hh: number) => [w / 2, hh * 0.2, Math.min(w, hh) * 0.2] as const;
BASES.sovereign = (col) => {
  const [gold, violet, light] = col;
  return {
    count: 70,
    additive: true,
    // golden motes spiralling into the sigil (polar coords in vx = angle, vy = radius)
    spawn: (w, hh) => {
      const [cx, cy] = genesisCenter(w, hh);
      const x = R() * w, y = R() * hh;
      return P({ x, y, vx: Math.atan2(y - cy, x - cx), vy: Math.hypot(x - cx, y - cy), size: 0.8 + R() * 1.8, max: 30, hue: R() < 0.25 ? 1 : 0 });
    },
    step: (p, dt, _t, w, hh) => {
      const [cx, cy, r0] = genesisCenter(w, hh);
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
    backdrop: (c, w, hh, t) => {
      const [cx, cy, R0] = genesisCenter(w, hh);
      const big = Math.hypot(w, hh);
      // vortex glow
      let g = c.createRadialGradient(cx, cy, 0, cx, cy, big * 0.7);
      g.addColorStop(0, `${violet}55`); g.addColorStop(0.35, `${violet}22`); g.addColorStop(1, '#00000000');
      c.fillStyle = g; c.fillRect(0, 0, w, hh);
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
      if (sw < 0.06) { c.globalAlpha = (0.06 - sw) * 3; c.fillStyle = light; c.fillRect(0, 0, w, hh); }
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
      const boltId = Math.floor(t / 1.7), phase = t % 1.7;
      if (phase < 0.14) {
        const ang = ((boltId * 2.399) % TAU), len = big * 0.6;
        c.save(); c.globalCompositeOperation = 'lighter';
        c.strokeStyle = light; c.shadowColor = violet; c.shadowBlur = 14; c.lineWidth = 1.8; c.globalAlpha = 1 - phase / 0.14;
        c.beginPath();
        let x = cx + Math.cos(ang) * R0 * 0.7, y = cy + Math.sin(ang) * R0 * 0.6;
        c.moveTo(x, y);
        for (let i = 1; i <= 10; i++) {
          const rr = R0 * 0.7 + (len * i) / 10;
          x = cx + Math.cos(ang) * rr + Math.sin(boltId * 7 + i * 3.1) * 12;
          y = cy + Math.sin(ang) * rr * 0.82 + Math.cos(boltId * 5 + i * 2.3) * 12;
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
