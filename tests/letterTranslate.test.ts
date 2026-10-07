import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterTranslate, LETTER_MAP, SCRIPT_INDEX } from '../src/lib/letter-translate.ts';

test('every letter has a character for every script', () => {
  const count = Object.keys(SCRIPT_INDEX).length;
  for (const [letter, chars] of Object.entries(LETTER_MAP)) {
    assert.equal(chars.length, count, `LETTER_MAP.${letter} has ${chars.length} entries, expected ${count}`);
  }
});

test('letters transliterate into script targets', () => {
  assert.equal(letterTranslate('hello', 'ru'), 'ХЕЛЛО');
  assert.equal(letterTranslate('hello', 'el'), 'ΗΕΛΛΟ');
  assert.equal(letterTranslate('hi', 'ja'), 'ハイ');
  assert.equal(letterTranslate('hello', 'ta'), 'ஹஎலலஒ');
  assert.equal(letterTranslate('hello', 'ka'), 'ჰელლო');
  assert.equal(letterTranslate('hello', 'am'), 'ሀእለለኦ');
  assert.equal(letterTranslate('hello', 'th'), 'ฮเอลลโอ');
});

test('digraphs collapse into single characters', () => {
  assert.equal(letterTranslate('thank', 'ar'), 'ثأنك');
  assert.equal(letterTranslate('photo', 'el'), 'ΦΟΤΟ');
  assert.equal(letterTranslate('cham', 'ko'), 'ㅊㅏㅁ');
});

test('latin-only targets have no script and return null', () => {
  assert.equal(letterTranslate('hello', 'fr'), null);
  assert.equal(letterTranslate('hello', 'es'), null);
  assert.equal(letterTranslate('hello', 'is'), null);
});