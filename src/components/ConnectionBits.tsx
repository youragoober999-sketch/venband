// Small pieces for linked accounts: the brand mark, an account picture that
// falls back to the brand mark, and the "Connections" section on profiles.
import { useEffect, useState } from 'react';
import { BRAND_ICONS } from '../lib/brandIcons';
import { profileConnections, profileUrl, providerInfo, type ConnectionProvider, type ProfileConnection } from '../lib/connections';
import { Icon } from './ui';

export function BrandLogo({ provider, size = 20, tile = false }: { provider: ConnectionProvider; size?: number; tile?: boolean }) {
  const info = providerInfo(provider);
  const svg = (
    <svg viewBox="0 0 24 24" width={tile ? size * 0.58 : size} height={tile ? size * 0.58 : size} fill="currentColor" aria-hidden>
      <path d={BRAND_ICONS[provider]} />
    </svg>
  );
  if (!tile)
    return (
      <span className="brand-logo" style={{ color: info.color === '#000000' || info.color === '#24292f' || info.color === '#171a21' ? 'var(--text)' : info.color }} title={info.name}>
        {svg}
      </span>
    );
  return (
    <span className="brand-tile" style={{ width: size, height: size, background: info.color }} title={info.name}>
      {svg}
    </span>
  );
}

/** The linked account's picture; the service's logo when there's none or it won't load. */
export function ConnectionAvatar({ provider, src, size = 28 }: { provider: ConnectionProvider; src: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <BrandLogo provider={provider} size={size} tile />;
  return <img className="connection-pic" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

/** "Connections" on a profile: each shown account with a link to it. */
export function ProfileConnections({ userId, title = 'Connections' }: { userId: string; title?: string }) {
  const [list, setList] = useState<ProfileConnection[]>([]);
  useEffect(() => {
    let live = true;
    profileConnections(userId).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [userId]);
  if (!list.length) return null;
  return (
    <section className="profile-connections">
      <h4>{title}</h4>
      <div className="pc-list">
        {list.map((c) => {
          const url = profileUrl(c);
          const body = (
            <>
              <BrandLogo provider={c.provider} size={20} />
              <span className="pc-name">{c.display_name || providerInfo(c.provider).name}</span>
              {url && <span className="pc-arrow"><Icon name="arrowUpRight" size={15} /></span>}
            </>
          );
          return url ? (
            <a key={`${c.provider}:${c.external_id}`} className="pc-item" href={url} target="_blank" rel="noopener noreferrer" title={`${providerInfo(c.provider).name} — ${c.display_name}`}>
              {body}
            </a>
          ) : (
            <span key={`${c.provider}:${c.external_id}`} className="pc-item" title={providerInfo(c.provider).name}>
              {body}
            </span>
          );
        })}
      </div>
    </section>
  );
}
