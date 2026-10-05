// Renders the desktop and mobile app icons + splash from public/favicon.svg.
// Run: CHROME_PATH=/path/to/chromium node scripts/make-app-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function shot(size, out, opts = {}) {
  const pad = opts.pad ?? 0;
  const bg = opts.bg ?? 'transparent';
  let inner = opts.square ? svg.replace('rx="16"', 'rx="0"') : svg;
  if (opts.glyphOnly) inner = inner.replace(/<rect[^>]*\/>/, '');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${inner.replace('<svg ', `<svg width="${size - pad * 2}" height="${size - pad * 2}" `)}</div></body></html>`);
  await page.screenshot({ path: out, omitBackground: bg === 'transparent' });
}
await shot(1024, 'desktop/build/icon.png');
await shot(32, 'desktop/build/tray.png');
await shot(1024, 'mobile/assets/icon-only.png', { square: true });
await shot(1024, 'mobile/assets/icon-foreground.png', { pad: 200, bg: 'transparent', glyphOnly: true });
await shot(1024, 'mobile/assets/icon-background.png', { bg: '#000000', glyphOnly: true, pad: 512 });
await shot(2732, 'mobile/assets/splash.png', { pad: 1100, bg: '#000000' });
await shot(2732, 'mobile/assets/splash-dark.png', { pad: 1100, bg: '#000000' });
await browser.close();
