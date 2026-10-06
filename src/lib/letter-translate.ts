export const LETTER_MAP: Record<string, string[]> = {
  A: ['А', 'Α', 'أ', 'א', 'अ', 'ア', 'ㅏ', 'আ', 'อ'],
  B: ['Б', 'Β', 'ب', 'ב', 'ब', 'バ', 'ㅂ', 'ব', 'บ'],
  C: ['Ц', 'Κ', 'ك', 'כ', 'क', 'カ', 'ㅋ', 'ক', 'ค'],
  D: ['Д', 'Δ', 'د', 'ד', 'द', 'ダ', 'ㄷ', 'দ', 'ด'],
  E: ['Е', 'Ε', 'إ', 'א', 'ए', 'エ', 'ㅔ', 'এ', 'เอ'],
  F: ['Ф', 'Φ', 'ف', 'פ', 'फ', 'フ', 'ㅍ', 'ফ', 'ฟ'],
  G: ['Г', 'Γ', 'غ', 'ג', 'ग', 'ガ', 'ㄱ', 'গ', 'ก'],
  H: ['Х', 'Η', 'ه', 'ה', 'ह', 'ハ', 'ㅎ', 'হ', 'ฮ'],
  I: ['И', 'Ι', 'ي', 'י', 'इ', 'イ', 'ㅣ', 'ই', 'อิ'],
  J: ['Й', 'Ι', 'ج', 'י', 'ज', 'ジ', 'ㅈ', 'জ', 'จ'],
  K: ['К', 'Κ', 'ك', 'ק', 'क', 'カ', 'ㅋ', 'ক', 'ก'],
  L: ['Л', 'Λ', 'ل', 'ל', 'ल', 'ラ', 'ㄹ', 'ল', 'ล'],
  M: ['М', 'Μ', 'م', 'מ', 'म', 'マ', 'ㅁ', 'ম', 'ม'],
  N: ['Н', 'Ν', 'ن', 'נ', 'न', 'ナ', 'ㄴ', 'ন', 'น'],
  O: ['О', 'Ο', 'و', 'ו', 'ओ', 'オ', 'ㅗ', 'ও', 'โอ'],
  P: ['П', 'Π', 'ب', 'פ', 'प', 'パ', 'ㅍ', 'প', 'ป'],
  Q: ['К', 'Κ', 'ق', 'ק', 'क', 'ク', 'ㅋ', 'ক', 'ค'],
  R: ['Р', 'Ρ', 'ر', 'ר', 'र', 'ラ', 'ㄹ', 'র', 'ร'],
  S: ['С', 'Σ', 'س', 'ס', 'स', 'サ', 'ㅅ', 'স', 'ซ'],
  T: ['Т', 'Τ', 'ت', 'ת', 'त', 'タ', 'ㅌ', 'ত', 'ต'],
  U: ['У', 'Υ', 'و', 'ו', 'उ', 'ウ', 'ㅜ', 'উ', 'อุ'],
  V: ['В', 'Β', 'ف', 'ב', 'व', 'ヴ', 'ㅂ', 'ভ', 'ว'],
  W: ['В', 'ΟΥ', 'و', 'ו', 'व', 'ワ', 'ㅜ', 'ওয়া', 'ว'],
  X: ['КС', 'Ξ', 'كس', 'קס', 'क्ष', 'クス', 'ㅋㅅ', 'ক্স', 'ซ'],
  Y: ['Ы', 'Υ', 'ي', 'י', 'य', 'ヤ', 'ㅣ', 'য', 'ย'],
  Z: ['З', 'Ζ', 'ز', 'ז', 'ज़', 'ザ', 'ㅈ', 'জ', 'ซ'],
};

// Script index → language codes that primarily use it
export const SCRIPT_INDEX = {
  0: ['ru', 'uk'],          // Cyrillic
  1: ['el'],                // Greek
  2: ['ar'],                // Arabic
  3: ['he'],                // Hebrew
  4: ['hi'],                // Devanagari
  5: ['ja'],                // Katakana
  6: ['ko'],                // Hangul
  7: ['bn'],                // Bengali
  8: ['th'],                // Thai
} as const;

// Multi-letter sequences that collapse into a single character (or cluster)
// in the target script. Keyed by script index, same as SCRIPT_INDEX.
// Matching is longest-first (3 letters, then 2), then falls back to LETTER_MAP.
export const DIGRAPHS: Record<number, Record<string, string>> = {
  // Cyrillic
  0: {
    SCH: 'Щ', SH: 'Ш', CH: 'Ч', ZH: 'Ж', TS: 'Ц', KH: 'Х',
    YA: 'Я', YU: 'Ю', YO: 'Ё', EE: 'И', OO: 'У',
  },
  // Greek
  1: {
    TH: 'Θ', PS: 'Ψ', PH: 'Φ', CH: 'Χ', KH: 'Χ',
    OU: 'ΟΥ', OO: 'ΟΥ', EI: 'ΕΙ', AI: 'ΑΙ', NG: 'ΓΓ',
  },
  // Arabic
  2: {
    SH: 'ش', KH: 'خ', TH: 'ث', GH: 'غ', DH: 'ذ', CH: 'تش',
    AA: 'ا', EE: 'ي', OO: 'و',
  },
  // Hebrew
  3: {
    SH: 'ש', CH: 'ח', KH: 'ח', TS: 'צ', TH: 'ת',
    EE: 'י', OO: 'ו', AA: 'א',
  },
  // Devanagari
  4: {
    KH: 'ख', GH: 'घ', CH: 'च', JH: 'झ', TH: 'थ', DH: 'ध',
    PH: 'फ', BH: 'भ', SH: 'श', AA: 'आ', EE: 'ई', OO: 'ऊ',
    AI: 'ऐ', AU: 'औ',
  },
  // Katakana (syllabic: common romaji clusters)
  5: {
    SHI: 'シ', CHI: 'チ', TSU: 'ツ', SH: 'シ', CH: 'チ', TS: 'ツ',
    AA: 'アー', EE: 'イー', OO: 'オー', UU: 'ウー',
  },
  // Hangul (jamo)
  6: {
    CH: 'ㅊ', SH: 'ㅅ', NG: 'ㅇ', KK: 'ㄲ', TT: 'ㄸ', PP: 'ㅃ',
    SS: 'ㅆ', JJ: 'ㅉ', AE: 'ㅐ', EO: 'ㅓ', EU: 'ㅡ', OE: 'ㅚ',
    OO: 'ㅜ', WA: 'ㅘ', YA: 'ㅑ', YO: 'ㅛ', YU: 'ㅠ',
  },
  // Bengali
  7: {
    KH: 'খ', GH: 'ঘ', CH: 'চ', JH: 'ঝ', TH: 'থ', DH: 'ধ',
    PH: 'ফ', BH: 'ভ', SH: 'শ', NG: 'ঙ', AA: 'আ', EE: 'ঈ', OO: 'ঊ',
  },
  // Thai
  8: {
    KH: 'ข', CH: 'ช', TH: 'ท', PH: 'พ', SH: 'ศ', NG: 'ง',
    AA: 'อา', EE: 'อี', OO: 'อู',
  },
};

// Scripts where a doubled consonant takes a gemination marker.
const GEMINATION: Record<number, string> = {
  5: 'ッ', // Katakana sokuon: KK -> ッカ
};

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
const MAX_SEQ = 3;

/**
 * Letter-by-letter fallback with digraph awareness.
 * Converts a Latin word into the closest script form for the target language.
 * Returns null if the target has no mapped script.
 */
export function letterTranslate(word: string, target: string): string | null {
  const upper = word.toUpperCase();
  let scriptIdx = -1;

  for (const [idx, langs] of Object.entries(SCRIPT_INDEX)) {
    if ((langs as readonly string[]).includes(target)) {
      scriptIdx = Number(idx);
      break;
    }
  }
  if (scriptIdx === -1) return null;

  const table = DIGRAPHS[scriptIdx] ?? {};
  const chars = Array.from(upper);
  let out = '';
  let i = 0;

  while (i < chars.length) {
    // 1. Longest digraph/trigraph match
    let matched = false;
    for (let len = Math.min(MAX_SEQ, chars.length - i); len >= 2; len--) {
      const seq = chars.slice(i, i + len).join('');
      const hit = table[seq];
      if (hit) {
        out += hit;
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const ch = chars[i];

    // 2. Doubled consonant -> gemination marker where the script has one
    const mark = GEMINATION[scriptIdx];
    if (mark && ch === chars[i + 1] && LETTER_MAP[ch] && !VOWELS.has(ch)) {
      out += mark;
      i += 1; // consume one, the second is mapped normally next
      continue;
    }

    // 3. Single-letter fallback
    const mapped = LETTER_MAP[ch];
    out += mapped && mapped[scriptIdx] ? mapped[scriptIdx] : ch;
    i += 1;
  }

  return out || null;
}