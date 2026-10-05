// Vercel Function: title / description / site name for a link, so a message's
// sender can attach a preview (which is then end-to-end encrypted with the
// message). People who receive the message never contact the website.
// Signed-in users only; private / local addresses are refused.
import { rateLimited, safeFetch, signMedia, userFromRequest } from './_lib/net.js';

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function meta(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decode(content);
  }
  return '';
}

export async function GET(request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: 'sign in first' }, { status: 401 });
  if (rateLimited(`lp:${user.id}`, 40)) return Response.json({ error: 'slow down' }, { status: 429 });
  const target = new URL(request.url).searchParams.get('url') ?? '';
  try {
    const { res, url, body } = await safeFetch(target, { maxBytes: 600_000, accept: 'text/html,application/xhtml+xml' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/html/i.test(type)) return Response.json({ url }, { headers: { 'cache-control': 'private, max-age=3600' } });
    const html = body.toString('utf8').slice(0, 300_000);
    const title = meta(html, ['og:title', 'twitter:title']) || decode(html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ?? '');
    const description = meta(html, ['og:description', 'twitter:description', 'description']);
    const siteName = meta(html, ['og:site_name', 'application-name']) || new URL(url).hostname.replace(/^www\./, '');
    const themeColor = meta(html, ['theme-color']);
    let image = meta(html, ['og:image', 'og:image:url', 'twitter:image']);
    if (image) {
      try {
        image = signMedia(new URL(image, url).toString()) ?? '';
      } catch {
        image = '';
      }
    }
    return Response.json(
      { url, title: title.slice(0, 200), description: description.slice(0, 400), siteName: siteName.slice(0, 80), image, themeColor: /^#[0-9a-f]{3,8}$/i.test(themeColor) ? themeColor : '' },
      { headers: { 'cache-control': 'private, max-age=3600' } },
    );
  } catch (e) {
    return Response.json({ error: String(e?.message ?? e).slice(0, 100) }, { status: 422 });
  }
}
