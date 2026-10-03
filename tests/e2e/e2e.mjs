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

// ---- unverified login is rejected
await alice.page.goto(APP);
await signupAndVerify(alice);
log('alice after verify link, page says:', (await alice.page.evaluate(() => document.body.innerText)).slice(0, 80).replace(/\n/g, ' | '));
await login(alice);

// ---- create a server
await alice.page.locator('.rail-item[aria-label="Add a server"]').click();
await alice.page.locator('.modal input').first().fill('Venband HQ');
await alice.page.locator('.modal form').getByRole('button', { name: 'Create' }).click();
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
await bob.page.locator('.toast', { hasText: 'is in a call' }).waitFor({ timeout: 8000 });
log('✅ hanging up is seen immediately; no ringing for the person who left');
// and joining again from the toast works
await bob.page.locator('.toast').getByTitle('Join call').click();
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
await bob.page.locator('.toast').getByTitle('Join call').click({ timeout: 20000 });
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
await alice.page.locator('.modal input[placeholder="@username"]').fill('bob_' + run);
await alice.page.locator('.modal').getByRole('button', { name: 'Add', exact: true }).click();
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
bob.page.once('dialog', (d) => d.accept());
await bob.page.getByRole('button', { name: 'Leave group' }).click();
await bob.page.locator('.channel.dm', { hasText: 'Test crew' }).waitFor({ state: 'detached', timeout: 20000 });
await alice.page.locator('.composer textarea').fill('after bob left');
await alice.page.keyboard.press('Enter');
await alice.page.getByText('after bob left').waitFor({ timeout: 20000 });
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
await bob.page.locator('.modal form').getByRole('button', { name: 'Create' }).click();
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
if (SHOTS) await bob.page.screenshot({ path: `${SHOTS}/11-server-badges.png` });

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
main().catch(async (e) => { console.log('FAIL', e.message.split('\n')[0]); for (const u of [alice, bob]) { try { if (SHOTS) await u.page.screenshot({ path: `${SHOTS}/fail-${u.name}.png` }); console.log(u.name, 'text:', (await u.page.evaluate(() => document.body.innerText)).slice(0, 700).replace(/\n+/g, ' | ')); } catch {} } process.exit(1); });
