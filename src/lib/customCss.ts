// Custom CSS: your own styles for the app, on your devices only.
// It's cleaned before use: no @import, no outside url()s (they would tell
// other websites your IP address), no script-like tricks. Safe mode
// (?safe=1, or Ctrl+Shift+Alt+S) turns it off if a style breaks the app.
export const CSS_LIMIT = 16_000;

export function sanitizeCss(css: string): string {
  let out = css.slice(0, CSS_LIMIT);
  out = out.replace(/<\/?\s*style/gi, '');
  out = out.replace(/@import[^;]*;?/gi, '/* @import removed */');
  out = out.replace(/@charset[^;]*;?/gi, '');
  out = out.replace(/expression\s*\(/gi, 'removed(');
  out = out.replace(/behavior\s*:/gi, 'removed:');
  out = out.replace(/-moz-binding/gi, 'removed');
  out = out.replace(/javascript\s*:/gi, 'removed:');
  // only pictures embedded in the CSS itself may be used
  out = out.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, u: string) => (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u.trim()) ? m : 'none'));
  out = out.replace(/image-set\(/gi, 'removed(');
  return out;
}

const SAFE_KEY = 'venband:safe-mode';
export function safeMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('safe')) sessionStorage.setItem(SAFE_KEY, '1');
    return sessionStorage.getItem(SAFE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setSafeMode(on: boolean) {
  try {
    if (on) sessionStorage.setItem(SAFE_KEY, '1');
    else sessionStorage.removeItem(SAFE_KEY);
  } catch {
    /* ignore */
  }
}

export function applyCustomCss(enabled: boolean, code: string) {
  let el = document.getElementById('venband-custom-css') as HTMLStyleElement | null;
  if (!enabled || !code.trim() || safeMode()) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'venband-custom-css';
    document.head.appendChild(el);
  }
  el.textContent = sanitizeCss(code);
}

export const CSS_TEMPLATES: { id: string; name: string; desc: string; css: string }[] = [
  {
    id: 'compact',
    name: 'Extra compact',
    desc: 'Smaller gaps between messages so more fit on screen.',
    css: `.message { padding-top: 1px; padding-bottom: 1px; }\n.message-meta { margin-bottom: 0; }\n.channel { min-height: 28px; }`,
  },
  {
    id: 'bubbles',
    name: 'Chat bubbles',
    desc: 'Messages sit in rounded bubbles.',
    css: `.message-text {\n  background: var(--bg-3);\n  padding: 6px 12px;\n  border-radius: 16px;\n  display: inline-block;\n  max-width: 80%;\n}`,
  },
  {
    id: 'neon',
    name: 'Neon accents',
    desc: 'Glowing accent colour on buttons and the active channel.',
    css: `:root { --accent: #00e5ff; }\n.btn.primary, .channel.active { box-shadow: 0 0 12px #00e5ff88; }`,
  },
  {
    id: 'rounded',
    name: 'Extra round',
    desc: 'Rounder corners everywhere.',
    css: `.modal, .composer, .channel, .btn, .member, .embed-card { border-radius: 18px !important; }`,
  },
  {
    id: 'no-avatars',
    name: 'Hide avatars in chat',
    desc: 'Text-only messages, like old-school IRC.',
    css: `.message > .avatar { display: none; }\n.message { padding-left: 16px; }`,
  },
  {
    id: 'big-text',
    name: 'Bigger messages',
    desc: 'Larger text for messages only.',
    css: `.message-text { font-size: 17px; line-height: 1.5; }`,
  },
];
