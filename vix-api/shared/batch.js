// A Windows batch (.bat / .cmd) interpreter written in plain JavaScript, so batch
// files run identically in the browser sandbox and in hosted endpoints, with no
// Windows machine involved. It covers the commands real scripts lean on:
// echo, set (/a /p), if/else blocks, for (/l /f), goto, call :label, exit /b,
// setlocal/endlocal, shift, type, dir, redirection (> >>) and pipes into
// find/findstr/sort/more. Every run has a step and output budget so an infinite
// loop ends with an error instead of hanging.

class Jump { constructor(label) { this.label = label } }
class Return { constructor(code) { this.code = code } }
class Exit { constructor(code) { this.code = code } }
class Limit extends Error {}

const CMP = { EQU: (a, b) => a === b, NEQ: (a, b) => a !== b, LSS: (a, b) => a < b, LEQ: (a, b) => a <= b, GTR: (a, b) => a > b, GEQ: (a, b) => a >= b }

/** Splits source into logical lines, joining lines while parentheses are open. */
function logicalLines(source) {
  const raw = String(source).replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let buf = ''
  let depth = 0
  for (let line of raw) {
    // A trailing ^ continues the line.
    while (line.endsWith('^')) line = line.slice(0, -1)
    const trimmed = line.trim()
    if (depth === 0 && /^(rem(\s|$)|::)/i.test(trimmed.replace(/^@/, ''))) {
      out.push(line)
      continue
    }
    let inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (!inQ && ch === '(') depth++
      else if (!inQ && ch === ')' && depth > 0) depth--
    }
    buf = buf ? buf + '\n' + line : line
    if (depth === 0) { out.push(buf); buf = '' }
  }
  if (buf) out.push(buf)
  return out
}

/** Splits on a separator at paren depth 0 and outside quotes. */
function splitTop(str, seps) {
  const parts = []
  let depth = 0, inQ = false, cur = '', i = 0
  outer: while (i < str.length) {
    const ch = str[i]
    if (ch === '^' && i + 1 < str.length) { cur += str[i + 1]; i += 2; continue }
    if (ch === '"') inQ = !inQ
    if (!inQ) {
      if (ch === '(') depth++
      else if (ch === ')') depth = Math.max(0, depth - 1)
      if (depth === 0) {
        for (const sep of seps) {
          if (str.startsWith(sep, i) && !(sep === '|' && str[i + 1] === '|') && !(sep === '&' && str[i + 1] === '&')) {
            parts.push({ text: cur, sep })
            cur = ''
            i += sep.length
            continue outer
          }
        }
      }
    }
    cur += ch
    i++
  }
  parts.push({ text: cur, sep: null })
  return parts
}

function matchParen(str, open) {
  let depth = 0, inQ = false
  for (let i = open; i < str.length; i++) {
    const ch = str[i]
    if (ch === '"') inQ = !inQ
    else if (!inQ && ch === '(') depth++
    else if (!inQ && ch === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

function unquote(s) {
  s = String(s ?? '')
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
}

/** Reads one whitespace-delimited token (quotes kept) starting at i. */
function token(str, i) {
  while (i < str.length && /\s/.test(str[i])) i++
  let start = i, inQ = false
  while (i < str.length) {
    const ch = str[i]
    if (ch === '"') inQ = !inQ
    else if (!inQ && /\s/.test(ch)) break
    i++
  }
  return { tok: str.slice(start, i), end: i }
}

/** Evaluates a `set /a` expression with C-like precedence. */
function arith(expr, getVar, setVar) {
  const src = expr.replace(/"/g, '')
  let pos = 0
  const peek = () => { while (/\s/.test(src[pos] || '')) pos++; return src[pos] }
  const num = (n) => (n | 0)
  function primary() {
    const ch = peek()
    if (ch === '(') { pos++; const v = assign(); if (peek() === ')') pos++; return v }
    if (ch === '-') { pos++; return num(-primary()) }
    if (ch === '+') { pos++; return primary() }
    if (ch === '!') { pos++; return primary() ? 0 : 1 }
    if (ch === '~') { pos++; return num(~primary()) }
    const m = /^(0x[0-9a-f]+|0[0-7]*|\d+)/i.exec(src.slice(pos))
    if (m) { pos += m[0].length; return num(m[0].startsWith('0x') || m[0].startsWith('0X') ? parseInt(m[0], 16) : m[0].length > 1 && m[0][0] === '0' ? parseInt(m[0], 8) : parseInt(m[0], 10)) }
    const v = /^[A-Za-z_][\w.$#@]*/.exec(src.slice(pos))
    if (v) { pos += v[0].length; return num(parseInt(getVar(v[0]), 10) || 0) }
    throw new Error('Invalid number.')
  }
  const levels = [
    [['*', (a, b) => a * b], ['/', (a, b) => { if (!b) throw new Error('Divide by zero error.'); return Math.trunc(a / b) }], ['%', (a, b) => { if (!b) throw new Error('Divide by zero error.'); return a % b }]],
    [['+', (a, b) => a + b], ['-', (a, b) => a - b]],
    [['<<', (a, b) => a << b], ['>>', (a, b) => a >> b]],
    [['&', (a, b) => a & b]],
    [['^', (a, b) => a ^ b]],
    [['|', (a, b) => a | b]],
  ]
  function level(n) {
    if (n < 0) return primary()
    let v = level(n - 1)
    for (;;) {
      peek()
      const op = levels[n].find(([o]) => src.startsWith(o, pos) && src[pos + o.length] !== '=' && !(o === '<' || o === '>'))
      if (!op) return v
      pos += op[0].length
      v = num(op[1](v, level(n - 1)))
    }
  }
  function assign() {
    const save = pos
    peek()
    const m = /^([A-Za-z_][\w.$#@]*)\s*(\*=|\/=|%=|\+=|-=|&=|\^=|\|=|<<=|>>=|=)(?!=)/.exec(src.slice(pos))
    if (m) {
      pos += m[0].length
      const rhs = assign()
      const cur = parseInt(getVar(m[1]), 10) || 0
      const ops = { '=': () => rhs, '+=': () => cur + rhs, '-=': () => cur - rhs, '*=': () => cur * rhs, '/=': () => Math.trunc(cur / rhs), '%=': () => cur % rhs, '&=': () => cur & rhs, '|=': () => cur | rhs, '^=': () => cur ^ rhs, '<<=': () => cur << rhs, '>>=': () => cur >> rhs }
      const v = num(ops[m[2]]())
      setVar(m[1], String(v))
      return v
    }
    pos = save
    return level(levels.length - 1)
  }
  let last = 0
  for (;;) {
    last = assign()
    if (peek() === ',') { pos++; continue }
    break
  }
  return last
}

/**
 * Runs a batch script.
 * @param {string} source
 * @param {{stdin?: string, env?: Record<string,string>, files?: Record<string,string>, args?: string[], maxSteps?: number, maxOutput?: number, now?: Date}} [opts]
 * @returns {{stdout: string, stderr: string, exitCode: number, files: Record<string,string>}}
 */
export function runBatch(source, opts = {}) {
  const lines = logicalLines(source)
  const labels = new Map()
  lines.forEach((l, i) => {
    const t = l.trim().replace(/^@/, '')
    if (t.startsWith(':') && !t.startsWith('::')) labels.set(t.slice(1).split(/\s/)[0].toLowerCase(), i)
  })
  const files = { ...(opts.files || {}) }
  const stdinLines = String(opts.stdin || '').replace(/\r\n?/g, '\n').split('\n')
  let stdinPos = 0
  const maxSteps = opts.maxSteps ?? 50000
  const maxOutput = opts.maxOutput ?? 256 * 1024
  const now = opts.now || new Date()
  let steps = 0
  let stdout = '', stderr = ''
  let echoOn = true
  let errorlevel = 0
  let delayed = false
  let env = new Map()
  const localStack = []
  for (const [k, v] of Object.entries({ COMSPEC: 'C:\\Windows\\system32\\cmd.exe', OS: 'Windows_NT', PATHEXT: '.COM;.EXE;.BAT;.CMD', USERNAME: 'vix', COMPUTERNAME: 'VIX-SANDBOX', PROMPT: '$P$G', ...(opts.env || {}) })) env.set(k.toUpperCase(), { name: k, value: String(v) })

  // Output goes through a stack so redirection and pipes can capture it.
  const sinks = [{ write: (s) => { stdout += s } }]
  const write = (s) => {
    if (stdout.length + stderr.length > maxOutput) throw new Limit('Output limit reached.')
    sinks[sinks.length - 1].write(s)
  }
  const writeErr = (s) => { stderr += s }

  const getVar = (name) => {
    const up = name.toUpperCase()
    if (up === 'RANDOM') return String(Math.floor(Math.random() * 32768))
    if (up === 'ERRORLEVEL') return String(errorlevel)
    if (up === 'CD') return 'C:\\vix'
    if (up === 'DATE') return now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(',', '')
    if (up === 'TIME') return now.toTimeString().slice(0, 8) + '.00'
    if (up === 'CMDCMDLINE') return 'cmd.exe /c script.bat'
    return env.get(up)?.value
  }
  const setVar = (name, value) => {
    if (value === '' || value == null) env.delete(name.toUpperCase())
    else env.set(name.toUpperCase(), { name, value: String(value) })
  }

  function expandVarRef(inner, args) {
    // %VAR:~start,len% and %VAR:old=new%
    const colon = inner.indexOf(':')
    if (colon > 0) {
      const name = inner.slice(0, colon)
      const mod = inner.slice(colon + 1)
      const val = getVar(name)
      if (val === undefined) return null
      if (mod.startsWith('~')) {
        const [a, b] = mod.slice(1).split(',').map((x) => parseInt(x, 10))
        let start = isNaN(a) ? 0 : a < 0 ? Math.max(0, val.length + a) : a
        let end = b === undefined || isNaN(b) ? val.length : b < 0 ? val.length + b : start + b
        return val.slice(start, Math.max(start, end))
      }
      const eq = mod.indexOf('=')
      if (eq >= 0) {
        let from = mod.slice(0, eq)
        const to = mod.slice(eq + 1)
        if (!from) return val
        const star = from.startsWith('*')
        if (star) from = from.slice(1)
        const idx = val.toLowerCase().indexOf(from.toLowerCase())
        if (star) return idx < 0 ? val : to + val.slice(idx + from.length)
        return val.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => to)
      }
    }
    return getVar(inner) ?? null
  }

  function expandPercent(text, args) {
    let out = ''
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch !== '%') { out += ch; continue }
      const next = text[i + 1]
      if (next === '%') { out += '%'; i++; continue }
      if (next === '*') { out += args.slice(1).join(' '); i++; continue }
      const tilde = /^~([fdpnxsatz]*)(\d)/.exec(text.slice(i + 1))
      if (tilde) { out += unquote(args[+tilde[2]] ?? ''); i += tilde[0].length; continue }
      if (next && /\d/.test(next)) { out += args[+next] ?? ''; i++; continue }
      const close = text.indexOf('%', i + 1)
      if (close < 0) { out += ch; continue }
      const inner = text.slice(i + 1, close)
      if (/[\s"]/.test(inner) || !inner) { out += ch; continue }
      const val = expandVarRef(inner, args)
      out += val ?? ''
      i = close
    }
    return out
  }

  function expandDelayed(text) {
    if (!delayed) return text
    return text.replace(/!([^!\s]+)!/g, (_, inner) => expandVarRef(inner, []) ?? '')
  }

  function step() {
    if (++steps > maxSteps) throw new Limit('Step limit reached - is there an infinite loop?')
  }

  function readFile(name) {
    const key = Object.keys(files).find((k) => k.toLowerCase() === unquote(name).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase())
    return key === undefined ? null : files[key]
  }

  // Runs one statement (possibly with &, &&, ||, pipes and redirection).
  function exec(stmt, args, pipeIn) {
    stmt = stmt.trim()
    if (!stmt) return
    const chain = splitTop(stmt, ['&&', '||', '&'])
    if (chain.length > 1) {
      let prevSep = null
      for (const part of chain) {
        if (prevSep === '&&' && lastFailed) { prevSep = part.sep; continue }
        if (prevSep === '||' && !lastFailed) { prevSep = part.sep; continue }
        exec(part.text, args, pipeIn)
        prevSep = part.sep
      }
      return
    }
    const pipe = splitTop(stmt, ['|'])
    if (pipe.length > 1) {
      let input = pipeIn
      for (let i = 0; i < pipe.length; i++) {
        if (i === pipe.length - 1) { exec(pipe[i].text, args, input); break }
        let buf = ''
        sinks.push({ write: (s) => { buf += s } })
        try { exec(pipe[i].text, args, input) } finally { sinks.pop() }
        input = buf
      }
      return
    }
    // Redirection: cmd > file, >> file, 2>nul, 2>&1
    let redirect = null
    let body = stmt
    if (!/^\s*@?\s*(if|for)\b/i.test(body) && !/^\s*@?\s*\(/.test(body)) {
      const r = extractRedirects(body)
      body = r.body
      redirect = r.redirect
    }
    if (redirect) {
      let buf = ''
      sinks.push({ write: (s) => { buf += s } })
      try { command(body, args, pipeIn) } finally { sinks.pop() }
      const target = redirect.file.toLowerCase()
      if (target !== 'nul' && target !== 'con') {
        const prev = redirect.append ? readFile(redirect.file) ?? '' : ''
        files[redirect.file.replace(/\\/g, '/')] = prev + buf
      } else if (target === 'con') write(buf)
      return
    }
    command(body, args, pipeIn)
  }

  // Pulls `> file`, `>> file`, `2>nul`, `2>&1` and `< file` out of a simple command.
  function extractRedirects(text) {
    let body = '', redirect = null, inQ = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '"') inQ = !inQ
      if (inQ || (ch !== '>' && ch !== '<')) { body += ch; continue }
      let fd = '1'
      if (/\d$/.test(body) && /(^|\s)\d$/.test(body)) { fd = body.slice(-1); body = body.slice(0, -1) }
      if (ch === '<') { const t = token(text, i + 1); i = t.end - 1; continue }
      let append = false
      if (text[i + 1] === '>') { append = true; i++ }
      if (text[i + 1] === '&') { i += 2; continue }
      const t = token(text, i + 1)
      i = t.end - 1
      if (fd === '1') redirect = { file: unquote(t.tok), append }
    }
    return { body: body.replace(/\s+$/, ''), redirect }
  }

  function runBlock(text, args) {
    // text is the inside of ( ... ); statements are separated by newlines.
    const stmts = []
    let depth = 0, inQ = false, cur = ''
    for (const ch of text) {
      if (ch === '"') inQ = !inQ
      if (!inQ && ch === '(') depth++
      if (!inQ && ch === ')') depth--
      if (ch === '\n' && depth === 0) { stmts.push(cur); cur = ''; continue }
      cur += ch
    }
    stmts.push(cur)
    for (const s of stmts) {
      const t = s.trim()
      if (!t || /^(rem(\s|$)|::)/i.test(t)) continue
      exec(expandDelayed(t), args)
    }
  }

  // Runs a command body that may be a ( block ).
  function runBody(text, args) {
    const t = text.trim()
    if (t.startsWith('(')) {
      const close = matchParen(t, 0)
      runBlock(t.slice(1, close < 0 ? undefined : close), args)
    } else exec(t, args)
  }

  function evalIf(rest) {
    let i = 0
    let ci = false, negate = false
    let { tok, end } = token(rest, i)
    if (tok.toLowerCase() === '/i') { ci = true; ({ tok, end } = token(rest, end)) }
    if (tok.toLowerCase() === 'not') { negate = true; ({ tok, end } = token(rest, end)) }
    let result
    const low = tok.toLowerCase()
    if (low === 'errorlevel') {
      const n = token(rest, end); end = n.end
      result = errorlevel >= parseInt(n.tok, 10)
    } else if (low === 'defined') {
      const n = token(rest, end); end = n.end
      result = getVar(n.tok) !== undefined
    } else if (low === 'exist') {
      const n = token(rest, end); end = n.end
      result = readFile(n.tok) !== null
    } else {
      // a==b or a OP b
      let left = tok, right, op = '=='
      const eq = splitEq(rest, rest.indexOf(tok) === -1 ? 0 : rest.indexOf(tok, i))
      if (eq) { left = eq.left; right = eq.right; end = eq.end }
      else {
        const o = token(rest, end); const r = token(rest, o.end)
        op = o.tok.toUpperCase(); right = r.tok; end = r.end
      }
      let a = unquote(left), b = unquote(right)
      if (ci) { a = a.toLowerCase(); b = b.toLowerCase() }
      if (op === '==') result = a === b
      else if (CMP[op]) {
        const na = Number(a), nb = Number(b)
        result = !isNaN(na) && !isNaN(nb) && a !== '' && b !== '' ? CMP[op](na, nb) : CMP[op](a, b)
      } else throw new Error(`${op} was unexpected at this time.`)
    }
    return { result: negate ? !result : result, end }
  }

  // Finds `left==right` beginning at index start.
  function splitEq(rest, start) {
    let i = start
    while (/\s/.test(rest[i] || '')) i++
    let inQ = false, j = i
    while (j < rest.length) {
      if (rest[j] === '"') inQ = !inQ
      if (!inQ && rest.startsWith('==', j)) break
      if (!inQ && /\s/.test(rest[j])) {
        // allow "a == b" with spaces around ==
        let k = j
        while (/\s/.test(rest[k] || '')) k++
        if (rest.startsWith('==', k)) { const left = rest.slice(i, j); return finish(left, k) }
        return null
      }
      j++
    }
    if (j >= rest.length) return null
    return finish(rest.slice(i, j), j)
    function finish(left, eqAt) {
      const r = token(rest, eqAt + 2)
      return { left, right: r.tok, end: r.end }
    }
  }

  function runFor(rest, args) {
    // for [/l|/f ["opts"]|/d|/r] %%v in (set) do command
    let i = 0
    let mode = '', fopts = ''
    let t = token(rest, i)
    if (t.tok.startsWith('/')) {
      mode = t.tok.toLowerCase()
      i = t.end
      if (mode === '/f') {
        const o = token(rest, i)
        if (o.tok.startsWith('"')) { fopts = unquote(o.tok); i = o.end }
      }
      t = token(rest, i)
    }
    const varTok = t.tok
    const v = varTok.replace(/^%%?/, '')
    i = t.end
    const inTok = token(rest, i)
    if (inTok.tok.toLowerCase() !== 'in') throw new Error('The syntax of the command is incorrect.')
    const open = rest.indexOf('(', inTok.end)
    const close = matchParen(rest, open)
    if (open < 0 || close < 0) throw new Error('The syntax of the command is incorrect.')
    const setText = rest.slice(open + 1, close).trim()
    const doTok = token(rest, close + 1)
    if (doTok.tok.toLowerCase() !== 'do') throw new Error('The syntax of the command is incorrect.')
    const cmdText = rest.slice(doTok.end)

    let items = []
    if (mode === '/l') {
      const [s, st, e] = setText.split(/[\s,]+/).map((x) => parseInt(x, 10))
      if (st === 0) throw new Limit('FOR /L with a step of 0 never ends.')
      for (let n = s; st > 0 ? n <= e : n >= e; n += st) { items.push([String(n)]); if (items.length > maxSteps) throw new Limit('Step limit reached.') }
    } else if (mode === '/f') {
      const opt = {}
      for (const m of fopts.matchAll(/(tokens|delims|skip|eol|usebackq)=?((?:[^ ]| (?=$))*)/gi)) opt[m[1].toLowerCase()] = m[2]
      const dm = /delims=([^"]*?)(?:\s+(?:tokens|skip|eol|usebackq)=|$)/i.exec(fopts)
      const delims = dm ? dm[1] : ' \t'
      let source
      if (setText.startsWith('"') || (opt.usebackq !== undefined && setText.startsWith("'"))) source = unquote(setText.replace(/^'|'$/g, '"'))
      else if (setText.startsWith("'")) {
        let buf = ''
        sinks.push({ write: (s) => { buf += s } })
        try { exec(setText.slice(1, -1), args) } finally { sinks.pop() }
        source = buf
      } else source = setText.split(/\s+/).map((f) => readFile(f) ?? '').join('\n')
      const skip = parseInt(opt.skip || '0', 10)
      const tokSpec = (opt.tokens || '1').trim()
      for (const line of source.split('\n').slice(skip)) {
        if (!line.trim() || (opt.eol ?? ';') && line.startsWith(opt.eol ?? ';')) continue
        const parts = delims ? line.split(new RegExp(`[${delims.replace(/[\]\\^-]/g, '\\$&')}]+`)).filter((p, idx) => p !== '' || idx > 0) : [line]
        const picked = []
        for (const spec of tokSpec.split(',')) {
          if (spec === '*') { picked.push(parts.join(delims[0] || ' ')); break }
          if (spec.endsWith('*')) { const n = parseInt(spec, 10); picked.push(parts[n - 1] ?? ''); picked.push(parts.slice(n).join(delims[0] || ' ')); break }
          const range = /^(\d+)-(\d+)$/.exec(spec)
          if (range) for (let n = +range[1]; n <= +range[2]; n++) picked.push(parts[n - 1] ?? '')
          else picked.push(parts[parseInt(spec, 10) - 1] ?? '')
        }
        items.push(picked)
      }
    } else {
      for (const m of setText.matchAll(/"[^"]*"|[^\s,;=]+/g)) {
        const it = m[0]
        if (/[*?]/.test(it)) {
          const re = new RegExp('^' + unquote(it).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
          for (const f of Object.keys(files)) if (re.test(f.split('/').pop())) items.push([f])
        } else items.push([it])
      }
    }
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for (const vals of items) {
      step()
      let body = cmdText
      vals.forEach((val, idx) => {
        const name = idx === 0 ? v : letters[(letters.indexOf(v) + idx) % letters.length]
        body = body.split(`%%~${name}`).join(unquote(val)).split(`%%${name}`).join(val).split(`%~${name}`).join(unquote(val)).split(`%${name}`).join(val)
      })
      runBody(expandDelayed(body), args)
    }
  }

  function command(text, args, pipeIn) {
    step()
    lastFailed = false
    const before = errorlevel
    try { commandInner(text, args, pipeIn) } finally { if (errorlevel !== before && errorlevel !== 0) lastFailed = true }
  }

  function commandInner(text, args, pipeIn) {
    let t = text.replace(/^\s*@/, '').trim()
    if (!t) return
    if (t.startsWith('(')) { runBody(t, args); return }
    if (t.startsWith(':')) return
    // "echo." / "echo:" / "echo(" have no space after the verb.
    const ev = /^echo([.:(;,\/+[\]])(.*)$/is.exec(t)
    if (ev) { write(ev[2] + '\n'); errorlevel = 0; return }
    const { tok, end } = token(t, 0)
    const name = tok.toLowerCase()
    const rest = t.slice(end).replace(/^\s/, '')
    switch (name) {
      case 'rem': case '::': return
      case 'echo': {
        const r = rest.trim().toLowerCase()
        if (!rest.trim()) { write(`ECHO is ${echoOn ? 'on' : 'off'}.\n`); return }
        if (r === 'off' || r === 'on') { echoOn = r === 'on'; return }
        write(rest + '\n')
        return
      }
      case 'set': return doSet(rest)
      case 'setlocal': {
        localStack.push(new Map(env))
        if (/enabledelayedexpansion/i.test(rest)) delayed = true
        if (/disabledelayedexpansion/i.test(rest)) delayed = false
        return
      }
      case 'endlocal': { const prev = localStack.pop(); if (prev) env = prev; return }
      case 'if': {
        const { result, end: e } = evalIf(rest)
        const after = rest.slice(e).trim()
        let thenPart = after, elsePart = null
        if (after.startsWith('(')) {
          const close = matchParen(after, 0)
          thenPart = after.slice(0, close + 1)
          const tail = after.slice(close + 1).trim()
          if (/^else\b/i.test(tail)) elsePart = tail.slice(4).trim()
        } else {
          const m = /\s+else\s+/i.exec(after)
          if (m) { thenPart = after.slice(0, m.index); elsePart = after.slice(m.index + m[0].length) }
        }
        if (result) runBody(thenPart, args)
        else if (elsePart) runBody(elsePart, args)
        return
      }
      case 'for': return runFor(rest, args)
      case 'goto': {
        const label = rest.trim().replace(/^:/, '').split(/\s/)[0].toLowerCase()
        if (label === 'eof') throw new Return(errorlevel)
        if (!labels.has(label)) { writeErr(`The system cannot find the batch label specified - ${label}\n`); throw new Exit(1) }
        throw new Jump(label)
      }
      case 'call': {
        const r = rest.trim()
        if (r.startsWith(':')) {
          const parts = r.match(/"[^"]*"|\S+/g) || []
          const label = parts[0].slice(1).toLowerCase()
          if (label === 'eof') return
          if (!labels.has(label)) { writeErr(`The system cannot find the batch label specified - ${label}\n`); errorlevel = 1; return }
          if (depth > 200) throw new Limit('Call stack too deep.')
          depth++
          try { run(labels.get(label) + 1, [parts[0], ...parts.slice(1)]) } finally { depth-- }
          return
        }
        exec(expandPercent(r, args), args, pipeIn)
        return
      }
      case 'exit': {
        const m = /^\/b\s*(\S*)/i.exec(rest.trim())
        if (m) throw new Return(m[1] ? parseInt(m[1], 10) || 0 : errorlevel)
        const code = parseInt(rest.trim(), 10)
        throw new Exit(isNaN(code) ? errorlevel : code)
      }
      case 'shift': args.splice(1, 1); return
      case 'pause': write('Press any key to continue . . . \n'); return
      case 'cls': case 'title': case 'color': case 'mode': case 'chcp': case 'prompt': case 'timeout': case 'ping': case 'cd.': return
      case 'ver': write('\nMicrosoft Windows [Version 10.0.22631.0] (Vix Api batch emulator)\n'); return
      case 'whoami': write('vix-sandbox\\vix\n'); return
      case 'hostname': write('VIX-SANDBOX\n'); return
      case 'cd': case 'chdir': if (!rest.trim()) write('C:\\vix\n'); return
      case 'date': if (/\/t/i.test(rest)) write(getVar('DATE') + '\n'); return
      case 'time': if (/\/t/i.test(rest)) write(getVar('TIME').slice(0, 5) + '\n'); return
      case 'type': {
        const content = readFile(rest.trim())
        if (content === null) { writeErr('The system cannot find the file specified.\n'); errorlevel = 1; return }
        write(content.endsWith('\n') ? content : content + '\n')
        errorlevel = 0
        return
      }
      case 'dir': {
        const names = Object.keys(files).sort()
        write(' Directory of C:\\vix\n\n')
        for (const n of names) write(`${String(files[n].length).padStart(10)} ${n.replace(/\//g, '\\')}\n`)
        write(`${String(names.length).padStart(16)} File(s)\n`)
        return
      }
      case 'del': case 'erase': {
        for (const f of rest.trim().split(/\s+/)) {
          const key = Object.keys(files).find((k) => k.toLowerCase() === unquote(f).toLowerCase())
          if (key) delete files[key]
        }
        return
      }
      case 'copy': {
        const parts = rest.match(/"[^"]*"|\S+/g) || []
        const src = readFile(parts[0] || '')
        if (src === null || !parts[1]) { writeErr('The system cannot find the file specified.\n'); errorlevel = 1; return }
        files[unquote(parts[1])] = src
        write('        1 file(s) copied.\n')
        return
      }
      case 'mkdir': case 'md': case 'rmdir': case 'rd': return
      case 'find': case 'findstr': {
        const m = /"([^"]*)"|(\S+)/.exec(rest.replace(/\/[a-z]\s*/gi, ''))
        const needle = m ? (m[1] ?? m[2]) : ''
        const ci = /\/i/i.test(rest)
        const invert = /\/v/i.test(rest)
        let hit = false
        for (const line of String(pipeIn ?? '').split('\n')) {
          if (!line && !needle) continue
          const has = ci ? line.toLowerCase().includes(needle.toLowerCase()) : line.includes(needle)
          if (has !== invert && line !== '') { write(line + '\n'); hit = true }
        }
        errorlevel = hit ? 0 : 1
        return
      }
      case 'sort': {
        const ls = String(pipeIn ?? '').split('\n').filter(Boolean).sort((a, b) => a.localeCompare(b))
        if (/\/r/i.test(rest)) ls.reverse()
        for (const l of ls) write(l + '\n')
        return
      }
      case 'more': write(String(pipeIn ?? '')); return
      case 'choice': {
        const line = stdinLines[stdinPos++] ?? ''
        const choices = (/\/c\s*(\S+)/i.exec(rest)?.[1] || 'YN').toUpperCase()
        const idx = choices.indexOf((line[0] || choices[0]).toUpperCase())
        errorlevel = idx < 0 ? 1 : idx + 1
        return
      }
      default:
        writeErr(`'${tok}' is not recognized as an internal or external command,\noperable program or batch file.\n`)
        errorlevel = 9009
        lastFailed = true
    }
  }

  function doSet(rest) {
    const r = rest.trim()
    if (!r) {
      for (const { name, value } of [...env.values()].sort((a, b) => a.name.localeCompare(b.name))) write(`${name}=${value}\n`)
      return
    }
    if (/^\/a\b/i.test(r)) {
      const expr = r.slice(2).trim()
      try {
        const v = arith(unquote(expr), (n) => getVar(n) ?? '0', setVar)
        if (!/=/.test(expr.replace(/==/g, ''))) write(String(v))
        errorlevel = 0
      } catch (e) { writeErr(e.message + '\n'); errorlevel = 1073750993 }
      return
    }
    if (/^\/p\b/i.test(r)) {
      const body = unquote(r.slice(2).trim())
      const eq = body.indexOf('=')
      const name = body.slice(0, eq)
      const prompt = body.slice(eq + 1)
      if (prompt) write(prompt)
      const line = stdinLines[stdinPos++]
      if (line === undefined || (stdinPos > stdinLines.length)) { errorlevel = 1; return }
      setVar(name, line)
      if (prompt) write('\n')
      return
    }
    let body = r
    if (body.startsWith('"')) { const last = body.lastIndexOf('"'); body = body.slice(1, last) }
    const eq = body.indexOf('=')
    if (eq < 0) {
      const prefix = body.toUpperCase()
      let found = false
      for (const { name, value } of env.values()) if (name.toUpperCase().startsWith(prefix)) { write(`${name}=${value}\n`); found = true }
      if (!found) { write(`Environment variable ${body} not defined\n`); errorlevel = 1 }
      return
    }
    setVar(body.slice(0, eq), body.slice(eq + 1))
    errorlevel = 0
  }

  let depth = 0
  let lastFailed = false
  function run(startPc, args) {
    let pc = startPc
    while (pc < lines.length) {
      const line = lines[pc]
      const trimmed = line.trim()
      pc++
      if (!trimmed || trimmed.startsWith(':')) continue
      const quiet = trimmed.startsWith('@')
      try {
        const expanded = expandPercent(trimmed.replace(/^@/, ''), args)
        if (echoOn && !quiet && depth === 0) write(`\nC:\\vix>${expanded}\n`)
        exec(expandDelayed(expanded), args)
      } catch (e) {
        if (e instanceof Jump) { pc = labels.get(e.label) + 1; continue }
        if (e instanceof Return) { errorlevel = e.code; return }
        throw e
      }
    }
  }

  let exitCode = 0
  try {
    run(0, ['script.bat', ...(opts.args || [])])
    exitCode = errorlevel
  } catch (e) {
    if (e instanceof Exit) exitCode = e.code
    else if (e instanceof Limit) { stderr += `\n[vix] ${e.message}\n`; exitCode = 1 }
    else { stderr += `${e && e.message ? e.message : e}\n`; exitCode = 1 }
  }
  if (echoOn) stdout = stdout.replace(/^\n/, '')
  return { stdout, stderr, exitCode, files }
}
