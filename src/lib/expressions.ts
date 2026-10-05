// Emoji, GIFs, stickers and sounds from the servers you're in, cached so
// messages can show <:name:id> tokens as pictures.
import { createStore } from './store';
import { supabase } from './supabase';
import type { CustomEmoji } from './emoji';

export interface Expression {
  id: string;
  server_id: string;
  server_name: string;
  kind: 'emoji' | 'gif' | 'sticker' | 'sound';
  name: string;
  aliases: string[];
  url: string;
  mime: string;
  duration_ms: number | null;
  emoji: string | null;
}

export const expressionStore = createStore<{ list: Expression[]; byId: Record<string, Expression> }>({ list: [], byId: {} });

let loading: Promise<void> | null = null;
export function loadExpressions(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data } = await supabase.rpc('my_expressions');
    const list = (data ?? []) as Expression[];
    expressionStore.set({ list, byId: Object.fromEntries(list.map((e) => [e.id, e])) });
  })();
  return loading;
}

// Someone used an emoji we don't know yet (probably just uploaded): refresh,
// but at most every few seconds however many unknown tokens are on screen.
let lastMiss = 0;
export function noteUnknownExpression(id: string) {
  if (expressionStore.get().byId[id] || Date.now() - lastMiss < 5000) return;
  lastMiss = Date.now();
  loadExpressions(true);
}

export function resetExpressions() {
  loading = null;
  expressionStore.set({ list: [], byId: {} });
}

export function customEmoji(list: Expression[]): CustomEmoji[] {
  return list
    .filter((e) => e.kind === 'emoji')
    .map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, url: e.url, animated: e.mime === 'image/gif', serverName: e.server_name }));
}

/** <:name:id>, <a:name:id> (emoji) and <s:name:id> (sticker) tokens. */
export const EXPRESSION_TOKEN = /<(a|s)?:([A-Za-z0-9_]{2,32}):([0-9a-f-]{36})>/;
