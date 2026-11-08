// Profile cosmetics: nameplates (animated scenes behind your name in lists),
// avatar frames and profile effects (particles over your whole profile card).
//
// Nameplates and frames are CSS + SVG (cheap enough for a member list of 100
// rows: only transform / opacity animate). Profile effects are one <canvas>
// per open profile with a small particle system. Everything stops moving with
// "reduce motion", and effects pause when off screen.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './cosmetics.css';
import { Decoration } from './Decorations';
import { ShopNameplate } from './ShopNameplates';
import { shopEffect } from './shopEffects';

// ------------------------------------------------------------------ helpers --
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
type Vars = CSSProperties & Record<`--${string}`, string | number>;
/** n particles with deterministic random position / size / timing (CSS vars). */
function dots(seed: string, n: number, cls: string, o: { x?: [number, number]; y?: [number, number]; s?: [number, number]; t?: [number, number] } = {}) {
  const r = rng(seed);
  const pick = ([a, b]: [number, number]) => a + r() * (b - a);
  return Array.from({ length: n }, (_, i) => {
    const t = pick(o.t ?? [3, 7]);
    const style: Vars = {
      '--x': pick(o.x ?? [35, 100]).toFixed(1),
      '--y': pick(o.y ?? [0, 100]).toFixed(1),
      '--s': pick(o.s ?? [1.5, 3]).toFixed(2),
      '--t': `${t.toFixed(2)}s`,
      '--d': `${(-r() * t).toFixed(2)}s`,
      '--dx': `${(r() * 2 - 1).toFixed(2)}`,
      '--r': `${Math.round(r() * 360)}deg`,
    };
    return <i key={i} className={cls} style={style} />;
  });
}

// --------------------------------------------------------------- nameplates --
export const NAMEPLATE_LIST: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'starfield', label: 'Starfield' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'ember', label: 'Ember' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'koi', label: 'Koi Pond' },
  { id: 'fireflies', label: 'Fireflies' },
  { id: 'snowfall', label: 'Snowfall' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'storm', label: 'Storm' },
  { id: 'circuit', label: 'Circuit' },
  { id: 'noir', label: 'Noir City' },
  { id: 'gold', label: 'Gilded' },
];

const WAVE = 'M0 10 Q 12.5 4 25 10 T 50 10 T 75 10 T 100 10 T 125 10 T 150 10 T 175 10 T 200 10 V 20 H 0 Z';
const KOI = 'M2 6 C 6 1, 16 1, 22 5 L 28 2 L 27 6 L 28 10 L 22 7 C 16 11, 6 11, 2 6 Z';
const SCENES: Record<string, () => ReactNode> = {
  aurora: () => (
    <>
      <b className="np-sky" />
      <b className="np-ribbon r1" />
      <b className="np-ribbon r2" />
      <b className="np-ribbon r3" />
      {dots('aurora', 12, 'np-star', { s: [1, 2.2], t: [2, 5] })}
    </>
  ),
  starfield: () => (
    <>
      <b className="np-sky" />
      <b className="np-nebula" />
      {dots('stars-far', 18, 'np-star', { s: [0.8, 1.6], t: [2, 6] })}
      {dots('stars-near', 7, 'np-star big', { s: [1.8, 2.8], t: [3, 6] })}
      <b className="np-shoot" />
    </>
  ),
  sakura: () => (
    <>
      <b className="np-sky" />
      <b className="np-moon" />
      <svg className="np-branch" viewBox="0 0 120 50" preserveAspectRatio="xMaxYMin meet">
        <path d="M120 2 C 95 8, 80 4, 62 14 C 50 21, 44 18, 30 26 M 86 7 C 84 16, 90 22, 88 30 M 62 14 C 66 22, 60 28, 64 36" stroke="#3a1a22" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        {[[30, 26], [44, 19], [58, 15], [64, 36], [88, 30], [86, 18], [100, 6], [72, 10], [52, 22]].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <circle r="3.6" fill="#ffc6da" />
            <circle r="1.3" fill="#ff7aa8" />
          </g>
        ))}
      </svg>
      {dots('sakura', 11, 'np-petal', { y: [-20, 40], s: [5, 8], t: [4, 8] })}
    </>
  ),
  ember: () => (
    <>
      <b className="np-sky" />
      <b className="np-glow" />
      {dots('ember', 16, 'np-spark', { y: [70, 110], s: [1.4, 3], t: [2.2, 4.5] })}
    </>
  ),
  ocean: () => (
    <>
      <b className="np-sky" />
      <b className="np-rays" />
      {dots('bubbles', 8, 'np-bubble', { y: [70, 110], s: [2.5, 5], t: [3, 6] })}
      <svg className="np-wave w1" viewBox="0 0 200 20" preserveAspectRatio="none"><path d={WAVE} /></svg>
      <svg className="np-wave w2" viewBox="0 0 200 20" preserveAspectRatio="none"><path d={WAVE} /></svg>
    </>
  ),
  koi: () => (
    <>
      <b className="np-sky" />
      {dots('ripples', 4, 'np-ripple', { y: [20, 80], s: [14, 22], t: [3, 5] })}
      <svg className="np-fish k1" viewBox="0 0 30 12"><path d={KOI} fill="#ff7b39" /><circle cx="9" cy="5" r="1.6" fill="#fff" /><circle cx="15" cy="7" r="1.4" fill="#fff" /></svg>
      <svg className="np-fish k2" viewBox="0 0 30 12"><path d={KOI} fill="#f5f2ea" /><circle cx="11" cy="6" r="2" fill="#e8452c" /></svg>
      <svg className="np-lily" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10H12z" fill="#2f8f4e" /><circle cx="17" cy="7" r="2.4" fill="#ffd1e3" /></svg>
    </>
  ),
  fireflies: () => (
    <>
      <b className="np-sky" />
      <svg className="np-grass" viewBox="0 0 200 20" preserveAspectRatio="none">
        <path d="M0 20 L0 14 L4 8 L6 15 L10 6 L13 15 L17 9 L20 16 L25 5 L28 15 L33 10 L36 16 L41 7 L44 15 L49 11 L52 16 L58 6 L61 15 L66 9 L69 16 L75 8 L78 15 L84 10 L87 16 L93 6 L96 15 L101 9 L104 16 L110 7 L113 15 L119 10 L122 16 L128 5 L131 15 L137 9 L140 16 L146 8 L149 15 L155 10 L158 16 L164 6 L167 15 L173 9 L176 16 L182 7 L185 15 L191 10 L194 16 L200 12 L200 20 Z" fill="#06180e" />
      </svg>
      {dots('flies', 9, 'np-fly', { y: [10, 75], s: [2.2, 3.4], t: [4, 8] })}
    </>
  ),
  snowfall: () => (
    <>
      <b className="np-sky" />
      <svg className="np-hills" viewBox="0 0 200 20" preserveAspectRatio="none">
        <path d="M0 20 V 15 Q 40 6 80 14 T 150 10 T 200 13 V 20 Z" fill="#dfe9f7" opacity=".9" />
      </svg>
      {dots('snow', 18, 'np-snow', { y: [-30, 10], s: [1.5, 3.4], t: [3.5, 7] })}
    </>
  ),
  synthwave: () => (
    <>
      <b className="np-sky" />
      <b className="np-sun" />
      <b className="np-grid" />
    </>
  ),
  storm: () => (
    <>
      <b className="np-sky" />
      <b className="np-cloud c1" />
      <b className="np-cloud c2" />
      <svg className="np-bolt" viewBox="0 0 20 40"><path d="M12 0 L4 20 H11 L6 40 L18 14 H11 L16 0 Z" /></svg>
      <b className="np-flash" />
      {dots('storm-rain', 16, 'np-rain', { y: [-40, 0], s: [8, 14], t: [0.6, 1] })}
    </>
  ),
  circuit: () => (
    <>
      <b className="np-sky" />
      <svg className="np-traces" viewBox="0 0 120 40" preserveAspectRatio="xMaxYMid slice">
        {['M0 10 H40 L48 18 H80 L88 10 H120', 'M10 34 H50 L58 26 H95 L103 34 H120', 'M60 0 V8 L68 16 V40', 'M100 0 V12 L92 20 V40'].map((d, i) => (
          <g key={i}>
            <path d={d} className="base" />
            <path d={d} className="pulse" style={{ animationDelay: `${-i * 0.9}s` }} />
          </g>
        ))}
        {[[48, 18], [88, 10], [58, 26], [103, 34], [68, 16], [92, 20]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.8" className="node" style={{ animationDelay: `${-i * 0.5}s` }} />
        ))}
      </svg>
    </>
  ),
  noir: () => (
    <>
      <b className="np-sky" />
      <b className="np-spot" />
      <svg className="np-city" viewBox="0 0 120 30" preserveAspectRatio="xMaxYMax meet">
        <path d="M0 30 V18 H8 V12 H16 V20 H22 V8 H32 V22 H38 V14 H46 V4 H54 V18 H62 V10 H70 V24 H76 V6 H88 V16 H94 V12 H104 V20 H110 V9 H120 V30 Z" fill="#050506" />
        {[[26, 12], [28, 16], [49, 8], [51, 13], [80, 10], [84, 14], [113, 13], [66, 14], [100, 15]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="1.6" height="1.6" className="win" style={{ animationDelay: `${-i * 1.3}s` }} />
        ))}
      </svg>
      {dots('noir-rain', 14, 'np-rain light', { y: [-40, 0], s: [8, 12], t: [0.7, 1.1] })}
    </>
  ),
  gold: () => (
    <>
      <b className="np-sky" />
      <b className="np-filigree" />
      <b className="np-sheen" />
      {dots('gold', 7, 'np-glint', { y: [10, 85], s: [5, 9], t: [2.5, 4.5] })}
    </>
  ),
};
const sceneCache = new Map<string, ReactNode>();

/** The animated scene behind a nameplate row (null for none / custom). */
export function NameplateArt({ id }: { id?: string | null }) {
  if (id && id.startsWith('plate.')) return <ShopNameplate id={id} />;
  if (!id || !SCENES[id]) return null;
  let node = sceneCache.get(id);
  if (!node) sceneCache.set(id, (node = SCENES[id]()));
  return (
    <span className={`np-art np-${id}`} aria-hidden>
      {node}
    </span>
  );
}

// ------------------------------------------------------------------- frames --
export const FRAME_LIST: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'neon', label: 'Neon' },
  { id: 'flame', label: 'Inferno' },
  { id: 'frost', label: 'Frost' },
  { id: 'rainbow', label: 'Prism' },
  { id: 'gold', label: 'Royal' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'galaxy', label: 'Galaxy' },
  { id: 'lightning', label: 'Storm' },
  { id: 'crystal', label: 'Crystal' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'pixel', label: 'Pixel' },
  { id: 'glitch', label: 'Glitch' },
];
const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2 0 3.6 1.1 4.6 2.6l1 1.4 1-1.4C14 6.1 15.6 5 17.6 5 21 5 23.1 8.5 21.6 11.8 19.5 16.4 12 21 12 21z';
const FRAMES: Record<string, () => ReactNode> = {
  neon: () => (
    <>
      <b className="fr-ring" />
      <b className="fr-ring inner" />
    </>
  ),
  flame: () => (
    <>
      <b className="fr-ring" />
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} className="fr-tongue" style={{ '--a': `${i * 30 + (i % 2) * 8}deg`, '--d': `${-i * 0.19}s`, '--t': `${0.7 + (i % 3) * 0.2}s`, '--h': i % 3 === 0 ? 1.25 : i % 3 === 1 ? 0.9 : 1.05 } as Vars} />
      ))}
      {dots('fr-ember', 6, 'fr-spark', { x: [20, 80], y: [55, 90], s: [1.5, 2.5], t: [1.6, 2.6] })}
    </>
  ),
  frost: () => (
    <>
      <b className="fr-ring" />
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} className="fr-shard" style={{ '--a': `${i * 45 + (i % 2) * 12}deg`, '--d': `${-i * 0.4}s`, '--s': i % 2 ? 0.7 : 1 } as Vars} />
      ))}
      <b className="fr-shine" />
    </>
  ),
  rainbow: () => (
    <>
      <b className="fr-glow" />
      <b className="fr-ring" />
    </>
  ),
  gold: () => (
    <>
      <b className="fr-ring" />
      <b className="fr-shine" />
      {dots('fr-gold', 5, 'fr-glint', { x: [5, 95], y: [5, 95], s: [4, 7], t: [2, 3.5] })}
    </>
  ),
  sakura: () => (
    <>
      <b className="fr-ring" />
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} className="fr-orbit-petal" style={{ '--a': `${i * 60}deg`, '--t': `${7 + (i % 3)}s`, '--d': `${-i * 1.1}s` } as Vars} />
      ))}
    </>
  ),
  galaxy: () => (
    <>
      <b className="fr-ring" />
      <b className="fr-ring swirl" />
      {dots('fr-galaxy', 8, 'fr-twinkle', { x: [0, 100], y: [0, 100], s: [1.5, 2.6], t: [1.5, 3] })}
    </>
  ),
  lightning: () => (
    <>
      <b className="fr-ring" />
      <svg className="fr-arcs" viewBox="0 0 100 100">
        <path d="M50 4 L46 14 L54 18 L48 28" />
        <path d="M94 54 L84 50 L82 60 L72 56" />
        <path d="M18 84 L26 76 L20 70 L30 64" />
      </svg>
    </>
  ),
  crystal: () => (
    <>
      <b className="fr-ring" />
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} className="fr-gem" style={{ '--a': `${i * 60}deg`, '--d': `${-i * 0.5}s` } as Vars} />
      ))}
    </>
  ),
  orbit: () => (
    <>
      <b className="fr-ring" />
      <i className="fr-moon m1" />
      <i className="fr-moon m2" />
      <i className="fr-moon m3" />
    </>
  ),
  hearts: () => (
    <>
      <b className="fr-ring" />
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} className="fr-heart" viewBox="0 0 24 24" style={{ '--x': `${10 + i * 20}%`, '--d': `${-i * 0.7}s`, '--t': `${2.8 + (i % 2) * 0.8}s` } as Vars}>
          <path d={HEART} />
        </svg>
      ))}
    </>
  ),
  pixel: () => (
    <>
      <b className="fr-ring" />
      <b className="fr-ring inner" />
    </>
  ),
  glitch: () => (
    <>
      <b className="fr-ring r" />
      <b className="fr-ring c" />
      <b className="fr-ring" />
      <b className="fr-scan" />
    </>
  ),
};
const frameCache = new Map<string, ReactNode>();

/** Animated frame drawn around (and a little outside) an avatar. */
export function FrameArt({ id }: { id: string }) {
  if (id.startsWith('deco.')) return <Decoration id={id} />;
  if (!FRAMES[id]) return null;
  let node = frameCache.get(id);
  if (!node) frameCache.set(id, (node = FRAMES[id]()));
  return (
    <span className={`avatar-frame fa fa-${id}`} aria-hidden>
      {node}
    </span>
  );
}

// ---------------------------------------------------------- profile effects --
export const EFFECT_LIST: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'sparkles', label: 'Stardust' },
  { id: 'hearts', label: 'Love Struck' },
  { id: 'sakura', label: 'Sakura Breeze' },
  { id: 'snow', label: 'First Snow' },
  { id: 'embers', label: 'Embers' },
  { id: 'leaves', label: 'Autumn' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'confetti', label: 'Celebration' },
  { id: 'shooting_stars', label: 'Shooting Stars' },
  { id: 'fireflies', label: 'Fireflies' },
  { id: 'aurora', label: 'Northern Lights' },
];

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  life: number;
  max: number;
  hue: number;
  phase: number;
  depth: number;
}
interface EffectDef {
  count: number;
  additive?: boolean;
  spawn: (w: number, h: number, initial: boolean) => P;
  step?: (p: P, dt: number, t: number, w: number, h: number) => void;
  draw: (c: CanvasRenderingContext2D, p: P, t: number) => void;
  backdrop?: (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}
const R = Math.random;
const base = (o: Partial<P>): P => ({ x: 0, y: 0, vx: 0, vy: 0, size: 3, rot: 0, vr: 0, life: 0, max: 6, hue: 0, phase: R() * Math.PI * 2, depth: 0.4 + R() * 0.6, ...o });
const fade = (p: P) => Math.min(1, p.life / 0.6, (p.max - p.life) / 0.8);

function heartPath(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, s * 0.35);
  c.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
  c.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
  c.closePath();
}
function star4(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? s * 0.22 : s;
    const a = (i * Math.PI) / 4;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
}
function petal(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, -s);
  c.bezierCurveTo(s * 0.9, -s * 0.6, s * 0.7, s * 0.7, 0, s);
  c.bezierCurveTo(-s * 0.7, s * 0.7, -s * 0.9, -s * 0.6, 0, -s);
  c.closePath();
}
function leaf(c: CanvasRenderingContext2D, s: number) {
  c.beginPath();
  c.moveTo(0, -s);
  c.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
  c.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s);
  c.closePath();
}
const fall = (speed: [number, number], sway: number) => (p: P, dt: number, t: number) => {
  p.y += p.vy * dt * p.depth;
  p.x += (p.vx + Math.sin(t * 1.3 + p.phase) * sway) * dt * p.depth;
  p.rot += p.vr * dt;
  void speed;
};

const EFFECTS: Record<string, EffectDef> = {
  sparkles: {
    count: 26,
    additive: true,
    spawn: (w, h) => base({ x: R() * w, y: R() * h, size: 2 + R() * 4.5, max: 1.8 + R() * 2.4, hue: R() < 0.7 ? 48 : 200, vy: -4 - R() * 6 }),
    step: (p, dt) => (p.y += p.vy * dt),
    draw: (c, p) => {
      const k = Math.sin((p.life / p.max) * Math.PI);
      c.globalAlpha = k;
      c.fillStyle = `hsl(${p.hue} 100% 85%)`;
      c.shadowColor = `hsl(${p.hue} 100% 70%)`;
      c.shadowBlur = 8;
      c.rotate(p.life * 0.6);
      star4(c, p.size * (0.4 + k * 0.6));
      c.fill();
    },
  },
  hearts: {
    count: 16,
    spawn: (w, h, init) => base({ x: R() * w, y: init ? R() * h : h + 12, vy: -(18 + R() * 22), size: 5 + R() * 6, max: 5 + R() * 4, hue: 330 + R() * 30, vr: (R() - 0.5) * 0.6 }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 2 + p.phase) * 10 * dt;
      p.rot = Math.sin(t * 1.5 + p.phase) * 0.35;
    },
    draw: (c, p) => {
      c.globalAlpha = fade(p) * 0.9;
      const g = c.createLinearGradient(0, -p.size, 0, p.size);
      g.addColorStop(0, `hsl(${p.hue} 100% 78%)`);
      g.addColorStop(1, `hsl(${p.hue} 90% 52%)`);
      c.fillStyle = g;
      c.shadowColor = `hsl(${p.hue} 100% 60% / .6)`;
      c.shadowBlur = 6;
      c.rotate(p.rot);
      heartPath(c, p.size);
      c.fill();
    },
  },
  sakura: {
    count: 22,
    spawn: (w, h, init) => base({ x: R() * w * 1.2, y: init ? R() * h : -10, vx: -14 - R() * 10, vy: 22 + R() * 18, size: 3.5 + R() * 3, vr: (R() - 0.5) * 3, max: 9 }),
    step: fall([22, 40], 14),
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * (0.55 + p.depth * 0.45);
      c.rotate(p.rot);
      c.scale(Math.cos(t * 2.2 + p.phase), 1); // the petal flips as it tumbles
      const g = c.createLinearGradient(0, -p.size, 0, p.size);
      g.addColorStop(0, '#fff0f5');
      g.addColorStop(1, '#ff9ec1');
      c.fillStyle = g;
      petal(c, p.size);
      c.fill();
    },
  },
  snow: {
    count: 46,
    spawn: (w, h, init) => base({ x: R() * w, y: init ? R() * h : -6, vy: 14 + R() * 26, vx: (R() - 0.5) * 6, size: 0.8 + R() * 2.6, max: 14 }),
    step: fall([14, 40], 8),
    draw: (c, p) => {
      c.globalAlpha = fade(p) * (0.35 + p.depth * 0.6);
      c.fillStyle = '#fff';
      c.shadowColor = '#cfe6ff';
      c.shadowBlur = p.size * 2;
      c.beginPath();
      c.arc(0, 0, p.size * p.depth, 0, Math.PI * 2);
      c.fill();
    },
  },
  embers: {
    count: 34,
    additive: true,
    spawn: (w, h, init) => base({ x: R() * w, y: init ? h * (0.4 + R() * 0.6) : h + 4, vy: -(20 + R() * 35), size: 0.8 + R() * 1.8, max: 2.5 + R() * 2.5, hue: 18 + R() * 25 }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 3 + p.phase) * 14 * dt;
    },
    draw: (c, p, t) => {
      const flick = 0.6 + 0.4 * Math.sin(t * 18 + p.phase * 5);
      c.globalAlpha = fade(p) * flick;
      c.fillStyle = `hsl(${p.hue} 100% 62%)`;
      c.shadowColor = `hsl(${p.hue} 100% 55%)`;
      c.shadowBlur = 10;
      c.beginPath();
      c.arc(0, 0, p.size, 0, Math.PI * 2);
      c.fill();
    },
    backdrop: (c, w, h, t) => {
      const g = c.createLinearGradient(0, h, 0, h * 0.55);
      g.addColorStop(0, `rgba(255,90,20,${0.22 + Math.sin(t * 2) * 0.05})`);
      g.addColorStop(1, 'rgba(255,90,20,0)');
      c.fillStyle = g;
      c.fillRect(0, h * 0.55, w, h * 0.45);
    },
  },
  leaves: {
    count: 22,
    spawn: (w, h, init) => base({ x: R() * w * 1.2, y: init ? R() * h : -12, vx: -10 - R() * 12, vy: 24 + R() * 16, size: 6 + R() * 5, vr: (R() - 0.5) * 2.4, hue: 12 + R() * 34, max: 9 }),
    step: fall([24, 40], 22),
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * 0.92;
      c.rotate(p.rot);
      c.scale(1, Math.cos(t * 1.8 + p.phase));
      c.fillStyle = `hsl(${p.hue} 85% 48%)`;
      leaf(c, p.size);
      c.fill();
      c.strokeStyle = `hsl(${p.hue} 70% 30% / .7)`;
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(0, -p.size);
      c.lineTo(0, p.size);
      c.stroke();
    },
  },
  bubbles: {
    count: 18,
    spawn: (w, h, init) => base({ x: R() * w, y: init ? R() * h : h + 10, vy: -(16 + R() * 24), size: 3 + R() * 7, max: 8 }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 2.4 + p.phase) * 9 * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * 0.85;
      const s = p.size * (1 + Math.sin(t * 4 + p.phase) * 0.05);
      const g = c.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,.65)');
      g.addColorStop(0.55, `hsla(${190 + Math.sin(t + p.phase) * 60} 100% 80% / .12)`);
      g.addColorStop(1, 'rgba(180,230,255,.35)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, s, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.45)';
      c.lineWidth = 0.7;
      c.stroke();
    },
  },
  confetti: {
    count: 40,
    spawn: (w, h, init) => base({ x: R() * w, y: init ? R() * h * 0.9 : -8, vy: 34 + R() * 30, vx: (R() - 0.5) * 30, size: 2.5 + R() * 2.5, vr: (R() - 0.5) * 8, hue: [350, 45, 140, 200, 275][Math.floor(R() * 5)], max: 7 }),
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 3 + p.phase) * 18) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = fade(p);
      c.rotate(p.rot);
      c.scale(1, Math.cos(t * 6 + p.phase));
      c.fillStyle = `hsl(${p.hue} 90% 60%)`;
      c.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9);
    },
  },

shooting_stars: {
  count: 110,
  additive: true,

  spawn: (w: number, h: number, init: boolean) => {
    const r = R();

    if (init || r > 0.13) {
      return base({
        x: R() * w,
        y: R() * h,
        vx: 0,
        vy: 0,
        size: 0.35 + R() * 1.35,
        max: 3 + R() * 5,
        hue: 0,
        type: 0,
        phase: R() * Math.PI * 2,
        twinkle: 1 + R() * 3,
      });
    }

    const angle = Math.PI * (0.25 + R() * 0.15);
    const speed = 420 + R() * 780;

    return base({
      x: R() * w * 1.2,
      y: -30 + R() * h * 0.65,
      vx: -Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 0.8 + R() * 1.8,
      max: 0.7 + R() * 1.1,
      hue: 1,
      type: 1,
      length: 65 + R() * 190,
      speed,
      glow: 12 + R() * 24,
      phase: R() * Math.PI * 2,
    });
  },

  step: (p: any, dt: number) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.phase += dt * 12;
  },

  draw: (c: CanvasRenderingContext2D, p: any) => {
    const progress = Math.min(1, p.life / p.max);
    const fade = Math.sin(progress * Math.PI);

    if (p.hue !== 1) {
      const pulse = 0.35 + (Math.sin(p.phase) + 1) * 0.275;

      c.globalAlpha = pulse * fade;
      c.fillStyle = '#ffffff';
      c.shadowColor = '#9ecbff';
      c.shadowBlur = 8;

      c.beginPath();
      c.arc(0, 0, p.size, 0, Math.PI * 2);
      c.fill();

      c.shadowBlur = 0;
      c.globalAlpha = 1;
      return;
    }

    const tailX = -p.vx / p.speed * p.length;
    const tailY = -p.vy / p.speed * p.length;

    const flicker = 0.88 + Math.sin(p.phase) * 0.12;
    const alpha = fade * flicker;

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';

    // Atmospheric glow
    c.globalAlpha = alpha * 0.16;
    c.strokeStyle = '#8fcaff';
    c.lineWidth = p.size * 11;
    c.shadowColor = '#8fcaff';
    c.shadowBlur = p.glow * 2;

    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(tailX, tailY);
    c.stroke();

    // Outer blue trail
    c.globalAlpha = alpha * 0.55;
    c.lineWidth = p.size * 4;

    const gradient = c.createLinearGradient(
      0, 0, tailX, tailY
    );

    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(150,205,255,0.85)');
    gradient.addColorStop(1, 'rgba(100,150,255,0)');

    c.strokeStyle = gradient;
    c.shadowBlur = p.glow;

    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(tailX, tailY);
    c.stroke();

    // Sharp inner trail
    c.globalAlpha = alpha * 0.95;
    c.strokeStyle = '#ffffff';
    c.lineWidth = p.size * 0.85;
    c.shadowBlur = 5;

    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(tailX * 0.55, tailY * 0.55);
    c.stroke();

    // Meteor head
    c.globalAlpha = alpha;
    c.fillStyle = '#ffffff';
    c.shadowColor = '#a9d7ff';
    c.shadowBlur = p.glow;

    c.beginPath();
    c.arc(0, 0, p.size * 1.5, 0, Math.PI * 2);
    c.fill();

    c.restore();
    c.globalAlpha = 1;
  },
},
  fireflies: {
    count: 16,
    additive: true,
    spawn: (w, h) => base({ x: R() * w, y: h * (0.25 + R() * 0.75), size: 1.4 + R() * 1.6, max: 5 + R() * 5, vx: (R() - 0.5) * 16, vy: (R() - 0.5) * 12 }),
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t * 0.9 + p.phase) * 12) * dt;
      p.y += (p.vy + Math.cos(t * 0.7 + p.phase) * 10) * dt;
    },
    draw: (c, p, t) => {
      const blink = Math.max(0, Math.sin(t * 1.6 + p.phase * 3));
      c.globalAlpha = fade(p) * (0.25 + blink * 0.75);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, p.size * 5);
      g.addColorStop(0, 'rgba(240,255,150,1)');
      g.addColorStop(0.25, 'rgba(200,255,90,.55)');
      g.addColorStop(1, 'rgba(160,255,60,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, p.size * 5, 0, Math.PI * 2);
      c.fill();
    },
  },
  aurora: {
    count: 14,
    additive: true,
    spawn: (w, h) => base({ x: R() * w, y: R() * h * 0.35, size: 0.6 + R() * 1.2, max: 2 + R() * 4 }),
    draw: (c, p) => {
      c.globalAlpha = Math.sin((p.life / p.max) * Math.PI) * 0.8;
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(0, 0, p.size, 0, Math.PI * 2);
      c.fill();
    },
    backdrop: (c, w, h, t) => {
      for (let band = 0; band < 3; band++) {
        const hue = [150, 175, 280][band];
        c.beginPath();
        c.moveTo(0, 0);
        for (let x = 0; x <= w; x += 8) {
          const y = h * (0.16 + band * 0.07) + Math.sin(x / (60 + band * 25) + t * (0.6 + band * 0.2)) * 14 + Math.sin(x / 23 + t * 1.3) * 4;
          c.lineTo(x, y);
        }
        c.lineTo(w, 0);
        c.closePath();
        const g = c.createLinearGradient(0, 0, 0, h * 0.45);
        g.addColorStop(0, `hsla(${hue} 100% 60% / 0)`);
        g.addColorStop(0.7, `hsla(${hue} 100% 62% / ${0.16 + Math.sin(t * 0.8 + band) * 0.05})`);
        g.addColorStop(1, `hsla(${hue} 100% 70% / 0)`);
        c.fillStyle = g;
        c.fill();
      }
    },
  },
};

/** Full-card particle effect over a profile. Purely decorative, never blocks clicks. */
export function ProfileEffect({ id, className = '' }: { id?: string | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const def = id ? (EFFECTS[id] ?? (id.startsWith('effect.') ? (shopEffect(id) as EffectDef | undefined) : undefined)) : undefined;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !def) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let ps: P[] = [];
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let t = 0;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!ps.length && w && h) ps = Array.from({ length: def.count }, () => def.spawn(w, h, true)).map((p) => ((p.life = R() * p.max * 0.8), p));
    };
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      ctx.clearRect(0, 0, w, h);
      def.backdrop?.(ctx, w, h, t);
      ctx.globalCompositeOperation = def.additive ? 'lighter' : 'source-over';
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.life += dt;
        def.step?.(p, dt, t, w, h);
        if (p.life > p.max || p.y > h + 20 || p.y < -30 || p.x < -30 || p.x > w + 40) {
          ps[i] = def.spawn(w, h, false);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        def.draw(ctx, p, t);
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (!still && visible) raf = requestAnimationFrame(frame);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was && !still) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(canvas);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [def]);
  if (!def) return null;
  return <canvas ref={ref} className={`profile-effect ${className}`} aria-hidden />;
}
