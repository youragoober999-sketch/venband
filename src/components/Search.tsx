// Search everything you can read (decrypted and matched on this device),
// plus the Saved Messages view.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { allTargets, filterTargets, parseQuery, searchMessages, type SearchHit, type SearchTarget } from '../lib/search';
import { openChannel } from '../hooks/data';
import { uiStore } from '../lib/ui';
import { setSaved } from '../lib/chatExtras';
import { useSettings } from '../lib/settings';
import { searchEmoji, loadEmoji } from '../lib/emoji';
import type { DecryptedMessage } from '../lib/keyring';
import type { MessageRow, Server } from '../lib/types';
import { Markdown } from './Markdown';
import { Avatar, Icon } from './ui';
import { friendlyTime } from './Chat';

const FILTER_HELP: [string, string][] = [
  ['from:', 'username'],
  ['mentions:', 'username'],
  ['in:', 'channel / server'],
  ['has:', 'image · video · file · link · gif · poll · code'],
  ['before:', '2026-05-01'],
  ['after:', '2026-05-01'],
  ['during:', '2026-05-01'],
  ['"…"', 'exact phrase'],
];

export function jumpTo(hit: { channelId: string; serverId: string | null; messageId: string }) {
  openChannel(hit.serverId ?? '@me', hit.channelId);
  setTimeout(() => uiStore.set({ jump: hit.messageId }), 50);
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="search-mark">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function SearchPanel({ servers }: { servers: Server[] }) {
  const state = uiStore.use((s) => s.search)!;
  const gifFavs = useSettings((s) => s.gifFavorites);
  const [q, setQ] = useState(state.q);
  const [scope, setScope] = useState<string | null>(state.serverId);
  const [targets, setTargets] = useState<SearchTarget[] | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    allTargets().then(setTargets);
    loadEmoji();
  }, []);

  const parsed = useMemo(() => parseQuery(q), [q]);
  const scoped = useMemo(() => {
    if (!targets) return [];
    const base = scope === null ? targets : scope === '@me' ? targets.filter((t) => !t.serverId) : targets.filter((t) => t.serverId === scope);
    return filterTargets(base, parsed);
  }, [targets, scope, parsed]);

  async function run(more = false) {
    if (!q.trim() || !targets) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    if (!more) {
      setHits([]);
      setScanned(0);
    }
    try {
      const res = await searchMessages(parsed, scoped, {
        before: more ? cursor : null,
        signal: ctrl.signal,
        onHit: (h) => !ctrl.signal.aborted && setHits((x) => [...x, h]),
        onProgress: (n) => !ctrl.signal.aborted && setScanned((s) => (more ? s : 0) + n),
      });
      if (!ctrl.signal.aborted) {
        setCursor(res.cursor);
        setRan(q);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  }

  useEffect(() => {
    if (state.q && targets) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  const words = [...parsed.words, ...parsed.phrases];
  const needle = words.join(' ');
  // quick matches that don't need decrypting
  const people = useMemo(() => {
    if (!needle || !targets) return [];
    return targets.filter((t) => !t.serverId && t.label.toLowerCase().includes(needle)).slice(0, 5);
  }, [needle, targets]);
  const serverMatches = needle ? servers.filter((s) => s.name.toLowerCase().includes(needle)).slice(0, 5) : [];
  const channelMatches = needle && targets ? targets.filter((t) => t.serverId && t.label.toLowerCase().includes(needle)).slice(0, 6) : [];
  const emojiMatches = needle && /^\S+$/.test(needle) ? searchEmoji(needle, [], 12) : [];
  const gifMatches = needle ? gifFavs.filter((g) => g.url.toLowerCase().includes(needle)).slice(0, 6) : [];

  const close = () => {
    abort.current?.abort();
    uiStore.set({ search: null });
  };

  return (
    <aside className="search-panel" role="dialog" aria-label="Search">
      <header className="search-head">
        <Icon name="search" size={18} />
        <input
          ref={input}
          autoFocus
          value={q}
          placeholder="Search messages, people, servers… try from: in: has:"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
          aria-label="Search"
        />
        <button className="icon-btn" onClick={close} aria-label="Close search">
          <Icon name="x" />
        </button>
      </header>
      <div className="search-scope" role="tablist" aria-label="Where to search">
        <button className={scope === null ? 'on' : ''} onClick={() => setScope(null)}>
          Everywhere
        </button>
        <button className={scope === '@me' ? 'on' : ''} onClick={() => setScope('@me')}>
          DMs & groups
        </button>
        {servers.slice(0, 6).map((s) => (
          <button key={s.id} className={scope === s.id ? 'on' : ''} onClick={() => setScope(s.id)}>
            {s.name}
          </button>
        ))}
      </div>
      <div className="search-body">
        {!q.trim() && (
          <div className="search-help">
            <p className="small muted">Messages are end-to-end encrypted, so Venband searches them on this device — your searches never reach the server.</p>
            <div className="filter-chips">
              {FILTER_HELP.map(([k, v]) => (
                <button
                  key={k}
                  className="filter-chip"
                  onClick={() => {
                    setQ((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${k === '"…"' ? '""' : k}`);
                    input.current?.focus();
                  }}
                >
                  <b>{k}</b> <span className="muted">{v}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {(people.length > 0 || serverMatches.length > 0 || channelMatches.length > 0) && (
          <section className="search-section">
            <h4>Jump to</h4>
            {people.map((t) => (
              <button key={t.channelId} className="search-row" onClick={() => (openChannel('@me', t.channelId), close())}>
                <Icon name="message" size={16} /> {t.label} <span className="muted small">conversation</span>
              </button>
            ))}
            {serverMatches.map((s) => (
              <button key={s.id} className="search-row" onClick={() => (openChannel(s.id, ''), close())}>
                <Icon name="home" size={16} /> {s.name} <span className="muted small">server</span>
              </button>
            ))}
            {channelMatches.map((t) => (
              <button key={t.channelId} className="search-row" onClick={() => (openChannel(t.serverId!, t.channelId), close())}>
                <Icon name="hash" size={16} /> {t.label.replace(/^#/, '')} <span className="muted small">{t.serverName}</span>
              </button>
            ))}
          </section>
        )}
        {(emojiMatches.length > 0 || gifMatches.length > 0) && (
          <section className="search-section">
            <h4>Emoji & GIFs</h4>
            <div className="search-emoji">
              {emojiMatches.map((m) =>
                m.kind === 'unicode' ? (
                  <button key={m.char} title={`:${m.name}: — click to copy`} onClick={() => navigator.clipboard?.writeText(m.char)}>
                    {m.char}
                  </button>
                ) : null,
              )}
              {gifMatches.map((g) => (
                <img key={g.url} src={g.preview} alt="" className="search-gif" title="Favorite GIF" />
              ))}
            </div>
          </section>
        )}
        {q.trim() && (
          <section className="search-section">
            <h4>
              Messages {ran === q && !busy ? `· ${hits.length}${cursor ? '+' : ''} found` : ''}
              {busy && <span className="muted small"> · decrypting and searching… {scanned.toLocaleString()} checked</span>}
            </h4>
            {ran !== q && !busy && (
              <button className="btn primary small" onClick={() => run()}>
                Search messages for “{q.trim()}”
              </button>
            )}
            {error && <div className="form-error">{error}</div>}
            {hits.map((h) => (
              <button key={h.m.row.id} className="search-hit" onClick={() => (jumpTo({ channelId: h.m.row.channel_id, serverId: h.target.serverId, messageId: h.m.row.id }), close())}>
                <Avatar profile={getProfile(h.m.row.author_id)} size={32} />
                <div className="grow search-hit-body">
                  <div className="search-hit-meta">
                    <b>{displayName(h.m.row.author_id)}</b>
                    <span className="muted small">
                      {h.target.serverName ? `${h.target.label} · ${h.target.serverName}` : h.target.label}
                    </span>
                    <time className="muted small" dateTime={h.m.row.created_at} title={new Date(h.m.row.created_at).toLocaleString()}>
                      {new Date(h.m.row.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                  </div>
                  <div className="search-hit-text">
                    <Highlight text={h.snippet} words={words} />
                  </div>
                </div>
              </button>
            ))}
            {ran === q && !busy && !hits.length && <p className="muted">No messages match. Try fewer words or a different filter.</p>}
            {cursor && !busy && ran === q && (
              <button className="btn secondary small" onClick={() => run(true)}>
                Search older messages
              </button>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- saved --

export function SavedView({ header }: { header?: ReactNode }) {
  const [items, setItems] = useState<{ m: DecryptedMessage; serverId: string | null; where: string; savedAt: string }[] | null>(null);
  const load = async () => {
    const { data } = await supabase.from('saved_messages').select('message_id, channel_id, created_at').order('created_at', { ascending: false }).limit(200);
    const rows = (data ?? []) as { message_id: string; channel_id: string; created_at: string }[];
    if (!rows.length) return setItems([]);
    const [{ data: msgs }, { data: chans }] = await Promise.all([
      supabase.from('messages').select('*').in('id', rows.map((r) => r.message_id)),
      supabase.from('channels').select('id, name, server_id, type, is_group').in('id', [...new Set(rows.map((r) => r.channel_id))]),
    ]);
    const chanById = new Map(((chans ?? []) as { id: string; name: string; server_id: string | null; type: string; is_group: boolean }[]).map((c) => [c.id, c]));
    const msgById = new Map(((msgs ?? []) as MessageRow[]).map((m) => [m.id, m]));
    await loadProfiles(((msgs ?? []) as MessageRow[]).map((m) => m.author_id));
    const kr = sessionStore.get().keyring!;
    const out = [];
    for (const r of rows) {
      const row = msgById.get(r.message_id);
      const c = chanById.get(r.channel_id);
      if (!row || !c) continue;
      await kr.loadChannel(c.id).catch(() => {});
      out.push({ m: await kr.decrypt(row), serverId: c.server_id, where: c.type === 'dm' ? (c.is_group ? c.name : 'Direct message') : `#${c.name}`, savedAt: r.created_at });
    }
    setItems(out);
  };
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="home-view saved-view">
      {header}
      <div className="saved-list">
        {!items && <div className="spinner" />}
        {items?.length === 0 && (
          <div className="empty-panel">
            <Icon name="bookmark" size={40} />
            <p>Nothing saved yet.</p>
            <p className="small muted">Right-click any message and choose Save Message. Saved messages are private to you.</p>
          </div>
        )}
        {items?.map((it) => (
          <div key={it.m.row.id} className="panel-message saved-item">
            <div className="search-hit-meta">
              <Avatar profile={getProfile(it.m.row.author_id)} size={24} />
              <b>{displayName(it.m.row.author_id)}</b>
              <span className="muted small">{it.where}</span>
              <span className="muted small">{friendlyTime(new Date(it.m.row.created_at))}</span>
            </div>
            <div className="panel-message-text">{it.m.payload ? <Markdown text={it.m.payload.text || `📎 ${it.m.payload.attachments?.length ?? 0} file(s)`} /> : <i className="muted">Can’t decrypt yet</i>}</div>
            <div className="panel-message-actions">
              <button className="btn small primary" onClick={() => jumpTo({ channelId: it.m.row.channel_id, serverId: it.serverId, messageId: it.m.row.id })}>
                Go to message
              </button>
              <button className="btn link small" onClick={() => setSaved(it.m.row, false).then(load)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
