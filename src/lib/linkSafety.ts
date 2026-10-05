// Checks links before they open: look-alike letters, raw IP addresses,
// hidden destinations, fake brand names, link shorteners and plain http.
export type LinkLevel = 'safe' | 'caution' | 'danger';
export interface LinkCheck {
  url: string;
  host: string;
  level: LinkLevel;
  risks: string[];
}

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'rebrand.ly'];
const BRANDS: Record<string, string[]> = {
  venband: ['venband.com', 'venband.gg'],
  discord: ['discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'discordapp.net'],
  steamcommunity: ['steamcommunity.com'],
  steampowered: ['steampowered.com'],
  paypal: ['paypal.com', 'paypal.me'],
  roblox: ['roblox.com'],
  epicgames: ['epicgames.com'],
  microsoft: ['microsoft.com', 'live.com', 'xbox.com'],
  apple: ['apple.com', 'icloud.com'],
  google: ['google.com', 'youtube.com', 'gmail.com'],
};
/** Sites Venband trusts without asking. */
export const BUILTIN_TRUSTED = ['venband.com', 'venband.gg', 'youtube.com', 'youtu.be', 'open.spotify.com', 'wikipedia.org', 'github.com', 'klipy.com', 'tiktok.com', 'instagram.com', 'google.com'];

function within(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function checkLink(raw: string, shownText?: string): LinkCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, host: raw, level: 'danger', risks: ['This isn’t a normal web address.'] };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const risks: string[] = [];
  let level: LinkLevel = 'safe';
  const bump = (l: LinkLevel, why: string) => {
    risks.push(why);
    if (l === 'danger' || (l === 'caution' && level === 'safe')) level = l;
  };
  if (!/^https?:$/.test(u.protocol)) bump('danger', `It uses “${u.protocol}” instead of a website address.`);
  if (u.username || u.password || /@/.test(raw.split('/')[2] ?? '')) bump('danger', 'The real website is hidden after an “@”.');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) bump('danger', 'It goes to a raw IP address instead of a named website.');
  if (host.split('.').some((p) => p.startsWith('xn--'))) bump('danger', 'The address uses look-alike letters from another alphabet.');
  // swap common digit tricks back (paypa1 -> paypal, g00gle -> google)
  const words = host
    .replace(/\.[^.]+$/, '')
    .split(/[.-]/)
    .map((w) => w.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's'));
  for (const [brand, official] of Object.entries(BRANDS)) {
    if (official.some((d) => within(host, d))) continue;
    if (words.some((w) => w === brand || (w.length > 4 && editDistance(w, brand) <= 1) || (w.length > 6 && w.includes(brand)))) {
      bump('danger', `It pretends to be ${brand[0].toUpperCase() + brand.slice(1)} but isn’t their real website.`);
      break;
    }
  }
  if (SHORTENERS.some((s) => within(host, s))) bump('caution', 'It’s a short link, so you can’t see where it really goes.');
  if (/\.(zip|mov|top|xyz|click|country|gq|tk|ml|cf)$/.test(host)) bump('caution', 'Its ending is often used by scam sites.');
  if (u.protocol === 'http:') bump('caution', 'The connection isn’t encrypted (http, not https).');
  if (shownText) {
    const m = shownText.trim().match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:[/?#]|$)/i);
    if (m && !within(host, m[1].toLowerCase().replace(/^www\./, ''))) bump('danger', `The text says ${m[1]} but the link goes to ${host}.`);
  }
  return { url: raw, host, level, risks };
}

export function isTrusted(host: string, trusted: string[]) {
  return [...BUILTIN_TRUSTED, ...trusted].some((d) => within(host, d));
}
