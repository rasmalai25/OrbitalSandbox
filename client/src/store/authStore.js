// store/authStore.js
// Frontend §8.1 — holds the current Supabase session and subscribes to
// auth-state changes. Components read `user` and `signedIn` from here.
//
// When Supabase isn't configured (no env vars), this store stays in its
// initial { user: null } state forever — no errors, no warnings, the
// "Sign in" button just disappears.

import { create } from 'zustand';
import { getSupabase, isAuthConfigured } from '../auth/supabaseClient.js';

export const useAuthStore = create((set) => ({
  user: null,
  loading: isAuthConfigured,   // true until first session resolves
  isConfigured: isAuthConfigured,

  init() {
    const supabase = getSupabase();
    if (!supabase) {
      set({ loading: false });
      return () => {};
    }

    supabase.auth.getSession().then(({ data }) => {
      set({ user: data?.session?.user ?? null, loading: false });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null, loading: false });
    });

    return () => sub?.subscription?.unsubscribe?.();
  },
}));
