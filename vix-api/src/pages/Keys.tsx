import { useEffect, useState } from 'react'
import { Badge, Button, CopyButton, Empty, ErrorBox, Field, Icon, Loading, Menu, Modal, ask, useAsync } from '../components/ui'
import { api, ApiError, type Api, type ApiKey } from '../lib/api'
import { t } from '../lib/i18n'
import { navigate, useLocation } from '../lib/router'
import { useApp } from '../lib/store'
import { timeAgo } from '../lib/util'

export function Keys() {
  const { toast } = useApp()
  const { search } = useLocation()
  const keys = useAsync(() => api.get<{ keys: ApiKey[] }>('/keys'), [])
  const apis = useAsync(() => api.get<{ apis: Api[] }>('/apis'), [])
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)

  useEffect(() => {
    if (search.get('new')) {
      setCreating(true)
      navigate('/keys', { replace: true })
    }
  }, [search])

  const list = (keys.data?.keys || []).filter((k) => showRevoked || !k.revoked_at)
  const apiName = (id: string | null) => (id ? apis.data?.apis.find((a) => a.id === id)?.name || 'Unknown API' : 'All your APIs')

  async function revoke(k: ApiKey) {
    if (!(await ask({ title: `Revoke “${k.name}”?`, body: 'Anything using this key will stop working immediately. This cannot be undone.', confirm: t('keys.revoke'), danger: true }))) return
    await api.del(`/keys/${k.id}`)
    toast('Key revoked', 'success')
    keys.reload()
  }

  async function roll(k: ApiKey) {
    if (!(await ask({ title: `Roll “${k.name}”?`, body: 'A new secret is created and the old one stops working right away. Update your apps with the new key.', confirm: 'Roll key', danger: true }))) return
    const r = await api.post<{ secret: string }>(`/keys/${k.id}/roll`)
    setSecret({ name: k.name, value: r.secret })
    keys.reload()
  }

  async function rename(k: ApiKey) {
    const name = await ask({ title: 'Rename key', input: { label: 'Name', initial: k.name }, confirm: 'Rename' })
    if (!name) return
    await api.patch(`/keys/${k.id}`, { name })
    keys.reload()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('keys.title')}</h1>
          <p className="hint">Keys let your games, apps, bots and AI agents call your APIs. Send them in the <code>x-api-key</code> header. Keys work on your own APIs and on APIs friends shared with you.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('keys.create')}</Button>
      </div>
      <label className="check-row small">
        <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Show revoked keys
      </label>
      {keys.loading && !keys.data ? <Loading /> : keys.error ? <ErrorBox error={keys.error} retry={keys.reload} /> : list.length === 0 ? (
        <Empty icon="key" title={t('keys.none')} action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('keys.create')}</Button>}>Create a key, then paste it into Unity, Godot, your AI agent or curl.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Your API keys</caption>
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Works on</th><th scope="col">Permissions</th><th scope="col">Usage</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {list.map((k) => {
                const expired = k.expires_at && new Date(k.expires_at) < new Date()
                return (
                  <tr key={k.id} className={k.revoked_at ? 'muted-row' : undefined}>
                    <th scope="row">{k.name} {k.revoked_at ? <Badge tone="bad">Revoked</Badge> : expired ? <Badge tone="warn">Expired</Badge> : null}</th>
                    <td><code>{k.prefix}…</code></td>
                    <td>{apiName(k.api_id)}</td>
                    <td>{k.scopes.map((s) => <Badge key={s} tone={s === 'manage' ? 'accent' : 'neutral'}>{s === 'manage' ? 'Manage' : 'Call APIs'}</Badge>)}</td>
                    <td>{k.requests.toLocaleString()} calls<br /><span className="hint">last {timeAgo(k.last_used_at)}</span></td>
                    <td>{timeAgo(k.created_at)}{k.expires_at && <><br /><span className="hint">expires {new Date(k.expires_at).toLocaleDateString()}</span></>}</td>
                    <td className="actions-cell">
                      {!k.revoked_at && (
                        <Menu label={`Actions for ${k.name}`} items={[
                          { label: 'Rename', icon: 'edit', onSelect: () => rename(k) },
                          { label: 'Roll (new secret)', icon: 'refresh', onSelect: () => roll(k) },
                          { label: t('keys.revoke'), icon: 'trash', danger: true, onSelect: () => revoke(k) },
                        ]} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateKeyModal open={creating} onClose={() => setCreating(false)} apis={apis.data?.apis || []} onCreated={(name, value) => { setSecret({ name, value }); keys.reload() }} />
      <Modal open={!!secret} onClose={() => setSecret(null)} title={`Your new key: ${secret?.name}`} size="md" footer={<Button variant="primary" onClick={() => setSecret(null)}>I saved it</Button>}>
        <div className="secret-box">
          <p><Icon name="alert" /> {t('keys.copyNow')}</p>
          <code className="secret">{secret?.value}</code>
          {secret && <CopyButton text={secret.value} size="md" variant="primary" label="Copy key" />}
        </div>
        <p className="hint">Use it like this:</p>
        <pre className="code-block"><code>{`curl -H "x-api-key: ${secret?.value}" ${location.origin}/v1/<user>/<api>/<route>`}</code></pre>
      </Modal>
    </div>
  )
}

export function CreateKeyModal({ open, onClose, apis, onCreated, presetApi }: { open: boolean; onClose: () => void; apis: Api[]; onCreated: (name: string, secret: string) => void; presetApi?: string }) {
  const [name, setName] = useState('')
  const [apiId, setApiId] = useState('')
  const [manage, setManage] = useState(false)
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setName('')
      setApiId(presetApi || '')
      setManage(false)
      setExpires('')
      setError(null)
    }
  }, [open, presetApi])
  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ key: ApiKey; secret: string }>('/keys', { name: name || 'My key', api_id: apiId || null, scopes: manage ? ['invoke', 'manage'] : ['invoke'], expires_in_days: expires ? Number(expires) : undefined })
      onClose()
      onCreated(r.key.name, r.secret)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('keys.create')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={() => submit()}>{t('keys.create')}</Button></>}>
      <form onSubmit={submit} className="stack">
        {error && <div className="error-box" role="alert"><Icon name="alert" /><p>{error}</p></div>}
        <Field label="Name" hint="Something that tells you where it is used, like “Unity build” or “Discord bot”.">
          {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />}
        </Field>
        <Field label="Works on">
          {(p) => (
            <select {...p} className="input" value={apiId} onChange={(e) => setApiId(e.target.value)}>
              <option value="">All my APIs (and ones shared with me)</option>
              {apis.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Expires">
          {(p) => (
            <select {...p} className="input" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="">Never</option>
              <option value="1">In 1 day</option>
              <option value="7">In 7 days</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In 1 year</option>
            </select>
          )}
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={manage} onChange={(e) => setManage(e.target.checked)} />
          <span><strong>Also allow managing my APIs</strong> - lets scripts and AI agents edit files and endpoints through <code>/api/*</code>. Leave off for games and apps.</span>
        </label>
      </form>
    </Modal>
  )
}
