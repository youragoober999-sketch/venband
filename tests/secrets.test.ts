// The repository is public. This fails the test run if a private key or a
// hard-coded secret is ever committed (the GitHub App .pem, OAuth client
// secrets, service-role keys…). Secrets belong in Vercel's environment
// variables only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const RULES: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['key file', /\.(pem|p12|pfx)$/i],
  ['client secret value', /client_secret\s*[:=]\s*['"`][A-Za-z0-9._~-]{16,}['"`]/i],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}/],
  ['secret env value', /\b(GITHUB_CLIENT_SECRET|GOOGLE_CLIENT_SECRET|TIKTOK_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*\S{12,}/],
];

test('no private keys or secrets are committed', () => {
  const hits: string[] = [];
  for (const f of files) {
    if (/\.(png|jpe?g|gif|webp|ico|mp4|mp3|wav|ogg|woff2?|ttf|zip|apk|exe|wasm)$/i.test(f)) continue;
    let text = '';
    try {
      if (statSync(f).size > 2_000_000) continue;
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const [what, re] of RULES) if (re.test(what === 'key file' ? f : text)) hits.push(`${f}: ${what}`);
  }
  // the local Supabase test stack's well-known demo keys are not secrets
  assert.deepEqual(hits.filter((h) => !h.startsWith('tests/secrets.test.ts')), []);
});
