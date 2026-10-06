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

/**
 * Letter-by-letter fallback.
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

  let out = '';
  for (const ch of upper) {
    const mapped = LETTER_MAP[ch];
    if (mapped && mapped[scriptIdx]) {
      out += mapped[scriptIdx];
    } else {
      out += ch; // keep unknown characters
    }
  }
  return out || null;
}