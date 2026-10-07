// Server Settings → Integrations (bots, requests) and → Voogle.
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { displayName, loadProfiles } from '../lib/directory';
import { has, P } from '../lib/permissions';
import { go } from '../lib/router';
import type { ServerData } from '../hooks/data';
import { APP_COLUMNS, PRESETS, useServerBots, type Application } from '../lib/bots';
import type { VoogleSettings } from '../lib/voogle';
import { BotInstallSettings, PresetLogo } from './Apps';
import { VoogleLogo } from './Voogle';
import { Select } from './Select';
import { Field, Icon } from './ui';

export function IntegrationsTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const can = has(data.myPermissions, P.MANAGE_INTEGRATIONS);
  const [version, setVersion] = useState(0);
  const bots = useServerBots(server.id, version);
  const [apps, setApps] = useState<Record<string, Application>>({});
  const [requests, setRequests] = useState<{ id: string; app_id: string; requested_by: string; created_at: string; app?: Application }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
