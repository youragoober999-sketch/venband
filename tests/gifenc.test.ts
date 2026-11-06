import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif } from '../src/lib/gifenc.ts';

const solid = (w: number, h: number, rgb: [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [...rgb, 255];
  return d;
};

test('animated GIF: header, loop block, one image per frame, trailer, progress', async () => {
  const frames = [solid(16, 9, [255, 0, 0]), solid(16, 9, [0, 255, 0]), solid(16, 9, [0, 0, 255])].map((data) => ({ data, delayMs: 120 }));
  const seen: number[] = [];
  const bytes = new Uint8Array(await encodeGif(16, 9, frames, true, (p) => seen.push(p)).arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), 'GIF89a');
  assert.equal(bytes[6] | (bytes[7] << 8), 16);
  assert.equal(bytes[8] | (bytes[9] << 8), 9);
  assert.ok(new TextDecoder().decode(bytes).includes('NETSCAPE2.0'), 'loops');
  assert.equal(bytes[bytes.length - 1], 0x3b, 'trailer');
  assert.deepEqual(seen, [1 / 3, 2 / 3, 1]);
});

test('large noisy frame (LZW dictionary fills and resets) still encodes', async () => {
  const w = 200, h = 150;
  const d = new Uint8ClampedArray(w * h * 4);
  let x = 12345;
  for (let i = 0; i < d.length; i += 4) {
    x = (x * 1103515245 + 12345) >>> 0;
    [d[i], d[i + 1], d[i + 2], d[i + 3]] = [x & 255, (x >> 8) & 255, (x >> 16) & 255, 255];
  }
  const blob = encodeGif(w, h, [{ data: d, delayMs: 100 }]);
  assert.ok(blob.size > 10_000);
});
