// Theme Studio: create themes, edit the ones you published (drafts → new
// versions, history, restore, unpublish), and manage updates for themes you
// installed from the marketplace. Ownership is enforced by the database; this
// screen only offers what the database will allow.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { getSettings, updateSettings, useSettings, type ThemeUpdatePolicy } from '../lib/settings';
import { applyTheme, BUILT_IN_THEMES, sanitizeTheme, THEME_KEYS, type Theme } from '../lib/themes';
import {
  categoryLabel, deleteItem, findThemeUpdates, installVersion, listMyItems, listVersions, publishDraft, restoreVersion,
  saveDraft, setItemStatus, setUpdatePolicy, THEME_CATEGORIES, themeData, themeFrom,
  type ItemDraft, type ItemStatus, type ItemVersion, type MarketItem, type ThemeUpdate,
} from '../lib/themeMarket';
import { askConfirm, askText } from './Dialogs';
import { Select } from './Select';
import { Field, Icon } from './ui';

// --------------------------------------------------------------- swatch --

export function ThemeSwatch({ t }: { t: Theme }) {
  const v = t.vars;
  return (
    <div className="theme-swatch" style={{ background: t.wallpaper && t.wallpaper !== 'none' ? t.wallpaper : v['bg-0'] }}>
      <div className="ts-rail" style={{ background: v['bg-1'] }} />
      <div className="ts-side" style={{ background: v['bg-2'] }}>
        <span style={{ background: v['bg-4'] }} />
        <span style={{ background: v['bg-3'] }} />
      </div>
      <div className="ts-main" style={{ background: v['bg-3'] }}>
        <span style={{ background: v.text }} />
        <span style={{ background: v['text-2'] }} />
        <span className="ts-accent" style={{ background: v.accent }} />
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {desc && <span className="small muted">{desc}</span>}
      </span>
      <input type="checkbox" className="toggle-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Put the user's chosen theme back (after a live preview). */
function restoreSelectedTheme() {
  const s = getSettings();
  applyTheme([...BUILT_IN_THEMES, ...s.installedThemes].find((t) => t.id === s.themeId) ?? BUILT_IN_THEMES[0]);
}

const EDITABLE: { key: (typeof THEME_KEYS)[number]; label: string }[] = [
  { key: 'bg-0', label: 'Background' },
  { key: 'bg-1', label: 'Server rail' },
  { key: 'bg-2', label: 'Sidebars' },
  { key: 'bg-3', label: 'Chat' },
  { key: 'bg-4', label: 'Inputs & hover' },
  { key: 'text', label: 'Text' },
  { key: 'text-2', label: 'Secondary text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'on-accent', label: 'Text on accent' },
  { key: 'link', label: 'Links' },
  { key: 'danger', label: 'Danger' },
];

const WALLPAPERS = [
  'none',
  'radial-gradient(1200px 800px at 15% 10%, #3b3f58 0%, transparent 60%), radial-gradient(900px 700px at 85% 90%, #2a3d44 0%, transparent 60%), linear-gradient(160deg, #07070a, #0d0e14)',
  'linear-gradient(135deg, #1f1c2c, #3a2f5b, #12101a)',
  'linear-gradient(160deg, #0f2027, #203a43, #2c5364)',
  'radial-gradient(900px 600px at 80% 10%, #5b2a3d 0%, transparent 60%), linear-gradient(180deg, #0a0608, #120a10)',
  'linear-gradient(135deg, #0b3a2c, #06221a 60%, #000000)',
];

// -------------------------------------------------------------- creator --

/** An item you published (or drafted), opened for editing. */
export interface EditingTheme {
  id: string;
  name: string;
  description: string;
  category: string | null;
  data: Record<string, unknown>;
  status: ItemStatus;
  version: number;
}

interface Look {
  vars: Record<string, string>;
  glass: boolean;
  wallpaper: string;
}

function lookOf(data: Record<string, unknown> | undefined): Look {
  const t = data ? sanitizeTheme({ ...(data as Partial<Theme>), name: 'x' }) : null;
  const base = t ?? BUILT_IN_THEMES[0];
  return { vars: { ...base.vars }, glass: Boolean(base.glass), wallpaper: base.wallpaper ?? 'none' };
}

export function ThemeCreator({ editing, onDone, onCancel }: { editing?: EditingTheme; onDone: (msg: string) => void; onCancel?: () => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const [name, setName] = useState(editing?.name ?? 'My theme');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [category, setCategory] = useState<string>(editing?.category ?? '');
  const [look, setLookState] = useState<Look>(() => lookOf(editing?.data));
  const [draftId, setDraftId] = useState<string | null>(editing?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // undo / redo: a colour picker fires on every drag step, so consecutive
  // changes to the same colour within a moment count as one step
  const past = useRef<Look[]>([]);
  const future = useRef<Look[]>([]);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);
  const setLook = useCallback((fn: (l: Look) => Look, key: string) => {
    setLookState((cur) => {
      const now = Date.now();
      const sameStroke = lastEdit.current && lastEdit.current.key === key && now - lastEdit.current.at < 800;
      if (!sameStroke) {
        past.current = [...past.current.slice(-99), cur];
        future.current = [];
      }
      lastEdit.current = { key, at: now };
      return fn(cur);
    });
    bump((n) => n + 1);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setLookState((cur) => {
      future.current = [cur, ...future.current];
      return prev;
    });
    lastEdit.current = null;
    bump((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    setLookState((cur) => {
      past.current = [...past.current, cur];
      return next;
    });
    future.current = rest;
    lastEdit.current = null;
    bump((n) => n + 1);
  }, []);

  const theme = useMemo(
    () =>
      sanitizeTheme({
        id: editing ? `market-${editing.id}` : `custom-${Date.now()}`,
        name,
        description,
        vars: look.vars,
        glass: look.glass,
        wallpaper: look.wallpaper === 'none' ? undefined : look.wallpaper,
        author: me.display_name,
      }),
    [name, description, look, me.display_name, editing],
  );

  // live preview on the whole app; always put the chosen theme back afterwards
  const liveRef = useRef(false);
  liveRef.current = live;
  useEffect(() => {
    if (live && theme) applyTheme(theme);
  }, [live, theme]);
  useEffect(() => () => void (liveRef.current && restoreSelectedTheme()), []);

  const startFrom = (t: Theme) => setLook(() => ({ vars: { ...t.vars }, glass: Boolean(t.glass), wallpaper: t.wallpaper ?? 'none' }), `start-${t.id}`);

  const isUpdate = Boolean(editing && editing.version >= 1);

  async function save(publish: boolean) {
    if (!theme) return setError('Pick valid colors.');
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const id = await saveDraft({ id: draftId, kind: 'theme', name: name.trim(), description: description.trim(), data: themeData(theme), category: category || null });
      setDraftId(id);
      if (!publish) {
        setSaved(`Draft saved ${new Date().toLocaleTimeString()} — only you can see it.`);
        return;
      }
      let changelog = '';
      if (isUpdate) {
        const c = await askText({ title: `Publish version ${editing!.version + 1}`, label: 'What changed? (shown to people who installed it)', maxLength: 500, placeholder: 'Warmer accent, better contrast…' });
        if (c === null) return setSaved('Draft saved — not published yet.');
        changelog = c.trim();
      }
      const v = await publishDraft(id, changelog);
      // keep the creator's own copy installed and in sync with what was published
      const mine = themeFrom({ name: name.trim(), description: description.trim(), data: themeData(theme) }, id, v, me.display_name);
      if (mine) updateSettings((s) => ({ installedThemes: [...s.installedThemes.filter((x) => x.id !== mine.id), mine], themeId: mine.id }));
      setLive(false);
      onDone(isUpdate ? `Published version ${v} of “${name.trim()}”. People who installed it will be offered the update.` : `Published “${name.trim()}” to the marketplace.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="theme-creator"
      onKeyDown={(e) => {
        if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) (e.preventDefault(), undo());
        else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') (e.preventDefault(), redo());
      }}
    >
      <div className="theme-creator-form">
        {editing && (
          <div className="studio-editing small">
            <Icon name="edit" size={14} /> Editing <b>{editing.name}</b>
            {isUpdate ? ` · live version ${editing.version}` : ' · not published yet'} — changes stay private until you publish.
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        {saved && <div className="form-notice">{saved}</div>}
        <Field label="Start from">
          <div className="tag-options">
            {BUILT_IN_THEMES.map((t) => (
              <button key={t.id} type="button" className="tag-option" onClick={() => startFrom(t)}>
                {t.name}
              </button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label="Name">
            <input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <input maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label="Category">
          <Select value={category} onChange={setCategory} placeholder="Choose a category" options={[{ value: '', label: 'No category' }, ...THEME_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]} />
        </Field>
        <div className="studio-history">
          <span className="field-label">Colors</span>
          <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>
            <Icon name="reply" size={15} />
          </button>
          <button type="button" className="icon-btn studio-redo" title="Redo (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo}>
            <Icon name="reply" size={15} />
          </button>
        </div>
        <div className="color-grid">
          {EDITABLE.map((e) => (
            <label key={e.key} className="color-cell">
              <input type="color" value={(look.vars[e.key] ?? '#000000').slice(0, 7)} onChange={(ev) => setLook((l) => ({ ...l, vars: { ...l.vars, [e.key]: ev.target.value } }), e.key)} />
              <span>{e.label}</span>
            </label>
          ))}
        </div>
        <Toggle label="Frosted glass" desc="See-through panels over the wallpaper." checked={look.glass} onChange={(g) => setLook((l) => ({ ...l, glass: g }), 'glass')} />
        <Field label="Wallpaper">
          <div className="wallpaper-grid">
            {WALLPAPERS.map((w) => (
              <button key={w} type="button" className={`wallpaper-option${look.wallpaper === w ? ' selected' : ''}`} style={{ background: w === 'none' ? look.vars['bg-0'] : w }} onClick={() => setLook((l) => ({ ...l, wallpaper: w }), 'wallpaper')}>
                {w === 'none' && 'None'}
              </button>
            ))}
          </div>
        </Field>
        <div className="modal-actions">
          {onCancel && (
            <button className="btn link" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          )}
          {!editing && (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                if (!theme) return setError('Pick valid colors.');
                updateSettings((s) => ({ installedThemes: [...s.installedThemes, theme], themeId: theme.id }));
                onDone(`Saved “${theme.name}” to My Themes (only on your account).`);
              }}
            >
              Keep it private
            </button>
          )}
          <button className="btn secondary" disabled={busy} onClick={() => save(false)} title="Only you can see drafts">
            Save draft
          </button>
          <button className="btn primary" disabled={busy} onClick={() => save(true)}>
            {busy ? 'Working…' : isUpdate ? `Publish version ${editing!.version + 1}` : 'Publish to marketplace'}
          </button>
        </div>
      </div>
      <div className="theme-creator-preview">
        <div className="field-label">Preview</div>
        {theme && <ThemeSwatch t={theme} />}
        <button
          type="button"
          className={`btn small ${live ? 'primary' : 'secondary'} studio-live`}
          onClick={() => {
            if (live) {
              setLive(false);
              restoreSelectedTheme();
            } else setLive(true);
          }}
        >
          <Icon name="eye" size={14} /> {live ? 'Stop previewing' : 'Try it on Venband'}
        </button>
        {live && <p className="small muted">You’re seeing it everywhere. Leaving this screen puts your theme back.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ my themes --

type MyItem = MarketItem & { draft: ItemDraft | null };

function statusLabel(it: MyItem): { text: string; cls: string } {
  if (it.status === 'removed') return { text: 'Removed by moderators', cls: 'bad' };
  if (it.status === 'draft' || it.version < 1) return { text: 'Draft · not published', cls: 'muted' };
  if (it.status === 'unpublished') return { text: `Unpublished · v${it.version}`, cls: 'warn' };
  return { text: `Published · v${it.version}`, cls: 'good' };
}

export function MyThemes({ onEdit }: { onEdit: (e: EditingTheme) => void }) {
  const [items, setItems] = useState<MyItem[] | null>(null);
  const [history, setHistory] = useState<Record<string, ItemVersion[] | 'loading'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listMyItems('theme'));
    } catch (e) {
      setItems([]);
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (id: string, fn: () => Promise<string | void>) => {
    setBusy(id);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
      await load();
      if (history[id]) setHistory((h) => ({ ...h, [id]: 'loading' }));
      if (history[id]) {
        const fresh = await listVersions(id).catch(() => null);
        setHistory(({ [id]: _old, ...rest }) => (fresh ? { ...rest, [id]: fresh } : rest));
      }
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const toggleHistory = async (id: string) => {
    if (history[id]) return setHistory(({ [id]: _, ...rest }) => rest);
    setHistory((h) => ({ ...h, [id]: 'loading' }));
    try {
      const v = await listVersions(id);
      setHistory((h) => ({ ...h, [id]: v }));
    } catch (e) {
      setHistory(({ [id]: _, ...rest }) => rest);
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  if (!items) return <div className="spinner" />;
  return (
    <div className="studio-mine">
      {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
      {!items.length && <p className="muted">You haven’t published a theme yet. Make one under “Create”, then publish it — you can keep editing it afterwards.</p>}
      {items.map((it) => {
        const st = statusLabel(it);
        const src = it.draft ?? it;
        const preview = themeFrom(src, it.id, Math.max(1, it.version));
        const h = history[it.id];
        const removed = it.status === 'removed';
        const edit = () =>
          onEdit({ id: it.id, name: src.name, description: src.description, category: src.category, data: src.data, status: it.status, version: it.version });
        return (
          <article key={it.id} className="studio-item">
            <div className="studio-item-main">
              <div className="studio-item-swatch">{preview && <ThemeSwatch t={preview} />}</div>
              <div className="studio-item-info">
                <div className="studio-item-title">
                  <b>{it.name}</b>
                  <span className={`studio-status ${st.cls}`}>{st.text}</span>
                  {it.draft && it.version >= 1 && !removed && <span className="studio-status draft">Unpublished changes</span>}
                </div>
                <div className="small muted">
                  {it.installs.toLocaleString()} install{it.installs === 1 ? '' : 's'}
                  {it.category ? ` · ${categoryLabel(it.category)}` : ''} · updated {when(it.updated_at)}
                </div>
                {removed && it.removed_reason && <div className="form-error small">Reason: {it.removed_reason}. Only Venband staff can restore it — you can appeal in Settings → Security.</div>}
                <div className="theme-actions">
                  {!removed && (
                    <button className="btn primary small" disabled={busy === it.id} onClick={edit}>
                      <Icon name="edit" size={13} /> Edit
                    </button>
                  )}
                  {!removed && it.draft && (
                    <button
                      className="btn secondary small"
                      disabled={busy === it.id}
                      onClick={() =>
                        run(it.id, async () => {
                          let changelog = '';
                          if (it.version >= 1) {
                            const c = await askText({ title: `Publish version ${it.version + 1}`, label: 'What changed? (shown to people who installed it)', maxLength: 500 });
                            if (c === null) return;
                            changelog = c.trim();
                          }
                          const v = await publishDraft(it.id, changelog);
                          return `Published version ${v}.`;
                        })
                      }
                    >
                      Publish {it.version >= 1 ? `v${it.version + 1}` : 'draft'}
                    </button>
                  )}
                  {it.version >= 1 && (
                    <button className="btn link small" onClick={() => toggleHistory(it.id)}>
                      <Icon name="history" size={13} /> {h ? 'Hide history' : 'History'}
                    </button>
                  )}
                  {!removed && it.version >= 1 && (
                    <button
                      className="btn link small"
                      disabled={busy === it.id}
                      onClick={() =>
                        run(it.id, async () => {
                          const next = it.status === 'published' ? 'unpublished' : 'published';
                          await setItemStatus(it.id, next);
                          return next === 'published' ? `“${it.name}” is back in the marketplace.` : `“${it.name}” is hidden from the marketplace. People who installed it keep it.`;
                        })
                      }
                    >
                      {it.status === 'published' ? 'Unpublish' : 'Publish again'}
                    </button>
                  )}
                  <button
                    className="btn link small danger-text"
                    disabled={busy === it.id}
                    onClick={() =>
                      run(it.id, async () => {
                        if (!(await askConfirm({ title: `Delete “${it.name}”?`, body: 'It and all its versions are deleted for good. People who installed it keep their copy.', confirm: 'Delete', danger: true }))) return;
                        await deleteItem(it.id);
                        return `Deleted “${it.name}”.`;
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
            {h && (
              <div className="studio-versions">
                {h === 'loading' && <div className="spinner small" />}
                {h !== 'loading' &&
                  h.map((v) => {
                    const vt = themeFrom(v, it.id, v.version);
                    const current = v.version === it.version;
                    return (
                      <div key={v.version} className={`studio-version${current ? ' current' : ''}`}>
                        <div className="studio-version-swatch">{vt && <ThemeSwatch t={vt} />}</div>
                        <div className="grow">
                          <b>Version {v.version}</b> {current && <span className="studio-status good">Live</span>}
                          <div className="small muted">{when(v.created_at)}{v.changelog ? ` — ${v.changelog}` : ''}</div>
                        </div>
                        {!current && !removed && (
                          <button
                            className="btn secondary small"
                            disabled={busy === it.id}
                            onClick={() =>
                              run(it.id, async () => {
                                if (!(await askConfirm({ title: `Restore version ${v.version}?`, body: `It’s published as version ${it.version + 1}, so nothing in the history is lost. People who installed it are offered the update.`, confirm: 'Restore' }))) return;
                                const nv = await restoreVersion(it.id, v.version);
                                return `Version ${v.version} is live again (as version ${nv}).`;
                              })
                            }
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

// ------------------------------------------- updates for installed themes --

const POLICY_LABEL: Record<ThemeUpdatePolicy, string> = {
  ask: 'Ask before updating',
  auto: 'Update automatically',
  keep: 'Keep my version',
};

/** Shows updates for marketplace themes you installed, and lets you choose how updates work. */
export function InstalledThemeUpdates() {
  const installed = useSettings((s) => s.installedThemes);
  const policies = useSettings((s) => s.themeUpdates);
  const [updates, setUpdates] = useState<ThemeUpdate[]>([]);
  const [versions, setVersions] = useState<Record<string, ItemVersion[] | 'loading'>>({});
  const [note, setNote] = useState<string | null>(null);
  const fromMarket = installed.filter((t) => t.sourceId);
  const key = fromMarket.map((t) => `${t.sourceId}:${t.version ?? 1}`).join(',');

  useEffect(() => {
    if (!key) return setUpdates([]);
    let alive = true;
    findThemeUpdates(installed)
      .then((list) => {
        if (!alive) return;
        const auto = list.filter((u) => (policies[u.installed.sourceId!] ?? 'ask') === 'auto');
        for (const u of auto) installVersion(u.installed, u.latest, u.latest.version);
        if (auto.length) setNote(`Updated ${auto.map((u) => u.latest.name).join(', ')} automatically.`);
        setUpdates(list.filter((u) => (policies[u.installed.sourceId!] ?? 'ask') === 'ask'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const showVersions = async (t: Theme) => {
    const id = t.sourceId!;
    if (versions[id]) return setVersions(({ [id]: _, ...rest }) => rest);
    setVersions((v) => ({ ...v, [id]: 'loading' }));
    try {
      const list = await listVersions(id);
      setVersions((v) => ({ ...v, [id]: list }));
    } catch {
      setVersions(({ [id]: _, ...rest }) => rest);
      setNote('That theme’s history isn’t available (it may have been unpublished).');
    }
  };

  if (!fromMarket.length) return null;
  return (
    <section className="studio-updates">
      {note && <div className="form-notice">{note}</div>}
      {updates.map((u) => (
        <div key={u.installed.id} className="studio-update">
          <div className="grow">
            <b>Update for {u.installed.name}</b> — version {u.installed.version ?? 1} → {u.latest.version}
            <ul className="small">
              {u.changes.map((c) => (
                <li key={c.version}>
                  <b>v{c.version}</b> {c.changelog || <span className="muted">No notes</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="theme-actions">
            <button className="btn primary small" onClick={() => (installVersion(u.installed, u.latest, u.latest.version), setUpdates((l) => l.filter((x) => x !== u)))}>
              Update
            </button>
            <button className="btn secondary small" onClick={() => (setUpdatePolicy(u.installed.sourceId!, 'auto'), installVersion(u.installed, u.latest, u.latest.version), setUpdates((l) => l.filter((x) => x !== u)))}>
              Always update
            </button>
            <button className="btn link small" onClick={() => (setUpdatePolicy(u.installed.sourceId!, 'keep'), setUpdates((l) => l.filter((x) => x !== u)))}>
              Keep v{u.installed.version ?? 1}
            </button>
          </div>
        </div>
      ))}
      <details className="studio-installed">
        <summary className="small">Marketplace themes you installed ({fromMarket.length}) — updates and versions</summary>
        {fromMarket.map((t) => {
          const v = versions[t.sourceId!];
          return (
            <div key={t.id} className="studio-installed-row">
              <div className="grow">
                <b>{t.name}</b> <span className="small muted">v{t.version ?? 1}{t.author ? ` · by ${t.author}` : ''}</span>
              </div>
              <Select
                className="studio-policy"
                value={policies[t.sourceId!] ?? 'ask'}
                onChange={(p) => setUpdatePolicy(t.sourceId!, p as ThemeUpdatePolicy)}
                options={(Object.keys(POLICY_LABEL) as ThemeUpdatePolicy[]).map((p) => ({ value: p, label: POLICY_LABEL[p] }))}
                ariaLabel={`Updates for ${t.name}`}
              />
              <button className="btn link small" onClick={() => showVersions(t)}>
                {v ? 'Hide versions' : 'Versions'}
              </button>
              {v && (
                <div className="studio-versions">
                  {v === 'loading' && <div className="spinner small" />}
                  {v !== 'loading' &&
                    v.map((ver) => (
                      <div key={ver.version} className={`studio-version${ver.version === (t.version ?? 1) ? ' current' : ''}`}>
                        <div className="grow">
                          <b>Version {ver.version}</b>
                          <div className="small muted">{when(ver.created_at)}{ver.changelog ? ` — ${ver.changelog}` : ''}</div>
                        </div>
                        {ver.version === (t.version ?? 1) ? (
                          <span className="studio-status good">Installed</span>
                        ) : (
                          <button
                            className="btn secondary small"
                            onClick={() => {
                              installVersion(t, ver, ver.version);
                              // going back to an older version shouldn't be undone by auto-updates
                              if (ver.version < (t.version ?? 1)) setUpdatePolicy(t.sourceId!, 'keep');
                              setVersions(({ [t.sourceId!]: _, ...rest }) => rest);
                              setNote(`Now using version ${ver.version} of ${t.name}.`);
                            }}
                          >
                            Use this version
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </details>
    </section>
  );
}
