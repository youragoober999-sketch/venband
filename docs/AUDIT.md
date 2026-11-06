# Venband platform audit — 2026-11-05

Phase 1 (discovery) and Phase 2 (audit) of the platform overhaul. Everything below
was checked against the real code, a test database built from the real migrations,
or the live site — nothing is assumed. Where something could not be inspected,
that is stated.

## How this was checked

| Check | Method | Result |
|---|---|---|
| Database schema, RLS, grants | All 42 migrations loaded into a throwaway Postgres (PGlite) with `tests/db/supabase_stub.sql`, then queried `pg_class`, `pg_policies`, `has_function_privilege` | see §3 |
| Database behaviour | Project suite `tests/db/rls_test.sql` (910 lines) against `supabase/setup.sql` | **passes** (after the fixes in §1) |
| App tests | `npm test` | 24/24 pass |
| Types | `npx tsc -b` | clean |
| Production build | `npm run build` | succeeds; see §5 |
| Lint | — | **no lint script exists** |
| Dependencies | `npm audit --omit=dev` | 1 critical, 5 high (§3.4) |
| GIF encoder | Encoded 6 cases with `src/lib/gifenc.ts`, decoded with an independent decoder (omggif), compared pixels | **all pixel-exact** (§4.4) |
| Live public site | Browser at 1280px and 375px: `/`, `/download`, `/status`, `/bots`; download URLs fetched | §2, §6 |
| Live database | Public API probed with the site's public key | §1 |

**Not inspected:** the signed-in app on the live site (no test account; Claude
does not sign in with real passwords), the desktop and mobile apps, and real-time
calling. These need a test account to audit visually.

## 1. Critical — fixed during this audit

| Problem | Impact | Status |
|---|---|---|
| Live Supabase project had **no schema at all** (0 tables/functions) | All sign-in, profiles, servers, messages broken | `supabase/setup.sql` created; user ran it |
| Accounts created while the DB was empty had a login but no profile | "Email already exists" on signup **and** "No account" on login | `20261105000000_backfill_profiles.sql` (run on live DB still pending) |
| `20261030000000_polls.sql` redefined polls with an incompatible schema | Aborted every fresh setup; where it ran, `using (true)` exposed **every poll in every private channel** | Neutralised to a cleanup migration |
| Two overloads of `mod_set_account_status` | Every ban/limit from **Settings → Moderation failed** ("ambiguous function") | Old overload dropped |
| `open_dm` rewrite dropped message requests | DMs from strangers skipped **Message Requests** | Restored |
| `README` pointed to a non-existent `supabase/repair.sql` | New installs had no working setup path | README + in-app errors updated |

## 2. Broken functionality (open)

1. **All three download buttons 404** (`/download`). Links are built from
   `package.json`'s version (1.0.6) in `vite.config.ts` / `Download.tsx`, but no
   1.0.6 release or APK exists. Fix: derive links from the latest *published*
   GitHub release (or `public/download.json`), never from the source version.
2. **Status page checks are too shallow.** *(Corrected — the first version of this
   audit said it showed "operational" with an empty database; that screenshot was
   taken after `setup.sql` had been run, and `status_ping` would in fact have
   failed on an empty database.)* The real problems: the "Website & app" check
   discarded the HTTP status (`void (await fetch()).ok`) so it could never fail,
   and the database check only proves one function exists, so a half-migrated or
   out-of-date database still showed "Operational". **Fixed in Phase A** (see §8).
3. **Themes cannot be edited after publishing.** `public.themes` has select /
   insert / delete policies only — **no UPDATE policy**, no versions, no drafts.
4. **GIF maker** (see §4.4): no video input, uploaded animated GIFs lose their
   animation, speed slider ignores keyboard input, no progress/cancel.
5. **Memories** don't match the product rule (max 30 per account, 10 active):
   current build allows 10 total with no archive/expiry.
6. **Official Venband bot** only sends DMs for two events (account status change,
   server rejected/closed). No security alerts, no notification center.

## 3. Security

### 3.1 Row-level security — verified in a real database
* All core tables (`messages`, `user_private_keys`, `channel_keys`, …) have RLS on.
* **`wordle_games` and `wordle_words` have no RLS.** On Supabase, public tables are
  reachable through the API, so anyone can read the answer list or edit other
  players' games. *Fix: enable RLS + owner policies.*
* Tables with RLS and no policies (deny-all, intended): `login_lookups`,
  `platform_config`, `signup_ips`, `voogle_signals`.
* `using (true)` select policies: `activities`, `bot_templates`, `custom_badges`,
  `status_incidents`, `status_updates`, `themes` — all intentionally public; review
  `activities` (shows what users are playing to **every** signed-in user, not just
  people who can see their profile).

### 3.2 Database functions
* All 203 functions with `security definer` set `search_path` ✅.
* 33 definer functions are callable while signed out. Checked each: the ones
  without an obvious check are wrappers into checked functions (`create_invite`,
  `create_server`), staff-gated via `platform_rank()` (`discovery_queue`,
  `review_discovery`), or public by design (`public_discover`, `status_ping`).
  No exploitable one found. `wordle_command` should be reviewed with §3.1.

### 3.3 API endpoints (`api/`)
* Outbound fetches (`link-preview`, `media`) use `_lib/net.js`: private ranges
  blocked, DNS checked at connect time (rebinding), redirects re-checked, size and
  time limits, rate limits ✅.
* `api/translate.js` answered CORS preflights with `access-control-allow-origin: *`.
  *(Corrected: the original audit overstated this — the POST response itself had
  no CORS header and other sites can't obtain a user's token, so the real risk was
  low.)* Tightened anyway in Phase A (§8).
* VDL (`api/vdl.js`) re-reads role/ban from the DB per request, rate-limits auth ✅.

### 3.4 Dependencies (`npm audit --omit=dev`)
* **dompurify (critical)** — `SAFE_FOR_TEMPLATES` bypass. Venband calls DOMPurify
  with `USE_PROFILES: { html: true }` only, so **not exploitable as used**; still
  upgrade (3.4.17 available via `npm audit fix`).
* undici, zod, @vercel/blob → @vercel/oidc → @vercel/cli-config (high) —
  transitive; fix via `npm audit fix`, re-run build and tests.

### 3.5 Other
* No secrets tracked in git ✅ (`.env*` untracked).
* XSS: the only `dangerouslySetInnerHTML` uses go through `sanitizeHtml` ✅.
* Secrets pasted into chat during setup (a Resend API key, an account password)
  should be rotated.

## 4. Feature-by-feature

### 4.1 Themes
`themes(id, author_id, name, description, data, installs, kind)`, a creator in
Settings (`ThemeCreator`), a marketplace in DMs. **Missing:** update policy,
versions, drafts, rollback, install-update choices, ratings/reviews, categories,
reports. Theme `data` is JSON (no executable code) — keep it that way; custom CSS
goes through `customCss.ts`.

### 4.2 Badges
A fixed list of 13 names enforced by `all_badges()`, plus `custom_badges(name,
description, image_url)` designed by owners. **Missing:** categories, rarity,
display order/selection by the user, artwork system, revoke history.

### 4.3 Official Venband account
Exists: fixed system account `3fff0000-…bd`, `venband_notice()`, bot DMs on
moderation. Identity is enforced server-side (it's a real `auth.users` row that
can't sign in) ✅. **Missing:** security events, notification center, read state,
categories, verification UI.

### 4.4 GIF maker (`src/lib/gifenc.ts`, `GifPicker.tsx`)
Encoder verified correct (solid, checker, 200×150 gradient, 320×240 noise that
forces LZW dictionary resets, 3-frame looping animation, transparency — 0%
pixel error). The problems are around it: image-only input (`accept="image/*"`),
first frame only for GIF input, keyboard-inaccessible speed control, everything
on the main thread with no progress or cancel.

### 4.5 Administration
Exists: platform roles `user/moderator/admin/owner`, badges, account status
(active/limited/very_limited/banned), `mod_actions` audit, server review/verify,
Report Centre, Voogle alt detection, storage console (VDL). **Missing:**
granular staff permissions (every staff rank is coarse), appeals, audit-log
search/filtering UI, theme/bot moderation queues.

### 4.6 Memories
Built in the previous session: private bucket, signed URLs, 10-per-account limit
in the DB, viewer, seen-by. Needs the 30 total / 10 active model, expiry, audience
choice, reporting.

## 5. Performance
* **One 1.56 MB JS bundle (469 KB gzip)** includes the storage console,
  moderation, settings, theme creator, every screen — even for a first-time
  visitor on the homepage. *Fix: route-level `React.lazy` for Storage, Settings,
  Moderation, Apps/Bots, PublicPages; lazy emoji data.*
* 208 KB CSS in one file (`styles.css`, ~2,700 lines).
* Build warns about 4 ineffective dynamic imports (supabase, directory, session,
  gifenc) — those `import()` calls do nothing.

## 6. Visual and UX (live site)
* **Two different navigation bars:** home = Features / Privacy / Source code;
  other public pages = Download / Discover / Developers / Voogle / Status / Privacy
  / TOS. Unify. "TOS" → "Terms".
* **Mobile header (375px):** "Log in" and "Sign up" wrap onto two lines.
* **`/bots` (Developers):** body text contrast is too low (grey on near-black).
* The old "invalid subdomain" page overlapped its own banner — replaced with a
  real not-found page (previous session).
* No horizontal overflow at 375px on `/` or `/download` ✅.

## 7. Plan — phased

Each phase ships on its own, keeps existing data, and is verified before the next.

| Phase | Scope | Why first |
|---|---|---|
| **A. Stabilise** (small) | Download links from real releases; status page probes real DB; RLS for wordle; `npm audit fix`; restrict translate CORS; mobile header; unify nav; `/bots` contrast; commit login fix | Visible breakage + security |
| **B. Performance** | Route-level code splitting; fix dead dynamic imports | Every visitor pays for it |
| **C. Themes** | `theme_versions` table, UPDATE policy owner-only, drafts, publish/rollback, install update preference, Studio editing of own themes; marketplace categories/ratings/reports | Top user request; needs DB design |
| **D. Official account + notifications** | `notifications` table written only by definer functions, security events (new device, password/email/MFA change), notification center, verified-official rendering | Security value |
| **E. Badges** | `badge_definitions` (category, rarity, art, display rules), user display order, admin editor, SVG artwork set | Depends on D's identity work |
| **F. Admin** | Granular staff permissions, appeals, audit search/filters, theme/bot moderation queues | Builds on C–E |
| **G. GIF maker** | Video + animated-GIF input, trim, crop, text, worker encoding, progress/cancel | Self-contained |
| **H. Memories** | 30 total / 10 active, expiry, audience, reporting | Small, self-contained |
| **I. Design system** | Tokens audit, shared components, visual pass of the signed-in app at 4 sizes | Needs a test account |
| **J. VDL migration** | Remaining stages from earlier (auth, data, realtime) | Long-running |

Larger ideas from the brief (Worlds, Friend Spaces, automation engine, …) should
be evaluated after A–I; none are started.

## 8. Phase A — stabilise (done 2026-11-06)

Everything below was verified, not just written. "Test DB" = all migrations loaded
into a throwaway Postgres (PGlite) with `tests/db/supabase_stub.sql`.

| Item | What changed | Verified by |
|---|---|---|
| **Download buttons (404)** | `vite.config.ts` builds `download.json` from the **latest published GitHub release** and the files attached to it; if GitHub is unreachable the checked-in `public/download.json` is kept. The page's fallback links to the Releases page instead of guessed names. | Build linked v1.0.5; all 3 links fetched → `206` (real files) |
| **Status page** | "Website & app" check now fails on HTTP errors (it discarded the status before). New **Database setup** row: `public.schema_missing()` + `src/lib/schemaManifest.ts` (generated per migration: tables/functions created, plus whitespace-insensitive fingerprints of rewritten functions) → names the exact migration files a database is missing. | Test DB: complete DB → 0 of 312 checks flagged (also with CRLF/tab-mangled SQL); DB missing the newest migrations → exactly those files named; live project showed "Needs update" |
| **Exposed internal functions** | `20261105020000_lock_down_internal.sql` revokes 18 SECURITY DEFINER helpers from the API. Worst: `wordle_command` let **signed-out callers make a bot post into any channel**; `are_friends` / `is_blocked_between` / `shares_server_or_dm` let anyone map friendships and blocks; `venband_notice` let any staff member send official DMs outside the audited flow. Each was checked to be unused by RLS policies, constraints, defaults, caller-privilege functions and the app. | Test DB exploit: anonymous `wordle_command` added a bot message to a private channel **before** (0→1), **blocked after** (0→0); member `/guess` still works; RLS suite now asserts the helpers can't be probed |
| **Wordle tables** | RLS on, no direct API access (they hold each channel's answer). | Same exploit test |
| **Dependencies** | `npm audit fix` (dompurify 3.4.17, undici 8.12.4); override `@vercel/cli-config` 0.3.7 (brings zod 4.6.7 — the version Vercel ships upstream); vite 8.3.6 (dev-server CVEs). | `npm audit` → **0 vulnerabilities** (incl. dev); `@vercel/blob`/`@vercel/oidc` load; build OK |
| **Translate API** | Only Venband origins (+ Capacitor app, + the deployment's own host) get CORS; other sites get 403; `Vary: Origin`. | Handler tested with 6 origin cases |
| **Navigation** | One shared header (`SiteNav`) on the homepage, sign-in/up and all public pages: Features · Discover · Developers · Download · Status. Phones get a real menu (was: links hidden, no menu). One footer listing every public page; "TOS" → "Terms"; the header's **Privacy link pointed at `privacy.venband.com` (404)** → now `/privacy`. | 375px: one line, no overflow, menu opens/closes (Esc, outside tap); Features from an inner page lands just below the header |
| **Contrast** | `--muted` raised to `#8a8a92` (and per-theme: Graphite `#94949c`, Daylight `#64646c` — Daylight was 3.81:1). The theme system overrides the stylesheet, so the fix is in `src/lib/themes.ts`. | Measured WCAG ratios on 12 public pages: **291/291 text elements pass AA** (was 37 failing) |
| CI | Runs `node scripts/build-setup-sql.mjs --check`; `tests/db/run.sh` matches Supabase's `search_path` (it would have failed on `gen_salt`) and runs the generated manifest test. | Not executed in GitHub Actions here (CI only runs on branches/PRs) |

**Must be run on the live Supabase project** (SQL Editor, in order):
`20261105010000_schema_check.sql`, then `20261105020000_lock_down_internal.sql`
— plus `20261105000000_backfill_profiles.sql` if not done yet. The lock-down only
changes permissions, so `/status` cannot detect whether it has been run.

## 9. Phase B — performance (done 2026-11-06)

Measured on production builds (`vite build`, source maps attributed per file).

| What a homepage visitor downloads | Before | After |
|---|---|---|
| JavaScript (incl. the MP3 encoder) | 2,069 KB raw / 576 KB gzip | **594 KB raw / 178 KB gzip (−71% / −69%)** |
| Signed-in app at startup | 1,536 KB + 533 KB encoder | 1,106 KB raw / 326 KB gzip |

* **`public/lame.all.js` (533 KB) was a render-blocking `<script>` on every page**
  — it's only for encoding voice messages. It now loads when recording starts
  (`src/lib/voicerec.ts`); WebM remains the fallback. Verified under the site's
  CSP: loads, and encodes valid MP3 frames (`FF FB` sync).
* **Route-level code splitting** (`src/App.tsx`): the signed-in app (`Shell`),
  onboarding, invites, the storage console, the developer portal, Voogle,
  download and all public pages are lazy chunks behind a splash screen. The
  first load is React + Supabase + session + homepage/sign-in only.
* **highlight.js (171 KB) loads only when code is shown**: `src/lib/useHighlight.ts`
  renders escaped plain text, then colours it; metadata moved to
  `src/lib/codeLanguages.ts` so menus don't pull the highlighter in.
* Social-login return handlers (`src/lib/connections.ts`) load only on a
  `?steam` / `?code` return.
* Dead dynamic imports: `gifenc` (made static — it was already in the same chunk);
  `supabase` / `directory` dynamic imports are now effective. `session` ↔
  `presence` is left as-is on purpose: it breaks a circular import.
* **Bug fixed on the way:** the Android update check hard-coded the installed
  version as `'1.0.3'`, so every newer install was told to "update" to the version
  it already had. Now compares against the build's real version
  (`compareVersions`, unit-tested in `tests/version.test.ts`).

Verification: production preview — homepage loads exactly 5 JS files; `/status`,
`/download`, `/bots`, `/voogle`, `/changelog`, `/privacy`, `/discovery`, `/storage`
and a 404 each render and load only their chunk; `Shell`, `Onboarding`, `Invite`,
`highlight`, `connections`, `translate` chunks all evaluate without errors (no
circular-import breakage); no console errors. The signed-in app itself could not
be clicked through (no test account).
