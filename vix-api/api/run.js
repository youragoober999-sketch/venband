// Serves every hosted API: https://<site>/v1/<username>/<api>/<route>
// (vercel.json rewrites /v1/* here). Runs on demand, so APIs are always on.
import { handleHosted } from './_lib/runtime.js'

export default function handler(req, res) {
  return handleHosted(req, res)
}
