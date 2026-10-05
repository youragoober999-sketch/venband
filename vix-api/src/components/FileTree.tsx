// Accessible file tree (ARIA tree pattern) with keyboard support and drag-and-drop upload.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Menu } from './ui'
import { cx } from '../lib/util'
import { languageForPath } from '../../shared/languages.js'
import { t } from '../lib/i18n'

export type TreeNode = { name: string; path: string; isFolder: boolean; children: TreeNode[] }

export function buildTree(paths: { path: string; is_folder: boolean }[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isFolder: true, children: [] }
  const index = new Map<string, TreeNode>([['', root]])
  const sorted = [...paths].sort((a, b) => a.path.localeCompare(b.path))
  for (const f of sorted) {
    const parts = f.path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      if (index.has(p)) continue
      const isFolder = i < parts.length || f.is_folder
      const node: TreeNode = { name: parts[i - 1], path: p, isFolder, children: [] }
      index.get(parts.slice(0, i - 1).join('/'))!.children.push(node)
      index.set(p, node)
    }
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isFolder ? -1 : 1))
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

const EXT_COLORS: Record<string, string> = {
  javascript: '#f7df1e', typescript: '#3178c6', python: '#3776ab', rust: '#dea584', batch: '#c1f12e', java: '#e76f00', csharp: '#9b4f96', cpp: '#00599c', c: '#5c6bc0',
  go: '#00add8', lua: '#2c2d72', ruby: '#cc342d', php: '#777bb4', bash: '#4eaa25', json: '#cbcb41', html: '#e34c26', css: '#264de4', markdown: '#7aa2f7', kotlin: '#a97bff', swift: '#f05138',
}

export function FileIcon({ path, isFolder, open }: { path: string; isFolder: boolean; open?: boolean }) {
  if (isFolder) return <Icon name={open ? 'folderOpen' : 'folder'} size={16} className="ft-folder-icon" />
  const lang = languageForPath(path)
  return (
    <span className="ft-file-icon" style={{ color: EXT_COLORS[lang.id] || 'var(--muted)' }} aria-hidden="true">
      <Icon name="file" size={16} />
    </span>
  )
}

type Props = {
  files: { path: string; is_folder: boolean }[]
  active: string | null
  dirty: Set<string>
  storageKey: string
  readOnly: boolean
  onOpen: (path: string) => void
  onNew: (folder: string, kind: 'file' | 'folder') => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onDuplicate: (path: string) => void
  onDownload: (path: string) => void
  onDropFiles: (files: FileList, folder: string) => void
  onMove: (from: string, toFolder: string) => void
  endpointFiles: Set<string>
}

export function FileTree(props: Props) {
  const { files, active, dirty, storageKey, readOnly, onOpen } = props
  const tree = useMemo(() => buildTree(files), [files])
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'))
    } catch {
      return new Set()
    }
  })
  const [focus, setFocus] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const ref = useRef<HTMLUListElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]))
    } catch { /* ignore */ }
  }, [expanded, storageKey])

  // Reveal the active file.
  useEffect(() => {
    if (!active) return
    const parts = active.split('/')
    if (parts.length < 2) return
    setExpanded((s) => {
      const n = new Set(s)
      for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join('/'))
      return n
    })
  }, [active])

  // Flattened visible nodes for keyboard navigation.
  const visible = useMemo(() => {
    const out: { node: TreeNode; depth: number; parent: string }[] = []
    const walk = (nodes: TreeNode[], depth: number, parent: string) => {
      for (const n of nodes) {
        out.push({ node: n, depth, parent })
        if (n.isFolder && expanded.has(n.path)) walk(n.children, depth + 1, n.path)
      }
    }
    walk(tree, 1, '')
    return out
  }, [tree, expanded])

  const focusPath = focus && visible.some((v) => v.node.path === focus) ? focus : active && visible.some((v) => v.node.path === active) ? active : visible[0]?.node.path
  const moveFocus = (path: string) => {
    setFocus(path)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus())
  }

  const toggle = (path: string, open?: boolean) =>
    setExpanded((s) => {
      const n = new Set(s)
      const want = open ?? !n.has(path)
      if (want) n.add(path)
      else n.delete(path)
      return n
    })

  function onKey(e: React.KeyboardEvent, n: TreeNode, idx: number, parent: string) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (visible[idx + 1]) moveFocus(visible[idx + 1].node.path); break
      case 'ArrowUp': e.preventDefault(); if (visible[idx - 1]) moveFocus(visible[idx - 1].node.path); break
      case 'Home': e.preventDefault(); if (visible[0]) moveFocus(visible[0].node.path); break
      case 'End': e.preventDefault(); if (visible.length) moveFocus(visible[visible.length - 1].node.path); break
      case 'ArrowRight':
        e.preventDefault()
        if (n.isFolder) {
          if (!expanded.has(n.path)) toggle(n.path, true)
          else if (n.children[0]) moveFocus(n.children[0].path)
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (n.isFolder && expanded.has(n.path)) toggle(n.path, false)
        else if (parent) moveFocus(parent)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (n.isFolder) toggle(n.path)
        else onOpen(n.path)
        break
      case 'F2': if (!readOnly) { e.preventDefault(); props.onRename(n.path) } break
      case 'Delete': if (!readOnly) { e.preventDefault(); props.onDelete(n.path) } break
      default:
        // Type-ahead: jump to the next item starting with the typed letter.
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
          const start = idx + 1
          const all = [...visible.slice(start), ...visible.slice(0, start)]
          const hit = all.find((v) => v.node.name.toLowerCase().startsWith(e.key.toLowerCase()))
          if (hit) moveFocus(hit.node.path)
        }
    }
  }

  const dropProps = (folder: string) => readOnly ? {} : ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(folder) },
    onDragLeave: (e: React.DragEvent) => { e.stopPropagation(); setDragOver((d) => (d === folder ? null : d)) },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(null)
      const moving = e.dataTransfer.getData('application/x-vix-path')
      if (moving) props.onMove(moving, folder)
      else if (e.dataTransfer.files.length) props.onDropFiles(e.dataTransfer.files, folder)
    },
  })

  return (
    <div className={cx('file-tree', dragOver === '' && 'drag-root')} {...dropProps('')}>
      {visible.length === 0 ? (
        <p className="hint ft-empty">No files yet. {readOnly ? '' : 'Create one or drop files here.'}</p>
      ) : (
        <ul ref={ref} role="tree" aria-label={t('ws.files')} className="ft-list">
          {visible.map(({ node: n, depth, parent }, idx) => {
            const isOpen = n.isFolder && expanded.has(n.path)
            const posInSet = (parent ? visible.filter((v) => v.parent === parent) : visible.filter((v) => v.depth === 1)).findIndex((v) => v.node.path === n.path) + 1
            const setSize = parent ? visible.filter((v) => v.parent === parent).length : visible.filter((v) => v.depth === 1).length
            return (
              <li
                key={n.path}
                role="treeitem"
                aria-level={depth}
                aria-setsize={setSize}
                aria-posinset={posInSet}
                aria-expanded={n.isFolder ? isOpen : undefined}
                aria-selected={n.path === active}
                data-path={n.path}
                tabIndex={n.path === focusPath ? 0 : -1}
                className={cx('ft-item', n.path === active && 'active', dragOver === n.path && 'drag-over')}
                style={{ paddingInlineStart: `${(depth - 1) * 14 + 6}px` }}
                onClick={() => { setFocus(n.path); if (n.isFolder) toggle(n.path); else onOpen(n.path) }}
                onKeyDown={(e) => { if (e.target === e.currentTarget) onKey(e, n, idx, parent) }}
                onFocus={(e) => { if (e.target === e.currentTarget) setFocus(n.path) }}
                draggable={!readOnly}
                onDragStart={(e) => { e.dataTransfer.setData('application/x-vix-path', n.path); e.dataTransfer.effectAllowed = 'move' }}
                {...(n.isFolder ? dropProps(n.path) : {})}
              >
                {n.isFolder ? <Icon name={isOpen ? 'chevronDown' : 'chevron'} size={12} className="ft-chev" /> : <span className="ft-chev-space" />}
                <FileIcon path={n.path} isFolder={n.isFolder} open={isOpen} />
                <span className="ft-name">{n.name}</span>
                {dirty.has(n.path) && <span className="ft-dirty" title={t('ws.unsaved')}><span aria-hidden="true">●</span><span className="sr-only">, {t('ws.unsaved')}</span></span>}
                {props.endpointFiles.has(n.path) && <span className="ft-live" title="Served by an endpoint"><Icon name="globe" size={12} /><span className="sr-only">, served by an endpoint</span></span>}
                {!readOnly && (
                  <span className="ft-actions" onClick={(e) => e.stopPropagation()}>
                    <Menu label={`Actions for ${n.name}`} items={[
                      n.isFolder ? { label: t('ws.newFile'), icon: 'file', onSelect: () => props.onNew(n.path, 'file') } : null,
                      n.isFolder ? { label: t('ws.newFolder'), icon: 'folder', onSelect: () => props.onNew(n.path, 'folder') } : null,
                      { label: t('ws.rename'), icon: 'edit', onSelect: () => props.onRename(n.path) },
                      !n.isFolder ? { label: t('ws.duplicate'), icon: 'copy', onSelect: () => props.onDuplicate(n.path) } : null,
                      !n.isFolder ? { label: t('ws.download'), icon: 'download', onSelect: () => props.onDownload(n.path) } : null,
                      { label: t('ws.delete'), icon: 'trash', danger: true, onSelect: () => props.onDelete(n.path) },
                    ]} />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
