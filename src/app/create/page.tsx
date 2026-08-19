"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { TopNav } from "@/components/TopNav";
import { clsx } from "@/lib/clsx";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
} from "@/lib/supabase/browserClient";
import {
  friendlyError,
  getStoredDisplayName,
  storeDisplayName,
} from "@/lib/displayName";
import { createRoom, setRoomSettings } from "@/server/game/actions";
import type { ChallengeType, GameMode } from "@/types/game";
import { DEFAULT_WIN_TARGET } from "@/types/game";

const MODES: { value: GameMode; label: string }[] = [
  { value: "national_club", label: "National Team × Club" },
  { value: "club_club", label: "Club × Club" },
];

const CHALLENGE_TYPES: { value: ChallengeType; label: string; hint: string }[] =
  [
    { value: "random", label: "Random", hint: "The server picks each challenge" },
    {
      value: "player_pick",
      label: "Player Pick",
      hint: "Players secretly pick the teams each round",
    },
  ];

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("national_club");
  const [challengeType, setChallengeType] = useState<ChallengeType>("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(getStoredDisplayName()), []);

  async function onCreate() {
    const displayName = name.trim() || "Player 1";
    setBusy(true);
    setError(null);
    try {
      storeDisplayName(displayName);
      const supabase = getSupabaseBrowserClient();
      const userId = await ensureAnonymousUser();
      const res = await createRoom(supabase, {
        userId,
        displayName,
        gameMode: mode,
        winTarget: DEFAULT_WIN_TARGET,
        challengeType,
      });
      // Explicitly lock the defaults (Easy + first to 3) so the lobby never
      // shows a stale server default.
      await setRoomSettings(supabase, {
        userId,
        roomId: res.room_id,
        gameMode: mode,
        winTarget: DEFAULT_WIN_TARGET,
        challengeType,
        difficulty: "easy",
      });
      router.push(`/room/${res.code}`);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <TopNav />
      <h1 className="text-3xl font-black uppercase">Create Game</h1>

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
        <p className="text-xs uppercase tracking-widest text-white/40">
          Game mode
        </p>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            className={clsx(
              "w-full rounded-xl border px-4 py-3 text-left font-semibold transition",
              mode === m.value
                ? "border-accent bg-accent/15"
                : "border-white/10 bg-white/5 text-white/70",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-white/40">
          Challenge type
        </p>
        {CHALLENGE_TYPES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setChallengeType(c.value)}
            className={clsx(
              "w-full rounded-xl border px-4 py-3 text-left transition",
              challengeType === c.value
                ? "border-accent bg-accent/15"
                : "border-white/10 bg-white/5 text-white/70",
            )}
          >
            <span className="block font-semibold">{c.label}</span>
            <span className="block text-xs text-white/40">{c.hint}</span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button onClick={onCreate} disabled={busy}>
        {busy ? "Creating..." : "Create Room"}
      </Button>
    </main>
  );
}
