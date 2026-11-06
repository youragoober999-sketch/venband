// What the signed-in Venband staff member may do (staff_can() in the database
// is what actually enforces it; this only decides which buttons to show).
import { useEffect } from 'react';
import { createStore } from './store';
import { supabase, isOldSchema } from './supabase';
import { isTopStaff, sessionStore } from './session';
import type { Profile } from './types';

export type StaffPerm = 'accounts' | 'ban' | 'badges' | 'servers' | 'marketplace' | 'apps' | 'audit' | 'reports' | 'appeals';

export const STAFF_PERMS: { id: StaffPerm; label: string; description: string }[] = [
  { id: 'accounts', label: 'Restrict accounts', description: 'Make accounts limited / very limited, and restore them.' },
  { id: 'ban', label: 'Ban accounts', description: 'Ban and unban accounts (signs them out everywhere).' },
  { id: 'badges', label: 'Award badges', description: 'Give and take badges (staff badges stay admin-only).' },
  { id: 'servers', label: 'Moderate servers', description: 'Review, verify, close and ban servers.' },
  { id: 'marketplace', label: 'Moderate the Marketplace', description: 'Remove and restore themes, CSS, nameplates and name styles.' },
  { id: 'apps', label: 'Moderate bots', description: 'Disable and re-enable bots and apps.' },
  { id: 'audit', label: 'Read the audit log', description: 'See every staff action.' },
  { id: 'reports', label: 'Report Centre', description: 'Handle reports about messages, people, themes and bots.' },
  { id: 'appeals', label: 'Decide appeals', description: 'Accept (undo) or deny appeals.' },
];

const MOD_DEFAULTS: StaffPerm[] = ['accounts', 'ban', 'badges', 'servers', 'marketplace', 'apps', 'audit'];

/** The role's defaults — also what an older database without granular permissions allows. */
export function defaultPerms(p: Pick<Profile, 'platform_role' | 'badges'> | null | undefined): StaffPerm[] {
  if (!p) return [];
  if (isTopStaff(p) || p.platform_role === 'admin') return STAFF_PERMS.map((x) => x.id);
  return p.platform_role === 'moderator' ? MOD_DEFAULTS : [];
}

const permStore = createStore<{ perms: StaffPerm[] | null; for: string | null }>({ perms: null, for: null });

/** My effective staff permissions (role defaults until the database answers). */
export function useStaffPerms(): StaffPerm[] {
  const me = sessionStore.use((s) => s.me);
  const st = permStore.use((s) => s);
  const key = me ? `${me.id}:${me.platform_role}` : null;
  useEffect(() => {
    if (!me || st.for === key || (me.platform_role ?? 'user') === 'user' && !isTopStaff(me)) return;
    permStore.set({ perms: null, for: key });
    supabase.rpc('my_staff_permissions').then(({ data, error }) => {
      if (error) return permStore.set({ perms: isOldSchema(error) ? defaultPerms(me) : [], for: key });
      permStore.set({ perms: (data ?? []) as StaffPerm[], for: key });
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return [];
  return st.for === key && st.perms ? st.perms : defaultPerms(me);
}
export const refreshStaffPerms = () => permStore.set({ perms: null, for: null });

/** Report a marketplace item, a bot or a memory (goes to the Report Centre). */
export async function reportItem(kind: 'theme' | 'app' | 'memory', id: string, reason: string) {
  const { error } = await supabase.rpc('report_item', { p_kind: kind, p_ref: id, p_reason: reason });
  if (error) throw error;
}
