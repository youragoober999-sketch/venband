// Channel key management: creating epochs, distributing wrapped keys to
// members, rotating after membership changes, encrypting/decrypting messages.
import { supabase } from './supabase';
import {
  channelKeyCheck,
  decryptMessage,
  encryptMessage,
  newChannelKey,
  safeEqual,
  sign,
  unwrapKey,
  verify,
  wrapContext,
  wrapKey,
  wrapSignaturePayload,
  type Identity,
  type MessagePayload,
} from './crypto';
import { cachedKey, getKeyById, loadKeysById, observeKey } from './directory';
import type { MessageRow } from './types';

type Listener = (channelId: string) => void;

interface EpochRow {
  channel_id: string;
  epoch: number;
  key_check: string;
}

interface KeyRow {
  channel_id: string;
  epoch: number;
  recipient_id: string;
  recipient_key_id: string;
  wrapper_id: string;
  wrapper_key_id: string;
  ephemeral_public: string;
  iv: string;
  wrapped_key: string;
  signature: string;
}

export interface DecryptedMessage {
  row: MessageRow;
  payload: MessagePayload | null;
  error: 'missing-key' | 'invalid' | null;
}

export class Keyring {
  private keys = new Map<string, Map<number, Uint8Array<ArrayBuffer>>>();
  private epochs = new Map<string, Map<number, string>>(); // key checks
  private loading = new Map<string, Promise<void>>();
  private ensuring = new Map<string, Promise<void>>();
  private listeners = new Set<Listener>();

  constructor(readonly identity: Identity) {}

  onKeys(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(channelId: string) {
    this.listeners.forEach((l) => l(channelId));
  }

  hasKey(channelId: string, epoch: number) {
    return this.keys.get(channelId)?.has(epoch) ?? false;
  }

  latestEpoch(channelId: string): number {
    const e = this.epochs.get(channelId);
    return e && e.size ? Math.max(...e.keys()) : 0;
  }

  private async loadEpochs(channelId: string) {
    const { data, error } = await supabase
      .from('channel_epochs')
      .select('channel_id, epoch, key_check')
      .eq('channel_id', channelId);
    if (error) throw error;
    const m = new Map<number, string>();
    for (const r of (data ?? []) as EpochRow[]) m.set(r.epoch, r.key_check);
    this.epochs.set(channelId, m);
  }

  /** Fetch and verify every wrapped key addressed to our current identity. */
  loadChannel(channelId: string): Promise<void> {
    const running = this.loading.get(channelId);
    if (running) return running;
    const p = (async () => {
      await this.loadEpochs(channelId);
      const { data, error } = await supabase
        .from('channel_keys')
        .select('*')
        .eq('channel_id', channelId)
        .eq('recipient_key_id', this.identity.keyId);
      if (error) throw error;
      const rows = (data ?? []) as KeyRow[];
      await loadKeysById(rows.map((r) => r.wrapper_key_id));
      const map = this.keys.get(channelId) ?? new Map<number, Uint8Array<ArrayBuffer>>();
      let added = false;
      for (const r of rows) {
        if (map.has(r.epoch)) continue;
        const raw = await this.openWrap(r);
        if (raw) {
          map.set(r.epoch, raw);
          added = true;
        }
      }
      this.keys.set(channelId, map);
      if (added) this.emit(channelId);
    })().finally(() => this.loading.delete(channelId));
    this.loading.set(channelId, p);
    return p;
  }

  private async openWrap(r: KeyRow): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      const wrapper = cachedKey(r.wrapper_key_id) ?? (await getKeyById(r.wrapper_key_id));
      if (!wrapper || wrapper.user_id !== r.wrapper_id) return null;
      const w = { ephemeralPublic: r.ephemeral_public, iv: r.iv, wrapped: r.wrapped_key };
      const sigOk = await verify(
        wrapper.sign_public,
        r.signature,
        wrapSignaturePayload(r.channel_id, r.epoch, r.recipient_id, r.recipient_key_id, r.wrapper_id, r.wrapper_key_id, w),
      );
      if (!sigOk) return null;
      const raw = await unwrapKey(this.identity, w, wrapContext(r.channel_id, r.epoch, r.recipient_id, r.recipient_key_id));
      const expected = this.epochs.get(r.channel_id)?.get(r.epoch);
      if (!expected || !safeEqual(expected, await channelKeyCheck(raw, r.channel_id, r.epoch))) return null;
      return raw;
    } catch {
      return null;
    }
  }

  /**
   * Make sure the channel is usable: keys loaded, an epoch exists, a pending
   * rotation is performed and members lacking keys receive them.
   */
  ensure(channelId: string, rotationNeeded = false): Promise<void> {
    const running = this.ensuring.get(channelId);
    if (running) return running;
    const p = (async () => {
      await this.loadChannel(channelId);
      if (this.latestEpoch(channelId) === 0 || rotationNeeded) {
        await this.createEpoch(channelId);
      }
      await this.distribute(channelId);
    })().finally(() => this.ensuring.delete(channelId));
    this.ensuring.set(channelId, p);
    return p;
  }

  /** Start a new key epoch (first key, or rotation after someone lost access). */
  async createEpoch(channelId: string): Promise<void> {
    const epoch = this.latestEpoch(channelId) + 1;
    const raw = newChannelKey();
    const keyCheck = await channelKeyCheck(raw, channelId, epoch);
    const { error } = await supabase
      .from('channel_epochs')
      .insert({ channel_id: channelId, epoch, key_check: keyCheck, created_by: this.identity.userId });
    if (error) {
      // someone else created this epoch concurrently -> use theirs
      await this.loadChannel(channelId);
      return;
    }
    this.epochs.get(channelId)?.set(epoch, keyCheck) ?? this.epochs.set(channelId, new Map([[epoch, keyCheck]]));
    const map = this.keys.get(channelId) ?? new Map();
    map.set(epoch, raw);
    this.keys.set(channelId, map);
    this.emit(channelId);
  }

  /** Wrap every epoch key we hold for members that don't have it yet. */
  async distribute(channelId: string): Promise<void> {
    const held = this.keys.get(channelId);
    if (!held || !held.size) return;
    const { data, error } = await supabase.rpc('channel_missing_keys', { p_channel: channelId });
    if (error) return;
    const rows = (data ?? []) as { epoch: number; user_id: string; key_id: string; enc_public: string; sign_public: string }[];
    const inserts = [];
    for (const r of rows) {
      const raw = held.get(r.epoch);
      if (!raw) continue;
      observeKey(r.user_id, r.key_id);
      const w = await wrapKey(raw, r.enc_public, wrapContext(channelId, r.epoch, r.user_id, r.key_id));
      const signature = await sign(
        this.identity,
        wrapSignaturePayload(channelId, r.epoch, r.user_id, r.key_id, this.identity.userId, this.identity.keyId, w),
      );
      inserts.push({
        channel_id: channelId,
        epoch: r.epoch,
        recipient_id: r.user_id,
        recipient_key_id: r.key_id,
        wrapper_id: this.identity.userId,
        wrapper_key_id: this.identity.keyId,
        ephemeral_public: w.ephemeralPublic,
        iv: w.iv,
        wrapped_key: w.wrapped,
        signature,
      });
    }
    for (let i = 0; i < inserts.length; i += 50) {
      await supabase.from('channel_keys').upsert(inserts.slice(i, i + 50), { ignoreDuplicates: true });
    }
  }

  /** Rotate first if the server says someone lost access since the last epoch. */
  async prepareSend(channelId: string) {
    await this.ensure(channelId);
    const { data } = await supabase.from('channels').select('key_rotation_needed').eq('id', channelId).single();
    if (data?.key_rotation_needed) {
      await this.loadChannel(channelId);
      await this.createEpoch(channelId);
      await this.distribute(channelId);
      return;
    }
    // Nobody who holds the current key is online to share it with us (e.g.
    // we just joined). Don't wait: start a new key, share it with every
    // member, and talk. Older messages unlock once a member shares them.
    if (!this.hasKey(channelId, this.latestEpoch(channelId))) {
      await this.loadChannel(channelId);
      if (!this.hasKey(channelId, this.latestEpoch(channelId))) {
        await this.createEpoch(channelId);
        await this.distribute(channelId);
      }
    }
  }

  async encrypt(channelId: string, messageId: string, payload: MessagePayload) {
    const epoch = this.latestEpoch(channelId);
    const raw = this.keys.get(channelId)?.get(epoch);
    if (!raw) throw new Error('Waiting for an online member to share this channel’s encryption key with you.');
    const env = await encryptMessage(this.identity, raw, messageId, channelId, epoch, payload);
    return { epoch, ...env, author_key_id: this.identity.keyId };
  }

  async decrypt(row: MessageRow): Promise<DecryptedMessage> {
    const raw = this.keys.get(row.channel_id)?.get(row.epoch);
    if (!raw) return { row, payload: null, error: 'missing-key' };
    try {
      const key = cachedKey(row.author_key_id) ?? (await getKeyById(row.author_key_id));
      if (!key || key.user_id !== row.author_id) return { row, payload: null, error: 'invalid' };
      if (!key.revoked_at) observeKey(row.author_id, key.key_id);
      const payload = await decryptMessage(
        raw,
        key.sign_public,
        row.id,
        row.channel_id,
        row.author_id,
        row.author_key_id,
        row.epoch,
        { iv: row.iv, ciphertext: row.ciphertext, signature: row.signature },
      );
      return { row, payload, error: null };
    } catch {
      return { row, payload: null, error: 'invalid' };
    }
  }
}
