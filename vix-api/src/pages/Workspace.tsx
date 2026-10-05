import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A, Badge, Button, ErrorBox, Field, Icon, IconButton, Loading, Menu, Modal, Tabs, ask } from '../components/ui'
import { CodeEditor } from '../components/CodeEditor'
import { FileIcon, FileTree } from '../components/FileTree'
import { Sandbox, type SandboxHandle } from '../components/Sandbox'
import { ApiExtensionsPanel, ApiSettingsPanel, DataPanel, EndpointsPanel, IntegratePanel, LogsPanel, SharingPanel, TestPanel, VersionsPanel } from '../components/Panels'
import { registerCommands } from '../components/CommandPalette'
import { api, ApiError, apiBaseUrl, type Api, type Endpoint, type Member, type User, type VFile } from '../lib/api'
import { t } from '../lib/i18n'
import { navigate } from '../lib/router'
import { useApp } from '../lib/store'
import { confetti, cx, downloadBlob } from '../lib/util'
import { filesToZip, zipToFiles } from '../lib/zip'
import { LANGUAGES, defaultFileName, languageById, languageForPath } from '../../shared/languages.js'

type Detail = { api: Api; owner: User; files: VFile[]; endpoints: Endpoint[]; members: Member[] }
type FileState = VFile & { saved: string; base_updated_at?: string }

const TABS = ['code', 'endpoints', 'test', 'integrate', 'extensions', 'sharing', 'logs', 'data', 'versions', 'settings'] as const
type Tab = (typeof TABS)[number]
const TAB_ICONS: Record<Tab, string> = { code: 'terminal', endpoints: 'link', test: 'send', integrate: 'gamepad', extensions: 'puzzle', sharing: 'users', logs: 'activity', data: 'database', versions: 'history', settings: 'settings' }

export function Workspace({ id, tab: tabParam }: { id: string; tab?: string }) {
  const { settings, toast, announce, updateSettings, setExtension } = useApp()
  const tab: Tab = (TABS as readonly string[]).includes(tabParam || '') ? (tabParam as Tab) : 'code'
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [files, setFiles] = useState<Map<string, FileState>>(new Map())
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [newFile, setNewFile] = useState<{ folder: string; kind: 'file' | 'folder' } | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [conflict, setConflict] = useState<{ path: string; latest: string; updated_at: string } | null>(null)
  const [sidebar, setSidebar] = useState(true)
  const sandboxRef = useRef<SandboxHandle>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const autosaveTimer = useRef<number>(undefined)
  const filesRef = useRef(files)
  filesRef.current = files
  const storageKey = `vix:ws:${id}`

  const load = useCallback(async (keepOpen = true) => {
    try {
      const d = await api.get<Detail>(`/apis/${id}`)
      setDetail(d)
      setFiles((prev) => {
        const next = new Map<string, FileState>()
        for (const f of d.files) {
          const old = prev.get(f.path)
          // Keep unsaved edits when reloading.
          if (keepOpen && old && old.content !== old.saved) next.set(f.path, { ...f, content: old.content, saved: f.content, base_updated_at: f.updated_at })
          else next.set(f.path, { ...f, saved: f.content, base_updated_at: f.updated_at })
        }
        return next
      })
      setError(null)
      return d
    } catch (e) {
      setError(e)
      return null
    }
  }, [id])

  // Initial load + restore open tabs.
  useEffect(() => {
    let alive = true
    load(false).then((d) => {
      if (!alive || !d) return
      let saved: { tabs?: string[]; active?: string } = {}
      try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { /* ignore */ }
      const exists = (p: string) => d.files.some((f) => f.path === p && !f.is_folder)
      const tabs = (saved.tabs || []).filter(exists)
      const first = d.endpoints[0]?.file_path && exists(d.endpoints[0].file_path) ? d.endpoints[0].file_path : d.files.find((f) => !f.is_folder)?.path
      const act = saved.active && exists(saved.active) ? saved.active : tabs[0] || first || null
      setOpenTabs(tabs.length ? tabs : act ? [act] : [])
      setActive(act)
    })
    return () => { alive = false }
  }, [load, storageKey])

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ tabs: openTabs, active })) } catch { /* ignore */ }
  }, [openTabs, active, storageKey])

  const role = detail?.api.role
  const canEdit = role === 'owner' || role === 'editor'
  const isOwner = role === 'owner'
  const dirty = useMemo(() => new Set([...files.values()].filter((f) => !f.is_folder && f.content !== f.saved).map((f) => f.path)), [files])
  const fileList = useMemo(() => [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), [files])
  const endpointFiles = useMemo(() => new Set(detail?.endpoints.map((e) => e.file_path) || []), [detail])
  const current = active ? files.get(active) : undefined

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirty.size) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [dirty])

  const openFile = useCallback((path: string) => {
    setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]))
    setActive(path)
    if (tab !== 'code') navigate(`/p/${id}`)
  }, [id, tab])

  const closeTab = async (path: string) => {
    const f = filesRef.current.get(path)
    if (f && f.content !== f.saved) {
      const ok = await ask({ title: `Close ${path.split('/').pop()} without saving?`, body: 'Your unsaved changes will be lost. They are also kept until you reload, so you can save first.', confirm: 'Close anyway', danger: true })
      if (!ok) return
      setFiles((m) => { const n = new Map(m); n.set(path, { ...f, content: f.saved }); return n })
    }
    setOpenTabs((tabs) => {
      const i = tabs.indexOf(path)
      const next = tabs.filter((p) => p !== path)
      if (active === path) setActive(next[Math.min(i, next.length - 1)] || null)
      return next
    })
  }

  const formatContent = (path: string, content: string) => {
    if (!settings.extensions['format-on-save']) return content
    let out = content.replace(/[ \t]+$/gm, '')
    if (languageForPath(path).id === 'json') {
      try { out = JSON.stringify(JSON.parse(out), null, settings.tabSize) + '\n' } catch { /* invalid JSON: leave as is */ }
    }
    if (!out.endsWith('\n')) out += '\n'
    return out
  }

  const saveFile = useCallback(async (path: string, opts: { force?: boolean; quiet?: boolean } = {}) => {
    const f = filesRef.current.get(path)
    if (!f || f.is_folder || !canEdit) return false
    const content = formatContent(path, f.content)
    if (content === f.saved && !opts.force) return true
    setSaving((s) => new Set(s).add(path))
    try {
      const r = await api.put<{ file: VFile }>(`/apis/${id}/files`, { path, content, base_updated_at: f.base_updated_at, force: opts.force })
      setFiles((m) => {
        const n = new Map(m)
        const cur = n.get(path)
        // Keep typing that happened while the request was in flight.
        n.set(path, { ...r.file, content: cur && cur.content !== f.content ? cur.content : content, saved: content, base_updated_at: r.file.updated_at })
        return n
      })
      if (!opts.quiet) {
        announce(`${path} ${t('ws.saved').toLowerCase()}`)
        if (settings.extensions.confetti) confetti()
      }
      return true
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data.conflict) {
        const latest = err.data.latest as { content: string; updated_at: string }
        setConflict({ path, latest: latest.content, updated_at: latest.updated_at })
      } else toast(`${t('common.error')}: ${err instanceof Error ? err.message : err}`, 'error')
      return false
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(path); return n })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canEdit, settings.extensions, settings.tabSize, announce, toast])

  const saveAll = useCallback(async () => {
    const paths = [...filesRef.current.values()].filter((f) => !f.is_folder && f.content !== f.saved).map((f) => f.path)
    if (!paths.length) { announce('Nothing to save'); return }
    const results = await Promise.all(paths.map((p) => saveFile(p, { quiet: true })))
    const ok = results.filter(Boolean).length
    toast(`Saved ${ok} of ${paths.length} files`, ok === paths.length ? 'success' : 'error')
    if (settings.extensions.confetti && ok) confetti()
  }, [saveFile, toast, announce, settings.extensions.confetti])

  const onEdit = (value: string) => {
    if (!active) return
    setFiles((m) => {
      const f = m.get(active)
      if (!f || f.content === value) return m
      const n = new Map(m)
      n.set(active, { ...f, content: value })
      return n
    })
    if (settings.extensions.autosave && canEdit) {
      window.clearTimeout(autosaveTimer.current)
      const path = active
      autosaveTimer.current = window.setTimeout(() => saveFile(path, { quiet: true }), settings.autosaveDelay)
    }
  }

  // Workspace keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveAll() }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (active) saveFile(active) }
      else if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) { e.preventDefault(); setQuickOpen(true) }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'z' && settings.extensions.zen) { e.preventDefault(); setExtension('zen', !settings.extensions.zen) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, saveFile, saveAll, settings.extensions.zen, setExtension])

  // Contribute commands to the Ctrl+K palette.
  useEffect(() => {
    if (!detail) return
    return registerCommands('workspace', [
      ...fileList.filter((f) => !f.is_folder).map((f) => ({ id: `file-${f.path}`, group: 'Files', label: f.path, icon: 'file', run: () => openFile(f.path) })),
      ...TABS.map((tb) => ({ id: `tab-${tb}`, group: detail.api.name, label: `Open ${tb} tab`, icon: TAB_ICONS[tb], run: () => navigate(tb === 'code' ? `/p/${id}` : `/p/${id}/${tb}`) })),
      { id: 'ws-save-all', group: detail.api.name, label: 'Save all files', icon: 'save', run: () => saveAll() },
      { id: 'ws-run', group: detail.api.name, label: 'Run current file', icon: 'play', run: () => sandboxRef.current?.run() },
      { id: 'ws-new-file', group: detail.api.name, label: 'New file', icon: 'plus', run: () => setNewFile({ folder: '', kind: 'file' }) },
      { id: 'ws-export', group: detail.api.name, label: 'Export project as .zip', icon: 'download', run: () => exportZip() },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, fileList, openFile, saveAll, id])

  async function createEntry(path: string, kind: 'file' | 'folder', content = '') {
    try {
      await api.put(`/apis/${id}/files`, { path, is_folder: kind === 'folder', content })
      await load()
      if (kind === 'file') openFile(path)
      announce(`${kind === 'file' ? 'File' : 'Folder'} ${path} created`)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  async function renameEntry(path: string) {
    const name = await ask({ title: `${t('ws.rename')} ${path}`, input: { label: 'New path', initial: path }, confirm: t('ws.rename') })
    if (!name || name === path) return
    if (dirty.has(path)) await saveFile(path, { quiet: true })
    try {
      await api.post(`/apis/${id}/files/rename`, { from: path, to: name })
      setOpenTabs((tabs) => tabs.map((p) => (p === path || p.startsWith(path + '/') ? name + p.slice(path.length) : p)))
      if (active && (active === path || active.startsWith(path + '/'))) setActive(name + active.slice(path.length))
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  async function deleteEntry(path: string) {
    const f = files.get(path)
    const used = detail?.endpoints.filter((e) => e.file_path === path || e.file_path.startsWith(path + '/')) || []
    if (!(await ask({ title: `${t('ws.delete')} ${path}?`, body: <>{f?.is_folder ? 'Everything inside this folder is deleted too. ' : ''}{used.length ? <strong>{used.length} endpoint(s) use this and will stop working. </strong> : ''}You can bring it back from a saved version.</>, confirm: t('ws.delete'), danger: true }))) return
    try {
      await api.del(`/apis/${id}/files?path=${encodeURIComponent(path)}`)
      setOpenTabs((tabs) => tabs.filter((p) => p !== path && !p.startsWith(path + '/')))
      if (active && (active === path || active.startsWith(path + '/'))) setActive(null)
      await load()
      toast(`Deleted ${path}`, 'success')
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  async function duplicateEntry(path: string) {
    const f = files.get(path)
    if (!f) return
    const dot = path.lastIndexOf('.')
    let target = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}-copy${path.slice(dot)}` : `${path}-copy`
    for (let i = 2; files.has(target); i++) target = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}-copy${i}${path.slice(dot)}` : `${path}-copy${i}`
    await createEntry(target, 'file', f.content)
  }

  async function moveEntry(from: string, toFolder: string) {
    const name = from.split('/').pop()!
    const to = toFolder ? `${toFolder}/${name}` : name
    if (to === from || toFolder === from || toFolder.startsWith(from + '/')) return
    try {
      await api.post(`/apis/${id}/files/rename`, { from, to })
      setOpenTabs((tabs) => tabs.map((p) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p)))
      if (active && (active === from || active.startsWith(from + '/'))) setActive(to + active.slice(from.length))
      await load()
      announce(`Moved ${from} to ${to}`)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  async function uploadFiles(list: FileList, folder = '') {
    const out: { path: string; content: string }[] = []
    for (const file of Array.from(list)) {
      if (file.size > 1_000_000) { toast(`${file.name} is larger than 1 MB and was skipped`, 'error'); continue }
      if (file.name.toLowerCase().endsWith('.zip')) {
        const { files: zf } = zipToFiles(new Uint8Array(await file.arrayBuffer()))
        for (const z of zf) if (!z.is_folder) out.push({ path: folder ? `${folder}/${z.path}` : z.path, content: z.content })
        continue
      }
      const text = await file.text()
      if (text.slice(0, 8000).includes('\u0000')) { toast(`${file.name} looks like a binary file and was skipped`, 'error'); continue }
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      out.push({ path: folder ? `${folder}/${rel}` : rel, content: text })
    }
    if (!out.length) return
    try {
      await api.post(`/apis/${id}/files/bulk`, { files: out })
      await load()
      toast(`Uploaded ${out.length} file${out.length === 1 ? '' : 's'}`, 'success')
      openFile(out[0].path)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  function exportZip() {
    if (!detail) return
    const data = filesToZip(fileList, { name: detail.api.name, slug: detail.api.slug, endpoints: detail.endpoints.map(({ method, route, file_path, description, public: pub, enabled }) => ({ method, route, file_path, description, public: pub, enabled })), exported_at: new Date().toISOString() })
    downloadBlob(`${detail.api.slug}.zip`, new Blob([data as BlobPart], { type: 'application/zip' }))
    toast('Project exported', 'success')
  }

  async function importZip(file: File) {
    const { files: zf, meta } = zipToFiles(new Uint8Array(await file.arrayBuffer()))
    if (!zf.length) return toast('That zip has no text files', 'error')
    const replace = await ask({ title: `Import ${zf.filter((f) => !f.is_folder).length} files?`, body: 'Files with the same name are overwritten. Choose “Replace everything” to delete files that are not in the zip.', confirm: 'Replace everything' })
    try {
      await api.post(`/apis/${id}/files/bulk`, { files: zf, replace: !!replace })
      if (meta?.endpoints?.length && replace) {
        for (const ep of meta.endpoints) await api.post(`/apis/${id}/endpoints`, ep).catch(() => {})
      }
      await load(false)
      toast('Project imported', 'success')
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  if (error && !detail) return <div className="page"><ErrorBox error={error} retry={() => load()} /><p><A href="/dashboard">Back to dashboard</A></p></div>
  if (!detail) return <Loading />

  const info = detail.api
  const owner = detail.owner.username
  const base = { info, owner, canEdit, isOwner }
  const lang = active ? languageForPath(active) : null
  const zen = !!settings.extensions.zen

  return (
    <div className={cx('workspace', zen && 'zen', !sidebar && 'no-sidebar')}>
      <header className="ws-head">
        <div className="ws-title">
          <span className="api-icon" aria-hidden="true">{info.icon}</span>
          <div>
            <h1>{info.name}</h1>
            <div className="ws-sub">
              <Badge tone={info.status === 'live' ? 'good' : 'warn'}><span className={cx('dot', info.status === 'live' ? 'dot-live' : 'dot-paused')} aria-hidden="true" />{info.status === 'live' ? t('dash.live') : t('dash.paused')}</Badge>
              <code className="ws-url">{apiBaseUrl(owner, info.slug)}</code>
              {role !== 'owner' && <Badge tone="info">{role} · shared by @{owner}</Badge>}
              {!canEdit && <Badge tone="neutral">Read only</Badge>}
            </div>
          </div>
        </div>
        <div className="ws-actions">
          {dirty.size > 0 && <span className="unsaved-pill" role="status">{dirty.size} {t('ws.unsaved').toLowerCase()}</span>}
          {canEdit && <Button size="sm" icon="save" onClick={saveAll} disabled={!dirty.size} aria-keyshortcuts="Control+Shift+S">{t('ws.saveAll')}</Button>}
          <Menu label="Project actions" items={[
            { label: t('ws.exportZip'), icon: 'download', onSelect: exportZip },
            canEdit ? { label: t('ws.importZip'), icon: 'upload', onSelect: () => zipRef.current?.click() } : null,
            { label: zen ? 'Exit Zen mode' : 'Zen mode', icon: 'maximize', onSelect: () => setExtension('zen', !zen) },
            { label: 'Bigger editor text', icon: 'plus', onSelect: () => updateSettings({ editorFontSize: Math.min(28, settings.editorFontSize + 1) }) },
            { label: 'Smaller editor text', icon: 'eye', onSelect: () => updateSettings({ editorFontSize: Math.max(10, settings.editorFontSize - 1) }) },
          ]} />
        </div>
      </header>
      <Tabs
        label="API sections"
        value={tab}
        onChange={(v) => navigate(v === 'code' ? `/p/${id}` : `/p/${id}/${v}`)}
        tabs={TABS.map((tb) => ({ id: tb, label: t(`tab.${tb}` as const), icon: TAB_ICONS[tb], badge: tb === 'endpoints' ? <span className="count">{detail.endpoints.length}</span> : tb === 'sharing' && detail.members.length ? <span className="count">{detail.members.length}</span> : undefined }))}
        className="ws-tabs"
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ws-panel" tabIndex={tab === 'code' ? -1 : 0}>
        {tab === 'code' && (
          <div className="ide">
            {sidebar && (
              <aside className="ide-side" aria-label={t('ws.files')}>
                <div className="ide-side-head">
                  <h2>{t('ws.files')}</h2>
                  {canEdit && (
                    <div className="row-tight">
                      <IconButton icon="file" label={t('ws.newFile')} onClick={() => setNewFile({ folder: '', kind: 'file' })} />
                      <IconButton icon="folder" label={t('ws.newFolder')} onClick={() => setNewFile({ folder: '', kind: 'folder' })} />
                      <IconButton icon="upload" label={t('ws.upload')} onClick={() => uploadRef.current?.click()} />
                    </div>
                  )}
                </div>
                <FileTree
                  files={fileList}
                  active={active}
                  dirty={dirty}
                  storageKey={`${storageKey}:tree`}
                  readOnly={!canEdit}
                  onOpen={openFile}
                  onNew={(folder, kind) => setNewFile({ folder, kind })}
                  onRename={renameEntry}
                  onDelete={deleteEntry}
                  onDuplicate={duplicateEntry}
                  onDownload={(p) => downloadBlob(p.split('/').pop()!, files.get(p)?.content || '')}
                  onDropFiles={uploadFiles}
                  onMove={moveEntry}
                  endpointFiles={endpointFiles}
                />
                <input ref={uploadRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }} />
                <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importZip(f); e.target.value = '' }} />
              </aside>
            )}
            <div className="ide-main">
              <div className="editor-tabs-row">
              <IconButton icon="layout" label={sidebar ? 'Hide file list' : 'Show file list'} onClick={() => setSidebar((s) => !s)} className="side-toggle" />
              <div className="editor-tabs" role="group" aria-label="Open files">
                {openTabs.map((p) => {
                  const isDirty = dirty.has(p)
                  return (
                    <div key={p} className={cx('editor-tab', p === active && 'active')}>
                      <button type="button" aria-current={p === active ? 'true' : undefined} className="editor-tab-btn" onClick={() => setActive(p)} title={p}
                        onKeyDown={(e) => {
                          const i = openTabs.indexOf(p)
                          if (e.key === 'ArrowRight' && openTabs[i + 1]) { setActive(openTabs[i + 1]); (e.currentTarget.parentElement?.nextElementSibling?.querySelector('button') as HTMLElement)?.focus() }
                          if (e.key === 'ArrowLeft' && openTabs[i - 1]) { setActive(openTabs[i - 1]); (e.currentTarget.parentElement?.previousElementSibling?.querySelector('button') as HTMLElement)?.focus() }
                          if (e.key === 'Delete') closeTab(p)
                        }}
                        onAuxClick={(e) => { if (e.button === 1) closeTab(p) }}
                      >
                        <FileIcon path={p} isFolder={false} />
                        <span>{p.split('/').pop()}</span>
                        {isDirty && <span className="ft-dirty" aria-label={t('ws.unsaved')}>●</span>}
                        {saving.has(p) && <span className="sr-only">saving</span>}
                      </button>
                      <button type="button" className="editor-tab-x" aria-label={`Close ${p}`} onClick={() => closeTab(p)}><Icon name="x" size={12} /></button>
                    </div>
                  )
                })}
              </div>
              </div>
              {current && !current.is_folder ? (
                <>
                  <div className="editor-bar">
                    <span className="crumb-path">{active}</span>
                    <label className="lang-switch">
                      <span className="sr-only">Language</span>
                      <select className="input slim" value={lang?.id} disabled={!canEdit} onChange={async (e) => {
                        const l = languageById(e.target.value)
                        if (!l || !active) return
                        const next = active.replace(/(\.[^./]+)?$/, `.${l.ext[0]}`)
                        if (next !== active) {
                          if (dirty.has(active)) await saveFile(active, { quiet: true })
                          await api.post(`/apis/${id}/files/rename`, { from: active, to: next }).catch((err) => toast(err.message, 'error'))
                          setOpenTabs((tabs) => tabs.map((x) => (x === active ? next : x)))
                          setActive(next)
                          load()
                        }
                      }}>
                        {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                    <span className="editor-status" role="status">{saving.has(active!) ? 'Saving…' : dirty.has(active!) ? t('ws.unsaved') : t('ws.saved')}</span>
                    {canEdit && <Button size="sm" icon="save" onClick={() => saveFile(active!)} disabled={!dirty.has(active!)} aria-keyshortcuts="Control+S">{t('ws.save')}</Button>}
                    <Button size="sm" variant="primary" icon="play" onClick={() => sandboxRef.current?.run()} aria-keyshortcuts="Control+Enter">{t('ws.run')}</Button>
                  </div>
                  <div className="editor-split">
                    <CodeEditor
                      docKey={active!}
                      value={current.content}
                      language={lang?.id || 'text'}
                      readOnly={!canEdit}
                      onChange={onEdit}
                      onSave={() => active && saveFile(active)}
                      onRun={() => sandboxRef.current?.run()}
                      label={`Editing ${active}`}
                    />
                    <Sandbox ref={sandboxRef} apiId={id} entry={active} files={fileList} />
                  </div>
                </>
              ) : (
                <div className="ide-empty">
                  <Icon name="file" size={36} />
                  <p>{t('ws.noFile')}</p>
                  {canEdit && <Button variant="primary" icon="plus" onClick={() => setNewFile({ folder: '', kind: 'file' })}>{t('ws.newFile')}</Button>}
                  <p className="hint">Tip: press <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">P</kbd> to open a file by name.</p>
                </div>
              )}
            </div>
          </div>
        )}
        {tab === 'endpoints' && <EndpointsPanel {...base} endpoints={detail.endpoints} files={fileList} onChange={() => load()} />}
        {tab === 'test' && <TestPanel {...base} endpoints={detail.endpoints} />}
        {tab === 'integrate' && <IntegratePanel {...base} endpoints={detail.endpoints} />}
        {tab === 'extensions' && <ApiExtensionsPanel {...base} onSaved={(a) => setDetail((d) => d && { ...d, api: { ...d.api, ...a } })} />}
        {tab === 'sharing' && <SharingPanel {...base} members={detail.members} onChange={() => load()} />}
        {tab === 'logs' && <LogsPanel {...base} />}
        {tab === 'data' && <DataPanel {...base} />}
        {tab === 'versions' && <VersionsPanel {...base} onRestored={() => load(false)} onSnapshot={async () => { await saveAll() }} />}
        {tab === 'settings' && <ApiSettingsPanel {...base} onSaved={(a) => setDetail((d) => d && { ...d, api: { ...d.api, ...a } })} />}
      </div>

      <NewFileModal open={!!newFile} kind={newFile?.kind || 'file'} folder={newFile?.folder || ''} existing={files} onClose={() => setNewFile(null)} onCreate={(path, kind, content) => { setNewFile(null); createEntry(path, kind, content) }} />
      <QuickOpen open={quickOpen} onClose={() => setQuickOpen(false)} files={fileList.filter((f) => !f.is_folder).map((f) => f.path)} onPick={openFile} />
      <Modal open={!!conflict} onClose={() => setConflict(null)} title="Someone else changed this file" size="lg" footer={
        <>
          <Button variant="ghost" onClick={() => setConflict(null)}>{t('common.cancel')}</Button>
          <Button onClick={() => { if (!conflict) return; setFiles((m) => { const n = new Map(m); const f = n.get(conflict.path)!; n.set(conflict.path, { ...f, content: conflict.latest, saved: conflict.latest, base_updated_at: conflict.updated_at }); return n }); setConflict(null) }}>Use their version</Button>
          <Button variant="danger" onClick={() => { if (conflict) saveFile(conflict.path, { force: true }); setConflict(null) }}>Overwrite with mine</Button>
        </>
      }>
        <p>A teammate saved <strong>{conflict?.path}</strong> after you opened it. Their version:</p>
        <pre className="out version-code" tabIndex={0}>{conflict?.latest}</pre>
      </Modal>
    </div>
  )
}

function NewFileModal({ open, kind, folder, existing, onClose, onCreate }: { open: boolean; kind: 'file' | 'folder'; folder: string; existing: Map<string, VFile>; onClose: () => void; onCreate: (path: string, kind: 'file' | 'folder', content: string) => void }) {
  const [name, setName] = useState('')
  const [langId, setLangId] = useState('javascript')
  const [template, setTemplate] = useState<'hello' | 'endpoint' | 'empty'>('endpoint')
  const [error, setError] = useState<string | null>(null)
  const lang = languageById(langId)!

  useEffect(() => {
    if (open) {
      setName(kind === 'folder' ? '' : defaultFileName(languageById(langId)!))
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind])

  const pickLang = (id: string) => {
    setLangId(id)
    const l = languageById(id)!
    setName((n) => {
      const stem = n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n || 'main'
      return id === 'dockerfile' ? 'Dockerfile' : id === 'java' ? 'Main.java' : `${stem}.${l.ext[0]}`
    })
    if (!l.endpoint && template === 'endpoint') setTemplate('hello')
  }

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const clean = name.trim().replace(/^\/+/, '')
    if (!clean) return setError('Enter a name')
    const path = folder ? `${folder}/${clean}` : clean
    if (existing.has(path)) return setError(`${path} already exists`)
    const content = kind === 'folder' ? '' : template === 'empty' ? '' : template === 'endpoint' && lang.endpoint ? lang.endpoint : lang.hello
    onCreate(path, kind, content)
  }

  const groups: [string, typeof LANGUAGES][] = [
    ['Run anywhere (fastest)', LANGUAGES.filter((l) => l.runner === 'quickjs' || l.runner === 'batch')],
    ['Compiled & scripting languages', LANGUAGES.filter((l) => l.runner === 'remote')],
    ['Data & static files', LANGUAGES.filter((l) => l.runner === 'static')],
    ['Other', LANGUAGES.filter((l) => l.runner === 'none')],
  ]

  return (
    <Modal open={open} onClose={onClose} title={kind === 'folder' ? t('ws.newFolder') : t('ws.newFile')} size={kind === 'folder' ? 'sm' : 'lg'} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => submit()}>Create</Button></>}>
      <form className="stack" onSubmit={submit}>
        {folder && <p className="hint">Inside <code>{folder}/</code></p>}
        {kind === 'file' && (
          <Field label="Language / file type">
            {(p) => (
              <select {...p} className="input" value={langId} onChange={(e) => pickLang(e.target.value)}>
                {groups.map(([g, ls]) => <optgroup key={g} label={g}>{ls.map((l) => <option key={l.id} value={l.id}>{l.name} (.{l.ext[0]})</option>)}</optgroup>)}
              </select>
            )}
          </Field>
        )}
        <Field label="Name" error={error} hint={kind === 'file' ? 'Use slashes to create folders too, e.g. src/game/score.py' : undefined}>
          {(p) => <input {...p} className="input mono" value={name} onChange={(e) => { setName(e.target.value); setError(null) }} autoFocus spellCheck={false} />}
        </Field>
        {kind === 'file' && (
          <fieldset>
            <legend>Start with</legend>
            <div className="radio-row">
              {lang.endpoint && <label className="check-row"><input type="radio" name="tpl" checked={template === 'endpoint'} onChange={() => setTemplate('endpoint')} /> Endpoint template (handles HTTP requests)</label>}
              <label className="check-row"><input type="radio" name="tpl" checked={template === 'hello'} onChange={() => setTemplate('hello')} /> Hello world script</label>
              <label className="check-row"><input type="radio" name="tpl" checked={template === 'empty'} onChange={() => setTemplate('empty')} /> Empty file</label>
            </div>
          </fieldset>
        )}
      </form>
    </Modal>
  )
}

function QuickOpen({ open, onClose, files, onPick }: { open: boolean; onClose: () => void; files: string[]; onPick: (p: string) => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  useEffect(() => { if (open) { setQ(''); setI(0) } }, [open])
  const list = files.filter((f) => f.toLowerCase().includes(q.toLowerCase())).slice(0, 30)
  return (
    <Modal open={open} onClose={onClose} title="Open file" size="md">
      <input
        className="input"
        value={q}
        onChange={(e) => { setQ(e.target.value); setI(0) }}
        placeholder="Type a file name"
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="qo-list"
        aria-activedescendant={list[i] ? `qo-${i}` : undefined}
        aria-label="File name"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
          if (e.key === 'Enter' && list[i]) { onPick(list[i]); onClose() }
        }}
      />
      <ul id="qo-list" role="listbox" className="palette-list" aria-label="Files">
        {list.map((f, idx) => (
          <li key={f} id={`qo-${idx}`} role="option" aria-selected={idx === i} className={cx('palette-item', idx === i && 'active')} onClick={() => { onPick(f); onClose() }} onMouseEnter={() => setI(idx)}>
            <FileIcon path={f} isFolder={false} /> <span className="palette-label">{f}</span>
          </li>
        ))}
        {!list.length && <li className="palette-empty">No files match</li>}
      </ul>
    </Modal>
  )
}
