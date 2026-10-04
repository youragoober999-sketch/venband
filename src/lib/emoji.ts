// Emoji names, search and :shortcode: handling. The full list (~1,900 emoji
// with GitHub/Slack/Unicode names) is loaded on first use, not at start-up.
import { getSettings } from './settings';

export interface EmojiEntry {
  char: string;
  /** short names without colons, e.g. ["heart", "red_heart"] */
  names: string[];
  group: number;
  keywords: string;
}

export const EMOJI_GROUPS = [
  { id: 0, label: 'Smileys & Emotion', icon: '😀' },
  { id: 1, label: 'People & Body', icon: '👋' },
  { id: 3, label: 'Animals & Nature', icon: '🐻' },
  { id: 4, label: 'Food & Drink', icon: '🍔' },
  { id: 5, label: 'Travel & Places', icon: '✈️' },
  { id: 6, label: 'Activities', icon: '⚽' },
  { id: 7, label: 'Objects', icon: '💡' },
  { id: 8, label: 'Symbols', icon: '❤️' },
  { id: 9, label: 'Flags', icon: '🏁' },
];

/** Shown on the hover bar above messages, before your two most recent. */
export const QUICK_REACTIONS = ['👍', '✅', '❌', '❤️', '😂'];

/** A small built-in set so names work before the full list has loaded. */
const STARTER: [string, string][] = [
  ['❤️', 'heart red_heart'], ['💔', 'broken_heart'], ['👍', 'thumbsup +1 like'], ['👎', 'thumbsdown -1'],
  ['😂', 'joy laughing_crying'], ['😭', 'sob crying'], ['🔥', 'fire lit'], ['✅', 'white_check_mark check'],
  ['❌', 'x cross'], ['💀', 'skull dead'], ['😀', 'grinning smile'], ['😊', 'blush'], ['🙏', 'pray please thanks'],
  ['👀', 'eyes'], ['🎉', 'tada party'], ['💯', '100 hundred'], ['✨', 'sparkles'], ['😎', 'sunglasses cool'],
  ['🤔', 'thinking'], ['😍', 'heart_eyes'], ['🥺', 'pleading'], ['✌️', 'v peace victory'], ['👋', 'wave hi'],
];

let all: EmojiEntry[] = STARTER.map(([char, names]) => ({ char, names: names.split(' '), group: 0, keywords: '' }));
let byName = new Map<string, string>(all.flatMap((e) => e.names.map((n) => [n, e.char] as [string, string])));
let loading: Promise<EmojiEntry[]> | null = null;

export function loadEmoji(): Promise<EmojiEntry[]> {
  loading ??= import('./emoji-data.json').then((mod) => {
    const rows = (mod.default ?? mod) as unknown as [string, string, number, string][];
    all = rows.map(([char, names, group, keywords]) => ({ char, names: names.split(' ').filter(Boolean), group, keywords }));
    byName = new Map();
    for (const e of all) for (const n of e.names) if (!byName.has(n)) byName.set(n, e.char);
    return all;
  });
  return loading;
}

export function emojiList() {
  return all;
}

/** The emoji for a short name (without colons), if known. */
export function emojiByName(name: string): string | undefined {
  return byName.get(name.toLowerCase());
}

export function nameOfEmoji(char: string): string {
  return all.find((e) => e.char === char)?.names[0] ?? char;
}

export interface CustomEmoji {
  id: string;
  name: string;
  aliases: string[];
  url: string;
  animated?: boolean;
  serverName?: string;
}

export type EmojiMatch = { kind: 'unicode'; char: string; name: string } | { kind: 'custom'; emoji: CustomEmoji; name: string };

/**
 * Emoji whose names match `q` (without colons). Exact and prefix matches come
 * first, then your most-used emoji, then everything else.
 */
export function searchEmoji(q: string, custom: CustomEmoji[] = [], limit = 10): EmojiMatch[] {
  const query = q.toLowerCase().replace(/^:|:$/g, '');
  if (!query) return [];
  const usage = getSettings().emojiUsage;
  const scored: { m: EmojiMatch; score: number }[] = [];
  const rank = (names: string[], keywords: string, key: string) => {
    let best = -1;
    for (const n of names) {
      if (n === query) best = Math.max(best, 100);
      else if (n.startsWith(query)) best = Math.max(best, 80 - Math.min(20, n.length - query.length));
      else if (n.split('_').some((part) => part.startsWith(query))) best = Math.max(best, 50);
      else if (n.includes(query)) best = Math.max(best, 30);
    }
    if (best < 0 && query.length >= 3 && keywords.includes(query)) best = 15;
    if (best < 0) return -1;
    return best + Math.min(40, (usage[key] ?? 0) * 4);
  };
  for (const c of custom) {
    const s = rank([c.name.toLowerCase(), ...c.aliases.map((a) => a.toLowerCase())], '', `custom:${c.id}`);
    if (s >= 0) scored.push({ m: { kind: 'custom', emoji: c, name: c.name }, score: s + 5 });
  }
  for (const e of all) {
    const s = rank(e.names, e.keywords, e.char);
    if (s >= 0) scored.push({ m: { kind: 'unicode', char: e.char, name: e.names.find((n) => n.startsWith(query)) ?? e.names[0] }, score: s });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.m);
}

/** Your most-used emoji, most used first. */
export function frequentEmoji(n = 16): string[] {
  return Object.entries(getSettings().emojiUsage)
    .filter(([k]) => !k.startsWith('custom:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/**
 * Turn complete :name: codes into emoji before sending (code blocks and
 * links are left alone). Custom emoji become <:name:id> tokens.
 */
export function replaceShortcodes(text: string, custom: CustomEmoji[] = []): string {
  return text
    .split(/(```[\s\S]*?```|`[^`]*`|https?:\/\/\S+)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(^|[^\w<]):([a-z0-9_+-]{1,40}):/gi, (all, pre: string, name: string) => {
            const c = custom.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.aliases.some((a) => a.toLowerCase() === name.toLowerCase()));
            if (c) return `${pre}<${c.animated ? 'a' : ''}:${c.name}:${c.id}>`;
            const u = emojiByName(name);
            return u ? pre + u : all;
          }),
    )
    .join('');
}

/** Emoji characters used in a message (for usage stats). */
export function emojiIn(text: string): string[] {
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;
  if (!seg) return [];
  const out: string[] = [];
  for (const { segment } of seg.segment(text)) if (/\p{Extended_Pictographic}/u.test(segment)) out.push(segment);
  return out;
}
