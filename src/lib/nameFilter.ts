// Names Venband doesn't allow (usernames, display names, server nicknames,
// group and server names). The database runs the same check
// (public.name_is_blocked), so this file only gives the instant error.
//
// To keep the list readable without spelling the words out in full, each
// entry is a pattern over a "skeleton" of the name: lowercased, accents and
// look-alike letters folded, digits/symbols read as letters (n1gg3r), and
// everything that isn't a letter removed (n.i g-g a).

export const NAME_NOT_ALLOWED = 'that username is not allowed, try again';

const LOOKALIKES: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '6': 'g',
  // Cyrillic / Greek letters that look like Latin ones
  а: 'a', е: 'e', і: 'i', ї: 'i', о: 'o', с: 'c', р: 'p', к: 'k', у: 'y', х: 'x', ѕ: 's', ԁ: 'd', ɡ: 'g', ɢ: 'g', ո: 'n', ս: 'u',
  α: 'a', ε: 'e', ι: 'i', ο: 'o', κ: 'k', ν: 'v', υ: 'u', τ: 't',
};

/** Lowercase letters only, with disguises undone. */
export function nameSkeleton(name: string): string {
  const folded = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let out = '';
  for (const ch of folded) out += LOOKALIKES[ch] ?? ch;
  return out.replace(/[^a-z]/g, '');
}

// words that merely contain a blocked spelling
const ALLOWED = ['scunthorpe', 'cuckoo'];

const BLOCKED: RegExp[] = [
  /n+[iy]+g{2,}(a+|e+r+|u+h+)/, // the n-word, any spelling (niggah, niggaz, n1gg3r...)
  /f+a+g+o+t+/, // the f-slur
  /c+u+n+t+/,
  /c+u+c+k+/,
];

export function nameIsBlocked(name: string): boolean {
  let s = nameSkeleton(name);
  for (const ok of ALLOWED) s = s.split(ok).join('');
  return BLOCKED.some((re) => re.test(s));
}
