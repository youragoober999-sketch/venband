// Your GIF library: save a GIF (or a picture, turned into a GIF) so it shows in
// your GIF favourites everywhere. Stored in the `gifs` bucket under
// <your id>/<random>.gif (20261106090000_gif_library.sql).
import { supabase } from './supabase';
import { sessionStore } from './session';
import { getSettings, updateSettings, type GifFavorite } from './settings';
import { imagesToGif } from './gifenc';

async function size(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const b = await createImageBitmap(blob);
    const out = { width: b.width, height: b.height };
    b.close();
    return out;
  } catch {
    return { width: 1, height: 1 };
  }
}

/** A GIF stays as it is; any other picture becomes a (still) GIF. */
export async function toGif(blob: Blob, name = 'venband'): Promise<File> {
  if (blob.type === 'image/gif') return new File([blob], `${name}.gif`, { type: 'image/gif' });
  return imagesToGif([new File([blob], name, { type: blob.type || 'image/png' })], { maxSize: 480 });
}

/** Upload to your library and add to your GIF favourites. */
export async function saveToMyGifs(blob: Blob, name = 'venband'): Promise<GifFavorite> {
  const uid = sessionStore.get().session?.user.id;
  if (!uid) throw new Error('Sign in first.');
  const gif = await toGif(blob, name);
  const path = `${uid}/${crypto.randomUUID()}.gif`;
  const { error } = await supabase.storage.from('gifs').upload(path, gif, { contentType: 'image/gif' });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error('Saving GIFs needs the newest database update (supabase/update-2026-11.sql).');
    throw error;
  }
  const url = supabase.storage.from('gifs').getPublicUrl(path).data.publicUrl;
  const fav: GifFavorite = { id: path, url, preview: url, ...(await size(gif)) };
  if (!getSettings().gifFavorites.some((f) => f.url === url)) updateSettings((s) => ({ gifFavorites: [fav, ...s.gifFavorites].slice(0, 200) }));
  return fav;
}
