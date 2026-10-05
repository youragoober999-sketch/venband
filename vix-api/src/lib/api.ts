// Typed client for the Vix Api platform API (/api/*).

export type User = {
  id: string
  username: string
  display_name: string
  bio: string
  avatar_color: string
  created_at: string
  settings?: Record<string, unknown>
}

export type Role = 'owner' | 'editor' | 'viewer'

export type ExtState = { enabled: boolean; config: Record<string, unknown> }

export type Api = {
  id: string
  owner_id: string
  slug: string
  name: string
  description: string
  icon: string
  visibility: 'private' | 'public'
  require_key: boolean
  status: 'live' | 'paused'
  extensions: Record<string, ExtState>
  created_at: string
  updated_at: string
  role: Role
  owner_username?: string
  endpoint_count?: number
}

export type VFile = { id?: string; path: string; is_folder: boolean; content: string; updated_at?: string; updated_by?: string | null }

export type Endpoint = {
  id: string
  api_id: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ANY'
  route: string
  file_path: string
  description: string
  enabled: boolean
  public: boolean
  created_at: string
}

export type Member = { user_id: string; role: 'viewer' | 'editor'; added_at: string; user: User }

export type ApiKey = {
  id: string
  name: string
  prefix: string
  api_id: string | null
  scopes: string[]
  requests: number
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

export type Friend = { id: string; status: 'pending' | 'accepted'; created_at: string; outgoing: boolean; user: User & { last_seen_at?: string } }

export type LogRow = {
  id: number
  method: string
  path: string
  status: number
  duration_ms: number
  ip: string
  error: string
  console: string
  body: string
  cached: boolean
  created_at: string
}

export type RunResult = {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  engine: string
  compileOutput?: string
  value?: unknown
  hasHandler?: boolean
  error?: string
  logs?: { level: string; text: string }[]
  staticMime?: string
}

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

const TOKEN_KEY = 'vix:token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode */
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export async function call<T = any>(method: string, path: string, body?: unknown, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: opts.signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'Could not reach Vix Api. Check your internet connection.')
  }
  const text = await res.text()
  let data: any = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { error: text.slice(0, 200) || res.statusText }
  }
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized) onUnauthorized()
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data)
  }
  return data as T
}

export const api = {
  get: <T = any>(p: string, o?: { signal?: AbortSignal }) => call<T>('GET', p, undefined, o),
  post: <T = any>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => call<T>('PATCH', p, b ?? {}),
  del: <T = any>(p: string, b?: unknown) => call<T>('DELETE', p, b),
}

export function siteOrigin() {
  return typeof location !== 'undefined' ? location.origin : 'https://your-site.vercel.app'
}

export function apiBaseUrl(owner: string, slug: string) {
  return `${siteOrigin()}/v1/${owner}/${slug}`
}
