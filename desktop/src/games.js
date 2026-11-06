// "Playing …" detection for the desktop app.
//
// Most games never talk to a rich-presence socket, so the desktop app also
// looks at which programs are running: a list of well-known game executables,
// plus any game Steam launched (its folder under steamapps/common is the game's
// name). Only the game's NAME leaves this computer — never the process list —
// and people can switch it off (Settings → Privacy → Share what I'm playing).
//
// Kept free of Electron so it runs under `node --test`.
'use strict';

const { execFile } = require('node:child_process');

/** lower-case executable name → game name */
const KNOWN_GAMES = {
  'robloxplayerbeta.exe': 'Roblox',
  'robloxplayerbeta': 'Roblox',
  'minecraft.windows.exe': 'Minecraft',
  'javaw.exe#minecraft': 'Minecraft',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'valorant-win64-shipping.exe': 'VALORANT',
  'league of legends.exe': 'League of Legends',
  'cs2.exe': 'Counter-Strike 2',
  'overwatch.exe': 'Overwatch 2',
  'r5apex.exe': 'Apex Legends',
  'r5apex_dx12.exe': 'Apex Legends',
  'rocketleague.exe': 'Rocket League',
  'gta5.exe': 'Grand Theft Auto V',
  'gta5_enhanced.exe': 'Grand Theft Auto V',
  'rustclient.exe': 'Rust',
  'among us.exe': 'Among Us',
  'genshinimpact.exe': 'Genshin Impact',
  'starrail.exe': 'Honkai: Star Rail',
  'zenlesszonezero.exe': 'Zenless Zone Zero',
  'dota2.exe': 'Dota 2',
  'cod.exe': 'Call of Duty',
  'vrchat.exe': 'VRChat',
  'gorilla tag.exe': 'Gorilla Tag',
  'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley',
  'eldenring.exe': 'ELDEN RING',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_vulkan.exe': 'Rainbow Six Siege',
  'tslgame.exe': 'PUBG: Battlegrounds',
  'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
  'marvel-win64-shipping.exe': 'Marvel Rivals',
  'discovery.exe': 'THE FINALS',
  'helldivers2.exe': 'HELLDIVERS 2',
  'palworld-win64-shipping.exe': 'Palworld',
  'lethal company.exe': 'Lethal Company',
  'phasmophobia.exe': 'Phasmophobia',
  'fallguys_client_game.exe': 'Fall Guys',
  'destiny2.exe': 'Destiny 2',
  'warframe.x64.exe': 'Warframe',
  'hearthstone.exe': 'Hearthstone',
  'wow.exe': 'World of Warcraft',
  'osu!.exe': 'osu!',
  'geometrydash.exe': 'Geometry Dash',
  'sotgame.exe': 'Sea of Thieves',
  'bg3.exe': "Baldur's Gate 3",
  'bg3_dx11.exe': "Baldur's Gate 3",
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'ts4_x64.exe': 'The Sims 4',
  'witcher3.exe': 'The Witcher 3',
  'reddeadredemption2.exe': 'Red Dead Redemption 2',
  'rdr2.exe': 'Red Dead Redemption 2',
  'forzahorizon5.exe': 'Forza Horizon 5',
  'eafc25.exe': 'EA SPORTS FC 25',
  'nba2k25.exe': 'NBA 2K25',
  'brawlhalla.exe': 'Brawlhalla',
  'smite2.exe': 'SMITE 2',
  'pathofexile.exe': 'Path of Exile',
  'pathofexile_x64steam.exe': 'Path of Exile',
  'diablo iv.exe': 'Diablo IV',
  'starfield.exe': 'Starfield',
  'hollow_knight.exe': 'Hollow Knight',
  'celeste.exe': 'Celeste',
  'factorio.exe': 'Factorio',
  'valheim.exe': 'Valheim',
  'subnautica.exe': 'Subnautica',
  'satisfactory.exe': 'Satisfactory',
  'deeprockgalactic.exe': 'Deep Rock Galactic',
  'r6-siege.exe': 'Rainbow Six Siege',
};

// Steam's own tools, not games
const NOT_GAMES = /^(steamworks shared|steamvr|steam controller configs|redistributables?|common redist|proton.*|steam linux runtime.*|wallpaper engine)$/i;

const baseName = (p) => String(p).split(/[\\/]/).pop() || '';

/** `tasklist /fo csv /nh` → executable names */
function parseTasklist(csv) {
  return String(csv)
    .split(/\r?\n/)
    .map((line) => /^"([^"]+)"/.exec(line)?.[1])
    .filter(Boolean);
}

/** The game folder under steamapps/common for a running executable path, if any. */
function steamGameFromPath(p) {
  const m = /[\\/]steamapps[\\/]common[\\/]([^\\/]+)[\\/]/i.exec(String(p));
  if (!m) return null;
  const name = m[1].trim();
  return name && !NOT_GAMES.test(name) ? name : null;
}

/**
 * Pick the game being played from running processes ({ name, path?, title? }).
 * Known executables win over a Steam folder name; returns { key, name } or null.
 */
function detectGame(processes) {
  let steam = null;
  for (const p of processes) {
    const exe = baseName(p.name || p.path || '').toLowerCase();
    if (exe === 'javaw.exe' && /minecraft/i.test(`${p.path || ''} ${p.title || ''}`)) return { key: 'minecraft', name: 'Minecraft' };
    if (KNOWN_GAMES[exe]) return { key: exe, name: KNOWN_GAMES[exe] };
    if (!steam && p.path) {
      const s = steamGameFromPath(p.path);
      if (s) steam = { key: `steam:${s.toLowerCase()}`, name: s };
    }
  }
  return steam;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** Running processes as { name, path? } for this platform. */
async function listProcesses(platform = process.platform, withPaths = false) {
  if (platform === 'win32') {
    const names = parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh'])).map((name) => ({ name }));
    if (!withPaths) return names;
    // only processes Steam launched: cheap filter, run less often
    const paths = (await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"ExecutablePath like '%steamapps%common%'\" | ForEach-Object { $_.ExecutablePath }"]))
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((path) => ({ name: baseName(path), path }));
    return [...names, ...paths];
  }
  // macOS / Linux: full command paths
  return (await run('ps', ['-axo', 'comm=']))
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((path) => ({ name: baseName(path), path }));
}

/**
 * Poll every `intervalMs`; call onChange(activity | null) when the game changes.
 * The activity keeps the time the game was first seen, so the timer is right.
 */
function startGamePoller({ onChange, intervalMs = 20000, list = listProcesses } = {}) {
  let current = null;
  let tick = 0;
  let stopped = false;
  const scan = async () => {
    if (stopped) return;
    tick++;
    let game = null;
    try {
      game = detectGame(await list(process.platform, tick % 3 === 1));
    } catch {
      game = null;
    }
    if ((game && game.key) === (current && current.key)) return;
    current = game ? { ...game, startedAt: Date.now() } : null;
    onChange(current ? { platform: 'rpc', source: 'game-detect', name: current.name, type: 0, timestamps_start: current.startedAt } : null);
  };
  const timer = setInterval(scan, intervalMs);
  scan();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { KNOWN_GAMES, parseTasklist, steamGameFromPath, detectGame, listProcesses, startGamePoller };
