// Marketplace items (themes, CSS, nameplates, name styles): publishing,
// versions, drafts and updates for installed themes. Every write goes through
// owner-checked database functions (supabase/migrations/20261106000000_theme_versions.sql).
import { supabase } from './supabase';
import { sanitizeTheme, type Theme } from './themes';
import { getSettings, updateSettings, type ThemeUpdatePolicy } from './settings';
import { sessionStore } from './session';

export type ItemKind = 'theme' | 'nameplate' | 'name_style' | 'css';
export type ItemStatus = 'draft' | 'published' | 'unpublished' | 'removed';

export const THEME_CATEGORIES: { id: string; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'colorful', label: 'Colorful' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'glass', label: 'Glass' },
  { id: 'high-contrast', label: 'High contrast' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'other', label: 'Other' },
];
export const categoryLabel = (id: string | null | undefined) => THEME_CATEGORIES.find((c) => c.id === id)?.label ?? '';

export interface MarketItem {
  id: string;
  author_id: string;
  name: string;
  description: string;
  data: Record<string, unknown>;
  installs: number;
  kind: ItemKind;
  created_at: string;
  status: ItemStatus;
  version: number;
  updated_at: string;
  category: string | null;
  removed_reason: string | null;
}

export interface ItemVersion {
  theme_id: string;
  version: number;
  name: string;
  description: string;
  category: string | null;
  data: Record<string, unknown>;
  changelog: string;
  published_by: string | null;
  created_at: string;
}

export interface ItemDraft {
  theme_id: string;
  name: string;
  description: string;
  category: string | null;
  data: Record<string, unknown>;
  updated_at: string;
}

const me = () => sessionStore.get().session?.user.id ?? null;

/** Only what a theme needs to look right — never ids, authors or install metadata. */
export function themeData(t: Pick<Theme, 'vars' | 'glass' | 'wallpaper'>): Record<string, unknown> {
  return { vars: t.vars, ...(t.glass ? { glass: true } : {}), ...(t.wallpaper ? { wallpaper: t.wallpaper } : {}) };
}

/** A marketplace item (or one of its versions) as an installable Theme. */
export function themeFrom(src: { name: string; description: string; data: Record<string, unknown> }, sourceId: string, version: number, author?: string): Theme | null {
  return sanitizeTheme({ ...(src.data as Partial<Theme>), id: `market-${sourceId}`, name: src.name, description: src.description, author, sourceId, version });
}

// ------------------------------------------------------------- my items --

export async function listMyItems(kind: ItemKind = 'theme'): Promise<(MarketItem & { draft: ItemDraft | null })[]> {
  const uid = me();
  if (!uid) return [];
  const { data, error } = await supabase.from('themes').select('*').eq('author_id', uid).eq('kind', kind).order('updated_at', { ascending: false });
  if (error) throw error;
  const items = (data ?? []) as MarketItem[];
  if (!items.length) return [];
  const { data: drafts, error: dErr } = await supabase.from('theme_drafts').select('*').in('theme_id', items.map((i) => i.id));
  if (dErr) throw dErr;
  const byId = new Map(((drafts ?? []) as ItemDraft[]).map((d) => [d.theme_id, d]));
  return items.map((i) => ({ ...i, draft: byId.get(i.id) ?? null }));
}

export async function listVersions(itemId: string): Promise<ItemVersion[]> {
  const { data, error } = await supabase.from('theme_versions').select('*').eq('theme_id', itemId).order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ItemVersion[];
}

/** Save as a draft. Creates the item when id is null. Nobody else sees drafts. */
export async function saveDraft(input: { id: string | null; kind: ItemKind; name: string; description: string; data: Record<string, unknown>; category: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('theme_save', {
    p_theme: input.id,
    p_kind: input.id ? null : input.kind,
    p_name: input.name,
    p_description: input.description,
    p_data: input.data,
    p_category: input.category,
  });
  if (error) throw error;
  return data as string;
}

/** Publish the draft as a new version; returns the new version number. */
export async function publishDraft(id: string, changelog = ''): Promise<number> {
  const { data, error } = await supabase.rpc('theme_publish', { p_theme: id, p_changelog: changelog });
  if (error) throw error;
  return data as number;
}

export async function restoreVersion(id: string, version: number): Promise<number> {
  const { data, error } = await supabase.rpc('theme_rollback', { p_theme: id, p_version: version });
  if (error) throw error;
  return data as number;
}

export async function setItemStatus(id: string, status: Exclude<ItemStatus, 'draft'>, reason = ''): Promise<void> {
  const { error } = await supabase.rpc('theme_set_status', { p_theme: id, p_status: status, p_reason: reason });
  if (error) throw error;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('themes').delete().eq('id', id);
  if (error) throw error;
}

/** Record an install (counted once per person). Missing database support is not fatal. */
export async function recordInstall(id: string): Promise<void> {
  const { error } = await supabase.rpc('install_theme', { p_theme: id });
  if (error && !/schema cache|does not exist/i.test(error.message)) throw error;
}

// ------------------------------------------------- installed theme updates --

export interface ThemeUpdate {
  installed: Theme;
  latest: MarketItem;
  /** versions newer than the installed one, newest first */
  changes: ItemVersion[];
}

export const updatePolicy = (sourceId: string): ThemeUpdatePolicy => getSettings().themeUpdates[sourceId] ?? 'ask';

export function setUpdatePolicy(sourceId: string, policy: ThemeUpdatePolicy) {
  updateSettings((s) => ({ themeUpdates: { ...s.themeUpdates, [sourceId]: policy } }));
}

/** Installed marketplace themes that have a newer published version. */
export async function findThemeUpdates(installed: Theme[] = getSettings().installedThemes): Promise<ThemeUpdate[]> {
  const fromMarket = installed.filter((t) => t.sourceId);
  if (!fromMarket.length) return [];
  const { data, error } = await supabase
    .from('themes')
    .select('*')
    .in('id', fromMarket.map((t) => t.sourceId!))
    .eq('status', 'published')
    .eq('kind', 'theme');
  if (error) {
    if (/column .*(status|version)|schema cache/i.test(error.message)) return []; // database not migrated yet
    throw error;
  }
  const latest = new Map(((data ?? []) as MarketItem[]).map((m) => [m.id, m]));
  const out: ThemeUpdate[] = [];
  for (const t of fromMarket) {
    const m = latest.get(t.sourceId!);
    if (!m || m.version <= (t.version ?? 1)) continue;
    const { data: v } = await supabase
      .from('theme_versions')
      .select('*')
      .eq('theme_id', m.id)
      .gt('version', t.version ?? 1)
      .order('version', { ascending: false })
      .limit(10);
    out.push({ installed: t, latest: m, changes: (v ?? []) as ItemVersion[] });
  }
  return out;
}

/** Replace an installed theme with a given version (newer, or older to roll back). */
export function installVersion(installed: Theme, v: { name: string; description: string; data: Record<string, unknown> }, version: number): Theme | null {
  const next = themeFrom(v, installed.sourceId!, version, installed.author);
  if (!next) return null;
  updateSettings((s) => ({ installedThemes: s.installedThemes.map((x) => (x.id === installed.id ? next : x)) }));
  void recordInstall(installed.sourceId!).catch(() => {});
  return next;
}

/** Apply updates for themes set to update automatically. Returns how many were updated. */
export async function runAutoThemeUpdates(): Promise<number> {
  const updates = await findThemeUpdates();
  let n = 0;
  for (const u of updates) {
    if (updatePolicy(u.installed.sourceId!) !== 'auto') continue;
    if (installVersion(u.installed, u.latest, u.latest.version)) n++;
  }
  return n;
}
