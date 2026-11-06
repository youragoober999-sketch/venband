import { getSettings } from './settings';
import { detectLanguage, isPhraseLang, loadPhrasebook, phrasebookTranslateDetailed } from './phrasebook';
import { smartTranslate } from './smart-translate';


export const LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'fil', name: 'Filipino', native: 'Filipino' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'is', name: 'Icelandic', native: 'Íslenska' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski' },
  { code: 'sr', name: 'Serbian', native: 'Српски' },
  { code: 'mk', name: 'Macedonian', native: 'Македонски' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'sq', name: 'Albanian', native: 'Shqip' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'be', name: 'Belarusian', native: 'Беларуская' },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'gl', name: 'Galician', native: 'Galego' },
  { code: 'eu', name: 'Basque', native: 'Euskara' },
  { code: 'cy', name: 'Welsh', native: 'Cymraeg' },
  { code: 'ga', name: 'Irish', native: 'Gaeilge' },
  { code: 'gd', name: 'Scottish Gaelic', native: 'Gàidhlig' },
  { code: 'mt', name: 'Maltese', native: 'Malti' },
  { code: 'lb', name: 'Luxembourgish', native: 'Lëtzebuergesch' },
  { code: 'fy', name: 'Frisian', native: 'Frysk' },
  { code: 'co', name: 'Corsican', native: 'Corsu' },
  { code: 'eo', name: 'Esperanto', native: 'Esperanto' },
  { code: 'la', name: 'Latin', native: 'Latina' },
  { code: 'yi', name: 'Yiddish', native: 'ייִדיש' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'ps', name: 'Pashto', native: 'پښتو' },
  { code: 'ku', name: 'Kurdish (Kurmanji)', native: 'Kurdî' },
  { code: 'ckb', name: 'Kurdish (Sorani)', native: 'کوردی' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي' },
  { code: 'ug', name: 'Uyghur', native: 'ئۇيغۇرچە' },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycan' },
  { code: 'ka', name: 'Georgian', native: 'ქართული' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն' },
  { code: 'kk', name: 'Kazakh', native: 'Қазақ' },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbek' },
  { code: 'ky', name: 'Kyrgyz', native: 'Кыргызча' },
  { code: 'tg', name: 'Tajik', native: 'Тоҷикӣ' },
  { code: 'tk', name: 'Turkmen', native: 'Türkmen' },
  { code: 'tt', name: 'Tatar', native: 'Татар' },
  { code: 'mn', name: 'Mongolian', native: 'Монгол' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्' },
  { code: 'bho', name: 'Bhojpuri', native: 'भोजपुरी' },
  { code: 'mai', name: 'Maithili', native: 'मैथिली' },
  { code: 'gom', name: 'Konkani', native: 'कोंकणी' },
  { code: 'dv', name: 'Dhivehi', native: 'ދިވެހި' },
  { code: 'my', name: 'Burmese', native: 'မြန်မာ' },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ' },
  { code: 'lo', name: 'Lao', native: 'ລາວ' },
  { code: 'jv', name: 'Javanese', native: 'Basa Jawa' },
  { code: 'su', name: 'Sundanese', native: 'Basa Sunda' },
  { code: 'ceb', name: 'Cebuano', native: 'Cebuano' },
  { code: 'ilo', name: 'Ilocano', native: 'Ilokano' },
  { code: 'hmn', name: 'Hmong', native: 'Hmoob' },
  { code: 'mi', name: 'Māori', native: 'Te Reo Māori' },
  { code: 'sm', name: 'Samoan', native: 'Gagana Samoa' },
  { code: 'haw', name: 'Hawaiian', native: 'ʻŌlelo Hawaiʻi' },
  { code: 'mg', name: 'Malagasy', native: 'Malagasy' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ' },
  { code: 'ti', name: 'Tigrinya', native: 'ትግርኛ' },
  { code: 'om', name: 'Oromo', native: 'Afaan Oromoo' },
  { code: 'so', name: 'Somali', native: 'Soomaali' },
  { code: 'ha', name: 'Hausa', native: 'Hausa' },
  { code: 'yo', name: 'Yoruba', native: 'Yorùbá' },
  { code: 'ig', name: 'Igbo', native: 'Igbo' },
  { code: 'zu', name: 'Zulu', native: 'isiZulu' },
  { code: 'xh', name: 'Xhosa', native: 'isiXhosa' },
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans' },
  { code: 'st', name: 'Sesotho', native: 'Sesotho' },
  { code: 'sn', name: 'Shona', native: 'chiShona' },
  { code: 'ny', name: 'Chichewa', native: 'Chichewa' },
  { code: 'rw', name: 'Kinyarwanda', native: 'Ikinyarwanda' },
  { code: 'lg', name: 'Luganda', native: 'Luganda' },
  { code: 'ln', name: 'Lingala', native: 'Lingála' },
  { code: 'ak', name: 'Twi', native: 'Twi' },
  { code: 'ee', name: 'Ewe', native: 'Eʋegbe' },
  { code: 'kri', name: 'Krio', native: 'Krio' },
  { code: 'ht', name: 'Haitian Creole', native: 'Kreyòl ayisyen' },
  { code: 'qu', name: 'Quechua', native: 'Runa Simi' },
  { code: 'gn', name: 'Guarani', native: 'Avañeʼẽ' },
  { code: 'ay', name: 'Aymara', native: 'Aymar aru' },
  { code: 'lus', name: 'Mizo', native: 'Mizo ṭawng' },
  { code: 'mni', name: 'Meitei', native: 'ꯃꯤꯇꯩꯂꯣꯟ' },
  { code: 'doi', name: 'Dogri', native: 'डोगरी' },
];

interface TranslatorLike {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorLike>;
}
interface DetectorLike {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
interface DetectorStatic {
  create(): Promise<DetectorLike>;
}

const g = globalThis as unknown as { Translator?: TranslatorStatic; LanguageDetector?: DetectorStatic };

export const translationSupported = () => true;
export const deviceTranslationSupported = () => Boolean(g.Translator);

export function myLanguage(): string {
  return getSettings().language || navigator.language.split('-')[0] || 'en';
}

let detector: Promise<DetectorLike> | null = null;
const translators = new Map<string, Promise<TranslatorLike>>();
const cache = new Map<string, Promise<Translation | null>>();

export interface Translation {
  text: string;
  from: string;
  engine: 'device' | 'smart' | 'phrasebook';
}

async function detect(text: string): Promise<string | null> {
  if (g.LanguageDetector) {
    try {
      detector ??= g.LanguageDetector.create();
      const res = await (await detector).detect(text);
      const top = res[0];
      if (top && top.confidence > 0.5 && top.detectedLanguage !== 'und') return top.detectedLanguage.split('-')[0];
    } catch {
      detector = null;
    }
  }
  await loadPhrasebook();
  return detectLanguage(text);
}

async function deviceTranslate(text: string, from: string, target: string): Promise<string | null> {
  if (!g.Translator) return null;
  const pair = `${from}>${target}`;
  let tr = translators.get(pair);
  if (!tr) {
    const avail = await g.Translator.availability({ sourceLanguage: from, targetLanguage: target });
    if (avail !== 'available' && avail !== 'readily') return null;
    tr = g.Translator.create({ sourceLanguage: from, targetLanguage: target });
    translators.set(pair, tr);
    tr.catch(() => translators.delete(pair));
  }
  return (await tr).translate(text);
}

export function translate(key: string, text: string, opts: { from?: string } = {}): Promise<Translation | null> {
  const target = myLanguage();
  const cacheKey = `${key}|${target}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const job = (async (): Promise<Translation | null> => {
    const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/<[@#][&!]?[0-9a-f-]{36}>/g, ' ').trim();
    if (!plain || !/\p{L}/u.test(plain)) return null;
    // the browser's guess (null when it isn't sure: then the server detects it)
    const guess = opts.from ?? (await detect(plain));
    if (guess && guess === target) return null;

    // 1. on-device (Chrome's built-in translator): private and instant
    if (guess) {
      try {
        const out = await deviceTranslate(text, guess, target);
        if (out) return { text: out, from: guess, engine: 'device' };
      } catch {}
    }

    // 2. Venband's translator (DeepL / Google, 130+ languages, detects the language itself)
    const smart = await smartTranslate(text, { from: guess ?? 'auto', target });
    if (smart) {
      const from = smart.detected ?? guess ?? 'auto';
      if (from.split('-')[0] === target.split('-')[0] || smart.text.trim() === text.trim()) return null; // already in your language
      return { text: smart.text, from, engine: 'smart' };
    }

    // 3. offline phrasebook — only when it actually knows the words; it never
    //    invents a "translation" by spelling words out in another alphabet
    if (guess && isPhraseLang(guess) && isPhraseLang(target)) {
      await loadPhrasebook();
      const res = phrasebookTranslateDetailed(text, guess, target, () => null);
      if (res && res.hits > 0) return { text: res.text, from: guess, engine: 'phrasebook' };
    }
    throw new Error(`Couldn’t reach the translator right now${guess ? ` for ${languageName(guess)}` : ''}. Check your connection and try again.`);
  })();
  cache.set(cacheKey, job);
  job.catch(() => cache.delete(cacheKey));
  return job;
}

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}