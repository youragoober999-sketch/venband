// Spotify "listening along" — the status Discord shows for Spotify comes from
// the locally running Spotify desktop client, not from the cloud. Venband does
// the same: read the token file Spotify keeps in %APPDATA%, poll the local
// HTTP endpoint, and turn whatever is playing into a rich-presence activity.
//
// The poller is intentionally small and defensive: nothing here is fatal, the
// bridge simply shows no Spotify status when the token or client is missing.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SPOTIFY_OAUTH = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Spotify', 'oauth.json');
const LOCAL_PORTS = [4381, 4380]; // newer Spotify moved to 4381; fall back to 4380

const HTTP_TIMEOUT_MS = 1500;

// ------------------------------------------------------------- token file --

/** The local token Spotify stores so its own tray/overlay can auth. */
function readLocalToken(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file || SPOTIFY_OAUTH, 'utf8'));
    const t = raw.accessToken || raw.access_token || (raw.credentials && raw.credentials.accessToken);
    if (t) return { token: String(t), type: String(raw.tokenType || raw.token_type || 'Bearer') };
  } catch {
    /* no token yet — Spotify not installed or never run */
  }
  return null;
}

// ------------------------------------------------------------------ http --

function getJson(url, headers) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers, timeout: HTTP_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// --------------------------------------------------------------- parsing --

/** Map either of Spotify's local status payloads into a Venband activity. */
function spotifyStatusToActivity(status, now = Date.now()) {
  if (!status || !status.playing) return null;
  const tr =
    status.track && status.track.track_resource
      ? status.track.track_resource // classic /remote/status.json
      : status.track_resource || status.track || status.item || null; // /api/v1/status
  if (!tr || !tr.name) return null;

  const uri = String(tr.uri || tr.id || '');
  const id = uri.split(':').pop() || '';
  const artist =
    (status.track && status.track.artist_resource && status.track.artist_resource.name) ||
    (tr.artist && tr.artist.name) ||
    (Array.isArray(tr.artists) && tr.artists[0] && tr.artists[0].name) ||
    '';
  const album =
    (status.track && status.track.album_resource && status.track.album_resource.name) || (tr.album && tr.album.name) || '';
  const position = Number(status.position || (status.progress_ms != null ? status.progress_ms : 0)) || 0;

  return {
    platform: 'spotify',
    icon: 'spotify',
    name: 'Spotify',
    type: 2, // listening
    details: String(tr.name),
    state: [artist && `by ${artist}`, album && `on ${album}`].filter(Boolean).join(' · ') || undefined,
    timestamps_start: position > 0 ? now - position : now,
    url: id ? `https://open.spotify.com/track/${id}` : undefined,
    uri: uri || undefined,
    party_id: undefined,
    party_cur: undefined,
    party_max: undefined,
    created_at: now,
  };
}

/**
 * Map an OS media-session snapshot (Windows SMTC / macOS AppleScript) into a
 * Venband activity. Newer Spotify removed the local HTTP API, so this is the
 * path that actually works today. `position` is optional (ms into the track).
 */
function mediaActivityFrom(props, now = Date.now()) {
  const title = String((props && props.title) || '').trim();
  if (!title) return null;
  const artist = String((props && props.artist) || '').trim();
  const album = String((props && props.album) || '').trim();
  return {
    platform: 'spotify',
    icon: 'spotify',
    name: 'Spotify',
    type: 2, // listening
    details: title,
    state: [artist && `by ${artist}`, album && `on ${album}`].filter(Boolean).join(' · ') || undefined,
    timestamps_start: now,
    url: `https://open.spotify.com/search/${encodeURIComponent([title, artist].filter(Boolean).join(' '))}`,
    uri: undefined,
    created_at: now,
  };
}

// ------------------------------------------------------------- the poller --

/** One poll: read token, try each local port, return an activity or null. */
async function pollSpotify(now = Date.now()) {
  const tok = readLocalToken();
  if (!tok) return { unknown: true, activity: null };
  const headers = { Authorization: `${tok.type} ${tok.token}`, 'User-Agent': 'Venband' };
  for (const port of LOCAL_PORTS) {
    const statuses = [];
    statuses.push(await getJson(`http://127.0.0.1:${port}/remote/status.json`, headers));
    statuses.push(await getJson(`http://127.0.0.1:${port}/api/v1/status`, headers));
    for (const status of statuses) {
      const activity = spotifyStatusToActivity(status, now);
      if (activity) return { unknown: false, activity };
      // reached Spotify but nothing playing (or we can't read it)
      if (status && typeof status === 'object') return { unknown: false, activity: null };
    }
  }
  return { unknown: true, activity: null };
}

/**
 * Start polling. `onChange(activity|null)` fires whenever the listening state
 * changes (not on every poll). Returns stop().
 */
function startSpotifyPoller({ onChange, intervalMs = 5000 } = {}) {
  let last = undefined;
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const { activity } = await pollSpotify();
      const key = activity ? activityKey(activity) : 'none';
      if (key !== last) {
        last = key;
        onChange(activity);
      }
    } catch {
      /* pollers are best-effort */
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  }

  timer = setTimeout(tick, 250);

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function activityKey(a) {
  return a ? [a.details, a.state, a.timestamps_start, a.uri].join('|') : 'none';
}

module.exports = {
  readLocalToken,
  spotifyStatusToActivity,
  mediaActivityFrom,
  pollSpotify,
  startSpotifyPoller,
  LOCAL_PORTS,
  SPOTIFY_OAUTH,
};