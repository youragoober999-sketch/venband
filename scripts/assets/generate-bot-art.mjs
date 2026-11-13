// Generates the built-in bots' profile pictures (512×512) and the official
// Venband bot's banner (1500×500) as SVG in public/bots/ — original artwork.
//   node scripts/assets/generate-bot-art.mjs
import fs from 'node:fs';

const src = fs.readFileSync('src/components/logoPath.ts', 'utf8');
const LOGO = /LOGO_PATH =\s*'([^']+)'/.exec(src)[1];
fs.mkdirSync('public/bots', { recursive: true });

const tile = (id, [c1, c2, c3], glyph) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient>
    <radialGradient id="l" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".28"/></filter>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#g)"/>
  <rect width="512" height="512" rx="128" fill="url(#l)"/>
  <g filter="url(#s)" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>
`;

const art = {
  // waving hand + sparkles
  greeter: tile('greeter', ['#ffb36b', '#ff7a45', '#e5484d'], `
    <path d="M196 300V170a26 26 0 0 1 52 0v96M248 266V142a26 26 0 0 1 52 0v124M300 266V160a26 26 0 0 1 52 0v122M352 282v-62a26 26 0 0 1 52 0v96c0 72-52 122-122 122h-14c-44 0-74-18-100-50l-58-74a28 28 0 0 1 42-36l40 38"/>
    <path d="M120 150l-18-18M150 108l-6-26M96 196l-26-4" stroke-width="22"/>`),
  // shield + check
  gatekeeper: tile('gatekeeper', ['#5eead4', '#22c55e', '#15803d'], `
    <path d="M256 92l132 50v96c0 92-58 156-132 182-74-26-132-90-132-182v-96z" fill="#ffffff22"/>
    <path d="M196 262l42 42 82-88"/>`),
  // 3×3 letter tiles (generic word game)
  wordguess: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2f3a"/><stop offset="1" stop-color="#14161c"/></linearGradient></defs>
  <rect width="512" height="512" rx="128" fill="url(#g)"/>
  ${[0, 1, 2].map((r) => [0, 1, 2].map((c) => {
    const fill = (r === 2 && c < 3) ? '#4caf50' : (r === 1 && c === 1) ? '#e9b949' : (r === 0 && c === 2) ? '#e9b949' : '#4b5060';
    return `<rect x="${96 + c * 112}" y="${96 + r * 112}" width="96" height="96" rx="18" fill="${fill}"/>`;
  }).join('')).join('')}
  <text x="256" y="390" font-family="system-ui, Arial, sans-serif" font-weight="900" font-size="64" fill="#fff" text-anchor="middle" letter-spacing="40">ABC</text>
</svg>
`,
  // megaphone
  announcer: tile('announcer', ['#f9a8d4', '#ec4899', '#9d174d'], `
    <path d="M120 226h56l136-72v204l-136-72h-56a20 20 0 0 1-20-20v-20a20 20 0 0 1 20-20z" fill="#ffffff22"/>
    <path d="M176 286l24 96h44l-20-82M360 210c26 18 26 74 0 92M396 178c48 36 48 120 0 156" stroke-width="26"/>`),
  // gavel + spark
  modtoolkit: tile('modtoolkit', ['#fca5a5', '#ef4444', '#991b1b'], `
    <g transform="rotate(-40 230 210)"><rect x="150" y="150" width="170" height="86" rx="20" fill="#ffffff22"/><path d="M235 236v176"/></g>
    <path d="M318 402h104" stroke-width="28"/>`),
};
for (const [name, svg] of Object.entries(art)) fs.writeFileSync(`public/bots/${name}.svg`, svg);

// the official Venband bot's banner
fs.writeFileSync('public/bots/venband-banner.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0b14"/><stop offset=".55" stop-color="#1a1240"/><stop offset="1" stop-color="#3b1d6e"/></linearGradient>
    <radialGradient id="o1" cx=".78" cy=".35" r=".45"><stop offset="0" stop-color="#7c5cff" stop-opacity=".55"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
    <radialGradient id="o2" cx=".2" cy=".9" r=".5"><stop offset="0" stop-color="#ff5d8f" stop-opacity=".35"/><stop offset="1" stop-color="#ff5d8f" stop-opacity="0"/></radialGradient>
    <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9c2ff"/></linearGradient>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#ffffff" fill-opacity=".07"/></pattern>
  </defs>
  <rect width="1500" height="500" fill="url(#bg)"/>
  <rect width="1500" height="500" fill="url(#dots)"/>
  <rect width="1500" height="500" fill="url(#o1)"/>
  <rect width="1500" height="500" fill="url(#o2)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="2">
    <path d="M0 380 C 300 300, 520 460, 820 360 S 1300 260, 1500 330"/>
    <path d="M0 420 C 320 340, 540 500, 840 400 S 1320 300, 1500 370"/>
  </g>
  <g transform="translate(1030 110) scale(0.46)" opacity=".95">
    <path d="${LOGO}" fill="url(#logo)" fill-rule="evenodd"/>
  </g>
  <text x="120" y="250" font-family="Inter, system-ui, Segoe UI, Arial, sans-serif" font-size="96" font-weight="800" fill="#ffffff" letter-spacing="-2">Venband</text>
  <text x="124" y="312" font-family="Inter, system-ui, Segoe UI, Arial, sans-serif" font-size="34" font-weight="500" fill="#c9c2ff">The official Venband bot</text>
</svg>
`);
console.log('wrote', Object.keys(art).length, 'bot pictures + venband-banner.svg');
