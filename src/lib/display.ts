// Applies Settings → Accessibility / Streamer Mode / Advanced to the whole
// app through attributes on <html> (styles.css does the rest).
import type { Settings } from './settings';

export function applyDisplaySettings(s: Settings, sharingScreen = false) {
  const root = document.documentElement;
  const a = s.accessibility;
  const set = (name: string, on: boolean) => (on ? root.setAttribute(name, '') : root.removeAttribute(name));
  const scale = Math.max(70, Math.min(150, Number(a.uiScale) || 100));
  root.style.setProperty('zoom', scale === 100 ? '' : String(scale / 100));
  root.style.setProperty('--saturation', String(Math.max(0, Math.min(100, a.saturation ?? 100)) / 100));
  set('data-saturation', (a.saturation ?? 100) < 100);
  set('data-contrast', a.highContrast);
  set('data-underline-links', a.underlineLinks);
  set('data-readable', a.readableFont);
  set('data-focus-rings', a.focusRings);
  set('data-roomy', a.roomy);
  set('data-reduce-motion', s.chat.reduceMotion);
  const streaming = s.streamer.enabled || (s.streamer.autoOnShare && sharingScreen);
  set('data-streamer', streaming);
  set('data-streamer-invites', streaming && s.streamer.hideInvites);
  set('data-streamer-personal', streaming && s.streamer.hidePersonal);
  set('data-dev', s.advanced.developerMode);
}
