// Venband desktop: a locked-down window around www.venband.com plus the
// things a website can't do — tray icon, start with the computer, venband://
// links, taskbar badges, a screen-share picker and automatic updates.
//
// Security: context isolation, sandboxed renderers, no Node in pages, only
// Venband pages load inside the app, everything else opens in the browser,
// permissions (mic, camera, screen, notifications) only for Venband, and
// updates are only installed when their code signature checks out (Windows).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  ipcMain,
  nativeImage,
  session,
  shell,
  dialog,
  powerMonitor,
} = require('electron');
const { appBase, isAppUrl, isSafeExternal, deepLinkToUrl, deepLinkFromArgv } = require('./links');
const { createRpcServer, activityKey } = require('./rpc');
const { startSpotifyPoller } = require('./spotify');
const { startMediaPoller } = require('./media');

const BASE = appBase();
const SAFE_MODE = process.argv.includes('--safe-mode') || process.env.VENBAND_SAFE_MODE === '1';
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const TRAY_ICON = path.join(__dirname, '..', 'build', 'tray.png');
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

if (SAFE_MODE) app.disableHardwareAcceleration();
// every renderer is sandboxed; --no-sandbox is only for running as root in a
// test container (Chromium refuses to start sandboxed as root)
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

// ---------------------------------------------------------------- settings --
const prefsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
const defaults = { closeToTray: true, startWithComputer: false, startMinimized: false, channel: 'stable', bounds: null };
let prefs = { ...defaults };
function loadPrefs() {
  try {
    prefs = { ...defaults, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) };
  } catch {
    prefs = { ...defaults };
  }
}
function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
  } catch {
    /* not fatal */
  }
}

// ------------------------------------------------------- one copy at a time --
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) openDeepLink(link);
    showMain();
  });
}
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('venband', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('venband');
}
// macOS delivers links here
app.on('open-url', (e, url) => {
  e.preventDefault();
  openDeepLink(url);
});

let mainWindow = null;
let tray = null;
let quitting = false;
let pendingLink = deepLinkFromArgv(process.argv);

function startUrl() {
  const link = pendingLink ? deepLinkToUrl(pendingLink, BASE) : null;
  pendingLink = null;
  const url = new URL(link || `${BASE}channels/@me`);
  if (SAFE_MODE) url.searchParams.set('safe', '1');
  return url.toString();
}

function openDeepLink(link) {
  const url = deepLinkToUrl(link, BASE);
  if (!url) return;
  if (mainWindow) {
    mainWindow.loadURL(url);
    showMain();
  } else {
    pendingLink = link;
  }
}

// ----------------------------------------------------------------- windows --
function createMainWindow() {
  const b = prefs.bounds;
  mainWindow = new BrowserWindow({
    width: b?.width ?? 1280,
    height: b?.height ?? 800,
    x: b?.x,
    y: b?.y,
    minWidth: 360,
    minHeight: 500,
    show: false,
    backgroundColor: '#050507',
    title: 'Venband',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
      backgroundThrottling: false, // keep calls and notifications going when hidden
    },
  });
  mainWindow.once('ready-to-show', () => {
    if (!(prefs.startMinimized && process.argv.includes('--hidden'))) mainWindow.show();
  });
  mainWindow.loadURL(startUrl());

  // can't reach the site: show a friendly offline page that retries
  mainWindow.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = aborted (navigations)
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), { query: { to: url || BASE } });
  });

  mainWindow.on('close', (e) => {
    if (!quitting && prefs.closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  const remember = () => {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) savePrefs({ bounds: mainWindow.getBounds() });
  };
  mainWindow.on('resize', remember);
  mainWindow.on('move', remember);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMain() {
  if (!mainWindow) return createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// --------------------------------------------------------------- hardening --
app.on('web-contents-created', (_e, contents) => {
  // no <webview>, ever
  contents.on('will-attach-webview', (e) => e.preventDefault());
  // only Venband loads inside the app; other links go to the browser
  contents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://') && contents.getURL().startsWith('file://')) return; // offline page retry
    if (!isAppUrl(url, BASE)) {
      e.preventDefault();
      if (isSafeExternal(url)) shell.openExternal(url);
    }
  });
  contents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url, BASE)) e.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

function setupSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(isAppUrl(wc.getURL(), BASE) && allowed.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    return isAppUrl(origin || wc?.getURL() || '', BASE) && allowed.has(permission);
  });
  // downloads: always ask where to save, keep the original name
  ses.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  // screen sharing: our own picker (Windows/Linux have no system picker)
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const source = await pickScreen();
        if (!source) return callback({});
        callback({ video: source, audio: process.platform === 'win32' ? 'loopback' : undefined });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: process.platform === 'darwin' },
  );
}

// ---------------------------------------------------- screen share picker --
let pickerResolve = null;
async function pickScreen() {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  const list = sources
    .filter((s) => !/^Venband( -|$)/.test(s.name) || s.id.startsWith('screen'))
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window', thumb: s.thumbnail.toDataURL() }));
  const picker = new BrowserWindow({
    parent: mainWindow ?? undefined,
    modal: Boolean(mainWindow),
    width: 760,
    height: 560,
    resizable: false,
    minimizable: false,
    title: 'Share your screen',
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  picker.loadFile(path.join(__dirname, 'picker.html'));
  picker.webContents.once('did-finish-load', () => picker.webContents.send('picker:sources', list));
  const chosen = await new Promise((resolve) => {
    pickerResolve = resolve;
    picker.on('closed', () => resolve(null));
  });
  pickerResolve = null;
  if (!picker.isDestroyed()) picker.close();
  return sources.find((s) => s.id === chosen) ?? null;
}
ipcMain.on('picker:choose', (_e, id) => pickerResolve?.(typeof id === 'string' ? id : null));

// ------------------------------------------------------------- tray & badge --
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Venband', click: showMain },
    { type: 'separator' },
    { label: 'Check for updates', click: () => checkForUpdates(true) },
    {
      label: 'Update channel',
      submenu: ['stable', 'beta'].map((c) => ({
        label: c === 'stable' ? 'Stable' : 'Beta (early features)',
        type: 'radio',
        checked: prefs.channel === c,
        click: () => {
          savePrefs({ channel: c });
          checkForUpdates(true);
        },
      })),
    },
    { label: 'Start with my computer', type: 'checkbox', checked: prefs.startWithComputer, click: (i) => setStartup(i.checked) },
    { label: 'Keep running in the tray when closed', type: 'checkbox', checked: prefs.closeToTray, click: (i) => savePrefs({ closeToTray: i.checked }) },
    { type: 'separator' },
    { label: SAFE_MODE ? 'Restart normally' : 'Restart in safe mode', click: () => restart(!SAFE_MODE) },
    { label: 'Quit Venband', click: () => ((quitting = true), app.quit()) },
  ]);
}

function setupTray() {
  const img = nativeImage.createFromPath(TRAY_ICON);
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }) : img);
  tray.setToolTip('Venband');
  tray.setContextMenu(trayMenu());
  tray.on('click', showMain);
}

function setStartup(on) {
  savePrefs({ startWithComputer: on });
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}

function restart(safe) {
  const args = process.argv.slice(1).filter((a) => a !== '--safe-mode');
  if (safe) args.push('--safe-mode');
  app.relaunch({ args });
  quitting = true;
  app.quit();
}

// a small red dot with the count, for the Windows taskbar
function badgeImage(count) {
  const text = count > 99 ? '99+' : String(count);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#ff3b30"/><text x="16" y="21" font-family="Segoe UI, Arial" font-size="${text.length > 2 ? 12 : 16}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

ipcMain.on('venband:badge', (e, raw) => {
  if (!mainWindow || e.sender !== mainWindow.webContents) return;
  const count = Math.max(0, Math.min(9999, Number(raw) || 0));
  if (process.platform === 'win32') mainWindow.setOverlayIcon(count ? badgeImage(count) : null, count ? `${count} unread` : '');
  else app.setBadgeCount(count);
  tray?.setToolTip(count ? `Venband — ${count} unread` : 'Venband');
});
ipcMain.on('venband:flash', (e) => {
  if (mainWindow && e.sender === mainWindow.webContents && !mainWindow.isFocused()) mainWindow.flashFrame(true);
});
ipcMain.handle('venband:info', () => ({ version: app.getVersion(), platform: process.platform, safeMode: SAFE_MODE, channel: prefs.channel }));

// ------------------------------------------------------------------ updates --
// Updates come from the /download folder on www.venband.com (latest.yml, which
// electron-builder writes from the same version number as the EXE). On every
// launch -- plus every 4h and on resume -- we compare and, when a newer build is
// published, a full-window Venband screen asks the person to update before
// carrying on. Installing quits the app, replaces the files and keeps the login
// and data untouched.
let updater = null;
let updateWindow = null;
function getUpdater() {
  if (updater !== null) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    updater = false; // running from source without dependencies
    return updater;
  }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', (info) => showUpdateScreen(info));
  updater.on('download-progress', (p) => updateWindow?.webContents.send('update:progress', Math.round(p.percent)));
  updater.on('update-downloaded', () => {
    updateWindow?.webContents.send('update:ready');
    setTimeout(() => {
      quitting = true;
      updater.quitAndInstall(false, true);
    }, 900);
  });
  updater.on('error', (err) => updateWindow?.webContents.send('update:error', String(err?.message || err)));
  return updater;
}

async function checkForUpdates(manual = false) {
  const u = getUpdater();
  if (!u || !app.isPackaged) {
    if (manual) dialog.showMessageBox({ type: 'info', message: 'Updates are checked in the installed app.', detail: 'You’re running Venband from source.' });
    return;
  }
  u.channel = prefs.channel === 'beta' ? 'beta' : 'latest';
  u.allowPrerelease = prefs.channel === 'beta';
  try {
    const r = await u.checkForUpdates();
    if (manual && (!r || !r.isUpdateAvailable)) dialog.showMessageBox({ type: 'info', message: 'Venband is up to date.', detail: `Version ${app.getVersion()}` });
  } catch (e) {
    if (manual) dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check for updates.', detail: String(e?.message || e) });
  }
}

function showUpdateScreen(info) {
  if (updateWindow) return updateWindow.focus();
  const parent = mainWindow;
  updateWindow = new BrowserWindow({
    parent: parent ?? undefined,
    modal: Boolean(parent),
    width: parent ? parent.getBounds().width : 960,
    height: parent ? parent.getBounds().height : 640,
    x: parent?.getBounds().x,
    y: parent?.getBounds().y,
    frame: false,
    resizable: false,
    movable: true,
    backgroundColor: '#050507',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'update-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  updateWindow.loadFile(path.join(__dirname, 'update.html'));
  updateWindow.webContents.once('did-finish-load', () =>
    updateWindow?.webContents.send('update:info', {
      version: info.version,
      current: app.getVersion(),
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').slice(0, 2000) : '',
    }),
  );
  updateWindow.on('closed', () => {
    updateWindow = null;
  });
}

ipcMain.on('update:start', (e) => {
  if (!updateWindow || e.sender !== updateWindow.webContents) return;
  getUpdater()?.downloadUpdate().catch((err) => updateWindow?.webContents.send('update:error', String(err?.message || err)));
});
// only offered when the download keeps failing, so nobody gets locked out
ipcMain.on('update:later', (e) => {
  if (updateWindow && e.sender === updateWindow.webContents) updateWindow.close();
});

// ------------------------------------------------------------------ rpc --
// A Discord-compatible local socket (discord-ipc-0..9) plus the OS Spotify
// poller (and the legacy Spotify local API) feed the renderer a single "what am
// I doing" activity, which the web app pushes to Supabase so every session
// (browser, desktop, phone) shows the same live status. Only one activity is
// ever shown; when Discord RPC and Spotify are both active, whichever changed
// most recently wins.
let rpc = null;
let stopSpotify = null;
let stopMedia = null;
let rpcActivity = null;
let spotifyActivity = null;
let activeActivity = null;
let rpcStamp = 0;
let spotifyStamp = 0;

function pushActivity(next) {
  if (activityKey(next) === activityKey(activeActivity)) return;
  activeActivity = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rpc:activity', activeActivity);
}

function recomputeActivity() {
  let next;
  if (rpcActivity && spotifyActivity) {
    next = rpcStamp >= spotifyStamp ? rpcActivity : spotifyActivity;
  } else {
    next = rpcActivity || spotifyActivity;
  }
  pushActivity(next);
}

function setRpcActivity(a) {
  rpcActivity = a;
  rpcStamp = Date.now();
  recomputeActivity();
}

function setSpotifyActivity(a) {
  spotifyActivity = a;
  spotifyStamp = Date.now();
  recomputeActivity();
}

function setupRpcBridge() {
  rpc = createRpcServer({
    emit: (e) => {
      if (e && e.type === 'activity') setRpcActivity(e.activity);
    },
  });
  rpc.start().catch((e) => {
    if (e?.code === 'EEXHAUSTED') return; // real Discord owns the pipes — fine
    console.error('rpc bridge failed to start', e?.message || e);
  });
  stopSpotify = startSpotifyPoller({ onChange: setSpotifyActivity });
  stopMedia = startMediaPoller({ onChange: setSpotifyActivity });

  ipcMain.handle('rpc:get-state', () => ({
    active: Boolean(rpc && rpc.stateRef.pipeIndex >= 0),
    pipe: rpc ? rpc.stateRef.pipeIndex : -1,
    activity: activeActivity,
  }));
  ipcMain.on('rpc:set-user', (e, u) => {
    if (!rpc || e.sender !== mainWindow?.webContents || !u || typeof u !== 'object') return;
    rpc.setUser({ id: u.id, username: u.username, global_name: u.global_name, session_id: u.session_id });
  });
}

const OPENABLE = new Set(['https:', 'http:', 'mailto:', 'spotify:', 'spotify-track:', 'steam:', 'twitch:']);
ipcMain.handle('shell:open-external', (e, raw) => {
  if (e.sender !== mainWindow?.webContents || typeof raw !== 'string') return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!OPENABLE.has(u.protocol)) return false;
  if ((u.protocol === 'https:' || u.protocol === 'http:') && !isSafeExternal(raw)) return false;
  shell.openExternal(raw);
  return true;
});

// ------------------------------------------------------------------ start --
app.whenReady().then(() => {
  loadPrefs();
  if (process.platform === 'win32') app.setAppUserModelId('com.venband.desktop');
  setupSession();
  createMainWindow();
  setupTray();
  setupRpcBridge();
  checkForUpdates();
  setInterval(() => checkForUpdates(), UPDATE_CHECK_MS);
  powerMonitor.on('resume', () => checkForUpdates());
  app.on('activate', showMain);
});

app.on('before-quit', () => {
  quitting = true;
  stopSpotify?.();
  stopMedia?.();
  rpc?.close?.().catch(() => {});
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
