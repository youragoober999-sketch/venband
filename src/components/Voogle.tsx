// /voogle — verification against alt accounts, raids and ban evasion.
// Verifying: ?server=<id>. Lookups: moderators of servers with Voogle on, and
// Venband staff. Results are confidence labels only — never IPs or devices.
import { useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { go } from '../lib/router';
import { voogleVerify, type VoogleResult } from '../lib/voogle';
import { Avatar, Icon } from './ui';
import { Select } from './Select';
import { PublicLayout, SignInCard } from './PublicPages';

export function VoogleLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="voogle-logo">
      <defs>
        <linearGradient id="vg-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4fd1c5" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path d="M24 3 7 10v11c0 11 7.3 20.6 17 24 9.7-3.4 17-13 17-24V10L24 3z" fill="url(#vg-a)" />
      <path d="M15 17h5l4 11 4-11h5l-7 17h-4z" fill="#fff" />
    </svg>
  );
}

export function VooglePage() {
  const signedIn = sessionStore.use((s) => s.status === 'ready' && Boolean(s.me));
  const loading = sessionStore.use((s) => s.status === 'loading');
  const serverId = new URLSearchParams(window.location.search).get('server');
  return (
    <PublicLayout page="voogle" title="Voogle">
      <div className="voogle-hero">
        <VoogleLogo size={72} />
        <div>
          <h1>Voogle</h1>
          <p className="muted">Keeps alt accounts, raiders and ban evaders out of your server — without ever showing anyone’s IP address or device.</p>
        </div>
      </div>
      {serverId && (loading ? <div className="spinner" /> : signedIn ? <VerifyPanel serverId={serverId} /> : <SignInCard what="verify" />)}
      {!serverId && signedIn && <LookupPanel />}
      <section className="voogle-how">
        <div className="public-card">
          <Icon name="shield" size={22} />
          <h3>How verifying works</h3>
          <p className="small muted">
            Click Verify. Voogle compares a random token stored in your browser, a scrambled summary of your browser and your network with accounts that verified
            before. Everything is hashed with a secret first, so the values can’t be read back.
          </p>
        </div>
        <div className="public-card">
          <Icon name="users" size={22} />
          <h3>What moderators see</h3>
          <p className="small muted">
            Only “99% sure alt” or “Likely alt”, and only for accounts connected to their own server. Never IPs, locations, devices or why accounts look related.
          </p>
        </div>
        <div className="public-card">
          <Icon name="settings" size={22} />
          <h3>Add it to your server</h3>
          <p className="small muted">Server Settings → Voogle: require verification, give a role, block more than N accounts per device or network, and stop ban evasion.</p>
          <button className="btn secondary small" onClick={() => go('bots')}>
            Make a verification bot
          </button>
        </div>
      </section>
    </PublicLayout>
  );
}

function VerifyPanel({ serverId }: { serverId: string }) {
  const [server, setServer] = useState<{ name: string; member: boolean; enabled: boolean } | null | undefined>(undefined);
  const [result, setResult] = useState<VoogleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase
      .from('servers')
      .select('name, voogle')
      .eq('id', serverId)
      .maybeSingle()
      .then(({ data }) => setServer(data ? { name: data.name as string, member: true, enabled: Boolean((data.voogle as { enabled?: boolean })?.enabled) } : null));
    supabase
      .from('voogle_verifications')
      .select('result, reason')
      .eq('server_id', serverId)
      .maybeSingle()
      .then(({ data }) => data && setResult(data as VoogleResult));
  }, [serverId]);
  if (server === undefined) return <div className="spinner" />;
  if (!server)
    return (
      <div className="public-card center">
        <h2>Join the server first</h2>
        <p className="muted">Open the invite link you were given, then come back here.</p>
      </div>
    );
  return (
    <div className="public-card verify-card center">
      <div className="small muted">Verify for</div>
      <h2>{server.name}</h2>
      {!server.enabled && <p className="muted">This server doesn’t use Voogle.</p>}
      {error && <div className="form-error">{error}</div>}
      {result?.result === 'passed' && (
        <div className="verify-result passed">
          <Icon name="check" size={28} />
          <b>You’re verified</b>
          <button className="btn primary" onClick={() => go(`channels/${serverId}`)}>
            Back to {server.name}
          </button>
        </div>
      )}
      {result?.result === 'review' && (
        <div className="verify-result review">
          <Icon name="clock" size={28} />
          <b>A moderator will take a quick look</b>
          <span className="small muted">You’ll be able to talk as soon as they approve.</span>
        </div>
      )}
      {result?.result === 'blocked' && (
        <div className="verify-result blocked">
          <Icon name="x" size={28} />
          <b>Verification didn’t pass</b>
          <span className="small muted">{result.reason || 'Ask the server’s moderators for help.'}</span>
        </div>
      )}
      {server.enabled && result?.result !== 'passed' && (
        <button
          className="btn success big"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await voogleVerify(serverId));
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Checking…' : result ? 'Try again' : 'Verify me'}
        </button>
      )}
      <p className="small muted">By verifying you agree that Voogle may store one-way hashes of your browser and network to protect this server.</p>
    </div>
  );
}

interface Lookup {
  risk: { score: number; risk: 'low' | 'medium' | 'high'; likely_alts: number; linked_to_banned: boolean };
  alts: { id: string; username: string; display_name: string | null; avatar_color: string; confidence: string; level: string; banned: boolean; banned_here: boolean; in_server: boolean }[];
  hidden: number;
  verification: { result: string; score: number; updated_at: string } | null;
}

function LookupPanel() {
  const me = sessionStore.use((s) => s.me)!;
  const staff = ['moderator', 'admin', 'owner'].includes(me.platform_role ?? 'user');
  const [servers, setServers] = useState<{ id: string; name: string }[]>([]);
  const [server, setServer] = useState('');
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    supabase
      .from('servers')
      .select('id, name, voogle')
      .then(({ data }) => {
        const list = ((data ?? []) as { id: string; name: string; voogle: { enabled?: boolean } }[]).filter((s) => s.voogle?.enabled);
        setServers(list);
        if (list[0]) setServer((s) => s || list[0].id);
      });
  }, []);
  if (!staff && servers.length === 0)
    return (
      <div className="public-card">
        <h3>Look up alts</h3>
        <p className="small muted">Turn on Voogle in one of your servers (Server Settings → Voogle) to look up likely alt accounts of its members.</p>
      </div>
    );
  return (
    <div className="public-card lookup-card">
      <h3>Look up alts</h3>
      <div className="row wrap">
        <Select
          value={server}
          onChange={setServer}
          options={[...(staff ? [{ value: '', label: 'All of Venband (staff)' }] : []), ...servers.map((s) => ({ value: s.id, label: s.name }))]}
          ariaLabel="Server"
        />
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="User ID or @username" aria-label="User" />
        <button
          className="btn primary"
          disabled={!q.trim()}
          onClick={async () => {
            setError(null);
            setRes(null);
            let id = q.trim();
            let name = id;
            if (!/^[0-9a-f-]{36}$/i.test(id)) {
              const { data } = await supabase.rpc('find_user', { p_username: id.replace(/^@/, '') });
              const u = (data as { id: string; username: string }[] | null)?.[0];
              if (!u) return setError('No one has that username.');
              id = u.id;
              name = `@${u.username}`;
            }
            const { data, error } = await supabase.rpc('voogle_lookup', { p_user: id, p_server: server || null });
            if (error) return setError(errorMessage(error));
            setTarget({ id, name });
            setRes(data as Lookup);
          }}
        >
          <Icon name="search" size={14} /> Look up
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {res && target && (
        <div className="lookup-result">
          <div className={`risk-badge ${res.risk.risk}`}>
            <span className="risk-score">{res.risk.score}</span>
            <div>
              <b>{res.risk.risk === 'high' ? 'High risk' : res.risk.risk === 'medium' ? 'Some risk' : 'Low risk'}</b>
              <div className="small muted">
                {target.name}
                {res.risk.linked_to_banned && ' · linked to a banned account'}
                {res.verification && ` · Voogle: ${res.verification.result}`}
              </div>
            </div>
          </div>
          {res.alts.length === 0 && <p className="muted small">No likely alt accounts{res.hidden ? ' in this server' : ''}.</p>}
          {res.alts.map((a) => (
            <div key={a.id} className="alt-row">
              <Avatar profile={{ display_name: a.display_name ?? a.username, avatar_color: a.avatar_color }} size={32} />
              <div className="grow">
                <b>{a.display_name ?? a.username}</b> <span className="small muted">@{a.username}</span>
                <div className="small muted">
                  {a.in_server && 'In this server · '}
                  {a.banned_here && 'Banned here · '}
                  {a.banned && 'Banned from Venband · '}
                  <code className="small">{a.id}</code>
                </div>
              </div>
              <span className={`alt-chip l${a.level}`}>{a.confidence}</span>
            </div>
          ))}
          {res.hidden > 0 && <p className="small muted">+ {res.hidden} more likely alt{res.hidden === 1 ? '' : 's'} elsewhere on Venband (hidden for privacy).</p>}
        </div>
      )}
    </div>
  );
}
