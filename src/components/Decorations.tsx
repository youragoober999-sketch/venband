// Avatar decorations for the Venband Shop: layered, animated SVG art drawn
// around (and a little outside) an avatar. Every design takes a palette, so
// one design gives several colour variants.
//
// Geometry: viewBox 0 0 144 144, the avatar is the circle at (72, 72) r 50,
// so the decoration box is 1.44x the avatar (inset -22%). Animations are CSS
// (transform / opacity only, see decorations.css) and stop with reduce motion.
import { useId, type CSSProperties, type ReactNode } from 'react';
import { ITEMS, type Palette } from '../lib/shop';
import './decorations.css';

type Art = (p: string[], u: (s: string) => string) => ReactNode;
const C = 72;
const pt = (deg: number, r: number) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)] as const;
const star4 = (x: number, y: number, r: number) =>
  `M${x} ${y - r}L${x + r * 0.26} ${y - r * 0.26}L${x + r} ${y}L${x + r * 0.26} ${y + r * 0.26}L${x} ${y + r}L${x - r * 0.26} ${y + r * 0.26}L${x - r} ${y}L${x - r * 0.26} ${y - r * 0.26}Z`;
const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2 0 3.6 1.1 4.6 2.6l1 1.4 1-1.4C14 6.1 15.6 5 17.6 5 21 5 23.1 8.5 21.6 11.8 19.5 16.4 12 21 12 21z';
const heart = (x: number, y: number, s: number, fill: string, extra: Record<string, unknown> = {}) => <path d={HEART} transform={`translate(${x - 12 * s} ${y - 13 * s}) scale(${s})`} fill={fill} {...extra} />;
const o = (origin: string, delay = 0, dur?: number): CSSProperties => ({ transformOrigin: origin, animationDelay: `${delay}s`, ...(dur ? { animationDuration: `${dur}s` } : {}) });
const Mirror = ({ children }: { children: ReactNode }) => <g transform="matrix(-1 0 0 1 144 0)">{children}</g>;
const lin = (id: string, stops: [number, string][], x2 = 0, y2 = 1) => (
  <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
    {stops.map(([off, c], i) => (
      <stop key={i} offset={off} stopColor={c} />
    ))}
  </linearGradient>
);
const rad = (id: string, stops: [number, string, number?][]) => (
  <radialGradient id={id}>
    {stops.map(([off, c, op], i) => (
      <stop key={i} offset={off} stopColor={c} stopOpacity={op ?? 1} />
    ))}
  </radialGradient>
);
const Twinkles = ({ pts, fill, cls = 'dk-twinkle' }: { pts: [number, number, number][]; fill: string; cls?: string }) => (
  <>
    {pts.map(([x, y, r], i) => (
      <path key={i} className={cls} d={star4(x, y, r)} fill={fill} style={o(`${x}px ${y}px`, -i * 0.47)} />
    ))}
  </>
);
/** a feather: long teardrop from (0,0) pointing along -y, length l, width w */
const feather = (l: number, w: number) => `M0 0C${w} ${-l * 0.3} ${w * 0.8} ${-l * 0.8} 0 ${-l}C${-w * 0.8} ${-l * 0.8} ${-w} ${-l * 0.3} 0 0Z`;

// ---------------------------------------------------------------- designs --
const ART: Record<string, Art> = {
  // ------------------------------------------------ soft & cute
  kitty_ears: ([a, b, c, d]) => {
    const ear = (
      <g className="dk-twitch" style={o('46px 34px')}>
        <path d="M24 46C21 30 25 13 35 4c9 4 20 13 27 22C49 30 34 37 24 46Z" fill={a} stroke={d} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M31 37c-1-9 2-18 6-24 6 4 12 9 16 14-8 2-15 6-22 10Z" fill={b} />
        <path d="M35 14c3 5 4 10 3 15" stroke={c} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".7" />
      </g>
    );
    const whiskers = (
      <g className="dk-sway" style={o('22px 92px', 0, 3.4)} stroke={d} strokeWidth="1.8" strokeLinecap="round" fill="none" opacity=".85">
        <path d="M22 86C14 84 7 84 1 85" />
        <path d="M22 92C14 92 7 93 2 95" />
        <path d="M23 98C16 100 10 103 5 106" />
      </g>
    );
    return (
      <>
        {ear}
        {whiskers}
        <Mirror>
          {ear}
          {whiskers}
        </Mirror>
      </>
    );
  },
  bunny_ears: ([a, b, c, d]) => (
    <>
      <g className="dk-sway" style={o('56px 30px', 0, 4)}>
        <path d="M48 32C38 20 36 2 44-6c9-2 16 14 17 34-4 3-9 4-13 4Z" fill={a} stroke={d} strokeWidth="2.4" strokeLinejoin="round" transform="translate(0 6)" />
        <path d="M50 30c-6-9-7-22-3-27 5 1 9 12 9 25-2 2-4 2-6 2Z" fill={b} transform="translate(0 6)" />
      </g>
      <g className="dk-sway" style={o('88px 32px', -1.2, 4.6)}>
        <path d="M84 34c4-12 18-22 34-18 7 3 2 12-10 16-9 3-17 5-24 2Z" fill={a} stroke={d} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M89 31c5-8 14-12 23-11 2 3-3 7-10 9-5 2-9 3-13 2Z" fill={b} />
      </g>
      <circle cx="40" cy="22" r="1.6" fill={c} className="dk-twinkle" />
    </>
  ),
  fox_ears: ([a, , c, d]) => {
    const ear = (
      <g className="dk-twitch" style={o('44px 36px', -0.6)}>
        <path d="M22 50C17 32 20 10 30 0c13 5 25 16 32 28C48 32 33 40 22 50Z" fill={a} stroke={d} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M30 0c-4 6-6 13-6 19l9-6c-1-5-2-9-3-13Z" fill={d} />
        <path d="M29 40c-2-10 0-21 5-28 7 4 13 10 18 16-9 3-16 7-23 12Z" fill={c} opacity=".95" />
      </g>
    );
    return (
      <>
        {ear}
        <Mirror>{ear}</Mirror>
        <path d="M118 120c10-2 18 4 20 12-6 4-14 4-20 0 4-3 4-8 0-12Z" fill={a} stroke={d} strokeWidth="2" className="dk-sway" style={o('118px 124px', 0, 2.8)} />
        <path d="M132 126c3 1 5 4 6 6-3 2-6 2-9 1 2-2 3-4 3-7Z" fill={c} className="dk-sway" style={o('118px 124px', 0, 2.8)} />
      </>
    );
  },
  bow_bell: ([a, b, c, d], u) => {
    const bow = (
      <g className="dk-bob" style={o('30px 32px', 0, 3)}>
        <path d="M30 30C18 18 6 18 6 30s12 14 24 2Z" fill={`url(#${u('bw')})`} stroke={d} strokeWidth="1.8" />
        <path d="M30 30c10-14 24-14 24-2s-14 14-24 2Z" fill={`url(#${u('bw')})`} stroke={d} strokeWidth="1.8" />
        <path d="M26 36l-6 16 7-3 4 6 2-17Z" fill={b} stroke={d} strokeWidth="1.6" />
        <path d="M34 36l6 15-7-2-3 5-1-17Z" fill={b} stroke={d} strokeWidth="1.6" />
        <circle cx="30" cy="31" r="5" fill={b} stroke={d} strokeWidth="1.8" />
        <path d="M12 26c3-4 7-5 11-3M38 24c4-3 8-3 11 0" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
    );
    return (
      <>
        <defs>{lin(u('bw'), [[0, c], [0.45, a], [1, b]])}</defs>
        <g transform="rotate(-18 30 32)">{bow}</g>
        <Mirror>
          <g transform="rotate(-18 30 32)">{bow}</g>
        </Mirror>
        <path d="M36 113c22 12 50 12 72 0" stroke={b} strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M36 113c22 12 50 12 72 0" stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity=".6" strokeDasharray="1 5" />
        <g className="dk-swing" style={o('72px 120px', 0, 1.8)}>
          <circle cx="72" cy="131" r="9" fill={`url(#${u('bell')})`} stroke={d} strokeWidth="1.8" />
          <path d="M63 131h18" stroke={d} strokeWidth="1.4" />
          <circle cx="72" cy="135" r="1.8" fill={d} />
          <circle cx="68" cy="127" r="2" fill="#fff" opacity=".8" />
        </g>
        <defs>{lin(u('bell'), [[0, '#fff3b0'], [0.5, '#f5c542'], [1, '#b8860b']])}</defs>
      </>
    );
  },
  paws: ([a, b, c, d]) => {
    const paw = (
      <g>
        <path d="M30 140c-4-14 0-28 12-32 11-3 20 6 20 18 0 6-2 11-4 14Z" fill={a} stroke={d} strokeWidth="2.2" />
        {[
          [36, 113],
          [44, 110],
          [52, 113],
        ].map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx="3.2" ry="3.8" fill={b} />
        ))}
        <ellipse cx="44" cy="124" rx="7" ry="5.5" fill={b} />
        <path d="M34 128c-2 4-2 8 0 12" stroke={c} strokeWidth="1.4" fill="none" opacity=".6" />
      </g>
    );
    return (
      <>
        <g className="dk-bob" style={o('44px 120px', 0, 2.2)}>{paw}</g>
        <Mirror>
          <g className="dk-bob" style={o('44px 120px', -1.1, 2.2)}>{paw}</g>
        </Mirror>
      </>
    );
  },
  hearts_rise: ([a, b, c]) => (
    <>
      {[
        [18, 120, 0.9, 0],
        [128, 112, 0.7, -1],
        [30, 60, 0.55, -2.2],
        [118, 50, 0.6, -0.6],
        [100, 128, 0.5, -1.7],
      ].map(([x, y, s, dl], i) => (
        <g key={i} className="dk-rise" style={o(`${x}px ${y}px`, dl as number, 3.6)}>
          {heart(x as number, y as number, s as number, i % 2 ? b : a, { stroke: c, strokeWidth: 1.2 })}
        </g>
      ))}
      <g className="dk-pulse" style={o('118px 118px', 0, 1.1)}>
        {heart(118, 118, 1.25, b, { stroke: c, strokeWidth: 1.4 })}
        <path d="M110 110c2-3 5-4 7-3" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".7" />
      </g>
    </>
  ),
  clouds_rainbow: ([a, b, c], u) => {
    const cloud = (x: number, y: number, s: number) => (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <path d="M-18 6c-7 0-10-9-3-12 0-8 10-11 15-6 4-8 16-7 18 2 8-1 12 9 5 13-1 2-3 3-6 3Z" fill="#fff" stroke="#dfe7f5" strokeWidth="1.5" />
        <path d="M-12 1c2-2 5-2 7 0" stroke="#e8eef8" strokeWidth="1.4" fill="none" />
      </g>
    );
    const bands = [a, c, b, '#ffd166', '#ff7aa2'];
    return (
      <>
        <defs>{lin(u('rb'), [[0, '#fff'], [1, '#fff']])}</defs>
        {bands.map((col, i) => (
          <path key={i} d={`M${18 + i * 4} 60A${54 - i * 4} ${54 - i * 4} 0 0 1 ${126 - i * 4} 60`} stroke={col} strokeWidth="4" fill="none" opacity=".92" />
        ))}
        <g className="dk-drift" style={o('22px 62px', 0, 4)}>{cloud(22, 62, 1.1)}</g>
        <g className="dk-drift" style={o('122px 62px', -2, 4)}>{cloud(122, 62, 1.1)}</g>
        <Twinkles pts={[[72, 4, 4], [40, 10, 2.5], [104, 12, 3]]} fill="#fff" />
      </>
    );
  },
  party_hat: ([a, b, c, d], u) => (
    <>
      <defs>
        <clipPath id={u('hat')}>
          <path d="M84 32L106 -8l14 44Z" />
        </clipPath>
      </defs>
      <g transform="rotate(14 104 20)">
        <path d="M84 32L106 -8l14 44Z" fill={a} stroke={d} strokeWidth="2" strokeLinejoin="round" />
        <g clipPath={`url(#${u('hat')})`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M70 ${36 - i * 11}l60 -18v6l-60 18Z`} fill={b} opacity=".9" />
          ))}
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={98 + i * 6} cy={4 + i * 10} r="2" fill={c} />
          ))}
        </g>
        <path d="M82 33c12 6 26 6 40 2" stroke={c} strokeWidth="4" fill="none" strokeLinecap="round" />
        <circle cx="106" cy="-8" r="6" fill={c} stroke={d} strokeWidth="1.6" className="dk-pulse" style={o('106px -8px', 0, 1.4)} />
      </g>
      {[
        [20, 30, a, 20],
        [12, 70, b, -30],
        [28, 118, c, 40],
        [130, 84, a, 10],
        [124, 128, b, -50],
        [40, 12, b, 60],
      ].map(([x, y, col, r], i) => (
        <rect key={i} className="dk-confetti" x={(x as number) - 2.5} y={(y as number) - 5} width="5" height="10" rx="1.5" fill={col as string} style={{ ...o(`${x}px ${y}px`, -i * 0.5, 2.4), rotate: `${r}deg` } as CSSProperties} />
      ))}
    </>
  ),
  bubbles: ([a, b, c], u) => (
    <>
      <defs>{rad(u('bub'), [[0, c, 0.05], [0.7, a, 0.25], [0.92, b, 0.75], [1, c, 0.9]])}</defs>
      {[
        [14, 112, 13, 0],
        [130, 100, 11, -1.3],
        [20, 66, 8, -2.1],
        [124, 42, 9, -0.7],
        [104, 132, 8, -2.8],
        [40, 132, 7, -1.8],
        [16, 30, 6, -3.2],
        [118, 10, 5, -1.1],
      ].map(([x, y, r, dl], i) => (
        <g key={i} className="dk-rise slow" style={o(`${x}px ${y}px`, dl, 5)}>
          <circle cx={x} cy={y} r={r} fill={`url(#${u('bub')})`} />
          <path d={`M${x - r * 0.5} ${y - r * 0.2}a${r * 0.55} ${r * 0.55} 0 0 1 ${r * 0.45} -${r * 0.4}`} stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </g>
      ))}
    </>
  ),
  fuming: ([a, b, c, d]) => (
    <>
      <g className="dk-shake" style={o('72px 72px', 0, 0.35)}>
        <circle cx="72" cy="72" r="56" fill="none" stroke={a} strokeWidth="3" strokeDasharray="22 10" opacity=".9" />
        <circle cx="72" cy="72" r="61" fill="none" stroke={b} strokeWidth="2" strokeDasharray="8 14" opacity=".7" />
      </g>
      <g className="dk-pulse" style={o('116px 22px', 0, 0.7)}>
        {[0, 90, 180, 270].map((r) => (
          <path key={r} d="M116 22m-3 -12c0 6 3 9 9 9" transform={`rotate(${r} 116 22)`} stroke={a} strokeWidth="4.5" fill="none" strokeLinecap="round" />
        ))}
      </g>
      <g className="dk-bob" style={o('20px 118px', 0, 1.2)}>
        <path d="M6 104c0-8 6-12 14-12s14 4 14 12-6 12-14 12h-2l-8 6 2-7c-4-2-6-6-6-11Z" fill={c} stroke={d} strokeWidth="2.2" />
        <path d="M20 96v9" stroke={d} strokeWidth="3.4" strokeLinecap="round" />
        <circle cx="20" cy="110" r="2" fill={d} />
      </g>
      {[
        [40, 8],
        [56, 2],
        [30, 18],
      ].map(([x, y], i) => (
        <path key={i} className="dk-rise" style={o(`${x}px ${y}px`, -i * 0.4, 1.6)} d={`M${x} ${y + 10}c-4-4 4-6 0-10`} stroke="#d9dde6" strokeWidth="3" fill="none" strokeLinecap="round" />
      ))}
    </>
  ),

  // ------------------------------------------------ gothic
  rose_vine: ([a, b, c, d], u) => {
    const rose = (x: number, y: number, s: number) => (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <circle r="9" fill={`url(#${u('rose')})`} />
        <path d="M0-7c5 0 8 4 6 8-2 4-8 4-9 0-1-3 1-5 4-5" stroke={d} strokeWidth="1.3" fill="none" opacity=".7" />
        <path d="M-6 2c1 4 5 6 9 4M-8-3c-1-3 1-6 4-7" stroke={d} strokeWidth="1.1" fill="none" opacity=".55" />
        <path d="M-2-3c2-1 4 0 4 2" stroke={c} strokeWidth="1" fill="none" opacity=".6" />
      </g>
    );
    const leaf = (x: number, y: number, r: number) => <path d={`M${x} ${y}c6-6 14-4 16 0-6 5-12 5-16 0Z`} fill="#1f5134" stroke="#0e2a1b" strokeWidth=".8" transform={`rotate(${r} ${x} ${y})`} />;
    const thorns = [200, 230, 260, 290, 320, 350, 20, 50, 80, 110, 140].map((deg, i) => {
      const [x, y] = pt(deg, 54);
      return <path key={i} d={`M${x} ${y}l${Math.cos(((deg - 60) * Math.PI) / 180) * 5} ${Math.sin(((deg - 60) * Math.PI) / 180) * 5}`} stroke="#2b1b14" strokeWidth="2" strokeLinecap="round" />;
    });
    return (
      <>
        <defs>{rad(u('rose'), [[0, c], [0.35, a], [1, b]])}</defs>
        <g className="dk-sway" style={o('72px 72px', 0, 7)}>
          <path d="M72 18a54 54 0 1 1 -52 70" stroke="#2b1b14" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M72 18a54 54 0 1 1 -52 70" stroke="#4a3022" strokeWidth="1.4" fill="none" strokeDasharray="3 9" />
          {thorns}
          {leaf(100, 22, 20)}
          {leaf(124, 64, 80)}
          {leaf(104, 120, 150)}
          {leaf(44, 124, 200)}
          {leaf(20, 92, 250)}
          <g className="dk-pulse" style={o('112px 32px', 0, 3)}>{rose(112, 32, 1.25)}</g>
          {rose(126, 94, 0.95)}
          <g className="dk-pulse" style={o('70px 128px', -1.5, 3)}>{rose(70, 128, 1.35)}</g>
          {rose(26, 104, 0.85)}
        </g>
        {[[118, 46, 0], [80, 136, -1.4]].map(([x, y, dl], i) => (
          <path key={i} className="dk-fall" style={o(`${x}px ${y}px`, dl, 4)} d={`M${x} ${y}c3-3 7-2 7 2-3 2-6 2-7-2Z`} fill={a} />
        ))}
      </>
    );
  },
  chains_lock: ([a, b, c, d], u) => {
    const links = Array.from({ length: 13 }, (_, i) => {
      const deg = 20 + i * 11.5;
      const [x, y] = pt(deg, 55);
      return <ellipse key={i} cx={x} cy={y} rx="6.5" ry="3.8" transform={`rotate(${deg + 90} ${x} ${y})`} fill="none" stroke={i % 2 ? `url(#${u('ch')})` : b} strokeWidth="3" />;
    });
    return (
      <>
        <defs>
          {lin(u('ch'), [[0, c], [0.5, a], [1, b]])}
          {lin(u('lk'), [[0, c], [0.4, a], [1, b]])}
        </defs>
        <g className="dk-sway" style={o('72px 40px', 0, 5)}>{links}</g>
        <g className="dk-swing" style={o('72px 118px', 0, 2.6)}>
          <path d="M62 120v-8a10 10 0 0 1 20 0v8" stroke={b} strokeWidth="4.5" fill="none" />
          <rect x="56" y="118" width="32" height="24" rx="5" fill={`url(#${u('lk')})`} stroke={d} strokeWidth="2" />
          <circle cx="72" cy="128" r="3.4" fill={d} />
          <path d="M72 130v6" stroke={d} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M59 121h26" stroke="#fff" strokeWidth="1.4" opacity=".55" />
        </g>
        <Twinkles pts={[[86, 122, 3]]} fill="#fff" />
      </>
    );
  },
  bat_wings: ([a, b, c, d], u) => {
    const wing = (
      <g className="dk-flap" style={o('30px 66px', 0, 1.6)}>
        <path d="M30 60C22 40 8 30-4 30c6 6 8 14 6 20-6-4-12-4-16 0 6 4 8 10 6 16-4-2-8-2-10 1 8 3 14 10 16 18 6-10 18-18 32-16Z" fill={`url(#${u('bw')})`} stroke={d} strokeWidth="1.8" strokeLinejoin="round" transform="translate(4 0)" />
        <path d="M34 60C26 48 16 40 4 38M32 66C22 60 12 58 0 60M32 72C22 72 14 76 8 82" stroke={c} strokeWidth="1.2" fill="none" opacity=".5" transform="translate(0 0)" />
      </g>
    );
    return (
      <>
        <defs>{lin(u('bw'), [[0, a], [1, b]], 1, 1)}</defs>
        {wing}
        <Mirror>{wing}</Mirror>
        <Twinkles pts={[[72, 10, 3], [96, 128, 2.4]]} fill={c} />
      </>
    );
  },
  witch_hat: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('wh'), [[0, a], [1, b]])}</defs>
      <g className="dk-sway" style={o('70px 34px', 0, 5)}>
        <ellipse cx="70" cy="30" rx="44" ry="9" fill={b} stroke={d} strokeWidth="2" transform="rotate(-8 70 30)" />
        <path d="M44 30C52 8 62-4 70-10c6-2 14 0 20 8-6-2-11-1-14 2 4 10 6 22 8 32Z" fill={`url(#${u('wh')})`} stroke={d} strokeWidth="2" strokeLinejoin="round" />
        <path d="M46 26c14 4 26 4 38 0l1 6c-13 4-26 4-40 0Z" fill={c} />
        <rect x="62" y="25" width="9" height="8" rx="1.5" fill="none" stroke="#f5c542" strokeWidth="2" />
      </g>
      <Twinkles pts={[[112, 18, 4.5], [124, 40, 3], [100, 2, 2.6], [22, 40, 3]]} fill={c} />
    </>
  ),
  candles: ([a, b, c, d]) => {
    const candle = (x: number, h: number, dl: number) => (
      <g key={x}>
        <rect x={x - 5} y={142 - h} width="10" height={h} rx="2" fill={a} stroke={d} strokeWidth="1.2" />
        <path d={`M${x - 5} ${146 - h}c2 4 0 8 2 12M${x + 3} ${144 - h}c1 3 0 6 1 9`} stroke={a} strokeWidth="3" strokeLinecap="round" fill="none" />
        <path d={`M${x} ${142 - h}v-4`} stroke={d} strokeWidth="1.2" />
        <g className="dk-flicker" style={o(`${x}px ${138 - h}px`, dl, 0.5)}>
          <ellipse cx={x} cy={131 - h} rx="7" ry="9" fill={b} opacity=".22" />
          <path d={`M${x} ${126 - h}c4 5 4 10 0 12-4-2-4-7 0-12Z`} fill="#ffd166" />
          <path d={`M${x} ${130 - h}c2 3 2 5 0 7-2-1-2-4 0-7Z`} fill="#fff7d6" />
        </g>
      </g>
    );
    return (
      <>
        {candle(16, 34, 0)}
        {candle(30, 22, -0.2)}
        {candle(114, 26, -0.35)}
        {candle(128, 38, -0.1)}
        <circle cx="72" cy="72" r="58" fill="none" stroke={c} strokeWidth="1" opacity=".2" />
      </>
    );
  },

  // ------------------------------------------------ celestial
  halo_wings: ([a, b, c, d], u) => {
    const wing = (
      <g className="dk-flap" style={o('34px 56px', 0, 2.4)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={feather(26 - i * 2.5, 6)} transform={`translate(34 58) rotate(${-78 + i * 16})`} fill={i % 2 ? c : a} stroke={d} strokeWidth="1.2" opacity=".97" />
        ))}
      </g>
    );
    return (
      <>
        <defs>{lin(u('halo'), [[0, c], [0.5, a], [1, b]], 1, 0)}</defs>
        {wing}
        <Mirror>{wing}</Mirror>
        <g className="dk-bob" style={o('72px 12px', 0, 2.6)}>
          <ellipse cx="72" cy="12" rx="28" ry="7" fill="none" stroke={a} strokeWidth="8" opacity=".25" />
          <ellipse cx="72" cy="12" rx="28" ry="7" fill="none" stroke={`url(#${u('halo')})`} strokeWidth="4" />
          <ellipse cx="66" cy="8" rx="8" ry="1.4" fill="#fff" opacity=".7" />
        </g>
      </>
    );
  },
  grand_wings: ([a, b, c, d], u) => {
    const wing = (
      <g className="dk-flap big" style={o('40px 64px', 0, 3.2)}>
        {Array.from({ length: 9 }, (_, i) => (
          <path key={i} d={feather(44 - Math.abs(i - 3) * 4, 7)} transform={`translate(40 66) rotate(${-110 + i * 13})`} fill={`url(#${u('fw')})`} stroke={d} strokeWidth="1" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <path key={`s${i}`} d={feather(22, 6)} transform={`translate(40 66) rotate(${-96 + i * 15})`} fill={c} stroke={d} strokeWidth=".8" opacity=".9" />
        ))}
      </g>
    );
    return (
      <>
        <defs>{lin(u('fw'), [[0, c], [0.55, a], [1, b]])}</defs>
        {wing}
        <Mirror>{wing}</Mirror>
        <Twinkles pts={[[72, 6, 3.4], [12, 16, 2.4], [132, 18, 2.4]]} fill={c} />
      </>
    );
  },
  crescent: ([a, b, c, d], u) => (
    <>
      <defs>
        {lin(u('moon'), [[0, c], [0.5, a], [1, b]], 1, 1)}
        {rad(u('mg'), [[0, a, 0.35], [1, a, 0]])}
      </defs>
      <circle cx="30" cy="104" r="40" fill={`url(#${u('mg')})`} />
      <g className="dk-sway" style={o('30px 104px', 0, 6)}>
        <path d="M12 76a40 40 0 1 0 50 52A32 32 0 0 1 12 76Z" fill={`url(#${u('moon')})`} stroke={d} strokeWidth="1.6" />
        <circle cx="22" cy="112" r="3" fill={b} opacity=".5" />
        <circle cx="34" cy="128" r="2" fill={b} opacity=".5" />
        <path d="M30 116c2 2 5 2 7 0" stroke={d} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </g>
      <Twinkles pts={[[118, 20, 5], [130, 50, 3], [100, 8, 2.6], [62, 4, 2.4], [126, 112, 3.2]]} fill={c} />
      <path d="M106 36c-6 0-8-6-4-9 2-6 10-6 12-1 5 0 6 7 2 9Z" fill="#fff" opacity=".85" className="dk-drift" style={o('108px 32px', 0, 6)} />
    </>
  ),
  eclipse: ([a, b, c], u) => (
    <>
      <defs>{rad(u('cor'), [[0.62, a, 0], [0.7, c, 0.95], [0.8, a, 0.6], [1, b, 0]])}</defs>
      <circle cx="72" cy="72" r="72" fill={`url(#${u('cor')})`} className="dk-pulse" style={o('72px 72px', 0, 3)} />
      <g className="dk-spin" style={o('72px 72px', 0, 30)}>
        {Array.from({ length: 24 }, (_, i) => {
          const [x1, y1] = pt(i * 15, 52);
          const [x2, y2] = pt(i * 15 + 4, 62 + (i % 3) * 4);
          return <path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} stroke={i % 2 ? a : c} strokeWidth="2" strokeLinecap="round" opacity=".7" />;
        })}
      </g>
      <circle cx="72" cy="72" r="51" fill="none" stroke={c} strokeWidth="2.5" />
      <g className="dk-pulse" style={o('108px 34px', 0, 2)}>
        <circle cx="108" cy="34" r="6" fill="#fff" />
        <path d={star4(108, 34, 16)} fill="#fff" opacity=".9" />
      </g>
    </>
  ),
  orbit: ([a, b, c, d]) => (
    <>
      <g transform="rotate(-20 72 72)">
        <ellipse cx="72" cy="72" rx="68" ry="20" fill="none" stroke={a} strokeWidth="1.6" opacity=".6" />
        <g className="dk-orbit" style={o('72px 72px', 0, 6)}>
          <circle cx="140" cy="72" r="7" fill={b} stroke={c} strokeWidth="1.5" />
        </g>
      </g>
      <g transform="rotate(35 72 72)">
        <ellipse cx="72" cy="72" rx="64" ry="14" fill="none" stroke={b} strokeWidth="1.4" opacity=".5" />
        <g className="dk-orbit" style={o('72px 72px', -3, 9)}>
          <circle cx="8" cy="72" r="5" fill={a} />
          <ellipse cx="8" cy="72" rx="9" ry="2.2" fill="none" stroke={c} strokeWidth="1.2" />
        </g>
      </g>
      <Twinkles pts={[[20, 20, 3], [126, 120, 3], [124, 16, 2.4]]} fill={c} />
      <circle cx="72" cy="72" r="52" fill="none" stroke={d} strokeWidth="1" opacity=".3" />
    </>
  ),
  constellation: ([a, , c]) => {
    const pts: [number, number][] = [
      [14, 40],
      [30, 18],
      [56, 8],
      [86, 6],
      [112, 16],
      [130, 38],
      [134, 70],
    ];
    return (
      <>
        <circle cx="72" cy="72" r="56" fill="none" stroke={a} strokeWidth="1" opacity=".35" strokeDasharray="1 6" />
        <path d={`M${pts.map((p) => p.join(' ')).join('L')}`} stroke={a} strokeWidth="5" fill="none" opacity=".18" />
        <path d={`M${pts.map((p) => p.join(' ')).join('L')}`} stroke={c} strokeWidth="1.6" fill="none" opacity=".9" strokeDasharray="200" className="dk-draw" />
        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="6" fill={a} opacity=".25" />
            <circle cx={x} cy={y} r="3" fill={c} />
            <path className="dk-twinkle" d={star4(x, y, 8)} fill={a} style={o(`${x}px ${y}px`, -i * 0.4)} />
          </g>
        ))}
      </>
    );
  },

  // ------------------------------------------------ elements
  flame_crown: ([a, b, c, d], u) => (
    <>
      <defs>
        {lin(u('fl'), [[0, c], [0.35, a], [1, b]])}
        {lin(u('fl2'), [[0, '#ffffff'], [1, a]])}
      </defs>
      <circle cx="72" cy="72" r="53" fill="none" stroke={b} strokeWidth="4" opacity=".7" />
      {Array.from({ length: 11 }, (_, i) => {
        const deg = 190 + i * 16;
        const [x, y] = pt(deg, 50);
        const h = 22 + ((i * 7) % 3) * 8;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${deg + 90})`}>
            <g className="dk-flicker" style={o('0px 0px', -i * 0.13, 0.6 + (i % 3) * 0.15)}>
              <path d={`M-9 2C-10 -${h * 0.5} -2 -${h * 0.7} 0 -${h}C4 -${h * 0.6} 11 -${h * 0.45} 9 2Z`} fill={`url(#${u('fl')})`} />
              <path d={`M-4 2C-4 -${h * 0.3} 0 -${h * 0.4} 0 -${h * 0.55}C3 -${h * 0.35} 5 -${h * 0.25} 4 2Z`} fill={`url(#${u('fl2')})`} opacity=".9" />
            </g>
          </g>
        );
      })}
      {[
        [30, 20],
        [110, 14],
        [72, 2],
        [128, 50],
      ].map(([x, y], i) => (
        <circle key={i} className="dk-rise" cx={x} cy={y} r="1.8" fill={a} style={o(`${x}px ${y}px`, -i * 0.5, 1.8)} />
      ))}
      <circle cx="72" cy="72" r="50" fill="none" stroke={d} strokeWidth="1.2" opacity=".4" />
    </>
  ),
  lightning: ([a, b, c]) => (
    <>
      <circle cx="72" cy="72" r="55" fill="none" stroke={a} strokeWidth="8" opacity=".2" />
      <circle cx="72" cy="72" r="54" fill="none" stroke={a} strokeWidth="3.2" strokeDasharray="10 6 2 6" className="dk-spin" style={o('72px 72px', 0, 4)} />
      <circle cx="72" cy="72" r="58" fill="none" stroke={b} strokeWidth="1.4" strokeDasharray="3 12" className="dk-spin rev" style={o('72px 72px', 0, 6)} />
      {[
        ['M108 4l-10 18h9l-12 20 22-26h-10l9-12Z', 0],
        ['M18 96l6 14h-8l10 18-2-14h7l-13-18Z', -0.6],
        ['M130 98l-14 6 6 4-14 10 20-6-6-4 8-10Z', -1.1],
      ].map(([d, dl], i) => (
        <path key={i} d={d as string} fill={c} stroke={a} strokeWidth="1.6" strokeLinejoin="round" className="dk-zap" style={o('72px 72px', dl as number, 1.8)} />
      ))}
    </>
  ),
  ice_shards: ([a, b, c, d], u) => {
    const shard = (deg: number, len: number, w: number) => {
      const [x, y] = pt(deg, 48);
      return <path key={deg} d={`M0 0L${-w} -${len * 0.4}L0 -${len}L${w} -${len * 0.45}Z`} transform={`translate(${x} ${y}) rotate(${deg + 90})`} fill={`url(#${u('ice')})`} stroke={d} strokeWidth="1" strokeLinejoin="round" opacity=".95" />;
    };
    return (
      <>
        <defs>{lin(u('ice'), [[0, c], [0.5, a], [1, b]], 1, 1)}</defs>
        {[200, 215, 228, 245, 300, 318, 330, 345, 100, 80, 120].map((deg, i) => shard(deg, 18 + ((i * 5) % 14), 5 + (i % 3)))}
        {[
          [14, 30],
          [130, 88],
        ].map(([x, y], i) => (
          <g key={i} className="dk-spin" style={o(`${x}px ${y}px`, 0, 8 + i * 3)} stroke={c} strokeWidth="1.6" strokeLinecap="round">
            {[0, 60, 120].map((r) => (
              <path key={r} d={`M${x} ${y - 7}V${y + 7}`} transform={`rotate(${r} ${x} ${y})`} />
            ))}
          </g>
        ))}
      </>
    );
  },
  waves: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('wv'), [[0, c], [0.4, a], [1, b]])}</defs>
      <g className="dk-sway" style={o('72px 120px', 0, 4)}>
        <path d="M4 108c10-10 22-10 30 0s20 10 28 0 20-10 28 0 20 10 28 0 16-8 22-4v40H4Z" fill={`url(#${u('wv')})`} stroke={d} strokeWidth="1.4" />
        <path d="M4 108c10-10 22-10 30 0s20 10 28 0 20-10 28 0 20 10 28 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".7" />
      </g>
      <g className="dk-sway" style={o('72px 128px', -2, 5)}>
        <path d="M0 126c12-8 22-8 32 0s22 8 32 0 22-8 32 0 22 8 32 0 12-4 16-2v24H0Z" fill={b} opacity=".85" />
      </g>
      <circle className="dk-rise" cx="118" cy="100" r="2.4" fill={c} style={o('118px 100px', 0, 2.2)} />
      <circle className="dk-rise" cx="28" cy="98" r="1.8" fill={c} style={o('28px 98px', -1, 2.2)} />
    </>
  ),

  // ------------------------------------------------ nature
  flower_crown: ([a, b, c, d]) => {
    const flower = (x: number, y: number, s: number, col: string, dl: number) => (
      <g key={`${x}`} className="dk-pulse" style={o(`${x}px ${y}px`, dl, 3)}>
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse key={r} cx={x} cy={y - 5 * s} rx={3.6 * s} ry={5.6 * s} fill={col} stroke={d} strokeWidth=".8" transform={`rotate(${r} ${x} ${y})`} />
        ))}
        <circle cx={x} cy={y} r={2.8 * s} fill="#ffd166" stroke={d} strokeWidth=".8" />
      </g>
    );
    const fl = [200, 220, 240, 262, 284, 306, 326, 344];
    return (
      <>
        {fl.map((deg, i) => {
          const [x, y] = pt(deg + 8, 52);
          return <path key={`l${i}`} d={`M${x} ${y}c5-5 12-4 14 0-5 4-10 4-14 0Z`} fill="#3f9a5a" transform={`rotate(${deg} ${x} ${y})`} />;
        })}
        {fl.map((deg, i) => {
          const [x, y] = pt(deg, 52);
          return flower(x, y, i % 2 ? 1 : 1.25, i % 3 === 0 ? a : i % 3 === 1 ? b : c, -i * 0.3);
        })}
      </>
    );
  },
  sakura_branch: ([a, b, c, d]) => (
    <>
      <path d="M-4 30C20 34 40 24 58 8c-6 12-2 18 10 22M30 30c6-10 14-14 22-14" stroke="#4a2c22" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M-4 30C20 34 40 24 58 8" stroke="#6b4232" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {[
        [10, 30, 1.2],
        [28, 24, 1],
        [44, 16, 1.25],
        [58, 8, 0.9],
        [64, 28, 1.05],
        [36, 32, 0.8],
      ].map(([x, y, s], i) => (
        <g key={i} className="dk-pulse" style={o(`${x}px ${y}px`, -i * 0.4, 3.2)}>
          {[0, 72, 144, 216, 288].map((r) => (
            <path key={r} d={`M${x} ${y}c-3-4-2-8 0-9 2 1 3 5 0 9Z`} transform={`rotate(${r} ${x} ${y}) scale(${s})`} style={{ transformOrigin: `${x}px ${y}px` }} fill={r % 144 ? a : b} stroke={d} strokeWidth=".6" />
          ))}
          <circle cx={x} cy={y} r="1.6" fill={c} />
        </g>
      ))}
      {[
        [80, 20, 0],
        [100, 50, -1.2],
        [120, 30, -2.4],
        [96, 90, -3],
      ].map(([x, y, dl], i) => (
        <path key={i} className="dk-fall" style={o(`${x}px ${y}px`, dl, 4.2)} d={`M${x} ${y}c3-3 7-2 7 2-3 2-6 2-7-2Z`} fill={a} />
      ))}
    </>
  ),
  butterflies: ([a, b, c, d], u) => {
    const bfly = (x: number, y: number, s: number, dl: number) => (
      <g key={`${x}${y}`} className="dk-drift" style={o(`${x}px ${y}px`, dl, 5)}>
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          <g className="dk-wing" style={o('0px 0px', dl, 0.45)}>
            <path d="M0 0C-6-12-18-12-16-2-14 4-6 4 0 0Z" fill={`url(#${u('bf')})`} stroke={d} strokeWidth="1" />
            <path d="M0 0C-4 8-12 10-12 4-12 0-6 0 0 0Z" fill={b} stroke={d} strokeWidth="1" />
          </g>
          <g className="dk-wing r" style={o('0px 0px', dl, 0.45)}>
            <path d="M0 0C6-12 18-12 16-2 14 4 6 4 0 0Z" fill={`url(#${u('bf')})`} stroke={d} strokeWidth="1" />
            <path d="M0 0C4 8 12 10 12 4 12 0 6 0 0 0Z" fill={b} stroke={d} strokeWidth="1" />
          </g>
          <path d="M0-5v10" stroke={d} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      </g>
    );
    return (
      <>
        <defs>{lin(u('bf'), [[0, c], [0.5, a], [1, b]], 1, 1)}</defs>
        {bfly(26, 26, 1.15, 0)}
        {bfly(118, 24, 0.85, -1.3)}
        {bfly(130, 92, 0.7, -2.4)}
        {bfly(14, 96, 0.6, -3.2)}
        <Twinkles pts={[[50, 8, 2.4], [104, 128, 2.4], [8, 60, 2]]} fill={c} />
      </>
    );
  },
  autumn_wreath: ([a, b, c, d]) => {
    const maple = 'M0-9l2 5 4-2-1 5 5 1-4 3 2 3-5-1-1 5-2-4-2 4-1-5-5 1 2-3-4-3 5-1-1-5 4 2Z';
    return (
      <>
        <path d="M18 92a56 56 0 0 0 108 0" stroke="#5a3a1c" strokeWidth="2.4" fill="none" />
        {Array.from({ length: 11 }, (_, i) => {
          const deg = 18 + i * 14.5;
          const [x, y] = pt(deg, 55);
          return <path key={i} d={maple} transform={`translate(${x} ${y}) rotate(${deg * 2}) scale(${1.1 + (i % 2) * 0.25})`} fill={[a, b, c][i % 3]} stroke={d} strokeWidth=".6" />;
        })}
        {[
          [20, 30, 0],
          [124, 20, -1.6],
        ].map(([x, y, dl], i) => (
          <path key={i} className="dk-fall" style={o(`${x}px ${y}px`, dl, 5)} d={maple} transform={`translate(${x} ${y})`} fill={a} />
        ))}
      </>
    );
  },
  toadstools: ([a, b, c, d]) => {
    const shroom = (x: number, y: number, s: number) => (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <path d="M-4 0c0-6 1-12 4-14 3 2 4 8 4 14Z" fill="#fff4e0" stroke={d} strokeWidth="1" />
        <path d="M-14-12c0-10 8-16 14-16s14 6 14 16Z" fill={a} stroke={d} strokeWidth="1.2" />
        <circle cx="-6" cy="-19" r="2.4" fill="#fff" />
        <circle cx="5" cy="-22" r="2" fill="#fff" />
        <circle cx="8" cy="-15" r="1.6" fill="#fff" />
      </g>
    );
    return (
      <>
        <path d="M2 140c10-10 26-12 40-8M102 138c12-6 28-6 40 2" stroke="#3f9a5a" strokeWidth="3" fill="none" strokeLinecap="round" />
        {shroom(22, 140, 1.15)}
        {shroom(40, 140, 0.75)}
        {shroom(118, 140, 1)}
        {[
          [30, 100],
          [114, 96],
          [10, 70],
          [134, 60],
        ].map(([x, y], i) => (
          <circle key={i} className="dk-firefly" cx={x} cy={y} r="2.2" fill={c} style={o(`${x}px ${y}px`, -i * 0.7, 3)} />
        ))}
        <circle cx="72" cy="72" r="56" fill="none" stroke={b} strokeWidth="1" opacity=".25" />
      </>
    );
  },

  // ------------------------------------------------ spooky
  ghosts: ([a, b, c, d]) => {
    const ghost = (s: number) => (
      <g transform={`scale(${s})`}>
        <path d="M-10 10V-2a10 10 0 0 1 20 0v12l-3.4-3-3.3 3-3.3-3-3.3 3-3.3-3Z" fill={a} stroke={d} strokeWidth="1.4" />
        <ellipse cx="-3.5" cy="-1" rx="1.8" ry="2.6" fill={d} />
        <ellipse cx="3.5" cy="-1" rx="1.8" ry="2.6" fill={d} />
        <ellipse cx="0" cy="5" rx="2" ry="1.4" fill={b} />
        <circle cx="-6" cy="3" r="1.6" fill={c} opacity=".6" />
      </g>
    );
    return (
      <g className="dk-spin" style={o('72px 72px', 0, 18)}>
        {[0, 120, 240].map((deg, i) => {
          const [x, y] = pt(deg - 90, 60);
          return (
            <g key={deg} transform={`translate(${x} ${y})`}>
              <g className="dk-bob" style={o('0px 0px', -i, 1.8)}>{ghost(1.15 - i * 0.12)}</g>
            </g>
          );
        })}
      </g>
    );
  },
  watching_eyes: ([a, b, c, d]) => (
    <>
      {Array.from({ length: 8 }, (_, i) => {
        const deg = i * 45 + 22;
        const [x, y] = pt(deg, 60);
        const s = 0.8 + (i % 3) * 0.2;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${deg + 90}) scale(${s})`}>
            <g className="dk-blink" style={o('0px 0px', -i * 0.7, 4 + (i % 3))}>
              <path d="M-10 0C-5-7 5-7 10 0 5 7-5 7-10 0Z" fill="#f4f1ea" stroke={d} strokeWidth="1.4" />
              <g className="dk-look" style={o('0px 0px', -i * 0.5, 5)}>
                <circle r="4.4" fill={a} />
                <circle r="2" fill={d} />
                <circle cx="1.4" cy="-1.4" r=".9" fill="#fff" />
              </g>
              <path d="M-10 0C-5-7 5-7 10 0" stroke={b} strokeWidth="1" fill="none" opacity=".6" />
            </g>
          </g>
        );
      })}
      <circle cx="72" cy="72" r="52" fill="none" stroke={c} strokeWidth="1" opacity=".15" />
    </>
  ),
  skeleton_grip: ([a, b, c, d]) => {
    const finger = (x: number, y: number, r: number, l: number) => (
      <g transform={`translate(${x} ${y}) rotate(${r})`}>
        <rect x="-2.6" y={-l} width="5.2" height={l * 0.55} rx="2.6" fill={a} stroke={d} strokeWidth="1.1" />
        <rect x="-2.4" y={-l * 0.42} width="4.8" height={l * 0.4} rx="2.4" fill={a} stroke={d} strokeWidth="1.1" />
        <circle cx="0" cy={-l * 0.44} r="2.6" fill={b} stroke={d} strokeWidth="1" />
      </g>
    );
    return (
      <g className="dk-grip" style={o('124px 124px', 0, 3)}>
        <path d="M144 144l-28-18" stroke={a} strokeWidth="9" strokeLinecap="round" />
        <path d="M144 144l-28-18" stroke={d} strokeWidth="1" strokeLinecap="round" opacity=".5" />
        <ellipse cx="114" cy="122" rx="11" ry="9" fill={a} stroke={d} strokeWidth="1.2" />
        {finger(106, 114, -40, 26)}
        {finger(112, 110, -18, 28)}
        {finger(120, 110, 2, 26)}
        {finger(126, 114, 22, 22)}
        {finger(104, 126, -88, 18)}
        <circle cx="116" cy="122" r="1.4" fill={c} opacity=".6" />
      </g>
    );
  },

  // ------------------------------------------------ gamer
  headset: ([a, b, c, d], u) => {
    const cup = (
      <g>
        <rect x="8" y="58" width="22" height="34" rx="9" fill={`url(#${u('hs')})`} stroke={d} strokeWidth="2" />
        <rect x="12" y="64" width="6" height="22" rx="3" fill={a} className="dk-rgb" />
      </g>
    );
    return (
      <>
        <defs>{lin(u('hs'), [[0, '#3a3f52'], [1, '#14161f']])}</defs>
        <path d="M20 62C20 22 44 10 72 10s52 12 52 52" stroke="#1b1e2a" strokeWidth="8" fill="none" strokeLinecap="round" />
        <path d="M20 62C20 22 44 10 72 10s52 12 52 52" stroke={a} strokeWidth="2" fill="none" strokeLinecap="round" className="dk-rgb" opacity=".9" />
        {cup}
        <Mirror>{cup}</Mirror>
        <path d="M20 92c0 18 10 28 30 30" stroke="#1b1e2a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <circle cx="52" cy="122" r="5" fill="#1b1e2a" stroke={b} strokeWidth="1.6" />
        <circle cx="52" cy="122" r="2" fill={c} className="dk-pulse" style={o('52px 122px', 0, 1)} />
        {[0, 1, 2].map((i) => (
          <path key={i} className="dk-ping" d={`M${132 + i * 4} 66a${10 + i * 6} ${10 + i * 6} 0 0 1 0 20`} stroke={a} strokeWidth="2" fill="none" strokeLinecap="round" style={o('130px 76px', -i * 0.3, 1.4)} />
        ))}
      </>
    );
  },
  pixel_hearts: ([a, b, c, d]) => {
    const px = [
      '.XX.XX.',
      'XXXXXXX',
      'XXXXXXX',
      '.XXXXX.',
      '..XXX..',
      '...X...',
    ];
    const ph = (ox: number, oy: number, col: string, k: number) => (
      <g key={ox} className="dk-pulse" style={o(`${ox + 10}px ${oy + 8}px`, -k * 0.25, 1.2)}>
        {px.flatMap((row, y) => [...row].map((ch, x) => (ch === 'X' ? <rect key={`${x}${y}`} x={ox + x * 3} y={oy + y * 3} width="3" height="3" fill={x === 1 && y === 1 ? c : col} /> : null)))}
        <rect x={ox - 1} y={oy - 1} width="23" height="20" fill="none" stroke={d} strokeWidth="0" />
      </g>
    );
    return (
      <>
        {ph(26, 0, a, 0)}
        {ph(50, 0, a, 1)}
        {ph(74, 0, a, 2)}
        {ph(98, 0, b, 3)}
        {[
          [10, 120],
          [128, 124],
          [132, 40],
        ].map(([x, y], i) => (
          <rect key={i} className="dk-twinkle" x={x} y={y} width="4" height="4" fill={c} style={o(`${x + 2}px ${y + 2}px`, -i * 0.6)} />
        ))}
      </>
    );
  },
  neon_ring: ([a, b, c]) => (
    <>
      <circle cx="72" cy="72" r="56" fill="none" stroke={a} strokeWidth="9" opacity=".18" />
      <circle cx="72" cy="72" r="56" fill="none" stroke={a} strokeWidth="3" className="dk-neon" />
      <circle cx="72" cy="72" r="61" fill="none" stroke={b} strokeWidth="2" strokeDasharray="40 14" className="dk-neon delay" />
      <path d={star4(118, 22, 9)} fill="none" stroke={c} strokeWidth="2" className="dk-neon" />
      {heart(24, 120, 0.9, 'none', { stroke: b, strokeWidth: 2.4, className: 'dk-neon delay' })}
    </>
  ),
  soundwave: ([a, b, c]) => (
    <>
      {Array.from({ length: 36 }, (_, i) => {
        const deg = i * 10;
        const [x, y] = pt(deg, 55);
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${deg})`}>
            <rect className="dk-eq" x="0" y="-1.6" width="12" height="3.2" rx="1.6" fill={i % 3 === 0 ? c : i % 2 ? a : b} style={o('0px 0px', -((i * 37) % 10) / 10, 0.6 + (i % 4) * 0.12)} />
          </g>
        );
      })}
    </>
  ),
  stickers: ([a, b, c, d]) => (
    <>
      <g transform="rotate(-14 26 24)" className="dk-pop" style={o('26px 24px', 0, 2.4)}>
        <rect x="6" y="12" width="40" height="24" rx="8" fill="#fff" stroke={d} strokeWidth="2" />
        <text x="26" y="30" textAnchor="middle" fontSize="15" fontWeight="900" fill={a} fontFamily="Impact, Arial Black, sans-serif">GG!</text>
      </g>
      <g className="dk-pop" style={o('122px 30px', -0.6, 2.4)}>
        <path d={star4(122, 30, 15)} fill={b} stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
      </g>
      <path d="M118 104l-10 16h8l-6 14 16-20h-8l6-10Z" fill={c} stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" className="dk-pop" style={o('116px 118px', -1.2, 2.4)} />
      <g className="dk-pop" style={o('24px 118px', -1.8, 2.4)}>{heart(24, 118, 1.1, a, { stroke: '#fff', strokeWidth: 2.4 })}</g>
    </>
  ),
  katana: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('bl'), [[0, '#ffffff'], [0.5, '#cfd6e2'], [1, '#8a94a8']], 1, 0)}</defs>
      <path d="M2 142C40 104 90 54 140 4" stroke={a} strokeWidth="10" opacity=".14" className="dk-slash" />
      <g transform="rotate(-45 72 72)">
        <rect x="-4" y="69" width="104" height="6" rx="3" fill={`url(#${u('bl')})`} stroke={d} strokeWidth="1" />
        <rect x="-4" y="69" width="104" height="2" fill="#fff" opacity=".8" className="dk-shine" />
        <rect x="100" y="66" width="5" height="12" rx="1.5" fill="#d4a64a" stroke={d} strokeWidth="1" />
        <rect x="105" y="68.5" width="34" height="7" rx="3" fill={b} stroke={d} strokeWidth="1" />
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M${109 + i * 8} 68.5l4 7`} stroke={c} strokeWidth="1.4" />
        ))}
      </g>
    </>
  ),

  // ------------------------------------------------ royal
  crown: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('cr'), [[0, c], [0.45, a], [1, b]])}</defs>
      <g transform="rotate(-12 72 24)" className="dk-bob" style={o('72px 24px', 0, 3.2)}>
        <path d="M40 34L34 4l18 14 20-20 20 20 18-14-6 30Z" fill={`url(#${u('cr')})`} stroke={d} strokeWidth="2" strokeLinejoin="round" />
        <rect x="40" y="30" width="64" height="9" rx="3" fill={b} stroke={d} strokeWidth="1.6" />
        <circle cx="72" cy="17" r="5" fill="#ff3b5c" stroke={d} strokeWidth="1.2" />
        <circle cx="53" cy="24" r="3.4" fill="#3bb4ff" stroke={d} strokeWidth="1" />
        <circle cx="91" cy="24" r="3.4" fill="#3ddc84" stroke={d} strokeWidth="1" />
        {[48, 60, 72, 84, 96].map((x) => (
          <circle key={x} cx={x} cy="34.5" r="1.8" fill="#fff" opacity=".85" />
        ))}
        <path d="M44 33l2-8" stroke="#fff" strokeWidth="1.4" opacity=".6" />
      </g>
      <Twinkles pts={[[30, 10, 4.5], [114, 6, 3.4], [100, 30, 2.4]]} fill="#fff" />
    </>
  ),
  laurel: ([a, b, c, d]) => {
    const branch = Array.from({ length: 8 }, (_, i) => {
      const deg = 160 - i * 12;
      const [x, y] = pt(deg, 54);
      return <ellipse key={i} cx={x} cy={y} rx="9" ry="3.6" transform={`rotate(${deg + 50} ${x} ${y})`} fill={i % 2 ? a : b} stroke={d} strokeWidth=".8" />;
    });
    return (
      <>
        <path d="M36 128a56 56 0 0 1-20-84" stroke={b} strokeWidth="2" fill="none" />
        {branch}
        <Mirror>
          <path d="M36 128a56 56 0 0 1-20-84" stroke={b} strokeWidth="2" fill="none" />
          {branch}
        </Mirror>
        <path d="M60 132h24l-4 8H64Z" fill={a} stroke={d} strokeWidth="1.2" />
        <Twinkles pts={[[20, 36, 4], [124, 36, 4], [72, 136, 3]]} fill={c} />
      </>
    );
  },

  // ------------------------------------------------ classics (public domain)
  moon_voyage: ([a, b, c, d], u) => (
    <>
      <defs>{rad(u('mn'), [[0, c], [0.7, a], [1, b]])}</defs>
      <g className="dk-bob" style={o('110px 34px', 0, 4)}>
        <circle cx="110" cy="34" r="30" fill={`url(#${u('mn')})`} stroke={d} strokeWidth="2" />
        <circle cx="96" cy="22" r="4" fill={b} opacity=".5" />
        <circle cx="126" cy="46" r="3" fill={b} opacity=".5" />
        <path d="M94 32c3-3 7-3 10 0" stroke={d} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M100 48c6 4 14 4 20-1" stroke={d} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M110 38l-2 6h4Z" fill={b} />
        {/* the capsule, stuck in the right eye */}
        <g transform="rotate(-38 118 30)">
          <path d="M108 28h16a6 4 0 0 1 0 8h-16Z" fill="#c9ccd3" stroke={d} strokeWidth="1.6" />
          <path d="M108 28l-8 4 8 4Z" fill="#9aa0ab" stroke={d} strokeWidth="1.4" />
          <path d="M112 28v8M118 28v8" stroke={d} strokeWidth="1" />
        </g>
        <path d="M126 22c4-4 10-4 12 0-3 4-8 4-12 0Z" fill="#fff" opacity=".9" className="dk-pulse" style={o('130px 22px', 0, 1.6)} />
      </g>
      <Twinkles pts={[[20, 20, 5], [40, 6, 3], [10, 60, 3.4], [134, 100, 3], [24, 126, 4]]} fill={c} />
      <path d="M2 140c20-8 40-6 60 0" stroke={b} strokeWidth="2" fill="none" opacity=".5" />
    </>
  ),
  shadow_hand: ([a, b, c, d], u) => (
    <>
      <defs>{rad(u('cl'), [[0, '#ffd166', 0.55], [1, '#ffd166', 0]])}</defs>
      <circle cx="124" cy="112" r="30" fill={`url(#${u('cl')})`} className="dk-flicker" style={o('124px 112px', 0, 1.4)} />
      <rect x="119" y="114" width="10" height="26" rx="2" fill={a} stroke={d} strokeWidth="1.2" />
      <path d="M124 103c4 5 4 9 0 11-4-2-4-6 0-11Z" fill="#ffd166" className="dk-flicker" style={o('124px 112px', 0, 0.5)} />
      <g className="dk-creep" style={o('10px 120px', 0, 5)}>
        <path
          d="M-4 140C6 120 14 108 20 96L18 58c0-4 5-4 6 0l4 34 4-46c0-4 6-4 6 0l-2 46 9-40c1-4 7-3 6 1l-8 42 13-30c2-4 7-2 6 2L50 104c-6 14-14 26-30 40Z"
          fill={d}
          stroke={c}
          strokeWidth="1.6"
          opacity=".95"
        />
        <path d="M22 60l-1-6M35 44l1-6M47 52l3-6M58 70l4-4" stroke={b} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </>
  ),
  caligari: ([a, , c, d]) => (
    <>
      {[
        'M2 2L40 10 22 30 48 26 8 58Z',
        'M142 4L104 18 130 30 96 34 140 62Z',
        'M4 142L34 112 18 104 52 98 30 140Z',
        'M140 140L102 118 126 110 92 102 120 142Z',
      ].map((p, i) => (
        <path key={i} d={p} fill={i % 2 ? d : a} stroke={d} strokeWidth="2" strokeLinejoin="miter" opacity=".92" />
      ))}
      <path d="M8 74l18-6-8 16 22-8" stroke={c} strokeWidth="2.6" fill="none" className="dk-zap" style={o('20px 76px', 0, 3)} />
      <path d="M136 70l-18 6 8-16-22 8" stroke={d} strokeWidth="2.6" fill="none" />
      <circle cx="72" cy="72" r="54" fill="none" stroke={d} strokeWidth="2" strokeDasharray="14 6 4 6" />
    </>
  ),
  opera_ghost: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('ch'), [[0, c], [0.5, a], [1, b]])}</defs>
      <g className="dk-swing" style={o('72px -10px', 0, 4)}>
        <path d="M72-10V8" stroke={d} strokeWidth="1.6" />
        <path d="M40 18c10 10 54 10 64 0" stroke={`url(#${u('ch')})`} strokeWidth="4" fill="none" />
        <path d="M50 10c8 6 36 6 44 0" stroke={`url(#${u('ch')})`} strokeWidth="3" fill="none" />
        {[40, 52, 64, 80, 92, 104].map((x, i) => (
          <g key={x}>
            <path d={`M${x} ${18 + (i === 0 || i === 5 ? 0 : 4)}v6`} stroke={a} strokeWidth="1.2" />
            <path d={`M${x} ${26 + (i === 0 || i === 5 ? 0 : 4)}l-2 4 2 4 2-4Z`} fill="#e9f4ff" stroke={d} strokeWidth=".6" className="dk-twinkle" style={o(`${x}px 30px`, -i * 0.3)} />
          </g>
        ))}
        {[44, 72, 100].map((x, i) => (
          <g key={x}>
            <rect x={x - 2} y="2" width="4" height="8" fill="#fff8e7" />
            <path d={`M${x} -4c2 2 2 4 0 5-2-1-2-3 0-5Z`} fill="#ffd166" className="dk-flicker" style={o(`${x}px 0px`, -i * 0.2, 0.5)} />
          </g>
        ))}
      </g>
      <path d="M58 132c4 4 10 6 14 6s10-2 14-6" stroke={b} strokeWidth="2" fill="none" />
      <path d="M60 128c3-6 8-8 12-8s9 2 12 8c-4 4-8 6-12 6s-8-2-12-6Z" fill={b} stroke={d} strokeWidth="1.4" />
    </>
  ),
  deerstalker: ([a, b, c, d], u) => (
    <>
      <defs>
        <pattern id={u('tw')} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={a} />
          <path d="M0 3h6M3 0v6" stroke={b} strokeWidth="1.2" opacity=".6" />
        </pattern>
      </defs>
      <g transform="rotate(-10 72 24)">
        <path d="M34 34C34 10 52 0 72 0s38 10 38 34Z" fill={`url(#${u('tw')})`} stroke={d} strokeWidth="2" />
        <path d="M30 34c-8 2-14 6-14 10 10 2 22 0 30-4ZM114 34c8 2 14 6 14 10-10 2-22 0-30-4Z" fill={`url(#${u('tw')})`} stroke={d} strokeWidth="1.6" />
        <path d="M72 0v-5" stroke={d} strokeWidth="3" strokeLinecap="round" />
        <path d="M40 22c6 4 14 2 18-4M104 22c-6 4-14 2-18-4" stroke={b} strokeWidth="2" fill="none" />
      </g>
      <g className="dk-sway" style={o('108px 124px', 0, 3.4)}>
        <path d="M100 116l-14 22" stroke="#5a3b1c" strokeWidth="6" strokeLinecap="round" />
        <circle cx="110" cy="104" r="16" fill={c} fillOpacity=".25" stroke={d} strokeWidth="4" />
        <circle cx="110" cy="104" r="16" fill="none" stroke="#d4a64a" strokeWidth="2" />
        <path d="M102 96c3-4 8-5 12-4" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" className="dk-shine" />
      </g>
    </>
  ),
  cheshire: ([a, b, c, d]) => (
    <>
      <g className="dk-fadeinout" style={o('72px 72px', 0, 6)}>
        <path d="M14 30C24 14 40 6 50 6" stroke={a} strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray="6 6" />
        <path d="M130 30C120 14 104 6 94 6" stroke={b} strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray="6 6" />
        <ellipse cx="34" cy="40" rx="9" ry="6" fill="#ffe14f" stroke={d} strokeWidth="1.6" />
        <ellipse cx="110" cy="40" rx="9" ry="6" fill="#ffe14f" stroke={d} strokeWidth="1.6" />
        <rect x="32.6" y="35" width="2.8" height="10" rx="1.4" fill={d} />
        <rect x="108.6" y="35" width="2.8" height="10" rx="1.4" fill={d} />
      </g>
      <g className="dk-grin" style={o('72px 126px', 0, 6)}>
        <path d="M20 112c16 26 88 26 104 0-14 12-90 12-104 0Z" fill="#fff" stroke={d} strokeWidth="2.4" strokeLinejoin="round" />
        {Array.from({ length: 13 }, (_, i) => (
          <path key={i} d={`M${28 + i * 7.3} ${116 + Math.sin((i / 12) * Math.PI) * 9}v${7 - Math.abs(i - 6) * 0.4}`} stroke={d} strokeWidth="1.2" />
        ))}
        <path d="M20 112c16 26 88 26 104 0" stroke={c} strokeWidth="1" fill="none" opacity=".4" />
      </g>
    </>
  ),
  pocket_watch: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('pw'), [[0, c], [0.5, a], [1, b]], 1, 1)}</defs>
      <path d="M100 0c4 14 10 24 14 34" stroke={a} strokeWidth="2" strokeDasharray="3 2" fill="none" />
      <g className="dk-swing" style={o('100px 0px', 0, 2.4)}>
        <path d="M100 0c6 18 14 30 18 40" stroke={a} strokeWidth="2.2" strokeDasharray="3 2" fill="none" />
        <circle cx="120" cy="50" r="14" fill={`url(#${u('pw')})`} stroke={d} strokeWidth="2" />
        <circle cx="120" cy="50" r="10.5" fill="#fffaf0" stroke={d} strokeWidth="1" />
        {Array.from({ length: 12 }, (_, i) => {
          const r = (i * 30 * Math.PI) / 180;
          return <circle key={i} cx={120 + Math.cos(r) * 8.4} cy={50 + Math.sin(r) * 8.4} r=".8" fill={d} />;
        })}
        <path d="M120 50V43" stroke={d} strokeWidth="1.4" strokeLinecap="round" className="dk-spin" style={o('120px 50px', 0, 6)} />
        <path d="M120 50h5" stroke={d} strokeWidth="1.6" strokeLinecap="round" className="dk-spin" style={o('120px 50px', 0, 60)} />
        <rect x="117.5" y="33" width="5" height="4" rx="1" fill={a} stroke={d} strokeWidth="1" />
      </g>
      {[
        [8, 112, -24, '♥', '#d1203a'],
        [22, 120, -8, '♠', '#111'],
        [36, 126, 10, '♦', '#d1203a'],
      ].map(([x, y, r, s, col], i) => (
        <g key={i} transform={`rotate(${r} ${x} ${y})`}>
          <rect x={x as number} y={y as number} width="18" height="24" rx="2.5" fill="#fff" stroke={d} strokeWidth="1.2" />
          <text x={(x as number) + 9} y={(y as number) + 16} textAnchor="middle" fontSize="12" fill={col as string}>{s}</text>
        </g>
      ))}
    </>
  ),
  top_hat: ([a, b, c, d]) => (
    <g transform="rotate(16 92 20)" className="dk-bob" style={o('92px 20px', 0, 3)}>
      <ellipse cx="90" cy="30" rx="34" ry="7" fill={b} stroke={d} strokeWidth="2" />
      <path d="M66 30c-2-14 0-26 4-36h40c4 10 6 22 4 36Z" fill={a} stroke={d} strokeWidth="2" strokeLinejoin="round" />
      <path d="M66 22h48l1 6H65Z" fill={b} />
      <rect x="96" y="6" width="17" height="12" fill="#fffaf0" stroke={d} strokeWidth="1" transform="rotate(10 104 12)" />
      <text x="104.5" y="15" textAnchor="middle" fontSize="6.4" fontWeight="700" fill={d} transform="rotate(10 104 12)" fontFamily="Georgia, serif">10/6</text>
      <path d="M72-4c-1 8-1 16 0 24" stroke={c} strokeWidth="2" opacity=".35" />
    </g>
  ),
  emerald_specs: ([a, b, c, d]) => (
    <>
      <g className="dk-bob" style={o('72px 30px', 0, 3)}>
        <circle cx="50" cy="30" r="15" fill={a} fillOpacity=".55" stroke="#d4a64a" strokeWidth="3.4" />
        <circle cx="94" cy="30" r="15" fill={a} fillOpacity=".55" stroke="#d4a64a" strokeWidth="3.4" />
        <path d="M65 28c4-4 10-4 14 0" stroke="#d4a64a" strokeWidth="3" fill="none" />
        <path d="M35 26L14 18M109 26l21-8" stroke="#d4a64a" strokeWidth="3" strokeLinecap="round" />
        <path d="M42 22c3-3 8-4 12-3M86 22c3-3 8-4 12-3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
      <g opacity=".95">
        {[
          [10, 140, 22],
          [24, 140, 34],
          [36, 140, 26],
          [108, 140, 30],
          [120, 140, 40],
          [134, 140, 24],
        ].map(([x, y, h], i) => (
          <path key={i} d={`M${x - 5} ${y}V${y - h + 6}l5-8 5 8V${y}Z`} fill={i % 2 ? b : a} stroke={d} strokeWidth="1" />
        ))}
      </g>
      <Twinkles pts={[[24, 92, 3.4], [124, 86, 3], [72, 4, 3]]} fill={c} />
    </>
  ),
  count_castle: ([a, b, c, d]) => (
    <>
      <circle cx="112" cy="26" r="16" fill={a} opacity=".95" />
      <circle cx="112" cy="26" r="22" fill={a} opacity=".2" />
      <path d="M4 144v-26h6v-6h6v6h6v-16l8-10 8 10v16h6v-8h6v28ZM106 144v-20h6v-14l8-10 8 10v14h6v20Z" fill={d} />
      <rect x="30" y="112" width="3" height="5" fill={a} opacity=".8" />
      <g className="dk-spin" style={o('72px 72px', 0, 14)}>
        {[0, 90, 200, 290].map((deg, i) => {
          const [x, y] = pt(deg, 62);
          return (
            <g key={i} transform={`translate(${x} ${y}) scale(${0.9 - i * 0.08})`}>
              <g className="dk-wing" style={o('0px 0px', -i * 0.2, 0.35)}>
                <path d="M0 0c-4-6-10-8-14-6 2 2 2 5 0 7 3-1 6 0 7 2 2-3 5-4 7-3Z" fill={b} stroke={d} strokeWidth=".8" />
              </g>
              <g className="dk-wing r" style={o('0px 0px', -i * 0.2, 0.35)}>
                <path d="M0 0c4-6 10-8 14-6-2 2-2 5 0 7-3-1-6 0-7 2-2-3-5-4-7-3Z" fill={b} stroke={d} strokeWidth=".8" />
              </g>
              <circle r="1.6" fill={c} />
            </g>
          );
        })}
      </g>
    </>
  ),
  prometheus: ([a, b, c, d]) => (
    <>
      {Array.from({ length: 10 }, (_, i) => {
        const deg = 200 + i * 14;
        const [x, y] = pt(deg, 51);
        return <path key={i} d="M-5 0h10" transform={`translate(${x} ${y}) rotate(${deg})`} stroke={c} strokeWidth="2.6" strokeLinecap="round" />;
      })}
      <path d="M21 72a51 51 0 0 1 100 -14" stroke={c} strokeWidth="2" fill="none" strokeDasharray="1 0" />
      {[
        [10, 132],
        [134, 132],
      ].map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 3} y={y - 4} width="6" height="16" fill="#3a3f52" stroke={d} strokeWidth="1" />
          <circle cx={x} cy={y - 7} r="6" fill={b} stroke={c} strokeWidth="1.4" className="dk-pulse" style={o(`${x}px ${y - 7}px`, -i * 0.3, 0.8)} />
        </g>
      ))}
      <path d="M16 125c12-14 22 6 34-8s22 10 34-4 22 8 34-6l10 6" stroke={a} strokeWidth="2" fill="none" className="dk-zap" style={o('72px 120px', -0.3, 1.2)} />
      {[
        ['M8 20l14 14-8 2 16 18-22-14 8-2Z', 0],
        ['M136 104l-14 6 6 4-16 12 22-8-6-4Z', -0.9],
        ['M12 118l12-4-4 8 14-2-20 12 4-8Z', -1.6],
      ].map(([p, dl], i) => (
        <path key={i} d={p as string} fill={a} stroke={c} strokeWidth="1.6" strokeLinejoin="round" className="dk-zap" style={o('72px 72px', dl as number, 1.6)} />
      ))}
      <circle cx="72" cy="72" r="57" fill="none" stroke={b} strokeWidth="1.4" strokeDasharray="2 8" className="dk-spin" style={o('72px 72px', 0, 3)} />
    </>
  ),
  raven: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('rv'), [[0, a], [1, d]], 1, 1)}</defs>
      <g className="dk-bob" style={o('76px 20px', 0, 3.6)}>
        <path d="M44 26c6-12 18-20 32-20 6 0 10 2 14 6l12-2-8 8c4 8 2 18-6 24l14 10-22-4c-12 2-26-4-36-22Z" fill={`url(#${u('rv')})`} stroke={d} strokeWidth="1.6" />
        <path d="M58 22c8 2 16 8 20 16M50 30c8 2 16 6 22 14" stroke={b} strokeWidth="1.2" fill="none" opacity=".6" />
        <circle cx="86" cy="14" r="2.4" fill={c} />
        <circle cx="86.6" cy="13.4" r=".8" fill="#fff" />
        <path d="M76 44l-2 6M84 44l2 6" stroke="#2b2b2b" strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d="M38 44c22 8 46 8 68 0" stroke="#3a2a1a" strokeWidth="5" strokeLinecap="round" fill="none" />
      {[
        [20, 40, 0],
        [124, 70, -1.8],
        [30, 110, -3],
      ].map(([x, y, dl], i) => (
        <path key={i} className="dk-fall" style={o(`${x}px ${y}px`, dl, 5)} d={feather(14, 3)} transform={`translate(${x} ${y}) rotate(30)`} fill={a} stroke={d} strokeWidth=".6" />
      ))}
    </>
  ),
  porthole: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('br'), [[0, c], [0.5, a], [1, b]], 1, 1)}</defs>
      <circle cx="72" cy="72" r="60" fill="none" stroke={`url(#${u('br')})`} strokeWidth="14" />
      <circle cx="72" cy="72" r="66.5" fill="none" stroke={d} strokeWidth="1.4" />
      <circle cx="72" cy="72" r="53" fill="none" stroke={d} strokeWidth="1.4" />
      {Array.from({ length: 12 }, (_, i) => {
        const [x, y] = pt(i * 30 + 15, 60);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="3" fill={b} stroke={d} strokeWidth="1" />
            <circle cx={x - 0.8} cy={y - 0.8} r="1" fill="#fff" opacity=".7" />
          </g>
        );
      })}
      <path d="M34 30a54 54 0 0 1 30 -16" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".5" />
      {[
        [104, 110, 0],
        [96, 124, -1],
        [112, 96, -2],
      ].map(([x, y, dl], i) => (
        <circle key={i} className="dk-rise" cx={x} cy={y} r={3 - i * 0.6} fill="none" stroke="#bfe9ff" strokeWidth="1.2" style={o(`${x}px ${y}px`, dl, 2.4)} />
      ))}
    </>
  ),
  parrot_map: ([a, b, c, d]) => (
    <>
      <g transform="rotate(-8 30 118)">
        <rect x="2" y="104" width="50" height="34" rx="2" fill="#f2dfb4" stroke="#8a6a3b" strokeWidth="1.6" />
        <path d="M8 130c8-6 14 2 22-4s10-10 16-6" stroke="#8a6a3b" strokeWidth="1.4" strokeDasharray="3 3" fill="none" />
        <path d="M40 112l6 6M46 112l-6 6" stroke="#c0392b" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <g className="dk-bob" style={o('118px 40px', 0, 2.2)}>
        <path d="M108 60c-6-10-6-24 4-32 8-6 20-4 24 6 2 6 0 12-4 16l6 22c-10-2-22-4-30-12Z" fill={a} stroke={d} strokeWidth="1.6" />
        <path d="M112 58c4 6 10 10 18 12l6 14c-8-2-18-8-24-16Z" fill={b} stroke={d} strokeWidth="1.2" />
        <path d="M130 34c6 0 10 4 8 10-4-2-6-2-8-1Z" fill="#f5c542" stroke={d} strokeWidth="1.2" />
        <circle cx="125" cy="32" r="3" fill="#fff" stroke={d} strokeWidth="1" />
        <circle cx="125.6" cy="32" r="1.4" fill={d} />
        <path d="M110 46c4 4 10 6 16 6" stroke={c} strokeWidth="1.4" fill="none" opacity=".7" />
      </g>
    </>
  ),
  puppet_strings: ([a, , c, d]) => (
    <>
      <g className="dk-swing" style={o('72px -6px', 0, 3)}>
        <path d="M36 4h72M72-8v26" stroke={d} strokeWidth="9" strokeLinecap="round" />
        <path d="M36 4h72M72-8v26" stroke={a} strokeWidth="6.5" strokeLinecap="round" />
        <path d="M38 2h68M70-6v22" stroke="#fff" strokeWidth="1.2" opacity=".35" />
        {[
          [40, 4, 30, 50],
          [104, 4, 114, 50],
          [72, 16, 72, 22],
          [56, 4, 44, 26],
          [88, 4, 100, 26],
        ].map(([x1, y1, x2, y2], i) => (
          <path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} stroke={c} strokeWidth="1.4" opacity=".95" />
        ))}
      </g>
      <circle cx="72" cy="72" r="54" fill="none" stroke={d} strokeWidth="1" opacity=".2" />
    </>
  ),
  dorian_frame: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('fr'), [[0, c], [0.4, a], [1, b]], 1, 1)}</defs>
      <rect x="10" y="10" width="124" height="124" rx="6" fill="none" stroke={`url(#${u('fr')})`} strokeWidth="14" />
      <rect x="3" y="3" width="138" height="138" rx="8" fill="none" stroke={d} strokeWidth="1.6" />
      <rect x="17" y="17" width="110" height="110" rx="3" fill="none" stroke={d} strokeWidth="1.6" />
      {[
        [10, 10],
        [134, 10],
        [10, 134],
        [134, 134],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="7" fill={a} stroke={d} strokeWidth="1.4" />
      ))}
      <path d="M100 18l-6 10 4 6-8 10M24 96l10 4 2 8 8 4" stroke={d} strokeWidth="1.4" fill="none" className="dk-crack" />
      <Twinkles pts={[[30, 8, 3], [120, 132, 3]]} fill="#fff" />
    </>
  ),
  potion: ([a, b, c, d]) => {
    const flask = (x: number, col: string, dl: number) => (
      <g key={x}>
        <path d={`M${x - 3} 104v10l-10 18a5 5 0 0 0 4 8h18a5 5 0 0 0 4-8l-10-18v-10Z`} fill="#ffffff33" stroke={d} strokeWidth="1.6" />
        <path d={`M${x - 11} 128h22l3 6a3 3 0 0 1-3 4h-22a3 3 0 0 1-3-4Z`} fill={col} opacity=".9" />
        <rect x={x - 4} y="100" width="8" height="5" rx="1.5" fill="#8a6a3b" />
        {[0, 1].map((k) => (
          <circle key={k} className="dk-rise" cx={x - 3 + k * 6} cy="126" r="1.6" fill={col} style={o(`${x}px 126px`, dl - k * 0.5, 1.4)} />
        ))}
      </g>
    );
    return (
      <>
        {flask(20, a, 0)}
        {flask(124, b, -0.7)}
        <path d="M30 100c10-8 20-8 26 0M114 100c-10-8-20-8-26 0" stroke={c} strokeWidth="1.4" fill="none" strokeDasharray="2 4" opacity=".7" />
      </>
    );
  },
  starry_ring: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('sr'), [[0, b], [1, d]])}</defs>
      <circle cx="72" cy="72" r="60" fill="none" stroke={`url(#${u('sr')})`} strokeWidth="18" opacity=".95" />
      <g className="dk-spin" style={o('72px 72px', 0, 40)}>
        {Array.from({ length: 14 }, (_, i) => {
          const deg = i * 26;
          const [x, y] = pt(deg, 60);
          return <path key={i} d={`M${x} ${y}m-7 0a7 5 0 1 1 7 5`} stroke={i % 2 ? c : '#9fc2ff'} strokeWidth="2.2" fill="none" strokeLinecap="round" transform={`rotate(${deg} ${x} ${y})`} opacity=".9" />;
        })}
      </g>
      {[
        [20, 26, 7],
        [118, 16, 9],
        [130, 90, 6],
        [16, 104, 5],
        [72, 6, 5],
      ].map(([x, y, r], i) => (
        <g key={i} className="dk-pulse" style={o(`${x}px ${y}px`, -i * 0.5, 2.4)}>
          <circle cx={x} cy={y} r={r + 4} fill={a} opacity=".25" />
          <circle cx={x} cy={y} r={r} fill={a} />
          <circle cx={x} cy={y} r={r * 0.45} fill="#fffbe0" />
        </g>
      ))}
      <path d="M118 16a9 9 0 1 0 0 0" fill="none" />
      <path d="M2 144C8 118 10 96 18 78c4 18 6 40 4 66Z" fill="#0b1a12" />
    </>
  ),
  great_wave: ([a, b, c, d]) => (
    <>
      <path d="M-2 120C10 70 40 30 86 22c26-4 46 6 54 18-14-6-28-4-36 4 10 2 16 10 14 18-8-8-20-10-30-6 6 6 8 14 4 20C82 66 70 62 60 66 40 74 24 96 18 128Z" fill={b} stroke={d} strokeWidth="2" />
      <path d="M8 118C20 76 46 42 86 34" stroke={a} strokeWidth="4" fill="none" opacity=".9" />
      <g className="dk-sway" style={o('110px 40px', 0, 3)}>
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} cx={104 + (i % 3) * 7 + Math.sin(i) * 3} cy={28 + Math.floor(i / 3) * 6} r={2.6 - (i % 3) * 0.5} fill={c} stroke={d} strokeWidth=".6" />
        ))}
        <path d="M100 30c6-6 14-6 20-2M96 40c6-4 12-4 18 0" stroke={c} strokeWidth="2" fill="none" />
      </g>
      <path d="M96 136l16-14 16 14Z" fill="#f4f1ea" stroke={d} strokeWidth="1.4" />
      <path d="M106 128l6-6 6 6-6 2Z" fill={b} />
      {[
        [30, 30],
        [50, 14],
      ].map(([x, y], i) => (
        <circle key={i} className="dk-fall" cx={x} cy={y} r="2" fill={c} style={o(`${x}px ${y}px`, -i, 3)} />
      ))}
    </>
  ),
  scream_sky: ([a, b, c, d]) => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx="72" cy="72" r={54 + i * 4.5} fill="none" stroke={[a, b, c, a][i]} strokeWidth="4" strokeDasharray={`${30 + i * 9} ${8 + i * 3}`} className={i % 2 ? 'dk-spin rev' : 'dk-spin'} style={o('72px 72px', 0, 9 + i * 3)} opacity=".9" />
      ))}
      <path d="M-4 144L80 96l4 4-80 46Z" fill="#6b4a2a" stroke={d} strokeWidth="1.4" />
      <path d="M0 136L80 92M2 142L82 98" stroke={d} strokeWidth="1.2" />
    </>
  ),
  gold_mosaic: ([a, b, c, d]) => (
    <>
      <circle cx="72" cy="72" r="60" fill="none" stroke={b} strokeWidth="16" />
      {Array.from({ length: 30 }, (_, i) => {
        const deg = i * 12;
        const [x, y] = pt(deg, 60);
        return i % 3 === 0 ? (
          <path key={i} d={`M${x} ${y}m-4 0a4 4 0 1 1 4 4a2.6 2.6 0 1 1 -2.6 -2.6`} stroke={c} strokeWidth="1.4" fill="none" className="dk-spin" style={o(`${x}px ${y}px`, -i * 0.2, 6)} />
        ) : (
          <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill={i % 2 ? a : d} transform={`rotate(${deg} ${x} ${y})`} stroke={d} strokeWidth=".5" />
        );
      })}
      <Twinkles pts={[[22, 22, 4], [124, 30, 3.4], [118, 122, 4]]} fill="#fff8d6" />
    </>
  ),
  gorgon: ([a, b, c, d], u) => {
    const snake = (deg: number, i: number) => {
      const [x, y] = pt(deg, 46);
      return (
        <g key={deg} transform={`translate(${x} ${y}) rotate(${deg + 90})`}>
          <g className="dk-wiggle" style={o('0px 0px', -i * 0.3, 1.6)}>
            <path d="M0 0c-6-6 6-10 0-16s6-10 1-15" stroke={`url(#${u('sn')})`} strokeWidth="5" fill="none" strokeLinecap="round" />
            <ellipse cx="1" cy="-32" rx="4" ry="5" fill={a} stroke={d} strokeWidth="1" />
            <circle cx="-.6" cy="-33" r="1" fill={c} />
            <path d="M1-37v-4l-2-1M1-41l2-1" stroke="#ff3b5c" strokeWidth="1" />
          </g>
        </g>
      );
    };
    return (
      <>
        <defs>{lin(u('sn'), [[0, b], [1, a]])}</defs>
        {[200, 222, 245, 270, 295, 318, 340].map(snake)}
      </>
    );
  },
  ouroboros: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('ob'), [[0, a], [1, b]], 1, 1)}</defs>
      <g className="dk-spin" style={o('72px 72px', 0, 24)}>
        <circle cx="72" cy="72" r="58" fill="none" stroke={`url(#${u('ob')})`} strokeWidth="11" strokeDasharray="330 34" />
        <circle cx="72" cy="72" r="58" fill="none" stroke={d} strokeWidth="11" strokeDasharray="3 5" opacity=".25" />
        <g transform="rotate(-62 72 72)">
          <path d="M130 66c8-2 14 2 14 8s-6 10-14 8c-2-4-2-12 0-16Z" fill={a} stroke={d} strokeWidth="1.6" />
          <circle cx="138" cy="70" r="1.8" fill={c} />
        </g>
      </g>
    </>
  ),
  excalibur: ([a, b, c, d], u) => (
    <>
      <defs>{lin(u('xs'), [[0, c], [1, a]])}</defs>
      <path d="M86 144c0-12 8-20 22-22 16 0 26 8 26 22Z" fill="#6b6f7a" stroke={d} strokeWidth="1.6" />
      <path d="M94 130c8-4 18-4 28 2" stroke="#8a8f9a" strokeWidth="2" fill="none" />
      <g className="dk-glow" style={o('110px 80px', 0, 2.4)}>
        <rect x="107" y="58" width="6" height="66" fill={`url(#${u('xs')})`} stroke={d} strokeWidth="1" />
        <rect x="98" y="54" width="24" height="5" rx="2" fill="#d4a64a" stroke={d} strokeWidth="1" />
        <rect x="107.5" y="36" width="5" height="18" rx="2" fill="#5a3b1c" stroke={d} strokeWidth="1" />
        <circle cx="110" cy="34" r="4" fill={b} stroke={d} strokeWidth="1" />
      </g>
      <Twinkles pts={[[96, 44, 3.4], [126, 70, 3], [92, 96, 2.4]]} fill={c} />
    </>
  ),
  outlaw_cap: ([a, b, c, d]) => (
    <>
      <g transform="rotate(-14 66 20)">
        <path d="M30 34c4-18 20-28 40-28 16 0 30 8 40 22-24 4-52 6-80 6Z" fill={a} stroke={d} strokeWidth="2" />
        <path d="M100 28c12-18 24-28 38-30-6 12-18 24-34 32Z" fill="#c0392b" stroke={d} strokeWidth="1.4" className="dk-sway" style={o('100px 28px', 0, 2.4)} />
        <path d="M104 26l28-24" stroke={c} strokeWidth="1" />
      </g>
      <path d="M4 136L56 84M8 84l52 52" stroke="#6b4a2a" strokeWidth="3" strokeLinecap="round" />
      <path d="M56 84l-8 0 8-8ZM8 84l8 0-8-8Z" fill="#9aa0ab" stroke={d} strokeWidth="1" />
      <path d="M4 136l6-2-2 6ZM60 136l-6-2 2 6Z" fill={b} />
    </>
  ),
};

export const DECORATION_BASES = Object.keys(ART);

/** The art for one decoration id ("deco.kitty_ears.blush"). */
export function Decoration({ id, still }: { id: string; still?: boolean }) {
  const raw = useId();
  const item = ITEMS.get(id);
  const art = item ? ART[item.base] : undefined;
  if (!item || !art) return null;
  const uid = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  const u = (s: string) => `${uid}-${s}`;
  const p = (item.palette as Palette).c;
  return (
    <span className={`avatar-frame fa deco deco-${item.base}${still ? ' still' : ''}`} aria-hidden>
      <svg viewBox="0 0 144 144" overflow="visible">
        {art(p, u)}
      </svg>
    </span>
  );
}
