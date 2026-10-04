import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, phrasebookTranslate, PHRASEBOOK_LANGS } from '../src/lib/phrasebook.ts';

test('every phrasebook row has all 20 languages', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/lib/phrasebook.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const ROWS = `') + 14, src.indexOf('`;', src.indexOf('const ROWS = `')));
  for (const line of body.trim().split('\n')) assert.equal(line.split('|').length, PHRASEBOOK_LANGS.length, line);
});

test('detects common languages', () => {
  assert.equal(detectLanguage('hola, ¿cómo estás?'), 'es');
  assert.equal(detectLanguage('merci beaucoup mon ami'), 'fr');
  assert.equal(detectLanguage('danke, ich verstehe nicht'), 'de');
  assert.equal(detectLanguage('こんにちは'), 'ja');
  assert.equal(detectLanguage('привет друг'), 'ru');
});

test('translates phrases, keeps unknown words and punctuation', () => {
  assert.equal(phrasebookTranslate('Hello, how are you?', 'en', 'es'), 'Hola, cómo estás?');
  assert.equal(phrasebookTranslate('thank you very much Sam!', 'en', 'fr'), 'merci beaucoup Sam!');
  assert.equal(phrasebookTranslate('hola amigo', 'es', 'en'), 'hello friend');
  assert.equal(phrasebookTranslate('good night', 'en', 'ja'), 'おやすみ');
  assert.equal(phrasebookTranslate('おはよう', 'ja', 'en'), 'good morning');
  assert.equal(phrasebookTranslate('xyzzy', 'en', 'de'), null);
});
