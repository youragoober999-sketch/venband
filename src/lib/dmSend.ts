// Send a plain (end-to-end encrypted) message to someone's DM — used for
// invites from menus without opening the conversation.
import { supabase } from './supabase';
import { sessionStore } from './session';
import type { MessagePayload } from './crypto';

export async function sendToUser(userId: string, text: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_dm', { p_other: userId });
  if (error) throw error;
  const channelId = data as string;
  await sendToChannel(channelId, text);
  return channelId;
}

export async function sendToChannel(channelId: string, text: string) {
  const { keyring, identity } = sessionStore.get();
  if (!keyring || !identity) throw new Error('Not signed in');
  await keyring.prepareSend(channelId);
  const id = crypto.randomUUID();
  const payload: MessagePayload = { v: 1, text, sentAt: Date.now() };
  const env = await keyring.encrypt(channelId, id, payload);
  const { error } = await supabase.from('messages').insert({
    id,
    channel_id: channelId,
    author_id: identity.userId,
    author_key_id: env.author_key_id,
    epoch: env.epoch,
    iv: env.iv,
    ciphertext: env.ciphertext,
    signature: env.signature,
  });
  if (error) throw error;
}

/** venband.com/invite/CODE (or a custom link), from any of the forms people paste. */
export function inviteCodeFrom(text: string): string | null {
  const m =
    text.match(/venband\.gg\/([A-Za-z0-9-]{3,32})(?=$|[\s/?#])/) ??
    text.match(/(?:venband\.com|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)\/invite\/([A-Za-z0-9-]{3,32})(?=$|[\s/?#])/) ??
    text.match(/[?&]invite=([A-Za-z0-9]{8,32})/);
  if (!m) return null;
  const code = m[1];
  // venband.com/<page> words aren't invites
  if (/^(channels|sign-in|register|status|tos|applications|voogle|discovery|discover|privacy|changelog|login|signup|support|developers|api|assets)$/i.test(code)) return null;
  return code;
}

export function inviteUrl(code: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}invite/${code}`;
}
