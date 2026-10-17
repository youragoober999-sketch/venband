# Self-hosting Venband (free, no Supabase)

Venband ships with two free, on-site storage options that need **no Supabase**:

## 1. Files — Vercel Blob (already wired)
The `/storage` console's **Storage** tab now talks to `/api/storage-blob`, which uses Vercel Blob.
- Free tier: 1 GB storage, 100 GB transfer/mo.
- Setup: Vercel dashboard → Storage → Create Blob store → it auto-sets `BLOB_READ_WRITE_TOKEN`.
- Files are served from Vercel's CDN, gated to owners/founders.

## 2. Full backend — PocketBase on Fly.io (free tier)
See `deploy/pocketbase/README.md` for one-command deploy.
- Gives auth, realtime, DB, files, admin UI for $0.
- Status: deployment scaffold ready; the client adapter (`src/lib/pocketbase.ts`) is the remaining piece to fully drop Supabase. Contributions welcome.

## 3. (Optional) Keep Supabase self-hosted
If you prefer, self-host the Supabase stack with Docker (Option in README). The app works unchanged — only env vars change.

## Security notes
- Never expose `BLOB_READ_WRITE_TOKEN` or service keys to the browser; they live only in Vercel env (server-side).
- `/storage` remains gated to owners/founders via `is_top_staff()`; the Blob API re-checks the caller's Supabase session on every request.
- Vercel Blob objects are public-by-URL; only owners/founders learn the URLs through the gated console.