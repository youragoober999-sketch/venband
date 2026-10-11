import { useEffect, useMemo, useRef, useState } from 'react'
import { A, Badge, Button, CopyButton, Empty, ErrorBox, Field, Icon, IconButton, Loading, Modal, Segmented, Switch, Tabs, ask, useAsync } from '../components/ui'
import { CodeBlock } from '../components/Rich'
import { AiChat, type AiView } from '../components/AiChat'
import { api, ApiError, siteOrigin } from '../lib/api'
import { navigate } from '../lib/router'
import { useApp } from '../lib/store'
import { cx, downloadBlob, timeAgo } from '../lib/util'
import { deleteCached, gpuInfo, isCached, type GpuInfo } from '../lib/llm'
import { AI_TEMPLATES, BASELINE_RULES, BROWSER_MODELS, CLOUD_PROVIDERS, SAFETY_PRESETS, checkInput, checkOutput, defaultRules, defaultSettings } from '../../shared/ai.js'

type FullAi = AiView & {
  persona: string
  cloud: { provider?: string; base_url?: string; model?: string }
  cloud_key_set: boolean
  examples: { q: string; a: string }[]
  blocked_users: string[]
}

// ------------------------------------------------------------------ home --

export function AiHome() {
  const { data, error, loading, reload } = useAsync(() => api.get<{ mine: AiView[]; shared: AiView[] }>('/ais'), [])
  const [creating, setCreating] = useState(false)
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Studio</h1>
          <p className="hint">Make your own AI: give it a personality, teach it your knowledge, set the rules it must follow, and chat with it. Brains run free on your own device, or in the cloud so your games and apps can use them.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New AI</Button>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <>
          {data!.mine.length === 0 ? (
            <Empty icon="bot" title="You haven't made an AI yet" action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create your first AI</Button>}>
              Start from a helpful assistant, a game character, a kid-safe tutor, a coding buddy or a blank slate.
            </Empty>
          ) : (
            <>
              <h2 className="sr-only">Your AIs</h2>
              <AiGrid ais={data!.mine} />
            </>
          )}
          {data!.shared.length > 0 && (
            <>
              <h2 className="section-title">Made by your friends</h2>
              <AiGrid ais={data!.shared} />
            </>
          )}
        </>
      )}
      <NewAiModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function AiGrid({ ais }: { ais: AiView[] }) {
  return (
    <ul className="api-list api-grid">
      {ais.map((a) => {
        const m = BROWSER_MODELS.find((x) => x.id === a.model)
        return (
          <li key={a.id} className="api-card">
            <div className="api-card-top">
              <span className="ai-avatar" aria-hidden="true">{a.avatar}</span>
              <div className="api-card-title">
                <h3><A href={`/ai/${a.id}`} className="stretched">{a.name}</A></h3>
                <span className="api-path">{a.is_owner ? `@${a.owner_username}/${a.slug}` : `by @${a.owner_username}`}</span>
              </div>
              <Badge tone={a.access === 'private' ? 'neutral' : 'info'}>{a.access}</Badge>
            </div>
            {a.tagline && <p className="api-desc">{a.tagline}</p>}
            <div className="api-meta">
              <span><Icon name="bot" size={14} /> {a.engine === 'cloud' ? 'Cloud brain' : m?.name || a.model}</span>
              <span><Icon name="shield" size={14} /> {SAFETY_PRESETS[a.rules.preset as keyof typeof SAFETY_PRESETS]?.label || 'Standard'}</span>
              <span><Icon name="history" size={14} /> {timeAgo(a.updated_at)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function NewAiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('assistant')
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()
  useEffect(() => { if (open) { setName(''); setTemplate('assistant') } }, [open])
  async function create(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    try {
      const r = await api.post<{ ai: AiView }>('/ais', { name: name || undefined, template })
      onClose()
      navigate(`/ai/${r.ai.id}/personality`)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Create an AI" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="zap" loading={busy} onClick={() => create()}>Create AI</Button></>}>
      <form className="stack" onSubmit={create}>
        <Field label="Name" hint="You can change everything later.">
          {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={AI_TEMPLATES.find((t) => t.id === template)?.name} maxLength={60} autoFocus />}
        </Field>
        <fieldset>
          <legend>Start from</legend>
          <div className="template-grid">
            {AI_TEMPLATES.map((t) => (
              <label key={t.id} className={cx('template-card', template === t.id && 'selected')}>
                <input type="radio" name="ai-template" className="sr-only-input" checked={template === t.id} onChange={() => setTemplate(t.id)} />
                <span className="template-icon" aria-hidden="true">{t.avatar}</span>
                <span className="template-name">{t.name}</span>
                <span className="template-desc">{t.tagline || 'Start from scratch'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}

export function AiByName({ username, slug }: { username: string; slug: string }) {
  const { error } = useAsync(async () => {
    const r = await api.get<{ ai: AiView }>(`/ais/by/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`)
    navigate(`/ai/${r.ai.id}`, { replace: true })
    return r
  }, [username, slug])
  return error ? <div className="page"><ErrorBox error={error} /></div> : <Loading />
}

// ---------------------------------------------------------------- studio --

const TABS = ['chat', 'personality', 'knowledge', 'rules', 'brain', 'access', 'activity', 'apps'] as const
type Tab = (typeof TABS)[number]
const TAB_META: Record<Tab, { label: string; icon: string }> = {
  chat: { label: 'Chat', icon: 'send' },
  personality: { label: 'Personality', icon: 'user' },
  knowledge: { label: 'Knowledge & training', icon: 'book' },
  rules: { label: 'Rules & safety', icon: 'shield' },
  brain: { label: 'Brain', icon: 'bot' },
  access: { label: 'Who can use it', icon: 'users' },
  activity: { label: 'Activity', icon: 'activity' },
  apps: { label: 'Use in apps', icon: 'gamepad' },
}

export function AiStudio({ id, tab: tabParam }: { id: string; tab?: string }) {
  const { data, error, loading, reload, setData } = useAsync(() => api.get<{ ai: FullAi; docs?: { id: string; title: string; chars: number; created_at: string }[] }>(`/ais/${id}`), [id])
  const tab: Tab = (TABS as readonly string[]).includes(tabParam || '') ? (tabParam as Tab) : 'chat'
  if (loading && !data) return <Loading />
  if (error) return <div className="page"><ErrorBox error={error} retry={reload} /><p><A href="/ai">Back to AI Studio</A></p></div>
  const ai = data!.ai
  const owner = ai.is_owner
  const tabs = owner ? TABS : (['chat'] as const)
  const update = (next: FullAi) => setData({ ...data!, ai: next })

  return (
    <div className="workspace ai-studio">
      <header className="ws-head">
        <div className="ws-title">
          <span className="ai-avatar" aria-hidden="true">{ai.avatar}</span>
          <div>
            <h1>{ai.name}</h1>
            <div className="ws-sub">
              <span className="hint">{ai.tagline || (owner ? 'Your AI' : `Made by @${ai.owner_username}`)}</span>
              <Badge tone={ai.access === 'private' ? 'neutral' : 'info'}>{ai.access}</Badge>
            </div>
          </div>
        </div>
        <A href="/ai" className="btn btn-ghost btn-sm"><Icon name="chevron" size={14} /> All AIs</A>
      </header>
      {owner && (
        <Tabs label="AI sections" value={tab} onChange={(v) => navigate(v === 'chat' ? `/ai/${id}` : `/ai/${id}/${v}`)} tabs={tabs.map((t) => ({ id: t, label: TAB_META[t].label, icon: TAB_META[t].icon }))} className="ws-tabs" />
      )}
      <div role={owner ? 'tabpanel' : undefined} id={`panel-${tab}`} aria-labelledby={owner ? `tab-${tab}` : undefined} className="ws-panel">
        {tab === 'chat' && <AiChat key={`${ai.id}-${ai.engine}-${ai.model}`} ai={ai} />}
        {owner && tab === 'personality' && <PersonalityTab ai={ai} onSaved={update} />}
        {owner && tab === 'knowledge' && <KnowledgeTab ai={ai} docs={data!.docs || []} onChanged={reload} onSaved={update} />}
        {owner && tab === 'rules' && <RulesTab ai={ai} onSaved={update} />}
        {owner && tab === 'brain' && <BrainTab ai={ai} onSaved={update} />}
        {owner && tab === 'access' && <AccessTab ai={ai} onSaved={update} />}
        {owner && tab === 'activity' && <ActivityTab ai={ai} onSaved={update} />}
        {owner && tab === 'apps' && <AppsTab ai={ai} />}
      </div>
    </div>
  )
}

function useSaver(ai: FullAi, onSaved: (a: FullAi) => void) {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const save = async (patch: Record<string, unknown>, msg = 'Saved') => {
    setBusy(true)
    try {
      const r = await api.patch<{ ai: FullAi }>(`/ais/${ai.id}`, patch)
      onSaved(r.ai)
      toast(msg, 'success')
      return true
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, save }
}

const AVATARS = ['🤖', '🧙', '🐉', '🦊', '🐱', '👾', '🧠', '🦄', '👻', '🎮', '📚', '💻', '🌟', '🔥', '🎵', '🛸', '🧜', '🥷', '🧑‍🚀', '🐼', '🦉', '🍄', '⚔️', '✨']

function PersonalityTab({ ai, onSaved }: { ai: FullAi; onSaved: (a: FullAi) => void }) {
  const [f, setF] = useState({ name: ai.name, avatar: ai.avatar, tagline: ai.tagline, persona: ai.persona, greeting: ai.greeting, slug: ai.slug })
  const { busy, save } = useSaver(ai, onSaved)
  const dirty = JSON.stringify(f) !== JSON.stringify({ name: ai.name, avatar: ai.avatar, tagline: ai.tagline, persona: ai.persona, greeting: ai.greeting, slug: ai.slug })
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  return (
    <form className="panel-pad stack narrow-form" onSubmit={(e) => { e.preventDefault(); save(f) }}>
      <h2>Personality</h2>
      <div className="grid-2">
        <Field label="Name">{(p) => <input {...p} className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} maxLength={60} />}</Field>
        <Field label="URL name" hint={`Share link: ${siteOrigin()}/ai/u/${ai.owner_username}/${f.slug}`}>{(p) => <input {...p} className="input mono" value={f.slug} onChange={(e) => set('slug')(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />}</Field>
      </div>
      <fieldset>
        <legend>Avatar</legend>
        <div className="icon-picker">
          {AVATARS.map((a) => (
            <label key={a} className={cx('icon-choice', f.avatar === a && 'selected')}>
              <input type="radio" name="avatar" className="sr-only-input" checked={f.avatar === a} onChange={() => set('avatar')(a)} />
              <span aria-hidden="true">{a}</span><span className="sr-only">{a}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Tagline" hint="One line shown under the name.">{(p) => <input {...p} className="input" value={f.tagline} onChange={(e) => set('tagline')(e.target.value)} maxLength={160} />}</Field>
      <Field label="Personality & instructions" hint="Describe who your AI is, how it talks, what it knows and what it should do. This is the most important setting. Be specific: “You are a pirate captain who speaks in short, funny sentences and loves treasure maps.”">
        {(p) => <textarea {...p} className="input" rows={10} value={f.persona} onChange={(e) => set('persona')(e.target.value)} maxLength={20000} />}
      </Field>
      <Field label="Greeting" hint="The first message people see.">{(p) => <textarea {...p} className="input" rows={2} value={f.greeting} onChange={(e) => set('greeting')(e.target.value)} maxLength={1000} />}</Field>
      <div className="row-wrap">
        <Button type="submit" variant="primary" icon="save" loading={busy} disabled={!dirty}>Save personality</Button>
        <A href={`/ai/${ai.id}`} className="btn btn-ghost btn-md">Try it in Chat</A>
      </div>
      <hr />
      <div><Button variant="danger" icon="trash" onClick={async () => {
        if (!(await ask({ title: `Delete ${ai.name}?`, body: 'Its knowledge, chats and settings are deleted forever.', confirm: 'Delete AI', danger: true }))) return
        await api.del(`/ais/${ai.id}`)
        navigate('/ai')
      }}>Delete this AI</Button></div>
    </form>
  )
}

function KnowledgeTab({ ai, docs, onChanged, onSaved }: { ai: FullAi; docs: { id: string; title: string; chars: number; created_at: string }[]; onChanged: () => void; onSaved: (a: FullAi) => void }) {
  const { toast } = useApp()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [viewing, setViewing] = useState<{ title: string; content: string } | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ title: string; text: string; score: number }[] | null>(null)
  const [examples, setExamples] = useState(ai.examples || [])
  const { busy, save } = useSaver(ai, onSaved)
  const fileRef = useRef<HTMLInputElement>(null)
  const jsonlRef = useRef<HTMLInputElement>(null)
  useEffect(() => setExamples(ai.examples || []), [ai.examples])

  async function addDoc(t: string, c: string) {
    try {
      await api.post(`/ais/${ai.id}/docs`, { title: t, content: c })
      toast(`${ai.name} learned “${t}”`, 'success')
      onChanged()
      return true
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
      return false
    }
  }

  async function upload(files: FileList) {
    for (const f of Array.from(files)) {
      if (f.size > 300_000) { toast(`${f.name} is too large (300 KB max per document)`, 'error'); continue }
      await addDoc(f.name, await f.text())
    }
  }

  function exportTraining() {
    const system = `You are ${ai.name}. ${ai.persona}`
    const lines = examples.map((e) => JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: e.q }, { role: 'assistant', content: e.a }] }))
    downloadBlob(`${ai.slug}-training.jsonl`, lines.join('\n') + '\n', 'application/jsonl')
  }

  async function importTraining(file: File) {
    const added: { q: string; a: string }[] = []
    for (const line of (await file.text()).split('\n')) {
      try {
        const j = JSON.parse(line)
        const msgs = j.messages || []
        for (let i = 0; i < msgs.length - 1; i++) if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') added.push({ q: msgs[i].content, a: msgs[i + 1].content })
        if (j.prompt && j.completion) added.push({ q: j.prompt, a: j.completion })
      } catch { /* skip */ }
    }
    if (!added.length) return toast('No user/assistant pairs found in that file', 'error')
    const next = [...examples, ...added].slice(-200)
    setExamples(next)
    await save({ examples: next }, `Imported ${added.length} examples`)
  }

  return (
    <div className="panel-pad stack">
      <section className="stack">
        <div className="panel-head">
          <div>
            <h2>Knowledge</h2>
            <p className="hint">Give {ai.name} documents to learn from: game lore, rules, FAQs, notes, code docs. Before every answer it searches them and uses the best matches. Text, Markdown, JSON and CSV work best.</p>
          </div>
          <div className="row-wrap">
            <Button icon="upload" onClick={() => fileRef.current?.click()}>Upload files</Button>
            <Button variant="primary" icon="plus" onClick={() => { setTitle(''); setContent(''); setAdding(true) }}>Write a note</Button>
            <input ref={fileRef} type="file" multiple accept=".txt,.md,.json,.csv,.html,.xml,.yaml,.yml,.js,.ts,.py,.cs,.lua" hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
          </div>
        </div>
        {docs.length === 0 ? <Empty icon="book" title="No knowledge yet">Add a note like “Our game has 3 worlds: Lava, Ice and Sky…”.</Empty> : (
          <ul className="people">
            {docs.map((d) => (
              <li key={d.id} className="person">
                <Icon name="file" />
                <div className="person-text"><strong>{d.title}</strong><span className="hint">{d.chars.toLocaleString()} characters · added {timeAgo(d.created_at)}</span></div>
                <Button size="sm" variant="ghost" icon="eye" onClick={async () => { const r = await api.get<{ doc: { title: string; content: string } }>(`/ais/${ai.id}/docs/${d.id}`); setViewing(r.doc) }}>View</Button>
                <IconButton icon="trash" label={`Delete ${d.title}`} onClick={async () => { if (await ask({ title: `Remove “${d.title}”?`, confirm: 'Remove', danger: true })) { await api.del(`/ais/${ai.id}/docs/${d.id}`); onChanged() } }} />
              </li>
            ))}
          </ul>
        )}
        {docs.length > 0 && (
          <form className="row-wrap" onSubmit={async (e) => { e.preventDefault(); const r = await api.post<{ results: { title: string; text: string; score: number }[] }>(`/ais/${ai.id}/search`, { query: q }); setResults(r.results) }}>
            <label className="search-box"><Icon name="search" size={16} /><span className="sr-only">Test a question</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Test: what would it find for…" /></label>
            <Button type="submit" size="sm">Search knowledge</Button>
          </form>
        )}
        {results && (
          <div className="stack" role="status">
            {results.length === 0 ? <p className="hint">Nothing matched - {ai.name} would answer from general knowledge.</p> : results.map((r, i) => (
              <div key={i} className="info-box"><Icon name="book" /><div><strong>{r.title}</strong> <span className="hint">(score {r.score.toFixed(2)})</span><p className="hint">{r.text.slice(0, 300)}…</p></div></div>
            ))}
          </div>
        )}
      </section>

      <section className="stack">
        <div className="panel-head">
          <div>
            <h2>Training examples</h2>
            <p className="hint">Show {ai.name} how to answer. It copies the style of these examples. Turn on “learn from my 👍” and every answer you like in Chat is added here automatically.</p>
          </div>
          <div className="row-wrap">
            <Button size="sm" icon="upload" onClick={() => jsonlRef.current?.click()}>Import .jsonl</Button>
            <Button size="sm" icon="download" onClick={exportTraining} disabled={!examples.length}>Export for fine-tuning</Button>
            <input ref={jsonlRef} type="file" accept=".jsonl,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importTraining(f); e.target.value = '' }} />
          </div>
        </div>
        <Switch checked={!!ai.settings.autoLearn} onChange={(v) => save({ settings: { ...ai.settings, autoLearn: v } }, v ? 'Learning from your 👍 turned on' : 'Learning turned off')} label="Learn from my 👍" description="Only your own thumbs-up teach it, so other people can't change how it behaves." />
        <ol className="example-list">
          {examples.map((ex, i) => (
            <li key={i} className="example">
              <Field label={`Example ${i + 1} - when someone says`}>{(p) => <textarea {...p} className="input" rows={2} value={ex.q} onChange={(e) => setExamples(examples.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />}</Field>
              <Field label="it answers">{(p) => <textarea {...p} className="input" rows={3} value={ex.a} onChange={(e) => setExamples(examples.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />}</Field>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setExamples(examples.filter((_, j) => j !== i))}>Remove example</Button>
            </li>
          ))}
        </ol>
        <div className="row-wrap">
          <Button icon="plus" onClick={() => setExamples([...examples, { q: '', a: '' }])}>Add example</Button>
          <Button variant="primary" icon="save" loading={busy} disabled={JSON.stringify(examples) === JSON.stringify(ai.examples || [])} onClick={() => save({ examples: examples.filter((e) => e.q.trim() && e.a.trim()) }, 'Examples saved')}>Save examples</Button>
        </div>
        <div className="info-box"><Icon name="info" /><div><strong>Want deeper training?</strong> “Export for fine-tuning” creates a standard .jsonl dataset. You can fine-tune an open model (Llama, Qwen, Mistral) with it on services like Together AI or with free tools like Unsloth, then plug the result into the <strong>Brain</strong> tab as a Cloud model.</div></div>
      </section>

      <Modal open={adding} onClose={() => setAdding(false)} title="Write a note" size="lg" footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!content.trim()} onClick={async () => { if (await addDoc(title || 'Note', content)) setAdding(false) }}>Teach it</Button></>}>
        <div className="stack">
          <Field label="Title">{(p) => <input {...p} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="World map" autoFocus />}</Field>
          <Field label="What should it know?">{(p) => <textarea {...p} className="input" rows={14} value={content} onChange={(e) => setContent(e.target.value)} />}</Field>
        </div>
      </Modal>
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title} size="lg">
        <pre className="out version-code" tabIndex={0}>{viewing?.content}</pre>
      </Modal>
    </div>
  )
}

function RulesTab({ ai, onSaved }: { ai: FullAi; onSaved: (a: FullAi) => void }) {
  const [r, setR] = useState({ ...defaultRules(), ...ai.rules })
  const [test, setTest] = useState('')
  const { busy, save } = useSaver(ai, onSaved)
  const set = (k: string, v: unknown) => setR((x: any) => ({ ...x, [k]: v }))
  const dirty = JSON.stringify(r) !== JSON.stringify({ ...defaultRules(), ...ai.rules })
  const verdict = test ? checkInput(test, r) : null
  return (
    <form className="panel-pad stack narrow-form" onSubmit={(e) => { e.preventDefault(); save({ rules: r }, 'Rules saved - they apply to the next message') }}>
      <h2>Rules & safety</h2>
      <p className="hint">Decide what {ai.name} can and can't do. Rules are checked before a message reaches the AI, given to the AI as instructions, and checked again on its answer.</p>
      <div>
        <span className="field-label">Safety level</span>
        <Segmented label="Safety level" value={r.preset} onChange={(v) => set('preset', v)} options={Object.entries(SAFETY_PRESETS).map(([id, p]) => ({ value: id, label: p.label }))} />
        <ul className="hint rule-list">{SAFETY_PRESETS[r.preset as keyof typeof SAFETY_PRESETS].rules.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <details className="baseline">
        <summary><Icon name="shield" size={14} /> Always-on safety floor (can't be turned off)</summary>
        <ul className="rule-list">{BASELINE_RULES.map((x) => <li key={x}>{x}</li>)}</ul>
      </details>
      <Field label="Blocked words" hint="Comma or line separated. Messages containing them are refused, and answers containing them are replaced. Catches simple tricks like sp3lling with numbers.">
        {(p) => <textarea {...p} className="input" rows={3} value={r.blockedWords} onChange={(e) => set('blockedWords', e.target.value)} placeholder="cheat code, real address" />}
      </Field>
      <Field label="Blocked topics" hint="One per line. The AI refuses to talk about these.">
        {(p) => <textarea {...p} className="input" rows={3} value={r.blockedTopics} onChange={(e) => set('blockedTopics', e.target.value)} placeholder={'politics\ndating advice\nhow to hack accounts'} />}
      </Field>
      <Field label="Only talk about (optional)" hint="If you fill this in, the AI stays on these topics and politely declines everything else. Great for game NPCs and support bots.">
        {(p) => <textarea {...p} className="input" rows={2} value={r.onlyTopics} onChange={(e) => set('onlyTopics', e.target.value)} placeholder="my game, its characters and items" />}
      </Field>
      <Field label="Your own rules" hint="One per line. For example: “Always answer in Spanish.” “Never reveal the ending of the story.” “Keep answers under 50 words.”">
        {(p) => <textarea {...p} className="input" rows={4} value={r.customRules} onChange={(e) => set('customRules', e.target.value)} />}
      </Field>
      <Field label="Refusal message" hint="What it says when a rule blocks something.">
        {(p) => <input {...p} className="input" value={r.refusal} onChange={(e) => set('refusal', e.target.value)} maxLength={300} />}
      </Field>
      <div className="grid-2">
        <Field label="Longest message allowed (characters)">{(p) => <input {...p} className="input" type="number" min={50} max={20000} value={r.maxInputChars} onChange={(e) => set('maxInputChars', Number(e.target.value))} />}</Field>
        <Field label="Messages per person per day (0 = unlimited)" hint="You are never limited.">{(p) => <input {...p} className="input" type="number" min={0} max={10000} value={r.dailyLimit} onChange={(e) => set('dailyLimit', Number(e.target.value))} />}</Field>
      </div>
      <Switch checked={!!r.selfCheck} onChange={(v) => set('selfCheck', v)} label="AI double-check" description="Before answering, the AI judges each message against your rules and blocks anything that breaks them - catches sneaky wording that word lists miss. Slower, but much stronger." />
      <Switch checked={!!r.noPersonalInfo} onChange={(v) => set('noPersonalInfo', v)} label="Protect personal info" description="Never asks people for addresses, phone numbers, schools or passwords." />
      <div className="row-wrap">
        <Button type="submit" variant="primary" icon="save" loading={busy} disabled={!dirty}>Save rules</Button>
      </div>
      <section className="test-rules">
        <h3>Test your rules</h3>
        <Field label="Type a message someone might send">{(p) => <input {...p} className="input" value={test} onChange={(e) => setTest(e.target.value)} />}</Field>
        {verdict && (
          <p role="status" className={verdict.ok ? 'ok-text' : 'error-text'}>
            <Icon name={verdict.ok ? 'check' : 'shield'} size={14} /> {verdict.ok ? 'Allowed by the word filters (the AI still follows your topic rules when answering).' : `Blocked: ${verdict.reason}. Reply: “${r.refusal}”`}
          </p>
        )}
        {test && checkOutput(test, r).text !== test && <p className="hint">If the AI said this, it would be shown as: “{checkOutput(test, r).text}”</p>}
      </section>
      <div className="info-box"><Icon name="info" /><div><strong>How strong is this?</strong> Cloud brains enforce every rule on the server, so nobody can get around them. Browser brains run on each visitor's own device: rules are still applied, but a determined, technical visitor could tamper with their own copy. For anything public or for kids, use a Cloud brain plus the AI double-check.</div></div>
    </form>
  )
}

function BrainTab({ ai, onSaved }: { ai: FullAi; onSaved: (a: FullAi) => void }) {
  const [engine, setEngine] = useState<'browser' | 'cloud'>(ai.engine)
  const [model, setModel] = useState(ai.model)
  const [s, setS] = useState({ ...defaultSettings(), ...ai.settings })
  const [cloud, setCloud] = useState({ provider: ai.cloud?.provider || 'groq', base_url: ai.cloud?.base_url || CLOUD_PROVIDERS[0].baseUrl, model: ai.cloud?.model || '' })
  const [key, setKey] = useState('')
  const [gpu, setGpu] = useState<GpuInfo | null>(null)
  const [cached, setCached] = useState<Record<string, boolean>>({})
  const { busy, save } = useSaver(ai, onSaved)
  const { toast } = useApp()

  useEffect(() => {
    gpuInfo().then(setGpu)
    Promise.all(BROWSER_MODELS.map(async (m) => [m.id, await isCached(m.id)] as const)).then((e) => setCached(Object.fromEntries(e)))
  }, [])

  const selected = BROWSER_MODELS.find((m) => m.id === model)
  const provider = CLOUD_PROVIDERS.find((p) => p.id === cloud.provider) || CLOUD_PROVIDERS[CLOUD_PROVIDERS.length - 1]

  return (
    <form className="panel-pad stack" onSubmit={(e) => {
      e.preventDefault()
      save({ engine, model, settings: s, cloud, ...(key ? { cloud_key: key } : {}) }, 'Brain saved').then((ok) => ok && setKey(''))
    }}>
      <h2>Brain</h2>
      <Segmented label="Where the AI runs" value={engine} onChange={setEngine} options={[{ value: 'browser', label: '💻 On each person\'s device (free)' }, { value: 'cloud', label: '☁️ Cloud (works in apps & games)' }]} />
      {engine === 'browser' ? (
        <>
          <p className="hint">The model downloads once to each person's browser and runs on their graphics card with WebGPU. Free, private, no API key needed. Bigger brains are smarter but need a stronger GPU.</p>
          {gpu && (gpu.supported ? <p className="ok-text"><Icon name="check" size={14} /> This device supports WebGPU ({gpu.description}).</p> : <p className="error-text"><Icon name="alert" size={14} /> {gpu.reason}</p>)}
          <fieldset>
            <legend>Pick a brain</legend>
            <div className="model-grid">
              {BROWSER_MODELS.map((m) => (
                <label key={m.id} className={cx('model-card', model === m.id && 'selected')}>
                  <input type="radio" name="model" className="sr-only-input" checked={model === m.id} onChange={() => setModel(m.id)} />
                  <span className="model-top"><strong>{m.name}</strong><Badge tone={m.tier === 'Max' ? 'accent' : 'neutral'}>{m.tier}</Badge></span>
                  <span className="hint">{m.note}</span>
                  <span className="model-meta">
                    <span>~{m.vramGB} GB download / GPU memory</span>
                    {m.think && <span>🧠 can think step by step</span>}
                    {cached[m.id] && <span className="ok-text">✓ downloaded</span>}
                  </span>
                  {cached[m.id] && (
                    <button type="button" className="link-btn small" onClick={async (e) => { e.preventDefault(); await deleteCached(m.id); setCached((c) => ({ ...c, [m.id]: false })); toast(`${m.name} removed from this device`, 'success') }}>Remove download</button>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          {selected?.think && <Switch checked={!!s.think} onChange={(v) => setS({ ...s, think: v })} label="Think before answering" description="Smarter answers for hard questions, but slower. The thinking is shown in a collapsible box." />}
        </>
      ) : (
        <>
          <p className="hint">The server calls an AI provider for every message, so your AI also works from Unity, Roblox, Discord bots and any app (see <strong>Use in apps</strong>). Rules are enforced on the server. Many providers have free tiers; your key is stored on the server and never shown again.</p>
          <div className="grid-2">
            <Field label="Provider">
              {(p) => (
                <select {...p} className="input" value={cloud.provider} onChange={(e) => { const pr = CLOUD_PROVIDERS.find((x) => x.id === e.target.value)!; setCloud({ ...cloud, provider: pr.id, base_url: pr.baseUrl || cloud.base_url }) }}>
                  {CLOUD_PROVIDERS.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Model name" hint={provider.modelHint}>{(p) => <input {...p} className="input mono" value={cloud.model} onChange={(e) => setCloud({ ...cloud, model: e.target.value })} spellCheck={false} />}</Field>
          </div>
          <Field label="API base URL" hint="Any OpenAI-compatible server (it must accept POST /chat/completions).">{(p) => <input {...p} className="input mono" value={cloud.base_url} onChange={(e) => setCloud({ ...cloud, base_url: e.target.value })} spellCheck={false} />}</Field>
          <Field label={<>Provider API key {ai.cloud_key_set && <Badge tone="good">saved</Badge>}</>} hint={<>{provider.keyUrl && <>Get one at <a href={provider.keyUrl} target="_blank" rel="noreferrer">{provider.keyUrl.replace(/^https:\/\//, '')}</a>. </>}Leave blank to keep the saved key.</>}>
            {(p) => <input {...p} className="input mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai.cloud_key_set ? '•••••••• (saved)' : 'sk-…'} autoComplete="off" />}
          </Field>
          {ai.cloud_key_set && <div><Button size="sm" variant="ghost" onClick={() => save({ cloud_key: null }, 'Key removed')}>Remove saved key</Button></div>}
        </>
      )}
      <h3>Behaviour</h3>
      <div className="grid-2">
        <Field label={<>Creativity: <strong>{s.temperature.toFixed(1)}</strong></>} hint="Low = focused and consistent. High = creative and surprising.">
          {(p) => <input {...p} type="range" min={0} max={1.5} step={0.1} value={s.temperature} onChange={(e) => setS({ ...s, temperature: Number(e.target.value) })} />}
        </Field>
        <Field label={<>Longest answer: <strong>{s.maxTokens} tokens</strong></>} hint="About ¾ of a word per token.">
          {(p) => <input {...p} type="range" min={100} max={engine === 'browser' ? 2000 : 4000} step={50} value={s.maxTokens} onChange={(e) => setS({ ...s, maxTokens: Number(e.target.value) })} />}
        </Field>
      </div>
      <Switch checked={s.memory !== false} onChange={(v) => setS({ ...s, memory: v })} label="Remember the conversation" description="Off makes every message independent (useful for simple Q&A bots)." />
      <Switch checked={s.showThinking !== false} onChange={(v) => setS({ ...s, showThinking: v })} label="Show the AI's thinking" description="For models that think step by step." />
      <div><Button type="submit" variant="primary" icon="save" loading={busy}>Save brain</Button></div>
    </form>
  )
}

function AccessTab({ ai, onSaved }: { ai: FullAi; onSaved: (a: FullAi) => void }) {
  const [access, setAccess] = useState(ai.access)
  const [blocked, setBlocked] = useState((ai.blocked_users || []).join('\n'))
  const { busy, save } = useSaver(ai, onSaved)
  const link = `${siteOrigin()}/ai/u/${ai.owner_username}/${ai.slug}`
  return (
    <form className="panel-pad stack narrow-form" onSubmit={(e) => { e.preventDefault(); save({ access, blocked_users: blocked }) }}>
      <h2>Who can use it</h2>
      <fieldset>
        <legend className="sr-only">Access</legend>
        <div className="radio-row">
          <label className="check-row"><input type="radio" name="access" checked={access === 'private'} onChange={() => setAccess('private')} /> <span><strong>Only me</strong> - private.</span></label>
          <label className="check-row"><input type="radio" name="access" checked={access === 'friends'} onChange={() => setAccess('friends')} /> <span><strong>My friends</strong> - shows up in their AI Studio.</span></label>
          <label className="check-row"><input type="radio" name="access" checked={access === 'public'} onChange={() => setAccess('public')} /> <span><strong>Anyone with a Vix account</strong> who has the link. Each person's chats stay private to them.</span></label>
        </div>
      </fieldset>
      <div className="copy-line"><code className="break">{link}</code><CopyButton text={link} label="Copy link" /></div>
      <Field label="Blocked people" hint="Usernames, one per line. They can't chat with this AI at all.">
        {(p) => <textarea {...p} className="input mono" rows={5} value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder="troll123" />}
      </Field>
      <div><Button type="submit" variant="primary" icon="save" loading={busy}>Save</Button></div>
    </form>
  )
}

type AiEvent = { id: number; kind: string; detail: string; message: string; created_at: string; username: string | null }

function ActivityTab({ ai, onSaved }: { ai: FullAi; onSaved: (a: FullAi) => void }) {
  const ev = useAsync(() => api.get<{ events: AiEvent[]; stats: { chats7d: number } }>(`/ais/${ai.id}/events`), [ai.id])
  const [filter, setFilter] = useState<'all' | 'blocked' | 'feedback'>('all')
  const { save } = useSaver(ai, onSaved)
  const rows = (ev.data?.events || []).filter((e) => filter === 'all' || (filter === 'blocked' ? e.kind.startsWith('blocked') : e.kind.startsWith('feedback')))
  const counts = useMemo(() => {
    const c = { blocked: 0, up: 0, down: 0 }
    for (const e of ev.data?.events || []) {
      if (e.kind.startsWith('blocked')) c.blocked++
      if (e.kind === 'feedback_up') c.up++
      if (e.kind === 'feedback_down') c.down++
    }
    return c
  }, [ev.data])
  const LABEL: Record<string, string> = { blocked_input: 'Blocked message', blocked_output: 'Blocked answer', blocked_selfcheck: 'Blocked by AI double-check', feedback_up: '👍 Good answer', feedback_down: '👎 Bad answer' }
  return (
    <div className="panel-pad stack">
      <div className="panel-head"><h2>Activity</h2><Button size="sm" icon="refresh" onClick={ev.reload}>Refresh</Button></div>
      <div className="stat-row">
        <div className="stat"><span className="stat-num">{ev.data?.stats.chats7d ?? '…'}</span><span className="stat-label">active chats (7 days)</span></div>
        <div className="stat"><span className="stat-num">{counts.blocked}</span><span className="stat-label">blocked attempts</span></div>
        <div className="stat"><span className="stat-num">{counts.up} / {counts.down}</span><span className="stat-label">👍 / 👎</span></div>
      </div>
      <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Everything' }, { value: 'blocked', label: 'Blocked' }, { value: 'feedback', label: 'Feedback' }]} />
      {ev.loading && !ev.data ? <Loading /> : rows.length === 0 ? <Empty icon="activity" title="Nothing here yet">Blocked messages and feedback show up here so you can improve your rules.</Empty> : (
        <ul className="people">
          {rows.map((e) => (
            <li key={e.id} className="person event">
              <Badge tone={e.kind.startsWith('blocked') ? 'warn' : e.kind === 'feedback_up' ? 'good' : 'bad'}>{LABEL[e.kind] || e.kind}</Badge>
              <div className="person-text">
                {e.message && <span>“{e.message.slice(0, 200)}”</span>}
                <span className="hint">{e.username ? `@${e.username}` : 'someone'} · {timeAgo(e.created_at)}{e.detail && e.kind.startsWith('blocked') ? ` · ${e.detail}` : ''}</span>
              </div>
              {e.username && e.kind.startsWith('blocked') && !ai.blocked_users.includes(e.username) && e.username !== ai.owner_username && (
                <Button size="sm" variant="ghost" onClick={() => save({ blocked_users: [...ai.blocked_users, e.username] }, `@${e.username} blocked`)}>Block @{e.username}</Button>
              )}
              {e.kind === 'feedback_up' && e.message && e.detail && (
                <Button size="sm" variant="ghost" onClick={() => save({ examples: [...ai.examples, { q: e.message, a: e.detail }] }, 'Added as a training example')}>Use as example</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AppsTab({ ai }: { ai: FullAi }) {
  const base = `${siteOrigin()}/api/ai/v1`
  const model = `${ai.owner_username}/${ai.slug}`
  return (
    <div className="panel-pad stack">
      <h2>Use {ai.name} in games & apps</h2>
      {ai.engine !== 'cloud' && <div className="info-box warn"><Icon name="alert" /><div><strong>Switch the Brain to Cloud first.</strong> Browser brains only run inside the Vix website, because games and servers don't have a browser GPU to borrow.</div></div>}
      <p className="hint">{ai.name} speaks the OpenAI chat format, so it works with almost every AI library, plugin and game asset. Your personality, knowledge and rules are always applied - callers can't override them. Use a <A href="/keys">Vix API key</A>.</p>
      <div className="integrate-urls">
        <div><span className="field-label">Base URL</span><div className="copy-line"><code className="break">{base}</code><CopyButton text={base} /></div></div>
        <div><span className="field-label">Model</span><div className="copy-line"><code>{model}</code><CopyButton text={model} /></div></div>
      </div>
      <CodeBlock lang="bash" label="curl" code={`curl ${base}/chat/completions \\
  -H "Authorization: Bearer YOUR_VIX_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello!"}]}'`} />
      <CodeBlock lang="python" label="Python (openai library)" code={`from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="YOUR_VIX_API_KEY")
reply = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content)`} />
      <CodeBlock lang="csharp" label="Unity (C#)" code={`IEnumerator Ask(string text) {
    var body = "{\\"model\\":\\"${model}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"" + text + "\\"}]}";
    using var req = new UnityWebRequest("${base}/chat/completions", "POST");
    req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body));
    req.downloadHandler = new DownloadHandlerBuffer();
    req.SetRequestHeader("Content-Type", "application/json");
    req.SetRequestHeader("Authorization", "Bearer YOUR_VIX_API_KEY");
    yield return req.SendWebRequest();
    Debug.Log(req.downloadHandler.text); // choices[0].message.content
}`} />
      <CodeBlock lang="lua" label="Roblox (server Script)" code={`local HttpService = game:GetService("HttpService")
local res = HttpService:RequestAsync({
  Url = "${base}/chat/completions",
  Method = "POST",
  Headers = { ["Content-Type"] = "application/json", ["Authorization"] = "Bearer " .. HttpService:GetSecret("VIX_KEY") },
  Body = HttpService:JSONEncode({ model = "${model}", messages = { { role = "user", content = "Hello!" } } }),
})
print(HttpService:JSONDecode(res.Body).choices[1].message.content)`} />
      <CodeBlock lang="javascript" label="JavaScript (streaming)" code={`const res = await fetch('${base}/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.VIX_KEY },
  body: JSON.stringify({ model: '${model}', stream: true, messages: [{ role: 'user', content: 'Tell me a story' }] }),
})
// read Server-Sent Events: each "data:" line has choices[0].delta.content`} />
    </div>
  )
}
