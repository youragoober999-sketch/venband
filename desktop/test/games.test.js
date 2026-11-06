'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTasklist, steamGameFromPath, detectGame, startGamePoller } = require('../src/games');

test('tasklist csv → executable names', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"RobloxPlayerBeta.exe","1234","Console","1","300,000 K"\r\n';
  assert.deepEqual(parseTasklist(csv), ['System Idle Process', 'RobloxPlayerBeta.exe']);
});

test('steam games are named after their folder; steam tools are not games', () => {
  assert.equal(steamGameFromPath('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades II\\Ship\\Hades2.exe'), 'Hades II');
  assert.equal(steamGameFromPath('/home/me/.steam/steam/steamapps/common/Celeste/Celeste'), 'Celeste');
  assert.equal(steamGameFromPath('C:\\Steam\\steamapps\\common\\SteamVR\\bin\\vrserver.exe'), null);
  assert.equal(steamGameFromPath('C:\\Windows\\explorer.exe'), null);
});

test('detectGame: known executables first, then Steam, else nothing', () => {
  assert.deepEqual(detectGame([{ name: 'chrome.exe' }, { name: 'RobloxPlayerBeta.exe' }]), { key: 'robloxplayerbeta.exe', name: 'Roblox' });
  assert.deepEqual(detectGame([{ name: 'Hades2.exe', path: 'D:\\SteamLibrary\\steamapps\\common\\Hades II\\Hades2.exe' }]), { key: 'steam:hades ii', name: 'Hades II' });
  assert.deepEqual(detectGame([{ name: 'javaw.exe', path: 'C:\\Users\\x\\AppData\\Roaming\\.minecraft\\runtime\\javaw.exe' }]), { key: 'minecraft', name: 'Minecraft' });
  assert.equal(detectGame([{ name: 'explorer.exe' }, { name: 'code.exe' }]), null);
});

test('poller reports a game once, keeps its start time, and clears when it closes', async () => {
  const seen = [];
  let procs = [{ name: 'RobloxPlayerBeta.exe' }];
  const stop = startGamePoller({ onChange: (a) => seen.push(a), intervalMs: 10, list: async () => procs });
  await new Promise((r) => setTimeout(r, 45));
  procs = [{ name: 'explorer.exe' }];
  await new Promise((r) => setTimeout(r, 30));
  stop();
  assert.equal(seen.length, 2, 'one start, one stop — no repeats while it keeps running');
  assert.equal(seen[0].name, 'Roblox');
  assert.equal(seen[0].type, 0);
  assert.equal(seen[0].source, 'game-detect');
  assert.ok(seen[0].timestamps_start > 0);
  assert.equal(seen[1], null);
});
