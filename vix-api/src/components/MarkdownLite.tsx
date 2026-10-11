// Safe Markdown rendering for chat messages (no HTML injection: builds React nodes).
import { Fragment, type ReactNode } from 'react'
import { CopyButton } from './ui'

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:[^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={`${key}-${i++}`}>{text.slice(last, m.index)}</Fragment>)
    const t = m[0]
    if (t.startsWith('`')) out.push(<code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('*')) out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>)
    else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!
      out.push(<a key={`${key}-${i++}`} href={lm[2]} target="_blank" rel="noreferrer noopener">{lm[1]}</a>)
    }
    last = m.index + t.length
  }
  if (last < text.length) out.push(<Fragment key={`${key}-${i++}`}>{text.slice(last)}</Fragment>)
  return out
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^```(\w*)/.exec(line)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      const src = code.join('\n')
      blocks.push(
        <div key={k++} className="code-wrap md-code">
          <div className="code-bar"><span className="code-lang">{fence[1] || 'code'}</span><CopyButton text={src} /></div>
          <pre className="code-block" tabIndex={0}><code>{src}</code></pre>
        </div>,
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(6, h[1].length + 2)
      const Tag = `h${level}` as 'h3'
      blocks.push(<Tag key={k++} className="md-h">{inline(h[2], `h${k}`)}</Tag>)
      i++
      continue
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={k++}>{items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`)}</li>)}</List>)
      continue
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={k++}>{inline(q.join(' '), `q${k}`)}</blockquote>)
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+|>)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={k++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${k}-${j}`)}</Fragment>)}</p>)
  }
  return <div className="md">{blocks}</div>
}
