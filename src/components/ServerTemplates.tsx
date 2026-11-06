// Shareable server templates (20261106110000_server_templates.sql):
//   * TemplatesTab — Server Settings → Templates: make a template of this
//     server, copy its link, sync it, delete it.
//   * CommunityTemplatePicker — in "Create a server": use a template link /
//     code, or pick a public one.
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage, isOldSchema } from '../lib/supabase';
import { appUrl } from '../lib/supabase';
import type { ServerData } from '../hooks/data';
import { copyText } from './ContextMenu';
import { askConfirm } from './Dialogs';
import { showToast } from './Undo';
import { Field, Icon } from './ui';

export const templateLink = (code: string) => `${appUrl().replace(/\/$/, '')}/template/${code}`;
/** A template code from a pasted link or the bare code. */
export const templateCodeFrom = (text: string) => /(?:template\/)?([A-Za-z0-9]{8,16})\s*$/.exec(text.trim())?.[1] ?? null;

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  description: string;
  public: boolean;
  uses: number;
  updated_at: string;
}
interface Preview {
  code: string;
  name: string;
  description: string;
  uses: number;
  author: string;
  roles: { name: string; color: string }[];
  channels: { name: string; type: string; category: string }[];
}

export function TemplatesTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [name, setName] = useState(`${server.name} template`);
  const [description, setDescription] = useState('');
  const [isPublic, setPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: list, error: e } = await supabase.from('server_templates').select('id, code, name, description, public, uses, updated_at').eq('server_id', server.id).order('created_at');
    if (e) return setError(isOldSchema(e) ? 'Templates need the newest database update (supabase/update-2026-11.sql).' : errorMessage(e)), setRows([]);
    setRows((list ?? []) as TemplateRow[]);
  }, [server.id]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h2>Templates</h2>
      <p className="muted small">
        A template copies this server’s <b>structure</b> — roles and their permissions, categories, channels and their settings — so anyone can start a
        server just like it. Messages, members and files are never included.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="template-make">
        <Field label="Template name">
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="What it's good for" />
        </Field>
        <label className="check-inline">
          <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} /> List it in the public template gallery
        </label>
        <button
          className="btn primary small"
          disabled={busy || name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const { data: code, error: e } = await supabase.rpc('create_template', { p_server: server.id, p_name: name.trim(), p_description: description.trim(), p_public: isPublic });
            setBusy(false);
            if (e) return setError(errorMessage(e));
            copyText(templateLink(code as string));
            showToast('Template made — its link is copied.');
            load();
          }}
        >
          Make template
        </button>
      </div>
      <h3>This server’s templates</h3>
      {rows === null ? <div className="spinner small" /> : rows.length === 0 && <p className="muted small">None yet.</p>}
      <ul className="template-list">
        {(rows ?? []).map((t) => (
          <li key={t.id} className="template-row">
            <span className="grow">
              <b>{t.name}</b> {t.public && <span className="tag-soft">Public</span>}
              <div className="small muted">
                Used {t.uses} time{t.uses === 1 ? '' : 's'} · synced {new Date(t.updated_at).toLocaleDateString()}
                {t.description ? ` · ${t.description}` : ''}
              </div>
              <code className="small">{templateLink(t.code)}</code>
            </span>
            <button className="btn secondary small" onClick={() => (copyText(templateLink(t.code)), showToast('Link copied.'))}>
              <Icon name="link" size={14} /> Copy link
            </button>
            <button
              className="btn secondary small"
              title="Update the template to match the server as it is now"
              onClick={async () => {
                const { error: e } = await supabase.rpc('sync_template', { p_template: t.id });
                if (e) return setError(errorMessage(e));
                showToast('Template synced with the server.');
                load();
              }}
            >
              Sync
            </button>
            <button
              className="btn link small danger-text"
              onClick={async () => {
                if (!(await askConfirm({ title: `Delete ${t.name}?`, body: 'Its link stops working. Servers already made from it are not affected.', confirm: 'Delete', danger: true }))) return;
                const { error: e } = await supabase.from('server_templates').delete().eq('id', t.id);
                if (e) return setError(errorMessage(e));
                load();
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** In "Create a server": a template link / code, or a public template. Selected = its code. */
export function CommunityTemplatePicker({ selected, onSelect, initialCode }: { selected: string | null; onSelect: (code: string | null) => void; initialCode?: string }) {
  const [link, setLink] = useState(initialCode ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [gallery, setGallery] = useState<{ code: string; name: string; description: string; uses: number; author: string; channels: number; roles: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('template_gallery', { p_query: '' }).then(({ data, error: e }) => setGallery(e ? [] : ((data ?? []) as never)));
  }, []);
  useEffect(() => {
    const code = templateCodeFrom(link);
    if (!code) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    supabase.rpc('template_preview', { p_code: code }).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e || !data) {
        setPreview(null);
        setError(e ? errorMessage(e) : 'No template with that code.');
        return;
      }
      setError(null);
      setPreview(data as Preview);
      onSelect(code);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  return (
    <div className="community-templates">
      <Field label="Have a template link?">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="venband.com/template/AbC123xyz0" />
      </Field>
      {error && link && <div className="small danger-text">{error}</div>}
      {preview && (
        <div className={`template-preview${selected === preview.code ? ' selected' : ''}`}>
          <b>{preview.name}</b> <span className="small muted">by @{preview.author} · used {preview.uses}×</span>
          {preview.description && <div className="small">{preview.description}</div>}
          <div className="tpl-channels">
            {preview.channels.slice(0, 14).map((c, i) => (
              <span key={i} className="tpl-chan">
                <Icon name={c.type === 'voice' ? 'speaker' : c.type === 'forum' ? 'thread' : c.type === 'stage' ? 'stage' : 'hash'} size={12} /> {c.name}
              </span>
            ))}
            {preview.channels.length > 14 && <span className="small muted">+{preview.channels.length - 14} more</span>}
          </div>
          {preview.roles.length > 0 && (
            <div className="tpl-roles">
              {preview.roles.slice(0, 10).map((r, i) => (
                <span key={i} className="tpl-role">
                  <i style={{ background: r.color }} /> {r.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {gallery && gallery.length > 0 && (
        <>
          <div className="field-label">Community templates</div>
          <div className="tpl-gallery">
            {gallery.slice(0, 12).map((g) => (
              <button key={g.code} type="button" className={`template-card small${selected === g.code ? ' selected' : ''}`} onClick={() => setLink(g.code)}>
                <b>{g.name}</b>
                <span className="tpl-desc">{g.description || `${g.channels} channels · ${g.roles} roles`}</span>
                <span className="small muted">by @{g.author} · {g.uses}×</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
