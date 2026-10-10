'use strict';
// Current-media detection that does not depend on Spotify's removed local API.
//
//  Windows: a single long-lived PowerShell process watches the System Media
//           Transport Controls (SMTC) session that belongs to Spotify and emits
//           a JSON line on stdout every few seconds.
//           macOS:   osascript asks the Spotify app directly on an interval.
//
// Every platform funnels through the same pure mapper (spotify.mediaActivityFrom)
// and only fires `onChange` when the track actually changes.

const { spawn, execFile } = require('node:child_process');
const { mediaActivityFrom } = require('./spotify');

const POLL_MS = 3000;

// PowerShell reads the current media session (WinRT) in a loop and prints a
// single JSON object per line. Kept dependency-free so it runs under the stock
// Windows PowerShell 5.1 shipped with Windows 10/11.
const WINDOWS_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$ProgressPreference = 'SilentlyContinue'",
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null',
  "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' })[0]",
  'function Await($task, $type) { $m = $asTask.MakeGenericMethod($type); $t = $m.Invoke($null, @($task)); $t.Wait(5000) | Out-Null; $t.Result }',
  "[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]",
  'while ($true) {',
  '  $json = "null"',
  '  try {',
  '    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  "    $s = $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -match 'Spotify' } | Select-Object -First 1",
  "    if ($s -and $s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') {",
  '      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
  '      $json = (@{ title=$p.Title; artist=$p.Artist; album=$p.AlbumTitle } | ConvertTo-Json -Compress)',
  '    }',
  '  } catch { $json = "null" }',
  '  [Console]::Out.WriteLine($json)',
  '  [Console]::Out.Flush()',
  '  Start-Sleep -Milliseconds 3000',
  '}',
].join('\n');

const MAC_SCRIPT = [
  'if application "Spotify" is running then',
  '  tell application "Spotify"',
  '    if player state is playing then',
  '      return "PLAYING" & (tab) & (name of current track) & (tab) & (artist of current track) & (tab) & (album of current track)',
  '    end if',
  '  end tell',
  'end if',
].join('\n');

function startWindows({ onChange }) {
  const encoded = Buffer.from(WINDOWS_PS, 'utf16le').toString('base64');
  let child = null;
  let buffer = '';
  let last = 'none';
  let stopped = false;

  function emit(snapshot) {
    const activity = snapshot ? mediaActivityFrom(snapshot) : null;
    const key = activity ? [activity.details, activity.state].join('|') : 'none';
    if (key !== last) {
      last = key;
      onChange(activity);
    }
  }

  function launch() {
    if (stopped) return;
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true },
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('{') && line !== 'null') continue;
        try {
          const data = JSON.parse(line);
          emit(data && typeof data === 'object' ? data : null);
        } catch {
          /* ignore malformed line */
        }
      }
    });
    const restart = () => {
      child = null;
      if (!stopped) setTimeout(launch, 5000);
    };
    child.on('exit', restart);
    child.on('error', restart);
  }

  launch();

  return function stop() {
    stopped = true;
    try {
      if (child) child.kill();
    } catch {
      /* already gone */
    }
  };
}

function startMac({ onChange, intervalMs = 3000 }) {
  let timer = null;
  let last = 'none';
  let stopped = false;

  function tick() {
    if (stopped) return;
    execFile('osascript', ['-e', MAC_SCRIPT], { timeout: 4000 }, (err, stdout) => {
      let activity = null;
      if (!err && typeof stdout === 'string' && stdout.startsWith('PLAYING')) {
        const [, title = '', artist = '', album = ''] = stdout.split('\t');
        activity = mediaActivityFrom({
          title: title.trim(),
          artist: artist.trim(),
          album: album.trim(),
        });
      }
      const key = activity ? [activity.details, activity.state].join('|') : 'none';
      if (key !== last) {
        last = key;
        onChange(activity);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    });
  }

  timer = setTimeout(tick, 400);
  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function startMediaPoller({ onChange, intervalMs = 3000 } = {}) {
  if (process.platform === 'win32') return startWindows({ onChange });
  if (process.platform === 'darwin') return startMac({ onChange, intervalMs });
  return function stop() {};
}

module.exports = { startMediaPoller };
