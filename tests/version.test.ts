// compareVersions decides whether the Android app prompts for an update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../src/lib/version.ts';

test('newer versions compare greater, numerically not alphabetically', () => {
  assert.equal(compareVersions('1.0.6', '1.0.5'), 1);
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('the installed version is never "newer" than itself (the old 1.0.3 bug)', () => {
  assert.equal(compareVersions('1.0.5', '1.0.5'), 0);
  assert.equal(compareVersions('1.0.3', '1.0.5'), -1);
});

test('tolerates a v prefix and missing parts', () => {
  assert.equal(compareVersions('v1.0.5', '1.0.5'), 0);
  assert.equal(compareVersions('1.1', '1.0.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});
