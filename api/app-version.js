// Returns the latest app version info for auto-update checks (web + mobile + desktop).
export function GET() {
  const body = {
    web: { version: '1.0.3', url: 'https://www.venband.com/' },
    android: { version: '1.0.3', apk: 'Venband-1.0.3-debug.apk', url: 'https://www.venband.com/download/Venband-1.0.3-debug.apk' },
    desktop: { version: '1.0.3', url: 'https://github.com/youragoober999-sketch/venband/releases/latest' },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}