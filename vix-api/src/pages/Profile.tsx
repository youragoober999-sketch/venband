import { useState } from 'react'
import { Avatar, Button, ErrorBox, Loading, useAsync } from '../components/ui'
import { api, ApiError, apiBaseUrl, type User } from '../lib/api'
import { useApp } from '../lib/store'
import { timeAgo } from '../lib/util'

type ProfileData = {
  user: User
  apis: { id: string; slug: string; name: string; description: string; icon: string; updated_at: string }[]
  friendship: { id: string; status: string; outgoing: boolean } | null
}

export function Profile({ username }: { username: string }) {
  const { user: me, toast } = useApp()
  const { data, error, loading, reload } = useAsync(() => api.get<ProfileData>(`/users/${encodeURIComponent(username)}`), [username])
  const [busy, setBusy] = useState(false)
  if (loading && !data) return <Loading />
  if (error) return <div className="page"><ErrorBox error={error} retry={reload} /></div>
  if (!data) return null
  const self = me?.id === data.user.id
  const fr = data.friendship
  return (
    <div className="page narrow-wide">
      <div className="profile-head">
        <Avatar user={data.user} size={72} />
        <div>
          <h1>{data.user.display_name || data.user.username}</h1>
          <p className="hint">@{data.user.username} · joined {timeAgo(data.user.created_at)}</p>
          {data.user.bio && <p>{data.user.bio}</p>}
        </div>
        {!self && (
          <div className="profile-actions">
            {!fr && <Button variant="primary" icon="plus" loading={busy} onClick={async () => { setBusy(true); try { await api.post('/friends', { username: data.user.username }); toast('Friend request sent', 'success'); reload() } catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'error') } finally { setBusy(false) } }}>Add friend</Button>}
            {fr?.status === 'pending' && fr.outgoing && <span className="badge badge-neutral">Request sent</span>}
            {fr?.status === 'pending' && !fr.outgoing && <Button variant="primary" onClick={async () => { await api.post(`/friends/${fr.id}/accept`); reload() }}>Accept friend request</Button>}
            {fr?.status === 'accepted' && <span className="badge badge-good">Friends</span>}
          </div>
        )}
      </div>
      <h2 className="section-title">Public APIs</h2>
      {data.apis.length === 0 ? <p className="hint">No public APIs yet.</p> : (
        <ul className="api-list api-grid">
          {data.apis.map((a) => (
            <li key={a.id} className="api-card">
              <div className="api-card-top">
                <span className="api-icon" aria-hidden="true">{a.icon}</span>
                <div className="api-card-title"><h3>{a.name}</h3><code className="api-path">{apiBaseUrl(data.user.username, a.slug)}</code></div>
              </div>
              {a.description && <p className="api-desc">{a.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
