// Project export/import as .zip (Saving feature).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { VFile } from './api'

export function filesToZip(files: VFile[], meta?: Record<string, unknown>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    if (f.is_folder) entries[f.path.replace(/\/?$/, '/')] = new Uint8Array()
    else entries[f.path] = strToU8(f.content)
  }
  if (meta) entries['.vix/project.json'] = strToU8(JSON.stringify(meta, null, 2))
  return zipSync(entries, { level: 6 })
}

export function zipToFiles(data: Uint8Array): { files: VFile[]; meta: any } {
  const out = unzipSync(data)
  const files: VFile[] = []
  let meta: any = null
  const names = Object.keys(out)
  // Strip a single shared top-level folder (common for downloaded repos).
  const tops = new Set(names.map((n) => n.split('/')[0]))
  const strip = tops.size === 1 && names.every((n) => n.includes('/')) ? [...tops][0] + '/' : ''
  for (const raw of names) {
    const name = raw.slice(strip.length)
    if (!name || name.startsWith('__MACOSX') || name.endsWith('.DS_Store')) continue
    if (name === '.vix/project.json') {
      try { meta = JSON.parse(strFromU8(out[raw])) } catch { /* ignore */ }
      continue
    }
    if (name.endsWith('/')) {
      files.push({ path: name.slice(0, -1), is_folder: true, content: '' })
      continue
    }
    const bytes = out[raw]
    if (bytes.length > 1_000_000) continue
    if (bytes.slice(0, 8000).includes(0)) continue // skip binary files
    files.push({ path: name, is_folder: false, content: strFromU8(bytes) })
  }
  return { files, meta }
}
