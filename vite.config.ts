import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const VERSION: string = pkg.version;

// Write dist/download.json so the /download page and the desktop app's updater
// share one machine-readable source of truth for "what's published right now".
// The files it lists are named by desktop/package.json's artifactName patterns
// and live next to latest.yml in the /download folder on the site.
const DOWNLOAD_URL = '/download/';
function downloadManifest(): Plugin {
  return {
    name: 'venband-download-manifest',
    apply: 'build',
    closeBundle() {
      const manifest = {
        version: VERSION,
        url: DOWNLOAD_URL,
        updatedAt: new Date().toISOString(),
        windows: [
          { name: `Venband-Setup-${VERSION}.exe`, kind: 'installer', url: `${RELEASE_URL}Venband-Setup-${VERSION}.exe` },
          { name: `Venband-Portable-${VERSION}.exe`, kind: 'portable', url: `${RELEASE_URL}Venband-Portable-${VERSION}.exe` },
        ],
        android: { name: `Venband-${VERSION}-debug.apk`, kind: 'apk', url: `${DOWNLOAD_URL}Venband-${VERSION}-debug.apk` },
      };
      fs.writeFileSync(path.join(process.cwd(), 'dist', 'download.json'), JSON.stringify(manifest, null, 2));
    },
  };
}

// Bump the icon URLs with the build version. Google caches favicons by URL and
// can keep showing an old one for weeks after the files change; a fresh URL
// makes crawlers fetch the current logo again.
function versionedIcons(): Plugin {
  return {
    name: 'venband-versioned-icons',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replaceAll('__VBV__', encodeURIComponent(VERSION));
      },
    },
  };
}

// Strict Content-Security-Policy. GitHub Pages can't send headers, so it is
// delivered as a <meta> tag. Only the configured Supabase project (and an
// optional TURN server) may be contacted, plus Klipy for GIFs and the
// click-to-load embed providers.
function csp(env: Record<string, string>): Plugin {
  return {
    name: 'venband-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) return html; // dev server needs inline HMR scripts
        const supa = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL) : null;
        const connect = ["'self'"];
        if (supa) connect.push(supa.origin, `${supa.protocol === 'http:' ? 'ws' : 'wss'}://${supa.host}`);
        // GIF search (Klipy). GIF images/videos load from Klipy's CDN.
        connect.push('https://api.klipy.com');
        const gifs = 'https://*.klipy.com';
        // click-to-load embeds
        const frames = [
          'https://www.youtube-nocookie.com',
          'https://open.spotify.com',
          'https://www.instagram.com',
          'https://www.tiktok.com',
        ];
        const policy = [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          `img-src 'self' blob: data: ${gifs}${supa ? ` ${supa.origin}` : ''}`,
          `media-src 'self' blob: ${gifs}`,
          `connect-src ${connect.join(' ')}`,
          "font-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          // blob: = decrypted PDFs shown in the built-in viewer
          `frame-src blob: ${frames.join(' ')}`,
          'upgrade-insecure-requests',
        ].join('; ');
        return html.replace(
          '<!-- Content-Security-Policy is injected at build time by vite.config.ts -->',
          `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

// Windows installers are too big for the Vercel Hobby deploy (100 MB static
// upload limit), so they publish to GitHub Releases via desktop.yml and the
// download page links there. The APK is small and stays on the site.
const RELEASE_URL = 'https://github.com/youragoober999-sketch/venband/releases/latest/download/';
// In development, serve the Vercel functions in /api (link previews, media proxy).
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'venband-dev-api',
    configureServer(server) {
      Object.assign(process.env, env);
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/([a-z-]+)(\?|$)/);
        if (!m) return next();
        try {
          const mod = await import(/* @vite-ignore */ `${process.cwd()}/api/${m[1]}.js?t=${Date.now()}`);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const method = (req.method ?? 'GET').toUpperCase();
          const handler = mod[method];
          if (!handler) {
            res.statusCode = 405;
            return res.end('method not allowed');
          }
          let body: Buffer | undefined;
          if (method === 'POST') {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            body = Buffer.concat(chunks);
          }
          const response: Response = await handler(new Request(`http://localhost${req.url}`, { method, headers, body: body ? new Uint8Array(body) : undefined }));
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    // absolute so deep links like /channels/@me/123 load their assets
    base: process.env.VENBAND_BASE ?? '/',
    plugins: [react(), csp(env), devApi(loadEnv(mode, process.cwd(), '')), downloadManifest(), versionedIcons()],
    define: { __VENBAND_VERSION__: JSON.stringify(VERSION) },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
