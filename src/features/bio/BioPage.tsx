import { useEffect, useState, type CSSProperties } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabase';
import { profileUrl, providerInfo, type ProfileConnection } from '../../lib/connections';
import { BIO_DEFAULT, bioAssetUrl, normalizeBio, type BioPage } from './bioModel';
import './bio.css';

export type BioIdentity = { username: string; displayName: string; avatar: string | null; avatarColor: string };
type PublicBio = BioIdentity & { page: BioPage; connections: ProfileConnection[] };

function safeAvatar(value: string | null) {
  const prefix = `${supabaseUrl}/storage/v1/object/public/avatars/`;
  if (!supabaseUrl || !value?.startsWith(prefix)) return undefined;
  const url = new URL(value);
  return url.pathname.startsWith('/storage/v1/object/public/avatars/') ? url.href : undefined;
}

export function BioCard({ page, identity, connections = [], preview = false }: {
  page: BioPage; identity: BioIdentity; connections?: ProfileConnection[]; preview?: boolean;
}) {
  const background = bioAssetUrl(page.backgroundAsset);
  const avatar = bioAssetUrl(page.avatarAsset) ?? safeAvatar(identity.avatar);
  const cursor = bioAssetUrl(page.cursorAsset);
  const audio = bioAssetUrl(page.audioAsset);
  const title = page.title.trim() || identity.displayName || identity.username;
  const style = {
    '--bio-bg': page.background, '--bio-panel': page.panel, '--bio-accent': page.accent, '--bio-text': page.text,
    '--bio-opacity': `${page.opacity}%`, '--bio-blur': `${page.blur}px`, '--bio-avatar': identity.avatarColor,
    ...(background ? { backgroundImage: `linear-gradient(#0003,#0006),url("${background}")` } : {}),
    ...(cursor ? { cursor: `url("${cursor}"), auto` } : {}),
  } as CSSProperties;
  return (
    <div className={`vb-bio vb-bio-${page.layout} vb-bio-${page.effect}${preview ? ' vb-bio-preview' : ''}`} style={style}>
      <article className="vb-bio-card">
        <header className="vb-bio-heading">
          {avatar ? <img className="vb-bio-avatar" src={avatar} alt="" /> : <span className="vb-bio-avatar">{title.slice(0, 1).toUpperCase()}</span>}
          <div>
            <h1 className={page.glow ? 'vb-bio-glow' : undefined}>{title}</h1>
            <p className="vb-bio-handle">@{identity.username}</p>
          </div>
        </header>
        <div className="vb-bio-content">
          {page.bio.trim() && <p className="vb-bio-description">{page.bio}</p>}
          {page.location.trim() && <p className="vb-bio-location">{page.location}</p>}
          {(page.links.length > 0 || (page.showConnections && connections.length > 0)) && <nav className="vb-bio-links" aria-label="Profile links">
            {page.links.map((link, index) => <a key={index} href={link.url} target="_blank" rel="noopener noreferrer ugc">
              <span>{link.label}<small>{new URL(link.url).hostname}</small></span><span aria-hidden>↗</span>
            </a>)}
            {page.showConnections && connections.map((connection) => {
              const label = `${providerInfo(connection.provider).name} · ${connection.display_name}`;
              const url = profileUrl(connection);
              const key = `${connection.provider}:${connection.external_id}`;
              return url ? <a key={key} href={url} target="_blank" rel="noopener noreferrer">{label}<span aria-hidden>↗</span></a>
                : <span key={key} className="vb-bio-connection">{label}</span>;
            })}
          </nav>}
          {audio && <audio controls preload="none" src={audio} aria-label="Bio page audio" />}
        </div>
      </article>
      {!preview && <a className="vb-bio-home" href="/">Venband</a>}
    </div>
  );
}

export function PublicBioPage({ username }: { username: string }) {
  const [result, setResult] = useState<{ username: string; data: PublicBio | null; error: boolean }>();
  useEffect(() => {
    let current = true;
    void supabase.rpc('public_bio_page', { p_username: username }).then(({ data, error }) => {
      if (current) setResult({ username, data: data as PublicBio | null, error: Boolean(error) });
    });
    return () => { current = false; };
  }, [username]);
  const bio = result?.username === username ? result : undefined;
  useEffect(() => {
    const old = document.title;
    if (bio?.data) document.title = `${bio.data.page.title || bio.data.displayName || username} · Venband`;
    return () => { document.title = old; };
  }, [bio, username]);
  if (bio?.data) return <main className="vb-bio-public"><BioCard identity={bio.data} page={normalizeBio(bio.data.page)} connections={bio.data.connections} /></main>;
  return <main className="vb-bio vb-bio-center" style={{ '--bio-bg': BIO_DEFAULT.background, '--bio-text': BIO_DEFAULT.text } as CSSProperties}>
    <p role="status">{!bio ? 'Loading bio page…' : bio.error ? 'Couldn’t load this bio page.' : 'This bio page isn’t published.'}</p>
    <a href="/">Venband</a>
  </main>;
}
