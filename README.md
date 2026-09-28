<p align="center">
  <img src="public/favicon.svg" width="72" alt="Venband logo" />
</p>

<h1 align="center">Venband</h1>

<p align="center">
  Open-source, <b>end-to-end encrypted</b> chat with servers, roles, channels, voice, video and screen sharing.<br/>
  Runs entirely in the browser + free cloud services. Nothing runs on your PC.
</p>

---

## Features

- **Accounts:** sign up with email and username. Email verification is required, and there are password reset and password change flows.
- **Servers:** create them, invite people with expiring or limited-use invite links, leave them, transfer ownership, or delete them.
- **Channels:** text and voice channels, grouped into categories. A channel can be made private so only chosen roles can see it.
- **Roles and permissions:** 12 permissions, including Administrator, Manage Server, Manage Roles, Manage Channels, Kick, Ban, Invite, Send, Manage Messages, Connect, Speak and Video. Roles have colours, can be shown separately in the member list, and follow a hierarchy (you can only manage roles and members below your own highest role).
- **Moderation:** kick, ban and unban. Removing someone automatically rotates the encryption key of every channel they could read.
- **Messaging:** real-time messages with replies, edits, deletes, `code`, **bold**, *italic*, links, typing indicators and online status.
- **Encrypted file attachments:** images, video and audio preview inline. Files can be up to 25 MB.
- **Direct messages:** 1-on-1 DMs, including DM calls that ring the other person.
- **Voice, video and screen sharing:** calls use WebRTC with mute, deafen, camera, screen share (with audio), speaking indicators and a focus view.
- **Security fingerprints:** you can check another user's fingerprint to make sure nobody is intercepting your conversation, and you get a warning if someone's key changes.

## How it runs (no PC required)

| Piece | Service | Cost |
| --- | --- | --- |
| Web app (static files) | **GitHub Pages** (built by GitHub Actions) | Free |
| Accounts, email verification, database, realtime, file storage | **[Supabase](https://supabase.com)** (hosted Postgres) | Free tier |
| Voice/video media | Direct **peer-to-peer** between users (WebRTC) | Free |
| Sending verification emails | Any SMTP provider, e.g. [Resend](https://resend.com) or [Brevo](https://brevo.com) | Free tier |

## End-to-end encryption

The server stores **only ciphertext**. It can't read messages, files or call audio and video.

```
password ──Argon2id (64 MiB)──► master key ──HKDF──► login key  → sent to Supabase Auth
                                             └─HKDF──► vault key  → never leaves your device
vault key encrypts your identity keys (ECDH P-256 + ECDSA P-256) before they are stored.

every channel: random AES-256-GCM key per "epoch"
   ├─ wrapped for each member with ECIES (ephemeral ECDH + HKDF + AES-GCM), signed by the sender
   └─ rotated automatically when anyone loses access (kick / ban / leave / role removed)

message = AES-256-GCM(epoch key, JSON) + ECDSA signature by the author
          (bound to message id, channel, author, key and epoch: no forgery, replay or re-attribution)
files   = AES-256-GCM with a fresh random key; that key travels inside the encrypted message
calls   = WebRTC DTLS-SRTP peer-to-peer; every SDP offer/answer is signed with the sender's
          identity key, so a signaling server can't man-in-the-middle the media
```

Other protections:

- **Row Level Security:** Postgres enforces it on every table, and it's covered by automated tests (`tests/db`).
- **Strict Content-Security-Policy:** the app may only talk to your Supabase project.
- **Safe message rendering:** messages are never rendered as HTML (no `innerHTML`), so pasted markup can't run.
- **Keys can't be copied out:** private keys are held as non-extractable WebCrypto keys, so page scripts can use them but can't export them.
- **Your password stays on your device.** Supabase only ever receives a derived 256-bit key.

Read **[SECURITY.md](SECURITY.md)** for the threat model and the honest list of limitations.

---

## Deploy your own (about 15 minutes)

### 1. Create the backend (Supabase)

1. Create a free project at <https://supabase.com/dashboard>.
2. Load the database schema. Use **either** option:
   - **Dashboard:** open **SQL Editor** and run each file in `supabase/migrations/` **in order**: paste the whole file, click **Run**, then do the next one (`20260928000000_venband_schema.sql`, then `20260929000000_explicit_grants.sql`).
   - **CLI:** `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. **Authentication → Sign In / Providers → Email:** check that **Confirm email** is **on**.
4. **Authentication → URL Configuration:**
   - Site URL: `https://<your-github-user>.github.io/venband/`
   - Redirect URLs: add the same URL.
5. **Authentication → Emails → SMTP Settings:** turn on **custom SMTP** (for example Resend: host `smtp.resend.com`, port `465`, user `resend`, password = your API key). Supabase's built-in mailer is only for testing: it sends a handful of emails per hour, and only to your own team's addresses.
6. **Authentication → Policies / Password:** set the minimum length to **32**. This is optional hardening: Venband always sends a 64-character derived key, so plain passwords can't be used against the API directly.
7. **Realtime → Settings:** turn **off** "Allow public access" so only authorized private channels work.
8. **Project Settings → API:** copy the **Project URL** and the **anon / publishable key**.

### 2. Publish the app (GitHub Pages)

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source:** **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables:** add
   - `VITE_SUPABASE_URL`: your Project URL
   - `VITE_SUPABASE_ANON_KEY`: your anon / publishable key

   Both values are public by design; Row Level Security protects the data.
4. Push to `main` (or run the **Deploy to GitHub Pages** workflow). Your app is live at `https://<user>.github.io/venband/`.

**Optional:** if friends behind strict corporate or mobile networks can't connect to calls, add a TURN server with the variables `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`. A TURN server only relays already-encrypted media.

## Local development

Requires Node 22.18+ and Docker.

```bash
npm install
npx supabase start          # local Postgres, Auth, Realtime, Storage, and a mail catcher
cp .env.example .env.local  # fill in the API URL + anon key printed by `supabase status`
npm run dev                 # http://127.0.0.1:5173
```

Verification emails appear in Mailpit at <http://127.0.0.1:54324>.

| Command | What it does |
| --- | --- |
| `npm test` | Crypto unit tests (tampering, replay, impersonation, wrong password) |
| `npm run test:db` | Runs the migration + Row Level Security tests against Postgres (`PGHOST`, `PGPORT`, `PGUSER`) |
| `npm run test:e2e` | Browser end-to-end test: signup + email verification, servers, roles, E2EE messages, attachments, kick + key rotation, DMs, voice/video (needs `supabase start` + `npm run dev`) |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build, including the CSP |

## Project layout

```
supabase/migrations/   database schema, RLS policies, RPCs, realtime + storage authorization
src/lib/crypto.ts      all cryptography (Argon2id, ECDH, ECDSA, AES-GCM, ECIES)
src/lib/keyring.ts     channel key epochs: creation, distribution, rotation, message encryption
src/lib/identity.ts    identity key storage (vault-encrypted server-side, non-extractable locally)
src/lib/call.ts        WebRTC mesh with signed signaling (voice / video / screen share)
src/lib/session.ts     signup, email verification, login, unlock, password reset/change
src/components/        React UI
tests/                 crypto unit tests + database security tests
```

## License

MIT. See [LICENSE](LICENSE). Venband is an independent project and is not affiliated with Discord.
