// The Marketplace (in the DM sidebar): themes, nameplates, name styles and
// custom CSS that people published. Everything is applied on your side.
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore, updateMyProfile } from '../lib/session';
import { displayName, loadProfiles } from '../lib/directory';
import { updateSettings } from '../lib/settings';
import { sanitizeTheme } from '../lib/themes';
import { sanitizeCss } from '../lib/customCss';
import type { NameStyle, NameplateStyle } from '../lib/types';
import { askConfirm } from './Dialogs';
import { ThemeSwatch } from './Settings';
import { Avatar, Icon, nameplateVars, StyledName } from './ui';

type Kind = 'theme' | 'nameplate' | 'name_style' | 'css';
interface Item {
  id: string;
  author_id: string;
  name: string;
  description: string;
  data: Record<string, unknown>;
  installs: number;
  kind: Kind;
  created_at: string;
}

const KINDS: { id: Kind; label: string; icon: string }[] = [
  { id: 'theme', label: 'Themes', icon: 'palette' },
  { id: 'nameplate', label: 'Nameplates', icon: 'sparkles' },
  { id: 'name_style', label: 'Name styles', icon: 'edit' },
  { id: 'css', label: 'Custom CSS', icon: 'code' },
];

function cleanNameStyle(d: Record<string, unknown>): NameStyle {
  return {
    font: typeof d.font === 'string' ? (d.font as NameStyle['font']) : undefined,
    effect: typeof d.effect === 'string' ? (d.effect as NameStyle['effect']) : undefined,
    colors: Array.isArray(d.colors) ? (d.colors as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 3) : [],
  };
}
function cleanPlate(d: Record<string, unknown>): NameplateStyle {
  return {
    colors: Array.isArray(d.colors) ? (d.colors as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 3) : [],
    pattern: ['sweep', 'stripes', 'dots', 'waves'].includes(d.pattern as string) ? (d.pattern as NameplateStyle['pattern']) : 'sweep',
  };
}

export function MarketplaceView() {
  const me = sessionStore.use((s) => s.me)!;
  const [kind, setKind] = useState<Kind>('theme');
  const [sort, setSort] = useState<'popular' | 'new'>('popular');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Item[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    let query = supabase.from('themes').select('*').eq('kind', kind).limit(120);
    query = sort === 'popular' ? query.order('installs', { ascending: false }).order('created_at', { ascending: false }) : query.order('created_at', { ascending: false });
    const { data, error } = await query;
    if (error) setMsg({ ok: false, text: errorMessage(error) });
    const list = (data ?? []) as Item[];
    await loadProfiles(list.map((x) => x.author_id));
    setRows(list);
  }, [kind, sort]);
  useEffect(() => {
    load();
  }, [load]);

  async function apply(it: Item) {
    setMsg(null);
    try {
      if (it.kind === 'theme') {
        const t = sanitizeTheme({ ...(it.data as object), id: `market-${it.id}`, name: it.name, description: it.description, author: displayName(it.author_id) });
        if (!t) throw new Error('That theme is invalid.');
        updateSettings((s) => ({ installedThemes: [...s.installedThemes.filter((x) => x.id !== t.id), t], themeId: t.id }));
      } else if (it.kind === 'nameplate') {
        await updateMyProfile({ nameplate: 'custom', nameplate_style: cleanPlate(it.data) });
      } else if (it.kind === 'name_style') {
        await updateMyProfile({ name_style: cleanNameStyle(it.data) });
      } else {
        if (!(await askConfirm({ title: `Use “${it.name}”?`, body: 'This replaces your custom CSS. Unsafe parts are removed. Safe mode (Ctrl+Shift+Alt+S) turns it off if anything breaks.', confirm: 'Use it' }))) return;
        updateSettings({ customCss: { enabled: true, code: sanitizeCss(String(it.data.css ?? '')) } });
      }
      await supabase.rpc('install_theme', { p_theme: it.id });
      setMsg({ ok: true, text: `Now using ${it.name}.` });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }

  const shown = (rows ?? []).filter((r) => !q.trim() || `${r.name} ${r.description} ${displayName(r.author_id)}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="market-view">
      <header className="chat-header">
        <Icon name="sparkles" />
        <h3>Marketplace</h3>
        <span className="topic small muted">Themes, nameplates, name styles and CSS made by the community</span>
      </header>
      <div className="market-body">
        <div className="market-toolbar">
          <div className="tabs">
            {KINDS.map((k) => (
              <button key={k.id} className={kind === k.id ? 'active' : ''} onClick={() => setKind(k.id)}>
                <Icon name={k.icon} size={14} /> {k.label}
              </button>
            ))}
          </div>
          <div className="row-start">
            <input className="search-input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the marketplace" />
            <button className={`chip${sort === 'popular' ? ' on' : ''}`} onClick={() => setSort('popular')}>
              Popular
            </button>
            <button className={`chip${sort === 'new' ? ' on' : ''}`} onClick={() => setSort('new')}>
              New
            </button>
          </div>
        </div>
        <p className="small muted">Publish your own from Settings → Profiles (nameplates and name styles) or Settings → Appearance (themes and CSS).</p>
        {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
        {!rows && <div className="spinner" />}
        {rows && !shown.length && <p className="muted">Nothing here yet — be the first to publish one!</p>}
        <div className="market-grid">
          {shown.map((it) => (
            <article key={it.id} className="market-card">
              <div className="market-preview">
                {it.kind === 'theme' && (() => {
                  const t = sanitizeTheme({ ...(it.data as object), id: `p-${it.id}`, name: it.name });
                  return t ? <ThemeSwatch t={t} /> : null;
                })()}
                {it.kind === 'nameplate' && (
                  <div className="member nameplate-row nameplate-custom" style={nameplateVars({ nameplate: 'custom', nameplate_style: cleanPlate(it.data) })}>
                    <Avatar profile={me} size={28} />
                    <span className="member-name">{me.display_name}</span>
                  </div>
                )}
                {it.kind === 'name_style' && (
                  <div className="market-name">
                    <StyledName style={cleanNameStyle(it.data)}>{me.display_name}</StyledName>
                  </div>
                )}
                {it.kind === 'css' && <pre className="market-css">{String(it.data.css ?? '').split('\n').slice(0, 7).join('\n')}</pre>}
              </div>
              <div className="market-meta">
                <b>{it.name}</b>
                <span className="small muted">
                  by {displayName(it.author_id)} · {it.installs.toLocaleString()} use{it.installs === 1 ? '' : 's'}
                </span>
              </div>
              <div className="row-start">
                <button className="btn primary small" onClick={() => apply(it)}>
                  Use
                </button>
                {it.author_id === me.id && (
                  <button
                    className="btn link small danger-text"
                    onClick={async () => {
                      if (!(await askConfirm({ title: `Remove ${it.name}?`, body: 'It disappears from the Marketplace. People already using it keep it.', confirm: 'Remove', danger: true }))) return;
                      await supabase.from('themes').delete().eq('id', it.id);
                      load();
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
