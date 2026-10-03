import { useEffect, useRef, useState } from 'react';
import { gifsEnabled, reportGifShare, searchGifs, trendingGifs } from '../lib/klipy';
import { imagesToGif } from '../lib/gifenc';
import { updateSettings, useSettings, type GifFavorite } from '../lib/settings';
import { errorMessage } from '../lib/supabase';
import { Icon } from './ui';

type Tab = 'favorites' | 'search' | 'make';

export function toggleGifFavorite(g: GifFavorite) {
  updateSettings((s) => ({
    gifFavorites: s.gifFavorites.some((f) => f.url === g.url) ? s.gifFavorites.filter((f) => f.url !== g.url) : [g, ...s.gifFavorites],
  }));
}

export function GifPicker({ onPick, onFile, onClose }: { onPick: (url: string) => void; onFile: (f: File) => void; onClose: () => void }) {
  const favorites = useSettings((s) => s.gifFavorites);
  const [tab, setTab] = useState<Tab>(favorites.length ? 'favorites' : gifsEnabled ? 'search' : 'make');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<GifFavorite[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
        <button className={tab === 'make' ? 'active' : ''} onClick={() => setTab('make')}>
          <Icon name="sparkles" size={14} /> Make a GIF
        </button>
      </div>
      {tab === 'search' && (
        <input className="gif-search" autoFocus placeholder="Search Klipy" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {error && <div className="form-error">{error}</div>}
      {tab === 'make' ? (
        <MakeGif
          onDone={(f) => {
            onFile(f);
            onClose();
          }}
        />
      ) : (
        <div className="gif-grid">
          {(tab === 'favorites' ? favorites : items).map((g) => (
            <GifTile key={g.url} g={g} fav={favorites.some((f) => f.url === g.url)} onPick={() => pick(g)} />
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
  );
}

function GifTile({ g, fav, onPick }: { g: GifFavorite; fav: boolean; onPick: () => void }) {
  return (
    <div className="gif-tile" style={{ aspectRatio: `${g.width || 1} / ${g.height || 1}` }}>
      <button className="gif-img" onClick={onPick} title="Send">
        <img src={g.preview} alt="" loading="lazy" />
      </button>
      <button className={`gif-star${fav ? ' on' : ''}`} title={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleGifFavorite(g)}>
        <Icon name="star" size={16} />
      </button>
    </div>
  );
}

function MakeGif({ onDone }: { onDone: (f: File) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [delay, setDelay] = useState(500);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview]);

  async function build(list = files, d = delay) {
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      const gif = await imagesToGif(list, { delayMs: d });
      setPreview({ file: gif, url: URL.createObjectURL(gif) });
    } catch (e) {
      setError(`Couldn’t make a GIF from those pictures: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="make-gif">
      <p className="small muted">Pick one picture to convert it, or several to make an animated slideshow. It’s made on your device and sent encrypted.</p>
      <label className="btn secondary small">
        <Icon name="image" size={16} /> Choose pictures
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const list = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'));
            setFiles(list);
            build(list);
            e.target.value = '';
          }}
        />
      </label>
      {files.length > 1 && (
        <label className="make-gif-delay">
          Speed: {(delay / 1000).toFixed(1)}s per picture
          <input type="range" min={100} max={2000} step={100} value={delay} onChange={(e) => setDelay(Number(e.target.value))} onMouseUp={() => build()} onTouchEnd={() => build()} />
        </label>
      )}
      {error && <div className="form-error">{error}</div>}
      {busy && <div className="spinner small" />}
      {preview && !busy && (
        <>
          <img className="make-gif-preview" src={preview.url} alt="GIF preview" />
          <div className="small muted">{(preview.file.size / 1024).toFixed(0)} KB</div>
          <button className="btn primary small" onClick={() => onDone(preview.file)}>
            Send GIF
          </button>
        </>
      )}
    </div>
  );
}
