// Nameplates from the Venband Shop: animated scenes behind your name in member
// lists. Palette colours arrive as CSS variables (--a --b --c --d); the scene
// sits right of the name and fades out behind it (see .np-art in cosmetics.css).
import type { CSSProperties, ReactNode } from 'react';
import { ITEMS } from '../lib/shop';
import './shopplates.css';

type Vars = CSSProperties & Record<`--${string}`, string | number>;
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}
/** n particles with deterministic random position / size / timing (CSS vars) */
function bits(seed: string, n: number, cls: string, o: { x?: [number, number]; y?: [number, number]; s?: [number, number]; t?: [number, number] } = {}, inner?: ReactNode) {
  const r = rng(seed);
  const pick = ([a, b]: [number, number]) => a + r() * (b - a);
  return Array.from({ length: n }, (_, i) => {
    const t = pick(o.t ?? [3, 7]);
    const style: Vars = { '--x': pick(o.x ?? [30, 100]).toFixed(1), '--y': pick(o.y ?? [0, 100]).toFixed(1), '--s': pick(o.s ?? [2, 4]).toFixed(2), '--t': `${t.toFixed(2)}s`, '--d': `${(-r() * t).toFixed(2)}s`, '--r': `${Math.round(r() * 360)}deg` };
    return (
      <i key={i} className={cls} style={style}>
        {inner}
      </i>
    );
  });
}
const svg = (children: ReactNode, cls = 'sp-svg') => (
  <svg className={cls} viewBox="0 0 240 44" preserveAspectRatio="xMaxYMid slice" aria-hidden>
    {children}
  </svg>
);
const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2 0 3.6 1.1 4.6 2.6l1 1.4 1-1.4C14 6.1 15.6 5 17.6 5 21 5 23.1 8.5 21.6 11.8 19.5 16.4 12 21 12 21z';
const heartSvg = <svg viewBox="0 0 24 24"><path d={HEART} fill="currentColor" /></svg>;
const batSvg = <svg viewBox="0 0 24 12"><path d="M12 4c-2-4-6-5-12-3 3 1 4 4 3 6 3-1 6 0 7 3 1-2 1-3 2-3s1 1 2 3c1-3 4-4 7-3-1-2 0-5 3-6-6-2-10-1-12 3Z" fill="currentColor" /></svg>;
const crowSvg = <svg viewBox="0 0 24 10"><path d="M0 3c4-3 8-2 12 3 4-5 8-6 12-3-4 0-7 2-9 6h-6C7 5 4 3 0 3Z" fill="currentColor" /></svg>;

const SCENES: Record<string, () => ReactNode> = {
  gradient: () => <b className="sp-sky sp-flow" />,
  night_sky: () => (
    <>
      <b className="sp-sky" />
      {bits('ns', 18, 'sp-star', { s: [1, 2.6] })}
      <b className="sp-moon" />
    </>
  ),
  eclipse: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-corona" />
      <b className="sp-disc" />
    </>
  ),
  petals: () => (
    <>
      <b className="sp-sky" />
      {bits('pt', 12, 'sp-petal', { s: [5, 8], t: [4, 8] })}
    </>
  ),
  rain_glass: () => (
    <>
      <b className="sp-sky" />
      {bits('rgl', 6, 'sp-bokeh', { s: [10, 22], y: [10, 90] })}
      {bits('rgd', 20, 'sp-drop', { s: [6, 14], t: [0.9, 2] })}
    </>
  ),
  fire_wall: () => (
    <>
      <b className="sp-sky" />
      {bits('fw', 14, 'sp-flame', { x: [25, 100], y: [55, 70], s: [14, 26], t: [0.5, 1.1] })}
      {bits('fwe', 10, 'sp-ember', { y: [40, 100], s: [1.5, 3], t: [1.4, 2.6] })}
    </>
  ),
  ocean: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          <path className="sp-wave w1" d="M0 30q15-8 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
          <path className="sp-wave w2" d="M0 35q15-6 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
        </>,
      )}
      {bits('oc', 8, 'sp-glint', { y: [10, 60], s: [1.5, 3] })}
    </>
  ),
  snow: () => (
    <>
      <b className="sp-sky" />
      {svg(<path d="M0 44V34q40-14 80-4t80-6 80 4V44Z" className="sp-hill" />)}
      {bits('sn', 24, 'sp-flake', { s: [1.4, 3.4], t: [3, 7] })}
    </>
  ),
  lightning: () => (
    <>
      <b className="sp-sky" />
      {svg(<path className="sp-bolt" d="M170 0l-12 18h10l-16 26 30-30h-12l12-14Z" />)}
      <b className="sp-flash" />
    </>
  ),
  neon_city: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          {[[100, 22], [116, 30], [130, 16], [148, 26], [166, 12], [186, 24], [204, 18], [222, 28]].map(([x, h], i) => (
            <g key={i}>
              <rect x={x} y={44 - h} width="15" height={h} className="sp-bldg" />
              {Array.from({ length: Math.floor(h / 6) }, (_, j) => (
                <rect key={j} x={x + 3 + (j % 2) * 6} y={44 - h + 3 + j * 5} width="3" height="2" className={`sp-win${(i + j) % 3 ? '' : ' off'}`} />
              ))}
            </g>
          ))}
          <text x="168" y="9" className="sp-neon">OPEN</text>
        </>,
      )}
    </>
  ),
  grid: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-sun" />
      <b className="sp-gridlines" />
    </>
  ),
  cipher: () => (
    <>
      <b className="sp-sky" />
      {bits('cp', 14, 'sp-col', { s: [9, 11], t: [2, 4] }, <span>A7#F0=K3/9Q</span>)}
    </>
  ),
  blocks: () => (
    <>
      <b className="sp-sky" />
      {bits('bl', 14, 'sp-block', { s: [5, 7], t: [2, 4] })}
    </>
  ),
  equalizer: () => (
    <>
      <b className="sp-sky" />
      <span className="sp-eq">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ animationDelay: `${-((i * 37) % 10) / 10}s`, animationDuration: `${0.6 + (i % 4) * 0.15}s` }} />)}</span>
    </>
  ),
  butterflies: () => (
    <>
      <b className="sp-sky" />
      {bits('bf', 6, 'sp-bfly', { y: [15, 75], s: [8, 11], t: [7, 12] }, <><em /><em className="r" /></>)}
    </>
  ),
  forest_fog: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          {[110, 128, 146, 160, 178, 196, 214, 230].map((x, i) => (
            <path key={x} d={`M${x} 44V${30 - (i % 3) * 4}l-8 10h5l-6 8h18l-6-8h5Z`} transform={`translate(0 ${i % 2 ? 4 : 0})`} className="sp-pine" />
          ))}
        </>,
      )}
      <b className="sp-fog" />
      <b className="sp-fog f2" />
    </>
  ),
  hearts: () => (
    <>
      <b className="sp-sky" />
      {bits('hr', 10, 'sp-heart', { s: [7, 12], t: [3, 5] }, heartSvg)}
    </>
  ),
  clouds: () => (
    <>
      <b className="sp-sky" />
      {bits('cl', 5, 'sp-cloud', { y: [10, 70], s: [18, 30], t: [14, 24] })}
    </>
  ),
  leopard: () => (
    <>
      <b className="sp-sky sp-spots" />
      <b className="sp-sheen" />
      {bits('lp', 6, 'sp-glint', { s: [1.4, 2.4] })}
    </>
  ),
  roses: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon" />
      {svg(
        <>
          <path d="M60 44c30-16 60-6 90-18s50-14 90-6" className="sp-vine" />
          {[[120, 30], [168, 22], [210, 26]].map(([x, y], i) => (
            <g key={i} className="sp-rose" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${-i}s` }}>
              <circle cx={x} cy={y} r="6.5" />
              <path d={`M${x - 3} ${y - 2}c2-3 6-2 6 1s-4 4-5 1`} className="sp-rose-line" />
            </g>
          ))}
        </>,
      )}
    </>
  ),
  crows: () => (
    <>
      <b className="sp-sky" />
      {bits('cr', 7, 'sp-crow', { y: [10, 70], s: [10, 16], t: [5, 9] }, crowSvg)}
    </>
  ),
  eyes: () => (
    <>
      <b className="sp-sky" />
      {bits('ey', 7, 'sp-eye', { y: [20, 80], s: [5, 8], t: [3.5, 6] }, <><em /><em /></>)}
    </>
  ),
  ghosts: () => (
    <>
      <b className="sp-sky" />
      {bits('gh', 4, 'sp-ghost', { y: [15, 60], s: [11, 15], t: [7, 11] })}
    </>
  ),
  gold_leaf: () => (
    <>
      <b className="sp-sky sp-goldflow" />
      {bits('gl', 10, 'sp-leaf', { s: [3, 6], t: [4, 7] })}
      {bits('gg', 8, 'sp-glint', { s: [1.4, 2.6] })}
    </>
  ),
  starry_night: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          {[[130, 14, 10], [168, 22, 12], [205, 12, 9], [150, 32, 8], [225, 30, 7]].map(([x, y, r], i) => (
            <path key={i} className="sp-swirl" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${-i * 1.3}s` }} d={`M${x - r} ${y}a${r} ${r * 0.7} 0 1 1 ${r * 0.8} ${r * 0.6}`} />
          ))}
          {[[118, 8], [184, 8], [232, 16], [140, 26]].map(([x, y], i) => (
            <g key={i} className="sp-vstar" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${-i * 0.7}s` }}>
              <circle cx={x} cy={y} r="5.5" className="halo" />
              <circle cx={x} cy={y} r="2.6" />
            </g>
          ))}
          <path d="M226 4a7 7 0 1 0 6 10 6 6 0 1 1-6-10Z" className="sp-moonc" />
          <path d="M100 44c2-14 4-26 8-36 3 10 5 22 6 36Z" className="sp-cypress" />
        </>,
      )}
    </>
  ),
  great_wave: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <g className="sp-wavepat">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={i} transform={`translate(${i * 48} 0)`}>
              <path d="M0 44C6 28 18 18 32 16c8-1 14 3 16 8-6-2-12 0-14 4 6 0 10 4 8 8-6-4-14-4-18 2-6 2-12 4-14 6Z" className="sp-wv" />
              <path d="M30 18c4-2 8-2 11 0M28 24c3-2 7-2 10 0" className="sp-foam" />
            </g>
          ))}
        </g>,
      )}
      <b className="sp-fuji" />
    </>
  ),
  gold_mosaic: () => (
    <>
      <b className="sp-sky sp-mosaic" />
      {bits('gm', 8, 'sp-spiral', { y: [15, 85], s: [7, 10], t: [6, 10] })}
      <b className="sp-sheen" />
    </>
  ),
  scream: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <g className="sp-bands">
          {[6, 13, 20, 27].map((y, i) => (
            <path key={y} d={`M0 ${y}q20-6 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0`} className={`sp-band b${i}`} />
          ))}
        </g>,
      )}
      {svg(<path d="M80 44L240 30v4L84 44Z" className="sp-bridge" />)}
    </>
  ),
  moon_voyage: () => (
    <>
      <b className="sp-sky" />
      {bits('mv', 12, 'sp-star', { s: [1, 2.4] })}
      {svg(
        <>
          <g className="sp-mface">
            <circle cx="214" cy="22" r="16" />
            <path d="M206 20c2-2 4-2 6 0M210 30c4 2 8 2 11-1" className="ln" />
            <path d="M218 17h10" className="ln" />
          </g>
          <g className="sp-capsule">
            <path d="M0 0h12q6 3 0 6H0Z" transform="translate(120 26) rotate(-18)" />
          </g>
        </>,
      )}
    </>
  ),
  film_reel: () => (
    <>
      <b className="sp-sky sp-grain" />
      <b className="sp-sprockets" />
      <b className="sp-sprockets bottom" />
      <b className="sp-scratch" />
    </>
  ),
  brick_road: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          <path d="M60 44C110 40 140 34 170 28s40-8 54-10" className="sp-road" />
          <path d="M60 44C110 40 140 34 170 28s40-8 54-10" className="sp-bricks" />
          {[[210, 14], [218, 8], [226, 12], [232, 6]].map(([x, h], i) => (
            <path key={i} d={`M${x - 3} 20V${20 - h}l3-4 3 4V20Z`} className="sp-tower" />
          ))}
        </>,
      )}
      {bits('oz', 8, 'sp-glint', { x: [70, 100], y: [5, 50], s: [1.6, 3] })}
    </>
  ),
  wonderland: () => (
    <>
      <b className="sp-sky sp-spiralbg" />
      {bits('wl', 9, 'sp-card', { s: [7, 10], t: [3, 6] }, <span>♥</span>)}
      {bits('wc', 4, 'sp-clock', { s: [8, 11], t: [4, 7] })}
    </>
  ),
  castle: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon blood" />
      {svg(<path d="M130 44V30h5v-5h5v5h5V18l6-7 6 7v12h5v-6h5v6h5V22l5-6 5 6v22Z" className="sp-castle" />)}
      {bits('ca', 6, 'sp-bat', { y: [10, 60], s: [9, 12], t: [4, 7] }, batSvg)}
    </>
  ),
  deep_sea: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-rays" />
      {bits('ds', 14, 'sp-bubble', { s: [2, 5], t: [3, 6] })}
    </>
  ),
};

export const NAMEPLATE_BASES = Object.keys(SCENES);
const cache = new Map<string, ReactNode>();
/** The scene for a shop nameplate id ("plate.night_sky.midnight"), or null. */
export function ShopNameplate({ id }: { id: string }) {
  const item = ITEMS.get(id);
  if (!item || item.kind !== 'nameplate' || !SCENES[item.base]) return null;
  let node = cache.get(item.base);
  if (!node) cache.set(item.base, (node = SCENES[item.base]()));
  const [a, b, c, d] = item.palette.c;
  return (
    <span className={`np-art sp sp-${item.base}`} style={{ '--a': a, '--b': b, '--c': c, '--d': d } as Vars} aria-hidden>
      {node}
    </span>
  );
}
