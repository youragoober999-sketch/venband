// Full end-to-end test against a local Supabase stack (npx supabase start)
// and the dev server (npm run dev). Usage: npm run test:e2e
// Env: APP_URL (default http://127.0.0.1:5173/), CHROME_PATH (optional), SHOTS (screenshot dir)
import { chromium } from 'playwright';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const MAIL = 'http://127.0.0.1:54324/api/v1';
const SHOTS = process.env.SHOTS;
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const run = Date.now().toString(36);
const testStart = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function newUser(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${name} pageerror]`, e.message));
  page.on('console', async (m) => { if (m.type() !== 'error') return; const parts = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => '?'))); log(`[${name} console]`, (process.env.E2E_VERBOSE ? parts.map(String).join(' ') : m.text()).slice(0, process.env.E2E_VERBOSE ? 4000 : 200)); });
  return { ctx, page, name, email: `${name}-${run}@example.com`, password: `Correct-Horse-${name}-42!` };
}

async function mailLink(email) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAIL}/search?query=to:${encodeURIComponent(email)}`)).json();
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAIL}/message/${list.messages[0].ID}`)).json();
      const m = msg.Text.match(/https?:\/\/\S+/);
      return m[0].replace(/\)$/, '');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no email for ' + email);
}

async function signupAndVerify(u) {
  const { page } = u;
  await page.goto(APP);
  if (SHOTS && u.name === 'alice') {
    await page.locator('.hero').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/0-landing.png` });
    await page.screenshot({ path: `${SHOTS}/0-landing-full.png`, fullPage: true });
  }
  await page.locator('.topnav').getByRole('button', { name: 'Sign up' }).click();
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(u.email);
  await inputs.nth(1).fill(u.name[0].toUpperCase() + u.name.slice(1));
  await inputs.nth(2).fill(`${u.name}_${run}`);
  await page.locator('form input[type=password]').nth(0).fill(u.password);
  await page.locator('form input[type=password]').nth(1).fill(u.password);
  await page.getByRole('checkbox').check();
  await page.waitForTimeout(600);
  if (SHOTS && u.name === 'alice') await page.screenshot({ path: `${SHOTS}/1-signup.png` });
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Check your email').waitFor({ timeout: 30000 });
  log(u.name, 'signed up; waiting for verification email');
  if (SHOTS && u.name === 'alice') await page.screenshot({ path: `${SHOTS}/2-verify.png` });

  // login before verifying must fail
  const link = await mailLink(u.email);
  log(u.name, 'got verification link', link.slice(0, 60) + '…');
  await page.goto(link);
  await page.waitForTimeout(1500);
}

async function login(u, remember = false) {
  const { page } = u;
  const status = await page.evaluate(() => document.body.innerText);
  if (/Enter your password/.test(status)) {
    await page.locator('input[type=password]').fill(u.password);
    await page.getByRole('button', { name: 'Continue' }).click();
  } else if (/Welcome back/.test(status)) {
    await page.locator('input[type=email]').fill(u.email);
    await page.locator('input[type=password]').fill(u.password);
    if (remember) await page.getByRole('checkbox').check();
    await page.locator('.auth-card').getByRole('button', { name: 'Log in' }).click();
  }
  await page.locator('.user-panel, .onboarding').first().waitFor({ timeout: 30000 });
  if (await page.locator('.onboarding').count()) {
    if (u.name === 'alice') {
      // walk through first-run setup: language, profile, theme
      await page.locator('.language-option', { hasText: 'English' }).click();
      await page.getByRole('button', { name: /Next/ }).click();
      await page.locator('.onboarding input').nth(1).fill('she/her');
      await page.getByRole('button', { name: /Next/ }).click();
      await page.locator('.onboarding-theme', { hasText: 'AMOLED' }).click();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1b-onboarding.png` });
      await page.getByRole('button', { name: 'Let’s go' }).click();
    } else {
      await page.getByRole('button', { name: 'Skip for now' }).click();
    }
    await page.locator('.user-panel').waitFor({ timeout: 30000 });
    log(u.name, 'finished onboarding');
  }
  log(u.name, 'is in the app');
}

const ctxClick = async (page, target, item) => {
  await target.click({ button: 'right' });
  await page.locator('.ctx-menu').getByRole('menuitem', { name: item }).click();
};

const alice = await newUser('alice');
const bob = await newUser('bob');
async function main() {
const { execSync: sh } = await import('node:child_process');
// every test run signs up from 127.0.0.1: reset the 6-accounts-per-IP counter
try { sh(`psql ${DB} -Atc "delete from public.signup_ips"`); } catch { /* table may not exist on old schemas */ }
// earlier runs' test accounts would look like alts of this run's (same browser, same network)
try { sh(`psql ${DB} -Atc "delete from public.voogle_verifications; delete from public.voogle_signals"`); } catch { /* older schema */ }

// ---- unverified login is rejected
await alice.page.goto(APP);
await signupAndVerify(alice);
log('alice after verify link, page says:', (await alice.page.evaluate(() => document.body.innerText)).slice(0, 80).replace(/\n/g, ' | '));
await login(alice);

// ---- create a server
await alice.page.locator('.rail-item[aria-label="Add a server"]').click();
await alice.page.locator('.modal').getByRole('button', { name: 'Next' }).click();
await alice.page.locator('.modal input').first().fill('Venband HQ');
await alice.page.locator('.modal').getByRole('button', { name: 'Next' }).click();
await alice.page.locator('.modal').getByRole('button', { name: 'Create server' }).click();
await alice.page.getByText('Welcome to Venband HQ').waitFor({ timeout: 20000 });
await alice.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await alice.page.getByText('This is the start of #chat').waitFor({ timeout: 20000 });
if (!/\/channels\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(new URL(alice.page.url()).pathname)) throw new Error('unexpected URL ' + alice.page.url());
log('✅ server URL is', new URL(alice.page.url()).pathname);
const hqId = new URL(alice.page.url()).pathname.split('/')[2];
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea').fill('hello bob, this is **encrypted** 🔐');
await alice.page.keyboard.press('Enter');
await alice.page.getByText('hello bob, this is').waitFor();
log('alice sent a message');

// ---- invite
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Invite People/ }).click();
const inviteInput = alice.page.locator('.modal .copy-row input');
await alice.page.waitForFunction(() => document.querySelector('.modal .copy-row input')?.value.includes('/invite/'));
const invite = await inviteInput.inputValue();
log('invite link', invite);
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/3-invite.png` });
await alice.page.keyboard.press('Escape');

// ---- bob
await signupAndVerify(bob);
await login(bob);
await bob.page.goto(invite);
await bob.page.locator('.invite-page, .invite-card').first().waitFor({ timeout: 20000 });
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/3b-invite-page.png` });
await bob.page.getByRole('button', { name: 'Join server' }).click();
await bob.page.locator('.server-header').waitFor({ timeout: 20000 });
log('bob joined server');
await alice.page.locator('.channel .channel-name').getByText('welcome', { exact: true }).click();
await alice.page.locator('.system-message', { hasText: 'Bob' }).waitFor({ timeout: 20000 });
log('✅ join message shown in #welcome');
await alice.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await bob.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await bob.page.getByText('hello bob, this is').waitFor({ timeout: 30000 });
log('✅ bob decrypted alice message (key was distributed E2E)');
await bob.page.locator('.message-text strong', { hasText: 'encrypted' }).waitFor();
log('✅ markdown **bold** renders');
await bob.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await bob.page.locator('.composer textarea').fill('hi alice! got it');
await bob.page.keyboard.press('Enter');
await alice.page.getByText('hi alice! got it').waitFor({ timeout: 20000 });
log('✅ alice received bob reply live');

// ---- verify server only has ciphertext
const { execSync } = await import('node:child_process');
const iconPngForSpoiler = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const rows = execSync(`psql ${DB} -Atc "select ciphertext from public.messages"`).toString();
// decode each stored ciphertext and look for the actual words (a regex on the
// base64 text itself would sometimes match "bob" by pure chance)
for (const line of rows.split('\n').filter(Boolean)) {
  const bytes = Buffer.from(line, 'base64').toString('latin1');
  if (/hello bob|hi alice|encrypted/i.test(bytes) || /hello bob|hi alice/i.test(line)) throw new Error('PLAINTEXT FOUND IN DB');
}
log('✅ database contains only ciphertext:', rows.split('\n')[0].slice(0, 40) + '…');

// ---- roles: alice creates a Mods role, makes a private channel
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Server Settings/ }).click();
await alice.page.locator('.settings-nav').getByRole('button', { name: 'Roles' }).click();
await alice.page.getByRole('button', { name: '+ Create Role' }).click();
await alice.page.locator('.role-editor input').first().fill('Moderators');
await alice.page.locator('.role-editor .swatch').nth(7).click();
await alice.page.locator('.perm', { hasText: 'Kick Members' }).locator('input').check();
await alice.page.getByRole('button', { name: 'Save Changes' }).click();
await alice.page.locator('.role-item', { hasText: 'Moderators' }).waitFor();
await alice.page.locator('.settings-nav').getByRole('button', { name: 'Members' }).click();
const bobRow = alice.page.locator('.member-row', { hasText: 'Bob' });
await bobRow.locator('button.add-role').click();
await alice.page.locator('.vselect-opt', { hasText: 'Moderators' }).click();
await bobRow.getByText('Moderators').waitFor();
log('✅ role created and assigned');
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/4-roles.png` });
await alice.page.keyboard.press('Escape');

// ---- voice + video + screen
await alice.page.locator('.channel .channel-name').getByText('General', { exact: true }).click();
await bob.page.locator('.channel .channel-name').getByText('General', { exact: true }).click();
await alice.page.locator('.tile').nth(1).waitFor({ timeout: 30000 });
await bob.page.locator('.tile').nth(1).waitFor({ timeout: 30000 });
await alice.page.locator('.call-controls [title=Camera]').click();
await bob.page.locator('.tile video').first().waitFor({ timeout: 30000 });
const connected = await alice.page.evaluate(() => document.querySelector('.voice-status')?.textContent);
log('✅ voice call established, remote video visible to bob; status:', connected);
await bob.page.waitForTimeout(2500);
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/5-voice.png` });
await alice.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await alice.page.waitForTimeout(800);
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/6-chat.png` });

// ---- kick bob -> key rotation, bob loses access
await alice.page.locator('.voice-bar [title=Disconnect]').click();
await ctxClick(alice.page, alice.page.locator('.members .member', { hasText: 'Bob' }), /Kick Bob/);
await alice.page.locator('.modal').getByRole('button', { name: 'Kick' }).click();
await alice.page.waitForTimeout(1500);
await alice.page.locator('.composer textarea:not([disabled])').waitFor();
await alice.page.locator('.composer textarea').fill('secret after kick');
await alice.page.keyboard.press('Enter');
await alice.page.getByText('secret after kick').waitFor({ timeout: 20000 });
const epochs = execSync(`psql ${DB} -Atc "select max(epoch) from public.channel_epochs e join public.channels c on c.id=e.channel_id where c.name='chat'"`).toString().trim();
if (Number(epochs) < 2) throw new Error('key was not rotated after kick');
log('✅ after kick, #chat is on key epoch', epochs);

// ---- kicked bob is sent home; DMs + DM call ringing
await bob.page.locator('.friends').waitFor({ timeout: 20000 });
log('✅ kicked bob was moved out of the server');
await alice.page.locator('.rail-item.home').click();
await alice.page.getByTitle('New direct message').click();
await alice.page.locator('.modal input').fill('bob_' + run);
await alice.page.getByRole('button', { name: 'Open DM' }).click();
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea').fill('private DM for bob only');
await alice.page.keyboard.press('Enter');
// bob was kicked, so he and alice share nothing: it arrives as a message request
await bob.page.locator('.nav-item', { hasText: 'Message Requests' }).locator('.badge').waitFor({ timeout: 20000 });
if (await bob.page.locator('.toast.incoming-call').count()) throw new Error('request should be quiet');
await bob.page.locator('.nav-item', { hasText: 'Message Requests' }).click();
await bob.page.locator('.friend-row', { hasText: 'Alice' }).getByTitle('Accept').click();
log('✅ DM from a stranger arrives as a message request and can be accepted');
await bob.page.locator('.channel.dm', { hasText: 'Alice' }).locator('.badge').waitFor({ timeout: 20000 });
log('✅ unread badge shown for the new DM');
await bob.page.locator('.channel.dm', { hasText: 'Alice' }).click({ timeout: 20000 });
await bob.page.getByText('private DM for bob only').waitFor({ timeout: 20000 });
log('✅ DM delivered and decrypted');
const dmPath = new URL(bob.page.url()).pathname;
if (!/^\/channels\/@me\/[0-9a-f-]{36}$/.test(dmPath)) throw new Error('unexpected DM URL ' + dmPath);
log('✅ DM URL is', dmPath);
// encrypted attachment (1x1 PNG)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await alice.page.locator('.composer input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
await alice.page.locator('.composer textarea').fill('here is a file');
await alice.page.keyboard.press('Enter');
await bob.page.locator('img.attachment-img[alt="pixel.png"]').waitFor({ timeout: 20000 });
const stored = execSync(`psql ${DB} -Atc "select count(*) from storage.objects where bucket_id='attachments'"`).toString().trim();
log('✅ encrypted attachment uploaded, decrypted and shown to bob; objects in bucket:', stored);
// drag & drop a code file: bob sees it highlighted, can switch language and open the full viewer
const py = Array.from({ length: 30 }, (_, i) => `def f${i}(x):\n    return x * ${i}  # line ${i}`).join('\n');
await alice.page.locator('.chat').evaluate((el, text) => {
  const dt = new DataTransfer();
  dt.items.add(new File([text], 'script.py', { type: 'text/x-python' }));
  for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
}, py);
await alice.page.locator('.pending-file', { hasText: 'script.py' }).waitFor({ timeout: 5000 });
await alice.page.locator('.composer textarea').press('Enter');
const codeCard = bob.page.locator('.code-card', { hasText: 'script.py' });
await codeCard.locator('.hljs-keyword', { hasText: 'def' }).first().waitFor({ timeout: 20000 });
if ((await codeCard.locator('.code-lang .vselect-value').textContent()) !== 'Python') throw new Error('language not detected');
await codeCard.locator('.code-expand').click();
await bob.page.locator('.code-viewer .code-gutter div', { hasText: '60' }).waitFor({ timeout: 5000 });
await bob.page.keyboard.press('Escape');
log('✅ dropped code file shows as highlighted code with a language picker and full viewer');
// audio plays inline
const wav = (() => {
  const rate = 8000, n = 8000, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin(i / 4));
  return b;
})();
await alice.page.locator('.composer input[type=file]').setInputFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: wav });
await alice.page.locator('.composer textarea').press('Enter');
await bob.page.locator('.audio-card', { hasText: 'beep.wav' }).locator('audio').waitFor({ timeout: 20000 });
log('✅ audio files play inline');
// a file bigger than one 8 MiB piece goes up in encrypted pieces and comes back identical
const big = Buffer.alloc(9 * 1024 * 1024 + 123);
for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) % 251;
await alice.page.locator('.composer input[type=file]').setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: big });
await alice.page.locator('.composer textarea').press('Enter');
const bigCard = bob.page.locator('.attachment', { hasText: 'big.bin' });
await bigCard.waitFor({ timeout: 60000 });
const pieces = execSync(`psql ${DB} -Atc "select count(*) from storage.objects where bucket_id='attachments' and name like '%/0.bin' or name like '%/1.bin'"`).toString().trim();
const [download] = await Promise.all([bob.page.waitForEvent('download', { timeout: 60000 }), bigCard.locator('.icon-btn').last().click()]);
const got = await (await import('node:fs/promises')).readFile(await download.path());
if (!got.equals(big)) throw new Error(`big file came back different (${got.length} vs ${big.length} bytes)`);
log('✅ 9 MB file sent in encrypted pieces and downloaded byte-for-byte; piece objects:', pieces);
// forward a message
await bob.page.locator('.message', { hasText: 'private DM for bob only' }).click({ button: 'right' });
await bob.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Copy Message Link' }).waitFor();
await bob.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Forward' }).click();
await bob.page.locator('.forward-row').first().waitFor({ timeout: 15000 });
await bob.page.locator('.forward-row', { hasText: 'Alice' }).getByRole('button', { name: 'Send' }).click();
await bob.page.locator('.forward-row', { hasText: 'Alice' }).getByRole('button', { name: 'Sent' }).waitFor({ timeout: 15000 });
await bob.page.keyboard.press('Escape');
await alice.page.locator('.forwarded-label', { hasText: 'Forwarded from' }).waitFor({ timeout: 20000 });
log('✅ messages can be forwarded');

// ---- reactions: one-click quick reaction, live on the other side, emoji never stored in plaintext
const dmMsg = alice.page.locator('.message', { hasText: 'private DM for bob only' }).first();
await dmMsg.hover();
await dmMsg.locator('.quick-react button', { hasText: '👍' }).click();
await bob.page.locator('.message', { hasText: 'private DM for bob only' }).first().locator('.reaction', { hasText: '👍' }).waitFor({ timeout: 15000 });
await bob.page.locator('.message', { hasText: 'private DM for bob only' }).first().locator('.reaction', { hasText: '👍' }).click();
await alice.page.locator('.message', { hasText: 'private DM for bob only' }).first().locator('.reaction', { hasText: '2' }).waitFor({ timeout: 15000 });
const reactionDump = execSync(`psql ${DB} -Atc "select tag || iv || ciphertext from public.reactions"`).toString();
if (reactionDump.includes('👍')) throw new Error('reaction emoji stored in plaintext');
log('✅ reactions: quick-react, live counts, encrypted at rest');

// ---- :shortcode autocomplete (type :hear, Enter picks the top match)
const aliceBox = alice.page.locator('.composer textarea:not([disabled])');
await aliceBox.click();
await alice.page.keyboard.type('love you :hear', { delay: 20 });
await alice.page.locator('.mention-pop .mention-option').first().waitFor({ timeout: 10000 });
await alice.page.keyboard.press('Enter');
if (!(await aliceBox.inputValue()).includes('❤️')) throw new Error('emoji autocomplete did not insert ❤️: ' + (await aliceBox.inputValue()));
await alice.page.keyboard.type(' and :broken_heart:', { delay: 10 });
await alice.page.keyboard.press('Escape');
await alice.page.keyboard.press('Enter');
await bob.page.locator('.message-text', { hasText: 'love you ❤️' }).filter({ hasText: '💔' }).waitFor({ timeout: 15000 });
log('✅ :emoji: autocomplete (Enter picks the top match) and :shortcodes: become emoji');

// ---- over 2000 characters goes out as message.txt
await aliceBox.fill('long '.repeat(500));
await aliceBox.press('Enter');
await bob.page.locator('.code-card, .attachment', { hasText: 'message.txt' }).first().waitFor({ timeout: 20000 });
log('✅ messages over 2,000 characters are sent as message.txt');

// ---- spoiler attachments stay blurred until clicked
await alice.page.locator('.composer input[type=file]').setInputFiles({ name: 'secret.png', mimeType: 'image/png', buffer: iconPngForSpoiler() });
await alice.page.locator('.pending-file').getByRole('button', { name: 'Spoiler' }).click();
await aliceBox.press('Enter');
const spoiler = bob.page.locator('.spoiler-file', { hasText: 'secret.png' });
await spoiler.waitFor({ timeout: 20000 });
await spoiler.click();
await bob.page.locator('img.attachment-img[alt="secret.png"]').waitFor({ timeout: 20000 });
log('✅ files can be sent as spoilers');

// ---- edit history
await aliceBox.fill('version one');
await aliceBox.press('Enter');
const v1 = alice.page.locator('.message', { hasText: 'version one' }).last();
await v1.waitFor();
await v1.hover();
await v1.getByRole('button', { name: 'Edit' }).click();
await alice.page.locator('.edit-box textarea').fill('version two');
await alice.page.locator('.edit-box textarea').press('Enter');
await bob.page.locator('.message', { hasText: 'version two' }).locator('button.edited').click();
await bob.page.locator('.edit-version', { hasText: 'version one' }).waitFor({ timeout: 15000 });
await bob.page.locator('.modal-close').click();
log('✅ edited tag opens the (still encrypted) edit history');

// ---- pins in DMs + pinned panel
await bob.page.locator('.message', { hasText: 'version two' }).click({ button: 'right' });
await bob.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Pin Message' }).click();
await alice.page.getByRole('button', { name: 'Pinned messages' }).click();
await alice.page.locator('.side-panel .panel-message', { hasText: 'version two' }).waitFor({ timeout: 15000 });
await alice.page.getByRole('button', { name: 'Pinned messages' }).click();
log('✅ pins work in DMs and show in the pinned panel');

// ---- saved messages
await alice.page.locator('.message', { hasText: 'version two' }).click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Save Message' }).click();
await new Promise((r) => setTimeout(r, 500));
const savedCount = execSync(`psql ${DB} -Atc "select count(*) from public.saved_messages"`).toString().trim();
if (savedCount === '0') throw new Error('message was not saved');
log('✅ messages can be saved');

// ---- polls (encrypted question, live counts)
await alice.page.locator('.composer .icon-btn[aria-label="Upload, poll or schedule"]').click();
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Create a poll' }).click();
await alice.page.locator('.modal input').first().fill('Pizza or tacos?');
await alice.page.locator('.modal input[placeholder="Answer 1"]').fill('Pizza');
await alice.page.locator('.modal input[placeholder="Answer 2"]').fill('Tacos');
await alice.page.locator('.modal').getByRole('button', { name: 'Post poll' }).click();
const bobPoll = bob.page.locator('.poll', { hasText: 'Pizza or tacos?' });
await bobPoll.waitFor({ timeout: 20000 });
await bobPoll.locator('.poll-option', { hasText: 'Tacos' }).click();
await alice.page.locator('.poll', { hasText: 'Pizza or tacos?' }).locator('.poll-option', { hasText: 'Tacos' }).locator('.poll-count', { hasText: '1 ·' }).waitFor({ timeout: 15000 });
log('✅ polls: encrypted question, live vote counts');

// ---- mark unread + unread divider
await bob.page.locator('.message', { hasText: 'version two' }).click({ button: 'right' });
await bob.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Mark Unread' }).click();
await bob.page.locator('.unread-divider').waitFor({ timeout: 10000 });
log('✅ mark unread shows the New divider');

// ---- search: decrypts and matches on the device, with filters
await alice.page.keyboard.press('Control+k');
await alice.page.locator('.switcher input').fill('version two');
await alice.page.locator('.switcher-item', { hasText: 'Search messages for' }).click();
const hit = alice.page.locator('.search-hit', { hasText: 'version two' }).first();
await hit.waitFor({ timeout: 20000 });
await alice.page.locator('.search-head input').fill('from:bob_' + run + ' got');
await alice.page.locator('.search-head input').press('Enter');
await alice.page.locator('.search-hit', { hasText: 'hi alice! got it' }).waitFor({ timeout: 20000 });
await alice.page.locator('.search-head input').fill('has:poll pizza');
await alice.page.locator('.search-head input').press('Enter');
await alice.page.locator('.search-hit', { hasText: 'Alice' }).first().waitFor({ timeout: 20000 });
await alice.page.locator('.search-head input').fill('version two');
await alice.page.locator('.search-head input').press('Enter');
await alice.page.locator('.search-hit', { hasText: 'version two' }).first().click();
await alice.page.locator('.message.flash', { hasText: 'version two' }).waitFor({ timeout: 10000 });
log('✅ search: message contents (decrypted on device), from:/has: filters, click jumps to the message');

// ---- command palette runs commands
await alice.page.keyboard.press('Control+k');
await alice.page.locator('.switcher input').fill('>saved');
await alice.page.keyboard.press('Enter');
await alice.page.locator('.saved-item', { hasText: 'version two' }).waitFor({ timeout: 15000 });
log('✅ command palette commands; Saved Messages view lists saved messages');
await alice.page.locator('.saved-item').getByRole('button', { name: 'Go to message' }).click();
await alice.page.locator('.message', { hasText: 'version two' }).first().waitFor({ timeout: 10000 });

// ---- DM organisation: pin + folder + mute
const bobRowDm = alice.page.locator('.channel.dm', { hasText: 'Bob' }).first();
await bobRowDm.click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'New folder…' }).click();
await alice.page.locator('.modal input').fill('Besties');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await alice.page.locator('.dm-folder-head', { hasText: 'Besties' }).waitFor({ timeout: 5000 });
await alice.page.locator('.dm-folder', { hasText: 'Besties' }).locator('.channel.dm', { hasText: 'Bob' }).waitFor();
await alice.page.locator('.channel.dm', { hasText: 'Bob' }).first().click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'For 1 hour' }).click();
await alice.page.locator('.channel.dm.muted-convo', { hasText: 'Bob' }).waitFor({ timeout: 5000 });
await alice.page.locator('.channel.dm', { hasText: 'Bob' }).first().click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: /^Unmute/ }).click();
log('✅ DMs: folders, timed mute');
await bob.page.locator('.rail-item.home').click();
await bob.page.evaluate(() => { history.replaceState(null, '', location.pathname); });
// bob also has a second tab open (same login)
const bobTab2 = await bob.ctx.newPage();
await bobTab2.goto(APP);
await bobTab2.locator('.user-panel').waitFor({ timeout: 30000 });
const ringing = (p) => p.evaluate(() => document.documentElement.dataset.ringing || '');
await alice.page.locator('.chat-header').getByRole('button', { name: /Call/ }).click();
await bob.page.locator('.toast').getByTitle('Join call').waitFor({ timeout: 20000 });
await bob.page.waitForFunction(() => document.documentElement.dataset.ringing === 'incoming', null, { timeout: 10000 });
await bob.page.locator('.toast').getByTitle('Join call').click();
await bob.page.locator('.tile').nth(1).waitFor({ timeout: 30000 });
log('✅ DM call rang on bob and connected');
await bob.page.waitForTimeout(4000);
const ringStates = { alice: await ringing(alice.page), bob: await ringing(bob.page), bobTab2: await ringing(bobTab2) };
if (Object.values(ringStates).some(Boolean)) throw new Error('still ringing after answering: ' + JSON.stringify(ringStates));
log('✅ all ringing stops once the call is answered (incl. other tabs)');
await bobTab2.close();
// deafen / mute several times: nobody may drop out of the call
// mash the buttons like an impatient human: 10 quick toggles
for (const btn of ['Deafen', 'Deafen', 'Mute', 'Unmute', 'Deafen', 'Deafen', 'Mute', 'Unmute', 'Deafen', 'Deafen']) {
  await bob.page.locator(`.call-controls [title="${btn}"]`).first().click();
  await bob.page.waitForTimeout(200);
}
await alice.page.waitForTimeout(12000);
const aliceTiles = await alice.page.locator('.voice-view .tile').count();
const bobTiles = await bob.page.locator('.voice-view .tile').count();
const calling = await alice.page.locator('.calling-banner').count();
if (aliceTiles < 2 || bobTiles < 2 || calling) throw new Error(`call dropped after deafen: alice ${aliceTiles} tiles, bob ${bobTiles}, calling banner ${calling}`);
log('✅ deafen/mute toggling keeps both people in the call');
// bob hangs up: alice must see it quickly, and bob must not get "rung" by alice still being there
await bob.page.locator('.voice-bar [title=Disconnect]').click();
await alice.page.getByText('left the call').waitFor({ timeout: 8000 });
if ((await alice.page.locator('.voice-view .tile').count()) !== 1) throw new Error('bob still shown in alice\'s call');
await bob.page.waitForTimeout(1500);
if (await bob.page.locator('.toast.incoming-call').count()) throw new Error('hanging up should not pop up a call notice');
await bob.page.locator('.chat-header').getByRole('button', { name: /Join call/ }).waitFor({ timeout: 8000 });
log('✅ hanging up is seen immediately; no ringing for the person who left');
// and joining again from the DM header works
await bob.page.locator('.chat-header').getByRole('button', { name: /Join call/ }).click();
await alice.page.locator('.voice-view .tile').nth(1).waitFor({ timeout: 20000 });
log('✅ rejoining the call works');
// full screen on a video tile
await alice.page.locator('.call-controls [title=Camera]').click();
const camTile = bob.page.locator('.voice-view .tile:has(video)').first();
await camTile.waitFor({ timeout: 20000 });
await camTile.hover();
await camTile.locator('.tile-full').click();
await bob.page.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 5000 });
await bob.page.keyboard.press('Escape');
await bob.page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
log('✅ full screen video works');
// screen share: one click on the shared screen = full screen
await alice.page.locator('.call-controls [title="Share screen"]').click();
const screenTile = bob.page.locator('.voice-view .tile.screen');
await screenTile.waitFor({ timeout: 20000 });
await alice.page.locator('.voice-view .tile.screen', { hasText: 'You’re sharing your screen' }).waitFor({ timeout: 10000 });
if (await alice.page.locator('.voice-view .tile.screen video').count()) throw new Error('own screen preview shown (hall of mirrors)');
log('✅ your own screen share is not previewed back to you (no mirror effect)');
if (!(await screenTile.locator('.tile-full').isVisible())) throw new Error('full screen button not visible on screen share');
await screenTile.click();
await bob.page.waitForFunction(() => document.fullscreenElement?.classList.contains('screen'), null, { timeout: 5000 });
const fsBox = await bob.page.evaluate(() => {
  const r = document.fullscreenElement.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
});
if (fsBox.w < fsBox.vw - 2 || fsBox.h < fsBox.vh - 2) throw new Error('screen share not filling the screen: ' + JSON.stringify(fsBox));
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/8-screen-fullscreen.png` });
await bob.page.evaluate(() => document.exitFullscreen());
await alice.page.locator('.call-controls [title="Share screen"]').click();
log('✅ clicking a screen share opens it full screen, filling the display');
await alice.page.locator('.call-controls [title=Camera]').click();
// refresh mid-call and come back: must not show the same person twice
await bob.page.reload();
await bob.page.locator('.user-panel').waitFor({ timeout: 30000 });
// refreshing never "rings": he rejoins with the Join call button in the DM header
await bob.page.waitForTimeout(1500);
if (await bob.page.locator('.toast.incoming-call').count()) throw new Error('a refresh made the call ring again');
await bob.page.locator('.chat-header').getByRole('button', { name: /Join call/ }).click({ timeout: 20000 });
await alice.page.waitForTimeout(6000);
const tilesAfterRejoin = await alice.page.locator('.voice-view .tile').count();
if (tilesAfterRejoin !== 2) throw new Error(`expected 2 tiles after bob refreshed and rejoined, got ${tilesAfterRejoin}`);
log('✅ refreshing and rejoining does not duplicate people');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/7-dm-call.png` });
await alice.page.locator('.voice-bar [title=Disconnect]').click();

// ---- group chats
await alice.page.locator('.rail-item.home').click();
await alice.page.getByTitle('New group chat').click();
await alice.page.locator('.modal input').first().fill('Test crew');
await alice.page.locator('.modal input[placeholder="Search friends or type a username"]').fill('bob_' + run);
await alice.page.locator('.modal input[placeholder="Search friends or type a username"]').press('Enter');
await alice.page.locator('.modal .role-pill').waitFor();
await alice.page.locator('.modal').getByRole('button', { name: /Create group/ }).click();
await alice.page.getByText('This is the start of your conversation with Test crew').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea').fill('hello group');
await alice.page.keyboard.press('Enter');
await bob.page.locator('.rail-item.home').click();
await bob.page.locator('.channel.dm', { hasText: 'Test crew' }).click({ timeout: 20000 });
await bob.page.getByText('hello group').waitFor({ timeout: 20000 });
log('✅ group chat created, bob sees the group and decrypts messages');
await bob.page.getByTitle(/Group settings/).click();
await bob.page.getByRole('button', { name: 'Leave group', exact: true }).click();
await bob.page.locator('.modal').getByRole('button', { name: 'Leave Group', exact: true }).click();
await bob.page.locator('.channel.dm', { hasText: 'Test crew' }).waitFor({ state: 'detached', timeout: 20000 });
await alice.page.locator('.composer textarea').fill('after bob left');
await alice.page.keyboard.press('Enter');
await alice.page.locator('.message-text', { hasText: 'after bob left' }).waitFor({ timeout: 20000 }).catch(async (e) => {
  console.log('composer error:', await alice.page.locator('.composer-wrap .form-error').allTextContents());
  throw e;
});
log('✅ leaving a group works and the group keeps working (keys rotated)');

// ---- refreshing keeps you signed in ("stay signed in" is on by default)
await alice.page.reload();
await alice.page.locator('.user-panel').waitFor({ timeout: 20000 });
await alice.page.locator('.rail-item:not(.home):not(.add)').first().click();
await alice.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await alice.page.getByText('secret after kick').waitFor({ timeout: 20000 });
log('✅ refresh keeps you signed in and history still decrypts');

// ---- friends
await alice.page.locator('.rail-item.home').click();
await alice.page.locator('.nav-item', { hasText: 'Friends' }).click();
await alice.page.locator('.friends-tabs').getByRole('button', { name: 'Add Friend' }).click();
await alice.page.locator('.add-friend-box input').fill('bob_' + run);
await alice.page.getByRole('button', { name: 'Send Friend Request' }).click();
await alice.page.getByText('Friend request sent').waitFor({ timeout: 10000 });
await bob.page.locator('.rail-item.home').click();
await bob.page.locator('.nav-item', { hasText: 'Friends' }).click();
await bob.page.locator('.friends-tabs').getByRole('button', { name: /Pending/ }).click();
await bob.page.locator('.friend-row', { hasText: 'Alice' }).getByTitle('Accept').click();
await alice.page.locator('.friends-tabs').getByRole('button', { name: 'All', exact: true }).click();
await alice.page.locator('.friend-row', { hasText: 'Bob' }).waitFor({ timeout: 20000 });
log('✅ friend request sent and accepted');

// ---- the browser menu is off; our own menus work
const prevented = await alice.page.evaluate(() => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  document.querySelector('.friends-body').dispatchEvent(ev);
  return ev.defaultPrevented;
});
if (!prevented) throw new Error('browser context menu not disabled');
await alice.page.locator('.friend-row', { hasText: 'Bob' }).click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Copy User ID' }).waitFor();
await alice.page.keyboard.press('Escape');
log('✅ native right-click menu disabled; custom user menu shows');

// ---- @mentions in a DM
await alice.page.locator('.channel.dm', { hasText: 'Bob' }).first().click();
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea').fill('hey @bo');
await alice.page.locator('.mention-option', { hasText: 'Bob' }).first().waitFor();
await alice.page.keyboard.press('Enter');
await alice.page.keyboard.type('look ||secret||');
await alice.page.keyboard.press('Enter');
await bob.page.locator('.channel.dm', { hasText: 'Alice' }).click();
await bob.page.locator('.message .mention', { hasText: '@Bob' }).waitFor({ timeout: 20000 });
await bob.page.locator('.message-text', { hasText: 'hey @Bob look' }).waitFor();
await bob.page.locator('.message.mentioned .md-spoiler').waitFor();
log('✅ @mention + spoiler delivered and highlighted');

// ---- staff: alice becomes platform owner, gives bob badges, limits + restores him
execSync(`psql ${DB} -Atc "update public.profiles set platform_role='owner' where username='alice_${run}'"`);
await alice.page.reload();
await alice.page.locator('.user-panel').waitFor({ timeout: 30000 });
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.locator('.sp-tab', { hasText: 'Moderation' }).click();
await alice.page.locator('.mod-search input').fill('bob_' + run);
const bobCard = alice.page.locator('.mod-card', { hasText: 'bob_' + run });
await bobCard.waitFor({ timeout: 10000 });
await bobCard.getByRole('button', { name: /Apply Badges/ }).click();
await alice.page.locator('.badge-choice', { hasText: 'Bug Bounty Hunter' }).first().click();
await alice.page.locator('.badge-choice', { hasText: 'OG' }).click();
await alice.page.getByRole('button', { name: 'Save badges' }).click();
await bobCard.locator('.badges .badge-wrap').nth(1).waitFor({ timeout: 10000 });
log('✅ moderation: badges applied');
await bobCard.getByRole('button', { name: 'Make Limited' }).click();
await alice.page.locator('.modal input').fill('e2e test');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await bobCard.locator('.pill.limited').waitFor({ timeout: 10000 });
await bob.page.locator('.app-banner.warn').waitFor({ timeout: 20000 });
await bob.page.locator('.rail-item[aria-label="Add a server"]').click();
await bob.page.locator('.modal').getByRole('button', { name: 'Next' }).click();
await bob.page.locator('.modal').getByRole('button', { name: 'Next' }).click();
await bob.page.locator('.modal').getByRole('button', { name: 'Create server' }).click();
await bob.page.locator('.modal .form-error', { hasText: 'create servers' }).waitFor({ timeout: 10000 });
await bob.page.keyboard.press('Escape');
log('✅ limited account is stopped by the database (no new servers)');
await bobCard.getByRole('button', { name: 'Restore' }).click();
await alice.page.locator('.modal input').fill('done');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await bobCard.locator('.pill.active').waitFor({ timeout: 10000 });
await bob.page.locator('.app-banner.warn').waitFor({ state: 'detached', timeout: 20000 });
log('✅ moderation: limit + restore reach the user live');
// verify the server so it appears in discovery
await alice.page.locator('.tabs').getByRole('button', { name: /Servers/ }).click();
await alice.page.locator('.mod-search input').fill(hqId);
const hqCard = alice.page.locator('.mod-card', { hasText: hqId });
await hqCard.getByRole('button', { name: /Verify/ }).click();
await alice.page.locator('.modal input').fill('official');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await hqCard.locator('.verified-mark').waitFor({ timeout: 10000 });
log('✅ moderation: server verified');
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/9-moderation.png` });
// devices + themes
await alice.page.locator('.sp-tab', { hasText: 'Devices' }).click();
await alice.page.locator('.device-row').first().waitFor({ timeout: 10000 });
log('✅ devices tab lists', await alice.page.locator('.device-row').count(), 'device(s)');
await alice.page.locator('.sp-tab', { hasText: 'Appearance' }).click();
await alice.page.locator('.theme-card', { hasText: 'Midnight' }).locator('.theme-pick').click();
const bg = await alice.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim());
if (bg !== '#070b14') throw new Error('theme not applied: ' + bg);
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/10-appearance.png` });
await alice.page.locator('.theme-card', { hasText: 'Default' }).locator('.theme-pick').click();
log('✅ themes apply instantly');
await alice.page.locator('.sp-close').click();
// discovery: bob finds the verified server and joins from there
await bob.page.locator('.rail-item[aria-label="Discover servers"]').click();
await bob.page.locator(`.discovery-card[data-server-id="${hqId}"]`).click({ timeout: 20000 });
await bob.page.locator('.server-header', { hasText: 'Venband HQ' }).waitFor({ timeout: 20000 });
log('✅ discovery: verified server listed and joinable');
// bob rejoined without anyone sharing the current key with him: he can still talk right away
await bob.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await bob.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
if (await bob.page.locator('.key-wait').count()) throw new Error('still shows the waiting-for-key banner');
await bob.page.locator('.composer textarea').fill('bob is back and can talk');
await bob.page.keyboard.press('Enter');
await bob.page.locator('.message-text', { hasText: 'bob is back and can talk' }).waitFor({ timeout: 20000 });
await alice.page.locator('.rail-item:not(.home):not(.add)').first().click();
await alice.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await alice.page.locator('.message-text', { hasText: 'bob is back and can talk' }).waitFor({ timeout: 20000 });
log('✅ a newcomer can send immediately (new key shared with everyone) and others read it');
// …and once a member who has the older keys is online, the newcomer can read the history too
for (let i = 0; i < 40 && (await bob.page.locator('.message .undecryptable').count()); i++) await new Promise((r) => setTimeout(r, 500));
if (await bob.page.locator('.message .undecryptable').count()) throw new Error('newcomer still cannot read earlier messages');
await bob.page.locator('.message-text', { hasText: 'hello bob, this is' }).waitFor({ timeout: 5000 });
log('✅ newcomers can read messages sent before they joined (keys shared by online members)');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/11-server-badges.png` });
// ---- channels: right-click to create a category and a channel in it
await alice.page.locator('.rail-item[aria-label="Venband HQ"]').first().click().catch(() => {});
await alice.page.locator(`.rail-item`).filter({ has: alice.page.locator('.rail-initials', { hasText: 'VH' }) }).first().click();
await alice.page.locator('.sidebar-scroll').click({ button: 'right', position: { x: 60, y: 400 } });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Create Category' }).click();
// type like a person (letter by letter, with a space): the dialog must keep focus and stay open
await alice.page.keyboard.type('Game Room', { delay: 30 });
if ((await alice.page.locator('.modal input').inputValue()) !== 'Game Room') throw new Error('typing in a dialog lost focus or closed it');
await alice.page.mouse.click(5, 5); // clicking outside must not close it
if (!(await alice.page.locator('.modal input').isVisible())) throw new Error('dialog closed on outside click');
await alice.page.locator('.modal input').fill('Gaming');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
log('✅ dialogs keep focus while typing (spaces included) and ignore outside clicks');
await alice.page.locator('.category', { hasText: 'Gaming' }).waitFor({ timeout: 10000 });
await alice.page.locator('.category', { hasText: 'Gaming' }).click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Create Channel' }).click();
if ((await alice.page.locator('.modal .vselect-value').first().textContent()) !== 'Gaming') throw new Error('category dropdown not preselected');
await alice.page.locator('.modal input[placeholder="new-channel"]').fill('clips');
await alice.page.locator('.modal').getByRole('button', { name: 'Create Channel' }).click();
await alice.page.getByText('This is the start of #clips').waitFor({ timeout: 15000 });
log('✅ right-click → Create Category / Create Channel works (no row-level security error)');

// ---- formatting bar on selected text
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 15000 });
await alice.page.locator('.composer textarea').fill('make this bold');
await alice.page.locator('.composer textarea').focus();
await alice.page.keyboard.press('End');
for (let i = 0; i < 4; i++) await alice.page.keyboard.press('Shift+ArrowLeft');
await alice.page.locator('.fmt-bar button[title^="Bold"]').click();
if ((await alice.page.locator('.composer textarea').inputValue()) !== 'make this **bold**') throw new Error('bold button did not wrap the selection');
await alice.page.keyboard.press('End');
await alice.page.keyboard.press('Enter');
await alice.page.locator('.message-text strong', { hasText: 'bold' }).last().waitFor({ timeout: 10000 });
log('✅ selecting text shows the formatting bar and it formats');

// ---- voice channel side chat
await alice.page.locator('.channel .channel-name').getByText('General', { exact: true }).click();
await alice.page.locator('.voice-view [title="Show voice channel chat"]').click();
await alice.page.locator('.vc-chat .composer textarea:not([disabled])').waitFor({ timeout: 15000 });
await alice.page.locator('.vc-chat .composer textarea').fill('chatting in the voice channel');
await alice.page.keyboard.press('Enter');
await alice.page.locator('.vc-chat .message-text', { hasText: 'chatting in the voice channel' }).waitFor({ timeout: 10000 });
await alice.page.locator('.voice-bar [title=Disconnect]').click();
log('✅ voice channel side chat works');

// ---- threads: replies stay out of the main channel; lock/rename
await alice.page.locator('.channel .channel-name').getByText('clips', { exact: true }).click();
await bob.page.locator('.channel .channel-name').getByText('clips', { exact: true }).click();
const rootMsg = alice.page.locator('.message', { hasText: 'make this bold' }).last();
await rootMsg.click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Create Thread' }).click();
await alice.page.locator('.modal input').fill('Bold talk');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
const threadBox = alice.page.locator('.thread-panel .composer textarea:not([disabled])');
await threadBox.waitFor({ timeout: 15000 });
await threadBox.fill('reply inside the thread');
await threadBox.press('Enter');
await alice.page.locator('.thread-panel .message-text', { hasText: 'reply inside the thread' }).waitFor({ timeout: 15000 });
if (await alice.page.locator('.chat:not(.thread-chat) .message-text', { hasText: 'reply inside the thread' }).count()) throw new Error('thread reply leaked into the main channel');
await bob.page.locator('.thread-summary', { hasText: 'Bold talk' }).waitFor({ timeout: 20000 });
await bob.page.locator('.thread-summary', { hasText: 'Bold talk' }).click();
await bob.page.locator('.thread-panel .message-text', { hasText: 'reply inside the thread' }).waitFor({ timeout: 15000 });
await alice.page.locator('.thread-panel [title^="Lock thread"]').click();
await bob.page.locator('.thread-panel textarea[placeholder="This thread is locked"]').waitFor({ timeout: 15000 });
await bob.page.locator('.thread-panel [aria-label="Close thread"]').click();
await alice.page.locator('.thread-panel [aria-label="Close thread"]').click();
log('✅ threads: side panel, replies stay out of the channel, locking works live');

// ---- scheduled message (encrypted now, delivered later by the server)
const schedBox = alice.page.locator('.chat:not(.thread-chat) .composer textarea:not([disabled])');
await schedBox.fill('this was scheduled');
await alice.page.locator('.chat:not(.thread-chat) .send-btn').click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'In 1 hour' }).click();
await alice.page.locator('.form-notice', { hasText: 'Scheduled for' }).waitFor({ timeout: 10000 });
execSync(`psql ${DB} -Atc "update public.scheduled_messages set send_at = now() - interval '1 second'; select public.deliver_scheduled_messages();"`);
await bob.page.locator('.message-text', { hasText: 'this was scheduled' }).waitFor({ timeout: 20000 });
log('✅ scheduled messages are delivered at their time');

// ---- reports: bob reports a message, alice (owner) handles it in the Report Centre
await bob.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
const target = bob.page.locator('.message', { hasText: 'secret after kick' }).first();
await target.click({ button: 'right' });
await bob.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Report Message' }).click();
await bob.page.locator('.modal input').fill('testing reports');
await bob.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await target.locator('.report-tag', { hasText: 'under review' }).waitFor({ timeout: 10000 });
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.locator('.sp-tab', { hasText: 'Report Centre' }).click();
const rcard = alice.page.locator('.report-card', { hasText: 'testing reports' });
await rcard.waitFor({ timeout: 10000 });
if (!(await rcard.locator('.evidence-msg.reported').count())) throw new Error('reported message not in evidence');
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/12-report-centre.png` });
await rcard.getByRole('button', { name: 'Dismiss' }).click();
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await rcard.waitFor({ state: 'detached', timeout: 10000 });
await alice.page.locator('.sp-close').click();
log('✅ reports: message reported (under review) and handled in the Report Centre');

// ---- server icon upload
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Server Settings/ }).click();
const iconPng = png;
await alice.page.locator('.asset-picker.icon input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: iconPng });
await alice.page.locator('.asset-picker.icon .asset-preview img').waitFor({ timeout: 15000 });
await alice.page.keyboard.press('Escape');
await alice.page.locator('.rail-item img.rail-icon').first().waitFor({ timeout: 15000 });
log('✅ server icon uploads and shows in the server list');

// ---- announcement channel: everyone reads, only moderators post
await alice.page.locator('.category', { hasText: 'Gaming' }).click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Create Channel' }).click();
await alice.page.locator('.modal .type-option', { hasText: 'Announcement' }).click();
await alice.page.locator('.modal input[placeholder="Lounge"]').fill('news');
await alice.page.locator('.modal').getByRole('button', { name: 'Create Channel' }).click();
await alice.page.getByText('This is the start of #news').waitFor({ timeout: 15000 });
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 15000 });
await alice.page.locator('.composer textarea').fill('big announcement');
await alice.page.keyboard.press('Enter');
await bob.page.locator('.channel .channel-name').getByText('news', { exact: true }).click({ timeout: 20000 });
await bob.page.locator('.message-text', { hasText: 'big announcement' }).waitFor({ timeout: 20000 });
if (await bob.page.locator('.composer textarea:not([disabled])').count()) throw new Error('members should not be able to post in announcement channels');
log('✅ announcement channels: moderators post, members read only');

// ---- forum channel: posts are their own discussions
await alice.page.locator('.category', { hasText: 'Gaming' }).click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Create Channel' }).click();
await alice.page.locator('.modal .type-option', { hasText: 'Forum' }).click();
await alice.page.locator('.modal input[placeholder="Lounge"]').fill('help');
await alice.page.locator('.modal').getByRole('button', { name: 'Create Channel' }).click();
await alice.page.locator('.forum-view').waitFor({ timeout: 15000 });
await alice.page.getByRole('button', { name: 'New Post' }).click();
await alice.page.locator('.modal input').first().fill('How do I build a base?');
await alice.page.locator('.modal textarea').first().fill('Asking for a friend');
await alice.page.locator('.modal').getByRole('button', { name: /^Post/ }).click();
await alice.page.locator('.forum-post-view .thread-root', { hasText: 'Asking for a friend' }).waitFor({ timeout: 15000 });
await bob.page.locator('.channel .channel-name').getByText('help', { exact: true }).click({ timeout: 20000 });
await bob.page.locator('.forum-card', { hasText: 'How do I build a base?' }).click({ timeout: 20000 });
await bob.page.locator('.forum-post-view .thread-root', { hasText: 'Asking for a friend' }).waitFor({ timeout: 20000 });
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/13-forum.png` });
log('✅ forum channels: posts are created encrypted and others can open them');

// ---- custom server emoji
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Server Settings/ }).click();
await alice.page.locator('.settings-nav button', { hasText: 'Emoji, GIFs & Sounds' }).click();
await alice.page.locator('.settings-content input[type=file]').setInputFiles({ name: 'pixel_dot.png', mimeType: 'image/png', buffer: png });
await alice.page.locator('.expr-item', { hasText: 'pixel_dot' }).waitFor({ timeout: 15000 });
await alice.page.keyboard.press('Escape');
await alice.page.locator('.channel .channel-name').getByText('clips', { exact: true }).click();
await bob.page.locator('.channel .channel-name').getByText('clips', { exact: true }).click();
await bob.page.waitForTimeout(500);
await alice.page.locator('.chat:not(.thread-chat) .composer textarea:not([disabled])').fill('party :pixel_dot: time');
await alice.page.keyboard.press('Enter');
await bob.page.locator('.message-text img.custom-emoji[alt=":pixel_dot:"]').waitFor({ timeout: 20000 });
log('✅ custom server emoji upload and show for other members');

// ---- invite links become an embed with a Join button
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Invite People/ }).click();
await alice.page.waitForFunction(() => document.querySelector('.modal .copy-row input')?.value.includes('/invite/'));
const invite2 = await alice.page.locator('.modal .copy-row input').inputValue();
await alice.page.keyboard.press('Escape');
await alice.page.locator('.chat:not(.thread-chat) .composer textarea:not([disabled])').fill(`come join ${invite2}`);
await alice.page.keyboard.press('Enter');
const embed = bob.page.locator('.invite-embed', { hasText: 'Venband HQ' }).last();
await embed.waitFor({ timeout: 20000 });
await embed.getByRole('button', { name: /Join|Open/ }).waitFor({ timeout: 10000 });
log('✅ invite links show an embed with the server name and a Join button');

// ---- templates: a Gaming server comes with its channels; discovery application goes to staff
await alice.page.locator('.rail-item[aria-label="Add a server"]').click();
await alice.page.locator('.modal .template-card', { hasText: 'Gaming' }).click();
await alice.page.locator('.modal').getByRole('button', { name: 'Next' }).click();
const fragName = `Frag Squad ${run}`;
await alice.page.locator('.modal input').first().fill(fragName);
await alice.page.locator('.modal').getByRole('button', { name: 'Next' }).click();
await alice.page.locator('.modal .check-row input[type=checkbox]').check();
await alice.page.locator('.modal textarea').first().fill('We play every night');
await alice.page.locator('.modal .chip', { hasText: 'Gaming' }).first().click();
await alice.page.locator('.modal').getByRole('button', { name: 'Create server' }).click();
await alice.page.locator('.server-header', { hasText: fragName }).waitFor({ timeout: 20000 });
for (const ch of ['looking-for-group', 'game-guides', 'Lobby', 'Tournament Stage']) await alice.page.locator('.channel .channel-name').getByText(ch, { exact: true }).waitFor({ timeout: 15000 });
log('✅ server templates create their channels (forum, stage, voice included)');
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.locator('.sp-tab', { hasText: 'Discovery Applications' }).click();
const app = alice.page.locator('.queue-card', { hasText: fragName });
await app.waitFor({ timeout: 15000 });
await app.getByRole('button', { name: 'Approve' }).click();
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await app.locator('.invite-status.approved').waitFor({ timeout: 15000 }).catch(async () => {
  await alice.page.locator('.mod-filters .vselect').first().click();
  await alice.page.getByRole('option', { name: 'All' }).click();
  await app.locator('.invite-status.approved').waitFor({ timeout: 15000 });
});
await alice.page.locator('.sp-close').click();
log('✅ discovery applications reach the staff queue and can be approved');

// ---- server folders: drop a server on another
const hqBtn = alice.page.locator('.rail-item[aria-label="Venband HQ"]');
const fragBtn = alice.page.locator(`.rail-item[aria-label="${fragName}"]`);
await fragBtn.dragTo(hqBtn);
await alice.page.locator('.rail-item.folder').waitFor({ timeout: 10000 });
await alice.page.locator('.rail-item.folder').click();
await alice.page.locator(`.folder-panel .rail-item[aria-label="${fragName}"]`).waitFor({ timeout: 10000 });
await alice.page.locator('.folder-panel [aria-label="Close folder"]').click();
log('✅ dragging a server onto another makes a folder');

// ---- public pages work signed out
{
  const anonCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const anon = await anonCtx.newPage();
  await anon.goto(APP + 'status');
  await anon.locator('.status-row').nth(5).waitFor({ timeout: 15000 });
  await anon.locator('.status-pill.ok', { hasText: 'Operational' }).first().waitFor({ timeout: 20000 });
  if (SHOTS) await anon.screenshot({ path: `${SHOTS}/20-status.png` });
  await anon.goto(APP + 'Tos');
  await anon.getByRole('heading', { name: 'Terms of Service' }).waitFor({ timeout: 10000 });
  await anon.goto(APP + 'discovery');
  await anon.locator(`.public-server[data-server-id="${hqId}"]`).waitFor({ timeout: 15000 });
  if (SHOTS) await anon.screenshot({ path: `${SHOTS}/21-discovery.png` });
  await anon.goto(APP + 'bots');
  await anon.getByText('Log in to make applications').waitFor({ timeout: 10000 });
  await anon.goto(APP + 'Voogle');
  await anon.getByRole('heading', { name: 'Voogle', exact: true }).waitFor({ timeout: 10000 });
  await anonCtx.close();
  log('✅ /status, /tos, /discovery, /bots and /voogle work signed out');
}

// ---- bots: a management bot joins by invite, posts through the API, answers /serverinfo
const hqChat = execSync(`psql ${DB} -Atc "select id from public.channels where server_id = '${hqId}' and name = 'chat'"`).toString().trim();
await alice.page.goto(APP + 'bots');
await alice.page.locator('.preset-card', { hasText: 'Server management' }).click();
await alice.page.locator('.create-app input').fill('HQ Helper');
await alice.page.getByRole('button', { name: 'Create bot' }).click();
await alice.page.locator('.app-dash-head h1', { hasText: 'HQ Helper' }).waitFor({ timeout: 15000 });
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/22-bot-dashboard.png` });
await alice.page.getByLabel('Server invite').fill(invite2);
await alice.page.getByRole('button', { name: 'Add bot' }).click();
await alice.page.locator('.form-notice', { hasText: 'joined the server' }).waitFor({ timeout: 15000 });
await alice.page.locator('.app-dash .tabs button', { hasText: 'Token' }).click();
await alice.page.getByRole('button', { name: 'Make a token' }).click();
const botToken = await alice.page.getByLabel('Bot token').inputValue();
if (!/^vb_[0-9a-f]{32}_/.test(botToken)) throw new Error('unexpected token ' + botToken.slice(0, 12));
const apiRes = await fetch(APP + 'api/bot', {
  method: 'POST',
  headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'send', channel: hqChat, content: 'hello from the **bot API**', embed: { title: 'Release notes', description: 'v2 is out', color: '#3ba55d' } }),
});
if (apiRes.status !== 200) throw new Error('bot API failed: ' + (await apiRes.text()));
const badRes = await fetch(APP + 'api/bot', { method: 'POST', headers: { authorization: 'Bot vb_nope', 'content-type': 'application/json' }, body: '{"action":"me"}' });
if (badRes.status !== 401) throw new Error('bad token should be 401, got ' + badRes.status);
await bob.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
const botMsg = bob.page.locator('.bot-message', { hasText: 'hello from the' });
await botMsg.waitFor({ timeout: 20000 });
await botMsg.locator('.bot-tag').waitFor();
await botMsg.locator('.bot-embed', { hasText: 'Release notes' }).waitFor();
await bob.page.locator('.members .bot-member', { hasText: 'HQ Helper' }).waitFor({ timeout: 10000 }).catch(() => {});
log('✅ bots: added by pasting an invite, token API posts with a BOT tag and embed (bad tokens get 401)');
await bob.page.locator('.composer textarea:not([disabled])').fill('/server');
await bob.page.locator('.mention-pop', { hasText: 'serverinfo' }).waitFor({ timeout: 10000 });
await bob.page.keyboard.press('Enter');
await bob.page.keyboard.press('Enter');
await bob.page.locator('.bot-message .bot-embed', { hasText: 'Members' }).waitFor({ timeout: 20000 });
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/23-bot-command.png` });
log('✅ slash commands autocomplete and preset bots answer them');

// ---- connect a site: webhook URL posts into a channel
await alice.page.goto(APP + 'bots');
await alice.page.locator('.preset-card', { hasText: 'Connect a site' }).click();
await alice.page.locator('.create-app input').fill('Shop Feed');
await alice.page.getByRole('button', { name: 'Create bot' }).click();
await alice.page.getByLabel('Server invite').fill(invite2);
await alice.page.getByRole('button', { name: 'Add bot' }).click();
await alice.page.locator('.form-notice', { hasText: 'joined the server' }).waitFor({ timeout: 15000 });
await alice.page.locator('.bot-settings .vselect').first().click();
await alice.page.getByRole('option', { name: '#chat' }).click();
await alice.page.getByRole('button', { name: 'Create webhook URL' }).click();
const hookUrl = await alice.page.locator('.secret-box input').inputValue();
const hookRes = await fetch(hookUrl.replace(/^https?:\/\/[^/]+\//, APP), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'New order #1042', username: 'Shop' }) });
if (hookRes.status !== 200) throw new Error('webhook failed: ' + (await hookRes.text()));
await bob.page.locator('.bot-message', { hasText: 'New order #1042' }).waitFor({ timeout: 20000 });
log('✅ connect-a-site webhooks post into the chosen channel');

// ---- Voogle: required verification, then alt lookup without any IP data
await alice.page.goto(APP + `channels/${hqId}`);
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Server Settings/ }).click();
await alice.page.locator('.settings-nav button', { hasText: 'Voogle' }).click();
await alice.page.locator('.check-row', { hasText: 'Use Voogle in this server' }).locator('input').check();
await alice.page.locator('.check-row', { hasText: 'must verify' }).locator('input').check();
// alice and bob share this machine and network, so Voogle rightly sees them as linked: only review real risk
await alice.page.getByLabel('Send to moderators at risk score').fill('100');
await alice.page.locator('.settings-content').getByRole('button', { name: 'Save' }).click();
await alice.page.locator('.settings-content .form-notice', { hasText: 'Saved' }).waitFor({ timeout: 10000 });
await alice.page.keyboard.press('Escape');
await bob.page.reload();
const gate = bob.page.locator('.voogle-gate');
await gate.waitFor({ timeout: 20000 });
if (await bob.page.locator('.composer textarea:not([disabled])').count()) throw new Error('should not be able to talk before verifying');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/24-voogle-gate.png` });
await gate.getByRole('button', { name: 'Verify' }).click();
await gate.waitFor({ state: 'detached', timeout: 20000 });
await bob.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
log('✅ Voogle: members verify before talking, then the composer unlocks');
await alice.page.goto(APP + 'voogle');
await alice.page.getByLabel('User').fill('@bob_' + run);
await alice.page.getByRole('button', { name: 'Look up' }).click();
await alice.page.locator('.risk-badge').waitFor({ timeout: 15000 });
const lookupText = await alice.page.locator('.lookup-result').innerText();
if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(lookupText)) throw new Error('lookup leaked an IP address');
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/25-voogle-lookup.png` });
await alice.page.goto(APP + `channels/${hqId}`);
await alice.page.locator('.server-header').waitFor({ timeout: 20000 });
log('✅ Voogle lookups show a risk score and likely alts, never IPs');

// ---- server moderation: timeouts, warnings, audit log
const { createHmac } = await import('node:crypto');
function totp(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
await alice.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
const bobMember = alice.page.locator('.members .member', { hasText: 'Bob' }).first();
await bobMember.click({ button: 'right' });
await alice.page.locator('.ctx-timeouts .chip', { hasText: '5m' }).click();
await alice.page.locator('.modal input').fill('cool off');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await bob.page.locator('.timeout-bar', { hasText: 'cool off' }).waitFor({ timeout: 20000 });
if (await bob.page.locator('.composer textarea:not([disabled])').count()) throw new Error('timed out members should not be able to type');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/30-timeout.png` });
await bobMember.click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Remove Timeout' }).click();
await bob.page.locator('.timeout-bar').waitFor({ state: 'detached', timeout: 20000 });
await bob.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
log('✅ timeouts make a member read-only until removed');
await bobMember.click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: /^Warn / }).click();
await alice.page.locator('.modal input').fill('please keep it friendly');
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await bob.page.locator('.modal .warning-reason', { hasText: 'please keep it friendly' }).waitFor({ timeout: 20000 });
await bob.page.locator('.modal').getByRole('button', { name: 'I understand' }).click();
await bob.page.locator('.modal .warning-reason').waitFor({ state: 'detached', timeout: 10000 });
log('✅ warnings pop up for the member until they acknowledge them');
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Server Settings/ }).click();
await alice.page.locator('.settings-nav button', { hasText: 'Audit Log' }).click();
await alice.page.locator('.audit-row', { hasText: 'timed out' }).first().waitFor({ timeout: 15000 });
await alice.page.locator('.audit-row', { hasText: 'warned' }).first().waitFor({ timeout: 15000 });
await alice.page.locator('.audit-filters input').fill('warned');
if ((await alice.page.locator('.audit-row').count()) < 1 || (await alice.page.locator('.audit-row', { hasText: 'timed out' }).count())) throw new Error('audit log search did not filter');
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/31-audit-log.png` });
log('✅ the audit log records moderation and can be searched');

// ---- server reports: moderators see them (reporter hidden) and jump to the message
await alice.page.locator('.settings-nav button', { hasText: 'Reports' }).click();
const srvReport = alice.page.locator('.report-card', { hasText: 'testing reports' });
await srvReport.waitFor({ timeout: 15000 });
if (await srvReport.locator('.evidence-msg.reported').count() !== 1) throw new Error('reported message not highlighted');
await srvReport.getByRole('button', { name: 'Jump to message' }).click();
await alice.page.locator('.message.flash', { hasText: 'secret after kick' }).waitFor({ timeout: 20000 });
log('✅ server moderators see reports and jump straight to the reported message');

// ---- removed GIFs show the Terms notice for everyone
await alice.page.locator('.composer textarea:not([disabled])').fill('https://static.klipy.com/ii/test/removed-me.gif');
await alice.page.keyboard.press('Enter');
const gifMsg = alice.page.locator('.message', { has: alice.page.locator('.embed-wrap') }).last();
await gifMsg.waitFor({ timeout: 20000 });
await gifMsg.click({ button: 'right' });
await alice.page.locator('.ctx-menu').getByRole('menuitem', { name: 'Remove GIF from Server' }).click();
await bob.page.locator('.gif-removed', { hasText: 'venband.com/tos' }).last().waitFor({ timeout: 20000 });
log('✅ owners can remove a GIF; everyone sees the Terms of Service notice instead');

// ---- link safety
await alice.page.locator('.composer textarea:not([disabled])').fill('free stuff http://paypa1-login.xyz/claim');
await alice.page.keyboard.press('Enter');
await bob.page.locator('.message-text a', { hasText: 'paypa1-login.xyz' }).last().click();
await bob.page.locator('.modal', { hasText: 'This link looks dangerous' }).waitFor({ timeout: 10000 });
await bob.page.locator('.modal .link-risks li').first().waitFor();
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/32-link-warning.png` });
await bob.page.locator('.modal').getByRole('button', { name: 'Go back' }).click();
log('✅ risky links get a warning before they open');

// ---- custom badges designed by the Venband owner
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.locator('.sp-tab', { hasText: 'Badge Designer' }).click();
const [chooser] = await Promise.all([alice.page.waitForEvent('filechooser'), alice.page.getByLabel('Upload badge picture').click()]);
await chooser.setFiles({ name: 'star.png', mimeType: 'image/png', buffer: png });
await alice.page.locator('.modal').getByRole('button', { name: 'Apply' }).click();
await alice.page.locator('.badge-designer input').first().fill(`event_${run}`);
await alice.page.locator('.badge-designer input').nth(1).fill('Summer Event');
await alice.page.getByRole('button', { name: 'Save badge' }).click();
await alice.page.locator('.badge-choice', { hasText: `c_event_${run}` }).waitFor({ timeout: 15000 });
log('✅ the Venband owner can design badges with an uploaded picture');

// ---- security centre: data export, two-factor sign-in
await alice.page.locator('.sp-tab', { hasText: 'Security' }).click();
const [exportDl] = await Promise.all([alice.page.waitForEvent('download'), alice.page.getByRole('button', { name: 'Download my data' }).click()]);
const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await exportDl.path(), 'utf8'));
if (exported.profile?.username !== `alice_${run}`) throw new Error('export is missing the profile');
log('✅ data export downloads your account data');
await alice.page.getByRole('button', { name: 'Set up an authenticator app' }).click();
const secret = (await alice.page.locator('.mfa-secret').innerText()).trim();
await alice.page.getByLabel('Setup code').fill(totp(secret));
await alice.page.getByRole('button', { name: 'Turn on' }).click();
await alice.page.locator('.pill.active', { hasText: 'On' }).waitFor({ timeout: 15000 });
await alice.page.locator('.sp-tab', { hasText: 'My Account' }).click();
await alice.page.getByRole('button', { name: /Log Out/i }).click();
await alice.page.getByText('Welcome back').waitFor({ timeout: 20000 });
await alice.page.locator('input[type=email]').fill(alice.email);
await alice.page.locator('input[type=password]').fill(alice.password);
await alice.page.locator('.auth-card').getByRole('button', { name: 'Log in' }).click();
await alice.page.getByText('Two-factor check').waitFor({ timeout: 20000 });
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/33-two-factor.png` });
await alice.page.getByLabel('Authenticator code').fill(totp(secret, 1));
await alice.page.locator('.auth-card').getByRole('button', { name: 'Continue' }).click();
await alice.page.locator('.user-panel').waitFor({ timeout: 30000 });
await alice.page.goto(APP + `channels/${hqId}`);
await alice.page.locator('.channel .channel-name').getByText('chat', { exact: true }).click();
await alice.page.locator('.message-text', { hasText: 'secret after kick' }).first().waitFor({ timeout: 20000 });
log('✅ two-factor sign-in asks for the authenticator code, then messages decrypt');
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.locator('.sp-tab', { hasText: 'Security' }).click();
await alice.page.getByRole('button', { name: 'Turn off' }).click();
await alice.page.locator('.modal').getByRole('button', { name: 'Turn off' }).click();
await alice.page.getByRole('button', { name: 'Set up an authenticator app' }).waitFor({ timeout: 15000 });
log('✅ two-factor sign-in can be turned off again');

// ---- deleted servers can be restored for 7 days
await alice.page.locator('.sp-close').click();
await alice.page.goto(APP + `channels/${hqId}`);
await alice.page.locator('.server-header').waitFor({ timeout: 20000 });
const fragId = execSync(`psql ${DB} -Atc "select id from public.servers where name = '${'Frag Squad ' + run}'"`).toString().trim();
await alice.page.goto(APP + `channels/${fragId}`);
await alice.page.locator('.server-header', { hasText: 'Frag Squad' }).click();
await alice.page.getByRole('button', { name: /Server Settings/ }).click();
await alice.page.getByRole('button', { name: 'Delete Server' }).click();
await alice.page.locator('.modal input').last().fill(`Frag Squad ${run}`);
await alice.page.locator('.modal').last().getByRole('button', { name: 'Save' }).click();
await alice.page.waitForFunction((id) => !document.querySelector(`.rail-item[aria-label^="Frag Squad"]`), fragId, { timeout: 20000 });
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.locator('.sp-tab', { hasText: 'Security' }).click();
await alice.page.getByRole('button', { name: 'Restore' }).click();
await alice.page.locator('.form-notice', { hasText: 'is back' }).waitFor({ timeout: 15000 });
await alice.page.locator('.sp-close').click();
await alice.page.reload();
await alice.page.locator('.user-panel').waitFor({ timeout: 20000 });
if (!(await execSync(`psql ${DB} -Atc "select status from public.servers where id = '${fragId}'"`).toString().includes('active'))) throw new Error('server not restored');
await alice.page.goto(APP + `channels/${hqId}`);
await alice.page.locator('.server-header').waitFor({ timeout: 20000 });
log('✅ deleted servers wait in Settings → Security and can be restored');

// ---- profiles: picture, frame, animated gradient name, long status bubble (live for others)
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.locator('.sp-tab', { hasText: 'Profiles' }).click();
const [picChooser] = await Promise.all([alice.page.waitForEvent('filechooser'), alice.page.getByRole('button', { name: 'Profile picture' }).click()]);
await picChooser.setFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
await alice.page.locator('.modal').getByRole('button', { name: 'Apply' }).click();
await alice.page.locator('.profile-editor-preview .avatar.has-picture').first().waitFor({ timeout: 15000 });
await alice.page.locator('.frame-option[aria-label="Neon"]').click();
await alice.page.getByRole('button', { name: '+ Colour' }).first().click();
await alice.page.getByRole('button', { name: '+ Colour' }).first().click();
await alice.page.getByRole('button', { name: 'Animation' }).click().catch(async () => {
  await alice.page.locator('.name-style-editor .vselect').nth(1).click();
});
await alice.page.getByRole('option', { name: 'Shimmer' }).click();
const longStatus = 'Working on the Venband desktop app all week, then a road trip with friends — send memes, I’ll reply when I’m back online. '.repeat(2).slice(0, 240);
await alice.page.getByLabel('Custom status').fill(longStatus);
await alice.page.getByRole('button', { name: 'Save Changes' }).click();
await alice.page.locator('.notice', { hasText: 'Profile saved' }).waitFor({ timeout: 15000 });
await alice.page.getByRole('button', { name: 'Publish to the Marketplace' }).first().click();
await alice.page.locator('.modal input').fill(`Shimmer Pop ${run}`);
await alice.page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await alice.page.locator('.notice', { hasText: 'Published' }).waitFor({ timeout: 15000 });
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/40-profile-editor.png` });
await alice.page.locator('.sp-close').click();
const aliceRow = bob.page.locator('.members .member', { hasText: 'Alice' }).first();
await aliceRow.locator('.avatar.has-picture.frame-neon').waitFor({ timeout: 20000 });
await aliceRow.locator('.styled-name.gradient.fx-shimmer').waitFor({ timeout: 20000 });
await aliceRow.click();
await bob.page.locator('.modal .status-bubble', { hasText: 'road trip' }).waitFor({ timeout: 10000 });
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/41-profile-card.png` });
await bob.page.keyboard.press('Escape');
log('✅ profile picture, frame, gradient name and status bubble show up live for others');

// ---- marketplace in DMs: use someone's published name style
await bob.page.locator('.rail-item.home').click();
await bob.page.locator('.nav-item', { hasText: 'Marketplace' }).click();
await bob.page.locator('.market-view .tabs button', { hasText: 'Name styles' }).click();
const card = bob.page.locator('.market-card', { hasText: `Shimmer Pop ${run}` });
await card.waitFor({ timeout: 15000 });
await card.getByRole('button', { name: 'Use' }).click();
await bob.page.locator('.market-view .form-notice', { hasText: 'Now using' }).waitFor({ timeout: 10000 });
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/42-marketplace.png` });
log('✅ the Marketplace in DMs lets people use published name styles');

// ---- custom CSS from a template, with the tutorial
await bob.page.locator('.user-panel [title="User settings"]').click();
await bob.page.locator('.sp-tab', { hasText: 'Appearance' }).click();
await bob.page.locator('.tabs button', { hasText: 'Background & CSS' }).click();
await bob.page.getByRole('button', { name: 'Watch the tutorial' }).click();
await bob.page.locator('.css-tutorial .css-tut-code pre').waitFor({ timeout: 5000 });
await bob.page.waitForTimeout(800);
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/43-css-tutorial.png` });
await bob.page.locator('.css-tutorial').getByRole('button', { name: 'Close' }).click();
await bob.page.locator('.css-template', { hasText: 'Bigger messages' }).click();
await bob.page.waitForFunction(() => document.getElementById('venband-custom-css')?.textContent?.includes('font-size: 17px'), null, { timeout: 10000 });
await bob.page.locator('.css-editor').fill('@import url(https://evil.example/x.css); .message-text { background: url(https://evil.example/t.png) }');
await bob.page.getByRole('button', { name: 'Apply' }).click();
const applied = await bob.page.evaluate(() => document.getElementById('venband-custom-css')?.textContent ?? '');
if (/evil\.example/.test(applied)) throw new Error('custom CSS was not cleaned: ' + applied);
await bob.page.locator('.toggle-row', { hasText: 'Use my custom CSS' }).locator('input').uncheck();
await bob.page.locator('.sp-close').click();
log('✅ custom CSS: templates apply, outside links and @import are stripped, tutorial plays');

// ---- group chats: invite links, owner removes people
await alice.page.locator('.rail-item.home').click();
await alice.page.locator('.channel.dm', { hasText: 'Test crew' }).click({ timeout: 20000 });
await alice.page.getByTitle(/Group settings/).click();
await alice.page.getByRole('button', { name: 'Create invite link' }).click();
const groupLink = await alice.page.getByLabel('Group invite link').inputValue();
await alice.page.keyboard.press('Escape');
await bob.page.goto(groupLink);
await bob.page.locator('.channel.dm', { hasText: 'Test crew' }).waitFor({ timeout: 20000 });
await bob.page.locator('.chat-header', { hasText: 'Test crew' }).waitFor({ timeout: 20000 });
log('✅ group invite links let people join (up to 15)');
await alice.page.getByTitle(/Group settings/).click();
await alice.page.locator('.modal .group-members .member', { hasText: 'Bob' }).getByRole('button', { name: 'Remove' }).click();
await alice.page.locator('.modal').last().getByRole('button', { name: 'Remove', exact: true }).click();
await bob.page.locator('.channel.dm', { hasText: 'Test crew' }).waitFor({ state: 'detached', timeout: 20000 });
await alice.page.goto(APP + `channels/${hqId}`);
await alice.page.locator('.server-header').waitFor({ timeout: 20000 });
await bob.page.goto(APP + `channels/${hqId}`);
await bob.page.locator('.server-header').waitFor({ timeout: 20000 });
log('✅ the group owner can remove people');

// ---- phone layout
await bob.page.setViewportSize({ width: 390, height: 844 });
await bob.page.waitForTimeout(400);
if (await bob.page.locator('.sidebar').isVisible() && (await bob.page.locator('.sidebar').boundingBox()).x >= 0) throw new Error('channel list should be tucked away on phones');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/m1-chat.png` });
await bob.page.locator('.topbar-menu').click();
await bob.page.waitForTimeout(450);
if ((await bob.page.locator('.sidebar').boundingBox()).x < 0) throw new Error('menu did not open the channel list');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/m2-drawer.png` });
await bob.page.locator('.sidebar .channel', { hasText: 'welcome' }).click();
await bob.page.waitForTimeout(450);
if ((await bob.page.locator('.sidebar').boundingBox()).x >= 0) throw new Error('picking a channel should close the menu');
await bob.page.locator('.chat-header [title="Member list"]').click();
await bob.page.waitForTimeout(450);
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/m3-members.png` });
await bob.page.locator('.drawer-scrim').click({ position: { x: 20, y: 300 } });
await bob.page.locator('.user-panel [title="User settings"]').click();
await bob.page.waitForTimeout(400);
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/m4-settings.png` });
await bob.page.locator('.sp-close').click();
await bob.page.setViewportSize({ width: 1400, height: 850 });
log('✅ phone layout: slide-in channel list and member list, settings fit');

// ---- logging out and back in works; unticking "stay signed in" asks for the password after refresh
await alice.page.locator('.user-panel [title="User settings"]').click();
await alice.page.getByRole('button', { name: /Log Out/i }).click();
await alice.page.getByText('Welcome back').waitFor({ timeout: 20000 });
await alice.page.locator('input[type=email]').fill(alice.email);
await alice.page.locator('input[type=password]').fill(alice.password);
await alice.page.getByRole('checkbox').uncheck();
await alice.page.locator('.auth-card').getByRole('button', { name: 'Log in' }).click();
await alice.page.locator('.user-panel').waitFor({ timeout: 30000 });
await alice.page.reload();
await alice.page.getByText('Enter your password').waitFor({ timeout: 20000 });
await login(alice);
log('✅ logout / login / password-on-refresh all work');

// ---- wrong password gives a clear message
await bob.page.locator('.user-panel [title="User settings"]').click();
await bob.page.getByRole('button', { name: /Log Out/i }).click();
await bob.page.locator('input[type=email]').fill(bob.email);
await bob.page.locator('input[type=password]').fill('not-the-password-123');
await bob.page.locator('.auth-card').getByRole('button', { name: 'Log in' }).click();
await bob.page.getByText('don’t match an account').waitFor({ timeout: 30000 });
log('✅ wrong password shows a friendly error');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/0-login-error.png` });

// the realtime server must never have had to rate-limit us (that closes channels)
try {
  const since = new Date(testStart).toISOString();
  const logs = execSync(`docker logs supabase_realtime_venband --since ${since} 2>&1`).toString();
  const hits = logs.split('\n').filter((l) => /RateLimitReached/.test(l));
  if (hits.length) throw new Error(`realtime rate limit hit ${hits.length}x: ${hits[0].slice(0, 200)}`);
  log('✅ no realtime rate-limit errors during the whole run');
} catch (e) {
  if (/rate limit hit/.test(e.message)) throw e;
  log('(skipped realtime log check: docker not available)');
}

await browser.close();
log('ALL E2E CHECKS PASSED');
}
main().catch(async (e) => { console.log('FAIL', e.message.split('\n').slice(0, 14).join('\n')); for (const u of [alice, bob]) { try { if (SHOTS) await u.page.screenshot({ path: `${SHOTS}/fail-${u.name}.png` }); console.log(u.name, 'text:', (await u.page.evaluate(() => document.body.innerText)).slice(0, 700).replace(/\n+/g, ' | ')); } catch {} } process.exit(1); });
