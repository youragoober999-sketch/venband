// QR code login: the code on the login page, the "Log in on that device?"
// screen on the signed-in device, and an in-app scanner. See lib/qrLogin.ts.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { go } from '../lib/router';
import { approveCode, claimCode, codeFromQr, codeStatus, denyCode, finishLogin, oneTimeKeys, qrLoginUrl, QR_LIFETIME_MS, startCode } from '../lib/qrLogin';
import { Avatar, Field, Icon, Modal } from './ui';
import type { Profile } from '../lib/types';
import './qrlogin.css';

type Who = { name?: string; avatar_url?: string | null; avatar_color?: string };

/** The rotating QR code on the login page. */
export function QrLoginPanel({ compact = false }: { compact?: boolean }) {
  const [img, setImg] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'scanned' | 'signing' | 'error'>('loading');
  const [who, setWho] = useState<Who | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(QR_LIFETIME_MS);
  const [round, setRound] = useState(0);
  const keys = useRef<Awaited<ReturnType<typeof oneTimeKeys>> | null>(null);
  const code = useRef<string | null>(null);
  const until = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // put up a fresh code (on mount, every 30 s, and after a denial / expiry)
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const nextKeys = await oneTimeKeys();
        const next = nextKeys.code;
        await startCode(next, nextKeys.publicB64, code.current);
        if (dead) return;
        keys.current = nextKeys;
        code.current = next;
        until.current = Date.now() + QR_LIFETIME_MS;
        const svg = await QRCode.toString(qrLoginUrl(next), { type: 'svg', margin: 0, errorCorrectionLevel: 'Q', color: { dark: '#0b0b10', light: '#ffffff' } });
        if (dead) return;
        setImg(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
        setUrl(qrLoginUrl(next));
        setWho(null);
        setPhase('waiting');
      } catch (e) {
        if (!dead) {
          setError(errorMessage(e));
          setPhase('error');
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [round]);

  // countdown + rotation (paused while the tab is hidden, so no codes are made for nobody)
  useEffect(() => {
    const t = window.setInterval(() => {
      if (phaseRef.current !== 'waiting') return;
      const ms = until.current - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= -2000 && !document.hidden) {
        phaseRef.current = 'loading';
        setPhase('loading');
        setRound((r) => r + 1);
      }
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  // has someone scanned / approved it?
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'scanned') return;
    let busy = false;
    let cancelled = false;
    const t = window.setInterval(async () => {
      if (busy || !code.current || document.hidden) return;
      busy = true;
      const currentCode = code.current;
      const currentKeys = keys.current;
      try {
        const s = await codeStatus(currentCode);
        if (cancelled || currentCode !== code.current || !currentKeys) return;
        if (s.state === 'scanned') {
          setWho({ name: s.name, avatar_url: s.avatar_url, avatar_color: s.avatar_color });
          setPhase('scanned');
        } else if (s.state === 'approved') {
          setPhase('signing');
          await finishLogin(s.sealed, currentKeys.privateKey);
          // the app's sign-in listener takes it from here
        } else if (s.state === 'denied') {
          setError('The login was denied on the other device.');
          setRound((r) => r + 1);
        } else if (s.state === 'expired' && phaseRef.current === 'scanned') {
          setError('That took too long — here’s a new code.');
          setRound((r) => r + 1);
        }
      } catch (e) {
        setError(errorMessage(e));
        setPhase('error');
      } finally {
        busy = false;
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [phase]);

  const pct = Math.max(0, Math.min(1, left / QR_LIFETIME_MS));
  return (
    <div className={`qr-login${compact ? ' compact' : ''}`}>
      <div className={`qr-frame ${phase}`}>
        {phase === 'scanned' || phase === 'signing' ? (
          <div className="qr-scanned">
            {who && <Avatar profile={{ display_name: who.name ?? '', avatar_url: who.avatar_url ?? null, avatar_color: who.avatar_color ?? '#5b5bf0', avatar_frame: 'none' } as unknown as Profile} size={72} />}
            <b>{phase === 'signing' ? 'Logging you in…' : `Hi ${who?.name ?? 'there'}!`}</b>
            <span>{phase === 'signing' ? 'One moment.' : 'Confirm on your other device.'}</span>
            {phase === 'signing' && <span className="spinner" />}
          </div>
        ) : img && phase === 'waiting' ? (
          <>
            <img src={img} alt="QR code to log in" data-url={url} draggable={false} />
            <span className="qr-badge" aria-hidden>
              <Icon name="shield" size={18} />
            </span>
          </>
        ) : phase === 'error' ? (
          <div className="qr-scanned">
            <Icon name="x" size={28} />
            <span>{error}</span>
            <button className="btn secondary small" onClick={() => (setError(null), setRound((r) => r + 1))}>
              Try again
            </button>
          </div>
        ) : (
          <span className="spinner" />
        )}
      </div>
      <h2>Log in with QR code</h2>
      <p className="qr-help">
        Scan this with the camera on a phone or computer where you’re <b>already logged in</b> to Venband — or use <b>Settings → My Account → Scan QR code</b>.
      </p>
      {phase === 'waiting' && (
        <div className="qr-timer" role="timer" aria-label={`New code in ${Math.ceil(left / 1000)} seconds`}>
          <span className="qr-timer-bar">
            <i style={{ transform: `scaleX(${pct})` }} />
          </span>
          New code in {Math.ceil(left / 1000)}s
        </div>
      )}
      {error && phase !== 'error' && <div className="qr-note">{error}</div>}
    </div>
  );
}

/** www.venband.com/login/qr/code/<code>, opened on a device where you're logged in. */
export function QrApprovePage({ code }: { code: string }) {
  const status = sessionStore.use((s) => s.status);
  const me = sessionStore.use((s) => s.me);
  const [info, setInfo] = useState<{ device: string; created_at: string; public_key: string } | null>(null);
  const [step, setStep] = useState<'checking' | 'confirm' | 'busy' | 'done' | 'denied' | 'error'>('checking');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'ready') return;
    claimCode(code)
      .then((i) => {
        setInfo(i);
        setStep('confirm');
      })
      .catch((e) => {
        setError(errorMessage(e));
        setStep('error');
      });
  }, [status, code]);

  const home = () => go('channels/@me', { replace: true });
  const body = (() => {
    if (status === 'loading') return <span className="spinner" />;
    if (status !== 'ready')
      return (
        <>
          <span className="qr-approve-icon warn">
            <Icon name="lock" size={26} />
          </span>
          <h1>Log in here first</h1>
          <p className="sub">QR login works from a device where you’re already logged in to Venband. Log in on this device, then scan the code on the other screen again.</p>
          <button className="btn primary full" onClick={() => go('sign-in', { replace: true })}>
            Go to log in
          </button>
        </>
      );
    if (step === 'checking') return <span className="spinner" />;
    if (step === 'error')
      return (
        <>
          <span className="qr-approve-icon warn">
            <Icon name="clock" size={26} />
          </span>
          <h1>That code didn’t work</h1>
          <p className="sub">{error}</p>
          <button className="btn primary full" onClick={home}>
            Back to Venband
          </button>
        </>
      );
    if (step === 'done')
      return (
        <>
          <span className="qr-approve-icon ok">
            <Icon name="check" size={28} />
          </span>
          <h1>You’re logged in there</h1>
          <p className="sub">
            {info?.device ?? 'The other device'} was approved. Finish any authenticator prompt on that device.
          </p>
          <button className="btn primary full" onClick={home}>
            Back to Venband
          </button>
        </>
      );
    if (step === 'denied')
      return (
        <>
          <span className="qr-approve-icon">
            <Icon name="x" size={28} />
          </span>
          <h1>Login denied</h1>
          <p className="sub">Nobody was logged in. If you didn’t try to log in somewhere, you can ignore this.</p>
          <button className="btn primary full" onClick={home}>
            Back to Venband
          </button>
        </>
      );
    return (
      <>
        <span className="qr-approve-icon">
          <Icon name="monitor" size={26} />
        </span>
        <h1>Log in on another device?</h1>
        <p className="sub">This will log the device below into your account.</p>
        <div className="qr-device">
          <Icon name="monitor" size={18} />
          <div>
            <b>{info?.device || 'Unknown device'}</b>
            <span>Asked {ago(info?.created_at)}</span>
          </div>
        </div>
        {me && (
          <div className="qr-as">
            <Avatar profile={me} size={28} /> as <b>{me.display_name || me.username}</b>
          </div>
        )}
        <p className="qr-warn">
          <Icon name="shield" size={16} />
          <span>
            Only approve if that QR code is on <b>your own screen, right now</b>. Never approve a code someone sent you — it would give them your account.
          </span>
        </p>
        {needsPassword && <Field label="Confirm your password on this device">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>}
        {error && <div className="form-error">{error}</div>}
        <button
          className="btn primary full"
          disabled={step === 'busy' || !info || (needsPassword && !password)}
          onClick={async () => {
            setStep('busy');
            setError(null);
            try {
              if (!info) return;
              await approveCode(code, info.public_key, password);
              setPassword('');
              setStep('done');
            } catch (e) {
              const message = errorMessage(e);
              if (/password|decrypt|operation/i.test(message)) setNeedsPassword(true);
              setError(message);
              setStep('confirm');
            }
          }}
        >
          {step === 'busy' ? 'Logging it in…' : 'Yes, log me in'}
        </button>
        <button
          className="btn secondary full"
          disabled={step === 'busy'}
          onClick={async () => {
            await denyCode(code).catch(() => {});
            setStep('denied');
          }}
        >
          No, deny
        </button>
      </>
    );
  })();

  return (
    <div className="simple-page qr-approve">
      <div className="simple-card">{body}</div>
    </div>
  );
}

function ago(iso?: string) {
  if (!iso) return 'just now';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 5 ? 'just now' : s < 60 ? `${s} seconds ago` : `${Math.round(s / 60)} min ago`;
}

/** Scan a login QR code with this device's camera (Settings → My Account). */
export function QrScanModal({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const supported = 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);

  const open = (text: string) => {
    const c = codeFromQr(text);
    if (!c) return setError('That isn’t a Venband login QR code.');
    onClose();
    go(`login/qr/code/${c}`);
  };

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let dead = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (dead || !video.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const detector = new Detector({ formats: ['qr_code'] });
        timer = window.setInterval(async () => {
          if (!video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          const hit = found.map((f) => f.rawValue).find((v) => codeFromQr(v));
          if (hit) open(hit);
        }, 350);
      } catch {
        setError('Venband couldn’t use the camera. Allow camera access, or paste the link below.');
      }
    })();
    return () => {
      dead = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Scan a login QR code" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        On the other device, open <b>venband.com/login</b>. Point this camera at its QR code. Your phone’s own camera app works too.
      </p>
      {supported ? <video ref={video} className="qr-scan-video" muted playsInline /> : <div className="notice small">This browser can’t scan QR codes. Use your phone’s camera app, or paste the link below.</div>}
      {error && <div className="form-error">{error}</div>}
      <form
        className="qr-paste"
        onSubmit={(e) => {
          e.preventDefault();
          open(paste);
        }}
      >
        <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste the link from the QR code" aria-label="Login QR link" />
        <button className="btn secondary small" disabled={!paste.trim()}>
          Open
        </button>
      </form>
    </Modal>
  );
}
