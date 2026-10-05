import { useEffect, useMemo, useState } from 'react'
import { A, Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, useAsync } from '../components/ui'
import { api, ApiError, apiBaseUrl, type Api } from '../lib/api'
import { t } from '../lib/i18n'
import { navigate, useLocation } from '../lib/router'
import { useApp } from '../lib/store'
import { cx, slugify, timeAgo } from '../lib/util'
import { TEMPLATES } from '../../shared/templates.js'

export function Dashboard() {
  const { user } = useApp()
  const { search } = useLocation()
  const { data, error, loading, reload } = useAsync(() => api.get<{ apis: Api[] }>('/apis'), [])
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('vix:dash-view') as 'grid' | 'list') || 'grid')

  useEffect(() => {
    if (search.get('new')) {
      setCreating(true)
      navigate('/dashboard', { replace: true })
    }
  }, [search])

  useEffect(() => {
    try { localStorage.setItem('vix:dash-view', view) } catch { /* ignore */ }
  }, [view])

  const apis = data?.apis || []
  const f = filter.trim().toLowerCase()
  const visible = apis.filter((a) => !f || `${a.name} ${a.slug} ${a.description}`.toLowerCase().includes(f))
  const own = visible.filter((a) => a.role === 'owner')
  const shared = visible.filter((a) => a.role !== 'owner')

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('dash.title')}</h1>
          <p className="hint">Welcome back, {user?.display_name || user?.username}. Every live API below is answering requests right now.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('dash.new')}</Button>
      </div>
      {apis.length > 0 && (
        <div className="toolbar">
          <label className="search-box">
            <Icon name="search" size={16} />
            <span className="sr-only">{t('dash.filter')}</span>
            <input type="search" placeholder={t('dash.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className="segmented" role="radiogroup" aria-label="Layout">
            <button type="button" role="radio" aria-checked={view === 'grid'} className={cx('seg', view === 'grid' && 'active')} onClick={() => setView('grid')}>Grid</button>
            <button type="button" role="radio" aria-checked={view === 'list'} className={cx('seg', view === 'list' && 'active')} onClick={() => setView('list')}>List</button>
          </div>
        </div>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : apis.length === 0 ? (
        <Empty icon="bolt" title={t('dash.empty')} action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('dash.new')}</Button>}>
          Start from a game leaderboard, AI tools, a polyglot project with Python + Rust + Batch, or a blank project.
        </Empty>
      ) : (
        <>
          {own.length > 0 && <h2 className="sr-only">Owned by you</h2>}
          <ApiList apis={own} view={view} label={t('dash.title')} />
          {shared.length > 0 && (
            <>
              <h2 className="section-title">{t('dash.shared')}</h2>
              <ApiList apis={shared} view={view} label={t('dash.shared')} />
            </>
          )}
          {!visible.length && <p className="hint">No APIs match “{filter}”.</p>}
        </>
      )}
      <NewApiModal open={creating} onClose={() => setCreating(false)} onCreated={(a) => { reload(); navigate(`/p/${a.id}`) }} />
    </div>
  )
}

function ApiList({ apis, view, label }: { apis: Api[]; view: 'grid' | 'list'; label: string }) {
  if (!apis.length) return null
  return (
    <ul className={cx('api-list', view === 'grid' ? 'api-grid' : 'api-rows')} aria-label={label}>
      {apis.map((a) => (
        <li key={a.id} className="api-card">
          <div className="api-card-top">
            <span className="api-icon" aria-hidden="true">{a.icon}</span>
            <div className="api-card-title">
              <h3><A href={`/p/${a.id}`} className="stretched">{a.name}</A></h3>
              <code className="api-path">/v1/{a.owner_username}/{a.slug}</code>
            </div>
            <Badge tone={a.status === 'live' ? 'good' : 'warn'}>
              <span className={cx('dot', a.status === 'live' ? 'dot-live' : 'dot-paused')} aria-hidden="true" />
              {a.status === 'live' ? t('dash.live') : t('dash.paused')}
            </Badge>
          </div>
          {a.description && <p className="api-desc">{a.description}</p>}
          <div className="api-meta">
            <span><Icon name="list" size={14} /> {a.endpoint_count || 0} {t('dash.endpoints')}</span>
            <span><Icon name={a.require_key ? 'key' : 'globe'} size={14} /> {a.require_key ? 'Key required' : 'Open'}</span>
            {a.role !== 'owner' && <span><Icon name="users" size={14} /> {a.role} · @{a.owner_username}</span>}
            <span><Icon name="history" size={14} /> {timeAgo(a.updated_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function NewApiModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (a: Api) => void }) {
  const { user, toast } = useApp()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [template, setTemplate] = useState('hello-js')
  const [requireKey, setRequireKey] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setSlug('')
      setSlugTouched(false)
      setError(null)
    }
  }, [open])

  const finalSlug = slugTouched ? slug : slugify(name)
  const preview = useMemo(() => (user ? apiBaseUrl(user.username, finalSlug || 'my-api') : ''), [user, finalSlug])

  async function create(e?: React.FormEvent) {
    e?.preventDefault()
    if (!name.trim()) {
      setError('Give your API a name')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { api: created } = await api.post<{ api: Api }>('/apis', { name, slug: finalSlug, template, require_key: requireKey })
      toast(`${created.name} is live!`, 'success')
      onClose()
      onCreated(created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('new.title')}
      size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={() => create()} icon="zap">{t('new.create')}</Button></>}
    >
      <form onSubmit={create} className="stack">
        {error && <div className="error-box" role="alert"><Icon name="alert" /><p>{error}</p></div>}
        <div className="grid-2">
          <Field label={t('new.name')}>
            {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Space Shooter Backend" maxLength={60} autoFocus />}
          </Field>
          <Field label={t('new.slug')} hint={<>URL: <code className="break">{preview}</code></>}>
            {(p) => <input {...p} className="input mono" value={finalSlug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')) }} maxLength={48} spellCheck={false} />}
          </Field>
        </div>
        <fieldset className="template-picker">
          <legend>{t('new.template')}</legend>
          <div className="template-grid">
            {TEMPLATES.map((tp) => (
              <label key={tp.id} className={cx('template-card', template === tp.id && 'selected')}>
                <input type="radio" name="template" value={tp.id} checked={template === tp.id} onChange={() => setTemplate(tp.id)} className="sr-only-input" />
                <span className="template-icon" aria-hidden="true">{tp.icon}</span>
                <span className="template-name">{tp.name}</span>
                <span className="template-desc">{tp.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check-row">
          <input type="checkbox" checked={requireKey} onChange={(e) => setRequireKey(e.target.checked)} />
          <span>Require an API key for every endpoint (recommended - you can make single endpoints public later)</span>
        </label>
      </form>
    </Modal>
  )
}
