"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Returns a singleton browser Supabase client. Used for realtime subscriptions,
 * anonymous auth and RPC calls from client components.
 *
 * Storage differs by platform:
 * - Web: `sessionStorage` (per-tab) so two browser tabs on one machine get
 *   separate anonymous identities and can play each other while testing.
 * - Native (Capacitor): `localStorage` so the anonymous identity survives app
 *   restarts (a native app is a single "tab" anyway).
 */
function pickAuthStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  const isNative = Boolean(
    (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    }).Capacitor?.isNativePlatform?.(),
  );
  return isNative ? window.localStorage : window.sessionStorage;
}

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
      storage: pickAuthStorage(),
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
