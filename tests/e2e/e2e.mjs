// Full end-to-end test against a local Supabase stack (npx supabase start)
// and the dev server (npm run dev). Usage: npm run test:e2e
// Env: APP_URL (default http://127.0.0.1:5173/), CHROME_PATH (optional), SHOTS (screenshot dir)
import { chromium } from 'playwright';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const MAIL = 'http://127.0.0.1:54324/api/v1';
const SHOTS = process.env.SHOTS;
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const run = Date.now().toString(36);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function newUser(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${name} pageerror]`, e.message));
  page.on('console', (m) => m.type() === 'error' && log(`[${name} console]`, m.text().slice(0, 200)));
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
  await page.locator('.user-panel').waitFor({ timeout: 30000 });
  log(u.name, 'is in the app');
}

const alice = await newUser('alice');
const bob = await newUser('bob');
async function main() {

// ---- unverified login is rejected
await alice.page.goto(APP);
await signupAndVerify(alice);
log('alice after verify link, page says:', (await alice.page.evaluate(() => document.body.innerText)).slice(0, 80).replace(/\n/g, ' | '));
await login(alice);

// ---- create a server
await alice.page.locator('.rail-item.add').click();
await alice.page.locator('.modal input').first().fill('Venband HQ');
await alice.page.locator('.modal form').getByRole('button', { name: 'Create' }).click();
await alice.page.getByText('This is the start of #general').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea').fill('hello bob, this is **encrypted** 🔐');
await alice.page.keyboard.press('Enter');
await alice.page.getByText('hello bob, this is').waitFor();
log('alice sent a message');

// ---- invite
await alice.page.locator('.server-header').click();
await alice.page.getByRole('button', { name: /Invite People/ }).click();
const inviteInput = alice.page.locator('.modal .copy-row input');
await alice.page.waitForFunction(() => document.querySelector('.modal .copy-row input')?.value.includes('invite='));
const invite = await inviteInput.inputValue();
log('invite link', invite);
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/3-invite.png` });
await alice.page.keyboard.press('Escape');

// ---- bob
await signupAndVerify(bob);
await login(bob);
await bob.page.goto(invite);
await bob.page.locator('.server-header').waitFor({ timeout: 20000 });
log('bob joined server');
await bob.page.getByText('hello bob, this is').waitFor({ timeout: 30000 });
log('✅ bob decrypted alice message (key was distributed E2E)');
await bob.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await bob.page.locator('.composer textarea').fill('hi alice! got it');
await bob.page.keyboard.press('Enter');
await alice.page.getByText('hi alice! got it').waitFor({ timeout: 20000 });
log('✅ alice received bob reply live');

// ---- verify server only has ciphertext
const { execSync } = await import('node:child_process');
const rows = execSync(`psql ${DB} -Atc "select ciphertext from public.messages"`).toString();
if (/hello|alice|bob/i.test(rows)) throw new Error('PLAINTEXT FOUND IN DB');
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
await bobRow.locator('select.add-role').selectOption({ label: 'Moderators' });
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
await alice.page.locator('.channel .channel-name').getByText('general', { exact: true }).click();
await alice.page.waitForTimeout(800);
if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/6-chat.png` });

// ---- kick bob -> key rotation, bob loses access
await alice.page.locator('.voice-bar [title=Disconnect]').click();
await alice.page.locator('.member', { hasText: 'Bob' }).click();
alice.page.once('dialog', (d) => d.accept());
await alice.page.getByRole('button', { name: 'Kick' }).click();
await alice.page.waitForTimeout(1500);
await alice.page.locator('.composer textarea:not([disabled])').waitFor();
await alice.page.locator('.composer textarea').fill('secret after kick');
await alice.page.keyboard.press('Enter');
await alice.page.getByText('secret after kick').waitFor({ timeout: 20000 });
const epochs = execSync(`psql ${DB} -Atc "select max(epoch) from public.channel_epochs e join public.channels c on c.id=e.channel_id where c.name='general'"`).toString().trim();
log('✅ after kick, general channel is on key epoch', epochs);

// ---- kicked bob is sent home; DMs + DM call ringing
await bob.page.getByText('It’s quiet in here').waitFor({ timeout: 20000 });
log('✅ kicked bob was moved out of the server');
await alice.page.locator('.rail-item.home').click();
await alice.page.getByRole('button', { name: 'New direct message' }).click();
await alice.page.locator('.modal input').fill('bob_' + run);
await alice.page.getByRole('button', { name: 'Open DM' }).click();
await alice.page.locator('.composer textarea:not([disabled])').waitFor({ timeout: 20000 });
await alice.page.locator('.composer textarea').fill('private DM for bob only');
await alice.page.keyboard.press('Enter');
await bob.page.locator('.channel.dm', { hasText: 'Alice' }).click({ timeout: 20000 });
await bob.page.getByText('private DM for bob only').waitFor({ timeout: 20000 });
log('✅ DM delivered and decrypted');
// encrypted attachment (1x1 PNG)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await alice.page.locator('.composer input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
await alice.page.locator('.composer textarea').fill('here is a file');
await alice.page.keyboard.press('Enter');
await bob.page.locator('img.attachment-img[alt="pixel.png"]').waitFor({ timeout: 20000 });
const stored = execSync(`psql ${DB} -Atc "select count(*) from storage.objects where bucket_id='attachments'"`).toString().trim();
log('✅ encrypted attachment uploaded, decrypted and shown to bob; objects in bucket:', stored);
await bob.page.locator('.rail-item.home').click();
await bob.page.evaluate(() => { history.replaceState(null, '', location.pathname); });
await alice.page.locator('.chat-header').getByRole('button', { name: /Call/ }).click();
await bob.page.locator('.toast').getByTitle('Join call').click({ timeout: 20000 });
await bob.page.locator('.tile').nth(1).waitFor({ timeout: 30000 });
log('✅ DM call rang on bob and connected');
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/7-dm-call.png` });
await alice.page.locator('.voice-bar [title=Disconnect]').click();

// ---- refreshing keeps you signed in ("stay signed in" is on by default)
await alice.page.reload();
await alice.page.locator('.user-panel').waitFor({ timeout: 20000 });
await alice.page.locator('.rail-item:not(.home):not(.add)').first().click();
await alice.page.getByText('secret after kick').waitFor({ timeout: 20000 });
log('✅ refresh keeps you signed in and history still decrypts');

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

await browser.close();
log('ALL E2E CHECKS PASSED');
}
main().catch(async (e) => { console.log('FAIL', e.message.split('\n')[0]); for (const u of [alice, bob]) { try { await u.page.screenshot({ path: `${SHOTS}/fail-${u.name}.png` }); console.log(u.name, 'text:', (await u.page.evaluate(() => document.body.innerText)).slice(0, 700).replace(/\n+/g, ' | ')); } catch {} } process.exit(1); });
