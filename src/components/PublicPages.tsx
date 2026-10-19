// Public pages that work signed in or out: /status, /tos, /privacy,
// /guidelines, /changelog and /discovery. The layout is shared with
// /bots and /voogle.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, supabaseKey, supabaseUrl, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { go, type PublicPage } from '../lib/router';
import { Icon, Wordmark } from './ui';
import { askConfirm } from './Dialogs';
import { Select } from './Select';
import { VerifiedMark } from './Badges';

const REPO_URL = 'https://github.com/youragoober999-sketch/venband';

const NAV: { page: PublicPage; label: string }[] = [
  { page: 'download', label: 'Download' },
  { page: 'discovery', label: 'Discover' },
  { page: 'bots', label: 'Developers' },
  { page: 'voogle', label: 'Voogle' },
  { page: 'status', label: 'Status' },
  { page: 'tos', label: 'Terms' },
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
      <header className="public-nav">
        <div className={`public-inner${wide ? ' wide' : ''}`}>
          <a
            className="public-brand"
            href={import.meta.env.BASE_URL}
            onClick={(e) => {
              e.preventDefault();
              go('');
            }}
          >
            <Wordmark />
          </a>
          <nav aria-label="Site" className="public-links">
            {NAV.map((n) => (
              <a
                key={n.page}
                href={`${import.meta.env.BASE_URL}${n.page}`}
                className={n.page === page ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  go(n.page);
                }}
              >
                {n.label}
              </a>
            ))}
          </nav>
          {signedIn ? (
            <button className="btn primary small" onClick={() => go('channels/@me')}>
              Open Venband
            </button>
          ) : (
            <span className="row">
              <button className="btn ghost small" onClick={() => signInThenReturn()}>
                Log in
              </button>
              <button className="btn primary small" onClick={() => signInThenReturn('register')}>
                Sign up
              </button>
            </span>
          )}
        </div>
      </header>
      <main className={`public-inner public-main${wide ? ' wide' : ''}`}>{children}</main>
      <footer className="public-inner public-footer small muted">
        <span>© {new Date().getFullYear()} Venband · end-to-end encrypted chat</span>
        {(['download', 'discovery', 'privacy', 'guidelines', 'changelog', 'status'] as PublicPage[]).map((p) => (
          <a
            key={p}
            href={`${import.meta.env.BASE_URL}${p}`}
            onClick={(e) => {
              e.preventDefault();
              go(p);
            }}
          >
            {p[0].toUpperCase() + p.slice(1)}
          </a>
        ))}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source code
        </a>
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

type Health = 'ok' | 'slow' | 'down' | 'unknown' | 'checking';
interface Check {
  id: string;
  name: string;
  desc: string;
  run: () => Promise<void>;
}

async function timed<T>(fn: () => Promise<T>, timeout = 8000): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), timeout))]);
  return { ms: Math.round(performance.now() - t0), value };
}

const CHECKS: Check[] = [
  { id: 'app', name: 'Website & app', desc: 'venband.com and the web app', run: async () => void (await fetch(`${import.meta.env.BASE_URL}site.webmanifest`, { cache: 'no-store' })).ok },
  {
    id: 'api',
    name: 'Messages & database',
    desc: 'Sending, loading and syncing messages',
    run: async () => {
      const { error } = await supabase.rpc('status_ping');
      if (error) throw error;
    },
  },
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

const HEALTH_LABEL: Record<Health, string> = { ok: 'Operational', slow: 'Slow', down: 'Not responding', unknown: 'Not available here', checking: 'Checking…' };

export function StatusPage() {
  const [results, setResults] = useState<Record<string, { health: Health; ms?: number }>>({});
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const staff = sessionStore.use((s) => ['moderator', 'admin', 'owner'].includes(s.me?.platform_role ?? 'user'));
  const [posting, setPosting] = useState<Incident | 'new' | null>(null);

  const runChecks = useCallback(async () => {
    setResults(Object.fromEntries(CHECKS.map((c) => [c.id, { health: 'checking' as Health }])));
    await Promise.all(
      CHECKS.map(async (c) => {
        try {
          const { ms } = await timed(c.run);
          setResults((r) => ({ ...r, [c.id]: { health: ms > 2500 ? 'slow' : 'ok', ms } }));
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
  const down = Object.values(results).some((r) => r.health === 'down') || active.some((i) => i.severity === 'major');
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

export function TermsPage() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return (
    <Doc page="tos" title="Terms of Service" updated="October 19, 2026">
      <p>
        These Terms of Service (“Terms”) govern your access to and use of Venband (the website at venband.com and any subdomains, our web, desktop and mobile apps,
        and our APIs; collectively the “Service”). By creating an account or using the Service you agree to these Terms. If you do not agree, do not use Venband.
      </p>
      <h2 id="eligibility">1. Eligibility and age</h2>
      <ul>
        <li>You must be at least 13 years old, or the minimum age required by the law where you live, whichever is higher. Some features or linked services may require you to be older.</li>
        <li>If you are under 18, you confirm that a parent or guardian has reviewed and agreed to these Terms on your behalf where required by law.</li>
        <li>You must not be barred from using the Service under applicable law or by a prior ban.</li>
      </ul>
      <h2 id="accounts">2. Your account</h2>
      <ul>
        <li>You are responsible for keeping your password, recovery code and devices secure. Because messages are end-to-end encrypted, Venband cannot recover your password, recovery code or private keys.</li>
        <li>You may have a reasonable number of accounts, but you may not use additional accounts to evade a ban, limit, block, rate limit or moderation action.</li>
        <li>You must provide accurate information when required and keep your account secure. Notify us promptly of any unauthorized use.</li>
        <li>We may require email verification, additional checks or restrictions to protect the Service and other users.</li>
      </ul>
      <h2 id="acceptable-use">3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Harass, threaten, stalk, dox, or encourage harm to any person.</li>
        <li>Share sexual content involving minors, non-consensual intimate images, or content that exploits or endangers children.</li>
        <li>Post hate speech, extremist propaganda, or content that incites violence.</li>
        <li>Share malware, phishing links, scams, token grabbers, or attempt to steal accounts or credentials.</li>
        <li>Spam, raid, flood, or abuse the Service or its APIs, including attempts to bypass rate limits.</li>
        <li>Impersonate other people, servers, or Venband staff.</li>
        <li>Reverse engineer, probe, or attack our systems except through our responsible disclosure process.</li>
        <li>Use the Service to violate any law, third-party right, or the terms of a linked platform.</li>
      </ul>
      <p>Server owners may set additional rules; you must also follow the rules of any server you join.</p>
      <h2 id="content">4. Your content</h2>
      <p>
        You retain ownership of the content you post. You grant Venband a worldwide, non-exclusive, royalty-free license to store, process, transmit and display your content
        as needed to operate and improve the Service. Messages are end-to-end encrypted; Venband cannot read their contents. Reports you submit may include the reported
        messages so moderators can review them.
      </p>
      <p>
        You must follow the <L to="guidelines">Community Guidelines</L>. Venband and server owners may remove content that violates these Terms or their rules.
      </p>
      <h2 id="media">5. GIFs, emoji and media</h2>
      <p>
        GIF search is provided by third parties and server owners may upload emoji, GIFs, stickers and sounds. Server owners or founders may remove media from their
        server. Venband may remove media that violates these Terms anywhere on the Service.
      </p>
      <h2 id="servers">6. Servers and moderation</h2>
      <ul>
        <li>Server owners are responsible for moderating their servers and setting their own rules on top of these Terms.</li>
        <li>Venband may limit, suspend or remove accounts, servers or content that violate these Terms, and may review reported content.</li>
        <li>If you believe we made an error, you may appeal using the notice on your account or server.</li>
      </ul>
      <h2 id="bots">7. Bots, API and Voogle</h2>
      <ul>
        <li>Keep bot tokens, webhook URLs and API credentials secret. Anyone who has them can act as your bot.</li>
        <li>Bots cannot read end-to-end encrypted messages. Do not trick users into sharing messages or keys with a bot.</li>
        <li>Do not use the API to spam, scrape profiles, evade rate limits, or circumvent security.</li>
        <li>Voogle verification must only be used to protect servers from alternate accounts, raids and ban evasion — never to track people.</li>
      </ul>
      <h2 id="third-party">8. Third-party services and linked accounts</h2>
      <p>
        The Service may let you link accounts from third-party platforms such as YouTube, TikTok, Twitch, Steam, Roblox, Spotify, Discord, GitHub, Xbox, Instagram and Epic.
        When you link an account, you authorize Venband to access the information and permissions you approve through that platform’s authorization screen. Your use of
        each linked platform remains subject to that platform’s own terms and privacy policy. Venband is not affiliated with or endorsed by those platforms. You may unlink
        an account at any time from Settings.
      </p>
      <h2 id="security">9. Security</h2>
      <p>
        Do not attempt to gain unauthorized access to accounts, servers or systems. If you discover a security vulnerability, report it privately through our security
        advisory process instead of exploiting it.
      </p>
      <h2 id="ip">10. Open source and intellectual property</h2>
      <p>
        Venband’s source code is published under the MIT license. The license covers the code; it does not grant rights to other users’ content or accounts. You may not
        use Venband’s name, logos or branding without permission.
      </p>
      <h2 id="privacy">11. Privacy</h2>
      <p>
        Our <L to="privacy">Privacy Policy</L> explains what we store and how we protect it. By using the Service you agree to that policy.
      </p>
      <h2 id="disclaimer">12. No warranty</h2>
      <p>
        Venband is provided “as is” and “as available.” We work hard to keep it running and secure, but we cannot guarantee uninterrupted, error-free or secure service.
        To the fullest extent permitted by law, we disclaim all warranties, express or implied.
      </p>
      <h2 id="liability">13. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Venband and its contributors are not liable for indirect, incidental, special, consequential or punitive damages, or for
        loss of data, profits or goodwill, arising from your use of the Service. Our total liability for any claim is limited to the amount you paid us, if any, in the
        twelve months before the claim.
      </p>
      <h2 id="termination">14. Suspension and termination</h2>
      <p>
        We may suspend or terminate your account or access to the Service if you violate these Terms, create risk or legal exposure, or to protect other users. You may
        delete your account at any time from Settings. Provisions that by their nature should survive will survive termination.
      </p>
      <h2 id="changes">15. Changes to these Terms</h2>
      <p>
        We may update these Terms. We will change the date above and, for material changes, notify you in the app or by other reasonable means. Your continued use of the
        Service after a change means you accept the updated Terms.
      </p>
      <h2 id="contact">16. Contact</h2>
      <p>
        Questions about these Terms? Open an issue on our <a href={REPO_URL}>source code repository</a>.
      </p>
      <p className="small muted">See also the <L to="privacy">Privacy Policy</L> and <L to="guidelines">Community Guidelines</L>.</p>
    </Doc>
  );
}

export function PrivacyPage() {
  return (
    <Doc page="privacy" title="Privacy Policy" updated="October 19, 2026">
      <p>
        Venband is designed to know as little about you as possible. This Privacy Policy explains what information we collect, how we use it, and the choices you have.
        It applies to the Venband website, apps and APIs (the “Service”). If you do not agree with this policy, please do not use the Service.
      </p>
      <h2 id="scope">1. Scope</h2>
      <p>
        This policy covers information processed by Venband. It does not cover third-party platforms you may link to your account; those are governed by their own
        privacy policies.
      </p>
      <h2 id="cannot-see">2. What we cannot see</h2>
      <ul>
        <li>The content of your messages, files, voice and video calls. They are encrypted on your device with keys Venband never has.</li>
        <li>Your private keys. They are encrypted with a key derived from your password before storage.</li>
        <li>Your password. Only a derived login key is transmitted.</li>
      </ul>
      <h2 id="collect">3. Information we collect</h2>
      <h3>Account information</h3>
      <ul>
        <li>Email address, username, display name and any profile details you choose to add (such as avatar, bio, status and pronouns).</li>
        <li>Account creation date, last sign-in time and account status.</li>
      </ul>
      <h3>Service data</h3>
      <ul>
        <li>Server, channel and group memberships and roles; who sent a message and when, and message size, but not message content.</li>
        <li>Reactions and similar metadata, where not fully encrypted; only aggregate counts are visible to the server.</li>
        <li>Content you choose to make public: server names and descriptions, discovery listings, status page incidents and messages posted by bots.</li>
        <li>Reports you submit, including the reported messages, so moderators can review them.</li>
      </ul>
      <h3>Device and network information</h3>
      <ul>
        <li>A one-way, peppered hash of your network address at sign-up, used only to limit how many accounts one network can create. We do not store or display your IP address to other users.</li>
        <li>Device sessions you create, including a rough location (city/country) computed on demand when you view your devices list; this is not stored.</li>
        <li>Browser and device traits used for Voogle verification, stored only as one-way hashes.</li>
      </ul>
      <h3>Linked accounts</h3>
      <p>
        If you link a third-party account (such as YouTube, TikTok, Twitch, Steam, Roblox, Spotify, Discord, GitHub, Xbox, Instagram or Epic), we store the account
        identifier, display name, avatar and the metadata you authorize, along with the connection date. We do not store your third-party passwords.
      </p>
      <h3>Support and safety</h3>
      <ul>
        <li>Messages you send to support or moderators, and reports, appeals and moderation records.</li>
        <li>Security logs needed to protect the Service, such as failed sign-in attempts and abuse signals.</li>
      </ul>
      <h2 id="use">4. How we use information</h2>
      <ul>
        <li>To create and maintain your account and provide the Service.</li>
        <li>To route and store encrypted messages and media, and to deliver notifications.</li>
        <li>To enforce our Terms, Community Guidelines and security measures, including rate limits and abuse prevention.</li>
        <li>To operate optional features you enable, such as link previews, presence and connected-account activity.</li>
        <li>To respond to support requests and investigate reports.</li>
        <li>To comply with legal obligations and protect the rights and safety of users and the public.</li>
      </ul>
      <h2 id="legal-bases">5. Legal bases (EEA/UK)</h2>
      <p>
        Where applicable, we process personal data based on performance of a contract, our legitimate interests in operating and securing the Service, your consent where
        required (for example, optional features), and compliance with legal obligations.
      </p>
      <h2 id="sharing">6. Sharing and disclosure</h2>
      <ul>
        <li>We do not sell your personal data and we do not show ads.</li>
        <li>Service providers: we use providers such as Supabase (database, authentication, storage) and Vercel (hosting and serverless functions) to operate the Service. They process data on our instructions.</li>
        <li>Linked platforms: when you link an account, data is exchanged with that platform according to the permissions you approve.</li>
        <li>Legal and safety: we may disclose information if required by law, or to protect the rights, property or safety of Venband, our users or others.</li>
        <li>Business transfers: if Venband is involved in a merger, acquisition or asset sale, your information may be transferred as part of that transaction.</li>
        <li>With your consent or at your direction.</li>
      </ul>
      <h2 id="third-party">7. Third-party services</h2>
      <p>
        The Service integrates with third-party services including YouTube, TikTok, Twitch, Steam, Roblox, Spotify, Discord, GitHub, Xbox, Instagram, Epic, Klipy (GIF search),
        Supabase and Vercel. When you use these features, those providers may collect information according to their own policies. Venband is not responsible for the
        privacy practices of third parties.
      </p>
      <h2 id="cookies">8. Cookies and local storage</h2>
      <p>
        We do not use advertising or tracking cookies. We use your browser’s local storage and similar technologies to keep you signed in, store your settings and
        encryption keys, and enable offline functionality. You can clear this data through your browser settings, but doing so may sign you out or remove local data.
      </p>
      <h2 id="retention">9. Data retention</h2>
      <p>
        We retain account and service data for as long as your account exists. If you delete your account, we delete or anonymize your personal data within a reasonable
        period, except where retention is required for security, fraud prevention, legal obligations, or to resolve disputes. Encrypted message content cannot be read by
        Venband and is removed with the underlying storage when deleted.
      </p>
      <h2 id="security">10. Security</h2>
      <p>
        We use industry-standard measures to protect the Service, including transport encryption, row-level security, signed media URLs and end-to-end encryption for
        messages. No system is perfectly secure; you are responsible for keeping your devices and recovery codes safe. If you discover a vulnerability, report it privately.
      </p>
      <h2 id="children">11. Children’s privacy</h2>
      <p>
        The Service is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child under 13 has
        created an account, contact us and we will delete the account. Parents and guardians should supervise minors’ use of the Service.
      </p>
      <h2 id="international">12. International data transfers</h2>
      <p>
        Your data may be processed in countries other than your own. Where required, we use appropriate safeguards for international transfers.
      </p>
      <h2 id="rights">13. Your rights and choices</h2>
      <ul>
        <li>Access, correct or update your information in Settings.</li>
        <li>Download your data or delete your account from Settings.</li>
        <li>Unlink connected accounts from Settings → Connections.</li>
        <li>Turn off link previews, embeds and other features that contact other websites in Settings → Privacy.</li>
        <li>Object to or restrict certain processing, or request deletion, subject to legal limits.</li>
      </ul>
      <p>
        To exercise rights not available in the app, contact us using the information below. We may need to verify your identity before responding.
      </p>
      <h2 id="changes">14. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy. We will change the date above and, for material changes, notify you in the app. Your continued use of the Service after a change
        means you accept the updated policy.
      </p>
      <h2 id="contact">15. Contact</h2>
      <p>
        Questions about this Privacy Policy? Open an issue on our <a href={REPO_URL}>source code repository</a>.
      </p>
      <p className="small muted">
        See also the <L to="tos">Terms of Service</L> and <L to="guidelines">Community Guidelines</L>.
      </p>
    </Doc>
  );
}


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
