// Crop and zoom a picture before it's used as an icon, avatar or banner.
// Re-drawing it on a canvas also strips hidden metadata (camera, GPS…).
import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';

export interface CropOptions {
  /** width / height of the result */
  aspect: number;
  /** output size in pixels (longest side) */
  size: number;
  round?: boolean;
  title?: string;
}

export function ImageCropper({ file, opts, onDone, onCancel }: { file: File; opts: CropOptions; onDone: (b: Blob) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const VIEW_W = 360;
  const VIEW_H = Math.round(VIEW_W / opts.aspect);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    let live = true; // a cancelled load (e.g. React re-running this) must not report an error
    i.onload = () => live && (setError(null), setImg(i));
    i.onerror = () => live && setError('That file isn’t a picture we can read. Try a PNG, JPG, GIF or WebP.');
    i.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // the picture's size at zoom 1 covers the frame
  const base = img ? Math.max(VIEW_W / img.width, VIEW_H / img.height) : 1;
  const scale = base * zoom;
  const clamp = (o: { x: number; y: number }) => {
    if (!img) return o;
    const w = img.width * scale;
    const h = img.height * scale;
    const mx = Math.max(0, (w - VIEW_W) / 2);
    const my = Math.max(0, (h - VIEW_H) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };

  function render() {
    if (!img) return;
    const outW = opts.aspect >= 1 ? opts.size : Math.round(opts.size * opts.aspect);
    const outH = Math.round(outW / opts.aspect);
    const k = outW / VIEW_W;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(outW / 2 + off.x * k, outH / 2 + off.y * k);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.drawImage(img, (-img.width * scale * k) / 2, (-img.height * scale * k) / 2, img.width * scale * k, img.height * scale * k);
    canvas.toBlob((b) => (b ? onDone(b) : setError('Could not save that picture.')), 'image/webp', 0.92);
  }

  return (
    <Modal title={opts.title ?? 'Crop picture'} onClose={onCancel}>
      {error ? (
        <div className="form-error">{error}</div>
      ) : (
        <>
          <div
            className={`cropper${opts.round ? ' round' : ''}`}
            style={{ width: VIEW_W, height: VIEW_H }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onWheel={(e) => setZoom((z) => Math.max(1, Math.min(5, z - e.deltaY * 0.0015)))}
          >
            {img && (
              <img
                src={img.src}
                alt=""
                draggable={false}
                style={{
                  width: img.width * scale,
                  height: img.height * scale,
                  transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px)) rotate(${rotate}deg)`,
                }}
              />
            )}
            <div className="cropper-mask" aria-hidden />
          </div>
          <div className="cropper-controls">
            <span className="small muted">Zoom</span>
            <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={(e) => (setZoom(Number(e.target.value)), setOff((o) => clamp(o)))} aria-label="Zoom" />
            <button className="btn small secondary" onClick={() => setRotate((r) => (r + 90) % 360)}>
              Rotate
            </button>
          </div>
          <p className="small muted">Drag to move, scroll or use the slider to zoom.</p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn primary" disabled={!img} onClick={render}>
              Apply
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
