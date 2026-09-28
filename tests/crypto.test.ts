// Unit tests for the crypto layer. Run with `npm test` (Node >= 22.18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  channelKeyCheck,
  createIdentity,
  decryptBlob,
  decryptMessage,
  deriveMasterKeys,
  encryptBlob,
  encryptMessage,
  fingerprint,
  newChannelKey,
  resealIdentity,
  unsealIdentity,
  unwrapKey,
  verify,
  sign,
  wrapContext,
  wrapKey,
} from '../src/lib/crypto.ts';

const ALICE = '00000000-0000-0000-0000-00000000000a';
const BOB = '00000000-0000-0000-0000-00000000000b';
const CHANNEL = '11111111-1111-1111-1111-111111111111';

test('master key derivation is deterministic and separates auth from vault', async () => {
  const a = await deriveMasterKeys(' Alice@Example.com ', 'correct horse battery staple');
  const b = await deriveMasterKeys('alice@example.com', 'correct horse battery staple');
  const c = await deriveMasterKeys('alice@example.com', 'wrong password');
  assert.equal(a.authPassword, b.authPassword);
  assert.notEqual(a.authPassword, c.authPassword);
  assert.match(a.authPassword, /^[0-9a-f]{64}$/);
  assert.equal(a.vaultKey.extractable, false);
});

test('identity seal / unseal / wrong password / reseal', async () => {
  const good = await deriveMasterKeys('alice@example.com', 'pw-one-1234567');
  const bad = await deriveMasterKeys('alice@example.com', 'pw-two-1234567');
  const { identity, sealed } = await createIdentity(ALICE, good.vaultKey);
  assert.equal(identity.encPrivate.extractable, false);
  const reopened = await unsealIdentity(ALICE, sealed, good.vaultKey);
  assert.equal(reopened.keyId, identity.keyId);
  await assert.rejects(unsealIdentity(ALICE, sealed, bad.vaultKey));
  await assert.rejects(unsealIdentity(BOB, sealed, good.vaultKey), 'bound to user id');
  const resealed = await resealIdentity(ALICE, sealed, good.vaultKey, bad.vaultKey);
  assert.equal((await unsealIdentity(ALICE, resealed, bad.vaultKey)).keyId, identity.keyId);
});

test('channel key wrap / unwrap and message round-trip', async () => {
  const vault = (await deriveMasterKeys('x@example.com', 'pw-1234567890')).vaultKey;
  const alice = (await createIdentity(ALICE, vault)).identity;
  const bob = (await createIdentity(BOB, vault)).identity;

  const raw = newChannelKey();
  const ctx = wrapContext(CHANNEL, 1, BOB, bob.keyId);
  const w = await wrapKey(raw, bob.encPublic, ctx);
  const got = await unwrapKey(bob, w, ctx);
  assert.deepEqual(got, raw);
  assert.equal(await channelKeyCheck(got, CHANNEL, 1), await channelKeyCheck(raw, CHANNEL, 1));
  await assert.rejects(unwrapKey(alice, w, ctx), 'wrong recipient');
  await assert.rejects(unwrapKey(bob, w, wrapContext(CHANNEL, 2, BOB, bob.keyId)), 'context bound');

  const id = crypto.randomUUID();
  const env = await encryptMessage(alice, raw, id, CHANNEL, 1, { v: 1, text: 'hello 🔐', sentAt: 1 });
  const pt = await decryptMessage(got, alice.signPublic, id, CHANNEL, ALICE, alice.keyId, 1, env);
  assert.equal(pt.text, 'hello 🔐');

  // tampering / replay / impersonation all fail
  await assert.rejects(decryptMessage(got, alice.signPublic, crypto.randomUUID(), CHANNEL, ALICE, alice.keyId, 1, env));
  await assert.rejects(decryptMessage(got, bob.signPublic, id, CHANNEL, ALICE, alice.keyId, 1, env));
  await assert.rejects(decryptMessage(got, alice.signPublic, id, CHANNEL, BOB, alice.keyId, 1, env));
  const flipped = { ...env, ciphertext: env.ciphertext.slice(0, -4) + 'AAA=' };
  await assert.rejects(decryptMessage(got, alice.signPublic, id, CHANNEL, ALICE, alice.keyId, 1, flipped));
});

test('signatures', async () => {
  const vault = (await deriveMasterKeys('y@example.com', 'pw-1234567890')).vaultKey;
  const alice = (await createIdentity(ALICE, vault)).identity;
  const s = await sign(alice, 'msg');
  assert.ok(await verify(alice.signPublic, s, 'msg'));
  assert.ok(!(await verify(alice.signPublic, s, 'msg2')));
  assert.ok(!(await verify(alice.signPublic, 'garbage', 'msg')));
});

test('blob encryption and fingerprints', async () => {
  const data = new TextEncoder().encode('file contents').buffer;
  const { blob, key, iv } = await encryptBlob(data);
  assert.equal(new TextDecoder().decode(await decryptBlob(blob.buffer, key, iv)), 'file contents');
  const vault = (await deriveMasterKeys('z@example.com', 'pw-1234567890')).vaultKey;
  const a = (await createIdentity(ALICE, vault)).identity;
  const fp = await fingerprint(a.encPublic, a.signPublic);
  assert.match(fp, /^(\d{5} ){11}\d{5}$/);
});
