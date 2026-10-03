// Tiny GIF89a encoder, used to turn pictures into (animated) GIFs on-device.

export interface GifFrame {
  data: Uint8ClampedArray; // RGBA
  delayMs: number;
}

/** Up to 256 colours by popularity over a 15-bit colour histogram. */
function buildPalette(frames: GifFrame[]): { palette: Uint8Array; lookup: Map<number, number> } {
  const counts = new Map<number, number>();
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * 3) {
      if (d[i + 3] < 128) continue;
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  // greedy: most common colours first, skipping ones too close to a chosen one
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const chosen: number[] = [];
  for (const minDist of [6, 3, 1, 0]) {
    for (const k of sorted) {
      if (chosen.length >= 255) break;
      if (chosen.includes(k)) continue;
      const r = k >> 10, g = (k >> 5) & 31, b = k & 31;
      if (chosen.every((c) => Math.abs((c >> 10) - r) + Math.abs(((c >> 5) & 31) - g) + Math.abs((c & 31) - b) >= minDist)) chosen.push(k);
    }
    if (chosen.length >= 255 || chosen.length === sorted.length) break;
  }
  if (!chosen.length) chosen.push(0);
  const palette = new Uint8Array(256 * 3);
  chosen.forEach((k, i) => {
    palette[i * 3] = ((k >> 10) << 3) | 4;
    palette[i * 3 + 1] = (((k >> 5) & 31) << 3) | 4;
    palette[i * 3 + 2] = ((k & 31) << 3) | 4;
  });
  return { palette, lookup: new Map(chosen.map((k, i) => [k, i])) };
}

const TRANSPARENT = 255;

function indexFrame(f: GifFrame, palette: Uint8Array, lookup: Map<number, number>, used: number): Uint8Array {
  const d = f.data;
  const out = new Uint8Array(d.length / 4);
  const cache = new Map<number, number>(lookup);
  for (let p = 0, i = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] < 128) {
      out[p] = TRANSPARENT;
      continue;
    }
    const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < used; c++) {
        const dr = palette[c * 3] - d[i], dg = palette[c * 3 + 1] - d[i + 1], db = palette[c * 3 + 2] - d[i + 2];
        const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (dist < bestD) {
          bestD = dist;
          best = c;
        }
      }
      idx = best;
      cache.set(key, idx);
    }
    out[p] = idx;
  }
  return out;
}

function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const bytes: number[] = [];
  let cur = 0;
  let bits = 0;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<string, number>();
  const write = (code: number) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(cur & 0xff);
      cur >>= 8;
      bits -= 8;
    }
  };
  write(clear);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = `${prefix},${k}`;
    if (dict.has(key)) {
      prefix = key;
      continue;
    }
    write(prefix.includes(',') ? dict.get(prefix)! : Number(prefix));
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      write(clear);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = String(k);
  }
  write(prefix.includes(',') ? dict.get(prefix)! : Number(prefix));
  write(eoi);
  if (bits > 0) bytes.push(cur & 0xff);
  return Uint8Array.from(bytes);
}

export function encodeGif(width: number, height: number, frames: GifFrame[], loop = true): Blob {
  const { palette, lookup } = buildPalette(frames);
  const used = Math.max(1, lookup.size);
  const parts: number[] = [];
  const push16 = (n: number) => parts.push(n & 0xff, (n >> 8) & 0xff);
  // header + logical screen (global colour table of 256)
  parts.push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
  push16(width);
  push16(height);
  parts.push(0xf7, 0, 0);
  parts.push(...palette);
  if (loop && frames.length > 1) parts.push(0x21, 0xff, 0x0b, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (const f of frames) {
    // graphic control: delay + transparent index
    parts.push(0x21, 0xf9, 4, 0b00001001);
    push16(Math.round(f.delayMs / 10));
    parts.push(TRANSPARENT, 0);
    parts.push(0x2c);
    push16(0);
    push16(0);
    push16(width);
    push16(height);
    parts.push(0);
    const data = lzw(indexFrame(f, palette, lookup, used), 8);
    parts.push(8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      parts.push(chunk.length, ...chunk);
    }
    parts.push(0);
  }
  parts.push(0x3b);
  return new Blob([Uint8Array.from(parts)], { type: 'image/gif' });
}

/** Draw pictures onto a canvas (fit + centre) and encode them as one GIF. */
export async function imagesToGif(files: File[], opts: { maxSize?: number; delayMs?: number } = {}): Promise<File> {
  const maxSize = opts.maxSize ?? 480;
  const bitmaps = await Promise.all(files.slice(0, 30).map((f) => createImageBitmap(f)));
  const ratio = Math.min(1, maxSize / Math.max(...bitmaps.map((b) => Math.max(b.width, b.height))));
  const w = Math.max(1, Math.round(Math.max(...bitmaps.map((b) => b.width)) * ratio));
  const h = Math.max(1, Math.round(Math.max(...bitmaps.map((b) => b.height)) * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: GifFrame[] = bitmaps.map((b) => {
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w / b.width, h / b.height);
    const dw = b.width * s, dh = b.height * s;
    ctx.drawImage(b, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return { data: ctx.getImageData(0, 0, w, h).data, delayMs: opts.delayMs ?? 500 };
  });
  bitmaps.forEach((b) => b.close());
  const name = (files[0]?.name.replace(/\.[^.]+$/, '') || 'venband') + '.gif';
  return new File([encodeGif(w, h, frames)], name, { type: 'image/gif' });
}
