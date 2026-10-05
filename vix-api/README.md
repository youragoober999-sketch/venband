# Vix Api

Build APIs in any language, test them in a built-in sandbox, and keep them online 24/7.

- **Username + password accounts.** No email. Everything you make is saved to your account.
- **50+ languages and file types:** JavaScript, TypeScript, Python, Rust, Batch (`.bat`/`.cmd`), Java, C#, C/C++, Go, Lua, Ruby, PHP, Bash, Kotlin, Swift, Dart, Haskell, Elixir, SQL, and more. JSON, HTML, CSV, YAML and text files can be served as static responses.
- **Files and folders** with drag-and-drop upload, rename/move, duplicate, and `.zip` import/export.
- **Built-in sandbox:** run any file with stdin and arguments, or send it a fake HTTP request. HTML and Markdown files get a live preview.
- **Always-on hosted endpoints** at `https://<your-site>/v1/<username>/<api>/<route>`. They run on Vercel serverless functions, so they answer even when nobody has the site open.
- **API keys:** create, name, scope to one API, set expiry, roll, and revoke.
- **Friends and sharing:** add friends by username, then share an API with them as an editor or a viewer.
- **Saving:** auto-save, Ctrl+S, conflict detection when two people edit the same file, version snapshots with one-click restore, and a full data export.
- **Extensions.** Per API: CORS, rate limiter, response cache, key-value store, request logger, secrets, IP allowlist, maintenance mode, pretty JSON, webhook relay (Discord/Slack), scheduled jobs, and OpenAPI + MCP for AI tools. Per user: Vim keys, word wrap, auto-save, format on save, rainbow brackets, line highlight, live preview, read output aloud, snippets, zen mode, typing sounds, and confetti.
- **Integration guides** with your real URLs filled in: ChatGPT Actions, Claude (MCP and tool use), OpenAI, LangChain, Discord bots, Unity, Unreal, Godot, Roblox, GameMaker, Phaser/web, Bevy, LÖVE/Defold/Solar2D, Cocos/Construct, RPG Maker, Minecraft, MonoGame/Stride, Pygame/Ren'Py, plus curl, Python, Rust, C#, Java, Go, PHP, Swift, Dart, Ruby, Zapier/Make/n8n, Postman, and Google Sheets/Excel.
- **Accessibility:**
  - Full keyboard control, with a command palette (Ctrl+K) and a shortcut list (?).
  - Screen reader announcements, a skip link, and ARIA tree/tab/dialog patterns.
  - 9 themes, including two high-contrast themes.
  - Text size, line spacing and letter spacing controls.
  - Atkinson Hyperlegible and OpenDyslexic fonts.
  - Reduced motion, color-vision palettes, larger touch targets, a bold focus ring, sound cues, and text-to-speech.
  - 12 interface languages, including right-to-left Arabic.
  - Every page and theme passes an automated axe-core WCAG 2.1 AA audit.

## How it works

```
Browser (React + CodeMirror)  ──/api/*──▶  api/router.js  ──▶ Supabase Postgres
Games, apps, AI agents        ──/v1/*───▶  api/run.js     ──▶ (secret key, server only)
                                              │
                                              ├─ JavaScript → QuickJS WebAssembly sandbox (in-process, 10 s / 64 MB limit)
                                              ├─ Batch      → built-in .bat interpreter (shared/batch.js)
                                              └─ Others     → Wandbox (free, default) or your own Piston server
```

The database is locked down. Every table has Row Level Security enabled with no policies, and the public and authenticated roles have no grants. Only the serverless functions can read or write data, because they hold the **secret** key. The publishable (anon) key is not used at all.

## Deploy to Vercel (about 5 minutes)

1. **Create the database tables.** In Supabase, open **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql), and press **Run**.
2. **Import the repo in Vercel.** Go to **Add New → Project**, pick this repository, and set **Root Directory** to `vix-api`. The framework is detected as Vite.
3. **Add environment variables** in **Settings → Environment Variables**:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Supabase → Project Settings → API → Project URL (`https://xxxx.supabase.co`) |
   | `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **Secret key** (`sb_secret_…`) |
   | `CRON_SECRET` | Any long random string. It protects `/api/cron`. |
   | `PISTON_URL` *(optional)* | Your own [Piston](https://github.com/engineer-man/piston) server, used instead of Wandbox for non-JS languages |

4. **Deploy.** Open the site, create an account, and make your first API.

> Never put the secret key in a `VITE_` variable or commit it. The secret key goes only in Vercel's environment variables.

### Scheduled jobs

`vercel.json` runs `/api/cron` once a day. That is the most often a Vercel Hobby plan allows. The cron job cleans up old logs and runs the **Scheduled Jobs** extension.

For jobs every minute or every hour, you have two options:
- On Vercel Pro, change `crons[0].schedule` in `vercel.json`.
- Point a free service such as cron-job.org at `https://<site>/api/cron?secret=<CRON_SECRET>`.

## Run locally

```bash
cd vix-api
npm install
cp .env.example .env.local   # fill in SUPABASE_URL and SUPABASE_SECRET_KEY
npm run build
npm run serve                # http://localhost:3000, serves the site and the functions
```

For frontend hot reload, run `npm run dev` while `npm run serve` is running. Vite forwards `/api` and `/v1` to port 3000.

## Tests

```bash
npm run typecheck
npm test          # batch interpreter, QuickJS sandbox, routing, auth, SSRF guard
```

## Writing endpoints

**JavaScript** is the fastest runtime. It gives you a persistent KV store, `fetch`, and secrets:

```js
async function handler(req, ctx) {
  // req: { method, path, query, headers, body, params, ip }
  const visits = await vix.kv.increment('visits')
  return { status: 200, body: { hello: req.query.name ?? 'world', visits } }
}
```

**Any other language** reads the request as JSON on stdin. It prints either `{"status", "headers", "body"}` or plain text:

```python
import json, sys
req = json.loads(sys.stdin.read() or "{}")
print(json.dumps({"status": 200, "body": {"you_sent": req.get("body")}}))
```

**Batch** sees the request as environment variables: `%VIX_METHOD%`, `%VIX_BODY%`, `%QUERY_name%`, `%PARAM_id%`, `%HEADER_USER_AGENT%`.

Every API also has three built-in URLs:
- `/` lists its endpoints.
- `/openapi.json` is an OpenAPI 3.1 spec, for ChatGPT Actions, Postman and LangChain.
- `/mcp` is a Model Context Protocol server, for Claude, Cursor and other agents.
