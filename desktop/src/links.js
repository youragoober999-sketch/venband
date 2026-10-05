// Pure helpers for which addresses the desktop app opens itself, which go to
// the browser, and how venband:// links map onto the website. Kept free of
// Electron so they can be tested with plain Node.

const DEFAULT_APP_URL = 'https://www.venband.com/';

function appBase(env = process.env) {
  const raw = env.VENBAND_URL || DEFAULT_APP_URL;
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error('VENBAND_URL must be http(s)');
  return `${u.origin}/`;
}

/** Same site as the app (venband.com, www.venband.com or the dev server). */
function isAppUrl(url, base = appBase()) {
  try {
    const u = new URL(url);
    const b = new URL(base);
    if (u.origin === b.origin) return true;
    return u.protocol === 'https:' && (u.hostname === 'venband.com' || u.hostname === 'www.venband.com');
  } catch {
    return false;
  }
}

/** Links that may be handed to the system browser. */
function isSafeExternal(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * venband://invite/CODE         -> <app>/invite/CODE
 * venband://channels/@me/ID     -> <app>/channels/@me/ID
 * venband://join-group/CODE     -> <app>/join-group/CODE
 * Anything else opens the app's home.
 */
function deepLinkToUrl(link, base = appBase()) {
  let path = '';
  try {
    const u = new URL(link);
    if (u.protocol !== 'venband:') return null;
    // venband://invite/abc parses with host "invite" and path "/abc"
    path = `${u.host}${u.pathname}`.replace(/^\/+/, '');
  } catch {
    return null;
  }
  const ok = /^(invite\/[A-Za-z0-9-]{3,32}|join-group\/[A-Za-z0-9]{10}|channels\/(@me|[0-9a-f-]{36})(\/[0-9a-f-]{36}){0,2}|discover|applications(\/[0-9a-f-]{36})?|voogle|status)\/?$/;
  if (!ok.test(path)) return `${base}channels/@me`;
  return `${base}${path.replace(/\/$/, '')}`;
}

/** The venband:// argument in a command line, if any (Windows / Linux deep links). */
function deepLinkFromArgv(argv) {
  return argv.find((a) => typeof a === 'string' && a.startsWith('venband://')) || null;
}

module.exports = { appBase, isAppUrl, isSafeExternal, deepLinkToUrl, deepLinkFromArgv, DEFAULT_APP_URL };
