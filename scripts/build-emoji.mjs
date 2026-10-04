// Builds src/lib/emoji-data.json from emojibase-data: [emoji, "short_names", group, "keywords"].
// Run: node scripts/build-emoji.mjs  (output is committed; the app lazy-loads it)
import { readFileSync, writeFileSync } from 'node:fs';
const load = (p) => JSON.parse(readFileSync(new URL(`../node_modules/emojibase-data/en/${p}`, import.meta.url), 'utf8'));
const compact = load('compact.json');
const sources = [load('shortcodes/github.json'), load('shortcodes/iamcal.json'), load('shortcodes/cldr.json')];
const out = [];
for (const e of compact) {
  if (e.group === undefined || e.group === 2) continue; // skip skin-tone components
  const names = new Set();
  for (const src of sources) {
    const v = src[e.hexcode];
    for (const n of Array.isArray(v) ? v : v ? [v] : []) names.add(n.toLowerCase());
  }
  names.add(e.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  out.push([e.unicode, [...names].join(' '), e.group, (e.tags ?? []).join(' ')]);
}
out.sort((a, b) => compact.find((x) => x.unicode === a[0]).order - compact.find((x) => x.unicode === b[0]).order);
writeFileSync(new URL('../src/lib/emoji-data.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} emoji`);
