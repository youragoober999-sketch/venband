# Venband for Windows, macOS and Linux

An Electron app around www.venband.com with the things a website can't do:

- **Installer and portable versions** for Windows (`Venband-Setup-x.y.z.exe`, `Venband-Portable-x.y.z.exe`), plus `.dmg` for macOS and AppImage/`.deb` for Linux
- **Automatic updates** from GitHub Releases. When one is out, a full-window Venband screen says
  “A new update of venband is available, press update to continue using venband”; pressing **Update**
  downloads it, shows progress and restarts. If the download keeps failing, a “Not now” button appears so nobody is locked out.
- **Signature checks**: on Windows, updates are only installed when they're signed by the same certificate as the installed app
  (once you sign your builds — see below).
- **Update channels**: Stable or Beta, from the tray menu
- **Tray icon**: open, check for updates, start with your computer, keep running when closed, safe mode, quit
- **Taskbar/dock unread badge** and window flashing for calls
- **venband:// links** (`venband://invite/CODE`, `venband://join-group/CODE`, `venband://channels/@me`) open the app
- **Screen-share picker** with previews of each screen and window (system audio included on Windows)
- **Safe mode** (`--safe-mode`, or tray → Restart in safe mode): no GPU acceleration, custom CSS and backgrounds off
- **Offline screen** that retries by itself

## Security

Context isolation and sandboxing for every page, no Node.js in pages, `<webview>` blocked, only Venband pages load
inside the app (everything else opens in your browser, and only `http(s)`/`mailto` links), microphone / camera /
screen / notification permissions only for Venband, and a minimal preload API (`window.venbandDesktop`: badge, flash, info).

## Run and build

```bash
cd desktop
npm install
npm start                 # opens www.venband.com
npm run start:local       # against the dev server on http://127.0.0.1:5173
npm run check             # syntax + unit tests
npm run dist:win          # Windows installer + portable (run on Windows)
```

## Releasing

1. Bump `version` in `desktop/package.json`.
2. Push a tag: `git tag desktop-v1.0.1 && git push origin desktop-v1.0.1`.
3. `.github/workflows/desktop.yml` builds Windows, macOS and Linux and publishes a GitHub Release. Installed apps update themselves.

**Code signing (strongly recommended):** without it Windows SmartScreen warns on first install, and macOS won't
auto-update. Buy a code-signing certificate, then add GitHub secrets `WIN_CSC_LINK` (base64 of the .pfx) and
`WIN_CSC_KEY_PASSWORD`; for macOS `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
