"use client";

import { useEffect, useState } from "react";
import { Autocomplete } from "@/components/Autocomplete";
import { TopNav } from "@/components/TopNav";
import { clsx } from "@/lib/clsx";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { friendlyError } from "@/lib/displayName";
import {
  fetchClubs,
  fetchNationalTeams,
  getPlayersForClubClub,
  getPlayersForCountryClub,
  type LookupPlayer,
  type NamedEntity,
} from "@/features/lookup/api";
import type { GameMode } from "@/types/game";

const MODES: { value: GameMode; label: string }[] = [
  { value: "national_club", label: "National Team × Club" },
  { value: "club_club", label: "Club × Club" },
];

/** Total official appearances across the player's matched clubs. */
function totalAppearances(p: LookupPlayer): number {
  return p.clubs.reduce((sum, c) => sum + (c.appearances ?? 0), 0);
}

/** Sort players by appearances (desc) and their clubs by appearances (desc). */
function sortByAppearances(players: LookupPlayer[]): LookupPlayer[] {
  return players
    .map((p) => ({
      ...p,
      clubs: [...p.clubs].sort(
        (a, b) => (b.appearances ?? 0) - (a.appearances ?? 0),
      ),
    }))
    .sort((a, b) => totalAppearances(b) - totalAppearances(a));
}

export default function LookupPage() {
  const [mode, setMode] = useState<GameMode>("national_club");
  const [clubs, setClubs] = useState<NamedEntity[]>([]);
  const [nationalTeams, setNationalTeams] = useState<NamedEntity[]>([]);

  const [ntId, setNtId] = useState<string | null>(null);
  const [clubId, setClubId] = useState<string | null>(null);
  const [clubAId, setClubAId] = useState<string | null>(null);
  const [clubBId, setClubBId] = useState<string | null>(null);

  const [results, setResults] = useState<LookupPlayer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load reference data once.
  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const [c, n] = await Promise.all([
          fetchClubs(supabase),
          fetchNationalTeams(supabase),
        ]);
        setClubs(c);
        setNationalTeams(n);
      } catch (e) {
        setError(friendlyError(e));
      }
    })();
  }, []);

  const sameClub =
    mode === "club_club" && clubAId !== null && clubAId === clubBId;

  // Run the lookup whenever a complete, valid selection is present.
  useEffect(() => {
    const ready =
      mode === "national_club"
        ? !!ntId && !!clubId
        : !!clubAId && !!clubBId && !sameClub;

    if (!ready) {
      setResults(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const data =
          mode === "national_club"
            ? await getPlayersForCountryClub(supabase, ntId!, clubId!)
            : await getPlayersForClubClub(supabase, clubAId!, clubBId!);
        if (!cancelled) setResults(sortByAppearances(data));
      } catch (e) {
        if (!cancelled) setError(friendlyError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, ntId, clubId, clubAId, clubBId, sameClub]);

  function switchMode(m: GameMode) {
    setMode(m);
    setResults(null);
    setError(null);
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <TopNav />
      <h1 className="text-3xl font-black uppercase">Player Lookup</h1>

      <div className="grid grid-cols-2 gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => switchMode(m.value)}
            className={clsx(
              "rounded-xl border px-3 py-3 text-sm font-semibold transition",
              mode === m.value
                ? "border-accent bg-accent/15"
                : "border-white/10 bg-white/5 text-white/70",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="card space-y-4 p-5">
        {mode === "national_club" ? (
          <>
            <Autocomplete
              label="National team"
              placeholder="Search national team..."
              items={nationalTeams}
              value={ntId}
              onChange={setNtId}
            />
            <Autocomplete
              label="Club"
              placeholder="Search club..."
              items={clubs}
              value={clubId}
              onChange={setClubId}
            />
          </>
        ) : (
          <>
            <Autocomplete
              label="Club A"
              placeholder="Search club..."
              items={clubs}
              value={clubAId}
              onChange={setClubAId}
            />
            <Autocomplete
              label="Club B"
              placeholder="Search club..."
              items={clubs}
              value={clubBId}
              onChange={setClubBId}
            />
          </>
        )}
      </div>

      {sameClub && (
        <p className="text-center text-sm text-white/50">
          Select two different clubs.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading && <p className="text-center text-white/50">Searching...</p>}

      {!loading && results !== null && (
        <div className="space-y-3">
          {results.length === 0 ? (
            <p className="text-center text-white/60">
              No players found for this combination.
            </p>
          ) : (
            <>
              <p className="text-xs uppercase tracking-widest text-white/40">
                {results.length} player{results.length === 1 ? "" : "s"}
              </p>
              <ul className="space-y-3">
                {results.map((p) => (
                  <li key={p.player_id} className="card space-y-2 p-4">
                    <div className="text-xl font-bold">{p.name}</div>
                    {p.national_teams.length > 0 && (
                      <div className="text-sm text-accent-soft">
                        {p.national_teams.join(", ")}
                      </div>
                    )}
                    <div className="space-y-1">
                      {p.clubs.map((c) => (
                        <div
                          key={c.name}
                          className="flex items-center justify-between text-sm text-white/80"
                        >
                          <span>{c.name}</span>
                          <span className="tabular-nums text-white/50">
                            {c.appearances != null
                              ? `${c.appearances} appearances`
                              : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </main>
  );
}
