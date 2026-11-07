// Your Shop collection: what you've collected, getting (free) and equipping.
import { supabase, isOldSchema } from './supabase';
import { createStore } from './store';
import { updateMyProfile } from './session';
import { updateSettings, getSettings } from './settings';
import { sanitizeTheme } from './themes';
import type { Theme } from './themeData';
import { ITEMS, STARTER_ITEMS, bundleOf, isFreeItem, themeColors, type ShopItem } from './shop';

export const inventoryStore = createStore<{ owned: Set<string>; loaded: boolean }>({ owned: new Set(STARTER_ITEMS), loaded: false });

let loading: Promise<void> | null = null;
export function loadInventory(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from('cosmetic_inventory').select('item_id').limit(5000);
    if (error && !isOldSchema(error)) throw error;
    const owned = new Set(STARTER_ITEMS);
    for (const r of (data ?? []) as { item_id: string }[]) owned.add(r.item_id);
    inventoryStore.set({ owned, loaded: true });
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
export const owns = (id: string) => isFreeItem(id) || inventoryStore.get().owned.has(id);
/** Shop items of one kind in your collection, as picker options. */
export function ownedOptions(kind: ShopItem['kind'], owned: Set<string>) {
  return [...owned].filter((id) => ITEMS.get(id)?.kind === kind).sort().map((id) => {
    const it = ITEMS.get(id)!;
    return { id, label: it.product.palettes.length > 1 ? `${it.name} · ${it.palette.name}` : it.name };
  });
}

/** Add items to your collection (bundles bring their items along). Free. */
export async function getItems(ids: string[]) {
  const all = new Set<string>();
  for (const id of ids) {
    if (!ITEMS.has(id) || owns(id)) continue;
    all.add(id);
    for (const sub of bundleOf(id)?.items ?? []) if (!owns(sub)) all.add(sub);
  }
  const list = [...all];
  for (let i = 0; i < list.length; i += 60) {
    const { error } = await supabase.rpc('claim_cosmetics', { p_items: list.slice(i, i + 60) });
    if (error) throw error;
  }
  const owned = new Set(inventoryStore.get().owned);
  list.forEach((id) => owned.add(id));
  inventoryStore.set({ owned, loaded: true });
  return list.length;
}

// ----------------------------------------------------------------- themes --
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, k: number) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * k));
/** A full theme (all the app's colour variables) from a shop theme's four colours. */
export function shopTheme(id: string): Theme | null {
  const tc = themeColors(id);
  const item = ITEMS.get(id);
  if (!tc || !item) return null;
  const light = tc.mode === 'light';
  const { bg, panel, text, accent } = tc;
  const t: Theme = {
    id: `shop-${item.base}`,
    name: item.name,
    description: item.product.desc,
    author: 'Venband Shop',
    vars: {
      'bg-0': light ? mix(bg, '#000000', 0.04) : mix(bg, '#000000', 0.35),
      'bg-1': bg,
      'bg-2': panel,
      'bg-3': mix(panel, text, light ? 0.05 : 0.06),
      'bg-4': mix(panel, text, light ? 0.1 : 0.12),
      'bg-hover': mix(panel, text, 0.04),
      line: `${text}${light ? '1a' : '12'}`,
      'line-2': `${text}${light ? '2a' : '22'}`,
      text,
      'text-2': mix(text, bg, 0.3),
      muted: mix(text, bg, 0.45),
      accent,
      'accent-hover': mix(accent, light ? '#000000' : '#ffffff', 0.15),
      'accent-soft': `${accent}22`,
      'accent-text': light ? mix(accent, '#000000', 0.25) : mix(accent, '#ffffff', 0.25),
      // perceived brightness, so mid-tone accents (indigo, hot pink) get white text
      'on-accent': hex(accent).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0) > 150 ? '#000000' : '#ffffff',
      link: light ? '#1d5bd8' : mix(accent, '#ffffff', 0.4),
      success: '#34c759',
      danger: '#ff453a',
      warning: '#ffd60a',
      'mention-bg': `${accent}1f`,
    },
    ...(tc.mode === 'glass' && tc.wallpaper ? { glass: true, wallpaper: tc.wallpaper } : {}),
  };
  return sanitizeTheme(t);
}

/** Put an item on: decorations / effects / nameplates go on your profile, themes apply here. */
export async function equip(item: ShopItem | null, kind: ShopItem['kind']) {
  if (kind === 'decoration') return updateMyProfile({ avatar_frame: item?.id ?? 'none' });
  if (kind === 'effect') return updateMyProfile({ profile_effect: item?.id ?? 'none' });
  if (kind === 'nameplate') return updateMyProfile({ nameplate: item?.id ?? 'none' });
  if (kind === 'theme') {
    if (!item) return updateSettings({ themeId: 'default' });
    const t = shopTheme(item.id);
    if (!t) throw new Error('That theme is invalid.');
    updateSettings((s) => ({ installedThemes: [...s.installedThemes.filter((x) => x.id !== t.id), t].slice(-50), themeId: t.id }));
  }
}
export const themeInUse = (id: string) => getSettings().themeId === `shop-${ITEMS.get(id)?.base}`;
