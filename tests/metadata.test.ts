import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRiskyFile, jpegOrientation, stripJpeg, stripPng } from '../src/lib/metadata.ts';

function jpegWithExif(orientation: number) {
  // SOI, APP1 "Exif" with a tiny big-endian TIFF holding one Orientation tag, APP0, SOS + data, EOI
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif];
  const app0 = [0xff, 0xe0, 0, 4, 0x4a, 0x46];
  const sos = [0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9];
  return new Uint8Array([0xff, 0xd8, ...app1, ...app0, ...sos]);
}

test('reads the EXIF orientation', () => {
  assert.equal(jpegOrientation(jpegWithExif(6)), 6);
  assert.equal(jpegOrientation(jpegWithExif(1)), 1);
});

test('drops EXIF from JPEG but keeps the picture', () => {
  const out = stripJpeg(jpegWithExif(1));
  assert.ok(!Buffer.from(out).includes(Buffer.from('Exif')));
  assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
  assert.ok(Buffer.from(out).includes(Buffer.from([0xff, 0xe0])), 'JFIF header kept');
});

test('drops text and EXIF chunks from PNG', () => {
  const chunk = (type: string, data: number[]) => {
    const len = data.length;
    return [len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...Buffer.from(type), ...data, 0, 0, 0, 0];
  };
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', Array(13).fill(0)),
    ...chunk('tEXt', [...Buffer.from('GPS\0secret')]),
    ...chunk('eXIf', [1, 2, 3]),
    ...chunk('IDAT', [9, 9]),
    ...chunk('IEND', []),
  ]);
  const out = Buffer.from(stripPng(png));
  assert.ok(!out.includes(Buffer.from('secret')));
  assert.ok(!out.includes(Buffer.from('eXIf')));
  assert.ok(out.includes(Buffer.from('IDAT')));
  assert.ok(out.includes(Buffer.from('IEND')));
});

test('flags files that can run code', () => {
  assert.ok(isRiskyFile('free-nitro.exe'));
  assert.ok(isRiskyFile('invoice.HTML'));
  assert.ok(!isRiskyFile('holiday.jpg'));
  assert.ok(!isRiskyFile('notes.txt'));
});
