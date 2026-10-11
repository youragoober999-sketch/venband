// The chat app for a Vix AI.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Icon, IconButton, Spinner, ask } from './ui'
import { MarkdownLite } from './MarkdownLite'
import { api, ApiError } from '../lib/api'
import { useApp } from '../lib/store'
import { cx, speak, timeAgo } from '../lib/util'
import { browserChat, browserComplete, cloudChat, gpuInfo, isCached, loadModel, onProgress, currentModel, stopGenerating, type ChatMsg, type GpuInfo } from '../lib/llm'
import { BROWSER_MODELS, checkInput, checkOutput, fitHistory, selfCheckVerdict, splitThinking } from '../../shared/ai.js'

export type AiView = {
  id: string
  slug: string
  name: string
  avatar: string
  tagline: string
  greeting: string
  engine: 'browser' | 'cloud'
  model: string
  access: string
  owner_username: string
  is_owner: boolean
  settings: { temperature: number; maxTokens: number; think: boolean; showThinking: boolean; memory?: boolean; autoLearn?: boolean }
  rules: Record<string, any>
  [k: string]: any
}

type Msg = { role: 'user' | 'assistant'; content: string; at: string; blocked?: boolean; error?: boolean; feedback?: 'up' | 'down'; pending?: boolean }
type ChatMeta = { id: string; title: string; updated_at: string }

const uuid = () => crypto.randomUUID()

export function AiChat({ ai }: { ai: AiView }) {
  const { settings, announce, toast } = useApp()
  const [chats, setChats] = useState<ChatMeta[]>([])
  const [chatId, setChatId] = useState<string>(() => uuid())
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [cached, setCached] = useState<boolean | null>(null)
  const [ready, setReady] = useState(ai.engine === 'cloud')
  const [progress, setProgress] = useState<{ text: string; value: number } | null>(null)
  const [showList, setShowList] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const model = BROWSER_MODELS.find((m) => m.id === ai.model) || BROWSER_MODELS.find((m) => m.id === ai.model.replace(/-1k$/, ''))
  const modelName = model?.name || ai.model

  const loadChats = useCallback(() => {
    api.get<{ chats: ChatMeta[] }>(`/ais/${ai.id}/chats`).then((r) => setChats(r.chats)).catch(() => {})
  }, [ai.id])

  useEffect(() => { loadChats() }, [loadChats])

  // Browser engine: check WebGPU and whether the model is already downloaded.
  useEffect(() => {
    if (ai.engine !== 'browser') { setReady(true); return }
    setReady(currentModel() === ai.model)
    gpuInfo().then(setGpu)
    isCached(ai.model).then(setCached)
  }, [ai.engine, ai.model])

  useEffect(() => onProgress((r) => setProgress({ text: r.text, value: r.progress })), [])

  // Auto-start a model that is already downloaded.
  useEffect(() => {
    if (ai.engine === 'browser' && cached && gpu?.supported && !ready && !progress) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached, gpu])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: settings.reduceMotion === 'on' ? 'auto' : 'smooth' })
  }, [messages, settings.reduceMotion])

  async function start() {
    setProgress({ text: 'Starting…', value: 0 })
    try {
      await loadModel(ai.model)
      setReady(true)
      setCached(true)
      announce(`${modelName} is ready`)
    } catch (e) {
      toast(`Could not start the model: ${(e as Error).message}`, 'error')
    } finally {
      setProgress(null)
    }
  }

  async function openChat(id: string) {
    if (busy) return
    const r = await api.get<{ chat: { id: string; messages: Msg[] } }>(`/ais/${ai.id}/chats/${id}`)
    setChatId(id)
    setMessages(r.chat.messages)
    inputRef.current?.focus()
  }

  function newChat() {
    if (busy) return
    setChatId(uuid())
    setMessages([])
    inputRef.current?.focus()
  }

  async function deleteChat(id: string) {
    if (!(await ask({ title: 'Delete this chat?', confirm: 'Delete', danger: true }))) return
    await api.del(`/ais/${ai.id}/chats/${id}`)
    if (id === chatId) newChat()
    loadChats()
  }

  const save = useCallback(async (id: string, msgs: Msg[]) => {
    const firstUser = msgs.find((m) => m.role === 'user')?.content || 'New chat'
    try {
      await api.put(`/ais/${ai.id}/chats/${id}`, { title: firstUser.slice(0, 60), messages: msgs.filter((m) => !m.pending) })
      loadChats()
    } catch { /* saving is best-effort */ }
  }, [ai.id, loadChats])

  async function respond(history: Msg[]) {
    const last = history[history.length - 1]
    const id = chatId
    setBusy(true)
    const setAssistant = (content: string, extra: Partial<Msg> = {}) =>
      setMessages([...history, { role: 'assistant', content, at: new Date().toISOString(), pending: true, ...extra }])
    setAssistant('')
    let final: Msg = { role: 'assistant', content: '', at: new Date().toISOString() }
    try {
      if (ai.engine === 'cloud') {
        abortRef.current = new AbortController()
        const res = await cloudChat(ai.id, history.map(({ role, content }) => ({ role, content })), (full) => setAssistant(full), abortRef.current.signal)
        final = { ...final, content: res.text, blocked: res.blocked }
      } else {
        if (!ready) await start()
        const quick = checkInput(last.content, ai.rules)
        let prep: { blocked: boolean; refusal?: string; reason?: string; system?: string; check?: ChatMsg[] | null }
        if (!quick.ok) prep = { blocked: true, refusal: ai.rules.refusal, reason: quick.reason }
        else prep = await api.post(`/ais/${ai.id}/prepare`, { message: last.content, history: history.slice(0, -1).map(({ role, content }) => ({ role, content })) })
        if (prep.blocked) {
          final = { ...final, content: prep.refusal || ai.rules.refusal, blocked: true }
        } else {
          let allowed = true
          if (prep.check) {
            setAssistant('', { content: '' })
            const verdict = selfCheckVerdict(await browserComplete(ai.model, prep.check))
            if (verdict === 'BLOCK') {
              allowed = false
              final = { ...final, content: ai.rules.refusal, blocked: true }
              api.post(`/ais/${ai.id}/events`, { kind: 'blocked_selfcheck', detail: 'AI double-check flagged the request', message: last.content }).catch(() => {})
            }
          }
          if (allowed) {
            const system = prep.system!
            const convo = fitHistory(system, ai.settings.memory === false ? [last] : history.map(({ role, content }) => ({ role, content })), { contextTokens: 4096, reserveTokens: Math.min(1500, ai.settings.maxTokens + 100) })
            const text = await browserChat(ai.model, [{ role: 'system', content: system }, ...convo], {
              temperature: ai.settings.temperature,
              maxTokens: ai.settings.maxTokens,
              think: ai.settings.think,
              onDelta: (full) => setAssistant(checkOutput(full, ai.rules).text),
            })
            const out = checkOutput(text, ai.rules)
            if (out.blocked) api.post(`/ais/${ai.id}/events`, { kind: 'blocked_output', detail: out.reason, message: last.content }).catch(() => {})
            final = { ...final, content: out.text, blocked: out.blocked }
          }
        }
      }
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e)
      if ((e as Error).name === 'AbortError') final = { ...final, content: '(stopped)' }
      else final = { ...final, content: `⚠️ ${msg}`, error: true }
    } finally {
      abortRef.current = null
      setBusy(false)
    }
    const next = [...history, final]
    setMessages(next)
    const answer = splitThinking(final.content).answer
    announce(settings.srVerbose ? `${ai.name} says: ${answer.slice(0, 500)}` : `${ai.name} replied`)
    if (settings.extensions['speak-output']) speak(answer)
    save(id, next)
    inputRef.current?.focus()
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const history: Msg[] = [...messages, { role: 'user', content: text, at: new Date().toISOString() }]
    setMessages(history)
    await respond(history)
  }

  async function regenerate() {
    const lastUser = messages.map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0 || busy) return
    await respond(messages.slice(0, lastUser + 1))
  }

  async function stop() {
    abortRef.current?.abort()
    await stopGenerating()
  }

  async function feedback(i: number, kind: 'up' | 'down') {
    const m = messages[i]
    const q = messages.slice(0, i).reverse().find((x) => x.role === 'user')?.content || ''
    const next = messages.map((x, j) => (j === i ? { ...x, feedback: kind } : x))
    setMessages(next)
    save(chatId, next)
    try {
      const r = await api.post<{ learned?: boolean }>(`/ais/${ai.id}/events`, { kind: kind === 'up' ? 'feedback_up' : 'feedback_down', q, a: m.content, message: q, detail: splitThinking(m.content).answer.slice(0, 400) })
      toast(r.learned ? `${ai.name} learned from that answer` : 'Thanks for the feedback!', 'success')
    } catch { /* ignore */ }
  }

  const needsDownload = ai.engine === 'browser' && !ready
  const gpuBlocked = ai.engine === 'browser' && gpu && !gpu.supported

  return (
    <div className={cx('ai-chat', !showList && 'no-list')}>
      {showList && (
        <aside className="ai-chat-list" aria-label="Your chats">
          <Button variant="primary" icon="plus" onClick={newChat} className="w-full">New chat</Button>
          <ul>
            {chats.map((c) => (
              <li key={c.id} className={cx(c.id === chatId && 'active')}>
                <button type="button" className="ai-chat-link" aria-current={c.id === chatId ? 'true' : undefined} onClick={() => openChat(c.id)}>
                  <span className="ai-chat-title">{c.title}</span>
                  <span className="hint">{timeAgo(c.updated_at)}</span>
                </button>
                <IconButton icon="trash" label={`Delete chat ${c.title}`} onClick={() => deleteChat(c.id)} size={14} />
              </li>
            ))}
            {!chats.length && <li className="hint ai-chat-empty">Your conversations are saved here.</li>}
          </ul>
        </aside>
      )}
      <section className="ai-chat-main" aria-label={`Chat with ${ai.name}`}>
        <div className="ai-chat-bar">
          <IconButton icon="layout" label={showList ? 'Hide chat list' : 'Show chat list'} onClick={() => setShowList((s) => !s)} />
          <span className="ai-avatar sm" aria-hidden="true">{ai.avatar}</span>
          <strong>{ai.name}</strong>
          <span className="hint">{ai.engine === 'cloud' ? 'Cloud brain' : `${modelName} · runs on your device`}</span>
          {ai.rules.preset === 'kids' && <span className="badge badge-good">Kids-safe</span>}
        </div>
        <div className="ai-messages" ref={logRef} role="log" aria-live="off" aria-label="Messages">
          {gpuBlocked && (
            <div className="info-box warn"><Icon name="alert" /><div><strong>This device can't run local AI models.</strong> {gpu!.reason}</div></div>
          )}
          {needsDownload && !gpuBlocked && (
            <div className="model-gate">
              <span className="ai-avatar lg" aria-hidden="true">{ai.avatar}</span>
              <h2>{ai.name} runs on your own device</h2>
              <p className="hint">The AI brain ({modelName}{model ? `, about ${model.vramGB} GB` : ''}) downloads once and is then cached by your browser. After that it starts in seconds, works privately and costs nothing.</p>
              {gpu?.supported && gpu.maxBufferGB !== undefined && model && gpu.maxBufferGB < 1 && <p className="hint">Your GPU looks small - if loading fails, pick a smaller brain.</p>}
              {progress ? (
                <div className="progress-wrap" role="status" aria-live="polite">
                  <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.value * 100)} aria-label="Model loading">
                    <span style={{ width: `${Math.round(progress.value * 100)}%` }} />
                  </div>
                  <span className="hint">{progress.text}</span>
                </div>
              ) : (
                <Button variant="primary" size="lg" icon="download" onClick={start} disabled={!gpu?.supported}>{cached ? `Start ${modelName}` : `Download & start ${modelName}`}</Button>
              )}
              {gpu?.supported && <p className="hint small">GPU: {gpu.description}</p>}
            </div>
          )}
          {(ai.greeting && (!needsDownload || messages.length > 0)) && (
            <Bubble role="assistant" ai={ai}><MarkdownLite text={ai.greeting} /></Bubble>
          )}
          {messages.map((m, i) => {
            const parts = m.role === 'assistant' ? splitThinking(m.content) : null
            return (
              <Bubble key={i} role={m.role} ai={ai} blocked={m.blocked} error={m.error}>
                {m.role === 'user' ? <p className="user-text">{m.content}</p> : (
                  <>
                    {parts!.thinking && ai.settings.showThinking !== false && (
                      <details className="thinking" open={!parts!.thinkingDone}>
                        <summary>{parts!.thinkingDone ? 'Show how it thought' : 'Thinking…'}</summary>
                        <div className="thinking-text">{parts!.thinking}</div>
                      </details>
                    )}
                    {m.pending && !parts!.answer ? <span className="typing" aria-label="Thinking"><span /><span /><span /></span> : <MarkdownLite text={parts!.answer} />}
                    {!m.pending && (
                      <div className="msg-actions">
                        <IconButton icon="copy" label="Copy answer" size={14} onClick={() => navigator.clipboard.writeText(parts!.answer)} />
                        <button type="button" className={cx('icon-btn', m.feedback === 'up' && 'on')} aria-pressed={m.feedback === 'up'} aria-label="Good answer" title="Good answer" onClick={() => feedback(i, 'up')}>👍</button>
                        <button type="button" className={cx('icon-btn', m.feedback === 'down' && 'on')} aria-pressed={m.feedback === 'down'} aria-label="Bad answer" title="Bad answer" onClick={() => feedback(i, 'down')}>👎</button>
                        <IconButton icon="send" label="Read aloud" size={14} onClick={() => speak(parts!.answer)} />
                        {i === messages.length - 1 && <IconButton icon="refresh" label="Regenerate answer" size={14} onClick={regenerate} disabled={busy} />}
                      </div>
                    )}
                  </>
                )}
              </Bubble>
            )
          })}
        </div>
        <form className="ai-composer" onSubmit={send}>
          <label htmlFor="ai-input" className="sr-only">Message {ai.name}</label>
          <textarea
            id="ai-input"
            ref={inputRef}
            className="input"
            rows={2}
            value={input}
            maxLength={ai.rules.maxInputChars || 4000}
            placeholder={gpuBlocked ? 'This AI needs WebGPU on this device' : `Message ${ai.name}…`}
            disabled={!!gpuBlocked}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
              if (e.key === 'Escape' && busy) stop()
            }}
            aria-describedby="ai-hint"
          />
          {busy ? (
            <Button variant="danger" icon="pause" onClick={stop}>Stop</Button>
          ) : (
            <Button type="submit" variant="primary" icon="send" disabled={!input.trim() || !!gpuBlocked}>Send</Button>
          )}
        </form>
        <p id="ai-hint" className="hint ai-hint">Enter to send · Shift+Enter for a new line · Esc to stop. {ai.name} can make mistakes.{busy && <> <Spinner size={12} /></>}</p>
      </section>
    </div>
  )
}

function Bubble({ role, ai, blocked, error, children }: { role: 'user' | 'assistant'; ai: AiView; blocked?: boolean; error?: boolean; children: React.ReactNode }) {
  return (
    <article className={cx('bubble', `bubble-${role}`, (blocked || error) && 'bubble-blocked')} aria-label={role === 'user' ? 'You said' : `${ai.name} said`}>
      {role === 'assistant' && <span className="ai-avatar sm" aria-hidden="true">{ai.avatar}</span>}
      <div className="bubble-body">
        {blocked && <span className="badge badge-warn"><Icon name="shield" size={12} /> Blocked by rules</span>}
        {children}
      </div>
    </article>
  )
}
