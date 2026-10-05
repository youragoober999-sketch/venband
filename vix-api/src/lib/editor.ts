// CodeMirror configuration: syntax highlighting for every language, themes and
// the editor extensions users can switch on.
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { EditorState, Compartment, type Extension, RangeSetBuilder } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle, HighlightStyle, StreamLanguage, indentUnit, type StreamParser } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, snippetCompletion, type CompletionSource } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { lintKeymap } from '@codemirror/lint'
import { tags as tg } from '@lezer/highlight'

export const compartments = {
  language: new Compartment(),
  theme: new Compartment(),
  wrap: new Compartment(),
  vim: new Compartment(),
  tab: new Compartment(),
  gutter: new Compartment(),
  readOnly: new Compartment(),
  extras: new Compartment(),
}

const legacy = (p: Promise<StreamParser<unknown>>) => p.then((parser) => StreamLanguage.define(parser) as Extension)

/** Lazily loads the CodeMirror language support for a Vix language id. */
export async function loadLanguage(id: string): Promise<Extension> {
  switch (id) {
    case 'javascript': return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
    case 'typescript': return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true })
    case 'python': return (await import('@codemirror/lang-python')).python()
    case 'rust': return (await import('@codemirror/lang-rust')).rust()
    case 'java': return (await import('@codemirror/lang-java')).java()
    case 'c': case 'cpp': return (await import('@codemirror/lang-cpp')).cpp()
    case 'json': return (await import('@codemirror/lang-json')).json()
    case 'html': return (await import('@codemirror/lang-html')).html()
    case 'css': return (await import('@codemirror/lang-css')).css()
    case 'sql': return (await import('@codemirror/lang-sql')).sql()
    case 'markdown': return (await import('@codemirror/lang-markdown')).markdown()
    case 'php': return (await import('@codemirror/lang-php')).php()
    case 'go': return (await import('@codemirror/lang-go')).go()
    case 'xml': return (await import('@codemirror/lang-xml')).xml()
    case 'yaml': return (await import('@codemirror/lang-yaml')).yaml()
    case 'csharp': return legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp))
    case 'kotlin': return legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.kotlin))
    case 'scala': return legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.scala))
    case 'dart': return legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.dart))
    case 'lua': return legacy(import('@codemirror/legacy-modes/mode/lua').then((m) => m.lua))
    case 'ruby': case 'crystal': return legacy(import('@codemirror/legacy-modes/mode/ruby').then((m) => m.ruby))
    case 'bash': return legacy(import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell))
    case 'powershell': return legacy(import('@codemirror/legacy-modes/mode/powershell').then((m) => m.powerShell))
    case 'perl': return legacy(import('@codemirror/legacy-modes/mode/perl').then((m) => m.perl))
    case 'haskell': return legacy(import('@codemirror/legacy-modes/mode/haskell').then((m) => m.haskell))
    case 'swift': return legacy(import('@codemirror/legacy-modes/mode/swift').then((m) => m.swift))
    case 'erlang': case 'elixir': return legacy(import('@codemirror/legacy-modes/mode/erlang').then((m) => m.erlang))
    case 'julia': return legacy(import('@codemirror/legacy-modes/mode/julia').then((m) => m.julia))
    case 'r': return legacy(import('@codemirror/legacy-modes/mode/r').then((m) => m.r))
    case 'd': return legacy(import('@codemirror/legacy-modes/mode/d').then((m) => m.d))
    case 'ocaml': return legacy(import('@codemirror/legacy-modes/mode/mllike').then((m) => m.oCaml))
    case 'fsharp': return legacy(import('@codemirror/legacy-modes/mode/mllike').then((m) => m.fSharp))
    case 'vb': return legacy(import('@codemirror/legacy-modes/mode/vb').then((m) => m.vb))
    case 'pascal': return legacy(import('@codemirror/legacy-modes/mode/pascal').then((m) => m.pascal))
    case 'fortran': return legacy(import('@codemirror/legacy-modes/mode/fortran').then((m) => m.fortran))
    case 'cobol': return legacy(import('@codemirror/legacy-modes/mode/cobol').then((m) => m.cobol))
    case 'lisp': return legacy(import('@codemirror/legacy-modes/mode/commonlisp').then((m) => m.commonLisp))
    case 'scheme': return legacy(import('@codemirror/legacy-modes/mode/scheme').then((m) => m.scheme))
    case 'clojure': return legacy(import('@codemirror/legacy-modes/mode/clojure').then((m) => m.clojure))
    case 'groovy': return legacy(import('@codemirror/legacy-modes/mode/groovy').then((m) => m.groovy))
    case 'brainfuck': return legacy(import('@codemirror/legacy-modes/mode/brainfuck').then((m) => m.brainfuck))
    case 'assembly': return legacy(import('@codemirror/legacy-modes/mode/gas').then((m) => m.gas))
    case 'toml': return legacy(import('@codemirror/legacy-modes/mode/toml').then((m) => m.toml))
    case 'dockerfile': return legacy(import('@codemirror/legacy-modes/mode/dockerfile').then((m) => m.dockerFile))
    case 'gdscript': case 'nim': return legacy(import('@codemirror/legacy-modes/mode/python').then((m) => m.python))
    case 'batch': return StreamLanguage.define(batchMode)
    default: return []
  }
}

// A small stream parser for .bat/.cmd files.
const BATCH_KEYWORDS = /^(echo|set|if|else|for|in|do|goto|call|exit|setlocal|endlocal|shift|pause|cls|title|color|type|dir|del|copy|not|exist|defined|errorlevel|equ|neq|lss|leq|gtr|geq|start|cd|md|mkdir|rd|rmdir|choice|timeout|find|findstr|sort|more|ver)$/i
const batchMode: StreamParser<{ start: boolean }> = {
  name: 'batch',
  startState: () => ({ start: true }),
  token(stream, state) {
    if (stream.sol()) state.start = true
    if (stream.eatSpace()) return null
    if (state.start && (stream.match(/^@?rem\b.*/i) || stream.match(/^::.*/))) return 'comment'
    if (state.start && stream.match(/^:[A-Za-z_][\w-]*/)) { state.start = false; return 'labelName' }
    state.start = false
    if (stream.match(/^"(?:[^"])*"?/)) return 'string'
    if (stream.match(/^%%?~?[A-Za-z0-9_]+(:[^%]*)?%?/) || stream.match(/^![A-Za-z0-9_]+!/)) return 'variableName'
    if (stream.match(/^\/[A-Za-z]\b/)) return 'attributeName'
    if (stream.match(/^\d+\b/)) return 'number'
    if (stream.match(/^(==|&&|\|\||[&|<>()@])/)) return 'operator'
    if (stream.match(/^[A-Za-z_][\w.-]*/)) {
      return BATCH_KEYWORDS.test(stream.current()) ? 'keyword' : null
    }
    stream.next()
    return null
  },
}

// ---- themes ----

function makeTheme(dark: boolean, hc: boolean): Extension {
  const base = EditorView.theme({
    '&': { color: 'var(--ed-fg)', backgroundColor: 'var(--ed-bg)', height: '100%' },
    '.cm-content': { caretColor: 'var(--accent)', fontFamily: 'var(--font-code)', padding: '8px 0' },
    '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.6' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: hc ? '3px' : '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--ed-selection) !important' },
    '.cm-gutters': { backgroundColor: 'var(--ed-gutter-bg)', color: 'var(--ed-gutter-fg)', border: 'none', borderRight: '1px solid var(--border)' },
    '.cm-activeLine': { backgroundColor: 'var(--ed-active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--ed-active-line)', color: 'var(--fg)' },
    '.cm-matchingBracket': { outline: '1px solid var(--accent)', backgroundColor: 'transparent' },
    '.cm-tooltip': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--fg)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
    '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--fg)' },
    '.cm-searchMatch': { backgroundColor: 'var(--ed-search)', outline: '1px solid var(--warn)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-3)', border: 'none', color: 'var(--muted)' },
  }, { dark })
  const style = HighlightStyle.define([
    { tag: [tg.keyword, tg.controlKeyword, tg.moduleKeyword, tg.operatorKeyword], color: 'var(--syn-keyword)', fontWeight: hc ? '700' : undefined },
    { tag: [tg.string, tg.special(tg.string), tg.regexp], color: 'var(--syn-string)' },
    { tag: [tg.number, tg.bool, tg.null, tg.atom], color: 'var(--syn-number)' },
    { tag: [tg.comment, tg.lineComment, tg.blockComment, tg.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: [tg.function(tg.variableName), tg.function(tg.propertyName)], color: 'var(--syn-function)' },
    { tag: [tg.typeName, tg.className, tg.namespace], color: 'var(--syn-type)' },
    { tag: [tg.variableName, tg.special(tg.variableName)], color: 'var(--syn-variable)' },
    { tag: [tg.propertyName, tg.attributeName], color: 'var(--syn-property)' },
    { tag: [tg.operator, tg.punctuation, tg.bracket], color: 'var(--syn-punct)' },
    { tag: [tg.tagName, tg.heading, tg.labelName], color: 'var(--syn-tag)', fontWeight: '600' },
    { tag: tg.link, color: 'var(--syn-string)', textDecoration: 'underline' },
    { tag: tg.invalid, color: 'var(--bad)' },
    { tag: tg.strong, fontWeight: '700' },
    { tag: tg.emphasis, fontStyle: 'italic' },
  ])
  return [base, syntaxHighlighting(style), syntaxHighlighting(defaultHighlightStyle, { fallback: true })]
}

export function themeExtension(dark: boolean, hc: boolean) {
  return makeTheme(dark, hc)
}

// ---- Rainbow brackets extension ----

const rainbowMarks = Array.from({ length: 6 }, (_, i) => Decoration.mark({ class: `cm-rainbow-${i}` }))
const rainbowPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view) }
  build(view: EditorView) {
    const b = new RangeSetBuilder<Decoration>()
    const text = view.state.doc.toString()
    const limit = Math.min(text.length, view.viewport.to)
    let depth = 0
    let inStr: string | null = null
    for (let i = 0; i < limit; i++) {
      const ch = text[i]
      if (inStr) {
        if (ch === '\\') i++
        else if (ch === inStr) inStr = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
      if (ch === '(' || ch === '[' || ch === '{') {
        if (i >= view.viewport.from) b.add(i, i + 1, rainbowMarks[depth % 6])
        depth++
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth = Math.max(0, depth - 1)
        if (i >= view.viewport.from) b.add(i, i + 1, rainbowMarks[depth % 6])
      }
    }
    return b.finish()
  }
}, { decorations: (v) => v.decorations })

// ---- Snippets extension ----

const SNIPPETS: Record<string, ReturnType<typeof snippetCompletion>[]> = {
  javascript: [
    snippetCompletion('async function handler(req, ctx) {\n\t${}\n\treturn { ok: true }\n}', { label: 'handler', detail: 'Vix endpoint handler', type: 'function' }),
    snippetCompletion("return { status: ${201}, body: { ${} } }", { label: 'respond', detail: 'Return status + body', type: 'keyword' }),
    snippetCompletion("const ${value} = await vix.kv.get('${key}')", { label: 'kvget', detail: 'Read from the KV store', type: 'function' }),
    snippetCompletion("await vix.kv.set('${key}', ${value})", { label: 'kvset', detail: 'Write to the KV store', type: 'function' }),
    snippetCompletion("const res = await fetch('${https://example.com}')\nconst data = await res.json()", { label: 'fetchjson', detail: 'Fetch JSON from another API', type: 'function' }),
    snippetCompletion("if (req.method !== '${POST}') return { status: 405, body: { error: 'Method not allowed' } }", { label: 'onlymethod', detail: 'Guard by HTTP method', type: 'keyword' }),
    snippetCompletion("const { ${name} } = req.body || {}\nif (!${name}) return { status: 400, body: { error: '${name} is required' } }", { label: 'requirebody', detail: 'Validate a body field', type: 'keyword' }),
  ],
  python: [
    snippetCompletion('import json, sys\n\nreq = json.loads(sys.stdin.read() or "{}")\n${}\nprint(json.dumps({"status": 200, "body": {"ok": True}}))', { label: 'handler', detail: 'Vix endpoint skeleton', type: 'function' }),
    snippetCompletion('print(json.dumps({"status": ${200}, "body": ${{}}}))', { label: 'respond', detail: 'Write the HTTP response', type: 'keyword' }),
  ],
  batch: [
    snippetCompletion('@echo off\nsetlocal enabledelayedexpansion\n${}\nendlocal', { label: 'script', detail: 'Batch skeleton', type: 'keyword' }),
    snippetCompletion('for /l %%i in (${1},1,${10}) do (\n\techo %%i\n)', { label: 'forl', detail: 'Counting loop', type: 'keyword' }),
    snippetCompletion('if "%${VAR}%"=="${value}" (\n\t${}\n) else (\n\t\n)', { label: 'ifelse', detail: 'If / else block', type: 'keyword' }),
  ],
  rust: [
    snippetCompletion('fn main() {\n\t${}\n}', { label: 'main', detail: 'Entry point', type: 'function' }),
    snippetCompletion('use std::io::Read;\nlet mut input = String::new();\nstd::io::stdin().read_to_string(&mut input).unwrap();', { label: 'stdin', detail: 'Read the request', type: 'keyword' }),
  ],
}

function snippetSource(lang: string): CompletionSource {
  return (ctx) => {
    const word = ctx.matchBefore(/\w+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    const list = SNIPPETS[lang === 'typescript' ? 'javascript' : lang] || []
    return list.length ? { from: word.from, options: list } : null
  }
}

export type EditorPrefs = {
  dark: boolean
  hc: boolean
  wrap: boolean
  vim: boolean
  tabSize: number
  lineNumbers: boolean
  rainbow: boolean
  glow: boolean
  snippets: boolean
  readOnly: boolean
  language: string
}

export async function vimExtension(on: boolean): Promise<Extension> {
  if (!on) return []
  const { vim } = await import('@replit/codemirror-vim')
  return vim()
}

export function extrasExtension(p: EditorPrefs): Extension {
  const out: Extension[] = []
  if (p.rainbow) out.push(rainbowPlugin)
  if (p.glow) out.push(EditorView.theme({ '.cm-activeLine': { backgroundColor: 'var(--ed-glow) !important', boxShadow: 'inset 3px 0 0 var(--accent)' } }))
  if (p.snippets) out.push(autocompletion({ override: undefined }), EditorState.languageData.of(() => [{ autocomplete: snippetSource(p.language) }]))
  return out
}

export function gutterExtension(on: boolean): Extension {
  return on ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : []
}

export function tabExtension(size: number): Extension {
  return [EditorState.tabSize.of(size), indentUnit.of(' '.repeat(size))]
}

export function baseExtensions(onSave: () => void, onRun: () => void, onChange: (v: string) => void, onKey?: () => void): Extension[] {
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { onSave(); return true } },
      { key: 'Mod-Enter', preventDefault: true, run: () => { onRun(); return true } },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        onChange(u.state.doc.toString())
        onKey?.()
      }
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Code editor. Press Escape then Tab to move focus out of the editor.' }),
  ]
}
