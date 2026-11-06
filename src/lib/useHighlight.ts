// Load highlight.js only when code is actually shown. Until it arrives the code
// renders as escaped plain text, then re-renders coloured. One shared download.
import { useEffect, useMemo, useState } from 'react';
import { LANGUAGE_ALIASES } from './codeLanguages';

type Highlighter = typeof import('./highlight');
let loaded: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;

export function loadHighlighter(): Promise<Highlighter> {
  loading ??= import('./highlight').then((m) => (loaded = m));
  return loading;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function useHighlighter(): Highlighter | null {
  const [mod, setMod] = useState<Highlighter | null>(loaded);
  useEffect(() => {
    if (mod) return;
    let alive = true;
    loadHighlighter()
      .then((m) => alive && setMod(m))
      .catch(() => {}); // offline: stay plain text
    return () => {
      alive = false;
    };
  }, [mod]);
  return mod;
}

/** Highlighted HTML for a known language (escaped plain text until the highlighter loads). */
export function useHighlight(code: string, language: string): string {
  const hl = useHighlighter();
  return useMemo(() => (hl ? hl.highlight(code, language) : escapeHtml(code)), [hl, code, language]);
}

/** Like highlightAuto: uses the ``` hint if given, otherwise detects the language once loaded. */
export function useHighlightAuto(code: string, hint?: string): { html: string; language: string } {
  const hl = useHighlighter();
  return useMemo(() => {
    if (hl) return hl.highlightAuto(code, hint);
    const named = hint ? LANGUAGE_ALIASES[hint.toLowerCase()] ?? hint.toLowerCase() : 'plaintext';
    return { html: escapeHtml(code), language: named || 'plaintext' };
  }, [hl, code, hint]);
}
