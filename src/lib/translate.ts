import { getSettings } from './settings';
import { detectLanguage, isPhraseLang, loadPhrasebook, phrasebookTranslateDetailed } from './phrasebook';
import { letterTranslate } from './letter-translate';
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
  engine: 'device' | 'smart' | 'phrasebook' | 'letter';
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
    if (!plain) return null;
    const from = opts.from ?? (await detect(plain));
    if (!from || from === target) return null;
    try {
      const out = await deviceTranslate(text, from, target);
      if (out) return { text: out, from, engine: 'device' };
    } catch {}

    // If the browser translator is unavailable or fails, try the smart server translator.
    // The endpoint should keep provider API keys on the server instead of exposing them in the client.
    const smartOut = await smartTranslate(text, { from, target });
    if (smartOut) return { text: smartOut, from, engine: 'smart' };

    // Final fallback: the offline phrasebook/transliteration path.
    await loadPhrasebook();

    // Words the phrasebook doesn't know get spelled out in the target script.
    // Targets with no mapped script (es, fr, ...) return null, so the word stays as written.
    const spell = (word: string): string | null => {
      if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return null;
      const spelled = letterTranslate(word.replace(/['-]/g, ''), target);
      if (!spelled) return null;
      const lower = spelled.toLocaleLowerCase();
      return /^[A-Z]/.test(word) ? lower.charAt(0).toLocaleUpperCase() + lower.slice(1) : lower;
    };

    const inBook = isPhraseLang(from) && isPhraseLang(target);
    if (inBook) {
      // known phrases are translated, unknown words are spelled, all kept in order
      const res = phrasebookTranslateDetailed(text, from, target, spell);
      if (res) return { text: res.text, from, engine: res.hits ? 'phrasebook' : 'letter' };
    }

    // pair isn't covered by the phrasebook at all: spell the whole message
    const letterOut = text
      .split(/([^\p{L}\p{M}'-]+)/u)
      .map((tok, i) => (i % 2 ? tok : spell(tok) ?? tok))
      .join('');
    if (letterOut !== text) return { text: letterOut, from, engine: 'letter' };

    if (!inBook) throw new Error(`Translation from ${languageName(from)} to ${languageName(target)} isn’t in the built-in phrasebook yet.`);
    throw new Error(`Couldn’t find these words in the ${languageName(from)} phrasebook.`);
  })();
  cache.set(cacheKey, job);
  job.catch(() => cache.delete(cacheKey));
  return job;
}

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}