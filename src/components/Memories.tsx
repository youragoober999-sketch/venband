// Memories UI: the strip on a profile, and the full-screen viewer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Avatar, Icon } from './ui';
import { askConfirm } from './Dialogs';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { errorMessage } from '../lib/supabase';
import {
  addMemory, deleteMemory, hasUnseen, listMemories, markSeen, memoryViewers, onMemoriesChanged,
  MAX_MEMORIES, type Memory,
} from '../lib/memories';

function ago(v: string) {
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(v).toLocaleDateString();
}

export function useMemories(userId: string) {
  const [list, setList] = useState<Memory[] | null>(null);
  const load = useCallback((force = false) => listMemories(userId, force).then(setList).catch(() => setList([])), [userId]);
  useEffect(() => { load(); return onMemoriesChanged(() => load(true)); }, [load]);
  return { list: list ?? [], loaded: list !== null, reload: () => load(true) };
}

/** Thumbnails row on a profile. The owner also gets an "add" tile. */
export function MemoriesStrip({ userId, self }: { userId: string; self: boolean }) {
  const { list, loaded } = useMemories(userId);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  if (!loaded || (!self && list.length === 0)) return null;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    const caption = prompt('Add a caption (optional):', '') ?? '';
    try { await addMemory(f, caption, setBusy); } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(''); if (input.current) input.current.value = ''; }
  };

  return (
    <section className="mem-strip" aria-label="Memories">
      <div className="mem-strip-head">
        <span>Memories</span>
        <span className="muted tiny">{list.length}/{MAX_MEMORIES}</span>
      </div>
      <div className="mem-row">
        {self && list.length < MAX_MEMORIES && (
          <button className="mem-tile mem-add" onClick={() => input.current?.click()} disabled={!!busy} title="Add a photo or a video up to 30 seconds">
            {busy ? <span className="spinner small" /> : <Icon name="plus" size={20} />}
            <span>{busy || 'Add'}</span>
          </button>
        )}
        {list.map((m, i) => (
          <button key={m.id} className="mem-tile" onClick={() => setOpen(i)} title={m.caption || 'Open memory'}>
            {m.media_type === 'video'
              ? <video src={m.url} muted playsInline preload="metadata" />
              : <img src={m.url} alt={m.caption || 'Memory'} loading="lazy" />}
            {m.media_type === 'video' && <span className="mem-dur">{Math.round(m.duration_ms / 1000)}s</span>}
          </button>
        ))}
      </div>
      <input ref={input} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {err && <p className="small danger-text">{err}</p>}
      {open !== null && list.length > 0 && <MemoryViewer list={list} start={open} self={self} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Gradient ring for an avatar that has memories (bright when there are unseen ones). */
export function MemoryRing({ userId, children, onOpen }: { userId: string; children: React.ReactNode; onOpen: (list: Memory[]) => void }) {
  const { list } = useMemories(userId);
  if (!list.length) return <>{children}</>;
  return (
    <button className={`mem-ring${hasUnseen(list) ? ' unseen' : ''}`} onClick={() => onOpen(list)} aria-label="View memories">
      {children}
    </button>
  );
}

export function MemoryViewer({ list, start = 0, self, onClose }: { list: Memory[]; start?: number; self: boolean; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, list.length - 1));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [viewers, setViewers] = useState<{ viewer_id: string; seen_at: string }[] | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const m = list[i];
  const owner = getProfile(m?.user_id ?? '');

  const next = useCallback(() => { setProgress(0); setViewers(null); if (i + 1 < list.length) setI(i + 1); else onClose(); }, [i, list.length, onClose]);
  const prev = useCallback(() => { setProgress(0); setViewers(null); setI((v) => Math.max(0, v - 1)); }, []);

  useEffect(() => { if (m) markSeen(m).catch(() => {}); }, [m]);

  // image timer (videos drive progress from their own playback)
  useEffect(() => {
    if (!m || m.media_type === 'video' || paused) return;
    const started = performance.now() - progress * m.duration_ms;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - started) / m.duration_ms);
      setProgress(p);
      if (p >= 1) next(); else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, paused, next]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => {});
  }, [paused, i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  const showViewers = async () => {
    setPaused(true);
    const rows = await memoryViewers(m.id);
    await loadProfiles(rows.map((r) => r.viewer_id));
    setViewers(rows);
  };
  const remove = async () => {
    setPaused(true);
    if (!(await askConfirm({ title: 'Delete this memory?', body: 'It’s removed for everyone right away.', confirm: 'Delete', danger: true }))) return setPaused(false);
    try { await deleteMemory(m); onClose(); } catch (e) { alert(errorMessage(e)); }
  };

  if (!m) return null;
  return createPortal(
    <div className="mem-viewer" role="dialog" aria-label="Memories" onClick={onClose}>
      <div className="mem-stage" onClick={(e) => e.stopPropagation()}>
        <div className="mem-bars">
          {list.map((x, k) => (
            <span key={x.id}><i style={{ width: `${k < i ? 100 : k === i ? progress * 100 : 0}%` }} /></span>
          ))}
        </div>
        <header className="mem-top">
          {owner && <Avatar profile={owner} size={32} />}
          <div className="mem-who">
            <b>{displayName(m.user_id)}</b>
            <span>{ago(m.created_at)}</span>
          </div>
          <div className="mem-tools">
            {m.media_type === 'video' && (
              <button onClick={() => setMuted((v) => !v)} aria-label={muted ? 'Unmute' : 'Mute'}><Icon name="volume" size={18} />{muted && <s />}</button>
            )}
            <button onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} size={18} /></button>
            {self && <button onClick={remove} aria-label="Delete memory"><Icon name="trash" size={18} /></button>}
            <button onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
          </div>
        </header>

        <div
          className="mem-media"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          {m.media_type === 'video' ? (
            <video
              key={m.id}
              ref={video}
              src={m.url}
              autoPlay
              playsInline
              muted={muted}
              onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
              onEnded={next}
            />
          ) : (
            <img key={m.id} src={m.url} alt={m.caption || 'Memory'} draggable={false} />
          )}
          <button className="mem-tap left" onClick={prev} aria-label="Previous" />
          <button className="mem-tap right" onClick={next} aria-label="Next" />
        </div>

        {m.caption && <p className="mem-caption">{m.caption}</p>}
        {self && (
          <button className="mem-seen" onClick={showViewers}><Icon name="eye" size={15} /> Seen by</button>
        )}
        {viewers && (
          <div className="mem-viewers" onClick={(e) => e.stopPropagation()}>
            <div className="mem-viewers-head"><b>Seen by {viewers.length}</b><button onClick={() => { setViewers(null); setPaused(false); }} aria-label="Close"><Icon name="x" size={14} /></button></div>
            {viewers.length === 0 ? <p className="muted small">Nobody yet.</p> : viewers.map((v) => (
              <div key={v.viewer_id} className="mem-viewer-row">
                {getProfile(v.viewer_id) && <Avatar profile={getProfile(v.viewer_id)!} size={26} />}
                <span>{displayName(v.viewer_id)}</span>
                <span className="muted tiny">{ago(v.seen_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
