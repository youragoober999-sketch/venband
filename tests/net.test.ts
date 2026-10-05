import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JS server module
import { checkUrl, isPrivateAddress, signMedia, verifyMedia } from '../api/_lib/net.js';

test('private and special addresses are recognised', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.0.10', '100.64.1.1', '::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1'])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('link previews refuse local, credentialed and non-web URLs', async () => {
  for (const u of ['http://localhost/', 'http://127.0.0.1:80/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'ftp://x.com/', 'http://a:b@example.com/', 'https://example.com:6379/'])
    await assert.rejects(checkUrl(u), Error, u);
});

test('media proxy URLs must be signed', () => {
  process.env.MEDIA_PROXY_SECRET = 'test-secret';
  const signed = signMedia('https://example.com/a.png') as string;
  const sig = new URL(signed, 'https://x').searchParams.get('s');
  assert.equal(verifyMedia('https://example.com/a.png', sig), true);
  assert.equal(verifyMedia('https://example.com/b.png', sig), false);
  assert.equal(verifyMedia('https://example.com/a.png', 'nope'), false);
});
