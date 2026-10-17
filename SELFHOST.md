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

## 3. Venband Data Layer (VDL) — fastest, fully on-site
The newest option: a custom backend built on Vercel Postgres + Vercel KV (Redis), with cookie JWT auth, server-side password hashing (bcrypt), and a KV hot-cache for messages.
- Free tiers: Vercel Postgres 256 MB, Vercel KV 256 MB.
- Setup:
  1. Vercel dashboard → Storage → Create Postgres + Create KV.
  2. Run `vdl/schema.sql` in the Vercel Postgres query runner.
  3. Set `VDL_JWT_SECRET` (long random string) in Vercel env.
  4. Redeploy. Endpoints live at `/api/vdl/*`.
- Client adapter: `src/lib/vdl.ts` (signup/signin/users/servers/messages).
- The `/storage` console now shows a "VDL users" block as proof of the new layer.

## 4. Venband Blob (VBB) — custom, content-addressed object storage
A fully custom blob store invented for Venband:
- Small objects stored in Postgres (bytea), deduped by SHA-256 (content-addressable).
- Large objects chunked into 1 MB pieces for streaming.
- Served from your own domain via `cdn.venband.com/o/:id`.
- Subdomains: `storage.venband.com` (console), `cdn.venband.com` (objects), `shard-N.venband.com` (scale-out shards).
- Shard registry at `/api/vbb-shards` lets owners register and manage shards.
- Schema: `vbb/schema.sql`.

## Security notes
- Never expose `BLOB_READ_WRITE_TOKEN` or service keys to the browser; they live only in Vercel env (server-side).
- `/storage` remains gated to owners/founders via `is_top_staff()`; the Blob API re-checks the caller's Supabase session on every request.
- Vercel Blob objects are public-by-URL; only owners/founders learn the URLs through the gated console.