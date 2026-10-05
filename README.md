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
- **Group chats:** up to 10 people, with names, adding people and leaving. Leaving swaps the group's encryption key.
- **Direct messages:** 1-on-1 DMs, including DM calls that ring the other person.
- **Voice, video and screen sharing:** calls use WebRTC with mute, deafen, camera, screen share (with audio), speaking indicators and a focus view.
- **Security fingerprints:** you can check another user's fingerprint to make sure nobody is intercepting your conversation, and you get a warning if someone's key changes.
- **Friends:** friend requests, a private nickname and note for anyone, pinning, muting and blocking.
- **Profiles:** banner, pronouns, custom status, online / idle / do-not-disturb / invisible, animated nameplates, server tags and badges, plus mutual servers, mutual friends and account age.
- **Formatting:** Discord-style markdown (`**bold**`, `||spoilers||`, headings, quotes, lists, code), and `@user`, `@role`, `@everyone`, `@here` and `#channel` mentions with autocomplete.
- **Embeds and GIFs:** YouTube, Spotify, Instagram and TikTok links become players (click-to-load by default, for privacy). GIF search through [Klipy](https://klipy.com), favourites that sync to every device, and "make a GIF" from your own pictures, right on your device.
- **Translation:** pick your language when you sign up. Messages can be translated automatically or with a right-click. Translation runs on your device, so it doesn't break end-to-end encryption.
- **Servers:** new servers get `#welcome` (with join messages) and `#chat`. Owners can set a description, a server tag, a banner colour and an AutoMod slur filter.
- **Discovery:** verified servers and servers with 1,000+ members appear in the Discover tab.
- **Settings:** account, profile, privacy, devices (see every logged-in device with its rough location and log it out), appearance with a theme marketplace and theme creator, voice & video (devices, noise suppression, screen share up to 1440p 60 fps), chat and language. Everything syncs to your account.
- **Reports:** anyone can report a message or a person. Because messages are end-to-end encrypted, the report carries the messages the reporter chose to share. Administrators and the owner review them in **Settings → Report Centre** and can ban or limit the account right there.
- **Message requests:** DMs from people you share no server or friendship with wait in Message Requests until you accept them.
- **Moderation (Venband staff):** search any user or server; apply badges; make an account limited, very limited or banned; put a server in review (frozen), pass or fail the review, verify it or ban it. Every action is written to an audit log.
- **Bots and the developer portal:** make bots at `/applications` from presets (Verification, Server management, Connect a site) or write your own with the token-based bot API (`POST /api/bot`), slash commands and webhooks (`POST /api/hooks`). Paste an invite in a bot's dashboard to add it to a server. Bots can't read end-to-end encrypted messages; what they post is plain text and carries a BOT tag.
- **Voogle verification:** servers can require members to verify before they talk. Voogle blocks too many accounts from one device or network and catches ban evasion. Only peppered hashes are stored, and moderators only ever see "99% sure alt" / "Likely alt" — never IP addresses or device details. Look up alts at `/voogle`.
- **Safety and security:** two-factor sign-in (authenticator apps), a Security Center (log out other devices, data export, account deletion with a grace period), server recycle bin, photo metadata stripping, risky-file and link-safety warnings.
- **Server moderation:** reports for server moderators (reporter stays anonymous, pictures included, jump to the message), timeouts, warnings, a searchable audit log, and owners can remove GIFs. Venband owners and founders can design custom badges.
- **Public pages:** `/status` (live checks plus incidents staff can post), `/tos`, `/privacy`, `/guidelines`, `/changelog` and `/discovery` work without an account.
- **Quality of life:** right-click menus everywhere, per-person and per-stream volume up to 200%, stream attenuation, resizable panels, and real URLs (`/sign-in`, `/register`, `/channels/@me/<user>`, `/channels/<server>/<channel>`).

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

message = AES-256-GCM(message key, JSON) + ECDSA signature by the author
          message key = HKDF-SHA256(epoch key, fresh random 128-bit salt, message context):
          a new key for every message and every edit, never reused
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
   - **Dashboard:** open **SQL Editor** and run each file in `supabase/migrations/` **in order**: paste the whole file, click **Run**, then do the next one (`20260928000000_venband_schema.sql`, `20260929000000_explicit_grants.sql`, `20260930000000_profile_self_heal.sql`, `20261001000000_group_chats.sql`, then `20261002000000_platform.sql`). Or simply run `supabase/repair.sql` after the first file — it contains all the later ones.
   - **CLI:** `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. **Authentication → Sign In / Providers → Email:** check that **Confirm email** is **on**.
4. **Authentication → URL Configuration:**
   - Site URL: `https://<your-github-user>.github.io/venband/`
   - Redirect URLs: add the same URL.
5. **Authentication → Emails → SMTP Settings:** turn on **custom SMTP** (for example Resend: host `smtp.resend.com`, port `465`, user `resend`, password = your API key). Supabase's built-in mailer is only for testing: it sends a handful of emails per hour, and only to your own team's addresses.
6. **Authentication → Policies / Password:** set the minimum length to **32**. This is optional hardening: Venband always sends a 64-character derived key, so plain passwords can't be used against the API directly.
7. **Realtime → Settings:** turn **off** "Allow public access" so only authorized private channels work.
8. **Authentication → Hooks → Before User Created:** choose **Postgres** and the function `public.before_user_created`. This limits sign-ups to 6 accounts per IP address (IPs are stored only as salted hashes). One account per email is always enforced by Supabase.
9. **Make yourself the owner:** sign up with the username `sl` (or whichever account should run the platform; change the name in the SQL), then run `supabase/repair.sql` again. The first time it runs with that account present, it becomes the platform **owner** with every badge. After that, staff roles are only changed from **Settings → Moderation**.
10. **Project Settings → API:** copy the **Project URL** and the **anon / publishable key**.

### 2. Publish the app (GitHub Pages)

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source:** **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables:** add
   - `VITE_SUPABASE_URL`: your Project URL
   - `VITE_SUPABASE_ANON_KEY`: your anon / publishable key
   - `VITE_KLIPY_API_KEY` (optional): your Klipy key from <https://partner.klipy.com>, for GIF search
   - Donations (optional, any of): `VITE_DONATE_PAYPAL` (your PayPal.me name), `VITE_DONATE_CASHAPP` (your $cashtag), `VITE_DONATE_KOFI`, `VITE_DONATE_BMC` (Buy Me a Coffee name). The Donate tab sends people to those pages; Venband never handles card details.

   These values end up in the public web app by design; Row Level Security protects the data. Never commit them to the repository.
4. Push to `main` (or run the **Deploy to GitHub Pages** workflow). Your app is live at `https://<user>.github.io/venband/`.

**Optional:** if friends behind strict corporate or mobile networks can't connect to calls, add a TURN server with the variables `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`. A TURN server only relays already-encrypted media.

## Tips

- **Testing with two accounts?** All tabs of one browser share a single login, so logging into account B in a second tab logs account A out everywhere in that browser. Use a private/incognito window, or a different browser, for the second account.
- **Notifications:** click **Turn on notifications** at the top of the app so calls and DMs reach you while the tab is in the background.

### Something says "missing database permission"?

Run [`supabase/repair.sql`](supabase/repair.sql) in the Supabase **SQL Editor**. It's safe to run any time: it re-applies every permission the app needs and ends with a checklist that should say `ok` on every row.

### Deploy on Vercel instead (or as well)

1. On <https://vercel.com/new>, import this GitHub repository. Vercel reads `vercel.json`, so the build settings are already correct.
2. Under **Environment Variables**, add `VITE_SUPABASE_URL` (your Supabase project URL), `VITE_SUPABASE_ANON_KEY` (the **anon** or **publishable** key) and, for GIFs, `VITE_KLIPY_API_KEY`. Never add the `service_role` or secret key: the app doesn't need it, and anything in a `VITE_` variable is visible to everyone.
3. Click **Deploy**. Then in Supabase → **Authentication → URL Configuration**, add your Vercel URL (for example `https://venband.vercel.app/`) to **Redirect URLs**, and make it the **Site URL** if it's your main address. Otherwise signup and password-reset emails will link to the wrong site.
4. On Vercel the Devices list also shows each device's city and state (from Vercel's own IP location headers, see `api/geo.js`). On GitHub Pages it shows the device without a location.
5. Optional: in Vercel → **Settings → Domains**, add your own domain or subdomain, e.g. `chat.yoursite.com`, and add that URL in Supabase too.

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
