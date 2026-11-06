// Seed the LOCAL Supabase stack (`npx supabase start`) with test accounts for
// trying the signed-in app: `npm run dev:local` + `node scripts/dev-seed.mjs`.
//
// Refuses to run against anything but localhost. Accounts (all local-only):
//   alice@venband.test — Venband owner      bob@venband.test — Alice's friend
//   carol@venband.test — regular user
// Password for all three: DEV_SEED_PASSWORD, default below (a throwaway test value).
import { execSync } from 'node:child_process';
import { deriveMasterKeys } from '../src/lib/crypto.ts';

const PASSWORD = process.env.DEV_SEED_PASSWORD || 'venband-local-test-1';
const env = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const api = env.API_URL;
const key = env.SERVICE_ROLE_KEY;
if (!api || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) throw new Error(`refusing to seed ${api || '(no API_URL)'} — local stack only`);
const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };

async function user(email, username, display) {
  // Venband never sends the real password: Auth gets the key the app derives from it
  const { authPassword } = await deriveMasterKeys(email, PASSWORD);
  const r = await fetch(`${api}/auth/v1/admin/users`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ email, password: authPassword, email_confirm: true, user_metadata: { username, display_name: display } }),
  });
  const body = await r.json();
  if (r.ok) return body.id;
  if (/already/i.test(JSON.stringify(body))) {
    const list = await (await fetch(`${api}/auth/v1/admin/users?per_page=200`, { headers: h })).json();
    return list.users.find((u) => u.email === email).id;
  }
  throw new Error(`${email}: ${JSON.stringify(body)}`);
}
const rest = (path, method, body, prefer = 'resolution=merge-duplicates') =>
  fetch(`${api}/rest/v1/${path}`, { method, headers: { ...h, prefer }, body: JSON.stringify(body) }).then(async (r) => {
    if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  });

const alice = await user('alice@venband.test', 'alice', 'Alice');
const bob = await user('bob@venband.test', 'bob', 'Bob');
const carol = await user('carol@venband.test', 'carol', 'Carol');
await rest(`profiles?id=eq.${alice}`, 'PATCH', { platform_role: 'owner', badges: ['owner', 'developer', 'og', 'early_supporter'] }, 'return=minimal');
await rest(`profiles?id=eq.${bob}`, 'PATCH', { badges: ['verified', 'beta_tester'], nameplate: 'aurora', avatar_frame: 'galaxy', profile_effect: 'sakura' }, 'return=minimal');
const [a, b] = [alice, bob].sort();
await rest('friendships', 'POST', { user_a: a, user_b: b, requester: alice, accepted: true });
console.log(`seeded alice / bob / carol @venband.test on ${api}`);
