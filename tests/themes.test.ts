// sanitizeTheme is the gate for every theme from the marketplace or synced settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTheme } from '../src/lib/themeData.ts';

const vars = { 'bg-0': '#000000', 'bg-1': '#111111', 'bg-2': '#222222', text: '#ffffff' };
const SOURCE = '7e000000-0000-4000-8000-000000000001';

test('keeps the marketplace source and installed version', () => {
  const t = sanitizeTheme({ id: `market-${SOURCE}`, name: 'Ocean', vars, sourceId: SOURCE, version: 3 });
  assert.ok(t);
  assert.equal(t.sourceId, SOURCE);
  assert.equal(t.version, 3);
});

test('drops a malformed source id or version instead of trusting it', () => {
  const t = sanitizeTheme({ name: 'x', vars, sourceId: "x' or 1=1 --", version: -1 } as never);
  assert.ok(t);
  assert.equal(t.sourceId, undefined);
  assert.equal(t.version, undefined);
  const u = sanitizeTheme({ name: 'x', vars, version: 1.5 } as never);
  assert.equal(u?.version, undefined);
});

test('ignores anything that is not a known colour variable', () => {
  const t = sanitizeTheme({ name: 'x', vars: { ...vars, 'bg-3': 'url(https://evil.example/x)', evil: '#fff' } as never });
  assert.ok(t);
  assert.notEqual(t.vars['bg-3'], 'url(https://evil.example/x)');
  assert.equal((t.vars as Record<string, string>).evil, undefined);
});

test('a wallpaper must be a gradient, never a remote image', () => {
  const ok = sanitizeTheme({ name: 'x', vars, wallpaper: 'linear-gradient(135deg, #1f1c2c, #3a2f5b)' });
  assert.equal(ok?.wallpaper, 'linear-gradient(135deg, #1f1c2c, #3a2f5b)');
  const bad = sanitizeTheme({ name: 'x', vars, wallpaper: 'url(https://evil.example/track.png)' });
  assert.equal(bad?.wallpaper, undefined);
});
