// The version of the Terms of Service / Privacy Policy people accept. Must
// match public.current_terms_version() in the database; bump both together
// when the documents change, and everyone is asked to accept again.
import { supabase } from './supabase';

export const TERMS_VERSION = '2026-10-11';
export const MOTTO = 'We Protect Your Privacy Because It’s Yours';

export interface LegalStatus {
  needs_terms: boolean;
  needs_birth_date: boolean;
}

export async function myLegalStatus(): Promise<LegalStatus | null> {
  const { data, error } = await supabase.rpc('my_legal_status');
  if (error || !data) return null; // older database: don't block anyone
  return data as LegalStatus;
}

export async function acceptTerms(birthDate: string | null) {
  const { error } = await supabase.rpc('accept_terms', { p_version: TERMS_VERSION, p_birth_date: birthDate });
  if (error) throw error;
}
