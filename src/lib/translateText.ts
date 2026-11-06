// Pure text helpers for translation (no imports, unit-tested in tests/translateText.test.ts).

// ``` blocks, `code`, links, <@mentions>/<#channels>, <:emoji:id>, :shortcodes:
const PROTECT = /```[\s\S]*?```|`[^`\n]+`|https?:\/\/\S+|<[@#][&!]?[0-9a-f-]{36}>|<a?:\w+:[^>]+>|:[a-z0-9_+-]{2,32}:/gi;

/** Swap untranslatable pieces for numbered markers the translators leave alone. */
export function protect(text: string): { text: string; restore: (s: string) => string } {
  const kept: string[] = [];
  const out = text.replace(PROTECT, (m) => `⟦${kept.push(m) - 1}⟧`);
  return {
    text: out,
    // translators sometimes add spaces inside the brackets or swap them for similar ones
    restore: (s) => s.replace(/[⟦[]\s*(\d+)\s*[⟧\]]/g, (m, n) => kept[Number(n)] ?? m),
  };
}

// Chat slang translators take literally ("no cap" → "without a hat"). Spelled
// out in plain English first, so every target language gets the meaning. Only
// used on English (or undetected Latin-script) text, and only for whole words.
const SLANG: [RegExp, string][] = [
  [/\b(is|was|so|lowkey|straight|looks|sounds|looking|sounding)\s+fire\b/gi, '$1 amazing'],
  [/\bno cap\b/gi, 'for real'],
  [/\bngl\b/gi, 'not gonna lie'],
  [/\blowkey\b/gi, 'kind of'],
  [/\bhighkey\b/gi, 'really'],
  [/\btbh\b/gi, 'to be honest'],
  [/\bidk\b/gi, "I don't know"],
  [/\bidc\b/gi, "I don't care"],
  [/\bimh?o\b/gi, 'in my opinion'],
  [/\brn\b/gi, 'right now'],
  [/\bbtw\b/gi, 'by the way'],
  [/\bsmh\b/gi, 'shaking my head'],
  [/\bbrb\b/gi, 'be right back'],
  [/\b(gtg|g2g)\b/gi, 'got to go'],
  [/\bomw\b/gi, 'on my way'],
  [/\bnvm\b/gi, 'never mind'],
  [/\bikr\b/gi, 'I know, right'],
  [/\bfr\b/gi, 'for real'],
  [/\bwyd\b/gi, 'what are you doing'],
  [/\b(hbu|wbu)\b/gi, 'how about you'],
  [/\blmk\b/gi, 'let me know'],
  [/\bhmu\b/gi, 'message me'],
  [/\bjk\b/gi, 'just kidding'],
  [/\birl\b/gi, 'in real life'],
  [/\bdw\b/gi, "don't worry"],
  [/\bafk\b/gi, 'away from keyboard'],
  [/\bgg\b/gi, 'good game'],
  [/\bsus\b/gi, 'suspicious'],
  [/\bgoated\b/gi, 'the best'],
  [/\b(tmr|tmrw|tmrow)\b/gi, 'tomorrow'],
  [/\bppl\b/gi, 'people'],
  [/\babt\b/gi, 'about'],
  [/\b(pls|plz)\b/gi, 'please'],
  [/\b(thx|thnx)\b/gi, 'thanks'],
  [/\bty\b/gi, 'thank you'],
  [/\bnp\b/gi, 'no problem'],
  [/\b(bc|cuz|coz)\b/gi, 'because'],
  [/\bw\/(?=\s)/gi, 'with'],
  [/\bur\b/gi, 'your'],
  [/\bu\b/gi, 'you'],
  [/\bim\b/gi, "I'm"],
  [/\bdont\b/gi, "don't"],
  [/\bcant\b/gi, "can't"],
  [/\bwhats\b/gi, "what's"],
];
// Acronyms that are never real words in another Latin-script language: safe to
// expand even when the language is only guessed ("im", "dont", "u"… are not).
const UNAMBIGUOUS = /ngl|no cap|lowkey|highkey|tbh|idk|idc|smh|brb|gtg|g2g|omw|nvm|ikr|wyd|hbu|wbu|lmk|hmu|irl|afk|goated|tmrw|thx/;
export function plainEnglish(text: string, sure = true): string {
  return SLANG.reduce((t, [re, to]) => (sure || UNAMBIGUOUS.test(re.source) ? t.replace(re, to) : t), text);
}

/** Only Latin letters (plus spaces, digits, punctuation, symbols, markers)? */
export const latinOnly = (s: string) => /^[\p{Script=Latin}\p{Z}\p{P}\p{S}\p{N}\s⟦⟧]*$/u.test(s);
