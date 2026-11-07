// "Add music" for a new memory: search songs by name, artist, mood or genre,
// preview them, pick one and choose where it starts.
import { useEffect, useRef, useState } from 'react';
import { fmtTime, searchMusic, toMemoryMusic, type MemoryMusic, type Track } from '../lib/music';
import { Icon } from './ui';
import './music.css';

const MOODS = ['Happy', 'Chill', 'Lo-fi', 'Hip hop', 'Cinematic', 'Upbeat', 'Acoustic', 'Electronic', 'Sad', 'Epic'];

/** One shared preview player, so only one song plays at a time. */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (key: string, src: string | null, start = 0) => {
    if (!src) return;
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.volume = 0.8;
      audio.current.onended = () => setPlaying(null);
    }
    const a = audio.current;
    if (playing === key) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.pause();
    a.src = src;
    a.currentTime = start;
    setLoading(key);
    a.play()
      .then(() => setPlaying(key))
      .catch(() => setPlaying(null))
      .finally(() => setLoading(null));
  };
  const stop = () => {
    audio.current?.pause();
    setPlaying(null);
  };
  const seek = (s: number) => {
    if (audio.current) audio.current.currentTime = s;
  };
  return { playing, loading, toggle, stop, seek };
}

function Art({ src, size = 44 }: { src: string | null; size?: number }) {
  return src ? (
    <img className="mp-art" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" />
  ) : (
    <span className="mp-art blank" style={{ width: size, height: size }}>
      <Icon name="music" size={size / 2.2} />
    </span>
  );
}

export function MusicPicker({ value, onChange, clipSeconds }: { value: MemoryMusic | null; onChange: (m: MemoryMusic | null) => void; clipSeconds: number }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Track | null>(null);
  const preview = usePreview();

  // chosen song: card with a start-time slider
  if (value && !open) {
    const dur = picked?.duration ?? 0;
    const maxStart = Math.max(0, dur - Math.min(dur, clipSeconds));
    const key = `${value.provider}:${value.id}`;
    return (
      <div className="mp-chosen">
        <div className="mp-chosen-row">
          <Art src={value.artwork} size={48} />
          <div className="mp-meta">
            <b>{value.title}</b>
            <span>{value.artist}</span>
          </div>
          <button className="mp-play" onClick={() => preview.toggle(key, picked?.audio ?? null, value.start)} aria-label={preview.playing === key ? 'Pause preview' : 'Play preview'} disabled={!picked?.audio}>
            {preview.loading === key ? <span className="spinner small" /> : <Icon name={preview.playing === key ? 'pause' : 'play'} size={16} />}
          </button>
          <button className="btn link small" onClick={() => (preview.stop(), setOpen(true))}>
            Change
          </button>
          <button className="icon-btn" aria-label="Remove music" onClick={() => (preview.stop(), onChange(null), setPicked(null))}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {maxStart > 0 && (
          <label className="mp-start">
            <span>
              Starts at <b>{fmtTime(value.start)}</b>
            </span>
            <input
              type="range"
              min={0}
              max={Math.floor(maxStart)}
              step={1}
              value={value.start}
              onChange={(e) => {
                const s = Number(e.target.value);
                onChange({ ...value, start: s });
                preview.seek(s);
              }}
              aria-label="Where the song starts"
            />
            <span className="muted">{fmtTime(dur)}</span>
          </label>
        )}
      </div>
    );
  }

  if (!open)
    return (
      <button type="button" className="mp-add" onClick={() => setOpen(true)}>
        <span className="mp-add-icon">
          <Icon name="music" size={18} />
        </span>
        <span className="mp-meta">
          <b>Add music</b>
          <span>Optional — search songs, artists or moods</span>
        </span>
        <span className="mp-go"><Icon name="chevron" size={16} /></span>
      </button>
    );

  return (
    <MusicSearch
      preview={preview}
      onCancel={() => (preview.stop(), setOpen(false))}
      onPick={(t) => {
        preview.stop();
        setPicked(t);
        onChange(toMemoryMusic(t, 0));
        setOpen(false);
      }}
    />
  );
}

function MusicSearch({ preview, onPick, onCancel }: { preview: ReturnType<typeof usePreview>; onPick: (t: Track) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    const t = window.setTimeout(
      async () => {
        setBusy(true);
        setError(null);
        try {
          const r = await searchMusic(q.trim(), 1);
          if (n !== seq.current) return;
          setTracks(r.tracks);
          setMore(r.next);
          setPage(1);
        } catch (e) {
          if (n === seq.current) setError((e as Error).message);
        } finally {
          if (n === seq.current) setBusy(false);
        }
      },
      q ? 350 : 0,
    );
    return () => window.clearTimeout(t);
  }, [q]);

  const loadMore = async () => {
    setBusy(true);
    try {
      const r = await searchMusic(q.trim(), page + 1);
      setTracks((old) => [...old, ...r.tracks.filter((t) => !old.some((o) => o.provider === t.provider && o.id === t.id))]);
      setMore(r.next);
      setPage(page + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-search">
      <div className="mp-head">
        <button className="icon-btn" onClick={onCancel} aria-label="Back">
          <span className="mp-back"><Icon name="chevron" size={16} /></span>
        </button>
        <div className="mp-input">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs, artists, moods…" autoFocus aria-label="Search music" />
          {busy && <span className="spinner small" />}
        </div>
      </div>
      <div className="mp-moods">
        {MOODS.map((m) => (
          <button key={m} className={q.toLowerCase() === m.toLowerCase() ? 'on' : ''} onClick={() => setQ(q.toLowerCase() === m.toLowerCase() ? '' : m)}>
            {m}
          </button>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="mp-list" role="listbox" aria-label="Songs">
        {!busy && !error && tracks.length === 0 && <p className="mp-empty">No songs match “{q}”. Try an artist, a mood or a genre.</p>}
        {tracks.map((t) => {
          const key = `${t.provider}:${t.id}`;
          const on = preview.playing === key;
          return (
            <div key={key} className={`mp-row${on ? ' on' : ''}`} role="option" aria-selected={false}>
              <button className="mp-play over" onClick={() => preview.toggle(key, t.audio)} aria-label={on ? `Pause ${t.title}` : `Preview ${t.title}`}>
                <Art src={t.artwork} />
                <span className="mp-play-icon">{preview.loading === key ? <span className="spinner small" /> : <Icon name={on ? 'pause' : 'play'} size={16} />}</span>
                {on && (
                  <span className="mp-eq" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </button>
              <button className="mp-pick" onClick={() => onPick(t)}>
                <span className="mp-meta">
                  <b>{t.title}</b>
                  <span>
                    {t.artist}
                    {t.tags.length > 0 && <em> · {t.tags.slice(0, 2).join(', ')}</em>}
                  </span>
                </span>
                <span className="mp-dur">{t.duration ? fmtTime(t.duration) : ''}</span>
                <span className="mp-use">Use</span>
              </button>
            </div>
          );
        })}
        {more && (
          <button className="btn secondary small mp-more" onClick={loadMore} disabled={busy}>
            Load more
          </button>
        )}
      </div>
      <p className="mp-credit">Music from Soundstripe</p>
    </div>
  );
}
