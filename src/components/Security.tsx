// Settings → Security: two-factor sign-in, signing out other devices,
// downloading your data, deleting your account and restoring deleted servers.
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { removeSavedPasskey, savePasskeyWithPassword, sessionStore } from '../lib/session';
import { hasPasskey, isPasskeySupported } from '../lib/passkey';
import { safeFileName } from '../lib/files';
import { openSettings } from '../lib/ui';
import { askConfirm } from './Dialogs';
import { Field, Icon } from './ui';

interface Factor {
  id: string;
  friendly_name?: string;
  status: 'verified' | 'unverified';
  created_at: string;
}

export function SecurityTab() {
  const me = sessionStore.use((s) => s.me)!;
  const session = sessionStore.use((s) => s.session);
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deletedServers, setDeletedServers] = useState<{ id: string; name: string; deleted_at: string }[]>([]);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const savePw = async () => {
    setMsg(null);
    try {
      await savePasskeyWithPassword(pw);
      setPwOpen(false);
      setPw('');
      setMsg({ ok: true, text: 'Passkey saved. Log in with it next time.' });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.totp ?? []) as Factor[]).filter((f) => f.status === 'verified'));
    const { data: ds } = await supabase.from('servers').select('id, name, deleted_at').eq('owner_id', me.id).eq('status', 'deleted');
    setDeletedServers((ds ?? []) as typeof deletedServers);
  }, [me.id]);
  useEffect(() => {
    load();
  }, [load]);

  const twoFactorOn = Boolean(factors?.length);
  const checks = [
    { ok: Boolean(session?.user.email_confirmed_at), label: 'Email address verified' },
    { ok: twoFactorOn, label: 'Two-factor sign-in turned on' },
    { ok: true, label: 'Messages end-to-end encrypted on this device' },
  ];

  return (
    <>
      <h2>Security</h2>
      {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
      <section className="settings-section security-score">
        <div className="security-ring" style={{ ['--p' as string]: `${(checks.filter((c) => c.ok).length / checks.length) * 100}%` }}>
          <Icon name="shield" size={26} />
        </div>
        <ul>
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : 'todo'}>
              <Icon name={c.ok ? 'check' : 'x'} size={14} /> {c.label}
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-section">
        <h3>Two-factor sign-in</h3>
        <p className="muted small">
          After your password, Venband asks for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…). Even with your
          password, nobody can open your messages without your phone.
        </p>
        {factors === null ? (
          <div className="spinner" />
        ) : twoFactorOn ? (
          <div className="row-between">
            <span className="pill active">On</span>
            <button
              className="btn danger small"
              onClick={async () => {
                if (!(await askConfirm({ title: 'Turn off two-factor sign-in?', body: 'Your account will only be protected by your password.', confirm: 'Turn off', danger: true }))) return;
                for (const f of factors) {
                  const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
                  if (error) return setMsg({ ok: false, text: errorMessage(error) });
                }
                setMsg({ ok: true, text: 'Two-factor sign-in is off.' });
                load();
              }}
            >
              Turn off
            </button>
          </div>
        ) : enrolling ? (
          <div className="mfa-enroll">
            <img src={enrolling.qr} alt="QR code for your authenticator app" width={180} height={180} />
            <div className="grow">
              <ol className="small">
                <li>Scan the code with your authenticator app.</li>
                <li>
                  Can’t scan? Type this key: <code className="mfa-secret">{enrolling.secret}</code>
                </li>
                <li>Enter the 6-digit code it shows.</li>
              </ol>
              <Field label="Code">
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Setup code" />
              </Field>
              <div className="row-start">
                <button
                  className="btn primary"
                  disabled={code.length !== 6}
                  onClick={async () => {
                    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.id, code });
                    if (error) return setMsg({ ok: false, text: 'That code didn’t work. Try the newest one.' });
                    setEnrolling(null);
                    setCode('');
                    setMsg({ ok: true, text: 'Two-factor sign-in is on. You’ll be asked for a code when you log in.' });
                    load();
                  }}
                >
                  Turn on
                </button>
                <button className="btn secondary" onClick={() => (supabase.auth.mfa.unenroll({ factorId: enrolling.id }), setEnrolling(null))}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            className="btn primary"
            onClick={async () => {
              setMsg(null);
              // clear half-finished attempts first
              const { data } = await supabase.auth.mfa.listFactors();
              for (const f of (data?.all ?? []).filter((x) => x.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
              const { data: e, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Venband ${new Date().toISOString().slice(0, 10)}` });
              if (error) return setMsg({ ok: false, text: /disabled|not enabled/i.test(error.message) ? 'Two-factor sign-in isn’t turned on for this Venband server yet.' : errorMessage(error) });
              setEnrolling({ id: e.id, qr: e.totp.qr_code, secret: e.totp.secret });
            }}
          >
            <Icon name="shield" size={16} /> Set up an authenticator app
          </button>
        )}
      </section>

      <section className="settings-section">
        <h3>Passkey unlock</h3>
        <p className="muted small">
          Unlock Venband on this device with your screen lock (Windows Hello, Google Password Manager, or iCloud) instead of
          typing your password. The passkey is saved only on this device.
        </p>
        {!isPasskeySupported() ? (
          <p className="muted small">This browser doesn’t support passkeys. Use the Android app or a recent Chrome, Edge or Safari.</p>
        ) : hasPasskey(session?.user.id ?? '') ? (
          <div className="row-between">
            <span className="pill active">Saved on this device</span>
            <button
              className="btn danger small"
              onClick={async () => {
                if (!(await askConfirm({ title: 'Remove this passkey?', body: 'You’ll unlock with your password again.', confirm: 'Remove', danger: true }))) return;
                removeSavedPasskey();
                setMsg({ ok: true, text: 'Passkey removed.' });
              }}
            >
              Remove
            </button>
          </div>
        ) : pwOpen ? (
          <div className="row-start">
            <Field label="Confirm your password">
              <input
                type="password"
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && savePw()}
                aria-label="Password"
              />
            </Field>
            <button
              className="btn primary"
              disabled={!pw}
              onClick={savePw}
            >
              Save passkey
            </button>
            <button className="btn secondary" onClick={() => (setPwOpen(false), setPw(''))}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn secondary" onClick={() => setPwOpen(true)}>
            <Icon name="key" size={16} /> Set up a passkey for this device
          </button>
        )}
      </section>

      <section className="settings-section">
        <h3>Where you’re logged in</h3>
        <div className="row-between">
          <span className="muted small">See every device and log out the ones you don’t recognise.</span>
          <button className="btn secondary small" onClick={() => openSettings('devices')}>
            Devices
          </button>
        </div>
        <div className="row-between">
          <span className="muted small">Log out everywhere except here.</span>
          <button
            className="btn danger small"
            onClick={async () => {
              if (!(await askConfirm({ title: 'Log out other devices?', body: 'Every other phone, computer and browser will be logged out.', confirm: 'Log them out', danger: true }))) return;
              const { error } = await supabase.auth.signOut({ scope: 'others' });
              setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: 'Other devices were logged out.' });
            }}
          >
            Log out other devices
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Your data</h3>
        <div className="row-between">
          <span className="muted small">Download your account, settings, friends and servers as a file.</span>
          <button
            className="btn secondary small"
            onClick={async () => {
              const { data, error } = await supabase.rpc('export_my_data');
              if (error) return setMsg({ ok: false, text: errorMessage(error) });
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = safeFileName(`venband-${me.username}-data.json`);
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            }}
          >
            <Icon name="download" size={14} /> Download my data
          </button>
        </div>
      </section>

      {deletedServers.length > 0 && (
        <section className="settings-section">
          <h3>Recently deleted servers</h3>
          <p className="muted small">Deleted servers stay here for 7 days. Restore one to bring back everything, including its members and messages.</p>
          {deletedServers.map((s) => (
            <div key={s.id} className="row-between">
              <span>
                <b>{s.name}</b>{' '}
                <span className="muted small">gone for good {new Date(new Date(s.deleted_at).getTime() + 7 * 86400_000).toLocaleDateString()}</span>
              </span>
              <button
                className="btn primary small"
                onClick={async () => {
                  const { error } = await supabase.rpc('restore_server', { p_server: s.id });
                  setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: `${s.name} is back.` });
                  load();
                }}
              >
                Restore
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="settings-section danger-zone">
        <h3>Delete account</h3>
        <div className="row-between">
          <span className="muted small">Permanently wipes your account, DMs, files, messages, username and email. This can’t be undone.</span>
          <button className="btn danger small" onClick={() => openSettings('account')}>
            My Account
          </button>
        </div>
      </section>
    </>
  );
}
