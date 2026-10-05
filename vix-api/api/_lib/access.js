// Who can do what with an API: the owner can do everything, "editor" members can
// change files/endpoints/settings, "viewer" members can read and run.
import { db, must } from './db.js'
import { notFound, forbidden } from './http.js'

const RANK = { viewer: 1, editor: 2, owner: 3 }

/** `who` is the result of requireUser() (or a bare user row). */
export async function loadApi(who, apiId, need = 'viewer') {
  const user = who.user || who
  if (!/^[0-9a-f-]{36}$/i.test(String(apiId))) throw notFound('API not found')
  if (who.via === 'key' && who.key.api_id && who.key.api_id !== apiId) throw forbidden('This API key is limited to a different API')
  const api = must(await db().from('vix_apis').select('*').eq('id', apiId).maybeSingle())
  if (!api) throw notFound('API not found')
  let role = null
  if (api.owner_id === user.id) role = 'owner'
  else {
    const m = must(await db().from('vix_api_members').select('role').eq('api_id', apiId).eq('user_id', user.id).maybeSingle())
    if (m) role = m.role
  }
  if (!role) throw notFound('API not found')
  if (RANK[role] < RANK[need]) throw forbidden(need === 'owner' ? 'Only the owner can do that' : 'You need editor access for that')
  return { api, role }
}

/** API keys can be limited to one API. */
export function checkKeyScope(who, apiId) {
  if (who.via === 'key' && who.key.api_id && who.key.api_id !== apiId) throw forbidden('This API key is limited to a different API')
}

/** Viewers never see secret values. */
export function redactApi(api, role) {
  if (role !== 'viewer' || !api.extensions?.secrets) return api
  const ext = { ...api.extensions, secrets: { ...api.extensions.secrets, config: { vars: '(hidden - only editors can see secrets)' } } }
  return { ...api, extensions: ext }
}
