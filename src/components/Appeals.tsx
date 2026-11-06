// Appeals (people) + the appeals queue and staff permissions (Venband staff).
// Every decision is made and checked by the database (submit_appeal,
// handle_appeal, mod_set_staff_permissions); this is only the UI.
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage, isOldSchema } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { refreshStaffPerms, STAFF_PERMS, type StaffPerm } from '../lib/staff';
import { Field, Icon, Modal } from './ui';
import { openProfile } from './People';

interface Appeal {
  id: string;
  user_id: string;
  kind: 'account' | 'theme' | 'app';
  target_ref: string | null;
  subject: string;
  message: string;
  status: 'open' | 'accepted' | 'denied';
  handled_by: string | null;
  response: string;
  created_at: string;
  handled_at: string | null;
}
const KIND_LABEL: Record<Appeal['kind'], string> = { account: 'Account restriction', theme: 'Removed Marketplace item', app: 'Disabled bot' };
const STATUS_LABEL: Record<string, string> = { limited: 'Limited', very_limited: 'Very limited', banned: 'Banned' };

function AppealForm({ title, onCancel, onSend }: { title: string; onCancel: () => void; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onCancel}>
      <Field label="Why should Venband staff take another look?" hint="Be specific — what happened, and why it was a mistake or won’t happen again. Staff can see your appeal and reply.">
        <textarea rows={6} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || text.trim().length < 10}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onSend(text.trim());
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Sending…' : 'Send appeal'}
        </button>
      </div>
    </Modal>
  );
}

/** Settings → Security → Appeals: what's restricted, appeal it, see the answers. */
export function AppealsPanel() {
  const me = sessionStore.use((s) => s.me)!;
  const [items, setItems] = useState<{ kind: Appeal['kind']; ref: string | null; name: string; detail: string }[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [available, setAvailable] = useState(true);
  const [form, setForm] = useState<{ kind: Appeal['kind']; ref: string | null; name: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const out: typeof items = [];
    const { data: prof } = await supabase.from('profiles').select('account_status').eq('id', me.id).maybeSingle();
    const status = (prof as { account_status?: string } | null)?.account_status ?? me.account_status;
    if (status && status !== 'active') out.push({ kind: 'account', ref: null, name: 'Your account', detail: STATUS_LABEL[status] ?? status });
    const themes = await supabase.from('themes').select('id, name, kind, removed_reason').eq('author_id', me.id).eq('status', 'removed');
    for (const t of (themes.data ?? []) as { id: string; name: string; kind: string; removed_reason: string | null }[])
      out.push({ kind: 'theme', ref: t.id, name: t.name, detail: `Removed${t.removed_reason ? `: ${t.removed_reason}` : ''}` });
    const apps = await supabase.from('applications').select('id, name').eq('owner_id', me.id).eq('status', 'disabled');
    for (const a of (apps.data ?? []) as { id: string; name: string }[]) out.push({ kind: 'app', ref: a.id, name: a.name, detail: 'Disabled by Venband staff' });
    setItems(out);
    const res = await supabase.from('appeals').select('*').order('created_at', { ascending: false }).limit(30);
    if (res.error) setAvailable(!isOldSchema(res.error));
    setAppeals((res.data ?? []) as Appeal[]);
  }, [me.id, me.account_status]);
  useEffect(() => {
    load();
  }, [load]);

  const open = (kind: Appeal['kind'], ref: string | null) => appeals.find((a) => a.kind === kind && a.target_ref === ref && a.status === 'open');
  return (
    <section className="settings-section" id="appeals">
      <h3>Appeals</h3>
      <p className="muted small">If Venband staff restricted your account, removed something you published or disabled your bot, you can ask them to look again.</p>
      {!available && <p className="small muted">Appeals aren’t set up on this server yet.</p>}
      {msg && <div className="notice">{msg}</div>}
      {items.length === 0 ? (
        <p className="small">Nothing of yours is restricted. 👍</p>
      ) : (
        <ul className="appeal-items">
          {items.map((it) => {
            const pending = open(it.kind, it.ref);
            return (
              <li key={`${it.kind}:${it.ref}`} className="appeal-item">
                <span className="grow">
                  <b>{it.name}</b> <span className="small muted">· {KIND_LABEL[it.kind]}</span>
                  <div className="small muted">{it.detail}</div>
                </span>
                {pending ? (
                  <span className="pill">Appeal under review</span>
                ) : (
                  <button className="btn secondary small" disabled={!available} onClick={() => setForm({ kind: it.kind, ref: it.ref, name: it.name })}>
                    Appeal
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {appeals.length > 0 && (
        <>
          <h4>Your appeals</h4>
          <ul className="appeal-history">
            {appeals.map((a) => (
              <li key={a.id} className={`appeal-row status-${a.status}`}>
                <div>
                  <b>{a.subject || KIND_LABEL[a.kind]}</b> <span className={`pill ${a.status === 'accepted' ? 'active' : a.status === 'denied' ? 'banned' : ''}`}>{a.status === 'open' ? 'Under review' : a.status === 'accepted' ? 'Accepted' : 'Denied'}</span>
                  <span className="small muted"> · {new Date(a.created_at).toLocaleDateString()}</span>
                </div>
                <div className="small">“{a.message}”</div>
                {a.response && <div className="small appeal-reply"><b>Venband staff:</b> {a.response}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {form && (
        <AppealForm
          title={`Appeal: ${form.name}`}
          onCancel={() => setForm(null)}
          onSend={async (text) => {
            const { error } = await supabase.rpc('submit_appeal', { p_kind: form.kind, p_ref: form.ref, p_message: text });
            if (error) throw error;
            setForm(null);
            setMsg('Appeal sent. You’ll get a notification when staff decide.');
            load();
          }}
        />
      )}
    </section>
  );
}

/** Venband Staff → Appeals: open appeals, oldest first; accept or deny with a reply. */
export function AppealsQueue() {
  const [status, setStatus] = useState<Appeal['status']>('open');
  const [rows, setRows] = useState<Appeal[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deciding, setDeciding] = useState<{ appeal: Appeal; accept: boolean } | null>(null);
  const [reply, setReply] = useState('');
  const load = useCallback(async () => {
    setRows(null);
    const { data, error } = await supabase.from('appeals').select('*').eq('status', status).order('created_at', { ascending: status === 'open' }).limit(100);
    if (error) return setMsg({ ok: false, text: errorMessage(error) }), setRows([]);
    const list = (data ?? []) as Appeal[];
    await loadProfiles([...new Set(list.flatMap((a) => [a.user_id, a.handled_by].filter(Boolean) as string[]))]);
    setRows(list);
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mod-center">
      <div className="mod-head">
        <h2>
          <Icon name="flag" /> Appeals
        </h2>
      </div>
      <p className="muted small">Accepting an appeal undoes the restriction (restores the account, republishes the item or re-enables the bot). Denying needs a reply — the person sees it.</p>
      <div className="tabs">
        {(['open', 'accepted', 'denied'] as const).map((s) => (
          <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : s === 'accepted' ? 'Accepted' : 'Denied'}
          </button>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'notice' : 'form-error'}>{msg.text}</div>}
      {!rows && <div className="spinner" />}
      <div className="mod-list">
        {(rows ?? []).map((a) => (
          <div key={a.id} className="mod-card">
            <div className="mod-card-head">
              <span className="pill review">{KIND_LABEL[a.kind]}</span>
              <div className="grow small">
                <b className="link-like" onClick={() => openProfile(a.user_id)}>
                  {displayName(a.user_id)}
                </b>{' '}
                <span className="muted">@{getProfile(a.user_id)?.username} · about “{a.subject}” · {new Date(a.created_at).toLocaleString()}</span>
              </div>
            </div>
            <div className="report-reason">“{a.message}”</div>
            {a.status !== 'open' && (
              <p className="small muted">
                {a.status === 'accepted' ? 'Accepted' : 'Denied'} by @{getProfile(a.handled_by ?? '')?.username ?? 'staff'}
                {a.response ? ` — “${a.response}”` : ''}
              </p>
            )}
            {a.status === 'open' && (
              <div className="mod-actions">
                <button className="btn success small" onClick={() => (setReply(''), setDeciding({ appeal: a, accept: true }))}>
                  Accept & undo
                </button>
                <button className="btn danger small" onClick={() => (setReply(''), setDeciding({ appeal: a, accept: false }))}>
                  Deny
                </button>
              </div>
            )}
          </div>
        ))}
        {rows && !rows.length && <p className="muted">Nothing here.</p>}
      </div>
      {deciding && (
        <Modal title={deciding.accept ? 'Accept appeal' : 'Deny appeal'} onClose={() => setDeciding(null)}>
          <Field label={deciding.accept ? 'Message to them (optional)' : 'Why it was denied (they’ll see this)'}>
            <textarea rows={4} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} autoFocus />
          </Field>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setDeciding(null)}>
              Cancel
            </button>
            <button
              className={`btn ${deciding.accept ? 'success' : 'danger'}`}
              disabled={!deciding.accept && reply.trim().length < 3}
              onClick={async () => {
                const { error } = await supabase.rpc('handle_appeal', { p_appeal: deciding.appeal.id, p_accept: deciding.accept, p_response: reply.trim() });
                setDeciding(null);
                if (error) return setMsg({ ok: false, text: errorMessage(error) });
                setMsg({ ok: true, text: deciding.accept ? 'Accepted — restriction lifted and they were notified.' : 'Denied — they were notified with your reply.' });
                load();
              }}
            >
              {deciding.accept ? 'Accept & undo' : 'Deny'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Owners: choose exactly what one staff member may do. */
export function StaffPermissionsModal({ userId, username, onClose }: { userId: string; username: string; onClose: () => void }) {
  const [perms, setPerms] = useState<StaffPerm[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase
      .from('profiles')
      .select('staff_permissions')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (e) return setError(isOldSchema(e) ? 'Staff permissions need the newest database update (supabase/update-2026-11.sql).' : errorMessage(e));
        const p = (data as { staff_permissions: StaffPerm[] | null } | null)?.staff_permissions ?? null;
        setCustom(p !== null);
        setPerms(p ?? []);
      });
  }, [userId]);
  const save = async (value: StaffPerm[] | null) => {
    setBusy(true);
    const { error: e } = await supabase.rpc('mod_set_staff_permissions', { p_user: userId, p_perms: value });
    setBusy(false);
    if (e) return setError(errorMessage(e));
    refreshStaffPerms();
    onClose();
  };
  return (
    <Modal title={`Staff permissions: @${username}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      {perms && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={!custom} onChange={(e) => setCustom(!e.target.checked)} />
            <span>
              <b>Use their role’s defaults</b>
              <div className="small muted">Moderators: everything except the Report Centre and appeals. Admins: everything.</div>
            </span>
          </label>
          {custom && (
            <div className="perm-list">
              {STAFF_PERMS.map((p) => (
                <label key={p.id} className="check-row">
                  <input type="checkbox" checked={perms.includes(p.id)} onChange={(e) => setPerms(e.target.checked ? [...perms, p.id] : perms.filter((x) => x !== p.id))} />
                  <span>
                    <b>{p.label}</b>
                    <div className="small muted">{p.description}</div>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy} onClick={() => save(custom ? perms : null)}>
              Save
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
