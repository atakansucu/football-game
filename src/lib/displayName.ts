const KEY = "fd:display_name";

/** Maps low-level client errors to a user-friendly message. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|fetch failed/i.test(msg)) {
    return "Supabase'e ulaşılamıyor. .env.local'daki URL/anahtarları ve backend'in ayakta olduğunu kontrol edin.";
  }
  if (/missing next_public_supabase/i.test(msg)) {
    return ".env.local eksik veya doldurulmamış (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).";
  }
  return msg;
}

export function getStoredDisplayName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function storeDisplayName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, name);
}
