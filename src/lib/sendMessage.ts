// Encrypt and store one message. If the database refuses it (its row-level
// security re-checks everything: your account, your device key, the channel's
// current key epoch, permissions, blocks), refresh the channel's keys and try
// once more — most refusals are a key that changed a moment ago. If it still
// fails, say why in plain words instead of "violates row-level security".
import { supabase } from './supabase';
import { sessionStore } from './session';
import type { MessagePayload } from './crypto';

const isRefused = (e: { code?: string; message?: string }) => e.code === '42501' || /row-level security/i.test(e.message ?? '');

export async function insertEncrypted(channelId: string, id: string, payload: MessagePayload, extra: Record<string, unknown> = {}) {
  const { keyring, identity } = sessionStore.get();
  if (!keyring || !identity) throw new Error('Not signed in');
  for (let attempt = 0; ; attempt++) {
    const env = await keyring.encrypt(channelId, id, payload);
    const row = {
      id,
      channel_id: channelId,
      author_id: identity.userId,
      author_key_id: env.author_key_id,
      epoch: env.epoch,
      iv: env.iv,
      ciphertext: env.ciphertext,
      signature: env.signature,
      ...extra,
    };
    const { error } = await supabase.from('messages').insert(row);
    if (!error) return row;
    if (!isRefused(error)) throw error;
    if (attempt === 0) {
      await keyring.loadChannel(channelId); // newest epoch + any keys shared since
      await keyring.prepareSend(channelId); // rotate / start a key if needed
      continue;
    }
    throw new Error(await whyRefused(channelId, env.epoch));
  }
}

/** Work out which of the database's send rules this message broke. */
export async function whyRefused(channelId: string, epoch: number): Promise<string> {
  const { identity } = sessionStore.get();
  if (!identity) return 'You’re signed out. Sign in again to send messages.';
  const [profile, key, channel, latest] = await Promise.all([
    supabase.from('profiles').select('account_status').eq('id', identity.userId).maybeSingle(),
    supabase.from('user_keys').select('revoked_at').eq('key_id', identity.keyId).maybeSingle(),
    supabase.from('channels').select('key_rotation_needed, server_id, is_group').eq('id', channelId).maybeSingle(),
    supabase.from('channel_epochs').select('epoch').eq('channel_id', channelId).order('epoch', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const status = (profile.data as { account_status?: string } | null)?.account_status;
  if (status === 'very_limited' || status === 'banned')
    return 'Venband staff have restricted your account, so you can’t send messages right now. Settings → Security → Official notices has the details.';
  if (!key.data || (key.data as { revoked_at: string | null }).revoked_at)
    return 'This device’s encryption key was signed out (for example from Settings → Devices on another device). Sign out and back in here to get a new one.';
  const ch = channel.data as { key_rotation_needed: boolean; server_id: string | null; is_group: boolean } | null;
  if (!ch) return 'This conversation no longer exists, or you’re no longer in it.';
  if (ch.key_rotation_needed || ((latest.data as { epoch: number } | null)?.epoch ?? epoch) !== epoch)
    return 'This conversation’s encryption key changed while you were sending. Send it again.';
  if (!ch.server_id && !ch.is_group)
    return status === 'limited'
      ? 'Your account is limited, so you can only message friends right now.'
      : 'You can’t message this person right now — one of you has blocked the other, or they only accept messages from friends.';
  return 'You don’t have permission to send messages here (your roles are missing “Send Messages”, or the channel is read-only).';
}
