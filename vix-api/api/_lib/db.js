// Server-side Supabase client. It uses the SECRET key, which bypasses Row Level
// Security, so it must only ever run inside these serverless functions.
import { createClient } from '@supabase/supabase-js'
import { HttpError } from './http.js'

let client = null

export function db() {
  if (client) return client
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new HttpError(503, 'Vix Api is not configured yet: set SUPABASE_URL and SUPABASE_SECRET_KEY in your Vercel project settings.')
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'vix-api-server' } },
  })
  return client
}

/** Unwraps a Supabase response, turning errors into HttpErrors. */
export function must(result, notFoundMsg) {
  if (result.error) {
    if (result.error.code === '23505') throw new HttpError(409, 'That name is already taken')
    if (result.error.code === 'PGRST116' && notFoundMsg) throw new HttpError(404, notFoundMsg)
    if (result.error.code === '42P01' || /relation .* does not exist|Could not find the table/i.test(result.error.message)) {
      throw new HttpError(503, 'The database tables are missing: run supabase/schema.sql in the Supabase SQL editor.')
    }
    throw new Error(result.error.message)
  }
  return result.data
}
