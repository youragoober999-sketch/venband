import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content-Security-Policy. GitHub Pages can't send headers, so it is
// delivered as a <meta> tag. Only the configured Supabase project (and an
// optional TURN server) may be contacted.
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
        const policy = [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data:",
          "media-src 'self' blob:",
          `connect-src ${connect.join(' ')}`,
          "font-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-src 'none'",
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: process.env.VENBAND_BASE ?? './',
    plugins: [react(), csp(env)],
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
