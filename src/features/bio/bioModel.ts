import { supabase, supabaseUrl } from '../../lib/supabase';

export const BIO_TEMPLATES = [
  ['midnight', 'Midnight', 'Dark', '#090a11', '#27263a', '#a99bfa', '#f3f0ff', 'stars'],
  ['city', 'City After Hours', 'Dark', '#070a0d', '#283544', '#a2d1ff', '#eff5ff', 'grid'],
  ['chrome', 'Liquid Chrome', 'Dark', '#121215', '#494854', '#dedbe9', '#f6f3ff', 'rays'],
  ['ink', 'Black Ink', 'Dark', '#070707', '#222226', '#d5d5d8', '#ffffff', 'none'],
  ['sakura', 'Sakura', 'Soft', '#28152b', '#63354d', '#ffabd0', '#fff2fa', 'rays'],
  ['heart', 'Love Letter', 'Soft', '#3c0f20', '#66223b', '#ff94ad', '#fff0f5', 'stars'],
  ['dawn', 'Peach Dawn', 'Soft', '#412428', '#76464d', '#ffd1ac', '#fff4eb', 'rays'],
  ['lavender', 'Lavender Haze', 'Soft', '#231d42', '#594875', '#d5bcff', '#f9efff', 'stars'],
  ['arctic', 'Arctic Glass', 'Minimal', '#0e2837', '#25516a', '#95e5ff', '#ecfcff', 'rays'],
  ['paper', 'Paper & Ink', 'Minimal', '#ede4d4', '#fff5e8', '#815637', '#30261e', 'none'],
  ['museum', 'Gallery White', 'Minimal', '#dde6e9', '#f2f7f8', '#315366', '#172c35', 'grid'],
  ['espresso', 'Espresso', 'Minimal', '#201811', '#3d2b1e', '#e8b88a', '#fff2e3', 'none'],
  ['arcade', 'Arcade Glow', 'Retro', '#190c2e', '#32185b', '#ff88e5', '#fff1fc', 'grid'],
  ['terminal', 'Green Screen', 'Retro', '#071911', '#142e20', '#8df2a8', '#d8ffe4', 'grid'],
  ['sunset', 'VHS Sunset', 'Retro', '#2d1536', '#56274a', '#ffb174', '#fff0f0', 'grid'],
  ['cobalt', 'Cobalt Signal', 'Retro', '#12173d', '#283973', '#95baff', '#eff4ff', 'rays'],
  ['nebula', 'Violet Nebula', 'Atmospheric', '#180e36', '#3f2370', '#c9a7ff', '#fbf2ff', 'stars'],
  ['reef', 'Deep Reef', 'Atmospheric', '#05262c', '#14515b', '#72f4d3', '#ebfffc', 'rays'],
  ['forest', 'Forest Floor', 'Atmospheric', '#152217', '#344631', '#c8df9c', '#f3f9e8', 'rays'],
  ['ember', 'Ember', 'Atmospheric', '#30140c', '#602619', '#ffc080', '#fff1e1', 'stars'],
] as const;

export type BioLink = { label: string; url: string };
export type BioPage = {
  title: string; bio: string; location: string; template: string;
  background: string; panel: string; accent: string; text: string;
  opacity: number; blur: number; layout: 'center' | 'split' | 'stack';
  effect: 'none' | 'stars' | 'grid' | 'rays'; glow: boolean; showConnections: boolean;
  backgroundAsset: string; avatarAsset: string; audioAsset: string; cursorAsset: string;
  links: BioLink[];
};
export const BIO_DEFAULT: BioPage = {
  title: '', bio: '', location: '', template: 'midnight', background: '#090a11', panel: '#27263a',
  accent: '#a99bfa', text: '#f3f0ff', opacity: 88, blur: 12, layout: 'center', effect: 'stars',
  glow: false, showConnections: false, backgroundAsset: '', avatarAsset: '', audioAsset: '', cursorAsset: '', links: [],
};
const color = (v: unknown, fallback: string) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
const string = (v: unknown, limit: number) => typeof v === 'string' ? v.slice(0, limit) : '';
const range = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function bioLink(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

const assetPattern = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(webp|png|jpeg|mp3|ogg)$/;
const asset = (value: unknown, kind: 'image' | 'audio') =>
  typeof value === 'string' && assetPattern.test(value) && (kind === 'audio' ? /\.(mp3|ogg)$/.test(value) : /\.(webp|png|jpeg)$/.test(value)) ? value : '';
export function bioAssetUrl(path: string) {
  return assetPattern.test(path) ? `${supabaseUrl}/storage/v1/object/public/bio-assets/${path}` : undefined;
}

export function normalizeBio(input: unknown): BioPage {
  const v = input && typeof input === 'object' ? input as Partial<BioPage> : {};
  return {
    title: string(v.title, 80), bio: string(v.bio, 1200), location: string(v.location, 80),
    template: BIO_TEMPLATES.some(([id]) => id === v.template) ? v.template! : BIO_DEFAULT.template,
    background: color(v.background, BIO_DEFAULT.background), panel: color(v.panel, BIO_DEFAULT.panel),
    accent: color(v.accent, BIO_DEFAULT.accent), text: color(v.text, BIO_DEFAULT.text),
    opacity: range(v.opacity, 88, 45, 100), blur: range(v.blur, 12, 0, 24),
    layout: v.layout === 'split' || v.layout === 'stack' ? v.layout : 'center',
    effect: v.effect === 'none' || v.effect === 'grid' || v.effect === 'rays' ? v.effect : 'stars',
    glow: v.glow === true, showConnections: v.showConnections === true,
    backgroundAsset: asset(v.backgroundAsset, 'image'), avatarAsset: asset(v.avatarAsset, 'image'),
    audioAsset: asset(v.audioAsset, 'audio'), cursorAsset: asset(v.cursorAsset, 'image'),
    links: Array.isArray(v.links) ? v.links.slice(0, 10).flatMap((item) => {
      const label = string(item?.label, 45).trim();
      const url = bioLink(string(item?.url, 600));
      return label && url ? [{ label, url }] : [];
    }) : [],
  };
}

const IMAGE_TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpeg' };
const AUDIO_TYPES: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' };
export async function uploadBioAsset(userId: string, file: File, kind: 'image' | 'audio' | 'cursor') {
  const ext = (kind === 'audio' ? AUDIO_TYPES : IMAGE_TYPES)[file.type];
  const limit = kind === 'cursor' ? 128 * 1024 : 8 * 1024 * 1024;
  if (!ext || file.size > limit) throw new Error(kind === 'cursor' ? 'Choose a PNG, JPEG or WebP under 128 KB.' :
    kind === 'audio' ? 'Choose an MP3 or Ogg file under 8 MB.' : 'Choose a PNG, JPEG or WebP under 8 MB.');
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('bio-assets').upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}
