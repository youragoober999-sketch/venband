import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLink, isTrusted } from '../src/lib/linkSafety.ts';

test('real sites are safe', () => {
  assert.equal(checkLink('https://www.venband.com/tos').level, 'safe');
  assert.equal(checkLink('https://www.paypal.com/signin').level, 'safe');
  assert.equal(checkLink('https://en.wikipedia.org/wiki/Cat').level, 'safe');
});

test('fake brands, look-alike letters, IPs and hidden hosts are dangerous', () => {
  for (const u of ['http://paypa1-login.xyz/claim', 'https://discord-nitro.gift/free', 'https://venband-support.com/', 'https://steamcommunlty.com/trade', 'https://xn--pypal-4ve.com/', 'http://192.168.1.10/login', 'https://www.google.com@evil.example/']) {
    assert.equal(checkLink(u).level, 'danger', u);
  }
});

test('short links and plain http need caution', () => {
  assert.equal(checkLink('https://bit.ly/abc').level, 'caution');
  assert.equal(checkLink('http://example.com/').level, 'caution');
});

test('masked links whose text names another site are dangerous', () => {
  assert.equal(checkLink('https://evil.example/', 'https://www.venband.com').level, 'danger');
  assert.equal(checkLink('https://www.venband.com/tos', 'venband.com/tos').level, 'safe');
});

test('trusted domains include subdomains', () => {
  assert.ok(isTrusted('music.youtube.com', []));
  assert.ok(isTrusted('docs.example.com', ['example.com']));
  assert.ok(!isTrusted('example.com.evil.net', ['example.com']));
});
