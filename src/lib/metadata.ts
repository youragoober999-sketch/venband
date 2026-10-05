// Removes hidden metadata (GPS location, camera serial numbers, edit
// history…) from photos before they're encrypted and sent.
//   JPEG: drops APP1 (EXIF / XMP), APP12, APP13 (IPTC) and comment segments
//   PNG:  drops eXIf, tEXt, iTXt, zTXt and tIME chunks
// A JPEG that relies on its EXIF rotation is re-drawn upright first so it
// doesn't turn sideways when the rotation tag goes.

const JPEG_DROP = new Set([0xe1, 0xec, 0xed, 0xfe]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

export function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // TIFF header
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) break;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
      return 1;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}

export function stripJpeg(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break; // start of scan: the rest is image data
    const len = (b[i + 2] << 8) | b[i + 3];
    if (!JPEG_DROP.has(marker)) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  out.push(b.subarray(i));
  const total = out.reduce((n, p) => n + p.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const p of out) {
    res.set(p, o);
    o += p.length;
  }
  return res;
}

export function stripPng(b: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return b;
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const total = out.reduce((n, p) => n + p.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const p of out) {
    res.set(p, o);
    o += p.length;
  }
  return res;
}

/** A copy of the file without hidden metadata (other file types are returned as they are). */
export async function stripMetadata(file: File): Promise<File> {
  const type = file.type || '';
  if (!/^image\/(jpeg|png)$/.test(type) || file.size > 60 * 1024 * 1024) return file;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (type === 'image/png') return new File([stripPng(bytes) as BlobPart], file.name, { type, lastModified: file.lastModified });
    if (jpegOrientation(bytes) !== 1 && typeof createImageBitmap === 'function') {
      // draw it upright, then save without any metadata
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.93));
      if (blob) return new File([blob], file.name, { type, lastModified: file.lastModified });
    }
    return new File([stripJpeg(bytes) as BlobPart], file.name, { type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Files that can run code on a computer when opened. */
export function isRiskyFile(name: string) {
  return /\.(exe|msi|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|apk|app|dmg|pkg|sh|lnk|reg|dll|iso|img|vhd|html?|svg|xhtml|docm|xlsm|pptm)$/i.test(name);
}
