import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The app's "log in with email" screen asks for a 6-digit code, so every
// template that can deliver a sign-in/sign-up code must contain {{ .Token }}.
for (const name of ['magic_link', 'confirmation', 'reauthentication']) {
  test(`${name} email includes the 6-digit code`, () => {
    assert.match(read(`supabase/templates/${name}.html`), /\{\{\s*\.Token\s*\}\}/);
  });
}

test('magic link subject and config describe a code, not a link', () => {
  const subjects = JSON.parse(read('supabase/templates/subjects.json')) as Record<string, string>;
  assert.match(subjects.magic_link, /code/i);
  assert.doesNotMatch(subjects.magic_link, /link/i);

  const config = read('supabase/config.toml');
  assert.match(config, /\[auth\.email\.template\.magic_link\]\r?\nsubject = "Your Venband sign-in code"/);
});
