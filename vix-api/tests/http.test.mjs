import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchRoute, routeScore } from '../api/_lib/http.js'
import { cleanPath } from '../api/router.js'
import { languageForPath } from '../shared/languages.js'
import { parseSecrets } from '../shared/extensions.js'
import { isPrivateAddress } from '../api/_lib/net.js'
import { hashPassword, verifyPassword, validateUsername } from '../api/_lib/auth.js'

test('route matching', () => {
  assert.deepEqual(matchRoute('/scores', '/scores'), {})
  assert.deepEqual(matchRoute('/scores', '/scores/'), {})
  assert.equal(matchRoute('/scores', '/scores/1'), null)
  assert.deepEqual(matchRoute('/users/:id', '/users/42'), { id: '42' })
  assert.deepEqual(matchRoute('/files/*', '/files/a/b.txt'), { '*': 'a/b.txt' })
  assert.deepEqual(matchRoute('/search/:q?', '/search'), {})
  assert.deepEqual(matchRoute('/', '/'), {})
  assert.equal(matchRoute('/', '/x'), null)
  assert.ok(routeScore('/users/me') > routeScore('/users/:id'))
  assert.ok(routeScore('/users/:id') > routeScore('/users/*'))
})

test('file paths are sanitized', () => {
  assert.equal(cleanPath('./src//main.py'), 'src/main.py')
  assert.equal(cleanPath('a\\b.bat'), 'a/b.bat')
  assert.throws(() => cleanPath('../etc/passwd'))
  assert.throws(() => cleanPath(''))
  assert.throws(() => cleanPath('a/<b>.js'))
})

test('languages by extension', () => {
  assert.equal(languageForPath('x/main.rs').id, 'rust')
  assert.equal(languageForPath('RUN.BAT').id, 'batch')
  assert.equal(languageForPath('Dockerfile').id, 'dockerfile')
  assert.equal(languageForPath('notes').id, 'text')
})

test('secrets parsing', () => {
  assert.deepEqual(parseSecrets('A=1\n bad line\nTOKEN = x=y\n'), { A: '1', TOKEN: 'x=y' })
})

test('private network addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) assert.ok(isPrivateAddress(ip), ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip)
})

test('passwords and usernames', async () => {
  const h = await hashPassword('correct horse')
  assert.ok(await verifyPassword('correct horse', h))
  assert.ok(!(await verifyPassword('wrong', h)))
  assert.equal(validateUsername('  Alice_1 '), 'alice_1')
  assert.throws(() => validateUsername('ab'))
  assert.throws(() => validateUsername('admin'))
})
