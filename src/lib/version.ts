// Single build-time version. Vite injects __VENBAND_VERSION__ from root
// package.json (vite.config.ts). Desktop/mobile package.json carry the same
// number so the EXE, APK and website always agree.
declare const __VENBAND_VERSION__: string;

export const VERSION: string = typeof __VENBAND_VERSION__ === 'string' && __VENBAND_VERSION__.length > 0 ? __VENBAND_VERSION__ : '0.0.0-dev';

/** Where the published builds live on the website. */
export const DOWNLOAD_URL = 'https://www.venband.com/download/';