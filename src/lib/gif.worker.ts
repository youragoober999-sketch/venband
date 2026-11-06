// Encodes a GIF off the main thread so the app stays responsive; reports progress.
import { encodeGif, type GifFrame } from './gifenc';

const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

interface Job {
  width: number;
  height: number;
  frames: GifFrame[];
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { width, height, frames } = e.data;
  try {
    const blob = encodeGif(width, height, frames, true, (p) => post({ type: 'progress', p }));
    post({ type: 'done', blob });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
