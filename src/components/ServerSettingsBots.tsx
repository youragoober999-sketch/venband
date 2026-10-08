// Server Settings → Integrations (bots, requests) and → Voogle.
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { displayName, loadProfiles } from '../lib/directory';
import { has, P } from '../lib/permissions';
import { go } from '../lib/router';
import type { ServerData } from '../hooks/data';
import { APP_COLUMNS, PRESETS, useServerBots, type Application, type Preset } from '../lib/bots';
import { isTopStaff, sessionStore } from '../lib/session';
import type { VoogleSettings } from '../lib/voogle';
import { BotInstallSettings, PresetLogo } from './Apps';
import { VoogleLogo } from './Voogle';
import { Select } from './Select';
import { Field, Icon } from './ui';

export function IntegrationsTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const can = has(data.myPermissions, P.MANAGE_INTEGRATIONS) || isTopStaff(sessionStore.use((s) => s.me));
  const [version, setVersion] = useState(0);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | Preset>('all');
  const bots = useServerBots(server.id, version);
  const [apps, setApps] = useState<Record<string, Application>>({});
  const [requests, setRequests] = useState<{ id: string; app_id: string; requested_by: string; created_at: string; app?: Application }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<DirectoryRow[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const loadDirectory = useCallback(async () => {
    const { data, error } = await supabase.rpc('bot_directory', { p_server: server.id });
    if (error) return setError(errorMessage(error));
    setDirectory((data ?? []) as DirectoryRow[]);
  }, [server.id]);
  useEffect(() => {
    loadDirectory();
  }, [loadDirectory, version]);

  async function addBot(a: DirectoryRow) {
    setAdding(a.id);
    setError(null);
    const { error } = await supabase.rpc('bot_add_to_server', { p_app: a.id, p_server: server.id });
    setAdding(null);
    if (error) return setError(errorMessage(error));
    setVersion((v) => v + 1);
    loadDirectory();
  }

  const loadRequests = useCallback(async () => {
    const { data: rows } = await supabase.from('bot_join_requests').select('id, app_id, requested_by, created_at').eq('server_id', server.id);
    const list = (rows ?? []) as { id: string; app_id: string; requested_by: string; created_at: string }[];
    await loadProfiles(list.map((r) => r.requested_by));
    // the bot isn't in this server yet, so its name comes with the request
    const { data: a } = list.length ? await supabase.rpc('pending_bot_apps', { p_server: server.id }) : { data: [] };
    const byId = new Map(((a ?? []) as Application[]).map((x) => [x.id, x]));
    setRequests(list.map((r) => ({ ...r, app: byId.get(r.app_id) })));
  }, [server.id]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests, version]);
  useEffect(() => {
    if (!bots.length) return setApps({});
    supabase
      .from('applications')
      .select(APP_COLUMNS)
      .in('id', bots.map((b) => b.app_id))
      .then(({ data: rows }) => setApps(Object.fromEntries(((rows ?? []) as Application[]).map((a) => [a.id, a]))));
  }, [bots]);

  return (
    <div className="settings-section">
      <p className="small muted">
        Bots can’t read end-to-end encrypted messages. What they post is plain text and marked with a BOT tag. Make your own at{' '}
        <a
          href={`${import.meta.env.BASE_URL}bots`}
          onClick={(e) => {
            e.preventDefault();
            go('bots');
          }}
        >
          www.venband.com/bots
        </a>
        .
      </p>
      {error && <div className="form-error">{error}</div>}
      <h3>Bot Directory</h3>
      <p className="small muted">
        Every bot you can add to {server.name}, most-used first. The official Venband bot is pinned on top.
      </p>
      {directory === null ? (
        <div className="spinner" />
      ) : (
        <>
          <input
            className="search-input"
            placeholder={`Search ${directory.length} bots…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search bots"
          />
          <div className="filter-chips">
            <button className={kind === 'all' ? 'filter-chip on' : 'filter-chip'} onClick={() => setKind('all')}>
              All
            </button>
            {PRESETS.map((p) => (
              <button key={p.id} className={kind === p.id ? 'filter-chip on' : 'filter-chip'} onClick={() => setKind(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
          {directory.length === 0 ? (
            <p className="muted small">No bots to add right now.</p>
          ) : (
            (() => {
              const query = q.trim().toLowerCase();
              const filtered = directory.filter(
                (a) =>
                  (kind === 'all' || a.preset === kind) &&
                  (!query ||
                    a.name.toLowerCase().includes(query) ||
                    a.description?.toLowerCase().includes(query) ||
                    PRESETS.find((p) => p.id === a.preset)?.name.toLowerCase().includes(query))
              );
              if (!filtered.length)
                return <p className="muted small">No bots match “{q}”. Try another search or filter.</p>;
              return filtered.map((a) => (
                <div key={a.id} className="integration-row">
                  {a.preset ? <PresetLogo preset={a.preset} color={a.color} size={36} /> : <Icon name="bot" />}
                  <div className="grow">
                    <b>
                      {a.name} {a.preset === 'venband' && <span className="tag-soft accent">Official</span>}
                    </b>
                    <div className="small muted">
                      {PRESETS.find((p) => p.id === a.preset)?.name} · in {a.installs} server{a.installs === 1 ? '' : 's'}
                      {a.description ? ` · ${a.description}` : ''}
                    </div>
                  </div>
                  {a.installed ? (
                    <span className="pill">Added</span>
                  ) : a.requested ? (
                    <span className="pill">Requested</span>
                  ) : (
                    <button className="btn primary small" disabled={!can || adding === a.id} onClick={() => addBot(a)}>
                      {adding === a.id ? 'Adding…' : 'Add'}
                    </button>
                  )}
                </div>
              ));
            })()
          )}
        </>
      )}
      {requests.length > 0 && (
        <>
          <h3>Requests</h3>
          {requests.map((r) => (
            <div key={r.id} className="integration-row">
              {r.app ? <PresetLogo preset={r.app.preset} color={r.app.color} size={36} /> : <Icon name="bot" />}
              <div className="grow">
                <b>{r.app?.name ?? 'A bot'}</b>
                <div className="small muted">
                  {PRESETS.find((p) => p.id === r.app?.preset)?.name} · requested by {displayName(r.requested_by)}
                </div>
              </div>
              {can && (
                <>
                  <button
                    className="btn success small"
                    onClick={async () => {
                      const { error } = await supabase.rpc('review_bot_request', { p_request: r.id, p_approve: true });
                      setError(error ? errorMessage(error) : null);
                      setVersion((v) => v + 1);
                    }}
                  >
                    Add bot
                  </button>
                  <button className="btn secondary small" onClick={() => supabase.rpc('review_bot_request', { p_request: r.id, p_approve: false }).then(() => setVersion((v) => v + 1))}>
                    Decline
                  </button>
                </>
              )}
            </div>
          ))}
        </>
      )}
      <h3>Bots in {server.name}</h3>
      {bots.length === 0 && <p className="muted small">No bots yet. Paste this server’s invite in a bot’s dashboard to add it.</p>}
      {bots.map((b) => {
        const app = apps[b.app_id];
        return (
          <div key={b.id} className="integration-card">
            <div className="integration-row">
              {app ? <PresetLogo preset={app.preset} color={app.color} size={36} /> : <Icon name="bot" />}
              <div className="grow">
                <b>{app?.name ?? 'Bot'}</b>
                <div className="small muted">
                  {PRESETS.find((p) => p.id === app?.preset)?.name} · added {new Date(b.created_at).toLocaleDateString()}
                  {b.added_by ? ` by ${displayName(b.added_by)}` : ''}
                </div>
              </div>
              {can && app && (
                <button className="btn secondary small" onClick={() => setOpen(open === b.id ? null : b.id)}>
                  {open === b.id ? 'Close' : 'Settings'}
                </button>
              )}
            </div>
            {open === b.id && app && <BotInstallSettings install={b} app={app} onChanged={() => setVersion((v) => v + 1)} />}
          </div>
        );
      })}
    </div>
  );
}

interface DirectoryRow extends Application {
  installs: number;
  installed: boolean;
  requested: boolean;
}

interface Pending {
  user_id: string;
  score: number;
  updated_at: string;
}

export function VoogleTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const [s, setS] = useState<VoogleSettings>({ max_accounts: 3, block_ban_evasion: true, min_account_days: 0, review_at: 70, ...(server.voogle ?? { enabled: false }) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const loadPending = useCallback(async () => {
    const { data: rows } = await supabase.from('voogle_verifications').select('user_id, score, updated_at').eq('server_id', server.id).eq('result', 'review').order('updated_at');
    await loadProfiles(((rows ?? []) as Pending[]).map((r) => r.user_id));
    setPending((rows ?? []) as Pending[]);
  }, [server.id]);
  useEffect(() => {
    loadPending();
  }, [loadPending]);
  const roles = data.roles.filter((r) => !r.is_default);
  return (
    <div className="settings-section">
      <div className="voogle-banner">
        <VoogleLogo size={44} />
        <div>
          <b>Voogle verification</b>
          <div className="small muted">Stops alt accounts, raids and ban evasion. Nobody — not even you — sees members’ IPs or devices.</div>
        </div>
      </div>
      {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
      <label className="check-row">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> <b>Use Voogle in this server</b>
      </label>
      {s.enabled && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={Boolean(s.required)} onChange={(e) => setS({ ...s, required: e.target.checked })} /> New members must verify before they can talk
          </label>
          <Field label="Give verified members a role">
            <Select value={s.role_id ?? ''} onChange={(v) => setS({ ...s, role_id: v || undefined })} options={[{ value: '', label: 'No role' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]} />
          </Field>
          <Field label="Accounts allowed per device or network" hint="Verification is blocked when more accounts than this have already verified from the same device or network.">
            <input type="number" min={1} max={10} value={s.max_accounts ?? 3} onChange={(e) => setS({ ...s, max_accounts: Number(e.target.value) })} />
          </Field>
          <Field label="Minimum account age (days)">
            <input type="number" min={0} max={365} value={s.min_account_days ?? 0} onChange={(e) => setS({ ...s, min_account_days: Number(e.target.value) })} />
          </Field>
          <Field label="Send to moderators at risk score" hint="0–100. Lower is stricter.">
            <input type="number" min={10} max={100} value={s.review_at ?? 70} onChange={(e) => setS({ ...s, review_at: Number(e.target.value) })} />
          </Field>
          <label className="check-row">
            <input type="checkbox" checked={s.block_ban_evasion !== false} onChange={(e) => setS({ ...s, block_ban_evasion: e.target.checked })} /> Block accounts linked to someone banned here
          </label>
        </>
      )}
      <div className="modal-actions">
        <button className="btn secondary" onClick={() => go(`voogle`)}>
          <Icon name="search" size={14} /> Look up alts
        </button>
        <span className="grow" />
        <button
          className="btn primary"
          onClick={async () => {
            const { data: v, error } = await supabase.rpc('set_voogle_settings', { p_server: server.id, p_settings: s });
            if (error) return setMsg({ ok: false, text: errorMessage(error) });
            setS(v as VoogleSettings);
            setMsg({ ok: true, text: 'Saved' });
            data.reload();
          }}
        >
          Save
        </button>
      </div>
      {pending.length > 0 && (
        <>
          <h3>Waiting for review</h3>
          {pending.map((p) => (
            <div key={p.user_id} className="integration-row">
              <div className="grow">
                <b>{displayName(p.user_id)}</b> <span className="small muted">risk {p.score}</span>
              </div>
              <button className="btn success small" onClick={() => supabase.rpc('voogle_review', { p_server: server.id, p_user: p.user_id, p_approve: true }).then(loadPending)}>
                Approve
              </button>
              <button className="btn danger small" onClick={() => supabase.rpc('voogle_review', { p_server: server.id, p_user: p.user_id, p_approve: false }).then(loadPending)}>
                Deny
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
