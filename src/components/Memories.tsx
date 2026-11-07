// Memories UI: the strip on a profile, and the full-screen viewer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Avatar, Field, Icon, Modal } from './ui';
import { askConfirm, askText, showAlert } from './Dialogs';
import { Select } from './Select';
import { reportItem } from '../lib/staff';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { errorMessage } from '../lib/supabase';
import {
  addMemory, AUDIENCE_LABEL, deleteMemory, hasUnseen, isShowing, listMemories, markSeen, memoryViewers, onMemoriesChanged, updateMemory,
  MAX_MEMORIES, MAX_SHOWING, type Audience, type Memory, type NewMemory,
} from '../lib/memories';
import { audioFor, type MemoryMusic } from '../lib/music';
import { MusicPicker } from './MusicPicker';

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

/** Thumbnails row on a profile. The owner also gets "add", their archive and per-memory settings. */
export function MemoriesStrip({ userId, self }: { userId: string; self: boolean }) {
  const { list, loaded } = useMemories(userId);
  const [open, setOpen] = useState<{ list: Memory[]; i: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<File | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const showing = list.filter(isShowing);
  const archived = list.filter((m) => !isShowing(m));
  if (!loaded || (!self && showing.length === 0)) return null;

  const add = async (f: File, opts: NewMemory) => {
    setPending(null);
    setErr('');
    try {
      const m = await addMemory(f, opts, setBusy);
      if (m.active === false) setErr(`${MAX_SHOWING} memories are already showing, so this one went to your archive. Archive another to show it.`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy('');
      if (input.current) input.current.value = '';
    }
  };

  const tile = (m: Memory, i: number, from: Memory[]) => (
    <button key={m.id} className={`mem-tile${isShowing(m) ? '' : ' archived'}`} onClick={() => setOpen({ list: from, i })} title={m.caption || 'Open memory'}>
      {m.media_type === 'video' ? <video src={m.url} muted playsInline preload="metadata" /> : <img src={m.url} alt={m.caption || 'Memory'} loading="lazy" />}
      {m.media_type === 'video' && <span className="mem-dur">{Math.round(m.duration_ms / 1000)}s</span>}
      {self && m.audience && m.audience !== 'everyone' && (
        <span className="mem-aud" title={AUDIENCE_LABEL[m.audience]}>
          <Icon name={m.audience === 'friends' ? 'users' : 'lock'} size={11} />
        </span>
      )}
    </button>
  );

  return (
    <section className="mem-strip" aria-label="Memories">
      <div className="mem-strip-head">
        <span>Memories</span>
        {self && (
          <span className="muted tiny" title={`Up to ${MAX_SHOWING} show at once; keep up to ${MAX_MEMORIES}`}>
            {showing.length}/{MAX_SHOWING} showing · {list.length}/{MAX_MEMORIES} kept
          </span>
        )}
      </div>
      <div className="mem-row">
        {self && list.length < MAX_MEMORIES && (
          <button className="mem-tile mem-add" onClick={() => input.current?.click()} disabled={!!busy} title="Add a photo or a video up to 30 seconds">
            {busy ? <span className="spinner small" /> : <Icon name="plus" size={20} />}
            <span>{busy || 'Add'}</span>
          </button>
        )}
        {showing.map((m, i) => tile(m, i, showing))}
      </div>
      {self && archived.length > 0 && (
        <>
          <button className="btn link small" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
            {showArchive ? 'Hide archive' : `Archive (${archived.length})`}
          </button>
          {showArchive && <div className="mem-row">{archived.map((m, i) => tile(m, i, archived))}</div>}
        </>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setPending(f);
        }}
      />
      {err && <p className="small muted">{err}</p>}
      {pending && <AddMemoryModal file={pending} onCancel={() => (setPending(null), input.current && (input.current.value = ''))} onAdd={(o) => add(pending, o)} />}
      {open && open.list.length > 0 && <MemoryViewer list={open.list} start={open.i} self={self} onClose={() => setOpen(null)} />}
    </section>
  );
}

const EXPIRY: { hours: number | null; label: string }[] = [
  { hours: null, label: 'Never' },
  { hours: 24, label: 'After 24 hours' },
  { hours: 72, label: 'After 3 days' },
  { hours: 168, label: 'After a week' },
  { hours: 720, label: 'After 30 days' },
];

export function AddMemoryModal({ file, onCancel, onAdd }: { file: File; onCancel: () => void; onAdd: (o: NewMemory) => void }) {
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [expires, setExpires] = useState<number | null>(null);
  const [music, setMusic] = useState<MemoryMusic | null>(null);
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <Modal title="New memory" onClose={onCancel}>
      <div className="mem-new">
        {file.type.startsWith('video/') ? <video src={url} muted playsInline autoPlay loop className="mem-new-preview" /> : <img src={url} alt="" className="mem-new-preview" />}
        <Field label="Caption (optional)">
          <input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} placeholder="Say something about it" autoFocus />
        </Field>
        <Field label="Music">
          <MusicPicker value={music} onChange={setMusic} clipSeconds={file.type.startsWith('video/') ? 30 : 6} />
        </Field>
        <Field label="Who can see it">
          <Select value={audience} onChange={(v) => setAudience(v as Audience)} ariaLabel="Who can see it" options={(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))} />
        </Field>
        <Field label="Stop showing it" hint="It moves to your archive then — you keep it.">
          <Select value={String(expires)} onChange={(v) => setExpires(v === 'null' ? null : Number(v))} ariaLabel="Expiry" options={EXPIRY.map((e) => ({ value: String(e.hours), label: e.label }))} />
        </Field>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onAdd({ caption, audience, expiresInHours: expires, music })}>
          Add memory
        </button>
      </div>
    </Modal>
  );
}

/** Gradient ring for an avatar that has memories (bright when there are unseen ones). */
export function MemoryRing({ userId, children, onOpen }: { userId: string; children: React.ReactNode; onOpen: (list: Memory[]) => void }) {
  const list = useMemories(userId).list.filter(isShowing);
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
  const [muted, setMuted] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const song = useRef<HTMLAudioElement>(null);
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
    // sound needs a click first in some browsers: fall back to muted
    if (paused) v.pause(); else v.play().catch(() => { setMuted(true); v.muted = true; v.play().catch(() => {}); });
  }, [paused, i]);

  // the memory's song: fetch a fresh link and play from the chosen spot
  useEffect(() => {
    const a = song.current;
    setMusicOn(false);
    if (!a) return;
    a.pause();
    if (!m?.music) {
      a.removeAttribute('src');
      return;
    }
    const music = m.music;
    let gone = false;
    audioFor(music)
      .then((src) => {
        if (gone || !src) return;
        a.src = src;
        a.onloadedmetadata = () => { a.currentTime = Math.min(music.start || 0, Math.max(0, a.duration - 1)); };
        a.play().then(() => !gone && setMusicOn(true)).catch(() => {});
      })
      .catch(() => {});
    return () => { gone = true; a.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id]);
  useEffect(() => {
    const a = song.current;
    if (!a || !a.getAttribute('src')) return;
    if (paused) { a.pause(); setMusicOn(false); } else a.play().then(() => setMusicOn(true)).catch(() => {});
  }, [paused]);

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
  const toggleArchive = async () => {
    try {
      if (isShowing(m)) await updateMemory(m, { active: false, expires_at: null });
      else await updateMemory(m, { active: true, expires_at: null });
      onClose();
    } catch (e) {
      showAlert(errorMessage(e));
    }
  };
  const report = async () => {
    setPaused(true);
    const reason = await askText({ title: 'Report this memory', label: 'What’s wrong with it?', maxLength: 1000 });
    if (reason?.trim()) {
      try {
        await reportItem('memory', m.id, reason.trim());
        showAlert('Reported — Venband staff will take a look.');
      } catch (e) {
        showAlert(errorMessage(e));
      }
    }
    setPaused(false);
  };
  const remove = async () => {
    setPaused(true);
    if (!(await askConfirm({ title: 'Delete this memory?', body: 'It’s removed for everyone right away.', confirm: 'Delete', danger: true }))) return setPaused(false);
    try { await deleteMemory(m); onClose(); } catch (e) { showAlert(errorMessage(e)); }
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
            {(m.media_type === 'video' || m.music) && (
              <button onClick={() => setMuted((v) => !v)} aria-label={muted ? 'Unmute' : 'Mute'}><Icon name="volume" size={18} />{muted && <s />}</button>
            )}
            <button onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} size={18} /></button>
            {self && (
              <button onClick={toggleArchive} aria-label={isShowing(m) ? 'Archive (hide from your profile)' : 'Show on your profile again'} title={isShowing(m) ? 'Archive' : 'Show again'}>
                <Icon name={isShowing(m) ? 'archive' : 'eye'} size={18} />
              </button>
            )}
            {self && <button onClick={remove} aria-label="Delete memory"><Icon name="trash" size={18} /></button>}
            {!self && <button onClick={report} aria-label="Report memory" title="Report"><Icon name="flag" size={18} /></button>}
            <button onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
          </div>
        </header>

        {m.music && (
          <div className={`mem-music${musicOn ? ' playing' : ''}`} title={`${m.music.title} — ${m.music.artist}`}>
            {m.music.artwork ? <img src={m.music.artwork} alt="" referrerPolicy="no-referrer" /> : <Icon name="music" size={16} />}
            <span>
              <b>{m.music.title}</b> · {m.music.artist}
            </span>
          </div>
        )}
        <audio ref={song} muted={muted} preload="auto" loop hidden />

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
              muted={muted || Boolean(m.music)}
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
          <p className="mem-meta">
            {!isShowing(m) ? 'Archived — only you see it' : AUDIENCE_LABEL[m.audience ?? 'everyone']}
            {isShowing(m) && m.expires_at && ` · stops showing ${new Date(m.expires_at).toLocaleString()}`}
          </p>
        )}
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
