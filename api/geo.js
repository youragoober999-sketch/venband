// Vercel Function: tells the app roughly where the current device is (city /
// state / country), from Vercel's own IP geolocation headers. Used only for
// the "Devices" list in settings. Nothing is logged or stored here.
export function GET(request) {
  const h = request.headers;
  const dec = (v) => {
    try {
      return decodeURIComponent(v || '').slice(0, 80);
    } catch {
      return '';
    }
  };
  return Response.json(
    {
      city: dec(h.get('x-vercel-ip-city')),
      region: dec(h.get('x-vercel-ip-country-region')),
      country: dec(h.get('x-vercel-ip-country')),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
