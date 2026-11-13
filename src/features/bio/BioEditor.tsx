import { useEffect, useState, type CSSProperties } from 'react';
import { sessionStore } from '../../lib/session';
import { errorMessage, supabase } from '../../lib/supabase';
import { linkTo } from '../../lib/router';
import { myConnections, reloadConnections, type ProfileConnection } from '../../lib/connections';
import { BioCard } from './BioPage';
import { BIO_DEFAULT, BIO_TEMPLATES, bioLink, normalizeBio, uploadBioAsset, type BioPage } from './bioModel';

const ASSETS = [
  ['backgroundAsset', 'Background', 'image'], ['avatarAsset', 'Avatar', 'image'],
  ['audioAsset', 'Audio', 'audio'], ['cursorAsset', 'Cursor', 'cursor'],
] as const;
const COLORS = [['background', 'Background'], ['panel', 'Card'], ['accent', 'Accent'], ['text', 'Text']] as const;

export function BioEditor() {
  const me = sessionStore.use((s) => s.me)!;
  const [page, setPage] = useState<BioPage>(BIO_DEFAULT);
  const [published, setPublished] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [connections, setConnections] = useState<ProfileConnection[]>([]);
  const path = `${encodeURIComponent(me.username)}/bio`;
  const identity = { username: me.username, displayName: me.display_name, avatar: me.avatar_url ?? null, avatarColor: me.avatar_color };
  const update = (patch: Partial<BioPage>) => setPage((current) => ({ ...current, ...patch }));
  useEffect(() => {
    let active = true;
    void supabase.from('bio_pages').select('draft,published').eq('user_id', me.id).maybeSingle().then(({ data, error: failure }) => {
      if (!active) return;
      if (failure) { setError(errorMessage(failure)); return; }
      setPage(data ? normalizeBio(data.draft) : { ...BIO_DEFAULT, bio: me.about ?? '' });
      setPublished(Boolean(data?.published));
      setReady(true);
    });
    void reloadConnections().then(() => {
      if (active) setConnections(myConnections().filter((item) => item.show_on_profile !== false).map((item) => ({
        ...item, handle: typeof item.metadata.handle === 'string' ? item.metadata.handle : null,
      })));
    }).catch(() => {});
    return () => { active = false; };
  }, [me.id]);

  async function save(action: 'draft' | 'publish' | 'unpublish') {
    if (!ready || busy) return;
    const links = page.links.filter((link) => link.label.trim() || link.url.trim());
    if (action === 'publish' && links.some((link) => !link.label.trim() || !bioLink(link.url))) {
      setError('Each link needs a label and a valid HTTPS URL.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: failure } = await supabase.rpc('save_bio_page', {
        p_draft: page, p_published: action === 'publish' ? normalizeBio(page) : null, p_action: action,
      });
      if (failure) throw failure;
      if (action !== 'draft') setPublished(action === 'publish');
      setNotice(action === 'draft' ? 'Draft saved.' : action === 'publish' ? 'Bio page published.' : 'Bio page unpublished.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <section className="bio-editor">
    <header className="bio-editor-top">
      <div><h2>Bio Page</h2><span className="muted">/{me.username}/bio · {published ? 'Public' : 'Unpublished'}</span></div>
      <div className="bio-editor-actions">
        {published && <a className="btn secondary small" href={linkTo(path)} target="_blank" rel="noopener noreferrer">View page</a>}
        <button className="btn secondary small" disabled={!ready || busy} onClick={() => void save('draft')}>Save draft</button>
        <button className="btn primary small" disabled={!ready || busy} onClick={() => void save('publish')}>{published ? 'Publish changes' : 'Publish'}</button>
      </div>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {ready && <div className="bio-editor-grid">
      <div className="bio-editor-controls">
        <fieldset disabled={busy}><legend>Profile</legend>
          <label>Display name<input value={page.title} maxLength={80} placeholder={me.display_name} onChange={(e) => update({ title: e.target.value })} /></label>
          <label>Bio<textarea rows={4} value={page.bio} maxLength={1200} onChange={(e) => update({ bio: e.target.value })} /></label>
          <label>Location<input value={page.location} maxLength={80} onChange={(e) => update({ location: e.target.value })} /></label>
        </fieldset>
        <fieldset disabled={busy}><legend>Links & connections</legend>
          <label className="bio-inline"><input type="checkbox" checked={page.showConnections} onChange={(e) => update({ showConnections: e.target.checked })} /> Include visible Venband connections on this public page</label>
          <p className="small muted">Add any HTTPS profile, portfolio or social link.</p>
          {page.links.map((link, i) => <div className="bio-link-row" key={i}>
            <input aria-label={`Link ${i + 1} label`} placeholder="Label" maxLength={45} value={link.label} onChange={(e) => update({ links: page.links.map((item, index) => index === i ? { ...item, label: e.target.value } : item) })} />
            <input aria-label={`Link ${i + 1} URL`} placeholder="https://…" maxLength={600} value={link.url} onChange={(e) => update({ links: page.links.map((item, index) => index === i ? { ...item, url: e.target.value } : item) })} />
            <button className="btn secondary small" onClick={() => update({ links: page.links.filter((_, index) => index !== i) })}>Remove</button>
          </div>)}
          <button className="btn secondary small" disabled={page.links.length >= 10} onClick={() => update({ links: [...page.links, { label: '', url: '' }] })}>Add link</button>
        </fieldset>
        <fieldset disabled={busy}><legend>Assets</legend>
          <p className="small muted">Uploads have public file URLs. Audio plays when a visitor presses play.</p>
          <div className="bio-assets">
            {ASSETS.map(([key, label, kind]) => <div key={key}>
              <label>{label}<input type="file" accept={kind === 'audio' ? 'audio/mpeg,audio/ogg' : 'image/png,image/jpeg,image/webp'} onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                setError('');
                try { update({ [key]: await uploadBioAsset(me.id, file, kind) }); }
                catch (failure) { setError(errorMessage(failure)); }
                finally { setBusy(false); }
              }} /></label>
              {page[key] && <button className="btn secondary small" onClick={() => update({ [key]: '' })}>Remove {label.toLowerCase()}</button>}
            </div>)}
          </div>
        </fieldset>
        <fieldset disabled={busy}><legend>Appearance</legend>
          <div className="bio-colors">{COLORS.map(([key, label]) => <label key={key}>{label}<input type="color" value={page[key]} onChange={(e) => update({ [key]: e.target.value })} /></label>)}</div>
          <label>Card opacity · {page.opacity}%<input type="range" min={45} max={100} value={page.opacity} onChange={(e) => update({ opacity: e.target.valueAsNumber })} /></label>
          <label>Card blur · {page.blur}px<input type="range" min={0} max={24} value={page.blur} onChange={(e) => update({ blur: e.target.valueAsNumber })} /></label>
          <label>Layout<select value={page.layout} onChange={(e) => update({ layout: e.target.value as BioPage['layout'] })}><option value="center">Centered</option><option value="split">Split</option><option value="stack">Stacked</option></select></label>
          <label>Backdrop effect<select value={page.effect} onChange={(e) => update({ effect: e.target.value as BioPage['effect'] })}><option value="none">None</option><option value="stars">Stars</option><option value="grid">Grid</option><option value="rays">Light</option></select></label>
          <label className="bio-inline"><input type="checkbox" checked={page.glow} onChange={(e) => update({ glow: e.target.checked })} /> Name glow</label>
        </fieldset>
        <fieldset disabled={busy}><legend>Templates</legend>
          <label>Style<select value={filter} onChange={(e) => setFilter(e.target.value)}>{['All', ...new Set(BIO_TEMPLATES.map(([, , category]) => category))].map((name) => <option key={name}>{name}</option>)}</select></label>
          <div className="bio-templates">
            {BIO_TEMPLATES.filter(([, , category]) => filter === 'All' || filter === category).map(([id, name, category, background, panel, accent, text, effect]) =>
              <button key={id} className="bio-template" aria-pressed={page.template === id} onClick={() => update({ template: id, background, panel, accent, text, effect, glow: category === 'Atmospheric' || category === 'Retro', layout: category === 'Minimal' ? 'stack' : category === 'Retro' ? 'split' : 'center' })}>
                <span className={`bio-template-swatch vb-bio-${effect}`} style={{ '--bio-bg': background, '--bio-panel': panel, '--bio-accent': accent, color: text } as CSSProperties}><span aria-hidden>✦</span></span>
                <b>{name}</b><small>{category}</small>
              </button>)}
          </div>
        </fieldset>
        {published && <button className="btn secondary small" disabled={busy} onClick={() => void save('unpublish')}>Unpublish page</button>}
      </div>
      <aside className="bio-editor-preview"><h3>Live preview</h3><BioCard identity={identity} page={normalizeBio(page)} connections={connections} preview /></aside>
    </div>}
    {!ready && !error && <p role="status">Loading your bio page…</p>}
  </section>;
}
