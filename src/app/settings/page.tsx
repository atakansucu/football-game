"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TopNav } from "@/components/TopNav";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { friendlyError } from "@/lib/displayName";
import { requestAccountDeletion } from "@/server/game/actions";

export default function SettingsPage() {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.localStorage.clear();
        window.sessionStorage.clear();
        router.replace("/");
        return;
      }
      const result = await requestAccountDeletion(supabase);
      if (result.status !== "deleted") {
        throw new Error(
          result.status === "requires_server_deletion"
            ? "Your deletion request was received."
            : "Account could not be found.",
        );
      }
      await supabase.auth.signOut({ scope: "local" });
      window.localStorage.clear();
      window.sessionStorage.clear();
      router.replace("/");
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <TopNav />
      <div>
        <h1 className="text-3xl font-black uppercase">Settings</h1>
        <p className="mt-2 text-sm text-white/50">
          Football Duel uses an automatically generated guest account for
          multiplayer.
        </p>
      </div>

      <section className="rounded-2xl border border-red-400/20 bg-red-400/5 p-4">
        <h2 className="font-bold text-red-300">Delete guest account</h2>
        <p className="mt-2 text-sm text-white/60">
          This permanently deletes your guest account and associated game
          profile data. This action cannot be undone.
        </p>
        <label className="mt-4 flex items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 h-4 w-4 accent-red-400"
          />
          <span>I understand that my guest account will be deleted.</span>
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <Button
          className="mt-4 w-full"
          onClick={deleteAccount}
          disabled={!confirmed || busy}
        >
          {busy ? "Deleting..." : "Delete Account"}
        </Button>
      </section>
    </main>
  );
}
