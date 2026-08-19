"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { TopNav } from "@/components/TopNav";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
} from "@/lib/supabase/browserClient";
import {
  friendlyError,
  getStoredDisplayName,
  storeDisplayName,
} from "@/lib/displayName";
import { joinRoom } from "@/server/game/actions";

export default function JoinPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(getStoredDisplayName()), []);

  async function onJoin() {
    const displayName = name.trim() || "Player 2";
    const roomCode = code.trim().toUpperCase();
    if (roomCode.length < 4) {
      setError("Enter a valid room code");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      storeDisplayName(displayName);
      const supabase = getSupabaseBrowserClient();
      const userId = await ensureAnonymousUser();
      const res = await joinRoom(supabase, {
        userId,
        displayName,
        code: roomCode,
      });
      if (res.status === "not_found") {
        setError("Room not found");
        setBusy(false);
        return;
      }
      if (res.status === "full") {
        setError("Room is full");
        setBusy(false);
        return;
      }
      router.push(`/room/${res.code}`);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <TopNav />
      <h1 className="text-3xl font-black uppercase">Join Game</h1>

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-widest text-white/40">
          Your name
        </label>
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          maxLength={20}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-widest text-white/40">
          Room code
        </label>
        <input
          className="field text-center text-3xl font-black uppercase tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="F7K2"
          maxLength={4}
          autoCapitalize="characters"
          autoComplete="off"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button onClick={onJoin} disabled={busy}>
        {busy ? "Joining..." : "Join Room"}
      </Button>
    </main>
  );
}
