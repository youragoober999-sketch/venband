const test = require('node:test');
const assert = require('node:assert/strict');
const { appBase, deepLinkFromArgv, deepLinkToUrl, isAppUrl, isSafeExternal } = require('../src/links.js');

const base = 'https://www.venband.com/';

test('app base defaults to venband.com and accepts a dev server', () => {
  assert.equal(appBase({}), base);
  assert.equal(appBase({ VENBAND_URL: 'http://127.0.0.1:5173/channels/@me' }), 'http://127.0.0.1:5173/');
  assert.throws(() => appBase({ VENBAND_URL: 'file:///etc/passwd' }));
});

test('only Venband addresses open inside the app', () => {
  assert.ok(isAppUrl('https://www.venband.com/channels/@me', base));
  assert.ok(isAppUrl('https://venband.com/tos', base));
  assert.ok(!isAppUrl('https://venband.com.evil.example/', base));
  assert.ok(!isAppUrl('http://www.venband.com/', 'https://www.venband.com/'), 'plain http is not trusted');
  assert.ok(!isAppUrl('javascript:alert(1)', base));
});

test('external links must be normal web or mail links', () => {
  assert.ok(isSafeExternal('https://example.com/a'));
  assert.ok(isSafeExternal('mailto:hi@example.com'));
  assert.ok(!isSafeExternal('file:///C:/Windows/System32/calc.exe'));
  assert.ok(!isSafeExternal('ms-msdt:/id PCWDiagnostic'));
  assert.ok(!isSafeExternal('https://user:pass@example.com/'));
});

test('venband:// links map onto the website', () => {
  assert.equal(deepLinkToUrl('venband://invite/AbCdEf123', base), `${base}invite/AbCdEf123`);
  assert.equal(deepLinkToUrl('venband://join-group/AbCdEf1234', base), `${base}join-group/AbCdEf1234`);
  assert.equal(deepLinkToUrl('venband://channels/@me', base), `${base}channels/@me`);
  assert.equal(deepLinkToUrl('venband://../../etc/passwd', base), `${base}channels/@me`);
  assert.equal(deepLinkToUrl('venband://invite/<script>', base), `${base}channels/@me`);
  assert.equal(deepLinkToUrl('https://evil.example/', base), null);
});

test('finds the deep link in a second instance command line', () => {
  assert.equal(deepLinkFromArgv(['Venband.exe', '--flag', 'venband://invite/abc']), 'venband://invite/abc');
  assert.equal(deepLinkFromArgv(['Venband.exe']), null);
});
