// /caption: put a white band with bold black text on top of a picture or GIF
// (the classic captioned-meme look). Runs on your device; animated GIFs stay
// animated where the browser can read GIF frames (Chrome, Edge, Safari 17+).
import type { DecryptedMessage } from './keyring';
import { downloadDecrypted, fileKind } from './files';
import { encodeInWorker, MAX_FRAMES, Cancelled } from '../features/gifs/gifMakerPipeline';
import { gifBySlug } from './klipy';

const FONT = '"Inter", "Arial Black", "Helvetica Neue", Arial, sans-serif';

/** Split text into lines that fit `max` pixels wide (long words are broken). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(tryLine).width <= max) {
        line = tryLine;
        continue;
      }
      if (line) lines.push(line);
      // a single word wider than the picture: break it by characters
      let chunk = '';
      for (const ch of [...word]) {
        if (ctx.measureText(chunk + ch).width > max && chunk) {
          lines.push(chunk);
          chunk = '';
        }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

/** Band layout for a picture `w` wide. */
function layout(text: string, w: number) {
  const probe = document.createElement('canvas').getContext('2d')!;
  let size = Math.max(16, Math.min(80, Math.round(w / 9)));
  let lines: string[] = [];
  // shrink long captions so the band never gets taller than the picture is wide
  for (;;) {
    probe.font = `900 ${size}px ${FONT}`;
    lines = wrap(probe, text, w * 0.9);
    if (lines.length * size * 1.18 < w * 0.9 || size <= 14) break;
    size = Math.round(size * 0.88);
  }
  const pad = Math.round(size * 0.55);
  return { size, lines, band: Math.round(lines.length * size * 1.18 + pad * 2), pad };
}

function paintBand(ctx: CanvasRenderingContext2D, w: number, l: ReturnType<typeof layout>) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, l.band);
  ctx.fillStyle = '#000000';
  ctx.font = `900 ${l.size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = l.size * 1.18;
  l.lines.forEach((line, i) => ctx.fillText(line, w / 2, l.pad + lh * i + lh / 2));
}

interface DecodedImage {
  image: VideoFrame;
}
interface Decoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<DecodedImage>;
  close(): void;
}
const ImageDecoderImpl = (globalThis as unknown as { ImageDecoder?: new (i: { data: ArrayBuffer; type: string }) => Decoder }).ImageDecoder;

/** The captioned picture: a GIF stays a GIF; everything else becomes a PNG. */
export async function captionImage(blob: Blob, text: string, name = 'caption'): Promise<File> {
  text = text.trim();
  if (!text) throw new Error('Add the caption text: /caption when you see it');
  if (text.length > 300) throw new Error('Keep the caption under 300 characters.');
  const base = name.replace(/\.[^.]+$/, '').slice(0, 60) || 'caption';

  if (blob.type === 'image/gif' && ImageDecoderImpl) {
    const dec = new ImageDecoderImpl({ data: await blob.arrayBuffer(), type: 'image/gif' });
    try {
      await dec.tracks.ready;
      const count = Math.min(dec.tracks.selectedTrack?.frameCount ?? 1, MAX_FRAMES);
      if (count > 1) {
        const first = (await dec.decode({ frameIndex: 0 })).image;
        const scale = Math.min(1, 420 / Math.max(first.displayWidth, first.displayHeight));
        const w = Math.max(2, Math.round(first.displayWidth * scale));
        const h = Math.max(2, Math.round(first.displayHeight * scale));
        first.close();
        const l = layout(text, w);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h + l.band;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const frames = [];
        for (let i = 0; i < count; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, canvas.height);
          ctx.drawImage(image as unknown as CanvasImageSource, 0, l.band, w, h);
          paintBand(ctx, w, l);
          frames.push({ data: ctx.getImageData(0, 0, w, canvas.height).data, delayMs: Math.max(20, Math.round((image.duration ?? 100_000) / 10_000) * 10) });
          image.close();
        }
        const out = await encodeInWorker(w, canvas.height, frames, () => {}, new AbortController().signal).catch((e) => {
          throw e instanceof Cancelled ? new Error('Cancelled.') : e;
        });
        return new File([out], `${base}-caption.gif`, { type: 'image/gif' });
      }
    } finally {
      dec.close();
    }
  }

  // a still picture (or the first frame where GIF frames can't be read)
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const w = Math.max(2, Math.round(bmp.width * scale));
  const h = Math.max(2, Math.round(bmp.height * scale));
  const l = layout(text, w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + l.band;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, l.band, w, h);
  bmp.close();
  paintBand(ctx, w, l);
  const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t draw the caption.'))), 'image/png'));
  return new File([png], `${base}-caption.png`, { type: 'image/png' });
}

/** The picture or GIF in a message: an attachment, or a GIF link. */
export async function imageOf(m: DecryptedMessage | null): Promise<{ blob: Blob; name: string } | null> {
  if (!m) return null;
  const att = m.payload?.attachments?.find((a) => fileKind(a) === 'image');
  if (att) return { blob: await downloadDecrypted(att), name: att.name };
  const url = /https?:\/\/\S+/i.exec(m.payload?.text ?? '')?.[0];
  if (!url) return null;
  let src = url;
  const slug = /klipy\.com\/gifs\/([\w-]{1,80})/i.exec(url)?.[1];
  if (slug) src = (await gifBySlug(slug).catch(() => null))?.url ?? '';
  if (!src || !/\.(gif|png|jpe?g|webp|avif)(\?|$)/i.test(new URL(src).pathname + new URL(src).search)) return null;
  const r = await fetch(src, { referrerPolicy: 'no-referrer' }).catch(() => null);
  if (!r?.ok) throw new Error('Couldn’t download that GIF to caption it.');
  const blob = await r.blob();
  if (!blob.type.startsWith('image/')) return null;
  return { blob, name: 'gif' };
}

/** True when a message has something /caption can work on. */
export function hasCaptionable(m: DecryptedMessage | null): boolean {
  if (!m) return false;
  if (m.payload?.attachments?.some((a) => fileKind(a) === 'image')) return true;
  return /https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?|klipy\.com\/gifs\//i.test(m.payload?.text ?? '');
}
