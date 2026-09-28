# Venband security model

## What the server (Supabase) can and cannot see

| Data | Visible to the server? |
| --- | --- |
| Message text, replies' text, edits | **No.** AES-256-GCM ciphertext only |
| File attachments (content, name, type) | **No.** The encrypted blob is stored; the name, type and key live inside the encrypted message |
| Voice / video / screen share | **No.** Media flows peer-to-peer (DTLS-SRTP) |
| Your password | **No.** Only an Argon2id+HKDF-derived login key is sent |
| Your private keys | **No.** They are stored encrypted with a key derived from your password |
| Channel keys | **No.** They are stored wrapped (ECIES) for each member |
| **Metadata:** who is in which server, server/channel/role **names**, usernames, profiles, message timestamps and sizes, who talks to whom, when you're online, typing events, IP addresses | **Yes** |

If you need names of servers and channels to be secret too, keep them non-descriptive.

## Cryptography

- **Password handling:** Argon2id (m = 64 MiB, t = 3, p = 1), salted with SHA-256 of the normalized email, followed by HKDF-SHA-256. One HKDF output becomes the login key; the other becomes the vault key.
- **Identity:** an ECDH P-256 key (for key agreement) and an ECDSA P-256 key (for signatures). Private keys are sealed with AES-256-GCM using the vault key, with the user id and key id as associated data.
- **Channel keys:** a random 256-bit key per epoch. A new epoch is forced by the database (`key_rotation_needed`) whenever someone loses access: kick, ban, leave, role removal, a permission downgrade, or a channel becoming private. The server refuses messages encrypted with an old epoch or sent while a rotation is pending.
- **Key wrapping:** ECIES, meaning an ephemeral ECDH P-256 key, then HKDF-SHA-256 (salt = ephemeral public key, info bound to channel, epoch, recipient and key id), then AES-256-GCM. Each wrap is signed by the member who wrapped it. Recipients verify that signature, and also check an HMAC commitment (`key_check`) published when the epoch was created.
- **Messages:** AES-256-GCM with associated data `(message id, channel, author, author key, epoch)`, plus an ECDSA signature over that and the ciphertext. The message id is chosen by the client, so the server can't duplicate or re-attribute messages.
- **Calls:** perfect-negotiation WebRTC. Every offer and answer is signed by the sender's identity key and verified before use. The DTLS fingerprints inside the SDP are therefore authenticated, which prevents man-in-the-middle attacks by the signaling server.
- **Trust:** trust-on-first-use. Each user has a 60-digit fingerprint that you can compare out-of-band and mark as verified. If a key changes, a warning appears.

## Server-side authorization

Every table has Row Level Security. Permission checks are implemented once, in `SECURITY DEFINER` SQL functions (`server_permissions`, `can_view_channel`, …), and used by every policy, by the Realtime channel authorization (`realtime.messages`) and by the Storage bucket policies. `tests/db/rls_test.sql` checks, among other things, that:

- non-members see nothing,
- members can't escalate roles, grant permissions they don't have, act above their role hierarchy, impersonate other users or other users' keys, or read private channels and other people's DMs,
- kicks force key rotation, and banned users can't rejoin.

## Known limitations (please read)

- **Web delivery trust.** Like every web-based E2EE app, you trust the host that serves the JavaScript. If the GitHub Pages site (or its repository) is compromised, malicious code could be shipped. For the highest assurance, build and host it yourself from a reviewed commit.
- **No per-message forward secrecy.** Keys rotate when membership shrinks, not after every message; this isn't a Signal or MLS ratchet. Someone who steals a device while it's unlocked can read the history of the channels that device has keys for.
- **Password reset.** Resetting your password creates new identity keys. Old history becomes readable again only when another member who still holds those channel keys comes online and re-shares them. For DMs, that means the other person.
- **Voice permission enforcement.** Calls are peer-to-peer, so the *Speak* and *Video* permissions are enforced by honest clients, not by a server. *Connect* (joining at all) is enforced server-side.
- **Mesh calls.** Every participant sends media to every other one, which works well for small groups (about 2–8 people).
- **Not audited.** This code has not had a professional security audit. Use it accordingly.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Advisories → Report a vulnerability) rather than a public issue.
