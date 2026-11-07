import { useEffect, useRef, useState } from 'react';
import { gifsEnabled, reportGifShare, searchGifs, trendingGifs } from '../lib/klipy';
import { GifMaker } from './GifMaker';
import { updateSettings, useSettings, type GifFavorite } from '../lib/settings';
import { expressionStore } from '../lib/expressions';
import { errorMessage } from '../lib/supabase';
import { Icon } from './ui';

type Tab = 'favorites' | 'search' | 'server' | 'make';

/** The same GIF can arrive in different sizes/links (…/md/x.gif vs …/hd/x.gif?v=2): compare a normalised key. */
export function gifKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return (u.host + u.pathname).toLowerCase().replace(/\/(xs|sm|md|hd|lg|tiny|small|medium|large|original)(?=\/|\.)/g, '/').replace(/\.(gif|webp|mp4|webm)$/, '');
  } catch {
    return url.trim().toLowerCase();
  }
}
export const isGifFavorite = (list: GifFavorite[], url: string) => {
  const k = gifKey(url);
  return list.some((f) => gifKey(f.url) === k);
};

export function toggleGifFavorite(g: GifFavorite) {
  const k = gifKey(g.url);
  updateSettings((s) => ({
    gifFavorites: s.gifFavorites.some((f) => gifKey(f.url) === k) ? s.gifFavorites.filter((f) => gifKey(f.url) !== k) : [g, ...s.gifFavorites],
  }));
}

/** Masonry: put each GIF in the shorter of two columns, so there are no gaps. */
function columns(list: GifFavorite[]): [GifFavorite[], GifFavorite[]] {
  const out: [GifFavorite[], GifFavorite[]] = [[], []];
  const hgt = [0, 0];
  for (const g of list) {
    const ratio = g.width > 1 && g.height > 1 ? g.height / g.width : 0.75;
    const i = hgt[0] <= hgt[1] ? 0 : 1;
    out[i].push(g);
    hgt[i] += ratio + 0.04;
  }
  return out;
}

export function GifPicker({ onPick, onFile, onClose }: { onPick: (url: string) => void; onFile: (f: File) => void; onClose: () => void }) {
  const favorites = useSettings((s) => s.gifFavorites);
  const [tab, setTab] = useState<Tab>(favorites.length ? 'favorites' : gifsEnabled ? 'search' : 'make');
  const [makeOpen, setMakeOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<GifFavorite[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const serverItems = expressionStore.use((st) => st.list).filter((x) => x.kind === 'gif' || x.kind === 'sticker');

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.gif-btn')) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'search' || !gifsEnabled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const res = q.trim() ? await searchGifs(q.trim(), 1) : await trendingGifs(1);
        if (cancelled) return;
        setItems(res.items);
        setHasNext(res.hasNext);
        setPage(1);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, tab]);

  async function more() {
    setBusy(true);
    try {
      const res = q.trim() ? await searchGifs(q.trim(), page + 1) : await trendingGifs(page + 1);
      setItems((x) => [...x, ...res.items]);
      setHasNext(res.hasNext);
      setPage(page + 1);
    } finally {
      setBusy(false);
    }
  }

  const pick = (g: GifFavorite) => {
    reportGifShare(g.id);
    onPick(g.url);
    onClose();
  };

  return (
    <>
    <div className="gif-picker" ref={ref} role="dialog" aria-label="GIFs">
      <div className="gif-tabs">
        <button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}>
          <Icon name="star" size={14} /> Favorites
        </button>
        {gifsEnabled && (
          <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
            <Icon name="search" size={14} /> Search
          </button>
        )}
        {serverItems.length > 0 && (
          <button className={tab === 'server' ? 'active' : ''} onClick={() => setTab('server')}>
            <Icon name="home" size={14} /> Server
          </button>
        )}
        <button className={tab === 'make' ? 'active' : ''} onClick={() => setMakeOpen(true)}>
          <Icon name="sparkles" size={14} /> Make a GIF
        </button>
      </div>
      {tab === 'search' && (
        <input className="gif-search" autoFocus placeholder="Search Klipy" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {error && <div className="form-error">{error}</div>}
      {tab === 'server' ? (
        <div className="gif-grid">
          {serverItems.map((x) => (
            <button
              key={x.id}
              className="gif-tile server-expr"
              title={`${x.kind === 'sticker' ? 'Sticker' : 'GIF'} :${x.name}: · ${x.server_name}`}
              onClick={() => {
                onPick(x.kind === 'sticker' ? `<s:${x.name}:${x.id}>` : x.url);
                onClose();
              }}
            >
              <img src={x.url} alt={x.name} loading="lazy" />
              <span className="small">{x.kind === 'sticker' ? 'Sticker' : 'GIF'} · {x.server_name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="gif-grid gif-masonry">
          {columns(tab === 'favorites' ? favorites : items).map((col, ci) => (
            <div className="gif-col" key={ci}>
              {col.map((g) => (
                <GifTile key={g.url} g={g} fav={isGifFavorite(favorites, g.url)} onPick={() => pick(g)} />
              ))}
            </div>
          ))}
          {tab === 'favorites' && !favorites.length && (
            <p className="small muted gif-empty">Star a GIF to keep it here. Your favorites sync to every device.</p>
          )}
          {tab === 'search' && hasNext && (
            <button className="btn secondary small gif-more" disabled={busy} onClick={more}>
              {busy ? 'Loading…' : 'More'}
            </button>
          )}
        </div>
      )}
      {tab === 'search' && <div className="gif-attribution">Powered by KLIPY</div>}
    </div>
    {makeOpen && (
      <div className="modal-backdrop" onClick={() => setMakeOpen(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <h2>Make a GIF</h2>
          <GifMaker onDone={(f) => { onFile(f); setMakeOpen(false); onClose(); }} />
          <button className="btn ghost small" onClick={() => setMakeOpen(false)} style={{ marginTop: 8 }}>Close</button>
        </div>
      </div>
    )}
    </>
  );
}

/** Star toggle: a sparkle burst when you favorite, a little shrink when you un-favorite. */
export function FavoriteStar({ g, fav, className = '' }: { g: GifFavorite; fav: boolean; className?: string }) {
  const [anim, setAnim] = useState<{ n: number; on: boolean }>({ n: 0, on: false });
  return (
    <button
      type="button"
      className={`gif-star${fav ? ' on' : ''}${className ? ' ' + className : ''}`}
      title={fav ? 'Favorited — click to remove' : 'Add to favorites'}
      aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={fav}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setAnim((a) => ({ n: a.n + 1, on: !fav }));
        toggleGifFavorite(g);
      }}
    >
      <span key={anim.n} className={anim.n ? (anim.on ? 'star-pop' : 'star-drop') : undefined}>
        <Icon name="star" size={16} filled={fav} />
      </span>
      {anim.n > 0 && anim.on && (
        <span key={`b${anim.n}`} className="star-fx" aria-hidden>
          <i className="star-ring" />
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} className="star-spark" style={{ ['--a' as string]: `${i * 45}deg` }} />
          ))}
        </span>
      )}
    </button>
  );
}

function GifTile({ g, fav, onPick }: { g: GifFavorite; fav: boolean; onPick: () => void }) {
  return (
    <div className="gif-tile">
      <button className="gif-img" onClick={onPick} title="Send">
        <img src={g.preview} alt="" loading="lazy" />
      </button>
      <FavoriteStar g={g} fav={fav} />
    </div>
  );
}
