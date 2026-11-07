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

## 10. Phase C — themes: ownership, versions, drafts, updates (done 2026-11-06)

Migration `20261106000000_theme_versions.sql` (applies to themes, CSS, nameplates
and name styles):

* **Owners edit their published items; nobody else can.** `public.themes` has no
  UPDATE policy — every change goes through `theme_save` / `theme_publish` /
  `theme_rollback` / `theme_set_status`, which check ownership server-side.
* **Versions:** each publish adds an immutable `theme_versions` row (with changelog
  and publisher). Restoring an old version republishes it as a *new* version, so
  history is never lost and installers see a normal update. Existing items were
  backfilled as v1 with their original dates.
* **Drafts:** `theme_drafts` (owner-only); the live version is untouched until
  publish. New items start as private drafts.
* **Status:** draft / published / unpublished (hidden, installers keep theirs) /
  removed (staff only, reason required, shown to the creator, logged in
  `mod_actions`; staff can restore).
* **Server-side validation** (`theme_data_problem`) mirrors the app's sanitizers:
  themes are colour variables + gradients only; CSS may not `@import`, load remote
  `url()`s or use script-like tricks; nameplates/name styles are hex colours and
  known keywords. Older app versions' direct inserts are validated and recorded as v1.
* **Honest install counts:** `install_theme` recorded +1 per *call* (anyone could
  inflate any count). Now one `theme_installs` row per person; the creator's own
  installs don't count; existing counts kept as a baseline (`legacy_installs`).
* Categories (`dark`, `light`, `colorful`, …) with marketplace filtering.

App: **Theme Studio** (Settings → Appearance) — create; "My published themes" with
status, Edit (opens the live version or your draft), Save draft, Publish vN with a
changelog, version History with Restore, Unpublish / Publish again, Delete. Live
"Try it on Venband" preview that always restores your theme; undo/redo (a colour
drag is one step). Installed marketplace themes remember their source and version:
per-theme **Ask before updating / Update automatically / Keep my version**, an
update card with the changelog, a version list to switch versions (going back
pins "keep"), and auto-updates on sign-in. `sanitizeTheme` moved to the
dependency-free `src/lib/themeData.ts` so it's unit-tested.

Verification:
* `tests/db/theme_test.sql` (new, ~40 assertions, wired into `tests/db/run.sh`):
  drafts private; publish v1/v2; spam guard; non-owners can't save, publish,
  restore, change status, UPDATE the table or write versions/drafts; validation
  rejects unknown vars, `url()` colours, remote wallpapers/CSS, `@import`,
  `javascript:`; sanitizer output accepted; installs counted once per person,
  uninstall decrements, creator excluded; rollback; unpublish hides item and
  history; staff removal needs a reason, is logged, blocks the creator; restore;
  old-client inserts → validated v1. All pass with the full RLS suite.
* Backfill on a database that already had items (run twice): v1 created with
  original dates, install counts kept (7 → 8 after one new install).
* `tests/themes.test.ts`: sanitizer keeps source/version, rejects malformed ids,
  unknown vars and remote wallpapers.
* UI rendered on a temporary local page (removed afterwards): undo/redo incl. drag
  coalescing, live preview applies + restores, edit mode shows "Publish version 3",
  installed-theme update controls.

Not done in C: ratings/reviews and reporting themes (needs the reports system to
accept a new target type — planned with Phase F), creator profile pages.

## 11. Phase D — official notifications and security alerts (done 2026-11-06)

Migration `20261106010000_official_notifications.sql`:

* **`public.notifications`** — the notification center. Rows are created only by
  the database; the API can read your own and mark them read (`read_at` is the
  only writable column, via `mark_notifications_read`), never insert, edit or
  delete. Live updates via Realtime. Deleting the Venband DM doesn't remove them.
* **`notify()`** (internal, not API-callable): writes the notification, optionally
  the official DM; deduplicates per event; caps official DMs at 10/hour/person
  (notifications are always kept); actions are a fixed allow-list of in-app
  destinations — a notification can never carry its own link.
* **Real events**: new sign-in (`device_sessions` insert; the signup's first
  device excluded), device signed out (`revoke_device`), password changed/reset
  and email changed (`auth.users` trigger), two-factor on/off (`auth.mfa_factors`
  trigger), account limited/restricted/banned (`venband_notice`, now via
  `notify`), restrictions lifted (profile status trigger), marketplace item
  removed/restored, report reviewed (reporter told the outcome; the reported
  person is not told who reported). Auth-schema triggers are created only if the
  project allows them, and can never block a password/email change.
* **Official DMs no longer require a staff caller** (`official_dm`), so system
  events can send them.
* **Impersonation (fixed):** bots of the open "Venband" moderation-toolkit preset
  were shown with an **Official** tag and Venband's logo, and its default name was
  literally "Venband"; any bot/webhook could post as "Venband"/"Official".
  Now: only the system account may name an app "Venband"/"Official"; reserved
  display names from other bots are dropped; the app decides "official" from the
  app's **owner** (`isOfficialApp`), never a name or preset; toolkit bots get
  their own icon and a "Mod toolkit" label; default name "Mod Toolkit".

App: bell with unread count in the top bar; notification center (filters,
search, mark read / all read, details, safe action buttons, "Venband never asks
for your password" footer); **Settings → Security → Official notices** lists
every real security/account notice so a fake "official" message can be checked;
official DMs render with an OFFICIAL badge and accent.

Verification: `tests/db/notification_test.sql` (new, in `run.sh`) — sign-in alert
+ DM, no duplicate on re-register, none for the signup, sign-out alert, password /
email / 2FA alerts (critical + DM), a failing notification can't block a
password change, restriction + restoration notices with reasons, marketplace
removal, report outcome to the reporter only, users can't insert/edit/delete
notifications or call `notify`/`official_dm`, mark-all-read, reserved app names
rejected (toolkit preset still allowed), reserved display name dropped,
dedupe, DM cap, bad action ids rejected. All database suites pass together.
UI checked on a temporary local page (removed): badge count, read-on-open,
category filter, unknown action id not rendered, layout.

Limits: the auth-schema triggers are skipped (with a notice) if Supabase refuses
them on a project — then password/email/2FA alerts don't fire, the rest does.
Passkey add/remove alerts and "new login location" detection beyond the device's
self-reported location are not implemented. Appeals arrive with Phase F.

## 12. Phase E — badges (done 2026-11-06)

Migration `20261106020000_badge_catalog.sql`.

* **You choose what shows.** `profiles.badge_display` (NULL = show all) holds
  which of your badges show next to your name and in what order. It's set only
  through `set_badge_display`, which accepts only badges you hold (max 20,
  deduplicated). Nobody can award themselves a badge: `badges` is still changed
  only by staff. Settings → Profile → **Your badges**: reorder (keyboard-usable
  up/down buttons), hide/show, "Show all".
* **Staff badges can't be hidden** (founder, owner, admin, moderator, staff):
  they always show first, so people can always recognise real staff.
* **Catalog:** every badge now has a category (Venband team, community,
  developer, creator, supporter, achievement, event, seasonal, special), a
  rarity and a description (shown in tooltips and the picker).
* **New artwork:** built-in badges are drawn as medallions with a shape per
  category (shield = team, hexagon = achievement/event, circle =
  supporter/community, rounded square = developer/creator), a lit gradient, a
  white symbol that still reads at 15 px, and a rim for epic/legendary.
* **Limited editions:** custom badges can have an "awardable until" date and
  can be **retired**. Holders keep them; new awards are refused by the
  database, and the moderator award list shows them as "ended"/"retired".
  Badge Designer gained category, rarity, end date, Edit, and Retire/Unretire.
* **Award notification:** getting a badge sends a notification (Phase D
  center) pointing to the picker. Removing a badge also removes it from the
  holder's display list.
* Older databases: the app falls back to the old columns if the migration
  hasn't run yet (shows all badges, as before).

Verification: `tests/db/badge_test.sql` (new, in `run.sh`) — no self-awarding
(direct update, display list, mod RPC, designer), one notification per new
badge, display order kept + deduped + staff badges never stored, unheld and
>20 refused, removed badge leaves the display list, ended and retired badges
can't be awarded but stay with holders, category/rarity saved, reset to "show
all". All database suites, 31 unit tests and the production build pass. UI
checked on a temporary local page (removed): all 15 medallions at 40 px and
15 px, name row honours the chosen order and hides hidden badges, picker.

Limits: custom badges keep their uploaded picture (no medallion frame). Moderation
views still show every badge a person holds, on purpose.

## 13. Live fixes, drag & drop, cosmetics, translation (done 2026-11-06)

Reported from venband.com while the live database was still on the old schema:

* **`column themes.status does not exist`** — the app now falls back to the old
  query on an un-updated database, and any "column / function does not exist"
  error says a database update is needed instead of raw Postgres text.
* **"one of you has blocked the other" between friends** — `dm_blocked()` had its
  force-contact check inverted (`can_force_contact OR blocked`), so owners /
  admins / founders could send **no** DMs at all. Fixed in
  `20261106030000_fix_dm_blocked.sql` (+ `tests/db/dm_test.sql`). That bug also
  hid a second one, fixed in the same file: a server's owner kept every
  permission while the server was in review / closed / banned.
  Sending also refreshes keys and retries once when the database refuses a
  message (a key epoch that just changed), then names the real reason.
* **macOS dock crashed the app (React #310)** — a hook called inside a condition
  in `Shell`; and the dock's drop handler called a hook too (reorder never worked).
* **Long right-click menus** shrink (compact / dense) and scroll.
* **Drag & drop** (`src/lib/useDragSort.ts`): one pointer-based system for the
  server rail + folders, channels, whole categories, roles and the dock — mouse,
  touch long-press (HTML5 drag never worked in the Android / iOS apps) and
  Alt + arrow keys; floating preview, auto-scroll, Esc cancels.
* **Cosmetics** (`src/components/Cosmetics.tsx`): 13 illustrated animated
  nameplates, 13 rebuilt avatar frames (+ galaxy, storm, crystal; the sakura
  frame's garbled emoji is gone), 11 canvas profile effects. Badges simplified to
  flat tiles; new Venband Developer (always shown), Verified, Verified Bot
  Developer, Verified Server Owner, Contributor, Beta Tester (developer and the
  verified ones are admin-only). `20261106040000_cosmetics_badges.sql`.
* **Translation** — the app never sent the sign-in token, so the online
  translator always refused and messages fell back to a letter-by-letter
  "spelling" (gibberish). Now: provider chain that needs no keys (DeepL / Google
  Cloud if configured, then Google's free endpoint, then MyMemory), 130 languages,
  server-side language detection, code / links / mentions / emoji kept out, chat
  slang spelled out first. `tests/translateText.test.ts`.
* `supabase/update-2026-11.sql` is generated (and CI-checked) by
  `scripts/build-setup-sql.mjs`: every migration since 20261105000000 in one paste.

## 14. Phase F — staff permissions, appeals, audit search (done 2026-11-06)

`20261106050000_staff_permissions_appeals.sql`, `tests/db/staff_test.sql`.
Granular staff permissions (defaults = what each rank could do before; owners
narrow them per person; enforced by `staff_can()` in every moderation function).
Appeals for account restrictions, removed Marketplace items and disabled bots
(accept undoes it, deny needs a reply, one open appeal at a time, 7-day wait
after a denial). Reports for themes and bots; staff can disable / enable bots
(nothing could before). Audit-log search, action / date filters, paging.

## 15. Phase G — GIF maker (done 2026-11-06)

Pictures, animated GIFs (every frame via ImageDecoder) and videos (incl. WebM
without a stored length); trim, fps, speed, size, square crop, meme captions;
encoding in a Web Worker with progress and Cancel. Encoder rewritten for speed
(byte-identical output, ~2×). `tests/gifenc.test.ts`; checked in the browser
with a generated video and GIF (extract, encode, both cancel paths).

## 16. Phase H — Memories (done 2026-11-06)

`20261106060000_memories_archive.sql`, `tests/db/memories_test.sql`. Keep 30,
show 10 (archive the rest), optional expiry, audience (everyone / friends / only
me), reporting. **Privacy fix:** memory media was readable per folder, so anyone
who could see a profile could list archived / friends-only files; now only
media of memories the viewer may see is served.

## 17. Since Phase H (done 2026-11-06)

All verified on the local Supabase stack (`npm run dev:local`, seeded accounts)
and with `npm run test:db:local` (14 database suites) plus `npm test`.

* **Server templates** (`20261106110000`): share a server's layout as a link
  (`/template/CODE`), sync it, preview, gallery, "Start from" in Create a server.
* **Built-in commands**: `/avatar`, `/banner`, `/gif` (reply to an image),
  `/roll`, `/coin`, `/8ball`, `/choose`, `/shrug`, `/tableflip`, `/unflip`, `/me`,
  `/spoiler`. `@<user id>` turns into a mention.
* **GIF library** (`20261106090000`): Save as GIF / Download as GIF on images,
  favourites stored privately.
* **Sounds**: 17 synthesized sounds (calls, mute, deafen, screen share, pings,
  soundboard), all generated in code — no third-party audio.
* **Built-in bots** on App Discovery with their own art (`public/bots/`); the
  official bot uses the Venband logo and banner.
* **Playing on profiles** (desktop): game detection, live timer, recent
  activity, a privacy switch and "Clear my activity history".
* **Stackdown** (`20261106130000`): an original multiplayer falling-blocks game
  played together in a channel (gamepad button in the header).
* **Slowmode and reminders** (`20261106140000`): per-channel slowmode enforced
  by the database; "Remind me" on any message, shown in Saved Messages.
* **No browser pop-ups**: every alert / confirm / prompt is an in-app dialog.
* **The Shop** (`20261106150000`, `src/lib/shop.ts`): the Marketplace in your
  home sidebar now holds 400+ free items in 185 designs, sorted into tabs:
  * avatar decorations: animated SVG (`Decorations.tsx`);
  * profile effects: particle canvas (`shopEffects.ts`);
  * nameplates: CSS/SVG scenes (`ShopNameplates.tsx`);
  * themes and bundles;
  * Classics;
  * the community marketplace.

  "Get" adds an item to your collection (`cosmetic_inventory`, private). Your
  profile can only equip collected items; the originals and a starter set are
  free for everyone. Classics come only from public-domain sources (each item
  names its source), with no licensed characters.

Originality ("court free"): every name, picture, sound and game here is our
own. Nothing copies another product's trademarks, artwork, sounds or levels;
the falling-blocks game has its own name, colours, rules text and look.

## 18. Not done

* **Phase I (design pass of the signed-in app)**: the mobile fixes are done;
  a full visual pass at four sizes is still open.
* **Phase J (VDL migration)**: plan below, not started. It needs your
  decisions first.
* Larger ideas from the brief (Worlds, Friend Spaces, automation engine) were
  not started.

## 19. Phase J — VDL migration plan

**Where things stand.** Supabase is the real backend: 59 migrations, ~380
schema objects, row-level security on every table, private realtime channels,
storage buckets with policies, and 57 source files that call it directly. VDL
(`api/vdl.js`, `vdl/schema.sql`, `lib/vdl-sync.js`) is a small parallel layer:
Vercel Postgres, cookie JWTs, bcrypt, account sync from Supabase, and basic
users / servers / messages. Moving everything onto VDL as it is built today
would mean rewriting every query, every policy and realtime — months of work
with a high risk of security regressions.

**Decisions you need to make:**

**Rule: free services only.** Venband has no budget, so every option below
has to run on a free tier.

1. **Realtime host: decided 2026-11-06, stay on Supabase Realtime (free).**
   The free tier allows 200 people connected at once and 2 million messages a
   month, and it is what the app already uses. A VPS was considered and
   dropped because it costs money. The server built for it (below) stays in
   the repo, switched off. If Venband outgrows the free tier, the free next
   step is porting that server to Cloudflare Workers + Durable Objects (free
   plan, no card). Vercel
   functions can't hold WebSockets, so calls, typing, presence, Stackdown and
   live messages need a server that stays up.
   * (a) Keep Supabase Realtime for now (no work).
   * (b) Self-host one small VPS (about $5–10 a month) running a realtime
     server. This is the recommended choice.
   * (c) Use a paid managed service. Billed per message; content is already
     end-to-end encrypted, so the provider sees only metadata.
2. **Where Postgres lives.** The schema is plain Postgres. Its policies call
   `auth.uid()`, which reads the caller's JWT, so it runs unchanged on any
   Postgres (Neon / Vercel Postgres, a VPS) behind an API that sets those
   claims.
   * (a) Run PostgREST next to it: the client code stays almost the same.
   * (b) Rewrite queries into `/api/vdl` routes. That means 57 files, and the
     Hobby plan's 12-function limit.
   * Recommended: (a).
3. **Sign-in.** Venband sends Auth a key derived from the password (Argon2),
   never the password itself. Auth stores a bcrypt hash of that key, which VDL
   can verify directly. Exporting `auth.users` therefore moves every account
   with no password reset. Decide whether MFA (TOTP) moves too; it needs the
   factor secrets exported.
4. **Files.** Choose one: VBB (Postgres-backed, already built, fine for small
   files), an S3-compatible bucket such as Cloudflare R2 (cheap, no egress
   fees), or stay on Supabase Storage. The bucket policies become signed-URL
   checks in the API.

**Stages, each shippable and reversible:**

| Stage | Work | Done when |
|---|---|---|
| J1 Database copy | Restore a nightly `pg_dump` of Supabase into the new Postgres; add the `auth.uid()` shim; run `tests/db` there | All 14 suites pass on the new host |
| J2 Read path | PostgREST (or `/api/vdl`) in front of the copy; a flag sends reads there for staff accounts only | Staff use the app for a week on it with no regressions |
| J3 Auth | Import accounts (`lib/vdl-sync.js` already pulls them); VDL issues the JWTs that PostgREST checks | New sign-ins go to VDL; old sessions still work |
| J4 Realtime | Bring up the chosen realtime host; port `realtime_topic_allowed` into its auth hook | Calls, presence, typing and Stackdown work on it |

**J4, first part, built and parked (2026-11-06).** The server is
`realtime/server.mjs`; `deploy/realtime/` holds its Docker + Caddy files. It
is not deployed, because a VPS isn't free. Its logic is the part to reuse if
it moves to Cloudflare's free plan.

* **Topics it carries:** the live ones (`chan` typing, `scope` presence,
  `call` signalling, `act` games), and only when the site has
  `VITE_REALTIME_URL` set. The client side is `src/lib/realtime.ts`; unset
  means Supabase as before.
* **Security:** it holds no secrets. It checks users with `/auth/v1/user` and
  topics with `realtime_topic_allowed`, running as the user. The server sets
  the sender id itself, so typing can't be spoofed.
* **Tests:** `tests/realtime.test.ts`. It was also checked against the local
  Supabase stack with real accounts:
  * a non-member is refused;
  * a call topic on a text channel is refused;
  * typing and the Stackdown lobby work through the app.
* **Not yet tested:** a full voice call on it.
* **Left for later:** the database change feeds (`dbc` / `dbs` / `dbu`) stay
  on Supabase until the database moves (J1–J2). They need a LISTEN or
  logical-replication feed on the new Postgres.
| J5 Files | Copy buckets; signed-URL checks mirror the storage policies | Uploads and downloads served from the new store |
| J6 Cut-over | Make the new host primary; Supabase becomes a read-only backup for 30 days | Supabase can be turned off |
