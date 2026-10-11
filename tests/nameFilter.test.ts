import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameIsBlocked, nameSkeleton } from '../src/lib/nameFilter.ts';

// built from pieces so the test file itself doesn't spell the words out
const n = 'n' + 'igg';
const f = 'f' + 'agg';

test('blocked names are caught, however they are disguised', () => {
  for (const name of [
    `${n}er`, `${n}a`, `${n}ah`, `${n}az`, `xX${n}erXx`, `N_I_${'GG'}_E_R`, `n1gg3r`, `n.i.g.g.a`, `niiii${'gg'}aaa`,
    `${f}ot`, `${'fag'}ot`, `f4gg0t`, 'cunt', 'c.u.n.t', 'CUNT_lord', 'cuck', 'cuckboy', 'cu ck', `${'nіgg'}er` /* Cyrillic і */,
  ]) {
    assert.ok(nameIsBlocked(name), `should block ${name} (skeleton ${nameSkeleton(name)})`);
  }
});

test('ordinary names are fine', () => {
  for (const name of ['jules', 'nightingale', 'niger_river', 'nigeria_fan', 'scunthorpe', 'cuckoo_clock', 'bigger_fan', 'tigger', 'faggiano', 'Accu_Cast']) {
    assert.ok(!nameIsBlocked(name), `should allow ${name}`);
  }
});
