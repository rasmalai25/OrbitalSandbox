// auth/supabaseClient.js
// Frontend §8.1 — thin wrapper around @supabase/supabase-js that gracefully
// no-ops when the env vars aren't set. Anonymous play stays fully usable —
// only the "save to my account" path requires sign-in.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True if both env vars are set — used to gate sign-in UI. */
export const isAuthConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

// Build the client once at module load. When env vars are missing we still
// create a sentinel object so callers don't have to null-check — methods
// inside react to isAuthConfigured.
let _client = null;
if (isAuthConfigured) {
  _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export function getSupabase() {
  return _client; // null when not configured
}

export async function signInWithGoogle() {
  if (!_client) {
    console.warn('[auth] Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    return { error: 'Auth not configured' };
  }
  return _client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut() {
  if (!_client) return;
  await _client.auth.signOut();
}
