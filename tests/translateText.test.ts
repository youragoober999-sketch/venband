import test from 'node:test';
import assert from 'node:assert/strict';
import { latinOnly, plainEnglish, protect } from '../src/lib/translateText.ts';

test('code, links, mentions and emoji survive translation untouched', () => {
  const src = 'see https://venband.com/x and `npm i` <@3fff0000-0000-4000-8000-0000000000bd> :fire: ok';
  const p = protect(src);
  assert.equal(p.text, 'see ⟦0⟧ and ⟦1⟧ ⟦2⟧ ⟦3⟧ ok');
  // translators may add spaces inside markers or turn them into plain brackets
  assert.equal(p.restore('voir ⟦ 0 ⟧ et [1] ⟦2⟧ ⟦3 ⟧ ok'), 'voir https://venband.com/x et `npm i` <@3fff0000-0000-4000-8000-0000000000bd> :fire: ok');
});

test('chat slang becomes plain English for the translator', () => {
  assert.equal(plainEnglish('ngl that was lowkey fire, no cap'), 'not gonna lie that was kind of amazing, for real');
  assert.equal(plainEnglish('idk u tell me rn lol'), "I don't know you tell me right now lol");
  assert.equal(plainEnglish('NGL im down'), "not gonna lie I'm down");
});

test('only unambiguous acronyms are expanded when the language is a guess', () => {
  // German "im" and French "dont" are real words: left alone
  assert.equal(plainEnglish('Ich bin im Haus, ngl', false), 'Ich bin im Haus, not gonna lie');
  assert.equal(plainEnglish('le livre dont je parle', false), 'le livre dont je parle');
});

test('latinOnly', () => {
  assert.ok(latinOnly('Hola, ¿qué tal? ⟦0⟧ 123'));
  assert.ok(!latinOnly('Привет'));
  assert.ok(!latinOnly('こんにちは'));
});
