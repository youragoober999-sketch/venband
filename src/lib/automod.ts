// Client-side AutoMod. Messages are end-to-end encrypted, so the server can't
// read them: every member's app enforces the server's AutoMod setting itself
// (the sender is stopped before sending, readers see matches hidden).

// Stored lightly obfuscated (reversed) so the source doesn't read as a list of
// slurs; matching is done on a normalised copy of the message.
const REVERSED = [
  'reggin', 'aggin', 'reggin', 'aggin', 'toggaf', 'gaf', 'kcips', 'knihc', 'koog', 'ekyk', 'gnohc', 'deddatr', 'drater',
  'ynnart', 'ekid', 'kcabtew', 'naeps', 'peewt', 'gnimmorg', 'lleps', 'oob raj', 'eehsur',
];
const SLURS = [...new Set(REVERSED.map((w) => w.split('').reverse().join('')))];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g' };

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[01!34@5$789]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1') // niiiice -> niice
    .replace(/[^a-z\s]/g, '');
}

const PATTERNS = SLURS.map((w) => new RegExp(`(^|\\s)${w.replace(/\s/g, '\\s*')}(s|z|es)?(\\s|$)`));

export function containsSlur(text: string): boolean {
  const n = ` ${normalise(text)} `;
  return PATTERNS.some((p) => p.test(n));
}
