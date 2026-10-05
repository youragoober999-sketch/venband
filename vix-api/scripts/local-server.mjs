// Runs Vix Api locally without the Vercel CLI: serves the built site from dist/
// and routes /api/* and /v1/* to the serverless functions, the same way
// vercel.json does in production.
//
//   npm run build && npm run serve      (reads .env.local / .env)
//
// POSTGREST_URL is only for testing against a plain PostgREST server: requests
// to /rest/v1/* are forwarded there, so SUPABASE_URL can point at this server.
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const name of ['.env.local', '.env']) {
  const file = path.join(root, name)
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

const port = Number(process.env.PORT || 3000)
const { default: router } = await import('../api/router.js')
const { default: run } = await import('../api/run.js')
const { default: cron } = await import('../api/cron.js')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.txt': 'text/plain' }

async function serveStatic(req, res, pathname) {
  const dist = path.join(root, 'dist')
  let file = path.join(dist, decodeURIComponent(pathname))
  if (!file.startsWith(dist)) file = path.join(dist, 'index.html')
  try {
    const s = await stat(file)
    if (s.isDirectory()) file = path.join(file, 'index.html')
  } catch {
    file = path.join(dist, 'index.html')
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('Run `npm run build` first.')
  }
}

function proxy(req, res, target) {
  const url = new URL(target)
  const p = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method, headers: { ...req.headers, host: url.host } }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers)
    r.pipe(res)
  })
  p.on('error', (e) => {
    res.writeHead(502)
    res.end(String(e))
  })
  req.pipe(p)
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  try {
    if (process.env.POSTGREST_URL && url.pathname.startsWith('/rest/v1/')) {
      return proxy(req, res, process.env.POSTGREST_URL.replace(/\/$/, '') + url.pathname.slice('/rest/v1'.length) + url.search)
    }
    if (url.pathname.startsWith('/v1/')) {
      url.searchParams.set('__path', url.pathname.slice(4))
      req.url = `/api/run?${url.searchParams}`
      return await run(req, res)
    }
    if (url.pathname === '/api/cron') return await cron(req, res)
    if (url.pathname.startsWith('/api/')) {
      url.searchParams.set('__path', url.pathname.slice(5))
      req.url = `/api/router?${url.searchParams}`
      return await router(req, res)
    }
    return await serveStatic(req, res, url.pathname)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) res.writeHead(500)
    res.end('internal error')
  }
}).listen(port, () => console.log(`Vix Api running at http://localhost:${port}`))
