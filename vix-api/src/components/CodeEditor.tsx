import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { useApp } from '../lib/store'
import { isDarkTheme, resolvedTheme } from '../lib/settings'
import { baseExtensions, compartments, extrasExtension, gutterExtension, loadLanguage, tabExtension, themeExtension, vimExtension } from '../lib/editor'
import { click } from '../lib/util'

type Props = {
  docKey: string
  value: string
  language: string
  readOnly?: boolean
  onChange: (v: string) => void
  onSave: () => void
  onRun: () => void
  label: string
}

/** One CodeMirror instance; swapping files swaps documents, keeping undo history per file. */
export function CodeEditor({ docKey, value, language, readOnly = false, onChange, onSave, onRun, label }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const states = useRef(new Map<string, EditorState>())
  const cb = useRef({ onChange, onSave, onRun })
  cb.current = { onChange, onSave, onRun }
  const { settings } = useApp()
  const ext = settings.extensions
  const prefsRef = useRef(settings)
  prefsRef.current = settings

  const theme = resolvedTheme(settings.theme)
  const dark = isDarkTheme(settings.theme)
  const hc = theme.startsWith('hc')

  const makeState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        baseExtensions(
          () => cb.current.onSave(),
          () => cb.current.onRun(),
          (v) => cb.current.onChange(v),
          () => {
            if (prefsRef.current.extensions['typing-sounds']) click()
          },
        ),
        compartments.language.of([]),
        compartments.theme.of(themeExtension(dark, hc)),
        compartments.wrap.of(ext.wrap ? EditorView.lineWrapping : []),
        compartments.vim.of([]),
        compartments.tab.of(tabExtension(settings.tabSize)),
        compartments.gutter.of(gutterExtension(settings.lineNumbers)),
        compartments.readOnly.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        compartments.extras.of(extrasExtension({ dark, hc, wrap: !!ext.wrap, vim: !!ext.vim, tabSize: settings.tabSize, lineNumbers: settings.lineNumbers, rainbow: !!ext.rainbow, glow: !!ext.glow, snippets: !!ext.snippets, readOnly, language })),
      ],
    })

  // Create the view once.
  useEffect(() => {
    if (!host.current) return
    const state = makeState(value)
    states.current.set(docKey, state)
    view.current = new EditorView({ state, parent: host.current })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switch documents when the open file changes.
  const lastKey = useRef(docKey)
  useEffect(() => {
    const v = view.current
    if (!v || lastKey.current === docKey) return
    states.current.set(lastKey.current, v.state)
    lastKey.current = docKey
    const saved = states.current.get(docKey)
    v.setState(saved && saved.doc.toString() === value ? saved : makeState(value))
    reconfigureAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // External content changes (e.g. restore, teammate reload) without losing cursor when equal.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
  }, [value])

  const reconfigureAll = () => {
    const v = view.current
    if (!v) return
    let alive = true
    loadLanguage(language).then((lang) => {
      if (alive && view.current === v) v.dispatch({ effects: compartments.language.reconfigure(lang) })
    })
    vimExtension(!!ext.vim).then((vimExt) => {
      if (view.current === v) v.dispatch({ effects: compartments.vim.reconfigure(vimExt) })
    })
    v.dispatch({
      effects: [
        compartments.theme.reconfigure(themeExtension(dark, hc)),
        compartments.wrap.reconfigure(ext.wrap ? EditorView.lineWrapping : []),
        compartments.tab.reconfigure(tabExtension(settings.tabSize)),
        compartments.gutter.reconfigure(gutterExtension(settings.lineNumbers)),
        compartments.readOnly.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        compartments.extras.reconfigure(extrasExtension({ dark, hc, wrap: !!ext.wrap, vim: !!ext.vim, tabSize: settings.tabSize, lineNumbers: settings.lineNumbers, rainbow: !!ext.rainbow, glow: !!ext.glow, snippets: !!ext.snippets, readOnly, language })),
      ],
    })
    return () => {
      alive = false
    }
  }

  useEffect(() => {
    reconfigureAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, dark, hc, ext.wrap, ext.vim, ext.rainbow, ext.glow, ext.snippets, settings.tabSize, settings.lineNumbers, readOnly])

  return (
    <div
      className="code-editor"
      ref={host}
      role="group"
      aria-label={label}
      style={{ fontSize: `${settings.editorFontSize}px` }}
      data-font={settings.editorFont}
      data-cursor-blink={settings.cursorBlink ? 'on' : 'off'}
    />
  )
}
