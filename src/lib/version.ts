// Single build-time version. Vite injects __VENBAND_VERSION__ from root
// package.json (vite.config.ts). Desktop/mobile package.json carry the same
// number so the EXE, APK and website always agree.
declare const __VENBAND_VERSION__: string;

export const VERSION: string = typeof __VENBAND_VERSION__ === 'string' && __VENBAND_VERSION__.length > 0 ? __VENBAND_VERSION__ : '0.0.0-dev';

/** Where the published builds live on the website. */
export const DOWNLOAD_URL = '/download/';

/** Compare dotted versions numerically ("1.0.10" > "1.0.9"): 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
