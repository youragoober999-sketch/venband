import { useSettings } from '../lib/settings';
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
  { id: 'prism', label: 'Prismatic Shards' },
  { id: 'crystals', label: 'Crystal Garden' },
  { id: 'butterflies', label: 'Butterfly Drift' },
  { id: 'music', label: 'Soundwave' },
  { id: 'orbits', label: 'Celestial Orbits' },
  { id: 'runes', label: 'Arcane Runes' },
  { id: 'fireworks', label: 'Starlight Bursts' },
  { id: 'matrix', label: 'Digital Rain' },
  { id: 'geometric', label: 'Geometry Flow' },
  { id: 'galaxy_dust', label: 'Galaxy Dust' },
  { id: 'clouds', label: 'Dream Clouds' },
  { id: 'royal', label: 'Royal Flourish' },
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
interface EffectLayer {
  count: number;
  additive?: boolean;
  spawn: (w: number, h: number, initial: boolean) => P;
  step?: (p: P, dt: number, t: number, w: number, h: number) => void;
  draw: (c: CanvasRenderingContext2D, p: P, t: number) => void;
}
interface EffectDef extends EffectLayer {
  /** Extra particle groups drawn on top of the main one. */
  layers?: EffectLayer[];
  backdrop?: (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}
const R = Math.random;
const base = (o: Partial<P>): P => ({ x: 0, y: 0, vx: 0, vy: 0, size: 3, rot: 0, vr: 0, life: 0, max: 6, hue: 0, phase: R() * Math.PI * 2, depth: 0.4 + R() * 0.6, ...o });
const fade = (p: P) => Math.min(1, p.life / 0.6, (p.max - p.life) / 0.8);

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

type ShapeKind = 'diamond' | 'hexagon' | 'triangle' | 'flower' | 'butterfly' | 'ring' | 'music' | 'crown' | 'rune' | 'spiral' | 'comet' | 'spark';
interface ShapeEffectOptions {
  count: number;
  kind: ShapeKind;
  hue: number;
  hueSpread?: number;
  size: [number, number];
  speed: [number, number];
  rise?: boolean;
  gravity?: number;
  drift?: number;
  lifetime?: [number, number];
  glow?: number;
}

/** Crisp vector silhouettes: no image assets, external fonts, or runtime dependencies. */
function drawVectorShape(c: CanvasRenderingContext2D, kind: ShapeKind, s: number, t: number, phase: number) {
  c.beginPath();
  switch (kind) {
    case 'diamond':
      c.moveTo(0, -s); c.lineTo(s * 0.72, 0); c.lineTo(0, s); c.lineTo(-s * 0.72, 0); c.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const x = Math.cos(a) * s; const y = Math.sin(a) * s; if (!i) c.moveTo(x, y); else c.lineTo(x, y); } c.closePath();
      break;
    case 'triangle':
      for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 3; const x = Math.cos(a) * s; const y = Math.sin(a) * s; if (!i) c.moveTo(x, y); else c.lineTo(x, y); } c.closePath();
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 + t * 0.12; c.moveTo(Math.cos(a) * s * 0.22, Math.sin(a) * s * 0.22); c.ellipse(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, s * 0.27, s * 0.48, a, 0, Math.PI * 2); }
      break;
    case 'butterfly':
      c.moveTo(0, 0); c.bezierCurveTo(-s * 0.2, -s * 1.15, -s * 1.25, -s * 1.1, -s, -s * 0.18); c.bezierCurveTo(-s * 0.92, s * 0.6, -s * 0.28, s * 0.45, 0, 0); c.bezierCurveTo(s * 0.28, s * 0.45, s * 0.92, s * 0.6, s, -s * 0.18); c.bezierCurveTo(s * 1.25, -s * 1.1, s * 0.2, -s * 1.15, 0, 0); c.closePath();
      break;
    case 'ring':
      c.arc(0, 0, s * 0.72, 0, Math.PI * 2); break;
    case 'music':
      c.moveTo(s * 0.35, -s); c.lineTo(s * 0.35, s * 0.35); c.ellipse(0, s * 0.48, s * 0.43, s * 0.27, -0.3, 0, Math.PI * 2); c.moveTo(s * 0.35, -s); c.lineTo(s, -s * 0.78); c.lineTo(s, -s * 0.48); c.lineTo(s * 0.35, -s * 0.68); break;
    case 'crown':
      c.moveTo(-s, s * 0.55); c.lineTo(-s * 0.82, -s * 0.55); c.lineTo(-s * 0.25, -s * 0.05); c.lineTo(0, -s); c.lineTo(s * 0.28, -s * 0.05); c.lineTo(s * 0.82, -s * 0.55); c.lineTo(s, s * 0.55); c.closePath();
      break;
    case 'rune':
      c.moveTo(0, -s); c.lineTo(s * 0.68, s); c.lineTo(-s * 0.68, s); c.closePath(); c.moveTo(-s * 0.38, 0); c.lineTo(s * 0.38, 0); c.moveTo(0, -s * 0.45); c.lineTo(0, s * 0.62); break;
    case 'spiral':
      for (let i = 0; i <= 42; i++) { const a = i / 42 * Math.PI * 3.5 + phase; const r = s * 0.08 + s * 0.72 * i / 42; const x = Math.cos(a) * r; const y = Math.sin(a) * r; if (!i) c.moveTo(x, y); else c.lineTo(x, y); } break;
    case 'comet':
      c.moveTo(-s * 1.2, s * 0.2); c.quadraticCurveTo(-s * 0.15, -s * 0.45, s * 0.9, -s * 0.9); c.quadraticCurveTo(s * 0.35, s * 0.05, -s * 1.2, s * 0.2); c.closePath(); break;
    default:
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const r = i % 2 ? s * 0.22 : s; const x = Math.cos(a) * r; const y = Math.sin(a) * r; if (!i) c.moveTo(x, y); else c.lineTo(x, y); } c.closePath();
  }
}

function makeShapeEffect(o: ShapeEffectOptions): EffectDef {
  return {
    count: o.count,
    additive: true,
    spawn: (w, h, initial) => {
      const speed = o.speed[0] + R() * (o.speed[1] - o.speed[0]);
      const rise = o.rise !== false;
      return base({
        x: R() * w,
        y: initial ? R() * h : (rise ? h + 24 : -24),
        vx: (R() - 0.5) * (o.drift ?? 24),
        vy: rise ? -speed : speed,
        size: o.size[0] + R() * (o.size[1] - o.size[0]),
        max: o.lifetime ? o.lifetime[0] + R() * (o.lifetime[1] - o.lifetime[0]) : 4 + R() * 5,
        hue: o.hue + R() * (o.hueSpread ?? 36),
        rot: R() * Math.PI * 2,
        vr: (R() - 0.5) * 2.4,
        depth: 0.35 + R() * 0.65,
      });
    },
    step: (p, dt, t) => {
      p.y += (p.vy + Math.sin(t * 1.1 + p.phase) * (o.drift ?? 24) * 0.22) * dt * p.depth;
      p.x += (p.vx + Math.cos(t * 0.8 + p.phase) * (o.drift ?? 24) * 0.35) * dt * p.depth;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      const alpha = fade(p) * (0.55 + p.depth * 0.45);
      const pulse = 0.88 + Math.sin(t * 2.2 + p.phase) * 0.12;
      const size = p.size * pulse;
      c.save();
      c.rotate(p.rot);
      c.globalAlpha = alpha;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.shadowColor = `hsl(${p.hue} 100% 68%)`;
      c.shadowBlur = o.glow ?? 12;
      const grad = c.createLinearGradient(-size, -size, size, size);
      grad.addColorStop(0, `hsl(${p.hue} 100% 94%)`);
      grad.addColorStop(0.48, `hsl(${p.hue + 12} 100% 70%)`);
      grad.addColorStop(1, `hsl(${p.hue + 28} 92% 48%)`);
      c.fillStyle = grad;
      c.strokeStyle = 'rgba(255,255,255,.72)';
      c.lineWidth = Math.max(0.55, size * 0.075);
      drawVectorShape(c, o.kind, size, t, p.phase);
      if (o.kind === 'ring' || o.kind === 'spiral' || o.kind === 'rune') c.stroke();
      else { c.fill(); c.stroke(); }
      if (o.kind === 'diamond' || o.kind === 'hexagon') {
        c.globalAlpha = alpha * 0.42;
        c.beginPath(); c.moveTo(0, -size); c.lineTo(size * 0.08, 0); c.lineTo(0, size); c.closePath();
        c.fillStyle = '#fff'; c.fill();
      }
      c.restore();
    },
    backdrop: (c, w, h, t) => {
      const g = c.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.72);
      g.addColorStop(0, `hsla(${o.hue + 12} 95% 58% / ${0.035 + Math.sin(t * 0.55) * 0.012})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    },
  };
}

const EFFECTS: Record<string, EffectDef> = {
  sparkles: {
    count: 34,
    additive: true,
    spawn: (w, h) => base({
      x: R() * w, y: R() * h,
      size: 1.5 + R() * 4.5,
      max: 1.8 + R() * 2.8,
      hue: R() < 0.72 ? 46 + R() * 16 : 185 + R() * 55,
      vy: -3 - R() * 9,
      depth: 0.35 + R() * 0.65,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += Math.sin(t * 0.8 + p.phase) * 3 * dt;
      p.rot += dt * (0.3 + p.depth);
    },
    draw: (c, p, t) => {
      const pulse = Math.pow(Math.max(0, Math.sin((p.life / p.max) * Math.PI)), 0.7);
      const shimmer = 0.72 + Math.sin(t * 5 + p.phase) * 0.28;
      c.globalAlpha = pulse * shimmer;
      c.fillStyle = `hsl(${p.hue} 100% 88%)`;
      c.shadowColor = `hsl(${p.hue} 100% 70%)`;
      c.shadowBlur = 7 + p.size * 2;
      c.rotate(p.rot + Math.sin(t + p.phase) * 0.2);
      star4(c, p.size * (0.35 + pulse * 0.65));
      c.fill();
      c.globalAlpha *= 0.35;
      c.beginPath();
      c.arc(0, 0, p.size * 1.8, 0, Math.PI * 2);
      c.fill();
    },
  },



  sakura: {
    count: 30,
    spawn: (w, h, init) => base({
      x: R() * w * 1.25, y: init ? R() * h : -16,
      vx: -9 - R() * 18, vy: 17 + R() * 27,
      size: 3 + R() * 4.5,
      vr: (R() - 0.5) * 3.5,
      max: 8 + R() * 5,
      hue: 330 + R() * 22,
      depth: 0.35 + R() * 0.65,
    }),
    step: fall([17, 44], 19),
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * (0.48 + p.depth * 0.52);
      c.rotate(p.rot);
      c.scale(Math.cos(t * (1.7 + p.depth) + p.phase), 1);
      const g = c.createLinearGradient(0, -p.size, 0, p.size);
      g.addColorStop(0, '#fff8fb');
      g.addColorStop(0.55, '#ffc5dc');
      g.addColorStop(1, '#f47eaa');
      c.fillStyle = g;
      c.shadowColor = '#ff9fc5';
      c.shadowBlur = 5;
      petal(c, p.size);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.35)';
      c.lineWidth = 0.55;
      c.stroke();
    },
  },

  snow: {
    count: 58,
    spawn: (w, h, init) => base({
      x: R() * w, y: init ? R() * h : -10,
      vy: 12 + R() * 30, vx: (R() - 0.5) * 9,
      size: 0.7 + R() * 2.8,
      max: 12 + R() * 7,
      depth: 0.25 + R() * 0.75,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 0.65 + p.phase) * (5 + p.size * 2)) * dt * p.depth;
    },
    draw: (c, p, t) => {
      const pulse = 0.8 + Math.sin(t * 2 + p.phase) * 0.2;
      c.globalAlpha = fade(p) * (0.35 + p.depth * 0.65) * pulse;
      c.fillStyle = '#f7fbff';
      c.shadowColor = '#b9dcff';
      c.shadowBlur = 3 + p.size * 2;
      c.beginPath();
      c.arc(0, 0, p.size * p.depth, 0, Math.PI * 2);
      c.fill();
      if (p.size > 2.2) {
        c.globalAlpha *= 0.45;
        c.strokeStyle = '#fff';
        c.lineWidth = 0.65;
        c.beginPath();
        c.moveTo(-p.size * 1.7, 0);
        c.lineTo(p.size * 1.7, 0);
        c.moveTo(0, -p.size * 1.7);
        c.lineTo(0, p.size * 1.7);
        c.stroke();
      }
    },
  },

  embers: {
    count: 42,
    additive: true,
    spawn: (w, h, init) => base({
      x: R() * w, y: init ? h * (0.35 + R() * 0.65) : h + 8,
      vx: (R() - 0.5) * 15,
      vy: -(14 + R() * 43),
      size: 0.7 + R() * 2.1,
      max: 2.2 + R() * 3.8,
      hue: 12 + R() * 35,
      depth: 0.4 + R() * 0.6,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 2.4 + p.phase) * 15) * dt;
    },
    draw: (c, p, t) => {
      const flicker = 0.58 + Math.pow(Math.max(0, Math.sin(t * 13 + p.phase * 4)), 1.5) * 0.42;
      const a = fade(p) * flicker;
      c.globalAlpha = a * 0.32;
      c.fillStyle = `hsl(${p.hue} 100% 55%)`;
      c.shadowColor = `hsl(${p.hue} 100% 55%)`;
      c.shadowBlur = 15;
      c.beginPath();
      c.arc(0, 0, p.size * 3.2, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = a;
      c.fillStyle = `hsl(${p.hue} 100% ${62 + flicker * 18}%)`;
      c.shadowBlur = 7;
      c.beginPath();
      c.arc(0, 0, p.size, 0, Math.PI * 2);
      c.fill();
    },
    backdrop: (c, w, h, t) => {
      const g = c.createLinearGradient(0, h, 0, h * 0.42);
      g.addColorStop(0, `rgba(255,72,18,${0.16 + Math.sin(t * 1.4) * 0.035})`);
      g.addColorStop(1, 'rgba(255,90,20,0)');
      c.fillStyle = g;
      c.fillRect(0, h * 0.42, w, h * 0.58);
    },
  },

  leaves: {
    count: 30,
    spawn: (w, h, init) => base({
      x: R() * w * 1.2, y: init ? R() * h : -18,
      vx: -8 - R() * 17, vy: 16 + R() * 28,
      size: 4.5 + R() * 6,
      vr: (R() - 0.5) * 2.8,
      hue: 15 + R() * 38,
      max: 8 + R() * 5,
      depth: 0.35 + R() * 0.65,
    }),
    step: fall([16, 44], 25),
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * (0.55 + p.depth * 0.45);
      c.rotate(p.rot);
      c.scale(0.75 + Math.abs(Math.cos(t * 1.3 + p.phase)) * 0.35, Math.cos(t * 1.8 + p.phase));
      const g = c.createLinearGradient(-p.size, -p.size, p.size, p.size);
      g.addColorStop(0, `hsl(${p.hue} 95% 69%)`);
      g.addColorStop(1, `hsl(${p.hue + 8} 90% 34%)`);
      c.fillStyle = g;
      c.shadowColor = `hsl(${p.hue} 90% 45%)`;
      c.shadowBlur = 3;
      leaf(c, p.size);
      c.fill();
      c.strokeStyle = 'rgba(70,35,12,.55)';
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(0, -p.size * 0.8);
      c.lineTo(0, p.size * 0.8);
      c.stroke();
    },
  },

  bubbles: {
    count: 24,
    spawn: (w, h, init) => base({
      x: R() * w, y: init ? R() * h : h + 14,
      vx: (R() - 0.5) * 8,
      vy: -(12 + R() * 25),
      size: 2.5 + R() * 8,
      max: 7 + R() * 5,
      hue: 180 + R() * 65,
      depth: 0.35 + R() * 0.65,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 1.8 + p.phase) * 10) * dt;
    },
    draw: (c, p, t) => {
      const s = p.size * (1 + Math.sin(t * 2.7 + p.phase) * 0.045);
      c.globalAlpha = fade(p) * (0.5 + p.depth * 0.5);
      const g = c.createRadialGradient(-s * 0.35, -s * 0.4, s * 0.05, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,.78)');
      g.addColorStop(0.35, `hsla(${p.hue} 100% 85% / .2)`);
      g.addColorStop(1, `hsla(${p.hue} 100% 72% / .08)`);
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, s, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = `hsla(${p.hue} 100% 88% / .7)`;
      c.lineWidth = 0.8;
      c.stroke();
      c.globalAlpha *= 0.7;
      c.fillStyle = 'rgba(255,255,255,.8)';
      c.beginPath();
      c.ellipse(-s * 0.3, -s * 0.38, s * 0.17, s * 0.1, -0.6, 0, Math.PI * 2);
      c.fill();
    },
  },

  confetti: {
    count: 54,
    spawn: (w, h, init) => base({
      x: R() * w, y: init ? R() * h * 0.9 : -12,
      vy: 22 + R() * 43, vx: (R() - 0.5) * 38,
      size: 2 + R() * 3.5,
      vr: (R() - 0.5) * 9,
      hue: [350, 45, 140, 190, 275, 310][Math.floor(R() * 6)],
      max: 6 + R() * 3,
      depth: 0.45 + R() * 0.55,
    }),
    step: (p, dt, t) => {
      p.y += p.vy * dt * p.depth;
      p.x += (p.vx + Math.sin(t * 2.5 + p.phase) * 20) * dt;
      p.rot += p.vr * dt;
    },
    draw: (c, p, t) => {
      c.globalAlpha = fade(p) * (0.65 + p.depth * 0.35);
      c.rotate(p.rot);
      const flip = Math.max(0.12, Math.abs(Math.cos(t * 5 + p.phase)));
      c.scale(flip, 1);
      c.fillStyle = `hsl(${p.hue} 92% 62%)`;
      c.shadowColor = `hsl(${p.hue} 100% 65%)`;
      c.shadowBlur = 3;
      c.fillRect(-p.size, -p.size * 0.48, p.size * 2, p.size * 0.96);
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.fillRect(-p.size * 0.65, -p.size * 0.3, p.size * 0.55, p.size * 0.25);
    },
  },

  shooting_stars: {
    count: 52,
    additive: true,
    spawn: (w, h, init) => {
      // Most particles are distant stars; meteors are deliberately less frequent.
      if (init || R() > 0.11) {
        return base({
          x: R() * w,
          y: R() * h,
          size: 0.35 + R() * 1.35,
          max: 3 + R() * 5,
          hue: 0,
          depth: 0.25 + R() * 0.75,
          phase: R() * Math.PI * 2,
        });
      }
      const angle = Math.PI * (0.19 + R() * 0.13);
      const speed = 390 + R() * 650;
      return base({
        x: w * (0.28 + R() * 0.95),
        y: -18 + R() * h * 0.58,
        vx: -Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + R() * 1.7,
        max: 0.75 + R() * 0.85,
        hue: 1,
        depth: 0.7 + R() * 0.3,
        phase: R() * Math.PI * 2,
        // Stored in existing particle fields to keep the public P shape stable.
        rot: 70 + R() * 150,
        vr: 12 + R() * 18,
      });
    },
    step: (p, dt) => {
      if (p.hue === 1) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.phase += dt * p.vr;
      } else {
        p.phase += dt * (0.7 + p.depth);
      }
    },
    draw: (c, p, t) => {
      if (p.hue !== 1) {
        const pulse = 0.28 + (Math.sin(t * (1.2 + p.depth) + p.phase) * 0.5 + 0.5) * 0.65;
        c.globalAlpha = pulse * fade(p) * (0.45 + p.depth * 0.55);
        c.fillStyle = '#f4f8ff';
        c.shadowColor = '#9cc7ff';
        c.shadowBlur = p.size > 1.1 ? 7 : 3;
        c.beginPath();
        c.arc(0, 0, p.size * p.depth, 0, Math.PI * 2);
        c.fill();
        if (p.size > 1.25) {
          c.globalAlpha *= 0.24;
          c.beginPath();
          c.arc(0, 0, p.size * 2.4, 0, Math.PI * 2);
          c.fill();
        }
        return;
      }

      const progress = Math.max(0, Math.min(1, p.life / p.max));
      const envelope = Math.pow(Math.sin(progress * Math.PI), 0.72);
      const flicker = 0.9 + Math.sin(p.phase) * 0.1;
      const alpha = envelope * flicker;
      const speed = Math.max(1, Math.hypot(p.vx, p.vy));
      const length = p.rot;
      const tailX = (-p.vx / speed) * length;
      const tailY = (-p.vy / speed) * length;

      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';

      // Wide, soft atmospheric halo.
      c.globalAlpha = alpha * 0.13;
      c.strokeStyle = '#79baff';
      c.lineWidth = p.size * 10;
      c.shadowColor = '#78baff';
      c.shadowBlur = 25;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(tailX, tailY);
      c.stroke();

      // Colored ionized trail.
      c.globalAlpha = alpha * 0.58;
      c.lineWidth = p.size * 3.8;
      c.shadowBlur = 13;
      const trail = c.createLinearGradient(0, 0, tailX, tailY);
      trail.addColorStop(0, 'rgba(255,255,255,1)');
      trail.addColorStop(0.18, 'rgba(190,225,255,.96)');
      trail.addColorStop(0.58, 'rgba(105,170,255,.48)');
      trail.addColorStop(1, 'rgba(105,150,255,0)');
      c.strokeStyle = trail;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(tailX, tailY);
      c.stroke();

      // Fine bright filament inside the trail.
      c.globalAlpha = alpha * 0.92;
      c.strokeStyle = 'rgba(255,255,255,.96)';
      c.lineWidth = Math.max(0.65, p.size * 0.72);
      c.shadowColor = '#fff';
      c.shadowBlur = 5;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(tailX * 0.52, tailY * 0.52);
      c.stroke();

      // White-hot head with a blue corona.
      c.globalAlpha = alpha;
      c.fillStyle = '#fff';
      c.shadowColor = '#9ed3ff';
      c.shadowBlur = 18;
      c.beginPath();
      c.arc(0, 0, p.size * 1.55, 0, Math.PI * 2);
      c.fill();

      c.shadowBlur = 0;
      c.beginPath();
      c.arc(0, 0, p.size * 0.62, 0, Math.PI * 2);
      c.fill();
      c.restore();
    },
  },

  fireflies: {
    count: 24,
    additive: true,
    spawn: (w, h) => base({
      x: R() * w, y: h * (0.2 + R() * 0.8),
      size: 1.1 + R() * 1.9,
      max: 5 + R() * 6,
      vx: (R() - 0.5) * 17,
      vy: (R() - 0.5) * 13,
      hue: 72 + R() * 35,
      depth: 0.35 + R() * 0.65,
    }),
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t * 0.75 + p.phase) * 13) * dt;
      p.y += (p.vy + Math.cos(t * 0.65 + p.phase) * 10) * dt;
    },
    draw: (c, p, t) => {
      const blink = Math.pow(Math.max(0, Math.sin(t * (1.1 + p.depth * 0.7) + p.phase * 2.5)), 2);
      const alpha = fade(p) * (0.12 + blink * 0.88);
      const radius = p.size * (4.5 + blink * 2);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, radius);
      g.addColorStop(0, `hsla(${p.hue} 100% 88% / ${alpha})`);
      g.addColorStop(0.2, `hsla(${p.hue} 100% 68% / ${alpha * 0.55})`);
      g.addColorStop(1, `hsla(${p.hue} 100% 55% / 0)`);
      c.globalAlpha = 1;
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, radius, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = alpha;
      c.fillStyle = '#f7ffd0';
      c.shadowColor = '#dfff75';
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(0, 0, p.size * 0.7, 0, Math.PI * 2);
      c.fill();
    },
  },

  aurora: {
    count: 22,
    additive: true,
    spawn: (w, h) => base({
      x: R() * w, y: R() * h * 0.38,
      size: 0.5 + R() * 1.4,
      max: 3 + R() * 5,
      hue: 150 + R() * 100,
      depth: 0.3 + R() * 0.7,
    }),
    step: (p, dt, t) => {
      p.x += Math.sin(t * 0.25 + p.phase) * 4 * dt;
      p.phase += dt * 0.35;
    },
    draw: (c, p, t) => {
      const pulse = 0.45 + Math.sin(t * 0.8 + p.phase) * 0.2;
      c.globalAlpha = fade(p) * pulse;
      c.fillStyle = '#eaffff';
      c.shadowColor = `hsl(${p.hue} 100% 75%)`;
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(0, 0, p.size, 0, Math.PI * 2);
      c.fill();
    },
    backdrop: (c, w, h, t) => {
      // Layered translucent curtains with independently moving wave fronts.
      const bands = [
        { hue: 145, y: 0.13, amp: 19, speed: 0.42, width: 0.22 },
        { hue: 172, y: 0.20, amp: 25, speed: 0.31, width: 0.19 },
        { hue: 205, y: 0.25, amp: 16, speed: 0.52, width: 0.15 },
        { hue: 275, y: 0.17, amp: 12, speed: 0.24, width: 0.11 },
      ];
      for (const [i, band] of bands.entries()) {
        const top = h * band.y;
        const g = c.createLinearGradient(0, top - 8, 0, top + h * band.width);
        g.addColorStop(0, `hsla(${band.hue} 100% 65% / 0)`);
        g.addColorStop(0.35, `hsla(${band.hue} 100% 64% / ${0.10 + Math.sin(t * 0.7 + i) * 0.025})`);
        g.addColorStop(0.72, `hsla(${band.hue} 100% 68% / ${0.055 + Math.sin(t * 0.5 + i) * 0.018})`);
        g.addColorStop(1, `hsla(${band.hue} 100% 70% / 0)`);
        c.beginPath();
        c.moveTo(0, 0);
        for (let x = 0; x <= w + 8; x += 6) {
          const wave = Math.sin(x / (58 + i * 19) + t * band.speed) * band.amp
            + Math.sin(x / (23 + i * 7) - t * 0.7) * 5;
          c.lineTo(x, top + wave);
        }
        c.lineTo(w, 0);
        c.closePath();
        c.fillStyle = g;
        c.fill();
      }
      const haze = c.createLinearGradient(0, 0, 0, h * 0.55);
      haze.addColorStop(0, 'rgba(30,80,110,.08)');
      haze.addColorStop(1, 'rgba(30,80,110,0)');
      c.fillStyle = haze;
      c.fillRect(0, 0, w, h * 0.55);
    },
  },

  // New vector-rich effects. Each uses a distinct silhouette and motion profile.
  prism: makeShapeEffect({ count: 28, kind: 'diamond', hue: 185, hueSpread: 145, size: [3, 9], speed: [9, 24], rise: false, drift: 14, glow: 16 }),
  crystals: makeShapeEffect({ count: 25, kind: 'hexagon', hue: 178, hueSpread: 72, size: [3, 8], speed: [8, 22], rise: false, drift: 10, glow: 18 }),
  butterflies: makeShapeEffect({ count: 17, kind: 'butterfly', hue: 292, hueSpread: 65, size: [4, 9], speed: [8, 19], rise: true, drift: 42, glow: 13, lifetime: [6, 10] }),
  music: makeShapeEffect({ count: 22, kind: 'music', hue: 268, hueSpread: 85, size: [3, 7], speed: [12, 28], rise: true, drift: 28, glow: 14 }),
  orbits: makeShapeEffect({ count: 30, kind: 'ring', hue: 195, hueSpread: 105, size: [3, 8], speed: [2, 9], rise: true, drift: 34, glow: 16, lifetime: [5, 9] }),
  runes: makeShapeEffect({ count: 19, kind: 'rune', hue: 260, hueSpread: 55, size: [5, 11], speed: [5, 13], rise: true, drift: 12, glow: 18, lifetime: [5, 9] }),
  fireworks: makeShapeEffect({ count: 42, kind: 'spark', hue: 35, hueSpread: 310, size: [2, 6], speed: [18, 48], rise: false, drift: 55, glow: 20, lifetime: [2.5, 4.5] }),
  matrix: makeShapeEffect({ count: 34, kind: 'hexagon', hue: 112, hueSpread: 24, size: [1.5, 4], speed: [22, 52], rise: false, drift: 5, glow: 9 }),
  geometric: makeShapeEffect({ count: 32, kind: 'triangle', hue: 205, hueSpread: 135, size: [3, 8], speed: [7, 20], rise: true, drift: 32, glow: 13 }),
  galaxy_dust: makeShapeEffect({ count: 46, kind: 'spiral', hue: 270, hueSpread: 85, size: [2, 6], speed: [3, 12], rise: true, drift: 24, glow: 15, lifetime: [5, 10] }),
  clouds: makeShapeEffect({ count: 20, kind: 'comet', hue: 190, hueSpread: 75, size: [4, 11], speed: [4, 12], rise: true, drift: 20, glow: 12, lifetime: [6, 11] }),
  royal: makeShapeEffect({ count: 24, kind: 'crown', hue: 38, hueSpread: 25, size: [3, 8], speed: [7, 17], rise: true, drift: 17, glow: 17, lifetime: [5, 9] }),
};

/** Decorative profile canvas. Catalog tiles animate only during interaction. */
export function ProfileEffect({ id, className = '', preview = false }: { id?: string | null; className?: string; preview?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useSettings((settings) => settings.chat.reduceMotion);
  const love = id === 'hearts' || Boolean(id?.startsWith('effect.hearts.'));
  const def = id === 'hearts' ? shopEffect('effect.hearts.rose') :
    id ? (EFFECTS[id] ?? shopEffect(id)) : undefined;

  useEffect(() => {
    const canvas = ref.current;
    const host = (preview ? canvas?.closest<HTMLElement>('article, label, button') : null) ?? canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx || !def) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const layers = [def, ...(def.layers ?? [])];
    let groups: P[][] = [];
    let width = 0, height = 0, elapsed = 0;
    let raf = 0, last = 0, costlyFrames = 0, cheapFrames = 0;
    let visible = false, hovering = false, focused = host.matches(':focus-within');
    let needsPaint = true, constrained = false;
    const pulses: { x: number; y: number; start: number }[] = [];
    const still = () => reduceMotion || motion.matches;
    const animate = () => visible && !document.hidden && !still() && (!preview || hovering || focused);

    function sync() {
      if (visible && !document.hidden && (animate() || needsPaint)) {
        if (!raf) raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      }
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, preview || constrained ? 1 : 1.5,
        Math.sqrt(310_000 / (rect.width * rect.height)));
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (width === rect.width && height === rect.height && canvas!.width === pixelWidth && canvas!.height === pixelHeight && groups.length) return;
      const oldWidth = width;
      const oldHeight = height;
      width = rect.width;
      height = rect.height;
      canvas!.width = pixelWidth;
      canvas!.height = pixelHeight;
      ctx!.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
      for (const group of groups) {
        for (const particle of group) {
          particle.x *= width / oldWidth;
          particle.y *= height / oldHeight;
        }
      }
      needsPaint = true;
      sync();
    }

    function frame(now: number) {
      raf = 0;
      if (!visible || document.hidden || !width || !height) return;
      const moving = animate();
      const interval = preview || constrained ? 1000 / 30 : 1000 / 60;
      if (moving && last && now - last < interval - 2) {
        sync();
        return;
      }
      const dt = moving ? Math.min(0.05, last ? (now - last) / 1000 : 1 / 60) : 0;
      last = moving ? now : 0;
      elapsed += dt;
      const started = performance.now();
      const c = ctx!;
      if (!groups.length) {
        groups = layers.map((layer) => Array.from({ length: layer.count }, () => {
          const particle = layer.spawn(width, height, true);
          particle.life = R() * particle.max * 0.8;
          return particle;
        }));
      }

      c.clearRect(0, 0, width, height);
      c.save();
      def!.backdrop?.(c, width, height, elapsed);
      c.restore();

      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex];
        const particles = groups[layerIndex];
        const count = Math.ceil(particles.length * (preview ? 0.45 : constrained ? 0.68 : 1));
        c.globalCompositeOperation = (layer.additive ?? def!.additive) ? 'lighter' : 'source-over';
        for (let i = 0; i < count; i++) {
          const p = particles[i];
          p.life += dt;
          if (moving) (layer.step ?? def!.step)?.(p, dt, elapsed, width, height);
          if (p.life > p.max || p.y > height + 24 || p.y < -34 || p.x < -34 || p.x > width + 44) {
            particles[i] = layer.spawn(width, height, false);
            continue;
          }
          c.save();
          c.translate(p.x, p.y);
          layer.draw(c, p, elapsed);
          c.restore();
        }
      }
      c.globalCompositeOperation = 'source-over';
      if (moving) {
        for (let i = pulses.length - 1; i >= 0; i--) {
          const pulse = pulses[i];
          const age = (elapsed - pulse.start) / 0.7;
          if (age >= 1) {
            pulses.splice(i, 1);
            continue;
          }
          c.save();
          c.translate(pulse.x, pulse.y);
          c.globalAlpha = (1 - age) * 0.8;
          c.strokeStyle = love ? '#ff91bd' : '#d8e8ff';
          c.lineWidth = 2 * (1 - age) + 0.5;
          c.beginPath();
          for (let ray = 0; ray < 12; ray++) {
            const angle = ray * Math.PI / 6;
            const inner = 7 + age * 52;
            const outer = inner + (1 - age) * 12;
            c.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
            c.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
          }
          c.stroke();
          if (love) {
            const size = 9 + age * 23;
            c.beginPath();
            c.moveTo(0, size * 0.66);
            c.bezierCurveTo(-size * 1.55, -size * 0.37, -size * 0.64, -size * 1.14, 0, -size * 0.42);
            c.bezierCurveTo(size * 0.64, -size * 1.14, size * 1.55, -size * 0.37, 0, size * 0.66);
            c.stroke();
          }
          c.restore();
        }
      }
      needsPaint = false;
      if (moving && !preview) {
        const cost = performance.now() - started;
        costlyFrames = cost > 7 ? costlyFrames + 1 : 0;
        cheapFrames = cost < 3 ? cheapFrames + 1 : 0;
        if (!constrained && costlyFrames >= 8) {
          constrained = true;
          cheapFrames = 0;
          resize();
        } else if (constrained && cheapFrames >= 120) {
          constrained = false;
          costlyFrames = 0;
          resize();
        }
      }
      sync();
    }

    const onEnter = (event: PointerEvent) => { hovering = event.pointerType !== 'touch'; sync(); };
    const onLeave = () => { hovering = false; sync(); };
    const onFocus = () => { focused = true; sync(); };
    const onBlur = (event: FocusEvent) => { focused = event.relatedTarget instanceof Node && host.contains(event.relatedTarget); sync(); };
    const onClick = (event: MouseEvent) => {
      if (!animate() || event.detail === 0) return;
      const rect = canvas.getBoundingClientRect();
      if (pulses.length >= 3) pulses.shift();
      pulses.push({ x: event.clientX - rect.left, y: event.clientY - rect.top, start: elapsed });
    };
    const onMotion = () => {
      pulses.length = 0;
      last = 0;
      needsPaint = true;
      sync();
    };
    const ro = new ResizeObserver(resize);
    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (!visible) pulses.length = 0;
      sync();
    });
    ro.observe(canvas);
    io.observe(canvas);
    if (preview) {
      host.addEventListener('pointerenter', onEnter);
      host.addEventListener('pointerleave', onLeave);
      host.addEventListener('focusin', onFocus);
      host.addEventListener('focusout', onBlur);
    }
    host.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', onMotion);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('focusin', onFocus);
      host.removeEventListener('focusout', onBlur);
      host.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', onMotion);
      ro.disconnect();
      io.disconnect();
    };
  }, [def, love, preview, reduceMotion]);
  return def ? <canvas ref={ref} className={`profile-effect ${className}`} aria-hidden /> : null;
}
