const g = globalThis as unknown as {
  __SMART_TRANSLATE_URL__?: string;
};

export interface SmartTranslateOptions {
  from: string;
  target: string;
}

function endpoint(): string {
  const configured = g.__SMART_TRANSLATE_URL__;
  if (configured) return configured;

  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return env?.VITE_SMART_TRANSLATE_URL || '/api/translate';
  } catch {
    return '/api/translate';
  }
}

function cleanOutput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  if (!out || out.length > 100000) return null;
  return out;
}

export async function smartTranslate(text: string, options: SmartTranslateOptions): Promise<string | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
      body: JSON.stringify({
        text,
        sourceLanguage: options.from,
        targetLanguage: options.target,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      translation?: unknown;
      translatedText?: unknown;
      text?: unknown;
    };

    return cleanOutput(data.translation ?? data.translatedText ?? data.text);
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
