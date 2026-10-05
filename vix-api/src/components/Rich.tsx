// Tiny inline renderer for **bold**, `code` and [links](url) in guide text.
import { Fragment, type ReactNode } from 'react'
import { CopyButton } from './ui'

export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>)
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={i++}>{tok.slice(1, -1)}</code>)
    else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      out.push(<a key={i++} href={lm[2]} target="_blank" rel="noreferrer">{lm[1]}</a>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(<Fragment key={i++}>{text.slice(last)}</Fragment>)
  return <>{out}</>
}

export function CodeBlock({ code, lang, label }: { code: string; lang?: string; label?: string }) {
  return (
    <div className="code-wrap">
      <div className="code-bar">
        <span className="code-lang">{label || lang || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="code-block" tabIndex={0} aria-label={`${label || lang || 'Code'} example`}><code>{code}</code></pre>
    </div>
  )
}
