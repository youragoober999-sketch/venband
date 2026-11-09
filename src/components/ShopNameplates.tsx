// Nameplates from the Venband Shop: animated scenes behind your name in member
// lists. Palette colours arrive as CSS variables (--a --b --c --d); the scene
// sits right of the name and fades out behind it (see .np-art in cosmetics.css).
import type { CSSProperties, ReactNode } from 'react';
import { ITEMS } from '../lib/shop';
import { LOGO_PATH } from './logoPath';
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
  gradient: () => (
    <>
      <b className="sp-sky sp-flow" />
      <b className="sp-sheen" />
      {bits('gr', 12, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  night_sky: () => (
    <>
      <b className="sp-sky" />
      {bits('ns', 34, 'sp-star', { s: [1, 2.8] })}
      {bits('nsg', 9, 'sp-glint', { y: [5, 75], s: [1.3, 2.8] })}
      <b className="sp-shoot" />
      <b className="sp-moon" />
      <b className="sp-fog" />
    </>
  ),
  eclipse: () => (
    <>
      <b className="sp-sky" />
      {bits('ec', 20, 'sp-star', { s: [1, 2.4] })}
      <b className="sp-corona" />
      <b className="sp-disc" />
      {bits('ecg', 8, 'sp-glint', { s: [1.4, 3] })}
    </>
  ),
  petals: () => (
    <>
      <b className="sp-sky" />
      {bits('pt', 24, 'sp-petal', { s: [4, 9], t: [4, 9] })}
      {bits('ptb', 10, 'sp-bokeh', { s: [10, 22], y: [10, 80] })}
      {bits('ptg', 8, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  rain_glass: () => (
    <>
      <b className="sp-sky" />
      {bits('rgl', 9, 'sp-bokeh', { s: [10, 24], y: [10, 90] })}
      {bits('rgd', 30, 'sp-drop', { s: [6, 15], t: [0.8, 2.2] })}
      <b className="sp-fog" />
    </>
  ),
  fire_wall: () => (
    <>
      <b className="sp-sky" />
      {bits('fw', 22, 'sp-flame', { x: [20, 100], y: [52, 72], s: [12, 28], t: [0.5, 1.2] })}
      {bits('fws', 5, 'sp-smoke', { y: [15, 62], s: [14, 24], t: [5, 9] })}
      {bits('fwe', 16, 'sp-ember', { y: [30, 100], s: [1.4, 3], t: [1.3, 2.8] })}
    </>
  ),
  ocean: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon" />
      {svg(
        <>
          <path className="sp-wave w1" d="M0 28q15-8 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
          <path className="sp-wave w2" d="M0 33q15-6 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
          <path className="sp-wave w3" d="M0 38q15-4 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
        </>,
      )}
      {bits('oc', 12, 'sp-glint', { y: [10, 70], s: [1.4, 3.2] })}
      {bits('ob', 8, 'sp-bubble', { y: [50, 90], s: [2, 4], t: [4, 7] })}
    </>
  ),
  snow: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          <path d="M0 44V32q40-16 80-4t80-8 80 6V44Z" className="sp-hill" />
          <path d="M0 44V38q40-10 80-2t80-4 80 2V44Z" className="sp-hill deep" />
        </>,
      )}
      {bits('sn', 34, 'sp-flake', { s: [1.2, 3.8], t: [2.5, 7] })}
      <b className="sp-fog" />
    </>
  ),
  lightning: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          <path className="sp-bolt" d="M170 0l-12 18h10l-16 26 30-30h-12l12-14Z" />
          <path className="sp-bolt b2" d="M198 2l-8 13h7l-11 18 20-21h-8l8-10Z" />
        </>,
      )}
      {bits('lr', 22, 'sp-rain-streak', { s: [2, 5], t: [0.5, 1] })}
      <b className="sp-flash" />
    </>
  ),
  neon_city: () => (
    <>
      <b className="sp-sky" />
      {bits('nc', 18, 'sp-star', { s: [1, 2.2] })}
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
          <text x="104" y="11" className="sp-neon alt">24H</text>
          <rect x="100" y="10" width="36" height="1" className="sp-neon-line" />
        </>,
      )}
      {bits('ncg', 9, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  grid: () => (
    <>
      <b className="sp-sky" />
      {bits('gd', 22, 'sp-star', { s: [1, 2.3] })}
      <b className="sp-horizon-glow" />
      <b className="sp-sun" />
      <b className="sp-gridlines" />
      {bits('gg', 7, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  cipher: () => (
    <>
      <b className="sp-sky" />
      {bits('cp', 22, 'sp-col', { s: [8, 12], t: [2, 4.5] }, <span>A7#F0=K3/9Q</span>)}
      {bits('cp2', 8, 'sp-col alt', { s: [7, 9], t: [2.4, 5] }, <span>Z1$X8@M2</span>)}
      {bits('cpg', 6, 'sp-glint', { s: [1.2, 2.2] })}
    </>
  ),
  blocks: () => (
    <>
      <b className="sp-sky" />
      {bits('bl', 20, 'sp-block', { s: [4, 8], t: [1.8, 4.2] })}
      {bits('blf', 12, 'sp-block faint', { s: [2.5, 5], t: [3, 6] })}
      {bits('blg', 6, 'sp-glint', { s: [1.2, 2.4] })}
    </>
  ),
  equalizer: () => (
    <>
      <b className="sp-sky" />
      {bits('eqs', 24, 'sp-star', { s: [1, 2] })}
      <span className="sp-eq">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ animationDelay: `${-((i * 37) % 10) / 10}s`, animationDuration: `${0.6 + (i % 4) * 0.15}s` }} />)}</span>
      {bits('eqg', 8, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  butterflies: () => (
    <>
      <b className="sp-sky" />
      {bits('bf', 10, 'sp-bfly', { y: [10, 80], s: [7, 13], t: [6, 13] }, <><em /><em className="r" /></>)}
      {bits('bfp', 8, 'sp-petal', { s: [3, 5], t: [5, 9] })}
      {bits('bfg', 7, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  forest_fog: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          {[104, 118, 132, 146, 160, 174, 188, 202, 216, 230].map((x, i) => (
            <path key={x} d={`M${x} 44V${30 - (i % 3) * 4}l-8 10h5l-6 8h18l-6-8h5Z`} transform={`translate(0 ${i % 2 ? 4 : 0})`} className="sp-pine" />
          ))}
        </>,
      )}
      {bits('ff', 12, 'sp-firefly', { y: [18, 82], s: [1.6, 3], t: [3, 6] })}
      <b className="sp-fog" />
      <b className="sp-fog f2" />
    </>
  ),
  hearts: () => (
    <>
      <b className="sp-sky" />
      {bits('hr', 16, 'sp-heart', { s: [6, 13], t: [2.8, 5.4] }, heartSvg)}
      {bits('hrg', 10, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  clouds: () => (
    <>
      <b className="sp-sky" />
      {bits('cl', 9, 'sp-cloud', { y: [5, 78], s: [16, 32], t: [12, 26] })}
      {bits('clb', 7, 'sp-bokeh', { s: [12, 26], y: [5, 70] })}
      {bits('clg', 6, 'sp-glint', { s: [1.2, 2.4] })}
    </>
  ),
  leopard: () => (
    <>
      <b className="sp-sky sp-spots" />
      <b className="sp-sheen" />
      {bits('lp', 12, 'sp-glint', { s: [1.2, 2.8] })}
      {bits('lpb', 6, 'sp-bokeh', { s: [8, 18], y: [10, 80] })}
    </>
  ),
  roses: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon" />
      {svg(
        <>
          <path d="M60 44c30-16 60-6 90-18s50-14 90-6" className="sp-vine" />
          <path d="M96 38c22-8 40-4 58-10m-22 4-4-5m16 3 3-5M150 26l-5-4m18 2 4-4" className="sp-thorn" />
          {[[112, 32], [142, 25], [174, 21], [206, 27], [230, 18]].map(([x, y], i) => (
            <g key={i} className="sp-rose" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${-i}s` }}>
              <circle cx={x} cy={y} r="6.5" />
              <path d={`M${x - 3} ${y - 2}c2-3 6-2 6 1s-4 4-5 1`} className="sp-rose-line" />
            </g>
          ))}
        </>,
      )}
      {bits('rp', 12, 'sp-petal', { s: [3, 6], t: [5, 9] })}
      <b className="sp-fog" />
    </>
  ),
  crows: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon" />
      {bits('cr', 12, 'sp-crow', { y: [8, 75], s: [8, 17], t: [4, 10] }, crowSvg)}
      <b className="sp-fog" />
      <b className="sp-fog f2" />
    </>
  ),
  eyes: () => (
    <>
      <b className="sp-sky" />
      {bits('ey', 12, 'sp-eye', { y: [12, 85], s: [4, 9], t: [3, 6.5] }, <><em /><em /></>)}
      {bits('eyg', 8, 'sp-glint', { s: [1, 2.2] })}
      <b className="sp-fog" />
    </>
  ),
  ghosts: () => (
    <>
      <b className="sp-sky" />
      {bits('gh', 7, 'sp-ghost', { y: [10, 65], s: [9, 16], t: [6, 12] })}
      {bits('ghg', 8, 'sp-glint', { s: [1.2, 2.4] })}
      <b className="sp-fog" />
      <b className="sp-fog f2" />
    </>
  ),
  gold_leaf: () => (
    <>
      <b className="sp-sky sp-goldflow" />
      <b className="sp-sheen" />
      {bits('gl', 18, 'sp-leaf', { s: [2.6, 6], t: [4, 8] })}
      {bits('gg', 14, 'sp-glint', { s: [1.2, 2.8] })}
      {bits('gb', 6, 'sp-bokeh', { s: [8, 18], y: [10, 80] })}
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
      {bits('sng', 9, 'sp-glint', { s: [1.2, 2.8] })}
      <b className="sp-sheen" />
    </>
  ),
  great_wave: () => (
    <>
      <b className="sp-sky" />
      {bits('gw', 14, 'sp-star', { s: [1, 2.2] })}
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
      {bits('gwf', 10, 'sp-glint', { s: [1.2, 2.6] })}
      <b className="sp-fuji" />
    </>
  ),
  gold_mosaic: () => (
    <>
      <b className="sp-sky sp-mosaic" />
      {bits('gm', 12, 'sp-spiral', { y: [12, 88], s: [6, 11], t: [5, 11] })}
      <b className="sp-sheen" />
      {bits('gmg', 14, 'sp-glint', { s: [1.2, 2.8] })}
    </>
  ),
  scream: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          <g className="sp-bands">
            {[6, 13, 20, 27, 34].map((y, i) => (
              <path key={y} d={`M0 ${y}q20-6 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0`} className={`sp-band b${i}`} />
            ))}
          </g>
          <path d="M80 44L240 30v4L84 44Z" className="sp-bridge" />
        </>,
      )}
      {bits('scg', 8, 'sp-glint', { s: [1.2, 2.6] })}
      <b className="sp-fog" />
    </>
  ),
  moon_voyage: () => (
    <>
      <b className="sp-sky" />
      {bits('mv', 22, 'sp-star', { s: [1, 2.6] })}
      {svg(
        <>
          <g className="sp-mface">
            <circle cx="214" cy="22" r="16" />
            <path d="M206 20c2-2 4-2 6 0M210 30c4 2 8 2 11-1" className="ln" />
            <path d="M218 17h10" className="ln" />
          </g>
          <g className="sp-capsule">
            <path d="M0 0h12q6 3 0 6H0Z" transform="translate(120 26) rotate(-18)" />
            <path d="M-18 2h12" transform="translate(120 26) rotate(-18)" className="sp-trail" />
          </g>
        </>,
      )}
      {bits('mvg', 8, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
  film_reel: () => (
    <>
      <b className="sp-sky sp-grain" />
      <b className="sp-sprockets" />
      <b className="sp-sprockets bottom" />
      <b className="sp-scratch" />
      <b className="sp-scratch s2" />
      {bits('fr', 10, 'sp-glint', { s: [1, 2.2] })}
      <b className="sp-sheen" />
    </>
  ),
  brick_road: () => (
    <>
      <b className="sp-sky" />
      {bits('ozs', 20, 'sp-star', { s: [1, 2.2] })}
      {svg(
        <>
          <path d="M60 44C110 40 140 34 170 28s40-8 54-10" className="sp-road" />
          <path d="M60 44C110 40 140 34 170 28s40-8 54-10" className="sp-bricks" />
          {[[210, 14], [218, 8], [226, 12], [232, 6]].map(([x, h], i) => (
            <path key={i} d={`M${x - 3} 20V${20 - h}l3-4 3 4V20Z`} className="sp-tower" />
          ))}
        </>,
      )}
      {bits('oz', 14, 'sp-glint', { x: [70, 100], y: [3, 55], s: [1.4, 3.2] })}
    </>
  ),
  wonderland: () => (
    <>
      <b className="sp-sky sp-spiralbg" />
      {bits('wl', 16, 'sp-card', { s: [6, 11], t: [2.6, 6.5] }, <span>♥</span>)}
      {bits('wc', 7, 'sp-clock', { s: [7, 12], t: [3.5, 7.5] })}
      {bits('wg', 10, 'sp-glint', { s: [1.2, 2.8] })}
    </>
  ),
  castle: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon blood" />
      {svg(
        <>
          <path d="M130 44V30h5v-5h5v5h5V18l6-7 6 7v12h5v-6h5v6h5V22l5-6 5 6v22Z" className="sp-castle" />
          <path d="M138 30h4v4h-4Zm12 0h4v4h-4Zm12 0h4v4h-4Z" className="sp-castle-win" />
        </>,
      )}
      {bits('ca', 11, 'sp-bat', { y: [8, 65], s: [8, 13], t: [3.5, 8] }, batSvg)}
      <b className="sp-fog" />
      <b className="sp-fog f2" />
    </>
  ),
  deep_sea: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-rays" />
      {bits('ds', 22, 'sp-bubble', { s: [2, 5.5], t: [2.6, 6.5] })}
      {bits('dsj', 4, 'sp-jelly', { x: [40, 100], y: [20, 68], s: [7, 12], t: [7, 12] })}
      {bits('dsg', 9, 'sp-glint', { s: [1.1, 2.4] })}
    </>
  ),
  constellation: () => (
    <>
      <b className="sp-sky" />
      {bits('cn', 22, 'sp-star', { s: [1, 2.4] })}
      {svg(
        <>
          <path className="sp-const cn1" d="M92 34 116 12 140 26 160 6 180 22" />
          <path className="sp-const cn2" d="M146 42 164 32 184 38 204 18 224 26" />
          <path className="sp-const cn3" d="M196 12 208 6 220 12" />
          {[[116, 12], [140, 26], [160, 6], [180, 22], [204, 18], [224, 26]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={1.6 + (i % 2)} className="sp-cnode" style={{ animationDelay: `${-i * 0.6}s` }} />
          ))}
        </>,
      )}
      {bits('cg', 8, 'sp-glint', { s: [1.2, 2.4] })}
    </>
  ),
  supernova: () => (
    <>
      <b className="sp-sky" />
      {bits('svn', 16, 'sp-star', { s: [1, 2.6] })}
      <b className="sp-nova" />
      <b className="sp-nova-ring" />
      <b className="sp-nova-ring r2" />
      <b className="sp-nova-ring r3" />
      {bits('svg', 10, 'sp-glint', { s: [1.4, 2.8] })}
    </>
  ),
  blizzard: () => (
    <>
      <b className="sp-sky" />
      {svg(
        <>
          <path d="M0 44V30q40-14 80-4t80-6 80 4V44Z" className="sp-hill" />
          <path d="M0 44V37q40-10 80-2t80-4 80 2V44Z" className="sp-hill deep" />
        </>,
      )}
      {bits('bg', 3, 'sp-gust', { y: [18, 78], s: [20, 34], t: [3, 6] })}
      {bits('bz', 30, 'sp-flake', { s: [1.2, 3], t: [2, 4] })}
    </>
  ),
  inferno: () => (
    <>
      <b className="sp-sky" />
      {svg(<path d="M0 44V33h10v-5h12v5h14v-7h10v7h12v-4h10v4h12v-6h10v6h12v-3h10v3h12v-5h10v5h14v-2h10v2h12v11Z" className="sp-ridge-dark" />)}
      {bits('if', 16, 'sp-flame', { x: [20, 100], y: [50, 66], s: [12, 24], t: [0.5, 1.1] })}
      {bits('ifs', 4, 'sp-smoke', { y: [20, 60], s: [14, 22], t: [5, 9] })}
      {bits('ife', 12, 'sp-ember', { y: [30, 100], s: [1.5, 3], t: [1.4, 2.6] })}
    </>
  ),
  tide: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon" />
      {bits('tdg', 8, 'sp-glint', { x: [55, 80], y: [25, 60], s: [1.4, 2.6] })}
      {svg(
        <>
          <path className="sp-wave w1" d="M0 28q15-8 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
          <path className="sp-wave w2" d="M0 34q15-6 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
          <path className="sp-wave w3" d="M0 39q15-4 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V44H0Z" />
        </>,
      )}
      {bits('td', 8, 'sp-glint', { y: [55, 85], s: [1.4, 2.8] })}
    </>
  ),
  jellyfish: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-rays" />
      {bits('jl', 5, 'sp-jelly', { x: [35, 100], y: [15, 75], s: [10, 16], t: [6, 10] })}
      {bits('jb', 12, 'sp-bubble', { s: [2, 5], t: [3, 6] })}
    </>
  ),
  inkbloom: () => (
    <>
      <b className="sp-sky sp-inkpaper" />
      {bits('ib', 5, 'sp-ink', { x: [35, 100], y: [15, 80], s: [12, 22], t: [6, 9] })}
      {bits('id', 10, 'sp-drop', { x: [30, 100], s: [5, 9], t: [1.6, 3] })}
      {bits('ig', 6, 'sp-glint', { s: [1.2, 2.4] })}
    </>
  ),
  phantoms: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-moon blood" />
      {svg(
        <>
          <path d="M196 44v-8a6 6 0 0 1 12 0v8Z" className="sp-grave" />
          <path d="M214 44v-6a4 4 0 0 1 8 0v6Z" className="sp-grave thin" />
          <path d="M206 36v-3m-4 3h8" className="sp-grave-line" />
        </>,
      )}
      {bits('ph', 4, 'sp-ghost', { y: [20, 65], s: [10, 14], t: [7, 11] })}
      <b className="sp-fog" />
      <b className="sp-fog f2" />
    </>
  ),
  pixel_pop: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-pixel-sun" />
      {svg(<path d="M0 44V34h14v-6h12v6h16v-9h12v9h18v-5h12v5h16v-8h12v8h18v-4h12v4h18v10Z" className="sp-pixel-hills" />)}
      {bits('pxb', 10, 'sp-block', { s: [4, 6], t: [2.5, 5] })}
      {bits('pxh', 7, 'sp-heart', { s: [5, 9], t: [3, 5] }, heartSvg)}
      <b className="sp-scan" />
    </>
  ),
  candy: () => (
    <>
      <b className="sp-sky" />
      {bits('cdc', 5, 'sp-cloud', { y: [8, 55], s: [16, 26], t: [14, 24] })}
      {bits('cll', 4, 'sp-lolly', { x: [55, 100], y: [35, 80], s: [9, 14], t: [5, 8] })}
      {bits('cs', 20, 'sp-sprinkle', { s: [4, 7], t: [3, 6] })}
    </>
  ),
  leviathan: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-rays" />
      {svg(
        <>
          <path className="sp-serpent" d="M-20 34C20 6 52 40 86 20s52-16 86 6 44 8 88-6" />
          <path className="sp-serpent thin" d="M-20 37C20 9 52 43 86 23s52-16 86 6 44 8 88-6" />
        </>,
      )}
      <b className="sp-leye" />
      {bits('lv', 10, 'sp-bubble', { s: [2, 5], t: [3, 6] })}
      {bits('lvg', 8, 'sp-glint', { s: [1.2, 2.4] })}
    </>
  ),
  phoenix: () => (
    <>
      <b className="sp-sky" />
      <b className="sp-phx-sun" />
      {svg(
        <g className="sp-phx">
          <path className="tail" d="M120 28c-4 6-9 10-14 12m14-12c4 6 9 10 14 12" />
          <path className="wing l" d="M115 23C102 12 88 13 80 20c7-1 11 3 12 8 5-2 10 0 13 4Z" />
          <path className="wing r" d="M125 23c13-11 27-10 35-3-7-1-11 3-12 8-5-2-10 0-13 4Z" />
          <path className="body" d="M120 17c-3-5-7-5-9 0 2 1 3 4 3 7l6 6 6-6c0-3 1-6 3-7-2-5-6-5-9 0Z" />
          <path className="crest" d="M117 13l-2-5 3 2 2-4 2 4 3-2-2 5Z" />
        </g>,
      )}
      {bits('pxe', 10, 'sp-ember', { y: [30, 100], s: [1.4, 3], t: [1.4, 2.6] })}
      {bits('pxg', 7, 'sp-glint', { s: [1.2, 2.6] })}
    </>
  ),
};

// ---------------------------------------------- owner-only "Special": Throne Room --
const sigilSvg = <svg viewBox="0 0 696 609"><path d={LOGO_PATH} fillRule="evenodd" fill="currentColor" /></svg>;
SCENES.sovereign = () => (
  <>
    <b className="sp-sky" />
    <b className="sp-throne-glow" />
    <b className="sp-sheen sp-throne-sheen" />
    {svg(
      <>
        <path className="sp-filigree" d="M70 38c20-8 34 6 50-2s22-20 40-14 26 18 44 10 24-14 36-10" />
        <path className="sp-filigree thin" d="M70 8c20 8 34-6 50 2s22 20 40 14 26-18 44-10 24 14 36 10" />
        <g className="sp-throne-crown">
          <path d="M206 30l-4-14 8 6 6-10 6 10 8-6-4 14Z" />
          <rect x="203" y="29" width="22" height="3.5" rx="1" />
          <circle cx="216" cy="12" r="1.8" className="gem" />
        </g>
      </>,
    )}
    {bits('sv', 5, 'sp-sigil', { y: [15, 70], s: [9, 13], t: [7, 11] }, sigilSvg)}
    {bits('svs', 12, 'sp-glint', { s: [1.4, 3] })}
  </>
);

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
