"use client";

import { useEffect, useMemo, useState } from "react";
import { Autocomplete } from "@/components/Autocomplete";
import { Button } from "@/components/Button";
import { clsx } from "@/lib/clsx";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  fetchClubs,
  fetchNationalTeams,
  type NamedEntity,
} from "@/features/lookup/api";
import type { GameRoomApi } from "@/features/room/useGameRoom";
import type { SelectionRole } from "@/types/game";

const INVALID_MESSAGE: Record<string, string> = {
  no_answers: "No valid players exist for this combination. Choose again.",
  same_club: "Both players selected the same club. Choose again.",
};

/**
 * Player Pick private selection UI. The player only ever knows their OWN
 * choice; the opponent's selection is never fetched — only their public
 * "confirmed" flag on the round is visible until the server reveals.
 */
export function SelectionPhase({ api }: { api: GameRoomApi }) {
  const { round, mySlot } = api;
  const [clubs, setClubs] = useState<NamedEntity[]>([]);
  const [nationalTeams, setNationalTeams] = useState<NamedEntity[]>([]);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Reference data is public; loading it here reveals nothing about opponents.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getSupabaseBrowserClient();
        const [c, n] = await Promise.all([
          fetchClubs(db),
          fetchNationalTeams(db),
        ]);
        if (cancelled) return;
        setClubs(c);
        setNationalTeams(n);
      } catch {
        /* reference data is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const myRole: SelectionRole = useMemo(() => {
    if (!round || round.mode === "club_club") return "club";
    return (mySlot === 1 ? round.sel1_role : round.sel2_role) ?? "club";
  }, [round, mySlot]);

  const myConfirmed = mySlot === 1 ? round?.sel1_confirmed : round?.sel2_confirmed;
  const opponentConfirmed =
    mySlot === 1 ? round?.sel2_confirmed : round?.sel1_confirmed;

  // Reset the local pick whenever a new selection round begins or the server
  // rejects a combination (invalid_reason is set + confirmations cleared).
  useEffect(() => {
    setSelectionId(null);
    setLocalError(null);
  }, [round?.id, round?.invalid_reason]);

  if (!round) return null;

  const items = myRole === "national_team" ? nationalTeams : clubs;
  const roleLabel =
    round.mode === "club_club"
      ? "Choose your club"
      : myRole === "national_team"
        ? "Choose a National Team"
        : "Choose a Club";

  async function onConfirm() {
    if (!selectionId || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const res = await api.confirmSelection(selectionId);
      if (res.status === "invalid") {
        // Server reset both players; realtime will clear our confirmed flag.
        setLocalError(
          res.reason ? INVALID_MESSAGE[res.reason] : "Invalid combination.",
        );
        setSelectionId(null);
      }
      // "waiting" / "revealed": realtime drives the next state.
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not confirm.");
    } finally {
      setBusy(false);
    }
  }

  const bothConfirmed = myConfirmed && opponentConfirmed;
  const invalidBanner =
    round.invalid_reason && INVALID_MESSAGE[round.invalid_reason];

  return (
    <div className="space-y-5">
      <p className="text-center text-sm uppercase tracking-widest text-white/40">
        Round {round.round_number} · Player Pick
      </p>

      {(invalidBanner || localError) && (
        <div className="card border border-red-500/40 bg-red-500/10 p-4 text-center text-sm text-red-300">
          {localError ?? invalidBanner}
        </div>
      )}

      <div className="card space-y-4 p-5">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-white/40">
            Your role
          </p>
          <p className="text-lg font-bold text-accent">{roleLabel}</p>
        </div>

        {myConfirmed ? (
          <div className="py-4 text-center">
            <p className="text-xl font-black uppercase text-accent">
              ✓ Selection confirmed
            </p>
            <p className="mt-1 text-sm text-white/50">
              Your pick is locked in and hidden from your opponent.
            </p>
          </div>
        ) : (
          <>
            <Autocomplete
              label={
                myRole === "national_team" ? "National team" : "Club"
              }
              placeholder={
                myRole === "national_team"
                  ? "Search national team..."
                  : "Search club..."
              }
              items={items}
              value={selectionId}
              onChange={setSelectionId}
            />
            <Button onClick={onConfirm} disabled={!selectionId || busy}>
              {busy ? "Confirming..." : "Confirm Selection"}
            </Button>
          </>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm uppercase tracking-widest text-white/40">
            Opponent
          </span>
          <span
            className={clsx(
              "font-semibold",
              opponentConfirmed ? "text-accent" : "text-white/50",
            )}
          >
            {opponentConfirmed ? "✓ Confirmed" : "Choosing…"}
          </span>
        </div>
      </div>

      {bothConfirmed && !invalidBanner && (
        <p className="text-center text-lg font-black uppercase text-accent">
          Both players ready · Revealing…
        </p>
      )}
    </div>
  );
}
