// "Remind me" on a message: it's saved (private to you, in Saved) with a time.
// When the time comes, wherever you have Venband open you get a toast, a sound
// and — if the window isn't focused — a system notification that jumps to it.
// The reminder is cleared once shown; the message stays in Saved.
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, loadProfiles } from '../lib/directory';
import { notify } from '../lib/notify';
import { sfx } from '../lib/sfx';
import type { MessageRow } from '../lib/types';
import type { Entry } from './ContextMenu';
import { showAction, showToast } from './Undo';
import { noteSaved } from '../lib/chatExtras';
import { jumpTo } from './Search';

const reminders = new Map<string, string>(); // message id -> remind_at ISO
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export function loadReminders() {
  loaded ??= (async () => {
    const { data } = await supabase.from('saved_messages').select('message_id, remind_at').not('remind_at', 'is', null);
    for (const r of (data ?? []) as { message_id: string; remind_at: string }[]) reminders.set(r.message_id, r.remind_at);
    changed();
  })().catch(() => {
    loaded = null; // older database without remind_at: try again later
  });
  return loaded;
}
export const reminderFor = (id: string) => reminders.get(id) ?? null;
export function onRemindersChanged(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export async function setReminder(m: Pick<MessageRow, 'id' | 'channel_id'>, at: Date | null) {
  const remind_at = at ? at.toISOString() : null;
  const { error } = await supabase.from('saved_messages').upsert({ message_id: m.id, channel_id: m.channel_id, remind_at }, { onConflict: 'user_id,message_id' });
  if (error) throw error;
  noteSaved(m.id);
  if (remind_at) reminders.set(m.id, remind_at);
  else reminders.delete(m.id);
  changed();
}

function at(hours: number) {
  return new Date(Date.now() + hours * 3600_000);
}
function tomorrowAt9() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
function nextMondayAt9() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(9, 0, 0, 0);
  return d;
}
export function whenLabel(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Context-menu entries for a message. */
export function reminderMenu(m: Pick<MessageRow, 'id' | 'channel_id'>, report: (e: unknown) => void): Entry[] {
  const current = reminderFor(m.id);
  const set = (d: Date | null, text: string) => () =>
    setReminder(m, d)
      .then(() => showToast(text))
      .catch(report);
  return [
    { type: 'header', label: current ? `⏰ Reminder set for ${whenLabel(current)}` : 'Remind me' },
    { label: 'In 20 minutes', icon: 'clock', onClick: set(at(1 / 3), 'I’ll remind you in 20 minutes.') },
    { label: 'In 1 hour', icon: 'clock', onClick: set(at(1), 'I’ll remind you in an hour.') },
    { label: 'In 3 hours', icon: 'clock', onClick: set(at(3), 'I’ll remind you in 3 hours.') },
    { label: 'Tomorrow morning', icon: 'clock', hint: '9:00', onClick: set(tomorrowAt9(), 'I’ll remind you tomorrow at 9:00.') },
    { label: 'Next week', icon: 'clock', hint: 'Mon 9:00', onClick: set(nextMondayAt9(), 'I’ll remind you on Monday at 9:00.') },
    current && { label: 'Cancel Reminder', icon: 'x', onClick: set(null, 'Reminder cancelled.') },
  ];
}

async function fireDue() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('saved_messages')
    .select('message_id, channel_id, remind_at')
    .not('remind_at', 'is', null)
    .lte('remind_at', now)
    .limit(10);
  if (error || !data?.length) return;
  for (const r of data as { message_id: string; channel_id: string }[]) {
    // claim it first so two open tabs don't both ring
    const { data: claimed } = await supabase.from('saved_messages').update({ remind_at: null }).eq('message_id', r.message_id).not('remind_at', 'is', null).select('message_id');
    reminders.delete(r.message_id);
    if (!claimed?.length) continue;
    const [{ data: row }, { data: chan }] = await Promise.all([
      supabase.from('messages').select('*').eq('id', r.message_id).maybeSingle(),
      supabase.from('channels').select('id, name, server_id, type').eq('id', r.channel_id).maybeSingle(),
    ]);
    if (!row || !chan) continue;
    let snippet = 'a message';
    try {
      const kr = sessionStore.get().keyring!;
      await kr.loadChannel(chan.id);
      const dm = await kr.decrypt(row as MessageRow);
      await loadProfiles([row.author_id]);
      const text = dm.payload?.text?.replace(/\s+/g, ' ').trim();
      snippet = `${displayName(row.author_id)}: ${text ? (text.length > 80 ? text.slice(0, 80) + '…' : text) : '📎 attachment'}`;
    } catch {
      /* still remind, just without the text */
    }
    const where = chan.type === 'dm' ? 'a DM' : `#${chan.name}`;
    const go = () => jumpTo({ channelId: chan.id, serverId: chan.server_id, messageId: row.id });
    sfx('notification', { force: true });
    showAction(`⏰ Reminder · ${snippet}`, 'Show', go);
    notify(`Reminder · ${where}`, snippet, go, `remind-${row.id}`);
  }
  changed();
}

/** Mounted once in the shell: checks every 30 seconds and on focus. */
export function useReminderRunner() {
  useEffect(() => {
    let stopped = false;
    const run = () => !stopped && sessionStore.get().keyring && fireDue().catch(() => {});
    loadReminders();
    const first = setTimeout(run, 4000);
    const t = setInterval(run, 30_000);
    window.addEventListener('focus', run);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener('focus', run);
    };
  }, []);
}
