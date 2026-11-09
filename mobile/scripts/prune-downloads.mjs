// Remove large desktop/Android download archives from the web build before
// Capacitor copies it into the app. Without this, every APK would embed the
// previous APK (and installers) from public/download, bloating it massively.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..', '..', 'dist', 'download');
if (fs.existsSync(dir)) {
  for (const name of fs.readdirSync(dir)) {
    if (/\.(apk|aab|exe|msi|dmg|appimage|deb)$/i.test(name)) {
      fs.rmSync(path.join(dir, name), { force: true });
      console.log(`[prune-downloads] removed ${name}`);
    }
  }
}
