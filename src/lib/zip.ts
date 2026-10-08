// Tiny store-only ZIP writer (no compression) for downloading starter projects.
// Files are small, so "storing" them keeps this dependency-free and fast.

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (~c) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function downloadZip(files: { name: string; content: string | Uint8Array }[], name: string) {
  const now = new Date();
  const { time, date } = dosDateTime(now);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  const u16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const data = typeof f.content === 'string' ? new TextEncoder().encode(f.content) : f.content;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    local.set(u32(0x04034b50), 0);
    local.set(u16(20), 4); // version needed
    local.set(u16(0x0800), 6); // UTF-8 names
    local.set(u16(0), 8); // stored
    local.set(u16(time), 10);
    local.set(u16(date), 12);
    local.set(u32(crc), 14);
    local.set(u32(data.length), 18);
    local.set(u32(data.length), 22);
    local.set(u16(nameBytes.length), 26);
    local.set(u16(0), 28);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    chunks.push(local);

    const cen = new Uint8Array(46 + nameBytes.length);
    cen.set(u32(0x02014b50), 0);
    cen.set(u16(20), 4); // made by
    cen.set(u16(20), 6); // needed
    cen.set(u16(0x0800), 8);
    cen.set(u16(0), 10);
    cen.set(u16(time), 12);
    cen.set(u16(date), 14);
    cen.set(u32(crc), 16);
    cen.set(u32(data.length), 20);
    cen.set(u32(data.length), 24);
    cen.set(u16(nameBytes.length), 28);
    cen.set(u16(0), 30); // extra
    cen.set(u16(0), 32); // comment
    cen.set(u16(0), 34); // disk
    cen.set(u16(0), 36); // internal attrs
    cen.set(u32(0), 38); // external attrs
    cen.set(u32(offset), 42);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  eocd.set(u32(0x06054b50), 0);
  eocd.set(u16(0), 4);
  eocd.set(u16(0), 6);
  eocd.set(u16(files.length), 8);
  eocd.set(u16(files.length), 10);
  eocd.set(u32(cdSize), 12);
  eocd.set(u32(offset), 16);
  eocd.set(u16(0), 20);

  const blob = new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}