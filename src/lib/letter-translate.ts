// Letter-by-letter fallback for the built-in translator. Every Latin letter
// maps to a single character in each target script, and DIGRAPHS below smooth
// out the common consonant/vowel clusters. Position in each row matches the
// script index in SCRIPT_INDEX:
//   0 Cyrillic  1 Greek    2 Arabic   3 Hebrew   4 Devanagari
//   5 Katakana  6 Hangul   7 Bengali  8 Thai     9 Sinhala
//  10 Tamil    11 Telugu  12 Kannada 13 Malayalam 14 Gujarati
//  15 Gurmukhi 16 Myanmar 17 Khmer   18 Lao     19 Georgian
//  20 Armenian 21 Amharic
export const LETTER_MAP: Record<string, string[]> = {
  A: ['А', 'Α', 'أ', 'א', 'अ', 'ア', 'ㅏ', 'আ', 'อ', 'අ', 'அ', 'అ', 'ಅ', 'അ', 'અ', 'ਅ', 'အ', 'អ', 'ອ', 'ა', 'Ա', 'አ'],
  B: ['Б', 'Β', 'ب', 'ב', 'ब', 'バ', 'ㅂ', 'ব', 'บ', 'බ', 'ப', 'బ', 'ಬ', 'ബ', 'બ', 'ਬ', 'ဘ', 'ប', 'ບ', 'ბ', 'Բ', 'በ'],
  C: ['Ц', 'Κ', 'ك', 'כ', 'क', 'カ', 'ㅋ', 'ক', 'ค', 'ච', 'ச', 'చ', 'ಚ', 'ച', 'ચ', 'ਚ', 'စ', 'ច', 'ຈ', 'ც', 'Ծ', 'ቸ'],
  D: ['Д', 'Δ', 'د', 'ד', 'द', 'ダ', 'ㄷ', 'দ', 'ด', 'ද', 'த', 'ద', 'ದ', 'ദ', 'દ', 'ਦ', 'ဒ', 'ដ', 'ດ', 'დ', 'Դ', 'ደ'],
  E: ['Е', 'Ε', 'إ', 'א', 'ए', 'エ', 'ㅔ', 'এ', 'เอ', 'එ', 'எ', 'ఎ', 'ಎ', 'എ', 'એ', 'ਏ', 'ဧ', 'ឯ', 'ເອ', 'ე', 'Ե', 'እ'],
  F: ['Ф', 'Φ', 'ف', 'פ', 'फ', 'フ', 'ㅍ', 'ফ', 'ฟ', 'ෆ', 'ஃ', 'ఫ', 'ಫ', 'ഫ', 'ફ', 'ਫ', 'ဖ', 'ហ្វ', 'ຟ', 'ფ', 'Ֆ', 'ፈ'],
  G: ['Г', 'Γ', 'غ', 'ג', 'ग', 'ガ', 'ㄱ', 'গ', 'ก', 'ග', 'க', 'గ', 'ಗ', 'ഗ', 'ગ', 'ਗ', 'ဂ', 'គ', 'ກ', 'გ', 'Գ', 'ገ'],
  H: ['Х', 'Η', 'ه', 'ה', 'ह', 'ハ', 'ㅎ', 'হ', 'ฮ', 'හ', 'ஹ', 'హ', 'ಹ', 'ഹ', 'હ', 'ਹ', 'ဟ', 'ហ', 'ຫ', 'ჰ', 'Հ', 'ሀ'],
  I: ['И', 'Ι', 'ي', 'י', 'इ', 'イ', 'ㅣ', 'ই', 'อิ', 'ඉ', 'இ', 'ఇ', 'ಇ', 'ഇ', 'ઇ', 'ਇ', 'ဣ', 'ឥ', 'ອິ', 'ი', 'Ի', 'ኢ'],
  J: ['Й', 'Ι', 'ج', 'י', 'ज', 'ジ', 'ㅈ', 'জ', 'จ', 'ජ', 'ஜ', 'జ', 'ಜ', 'ജ', 'જ', 'ਜ', 'ဇ', 'ជ', 'ຈ', 'ჯ', 'Ջ', 'ጀ'],
  K: ['К', 'Κ', 'ك', 'ק', 'क', 'カ', 'ㅋ', 'ক', 'ก', 'ක', 'க', 'క', 'ಕ', 'ക', 'ક', 'ਕ', 'က', 'ក', 'ກ', 'კ', 'Կ', 'ከ'],
  L: ['Л', 'Λ', 'ل', 'ל', 'ल', 'ラ', 'ㄹ', 'ল', 'ล', 'ල', 'ல', 'ల', 'ಲ', 'ല', 'લ', 'ਲ', 'လ', 'ល', 'ລ', 'ლ', 'Լ', 'ለ'],
  M: ['М', 'Μ', 'م', 'מ', 'म', 'マ', 'ㅁ', 'ম', 'ม', 'ම', 'ம', 'మ', 'ಮ', 'മ', 'મ', 'ਮ', 'မ', 'ម', 'ມ', 'მ', 'Մ', 'መ'],
  N: ['Н', 'Ν', 'ن', 'נ', 'न', 'ナ', 'ㄴ', 'ন', 'น', 'න', 'ந', 'న', 'ನ', 'ന', 'ન', 'ਨ', 'န', 'ន', 'ນ', 'ნ', 'Ն', 'ነ'],
  O: ['О', 'Ο', 'و', 'ו', 'ओ', 'オ', 'ㅗ', 'ও', 'โอ', 'ඔ', 'ஒ', 'ఒ', 'ಒ', 'ഒ', 'ઓ', 'ਓ', 'ဩ', 'ឱ', 'ໂອ', 'ო', 'Ո', 'ኦ'],
  P: ['П', 'Π', 'ب', 'פ', 'प', 'パ', 'ㅍ', 'প', 'ป', 'ප', 'ப', 'ప', 'ಪ', 'പ', 'પ', 'ਪ', 'ပ', 'ព', 'ປ', 'პ', 'Պ', 'ፐ'],
  Q: ['К', 'Κ', 'ق', 'ק', 'क', 'ク', 'ㅋ', 'ক', 'ค', 'ක්', 'க்', 'క్', 'ಕ್', 'ക്', 'ક', 'ਕ', 'က်', 'ក', 'ກ', 'ქ', 'Ք', 'ቅ'],
  R: ['Р', 'Ρ', 'ر', 'ר', 'र', 'ラ', 'ㄹ', 'র', 'ร', 'ර', 'ர', 'ర', 'ರ', 'ര', 'ર', 'ਰ', 'ရ', 'រ', 'ຣ', 'რ', 'Ր', 'ረ'],
  S: ['С', 'Σ', 'س', 'ס', 'स', 'サ', 'ㅅ', 'স', 'ซ', 'ස', 'ஸ', 'స', 'ಸ', 'സ', 'સ', 'ਸ', 'စ', 'ស', 'ສ', 'ს', 'Ս', 'ሰ'],
  T: ['Т', 'Τ', 'ت', 'ת', 'त', 'タ', 'ㅌ', 'ত', 'ต', 'ත', 'த', 'త', 'ತ', 'ത', 'ત', 'ਤ', 'တ', 'ត', 'ຕ', 'ტ', 'Տ', 'ተ'],
  U: ['У', 'Υ', 'و', 'ו', 'उ', 'ウ', 'ㅜ', 'উ', 'อุ', 'උ', 'உ', 'ఉ', 'ಉ', 'ഉ', 'ઉ', 'ਉ', 'ဥ', 'ឧ', 'ອຸ', 'უ', 'ՈՒ', 'ኡ'],
  V: ['В', 'Β', 'ف', 'ב', 'व', 'ヴ', 'ㅂ', 'ভ', 'ว', 'ව', 'வ', 'వ', 'ವ', 'വ', 'વ', 'વ', 'ဝ', 'វ', 'ວ', 'ვ', 'Վ', 'ቭ'],
  W: ['В', 'ΟΥ', 'و', 'ו', 'व', 'ワ', 'ㅜ', 'ওয়া', 'ว', 'ව', 'வ', 'వ', 'ವ', 'വ', 'વ', 'વ', 'ဝ', 'វ', 'ວ', 'ვ', 'Վ', 'ወ'],
  X: ['КС', 'Ξ', 'كس', 'קס', 'क्ष', 'クス', 'ㅋㅅ', 'ক্স', 'ซ', 'ඒක්ස්', 'க்ஸ்', 'క్స్', 'ಕ್ಸ್', 'ക്സ്', 'ક્સ', 'ਕ੍ਸ', 'ကဆ်', 'ក្ស', 'ຊ', 'ხს', 'ՔՍ', 'እክስ'],
  Y: ['Ы', 'Υ', 'ي', 'י', 'य', 'ヤ', 'ㅣ', 'য', 'ย', 'ය', 'ய', 'య', 'ಯ', 'യ', 'ય', 'ਯ', 'ယ', 'យ', 'ຢ', 'ჲ', 'Յ', 'የ'],
  Z: ['З', 'Ζ', 'ز', 'ז', 'ज़', 'ザ', 'ㅈ', 'জ', 'ซ', 'ස', 'ஸ', 'జ', 'ಜ', 'ജ', 'ઝ', 'ਜ', 'ဇ', 'ហ្ស', 'ຊ', 'ზ', 'Զ', 'ዘ'],
};

// Script index → language codes that primarily use it
export const SCRIPT_INDEX = {
  0: ['ru', 'uk', 'bg', 'sr', 'mk', 'be'], // Cyrillic
  1: ['el'],                // Greek
  2: ['ar', 'fa', 'ur'],    // Arabic
  3: ['he'],                // Hebrew
  4: ['hi', 'ne'],          // Devanagari
  5: ['ja'],                // Katakana
  6: ['ko'],                // Hangul
  7: ['bn'],                // Bengali
  8: ['th'],                // Thai
  9: ['si'],                // Sinhala
  10: ['ta'],               // Tamil
  11: ['te'],               // Telugu
  12: ['kn'],               // Kannada
  13: ['ml'],               // Malayalam
  14: ['gu'],               // Gujarati
  15: ['pa'],               // Gurmukhi (Punjabi)
  16: ['my'],               // Myanmar (Burmese)
  17: ['km'],               // Khmer
  18: ['lo'],               // Lao
  19: ['ka'],               // Georgian
  20: ['hy'],               // Armenian
  21: ['am'],               // Amharic / Ethiopic
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
  // Sinhala
  9: {
    CH: 'ච', KH: 'ඛ', GH: 'ඝ', TH: 'ථ', DH: 'ධ', PH: 'ඵ',
    BH: 'භ', SH: 'ශ', NG: 'ඟ', AA: 'ආ', EE: 'ඊ', OO: 'ඌ',
    AI: 'ඓ', AU: 'ඖ',
  },
  // Tamil
  10: {
    CH: 'ச', KH: 'க', TH: 'த', PH: 'ப', SH: 'ஷ', NG: 'ங',
    AA: 'ஆ', EE: 'ஈ', OO: 'ஊ', AI: 'ஐ', AU: 'ஔ',
  },
  // Telugu
  11: {
    CH: 'చ', KH: 'ఖ', GH: 'ఘ', TH: 'థ', DH: 'ధ', PH: 'ఫ',
    BH: 'భ', SH: 'శ', NG: 'ఙ', AA: 'ఆ', EE: 'ఈ', OO: 'ఊ',
    AI: 'ఐ', AU: 'ఔ',
  },
  // Kannada
  12: {
    CH: 'ಚ', KH: 'ಖ', GH: 'ಘ', TH: 'ಥ', DH: 'ಧ', PH: 'ಫ',
    BH: 'ಭ', SH: 'ಶ', NG: 'ಙ', AA: 'ಆ', EE: 'ಈ', OO: 'ಊ',
    AI: 'ಐ', AU: 'ಔ',
  },
  // Malayalam
  13: {
    CH: 'ച', KH: 'ഖ', GH: 'ഘ', TH: 'ഥ', DH: 'ധ', PH: 'ഫ',
    BH: 'ഭ', SH: 'ശ', NG: 'ങ', AA: 'ആ', EE: 'ഈ', OO: 'ഊ',
    AI: 'ഐ', AU: 'ഔ',
  },
  // Gujarati
  14: {
    CH: 'ચ', KH: 'ખ', GH: 'ઘ', TH: 'થ', DH: 'ધ', PH: 'ફ',
    BH: 'ભ', SH: 'શ', NG: 'ઙ', AA: 'આ', EE: 'ઈ', OO: 'ઊ',
    AI: 'ઐ', AU: 'ઔ',
  },
  // Gurmukhi
  15: {
    CH: 'ਚ', KH: 'ਖ', GH: 'ਘ', TH: 'ਥ', DH: 'ਧ', PH: 'ਫ',
    BH: 'ਭ', SH: 'ਸ', NG: 'ਙ', AA: 'ਆ', EE: 'ਈ', OO: 'ਊ',
    AI: 'ਐ', AU: 'ਔ',
  },
  // Myanmar
  16: {
    CH: 'ချ', KH: 'ခ', TH: 'သ', NG: 'င', SH: 'ရှ',
    AA: 'အာ', EE: 'အီ', OO: 'အူ', AI: 'အဲ', AU: 'အော',
  },
  // Khmer
  17: {
    CH: 'ឆ', KH: 'ខ', TH: 'ថ', NG: 'ង', SH: 'ស',
    AA: 'អា', EE: 'អី', OO: 'អូ', AI: 'អៃ', AU: 'អៅ',
  },
  // Lao
  18: {
    CH: 'ຈ', KH: 'ຂ', TH: 'ທ', NG: 'ງ', SH: 'ສ',
    AA: 'ອາ', EE: 'ອີ', OO: 'ອູ', AI: 'ໄອ', AU: 'ເອົາ',
  },
  // Georgian
  19: {
    CH: 'ჩ', SH: 'შ', ZH: 'ჟ', KH: 'ხ', GH: 'ღ',
    TS: 'ც', DZ: 'ძ', DJ: 'ჯ',
  },
  // Armenian
  20: {
    CH: 'Չ', SH: 'Շ', ZH: 'Ժ', KH: 'Խ', TS: 'Ծ',
    DZ: 'Ձ', GH: 'Ղ',
  },
  // Amharic
  21: {
    CH: 'ች', SH: 'ሽ', TH: 'ጥ', GH: 'ግ',
    AA: 'ኣ', EE: 'ኢ', OO: 'ኦ',
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