import { useEffect, useRef, useState } from 'react'
import { A, Avatar, Button, Empty, ErrorBox, Icon, Loading, ask, useAsync } from '../components/ui'
import { api, ApiError, type Friend, type User } from '../lib/api'
import { t } from '../lib/i18n'
import { navigate, useLocation } from '../lib/router'
import { useApp } from '../lib/store'
import { timeAgo } from '../lib/util'

type FriendData = { friends: Friend[]; incoming: Friend[]; outgoing: Friend[] }

export function Friends() {
  const { toast } = useApp()
  const { search } = useLocation()
  const { data, error, loading, reload } = useAsync(() => api.get<FriendData>('/friends'), [])
  const [name, setName] = useState('')
  const [suggest, setSuggest] = useState<User[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (search.get('add')) {
      inputRef.current?.focus()
      navigate('/friends', { replace: true })
    }
  }, [search])

  useEffect(() => {
    const q = name.trim().replace(/^@/, '')
    if (q.length < 2) {
      setSuggest([])
      return
    }
    const ctl = new AbortController()
    const timer = setTimeout(() => {
      api.get<{ users: User[] }>(`/users/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => setSuggest(r.users)).catch(() => {})
    }, 200)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [name])

  async function add(username: string) {
    setBusy(true)
    try {
      const r = await api.post<{ status: string }>('/friends', { username })
      toast(r.status === 'accepted' ? `You and @${username} are now friends!` : `Friend request sent to @${username}`, 'success')
      setName('')
      setSuggest([])
      reload()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function act(f: Friend, action: 'accept' | 'remove') {
    if (action === 'remove' && !(await ask({ title: f.status === 'accepted' ? `Remove @${f.user.username}?` : 'Cancel this request?', body: f.status === 'accepted' ? 'They keep access to APIs you already shared until you remove them in each API\'s Sharing tab.' : undefined, confirm: t('friends.remove'), danger: true }))) return
    if (action === 'accept') await api.post(`/friends/${f.id}/accept`)
    else await api.del(`/friends/${f.id}`)
    reload()
  }

  return (
    <div className="page narrow-wide">
      <div className="page-head">
        <div>
          <h1>{t('friends.title')}</h1>
          <p className="hint">Add friends by username, then share APIs with them from an API's <strong>Sharing</strong> tab so you can build together.</p>
        </div>
      </div>
      <form className="add-friend" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(name.trim().replace(/^@/, '').toLowerCase()) }}>
        <label htmlFor="friend-name" className="sr-only">{t('auth.username')}</label>
        <div className="input-with-icon">
          <Icon name="user" size={16} />
          <input ref={inputRef} id="friend-name" className="input" placeholder="@username" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} list="friend-suggest" />
          <datalist id="friend-suggest">{suggest.map((u) => <option key={u.id} value={u.username}>{u.display_name}</option>)}</datalist>
        </div>
        <Button type="submit" variant="primary" icon="plus" loading={busy}>{t('friends.add')}</Button>
      </form>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : data && (
        <>
          {data.incoming.length > 0 && (
            <section aria-labelledby="inc-title">
              <h2 id="inc-title" className="section-title">{t('friends.incoming')} <span className="count">{data.incoming.length}</span></h2>
              <ul className="people">
                {data.incoming.map((f) => (
                  <li key={f.id} className="person">
                    <Avatar user={f.user} size={40} />
                    <div className="person-text"><A href={`/u/${f.user.username}`}><strong>{f.user.display_name || f.user.username}</strong></A><span className="hint">@{f.user.username} · {timeAgo(f.created_at)}</span></div>
                    <Button size="sm" variant="primary" icon="check" onClick={() => act(f, 'accept')}>{t('friends.accept')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(f, 'remove')}>{t('friends.decline')}</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="fr-title">
            <h2 id="fr-title" className="section-title">{t('friends.title')} <span className="count">{data.friends.length}</span></h2>
            {data.friends.length === 0 ? <Empty icon="users" title={t('friends.none')} /> : (
              <ul className="people">
                {data.friends.map((f) => {
                  const online = f.user.last_seen_at && Date.now() - new Date(f.user.last_seen_at).getTime() < 10 * 60_000
                  return (
                    <li key={f.id} className="person">
                      <span className="avatar-wrap"><Avatar user={f.user} size={40} />{online && <span className="online-dot" aria-hidden="true" />}</span>
                      <div className="person-text">
                        <A href={`/u/${f.user.username}`}><strong>{f.user.display_name || f.user.username}</strong></A>
                        <span className="hint">@{f.user.username} · {online ? 'active now' : `seen ${timeAgo(f.user.last_seen_at)}`}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => act(f, 'remove')}>{t('friends.remove')}</Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          {data.outgoing.length > 0 && (
            <section aria-labelledby="out-title">
              <h2 id="out-title" className="section-title">{t('friends.outgoing')}</h2>
              <ul className="people">
                {data.outgoing.map((f) => (
                  <li key={f.id} className="person">
                    <Avatar user={f.user} size={40} />
                    <div className="person-text"><strong>{f.user.display_name || f.user.username}</strong><span className="hint">@{f.user.username} · waiting for them to accept</span></div>
                    <Button size="sm" variant="ghost" onClick={() => act(f, 'remove')}>{t('common.cancel')}</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
