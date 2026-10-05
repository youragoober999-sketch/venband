// Spell checking for the message box: an English Hunspell dictionary that is
// loaded on first use and runs on this device (your text is never sent anywhere).
import type NSpell from 'nspell';

let checker: Promise<NSpell | null> | null = null;
const personalKey = 'venband:dictionary';

function personal(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(personalKey) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function loadSpell(): Promise<NSpell | null> {
  checker ??= (async () => {
    try {
      const base = import.meta.env.BASE_URL || '/';
      const [{ default: nspell }, aff, dic] = await Promise.all([
        import('nspell'),
        fetch(`${base}dict/en.aff`).then((r) => r.text()),
        fetch(`${base}dict/en.dic`).then((r) => r.text()),
      ]);
      const sp = nspell(aff, dic);
      for (const w of personal()) sp.add(w);
      for (const w of CHAT_WORDS) sp.add(w);
      return sp;
    } catch {
      return null;
    }
  })();
  return checker;
}

/** Words people type in chat that aren't in a dictionary but aren't mistakes. */
const CHAT_WORDS = [
  'lol', 'lmao', 'lmfao', 'rofl', 'omg', 'btw', 'idk', 'imo', 'imho', 'tbh', 'brb', 'gg', 'ggs', 'wp', 'afk', 'irl', 'np', 'ty', 'thx',
  'pls', 'plz', 'ok', 'okay', 'yeah', 'yea', 'yep', 'nah', 'nope', 'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'dunno', 'bruh', 'bro',
  'sus', 'rn', 'ngl', 'fr', 'smh', 'fyi', 'asap', 'dm', 'dms', 'vc', 'emoji', 'emojis', 'gif', 'gifs', 'meme', 'memes', 'venband',
  'discord', 'youtube', 'tiktok', 'spotify', 'twitch', 'online', 'offline', 'username', 'login', 'logout', 'wifi', 'app', 'apps',
  'hmm', 'hm', 'uh', 'um', 'oh', 'ah', 'aw', 'aww', 'haha', 'hahaha', 'hehe', 'xd', 'ez', 'pog', 'poggers', 'noob', 'op', 'nerf', 'buff',
];

/** Common typos fixed automatically in "auto" mode. */
export const AUTOCORRECT: Record<string, string> = {
  teh: 'the', hte: 'the', adn: 'and', nad: 'and', taht: 'that', thsi: 'this', tihs: 'this', waht: 'what', wat: 'what', jsut: 'just',
  becuase: 'because', becasue: 'because', beacuse: 'because', recieve: 'receive', recieved: 'received', beleive: 'believe',
  definately: 'definitely', definatly: 'definitely', seperate: 'separate', occured: 'occurred', untill: 'until', wich: 'which',
  thier: 'their', freind: 'friend', freinds: 'friends', alot: 'a lot', dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't",
  wont: "won't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't", couldnt: "couldn't", shouldnt: "shouldn't",
  wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't", im: "I'm", ive: "I've", youre: "you're", theyre: "they're", thats: "that's",
  whats: "what's", lets: "let's", i: 'I', tommorow: 'tomorrow', tomorow: 'tomorrow', tonite: 'tonight', wierd: 'weird', truely: 'truly',
  goverment: 'government', enviroment: 'environment', neccessary: 'necessary', accomodate: 'accommodate', occassion: 'occasion',
  realy: 'really', reallly: 'really', probaly: 'probably', prolly: 'probably', somthing: 'something', becomming: 'becoming',
  comming: 'coming', begining: 'beginning', finaly: 'finally', basicly: 'basically', acually: 'actually', actualy: 'actually',
  everytime: 'every time', noone: 'no one', thanx: 'thanks', knwo: 'know', konw: 'know', yuo: 'you', ot: 'to', fo: 'of', si: 'is',
};

/** Words worth checking (not links, mentions, code, numbers, emoji names, ALLCAPS). */
export function checkable(word: string) {
  return /^[A-Za-z][a-z']{1,30}$/.test(word) && !/^[A-Z]{2,}$/.test(word);
}

export async function misspelled(word: string): Promise<boolean> {
  const sp = await loadSpell();
  if (!sp || !checkable(word)) return false;
  return !sp.correct(word) && !sp.correct(word.toLowerCase());
}

export async function suggestions(word: string): Promise<string[]> {
  const fixed = AUTOCORRECT[word.toLowerCase()];
  const sp = await loadSpell();
  const out = sp ? sp.suggest(word).slice(0, 5) : [];
  return fixed && !out.includes(fixed) ? [fixed, ...out].slice(0, 5) : out;
}

export function addToDictionary(word: string) {
  const p = personal();
  p.add(word);
  try {
    localStorage.setItem(personalKey, JSON.stringify([...p].slice(-2000)));
  } catch {
    /* ignore */
  }
  checker?.then((sp) => sp?.add(word));
}

/** "auto" mode: fix the word just typed, keeping its capitalisation. */
export async function autoFix(word: string): Promise<string | null> {
  const lower = word.toLowerCase();
  const fixed = AUTOCORRECT[lower];
  if (fixed) return word[0] === word[0].toUpperCase() && fixed[0] !== 'I' ? fixed[0].toUpperCase() + fixed.slice(1) : fixed;
  if (!checkable(word) || word.length < 4) return null;
  const sp = await loadSpell();
  if (!sp || sp.correct(word) || sp.correct(lower)) return null;
  const s = sp.suggest(lower);
  // only when there's one clear answer that differs by one letter
  if (s.length === 1 && Math.abs(s[0].length - word.length) <= 1) return word[0] === word[0].toUpperCase() ? s[0][0].toUpperCase() + s[0].slice(1) : s[0];
  return null;
}

/** Misspelled words in `text` with their positions (for underlines). */
export async function findMistakes(text: string): Promise<{ start: number; end: number; word: string }[]> {
  const sp = await loadSpell();
  if (!sp) return [];
  const out: { start: number; end: number; word: string }[] = [];
  // skip code, links and <@mentions>
  const masked = text.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|<[@#:][^>]*>|:[a-z0-9_+-]+:/gi, (m) => ' '.repeat(m.length));
  for (const m of masked.matchAll(/[A-Za-z][A-Za-z']*/g)) {
    const w = m[0].replace(/'+$/, '');
    if (checkable(w) && !sp.correct(w) && !sp.correct(w.toLowerCase())) out.push({ start: m.index!, end: m.index! + w.length, word: w });
    if (out.length > 50) break;
  }
  return out;
}
