# Free self-hosted backend (PocketBase)

This is the "invent something new" option: a **single binary** that gives you auth, realtime, a database, file storage and an admin UI — for free, on Fly.io's free tier.

## One-click-ish deploy (Fly.io)

1. Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
2. `cd deploy/pocketbase`
3. `fly launch` (accept defaults, pick a region)
4. `fly volumes create pb_data --size 1` (free 1 GB on free tier; upgrade for more)
5. `fly deploy`
6. Open `https://venband-backend.fly.dev/_/` to create your admin account.

## Point the app at it
Set in Vercel → Environment Variables:
- `VITE_POCKETBASE_URL=https://venband-backend.fly.dev`

(Requires the PocketBase adapter in `src/lib/pocketbase.ts` — see SELFHOST.md. The adapter is a work-in-progress; the app currently still uses Supabase.)

## Notes
- Fly.io free tier: 3 shared VMs, 160 GB/mo transfer, 1 GB volume free. Enough for a small community.
- Data persists on the mounted volume. Back it up with `fly ssh console -C "/pb/pocketbase backup"`.
- HTTPS is automatic via Fly.
- To scale storage, increase the volume size or attach external S3-compatible storage (Cloudflare R2 free tier).