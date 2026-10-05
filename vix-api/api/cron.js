// Daily housekeeping + Scheduled Jobs. Vercel Cron calls this with
// "Authorization: Bearer $CRON_SECRET". You can also point a free external cron
// service (cron-job.org, GitHub Actions, ...) at /api/cron?secret=$CRON_SECRET
// to run scheduled jobs as often as every minute.
import { timingSafeEqual } from 'node:crypto'
import { db } from './_lib/db.js'
import { runScheduled } from './_lib/runtime.js'
import { send, sendError } from './_lib/http.js'

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export default async function handler(req, res) {
  try {
    const secret = process.env.CRON_SECRET
    const url = new URL(req.url, 'http://local')
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || ''
    if (!secret || !same(given, secret)) return send(res, 401, { error: 'Set CRON_SECRET in Vercel and send it as a Bearer token' })
    await db().rpc('vix_cleanup')
    const jobs = await runScheduled()
    send(res, 200, { ok: true, jobs })
  } catch (err) {
    sendError(res, err)
  }
}
