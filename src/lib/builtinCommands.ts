// Venband's built-in slash commands. They run on your device and post an
// ordinary (end-to-end encrypted) message from you, marked "used /avatar" —
// bots can't read encrypted chats, so these can't live on a server.
import type { DecryptedMessage } from './keyring';
import type { Profile } from './types';
import { getProfile, loadProfiles } from './directory';
import { downloadDecrypted, fileKind } from './files';
import { toGif } from './myGifs';
import { captionImage, imageOf } from './caption';

export const BUILTIN_APP = { app_id: 'venband', app_name: 'Venband' };
/** A command option: 'user' opens the member picker, 'text' is free text. */
export interface CommandOption {
  name: string;
  type: 'user' | 'text';
  description: string;
}
export const BUILTIN_COMMANDS: { name: string; description: string; usage?: string; options?: CommandOption[] }[] = [
  { name: 'avatar', description: 'Post someone’s profile picture', usage: '/avatar @someone', options: [{ name: 'user', type: 'user', description: 'Whose avatar to post — leave empty for yours' }] },
  { name: 'banner', description: 'Post someone’s profile banner', usage: '/banner @someone', options: [{ name: 'user', type: 'user', description: 'Whose banner to post — leave empty for yours' }] },
  { name: 'caption', description: 'Reply to a picture or GIF to put a caption on top', usage: 'reply to a picture, then /caption your text', options: [{ name: 'text', type: 'text', description: 'What the caption says' }] },
  { name: 'gif', description: 'Reply to a picture to turn it into a GIF', usage: 'reply to a picture, then /gif' },
  { name: 'roll', description: 'Roll dice (2d6, d20…)', usage: '/roll 2d6', options: [{ name: 'dice', type: 'text', description: 'Like 2d6 or d20' }] },
  { name: 'coin', description: 'Flip a coin' },
  { name: '8ball', description: 'Ask the magic ball', usage: '/8ball will it rain?', options: [{ name: 'question', type: 'text', description: 'Your yes-or-no question' }] },
  { name: 'choose', description: 'Pick one for you', usage: '/choose pizza, tacos, sushi', options: [{ name: 'choices', type: 'text', description: 'Separate them with commas' }] },
  { name: 'shrug', description: 'Add ¯\\_(ツ)_/¯' },
  { name: 'tableflip', description: 'Add (╯°□°)╯︵ ┻━┻' },
  { name: 'unflip', description: 'Add ┬─┬ノ( º _ ºノ)' },
  { name: 'me', description: 'Say something as an action', usage: '/me waves', options: [{ name: 'action', type: 'text', description: 'What you do' }] },
  { name: 'spoiler', description: 'Hide text behind a spoiler', usage: '/spoiler the ending', options: [{ name: 'text', type: 'text', description: 'What to hide' }] },
];
export const isBuiltin = (name: string) => BUILTIN_COMMANDS.some((c) => c.name === name);

export interface BuiltinResult {
  text: string;
  files: File[];
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const ANSWERS = ['It is certain.', 'Without a doubt.', 'You may rely on it.', 'Yes — definitely.', 'Most likely.', 'Signs point to yes.', 'Ask again later.', 'Better not tell you now.', 'Cannot predict now.', 'Don’t count on it.', 'My reply is no.', 'Very doubtful.'];

/** The person a command is about: a mention in the arguments, else you. */
async function target(args: string, me: Profile): Promise<Profile> {
  const id = /<@!?([0-9a-f-]{36})>/i.exec(args)?.[1];
  if (!id) return me;
  await loadProfiles([id]);
  const p = getProfile(id);
  if (!p) throw new Error('Couldn’t find that person.');
  return p;
}

async function fetchFile(url: string, name: string): Promise<File> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Couldn’t load that picture.');
  const b = await r.blob();
  return new File([b], name, { type: b.type || 'image/png' });
}

/** A picture drawn on the spot for people without an avatar / banner. */
async function drawn(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void, name: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d')!);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t draw it.'))), 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '').join('') || '?';

export async function runBuiltin(name: string, args: string, ctx: { me: Profile; replyTo: DecryptedMessage | null }): Promise<BuiltinResult> {
  const a = args.trim();
  switch (name) {
    case 'avatar': {
      const p = await target(a, ctx.me);
      const label = p.display_name || p.username;
      const file = p.avatar_url
        ? await fetchFile(p.avatar_url, `${p.username}-avatar.${/\.gif(\?|$)/i.test(p.avatar_url) ? 'gif' : 'webp'}`)
        : await drawn(512, 512, (c) => {
            c.fillStyle = p.avatar_color || '#5865f2';
            c.fillRect(0, 0, 512, 512);
            c.fillStyle = '#fff';
            c.font = '700 200px Inter, system-ui, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(initialsOf(label), 256, 270);
          }, `${p.username}-avatar.png`);
      return { text: `${label}’s avatar`, files: [file] };
    }
    case 'banner': {
      const p = await target(a, ctx.me);
      const label = p.display_name || p.username;
      const file = p.banner_url
        ? await fetchFile(p.banner_url, `${p.username}-banner.webp`)
        : await drawn(1200, 420, (c) => {
            const g = c.createLinearGradient(0, 0, 1200, 420);
            g.addColorStop(0, p.banner_color || p.avatar_color || '#5865f2');
            g.addColorStop(1, p.banner_color2 || p.banner_color || p.avatar_color || '#5865f2');
            c.fillStyle = g;
            c.fillRect(0, 0, 1200, 420);
          }, `${p.username}-banner.png`);
      return { text: `${label}’s banner`, files: [file] };
    }
    case 'gif': {
      const att = ctx.replyTo?.payload?.attachments?.find((x) => fileKind(x) === 'image');
      if (!att) throw new Error('Reply to a message with a picture, then use /gif.');
      const gif = await toGif(await downloadDecrypted(att), att.name.replace(/\.[^.]+$/, '') || 'venband');
      return { text: a, files: [gif] };
    }
    case 'caption': {
      const img = await imageOf(ctx.replyTo);
      if (!img) throw new Error('Reply to a picture or GIF (or right-click it → Caption), then type /caption and your text.');
      return { text: '', files: [await captionImage(img.blob, a, img.name)] };
    }
    case 'roll': {
      const m = /^(\d{0,2})d(\d{1,4})$/i.exec(a || 'd6');
      if (!m) throw new Error('Use dice like 2d6 or d20.');
      const count = Math.min(20, Math.max(1, Number(m[1] || 1)));
      const sides = Math.min(1000, Math.max(2, Number(m[2])));
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((s, x) => s + x, 0);
      return { text: `🎲 rolled **${count}d${sides}**: ${count > 1 ? `${rolls.join(' + ')} = ` : ''}**${total}**`, files: [] };
    }
    case 'coin':
      return { text: `🪙 **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**`, files: [] };
    case '8ball':
      if (!a) throw new Error('Ask a question: /8ball will it rain?');
      return { text: `🎱 ${a}\n> ${pick(ANSWERS)}`, files: [] };
    case 'choose': {
      const options = a.split(/\s*[,|]\s*|\s+or\s+/i).filter(Boolean);
      if (options.length < 2) throw new Error('Give at least two choices: /choose pizza, tacos');
      return { text: `🤔 I choose **${pick(options)}**`, files: [] };
    }
    case 'shrug':
      return { text: `${a} ¯\\\\_(ツ)\\_/¯`.trim(), files: [] };
    case 'tableflip':
      return { text: `${a} (╯°□°)╯︵ ┻━┻`.trim(), files: [] };
    case 'unflip':
      return { text: `${a} ┬─┬ノ( º _ ºノ)`.trim(), files: [] };
    case 'me':
      if (!a) throw new Error('Say what you do: /me waves');
      return { text: `_${a}_`, files: [] };
    case 'spoiler':
      if (!a) throw new Error('Add what to hide: /spoiler the ending');
      return { text: `||${a}||`, files: [] };
    default:
      throw new Error(`Unknown command /${name}`);
  }
}
