// Public pages that work signed in or out: /status, /guidelines, /changelog
// and /discovery (the legal pages are in Legal.tsx). The layout is shared with
// /bots and /voogle.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, supabaseKey, supabaseUrl, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { go, type PublicPage } from '../lib/router';
import { Icon } from './ui';
import { SiteNav, type SiteSection } from './SiteNav';
import { askConfirm } from './Dialogs';
import { Select } from './Select';
import { VerifiedMark } from './Badges';
import { SCHEMA_MANIFEST } from '../lib/schemaManifest';

const REPO_URL = 'https://github.com/youragoober999-sketch/venband';

// Header sections that correspond to a public page (the rest live in the footer).
const SECTION: Partial<Record<PublicPage, SiteSection>> = { download: 'download', discovery: 'discovery', bots: 'bots', status: 'status' };

// Every public page is reachable from the footer, with plain-English labels.
const FOOTER: { page: PublicPage | 'privacy/connections' | 'policy/consumer-use'; label: string }[] = [
  { page: 'download', label: 'Download' },
  { page: 'discovery', label: 'Discover' },
  { page: 'bots', label: 'Developers' },
  { page: 'voogle', label: 'Voogle' },
  { page: 'status', label: 'Status' },
  { page: 'changelog', label: 'Changelog' },
  { page: 'privacy', label: 'Privacy' },
  { page: 'tos', label: 'Terms' },
  { page: 'guidelines', label: 'Guidelines' },
  { page: 'privacy/connections', label: 'Connections' },
  { page: 'policy/consumer-use', label: 'Consumer use' },
];

export function PublicLayout({ page, title, children, wide }: { page: PublicPage; title: string; children: ReactNode; wide?: boolean }) {
  const signedIn = sessionStore.use((s) => s.status === 'ready' && Boolean(s.me));
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Venband`;
    return () => {
      document.title = prev;
    };
  }, [title]);
  return (
    <div className="public-page">
      <SiteNav
        active={SECTION[page]}
        onLogin={() => signInThenReturn()}
        onSignup={() => signInThenReturn('register')}
        onOpenApp={signedIn ? () => go('channels/@me') : undefined}
      />
      <main className={`public-inner public-main${wide ? ' wide' : ''}`}>{children}</main>
      <footer className={`public-inner public-footer small muted${wide ? ' wide' : ''}`}>
        <span>© {new Date().getFullYear()} Venband · end-to-end encrypted chat</span>
        <nav aria-label="Footer" className="public-footer-links">
          {FOOTER.map((f) => (
            <a
              key={f.page}
              href={`${import.meta.env.BASE_URL}${f.page}`}
              aria-current={f.page === page ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(f.page);
              }}
            >
              {f.label}
            </a>
          ))}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Source code
          </a>
        </nav>
      </footer>
    </div>
  );
}

/** Sign in, then come back to this page. */
export function signInThenReturn(to: 'sign-in' | 'register' = 'sign-in') {
  try {
    sessionStorage.setItem('venband:return-to', window.location.pathname.replace(import.meta.env.BASE_URL, '') + window.location.search);
  } catch {
    /* ignore */
  }
  go(to);
}

export function SignInCard({ what }: { what: string }) {
  return (
    <div className="public-card center">
      <Icon name="lock" size={28} />
      <h2>Log in to {what}</h2>
      <p className="muted">You’ll come right back here afterwards.</p>
      <div className="row center">
        <button className="btn primary" onClick={() => signInThenReturn()}>
          Log in
        </button>
        <button className="btn secondary" onClick={() => signInThenReturn('register')}>
          Create an account
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ status --

type Health = 'ok' | 'slow' | 'down' | 'outdated' | 'unknown' | 'checking';
/** What a check can report besides "it answered": a different health and an explanation. */
interface CheckOutcome {
  health?: Health;
  note?: string;
  details?: string[];
}
interface Check {
  id: string;
  name: string;
  desc: string;
  run: () => Promise<CheckOutcome | void>;
}

/** PostgREST: the function/table isn't in the database (migration not run). */
const isMissingObject = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === 'PGRST205' || /schema cache|does not exist/i.test(e.message ?? ''));

/** Which migration files does the live database still need? (public.schema_missing) */
async function schemaCheck(): Promise<CheckOutcome> {
  const tables = SCHEMA_MANIFEST.flatMap((m) => m.tables);
  const functions = SCHEMA_MANIFEST.flatMap((m) => m.functions);
  const bodies = Object.assign({}, ...SCHEMA_MANIFEST.map((m) => m.bodies));
  const { data, error } = await supabase.rpc('schema_missing', { p_tables: tables, p_functions: functions, p_bodies: bodies });
  if (isMissingObject(error)) {
    const newest = SCHEMA_MANIFEST.find((m) => m.functions.includes('schema_missing'))?.migration;
    return {
      health: 'outdated',
      note: 'The database is older than this version of Venband.',
      details: newest ? [`Run the newest files in supabase/migrations/ (at least ${newest}) — or supabase/setup.sql on a new project.`] : [],
    };
  }
  if (error) throw error;
  const r = data as { tables: string[]; functions: string[]; bodies: string[] };
  const t = new Set(r.tables), f = new Set(r.functions), b = new Set(r.bodies);
  const files = SCHEMA_MANIFEST.filter(
    (m) => m.tables.some((x) => t.has(x)) || m.functions.some((x) => f.has(x)) || Object.keys(m.bodies).some((x) => b.has(x)),
  ).map((m) => m.migration);
  if (!files.length) return {};
  return {
    health: 'outdated',
    note: `${files.length} database update${files.length === 1 ? '' : 's'} not installed yet, so some features won’t work.`,
    details: files.map((m) => `supabase/migrations/${m}`),
  };
}

async function timed<T>(fn: () => Promise<T>, timeout = 8000): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), timeout))]);
  return { ms: Math.round(performance.now() - t0), value };
}

const CHECKS: Check[] = [
  {
    id: 'app',
    name: 'Website & app',
    desc: 'venband.com and the web app',
    run: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}site.webmanifest`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status)); // was ignored before, so the site could never show as down
    },
  },
  {
    id: 'api',
    name: 'Messages & database',
    desc: 'Sending, loading and syncing messages',
    run: async () => {
      const { error } = await supabase.rpc('status_ping');
      if (isMissingObject(error)) return { health: 'outdated', note: 'The database answers but isn’t set up for Venband yet.' };
      if (error) throw error;
    },
  },
  { id: 'schema', name: 'Database setup', desc: 'Every feature’s tables and functions are installed and current', run: schemaCheck },
  {
    id: 'auth',
    name: 'Sign in',
    desc: 'Logging in and creating accounts',
    run: async () => {
      const r = await fetch(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: supabaseKey } });
      if (!r.ok) throw new Error(String(r.status));
    },
  },
  {
    id: 'realtime',
    name: 'Live updates & calls',
    desc: 'Typing, presence, ringing and call signalling',
    run: () =>
      new Promise<void>((res, rej) => {
        const ch = supabase.channel(`status-${Math.random().toString(36).slice(2)}`);
        ch.subscribe((s) => {
          if (s === 'SUBSCRIBED') {
            supabase.removeChannel(ch);
            res();
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
            supabase.removeChannel(ch);
            rej(new Error(s));
          }
        });
      }),
  },
  {
    id: 'media',
    name: 'Files & media',
    desc: 'Encrypted attachments, server icons and emoji',
    run: async () => {
      const r = await fetch(`${supabaseUrl}/storage/v1/object/public/server-assets/status-check`, { cache: 'no-store' });
      if (r.status >= 500) throw new Error(String(r.status));
    },
  },
  {
    id: 'previews',
    name: 'Link previews',
    desc: 'Website cards under links',
    run: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}api/geo`, { cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('unavailable');
    },
  },
];

interface Incident {
  id: string;
  title: string;
  severity: 'minor' | 'major' | 'maintenance';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'scheduled';
  components: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  status_updates: { id: string; status: string; body: string; created_at: string }[];
}

const HEALTH_LABEL: Record<Health, string> = { ok: 'Operational', slow: 'Slow', down: 'Not responding', outdated: 'Needs update', unknown: 'Not available here', checking: 'Checking…' };

export function StatusPage() {
  const [results, setResults] = useState<Record<string, { health: Health; ms?: number } & CheckOutcome>>({});
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const staff = sessionStore.use((s) => ['moderator', 'admin', 'owner'].includes(s.me?.platform_role ?? 'user'));
  const [posting, setPosting] = useState<Incident | 'new' | null>(null);

  const runChecks = useCallback(async () => {
    setResults(Object.fromEntries(CHECKS.map((c) => [c.id, { health: 'checking' as Health }])));
    await Promise.all(
      CHECKS.map(async (c) => {
        try {
          const { ms, value } = await timed(c.run);
          const out = value ?? {};
          setResults((r) => ({ ...r, [c.id]: { ...out, health: out.health ?? (ms > 2500 ? 'slow' : 'ok'), ms } }));
        } catch (e) {
          setResults((r) => ({ ...r, [c.id]: { health: c.id === 'previews' && /unavailable/.test(String(e)) ? 'unknown' : 'down' } }));
        }
      }),
    );
    setCheckedAt(new Date());
  }, []);

  const loadIncidents = useCallback(async () => {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data } = await supabase
      .from('status_incidents')
      .select('*, status_updates(id, status, body, created_at)')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    setIncidents((data ?? []) as Incident[]);
  }, []);

  useEffect(() => {
    runChecks();
    loadIncidents();
    const t = setInterval(runChecks, 60_000);
    const ch = supabase
      .channel('status-incidents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status_incidents' }, loadIncidents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status_updates' }, loadIncidents)
      .subscribe();
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [runChecks, loadIncidents]);

  const active = (incidents ?? []).filter((i) => i.status !== 'resolved');
  const down = Object.values(results).some((r) => r.health === 'down' || r.health === 'outdated') || active.some((i) => i.severity === 'major');
  const degraded = Object.values(results).some((r) => r.health === 'slow') || active.length > 0;
  const overall = down ? 'down' : degraded ? 'slow' : Object.values(results).some((r) => r.health === 'checking') ? 'checking' : 'ok';

  const days = useMemo(() => {
    const out: { day: string; worst: 'ok' | 'minor' | 'major' | 'maintenance' }[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toDateString();
      let worst: 'ok' | 'minor' | 'major' | 'maintenance' = 'ok';
      for (const inc of incidents ?? []) {
        const start = new Date(inc.created_at);
        const end = inc.resolved_at ? new Date(inc.resolved_at) : new Date();
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dayEnd = new Date(dayStart.getTime() + 86400_000);
        if (start < dayEnd && end >= dayStart) {
          if (inc.severity === 'major') worst = 'major';
          else if (inc.severity === 'minor' && worst !== 'major') worst = 'minor';
          else if (worst === 'ok') worst = 'maintenance';
        }
      }
      out.push({ day: key, worst });
    }
    return out;
  }, [incidents]);

  return (
    <PublicLayout page="status" title="Status">
      <div className={`status-hero ${overall}`}>
        <span className="status-dot" />
        <div className="grow">
          <h1>{overall === 'ok' ? 'All systems operational' : overall === 'down' ? 'Some things aren’t working' : overall === 'checking' ? 'Checking…' : 'Some things are slow right now'}</h1>
          <p className="small muted">
            Checked live from your browser{checkedAt ? ` at ${checkedAt.toLocaleTimeString()}` : ''}. Refreshes every minute.
          </p>
        </div>
        <button className="btn secondary small" onClick={runChecks}>
          <Icon name="refresh" size={14} /> Check again
        </button>
      </div>

      {active.length > 0 && (
        <section className="status-active">
          {active.map((i) => (
            <IncidentCard key={i.id} i={i} staff={staff} onEdit={() => setPosting(i)} />
          ))}
        </section>
      )}

      <section className="public-card status-list">
        {CHECKS.map((c) => {
          const r = results[c.id] ?? { health: 'checking' };
          return (
            <div key={c.id} className="status-row">
              <div className="grow">
                <b>{c.name}</b>
                <div className="small muted">{c.desc}</div>
                {r.note && <div className="status-note small">{r.note}</div>}
                {!!r.details?.length && (
                  <details className="status-details small">
                    <summary>For site admins: what to run</summary>
                    <p className="muted">Paste each file into Supabase → SQL Editor → Run, in this order:</p>
                    <ol>
                      {r.details.map((d) => (
                        <li key={d}>{d.startsWith('supabase/') ? <code>{d}</code> : d}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              {r.ms !== undefined && <span className="small muted">{r.ms} ms</span>}
              <span className={`status-pill ${r.health}`}>{HEALTH_LABEL[r.health]}</span>
            </div>
          );
        })}
        <div className="status-bars" aria-label="Last 90 days">
          {days.map((d) => (
            <span key={d.day} className={`status-bar ${d.worst}`} title={`${d.day}: ${d.worst === 'ok' ? 'no incidents' : d.worst}`} />
          ))}
        </div>
        <div className="status-bars-legend small muted">
          <span>90 days ago</span>
          <span>Today</span>
        </div>
      </section>

      <section>
        <div className="row">
          <h2 className="grow">Past incidents</h2>
          {staff && (
            <button className="btn primary small" onClick={() => setPosting('new')}>
              <Icon name="plus" size={14} /> Post incident
            </button>
          )}
        </div>
        {incidents === null && <div className="spinner" />}
        {incidents?.filter((i) => i.status === 'resolved').length === 0 && <p className="muted">No incidents in the last 90 days.</p>}
        {incidents
          ?.filter((i) => i.status === 'resolved')
          .map((i) => (
            <IncidentCard key={i.id} i={i} staff={staff} onEdit={() => setPosting(i)} />
          ))}
      </section>
      {posting && <IncidentEditor incident={posting === 'new' ? null : posting} onClose={() => setPosting(null)} onSaved={loadIncidents} />}
    </PublicLayout>
  );
}

function IncidentCard({ i, staff, onEdit }: { i: Incident; staff: boolean; onEdit: () => void }) {
  const updates = [...(i.status_updates ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <article className={`public-card incident ${i.severity} ${i.status}`}>
      <div className="row">
        <h3 className="grow">{i.title}</h3>
        <span className={`status-pill ${i.status === 'resolved' ? 'ok' : i.severity === 'major' ? 'down' : 'slow'}`}>{i.status}</span>
        {staff && (
          <button className="btn link small" onClick={onEdit}>
            Update
          </button>
        )}
      </div>
      {i.components.length > 0 && <div className="small muted">Affects: {i.components.map((c) => CHECKS.find((x) => x.id === c)?.name ?? c).join(', ')}</div>}
      <ol className="incident-updates">
        {updates.map((u) => (
          <li key={u.id}>
            <b>{u.status[0].toUpperCase() + u.status.slice(1)}</b> — {u.body}
            <div className="small muted">{new Date(u.created_at).toLocaleString()}</div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function IncidentEditor({ incident, onClose, onSaved }: { incident: Incident | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(incident?.title ?? '');
  const [severity, setSeverity] = useState<string>(incident?.severity ?? 'minor');
  const [status, setStatus] = useState<string>(incident?.status === 'resolved' ? 'resolved' : incident ? 'monitoring' : 'investigating');
  const [body, setBody] = useState('');
  const [components, setComponents] = useState<string[]>(incident?.components ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="public-card incident-editor">
      <h3>{incident ? `Update: ${incident.title}` : 'Post an incident'}</h3>
      {error && <div className="form-error">{error}</div>}
      <label className="field">
        <span>Title</span>
        <input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="Messages are slow to send" />
      </label>
      <div className="row">
        <label className="field grow">
          <span>Severity</span>
          <Select value={severity} onChange={setSeverity} options={[{ value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major outage' }, { value: 'maintenance', label: 'Maintenance' }]} />
        </label>
        <label className="field grow">
          <span>Status</span>
          <Select
            value={status}
            onChange={setStatus}
            options={['investigating', 'identified', 'monitoring', 'resolved', 'scheduled'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
          />
        </label>
      </div>
      <div className="chip-row">
        {CHECKS.map((c) => (
          <button key={c.id} type="button" className={`chip${components.includes(c.id) ? ' on' : ''}`} onClick={() => setComponents((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))}>
            {c.name}
          </button>
        ))}
      </div>
      <label className="field">
        <span>What’s happening</span>
        <textarea rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="modal-actions">
        {incident && (
          <button
            className="btn danger"
            onClick={async () => {
              if (!(await askConfirm({ title: 'Delete incident', body: 'It disappears from the status page.', confirm: 'Delete', danger: true }))) return;
              await supabase.rpc('delete_status_incident', { p_incident: incident.id });
              onSaved();
              onClose();
            }}
          >
            Delete
          </button>
        )}
        <span className="grow" />
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || !body.trim() || title.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const { error } = await supabase.rpc('post_status_update', {
              p_incident: incident?.id ?? null,
              p_title: title,
              p_severity: severity,
              p_status: status,
              p_body: body,
              p_components: components,
            });
            setBusy(false);
            if (error) return setError(errorMessage(error));
            onSaved();
            onClose();
          }}
        >
          Post
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ legal pages --

function Doc({ page, title, updated, children }: { page: PublicPage; title: string; updated: string; children: ReactNode }) {
  return (
    <PublicLayout page={page} title={title}>
      <article className="public-doc">
        <h1>{title}</h1>
        <p className="small muted">Last updated {updated}</p>
        {children}
      </article>
    </PublicLayout>
  );
}

const L = ({ to, children }: { to: PublicPage; children: ReactNode }) => (
  <a
    href={`${import.meta.env.BASE_URL}${to}`}
    onClick={(e) => {
      e.preventDefault();
      go(to);
    }}
  >
    {children}
  </a>
);

export function GuidelinesPage() {
  return (
    <Doc page="guidelines" title="Community Guidelines" updated="October 6, 2026">
      <p>Venband is for hanging out with people you like. These rules apply everywhere on Venband, including private servers and DMs.</p>
      <h2>Be respectful</h2>
      <ul>
        <li>No harassment, bullying, threats or encouraging self-harm.</li>
        <li>No hate based on race, ethnicity, religion, gender, sexual orientation, disability or similar.</li>
        <li>No sharing someone’s private information without permission.</li>
      </ul>
      <h2>Keep it safe and legal</h2>
      <ul>
        <li>Never share sexual content involving minors. We report it to the authorities.</li>
        <li>No non-consensual intimate images, violent extremism, or selling illegal goods.</li>
        <li>No malware, phishing, scams, token grabbers or account trading.</li>
      </ul>
      <h2>Play fair</h2>
      <ul>
        <li>No spam, raids, or using alt accounts to get around bans or limits.</li>
        <li>Don’t impersonate other people, servers or Venband staff.</li>
        <li>Label adult content and keep it out of public spaces.</li>
      </ul>
      <p>
        Break these and you may be warned, limited or banned. See the <L to="tos">Terms of Service</L> for details.
      </p>
    </Doc>
  );
}

export const CHANGELOG: { date: string; title: string; items: string[] }[] = [
  {
    date: '2026-10-09',
    title: 'Venband apps',
    items: [
      'Venband for Windows (installer and portable), macOS and Linux with automatic updates, a tray icon, taskbar badges and venband:// links',
      'Android app (direct APK install, no store needed)',
      'A phone-style incoming call screen and bigger call buttons on phones',
      'Bigger tap targets on touch screens, plus tablet and foldable layouts',
    ],
  },
  {
    date: '2026-10-09',
    title: 'Version 1.0.1',
    items: [
      'Most-recent-wins activity priority (Discord RPC or Spotify now show whichever changed last)',
      'Fixed Spotify detection on Windows via OS media session API; legacy HTTP poller remains as fallback',
      'Composer preview and formatting alignment improvements',
      'Added email OTP + passkey unlock/auth improvements',
      'Staff "Force accept friend request" option',
    ],
  },
  {
    date: '2026-10-09',
    title: 'Version 1.0.1',
    items: [
      'Most-recent-wins activity priority (Discord RPC or Spotify now show whichever changed last)',
      'Fixed Spotify detection on Windows via OS media session API; legacy HTTP poller remains as fallback',
      'Composer preview and formatting alignment improvements',
      'Added email OTP + passkey unlock/auth improvements',
      'Staff "Force accept friend request" option',
    ],
  },
  {
    date: '2026-10-08',
    title: 'Make it yours',
    items: [
      'Profile pictures and banners with crop and zoom',
      'Animated profile frames, name fonts, gradient names and name animations',
      'Longer statuses, shown as a speech bubble',
      'Build your own nameplate and publish it — plus a Marketplace in your DMs for themes, nameplates, name styles and CSS',
      'Custom CSS with templates, an animated tutorial and safe mode',
      'Use any picture from your files as the background',
      'Group chats now hold 15 people; owners can remove people; invite links for people who aren’t your friends yet',
    ],
  },
  {
    date: '2026-10-07',
    title: 'Safer by default',
    items: [
      'Two-factor sign-in with an authenticator app; your messages only unlock after the code',
      'Security Center: log out other devices, download your data, delete your account (permanently, from Settings → My Account)',
      'Deleted servers can be restored for 7 days',
      'Hidden photo data (like GPS location) is removed before pictures are sent',
      'Link safety: warnings for fake brand sites, look-alike letters, hidden destinations and short links',
      'Server moderators get Reports (with pictures and jump-to-message), timeouts, warnings and a searchable Audit Log',
      'Server owners can remove GIFs; Venband owners can design new badges',
    ],
  },
  {
    date: '2026-10-06',
    title: 'Developers, bots, Voogle and a status page',
    items: [
      'Make bots at /bots with presets: Verification, Server management and Connect a site',
      'Paste an invite in your bot’s dashboard to add it to a server',
      'Voogle verification keeps alt accounts and ban evaders out without exposing anyone’s IP',
      'Live status page at /status, plus Terms, Privacy and Guidelines pages',
      'Public server discovery at /discovery',
    ],
  },
  {
    date: '2026-10-05',
    title: 'Servers, upgraded',
    items: [
      'Templates when creating a server, with icon and banner upload',
      'Forum, announcement and stage channels',
      'Drag and drop channels, roles and servers; server folders',
      'Invite pages and embeds, custom invite links, invite friends lists',
      'Custom emoji, GIFs, stickers and sounds; a soundboard in calls',
      'Server themes, rules, welcome screens and onboarding',
    ],
  },
  {
    date: '2026-10-04',
    title: 'Messaging',
    items: ['Reactions, threads, polls, pins and saved messages', 'Edit history and scheduled messages', 'Search with filters and a command palette', 'Link previews and better embeds'],
  },
  {
    date: '2026-10-03',
    title: 'Everyday fixes',
    items: ['Dialogs stay open while you type', 'Themed dropdowns and scrollbars', 'Softer notification sounds', 'Offline translator for 20 languages'],
  },
];

export function ChangelogPage() {
  return (
    <Doc page="changelog" title="What's new" updated={CHANGELOG[0].date}>
      {CHANGELOG.map((c) => (
        <section key={c.date} className="changelog-entry">
          <div className="small muted">{new Date(c.date + 'T12:00:00').toLocaleDateString(undefined, { dateStyle: 'long' })}</div>
          <h2>{c.title}</h2>
          <ul>
            {c.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </Doc>
  );
}

// -------------------------------------------------------- public discovery --

interface PublicServer {
  id: string;
  name: string;
  description: string;
  icon_color: string;
  icon_url: string | null;
  banner_url: string | null;
  banner_color: string | null;
  verified: boolean;
  members: number;
  categories: string[];
  vanity: string | null;
}

const CATS = ['Gaming', 'Music', 'Art', 'Education', 'Science & Tech', 'Entertainment', 'Community', 'Anime', 'Sports', 'Creators'];

export function PublicDiscovery() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [rows, setRows] = useState<PublicServer[] | null>(null);
  const signedIn = sessionStore.use((s) => s.status === 'ready' && Boolean(s.me));
  useEffect(() => {
    const t = setTimeout(() => {
      supabase.rpc('public_discover', { p_query: q.trim(), p_category: cat }).then(({ data }) => setRows((data ?? []) as PublicServer[]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, cat]);
  return (
    <PublicLayout page="discovery" title="Discover servers" wide>
      <div className="discover-hero">
        <h1>Find your community</h1>
        <p className="muted">Verified and featured servers on Venband. Every message inside is end-to-end encrypted.</p>
        <input className="search-input big" placeholder="Search servers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search servers" />
        <div className="chip-row center">
          <button className={`chip${!cat ? ' on' : ''}`} onClick={() => setCat(null)}>
            All
          </button>
          {CATS.map((c) => (
            <button key={c} className={`chip${cat === c ? ' on' : ''}`} onClick={() => setCat(cat === c ? null : c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {rows === null && <div className="spinner" />}
      {rows?.length === 0 && <p className="muted center">No servers match.</p>}
      <div className="public-grid">
        {rows?.map((s) => (
          <article key={s.id} className="public-server" data-server-id={s.id}>
            <div className="ps-banner" style={s.banner_url ? { backgroundImage: `url(${s.banner_url})` } : { background: s.banner_color ?? s.icon_color }} />
            <div className="ps-body">
              {s.icon_url ? <img className="ps-icon" src={s.icon_url} alt="" /> : <span className="ps-icon" style={{ background: s.icon_color }}>{s.name.slice(0, 2).toUpperCase()}</span>}
              <h3>
                {s.name} {s.verified && <VerifiedMark size={16} />}
              </h3>
              <p className="small muted ps-desc">{s.description || 'No description yet.'}</p>
              <div className="row small muted">
                <span>
                  <span className="dot online" /> {s.members.toLocaleString()} members
                </span>
                {s.categories.slice(0, 2).map((c) => (
                  <span key={c} className="chip small">
                    {c}
                  </span>
                ))}
              </div>
              <button
                className="btn success full"
                onClick={async () => {
                  if (!signedIn) return signInThenReturn('register');
                  const { data, error } = await supabase.rpc('join_discoverable', { p_server: s.id });
                  if (error) return alertError(error);
                  go(`channels/${data as string}`);
                }}
              >
                {signedIn ? 'Join' : 'Sign up to join'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </PublicLayout>
  );
}

function alertError(e: unknown) {
  askConfirm({ title: "Couldn't join", body: errorMessage(e), confirm: 'OK' });
}
