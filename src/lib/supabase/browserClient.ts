"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Returns a singleton browser Supabase client. Used for realtime subscriptions,
 * anonymous auth and RPC calls from client components.
 *
 * The auth session is stored in `sessionStorage` (per-tab) rather than cookies
 * or `localStorage` (shared across the whole browser profile). This means each
 * browser tab gets its own anonymous identity, so you can open two tabs on the
 * same computer and play as two different players.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.",
    );
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "fd-auth",
      storage:
        typeof window !== "undefined" ? window.sessionStorage : undefined,
    },
  });
  return client;
}

/**
 * Ensures the browser has an anonymous Supabase session and returns the user id.
 * Every game user is an anonymous auth user for the MVP.
 */
export async function ensureAnonymousUser(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(error?.message ?? "Anonymous sign-in failed");
  }
  return data.user.id;
}
