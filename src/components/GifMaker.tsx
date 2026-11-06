// Make a GIF from pictures, an animated GIF or a video — trim, size, crop,
// captions; encoded in the background with progress and Cancel.
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/supabase';
import { Cancelled, canReadGifFrames, defaultOptions, encodeInWorker, extractFrames, frameCount, inspect, MAX_FRAMES, outputSize, type GifOptions, type Source } from '../lib/gifmaker';
import { Icon } from './ui';
import { Select } from './Select';

const fmt = (s: number) => `${s.toFixed(1)}s`;

export function GifMaker({ onDone }: { onDone: (f: File) => void }) {
  const [src, setSrc] = useState<Source | null>(null);
  const [o, setO] = useState<GifOptions | null>(null);
  const [stage, setStage] = useState<{ label: string; p: number } | null>(null);
  const [result, setResult] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);
  useEffect(() => () => abort.current?.abort(), []);

  const set = (patch: Partial<GifOptions>) => {
    setO((x) => (x ? { ...x, ...patch } : x));
    setResult(null);
  };

  async function pick(files: File[]) {
    setError(null);
    setResult(null);
    try {
      const s = await inspect(files);
      setSrc(s);
      setO(defaultOptions(s));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function build() {
    if (!src || !o) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    setResult(null);
    try {
      setStage({ label: 'Reading frames…', p: 0 });
      const { w, h, frames } = await extractFrames(src, o, (p) => setStage({ label: 'Reading frames…', p: p * 0.5 }), ctl.signal);
      setStage({ label: 'Making the GIF…', p: 0.5 });
      const blob = await encodeInWorker(w, h, frames, (p) => setStage({ label: 'Making the GIF…', p: 0.5 + p * 0.5 }), ctl.signal);
      const name = (src.files[0]?.name.replace(/\.[^.]+$/, '') || 'venband') + '.gif';
      const file = new File([blob], name, { type: 'image/gif' });
      setResult({ file, url: URL.createObjectURL(file) });
    } catch (e) {
      if (!(e instanceof Cancelled)) setError(`Couldn’t make the GIF: ${errorMessage(e)}`);
    } finally {
      setStage(null);
      abort.current = null;
    }
  }

  const n = src && o ? frameCount(src, o) : 0;
  const size = src && o ? outputSize(src, o) : null;
  return (
    <div className="make-gif">
      <p className="small muted">
        Turn pictures, a GIF or a video into a GIF. It’s made on your device and sent encrypted.
        {!canReadGifFrames && ' (Your browser can only read the first frame of an animated GIF.)'}
      </p>
      <label className="btn secondary small">
        <Icon name="image" size={16} /> {src ? 'Choose something else' : 'Choose pictures, a GIF or a video'}
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            if (list.length) pick(list);
          }}
        />
      </label>

      {src && o && (
        <div className="gif-controls">
          <div className="small muted">
            {src.kind === 'video' ? `Video · ${fmt(src.duration)}` : src.kind === 'gif' ? `Animated GIF · ${src.frames} frames` : `${src.files.length} picture${src.files.length === 1 ? '' : 's'}`} · {src.width}×{src.height}
          </div>

          {src.kind === 'video' && (
            <>
              <label className="gif-range">
                <span>Start {fmt(o.start)}</span>
                <input type="range" min={0} max={Math.max(0, src.duration - 0.2)} step={0.1} value={o.start} aria-valuetext={fmt(o.start)}
                  onChange={(e) => { const v = Number(e.target.value); set({ start: v, end: Math.max(o.end, Math.min(src.duration, v + 0.2)) }); }} />
              </label>
              <label className="gif-range">
                <span>End {fmt(o.end)} ({fmt(o.end - o.start)} long)</span>
                <input type="range" min={0.2} max={src.duration} step={0.1} value={o.end} aria-valuetext={fmt(o.end)}
                  onChange={(e) => { const v = Number(e.target.value); set({ end: v, start: Math.min(o.start, Math.max(0, v - 0.2)) }); }} />
              </label>
              <div className="gif-row">
                <span className="small">Smoothness</span>
                <Select value={String(o.fps)} ariaLabel="Frames per second" onChange={(v) => set({ fps: Number(v) })}
                  options={[{ value: '6', label: '6 fps (small)' }, { value: '10', label: '10 fps' }, { value: '12', label: '12 fps' }, { value: '15', label: '15 fps' }, { value: '20', label: '20 fps (smooth)' }]} />
              </div>
            </>
          )}
          {src.kind === 'gif' && (
            <>
              <label className="gif-range">
                <span>First frame {o.start + 1}</span>
                <input type="range" min={0} max={src.frames - 1} step={1} value={o.start} onChange={(e) => { const v = Number(e.target.value); set({ start: v, end: Math.max(o.end, v) }); }} />
              </label>
              <label className="gif-range">
                <span>Last frame {o.end + 1}</span>
                <input type="range" min={0} max={src.frames - 1} step={1} value={o.end} onChange={(e) => { const v = Number(e.target.value); set({ end: v, start: Math.min(o.start, v) }); }} />
              </label>
            </>
          )}
          {(src.kind === 'gif' || src.kind === 'video') && (
            <div className="gif-row">
              <span className="small">Speed</span>
              <Select value={String(o.speed)} ariaLabel="Playback speed" onChange={(v) => set({ speed: Number(v) })}
                options={[{ value: '0.5', label: '0.5× (slow-mo)' }, { value: '1', label: '1×' }, { value: '1.5', label: '1.5×' }, { value: '2', label: '2× (fast)' }]} />
            </div>
          )}
          {src.kind === 'images' && src.files.length > 1 && (
            <label className="gif-range">
              <span>{(o.delayMs / 1000).toFixed(1)}s per picture</span>
              <input type="range" min={100} max={3000} step={100} value={o.delayMs} aria-valuetext={`${(o.delayMs / 1000).toFixed(1)} seconds per picture`} onChange={(e) => set({ delayMs: Number(e.target.value) })} />
            </label>
          )}

          <div className="gif-row">
            <span className="small">Size</span>
            <Select value={String(o.maxSize)} ariaLabel="Size" onChange={(v) => set({ maxSize: Number(v) })}
              options={[{ value: '240', label: 'Small (240px)' }, { value: '360', label: 'Medium (360px)' }, { value: '480', label: 'Large (480px)' }]} />
            <label className="check-inline">
              <input type="checkbox" checked={o.square} onChange={(e) => set({ square: e.target.checked })} /> Square crop
            </label>
          </div>
          <input className="gif-caption" placeholder="Top text (optional)" maxLength={80} value={o.top} onChange={(e) => set({ top: e.target.value })} aria-label="Top caption" />
          <input className="gif-caption" placeholder="Bottom text (optional)" maxLength={80} value={o.bottom} onChange={(e) => set({ bottom: e.target.value })} aria-label="Bottom caption" />
          <div className="small muted">
            {Math.min(n, MAX_FRAMES)} frame{n === 1 ? '' : 's'} · {size?.w}×{size?.h}
            {n > MAX_FRAMES && ` — only the first ${MAX_FRAMES} are used; shorten the clip or lower the smoothness`}
          </div>

          {stage ? (
            <div className="gif-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.p * 100)} aria-label={stage.label}>
              <div className="gif-progress-bar">
                <div style={{ width: `${Math.round(stage.p * 100)}%` }} />
              </div>
              <span className="small">
                {stage.label} {Math.round(stage.p * 100)}%
              </span>
              <button className="btn link small" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            </div>
          ) : (
            !result && (
              <button className="btn primary small" onClick={build}>
                Make GIF
              </button>
            )
          )}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {result && (
        <>
          <img className="make-gif-preview" src={result.url} alt="GIF preview" />
          <div className="small muted">{(result.file.size / 1024 / 1024).toFixed(result.file.size > 1024 * 1024 ? 1 : 2)} MB</div>
          <div className="row-start">
            <button className="btn primary small" onClick={() => onDone(result.file)}>
              Send GIF
            </button>
            <button className="btn link small" onClick={() => setResult(null)}>
              Change settings
            </button>
          </div>
        </>
      )}
    </div>
  );
}
