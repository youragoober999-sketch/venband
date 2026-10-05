// Message translation that keeps end-to-end encryption intact: decrypted text
// never leaves this device. It uses the browser's on-device Translator when a
// model is ready, and otherwise Venband's built-in 20-language phrasebook, so
// translation always works without downloads or servers.
import { getSettings } from './settings';
import { detectLanguage, isPhraseLang, phrasebookTranslate } from './phrasebook';

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
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
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
  /** 'device' = browser model, 'phrasebook' = built-in word lists */
  engine: 'device' | 'phrasebook';
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
  return detectLanguage(text);
}

async function deviceTranslate(text: string, from: string, target: string): Promise<string | null> {
  if (!g.Translator) return null;
  const pair = `${from}>${target}`;
  let tr = translators.get(pair);
  if (!tr) {
    const avail = await g.Translator.availability({ sourceLanguage: from, targetLanguage: target });
    if (avail !== 'available' && avail !== 'readily') return null; // no model on this device: use the phrasebook
    tr = g.Translator.create({ sourceLanguage: from, targetLanguage: target });
    translators.set(pair, tr);
    tr.catch(() => translators.delete(pair));
  }
  return (await tr).translate(text);
}

/**
 * Translate `text` into the user's language. Returns null when it's already in
 * that language (or can't be detected). `key` caches per message.
 */
export function translate(key: string, text: string, opts: { from?: string } = {}): Promise<Translation | null> {
  const target = myLanguage();
  const cacheKey = `${key}|${target}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const job = (async (): Promise<Translation | null> => {
    const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/<[@#][&!]?[0-9a-f-]{36}>/g, ' ').trim();
    if (!plain) return null;
    const from = opts.from ?? (await detect(plain));
    if (!from || from === target) return null;
    try {
      const out = await deviceTranslate(text, from, target);
      if (out) return { text: out, from, engine: 'device' };
    } catch {
      /* fall back to the phrasebook */
    }
    if (!isPhraseLang(from) || !isPhraseLang(target)) throw new Error(`Translation from ${languageName(from)} to ${languageName(target)} isn’t in the built-in phrasebook yet.`);
    const out = phrasebookTranslate(text, from, target);
    if (!out) throw new Error(`Couldn’t find these words in the ${languageName(from)} phrasebook.`);
    return { text: out, from, engine: 'phrasebook' };
  })();
  cache.set(cacheKey, job);
  job.catch(() => cache.delete(cacheKey));
  return job;
}

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
