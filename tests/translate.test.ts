import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JS server module
import { chunkText, translateText } from '../api/translate.js';

test('long text is split into provider-sized pieces without losing anything', () => {
  const text = 'Hallo zusammen. '.repeat(60) + 'Ein sehr langer Satz ' + 'ohne Punkt '.repeat(80);
  const parts = chunkText(text, 450);
  assert.ok(parts.length > 2);
  for (const p of parts) assert.ok(Buffer.byteLength(p) <= 450, 'piece too big');
  assert.equal(parts.join(''), text, 'pieces join back to the original');
  assert.deepEqual(chunkText('kurz'), ['kurz']);
});

test('without keys, the free provider translates (and keys are never needed)', async () => {
  delete process.env.DEEPL_API_KEY;
  delete process.env.GOOGLE_TRANSLATE_API_KEY;
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'Hey, what&#39;s up, man, how is the app doing today?' } }));
  }) as typeof fetch;
  try {
    const out = await translateText('Hey, was geht, Mann, wie geht es der App heute?', 'de', 'en');
    assert.equal(out?.provider, 'mymemory');
    assert.equal(out?.translation, "Hey, what's up, man, how is the app doing today?");
    assert.match(calls[0], /langpair=de%7Cen/);
  } finally {
    globalThis.fetch = real;
  }
});

test('DeepL is used first when its key is set, and failures fall through', async () => {
  process.env.DEEPL_API_KEY = 'abc:fx';
  const real = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = (async (url: string) => {
    hosts.push(new URL(String(url)).host);
    if (String(url).includes('deepl')) return new Response('quota', { status: 456 });
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'hello' } }));
  }) as typeof fetch;
  try {
    const out = await translateText('hallo', 'de', 'en');
    assert.equal(hosts[0], 'api-free.deepl.com');
    assert.equal(out?.provider, 'mymemory');
  } finally {
    globalThis.fetch = real;
    delete process.env.DEEPL_API_KEY;
  }
});
