// GIF maker: turn pictures, an animated GIF or a video into a GIF, on device.
// Frames are pulled on the main thread (it needs <video> / canvas), encoding
// runs in a worker (gif.worker.ts) with progress, and everything is cancellable.
import type { GifFrame } from './encodeGif';

export type SourceKind = 'images' | 'gif' | 'video';
export interface Source {
  kind: SourceKind;
  files: File[];
  /** video length / total GIF length in seconds */
  duration: number;
  /** animated GIF: frame count */
  frames: number;
  width: number;
  height: number;
}
export interface GifOptions {
  maxSize: number; // longest side in px
  square: boolean; // centre crop to 1:1
  fps: number; // video
  start: number; // seconds (video) or frame index (gif)
  end: number;
  delayMs: number; // pictures: time per picture
  speed: number; // gif / video playback speed multiplier
  top: string; // caption at the top
  bottom: string; // caption at the bottom
}
export const MAX_FRAMES = 150;

interface DecodedImage {
  image: VideoFrame;
  complete: boolean;
}
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<DecodedImage>;
  close(): void;
}
type ImageDecoderCtor = new (init: { data: ReadableStream<Uint8Array> | ArrayBuffer; type: string }) => ImageDecoderLike;
const ImageDecoderImpl = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
/** Every frame of animated GIFs (Chrome / Edge / Safari 17+); elsewhere just the first. */
export const canReadGifFrames = Boolean(ImageDecoderImpl);

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    v.onloadeddata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) return resolve(v);
      // recorded WebM often has no stored length: seeking far past the end makes the browser work it out
      const done = () => {
        v.ontimeupdate = null;
        v.currentTime = 0;
        resolve(v);
      };
      v.ontimeupdate = () => Number.isFinite(v.duration) && done();
      setTimeout(done, 4000);
      v.currentTime = 1e7;
    };
    v.onerror = () => reject(new Error('This video format can’t be opened here. Try an MP4 or WebM.'));
  });
}
const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001) return resolve();
    v.onseeked = () => resolve();
    v.currentTime = t;
  });

/** Look at what was picked: pictures, one animated GIF, or one video. */
export async function inspect(files: File[]): Promise<Source> {
  const video = files.find((f) => f.type.startsWith('video/'));
  if (video) {
    const v = await loadVideo(video);
    const src: Source = { kind: 'video', files: [video], duration: Number.isFinite(v.duration) ? v.duration : 0, frames: 0, width: v.videoWidth, height: v.videoHeight };
    URL.revokeObjectURL(v.src);
    return src;
  }
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) throw new Error('Pick pictures, a GIF or a video.');
  if (images.length === 1 && images[0].type === 'image/gif' && ImageDecoderImpl) {
    const dec = new ImageDecoderImpl({ data: await images[0].arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack?.frameCount ?? 1;
    const first = await dec.decode({ frameIndex: 0 });
    let total = 0;
    for (let i = 0; i < Math.min(count, 400); i++) total += ((await dec.decode({ frameIndex: i })).image.duration ?? 100_000) / 1e6;
    const src: Source = { kind: 'gif', files: images, duration: total, frames: count, width: first.image.displayWidth, height: first.image.displayHeight };
    dec.close();
    if (count > 1) return src;
  }
  const b = await createImageBitmap(images[0]);
  const src: Source = { kind: 'images', files: images.slice(0, 30), duration: 0, frames: images.length, width: b.width, height: b.height };
  b.close();
  return src;
}

export function defaultOptions(src: Source): GifOptions {
  return {
    maxSize: 360,
    square: false,
    fps: 12,
    start: 0,
    end: src.kind === 'video' ? Math.min(src.duration, 6) : src.kind === 'gif' ? src.frames - 1 : 0,
    delayMs: 600,
    speed: 1,
    top: '',
    bottom: '',
  };
}

/** Canvas size for these options (keeps the aspect ratio unless square). */
export function outputSize(src: Source, o: GifOptions) {
  const w0 = o.square ? Math.min(src.width, src.height) : src.width;
  const h0 = o.square ? Math.min(src.width, src.height) : src.height;
  const r = Math.min(1, o.maxSize / Math.max(w0, h0, 1));
  return { w: Math.max(2, Math.round(w0 * r)), h: Math.max(2, Math.round(h0 * r)) };
}

/** How many frames these options produce (so the UI can warn before building). */
export function frameCount(src: Source, o: GifOptions): number {
  if (src.kind === 'images') return src.files.length;
  if (src.kind === 'gif') return Math.max(1, o.end - o.start + 1);
  return Math.max(1, Math.floor((o.end - o.start) * o.fps));
}

/** Meme-style caption: bold white text with a dark outline, wrapped to fit. */
function caption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, top: boolean) {
  const t = text.trim().toUpperCase();
  if (!t) return;
  let size = Math.max(14, Math.round(w / 9));
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const lines = (fs: number) => {
    ctx.font = `900 ${fs}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
    const out: string[] = [];
    let line = '';
    for (const word of t.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > w * 0.92 && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  let ls = lines(size);
  while ((ls.length > 3 || ls.some((l) => ctx.measureText(l).width > w * 0.95)) && size > 12) ls = lines((size -= 2));
  ctx.lineWidth = Math.max(2, size / 7);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  ls.forEach((l, i) => {
    const y = top ? size * (i + 1) + 4 : h - 8 - (ls.length - 1 - i) * size;
    ctx.strokeText(l, w / 2, y);
    ctx.fillText(l, w / 2, y);
  });
}

function draw(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, w: number, h: number, o: GifOptions) {
  ctx.clearRect(0, 0, w, h);
  if (o.square) {
    const s = Math.min(iw, ih);
    ctx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, w, h);
  } else {
    const s = Math.min(w / iw, h / ih);
    ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
  }
  caption(ctx, o.top, w, h, true);
  caption(ctx, o.bottom, w, h, false);
}

/** Pull the frames out (progress 0..1). */
export async function extractFrames(src: Source, o: GifOptions, onProgress: (p: number) => void, signal: AbortSignal): Promise<{ w: number; h: number; frames: GifFrame[] }> {
  const { w, h } = outputSize(src, o);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: GifFrame[] = [];
  const grab = (delayMs: number) => frames.push({ data: ctx.getImageData(0, 0, w, h).data, delayMs: Math.max(20, Math.round(delayMs / 10) * 10) });
  const check = () => {
    if (signal.aborted) throw new Cancelled();
  };

  if (src.kind === 'images') {
    for (let i = 0; i < src.files.length; i++) {
      check();
      const b = await createImageBitmap(src.files[i]);
      draw(ctx, b, b.width, b.height, w, h, o);
      b.close();
      grab(o.delayMs);
      onProgress((i + 1) / src.files.length);
    }
  } else if (src.kind === 'gif' && ImageDecoderImpl) {
    const dec = new ImageDecoderImpl({ data: await src.files[0].arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const last = Math.min(o.end, src.frames - 1, o.start + MAX_FRAMES - 1);
    try {
      for (let i = o.start; i <= last; i++) {
        check();
        const { image } = await dec.decode({ frameIndex: i });
        draw(ctx, image as unknown as CanvasImageSource, image.displayWidth, image.displayHeight, w, h, o);
        grab(((image.duration ?? 100_000) / 1000) / o.speed);
        image.close();
        onProgress((i - o.start + 1) / (last - o.start + 1));
      }
    } finally {
      dec.close();
    }
  } else {
    const v = await loadVideo(src.files[0]);
    try {
      const n = Math.min(MAX_FRAMES, frameCount(src, o));
      const step = (o.end - o.start) / n;
      for (let i = 0; i < n; i++) {
        check();
        await seek(v, Math.min(src.duration - 0.01, o.start + i * step));
        draw(ctx, v, v.videoWidth, v.videoHeight, w, h, o);
        grab((step * 1000) / o.speed);
        onProgress((i + 1) / n);
      }
    } finally {
      URL.revokeObjectURL(v.src);
      v.removeAttribute('src');
      v.load();
    }
  }
  return { w, h, frames };
}

/** Encode in a worker (progress 0..1). Rejects with Cancelled when the signal aborts. */
export function encodeInWorker(w: number, h: number, frames: GifFrame[], onProgress: (p: number) => void, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./encodeGif.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
      reject(new Cancelled());
    };
    signal.addEventListener('abort', stop, { once: true });
    worker.onmessage = (e: MessageEvent<{ type: string; p?: number; blob?: Blob; message?: string }>) => {
      if (e.data.type === 'progress') onProgress(e.data.p ?? 0);
      else {
        signal.removeEventListener('abort', stop);
        worker.terminate();
        if (e.data.type === 'done' && e.data.blob) resolve(e.data.blob);
        else reject(new Error(e.data.message || 'Encoding failed'));
      }
    };
    worker.onerror = (e) => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
      reject(new Error(e.message || 'Encoding failed'));
    };
    // hand the pixel buffers over instead of copying them
    worker.postMessage({ width: w, height: h, frames }, frames.map((f) => f.data.buffer as ArrayBuffer));
  });
}
