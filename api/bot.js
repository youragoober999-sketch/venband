// Vercel Function: the Venband bot API.
//   POST /api/bot   Authorization: Bot vb_<app>_<secret>
//   body: {"action": "send", "channel": "...", "content": "..."}
// See venband.com/applications#api for every action.
import { json, preflight, readJson, rpc } from './_lib/rpc.js';

export function OPTIONS() {
  return preflight();
}

export function GET() {
  return json(405, { error: 'Use POST with {"action": "..."}. Docs: https://www.venband.com/applications#api' });
}

export async function POST(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bot\s+/i, '').trim();
  if (!token) return json(401, { error: 'missing "Authorization: Bot <token>" header' });
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json(400, { error: e.message });
  }
  const { action, ...args } = body;
  if (typeof action !== 'string') return json(400, { error: 'missing "action"' });
  const r = await rpc('bot_api', { p_token: token, p_action: action, p_args: args });
  return json(r.status, r.body);
}
