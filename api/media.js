// Vercel Function: serves link-preview pictures through Venband, so websites
// never learn the IP address of the people viewing a preview. Only URLs signed
// by /api/link-preview are accepted, and only images are passed through.
import { rateLimited, safeFetch, verifyMedia } from './_lib/net.js';

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const target = q.get('u') ?? '';
  if (!verifyMedia(target, q.get('s'))) return new Response('not allowed', { status: 403 });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'anon';
  if (rateLimited(`m:${ip}`, 300)) return new Response('slow down', { status: 429 });
  try {
    const { res, body } = await safeFetch(target, { maxBytes: 6_000_000, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !/^image\/(png|jpeg|gif|webp|avif)$/.test(type)) return new Response('not an image', { status: 415 });
    return new Response(body, {
      headers: {
        'content-type': type,
        'cache-control': 'public, max-age=86400, immutable',
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    });
  } catch {
    return new Response('could not load', { status: 502 });
  }
}
