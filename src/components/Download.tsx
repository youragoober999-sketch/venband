// venband.com/download — the one place to grab the apps. Reads dist/download.json
// (generated at build time from root package.json) so the version shown here
// always matches the version inside the EXE/APK. On desktop it also asks the
// app what's installed, so running people see "you're up to date".
import { useEffect, useMemo, useState } from 'react';
import { DOWNLOAD_URL, VERSION } from '../lib/version';
import { isAndroid } from '../lib/ui';
import { PublicLayout } from './PublicPages';
import { Icon } from './ui';

type Platform = string;

interface DownloadManifest {
  version: string;
  url: string;
  updatedAt: string;
  windows: { name: string; kind: 'installer' | 'portable'; url: string }[];
  android: { name: string; kind: string; url: string };
}

interface DesktopInfo { version: string; platform: Platform; }

const FALLBACK: DownloadManifest = {
  version: VERSION,
  url: DOWNLOAD_URL,
  updatedAt: new Date().toISOString(),
  windows: [
    { name: `Venband-Setup-${VERSION}.exe`, kind: 'installer', url: `${DOWNLOAD_URL}Venband-Setup-${VERSION}.exe` },
    { name: `Venband-Portable-${VERSION}.exe`, kind: 'portable', url: `${DOWNLOAD_URL}Venband-Portable-${VERSION}.exe` },
  ],
  android: { name: `Venband-${VERSION}-debug.apk`, kind: 'apk', url: `${DOWNLOAD_URL}Venband-${VERSION}-debug.apk` },
};

function useManifest() {
  const [manifest, setManifest] = useState<DownloadManifest | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}download.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no manifest'))))
      .then((m: DownloadManifest) => alive && setManifest(m))
      .catch(() => alive && setManifest(FALLBACK));
    return () => {
      alive = false;
    };
  }, []);
  return manifest;
}

export function DownloadPage() {
  const manifest = useManifest();
  const [installed, setInstalled] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    const bridge = window.venbandDesktop as unknown as { isDesktop: boolean; info: () => Promise<DesktopInfo> } | undefined;
    if (bridge?.isDesktop) bridge.info().then(setInstalled).catch(() => {});
  }, []);
  const latest = manifest?.version ?? VERSION;
  const current = installed?.version;
  const upToDate = current && latest && current === latest;
  const androidHere = isAndroid();
  const dl = useMemo(() => manifest ?? FALLBACK, [manifest]);

  return (
    <PublicLayout page="download" title="Download" wide>
      <section className="dl-hero">
        <h1>Download Venband</h1>
        <p className="muted">
          Same account on every device — your messages are end-to-end encrypted and sync live across Windows, Android and the web.
        </p>
        <div className="dl-version">
          <Icon name="download" size={14} /> Latest version: <b>{latest}</b>
          {current && (
            <span className={upToDate ? 'dl-state ok' : 'dl-state new'}>
              {upToDate ? 'You’re up to date' : `You’re on ${current} — the app will update itself`}
            </span>
          )}
        </div>
      </section>

      <div className="dl-grid">
        <article className={`dl-card${androidHere || current === undefined || current === null ? ' os' : ''}`}>
          <div className="dl-logo win">
            <Icon name="monitor" size={18} />
          </div>
          <h2>Windows</h2>
          <p className="muted">
            The desktop app never asks you to reinstall: it checks for updates on every launch and installs them right inside, keeping
            your login and data.
          </p>
          <div className="dl-buttons">
            {dl.windows.map((f) => (
              <a key={f.name} className="btn primary" href={f.url}>
                <Icon name="download" size={14} />
                {f.kind === 'installer' ? 'Download installer' : 'Portable (no install)'}
              </a>
            ))}
          </div>
          <span className="dl-note">Windows 10/11 · 64-bit</span>
        </article>

        <article className={`dl-card${androidHere ? ' os' : ''}`}>
          <div className="dl-logo and">
            <Icon name="monitor" size={18} />
          </div>
          <h2>Android</h2>
          <p className="muted">
            Ships the full Venband web app with a compact phone layout, status bar and push-friendly shell. Replaces in place — login and
            data stay.
          </p>
          <div className="dl-buttons">
            <a className="btn primary" href={dl.android.url}>
              <Icon name="download" size={14} /> Download APK
            </a>
          </div>
          <span className="dl-note">Android 8+ · arm64</span>
        </article>
      </div>

      <section className="dl-faq">
        <h3>Will I lose my account or messages?</h3>
        <p>
          No. Updates replace the app files and leave your login stored separately, so you stay signed in with all of your chats intact —
          on Windows, Android and the web alike.
        </p>
        <h3>How do updates work on Windows?</h3>
        <p>
          On every launch (and periodically while running) the app compares its version with the one on this page. When a newer build is
          published you’ll be asked to update, and accepting downloads and installs it through the app — no browser, no reinstall.
        </p>
        <h3>Why isn’t it in a store?</h3>
        <p>
          Venband is open source and distributed straight from here. The APK installs by enabling “install unknown apps” for your
          browser or file manager.
        </p>
      </section>
    </PublicLayout>
  );
}