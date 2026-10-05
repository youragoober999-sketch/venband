// Vercel Function: "Connect a site" webhooks.
//   POST /api/hooks?id=<hook id>&token=<secret>
//   body: {"content": "text", "username": "optional name", "embed": {...}}
// Also accepts Discord-style {"embeds": [{...}]} (the first embed is used).
import { json, preflight, readJson, rpc } from './_lib/rpc.js';

export function OPTIONS() {
  return preflight();
}

export function GET() {
  return json(405, { error: 'Send a POST request with {"content": "..."}' });
}

export async function POST(request) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '';
  const token = u.searchParams.get('token') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return json(401, { error: 'unknown webhook' });
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json(400, { error: e.message });
  }
  const embed = body.embed ?? (Array.isArray(body.embeds) ? body.embeds[0] : null) ?? null;
  const r = await rpc('post_webhook', {
    p_hook: id,
    p_secret: token,
    p_content: typeof body.content === 'string' ? body.content : '',
    p_username: typeof body.username === 'string' ? body.username : null,
    p_embed: embed && typeof embed === 'object' ? embed : null,
  });
  return json(r.status, r.status === 200 ? { id: r.body } : r.body);
}
