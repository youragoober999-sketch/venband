import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const VERSION: string = pkg.version;

// Write dist/download.json so the /download page and /api/vdl?r=version share one
// machine-readable source of truth for "what's published right now".
//
// It is built from the LATEST PUBLISHED GITHUB RELEASE and the files actually
// attached to it — never from package.json's version, which can be ahead of what
// has been released (that produced 404 download buttons). If GitHub can't be
// reached at build time, the checked-in public/download.json (already copied to
// dist/) is kept as-is.
const REPO = process.env.VENBAND_RELEASE_REPO || 'youragoober999-sketch/venband';

interface GhAsset { name: string; browser_download_url: string; size: number }

function pick(assets: GhAsset[], re: RegExp) {
  const a = assets.find((x) => re.test(x.name));
  return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null;
}

async function latestRelease(): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'venband-build' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const rel = (await r.json()) as { tag_name: string; published_at: string; html_url: string; assets: GhAsset[] };
    const assets = rel.assets ?? [];
    const installer = pick(assets, /^Venband-Setup-.*\.exe$/i);
    const portable = pick(assets, /^Venband-Portable-.*\.exe$/i);
    const apk = pick(assets, /\.apk$/i);
    const appimage = pick(assets, /\.AppImage$/i);
    const dmg = pick(assets, /\.dmg$/i);
    if (!installer && !portable && !apk) throw new Error(`release ${rel.tag_name} has no downloadable apps`);
    return {
      version: rel.tag_name.replace(/^v/, ''),
      url: rel.html_url,
      updatedAt: rel.published_at,
      windows: [
        ...(installer ? [{ ...installer, kind: 'installer' }] : []),
        ...(portable ? [{ ...portable, kind: 'portable' }] : []),
      ],
      ...(apk ? { android: { ...apk, kind: 'apk' } } : {}),
      ...(appimage ? { linux: [{ ...appimage, kind: 'appimage' }] } : {}),
      ...(dmg ? { mac: [{ ...dmg, kind: 'dmg' }] } : {}),
      source: 'github-release',
    };
  } catch (e) {
    console.warn(`[download-manifest] keeping public/download.json — could not read the latest release: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function downloadManifest(): Plugin {
  return {
    name: 'venband-download-manifest',
    apply: 'build',
    async closeBundle() {
      const manifest = await latestRelease();
      if (!manifest) return;
      fs.writeFileSync(path.join(process.cwd(), 'dist', 'download.json'), JSON.stringify(manifest, null, 2));
      console.log(`[download-manifest] linked release ${manifest.version} (${REPO})`);
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
