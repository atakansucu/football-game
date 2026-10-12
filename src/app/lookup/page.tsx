"use client";

import { useEffect, useRef, useState } from "react";
import { Autocomplete } from "@/components/Autocomplete";
import { TeamBadge } from "@/components/TeamBadge";
import { TopNav } from "@/components/TopNav";
import { clsx } from "@/lib/clsx";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { dismissKeyboard } from "@/lib/keyboard";
import { friendlyError } from "@/lib/displayName";
import {
  fetchClubs,
  fetchNationalTeams,
  getCachedClubs,
  getCachedNationalTeams,
  getCachedProfile,
  getPlayerProfile,
  getPlayersForClubClub,
  getPlayersForCountryClub,
  prefetchPlayerProfile,
  type LookupPlayer,
  type NamedEntity,
  type PlayerProfile,
} from "@/features/lookup/api";
import type { GameMode } from "@/types/game";

const MODES: { value: GameMode; label: string }[] = [
  { value: "national_club", label: "National Team × Club" },
  { value: "club_club", label: "Club × Club" },
];

/** One club line with a generated badge and appearance count. */
function ClubLine({
  name,
  appearances,
}: {
  name: string;
  appearances: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-white/80">
      <span className="inline-flex min-w-0 items-center gap-2">
        <TeamBadge name={name} size={18} />
        <span className="truncate">{name}</span>
      </span>
      <span className="shrink-0 tabular-nums text-white/50">
        {appearances != null ? `${appearances} matches` : "—"}
      </span>
    </div>
  );
}

/**
 * A result card. Collapsed it shows the player and the clubs that matched the
 * current combination; tapping expands it to the player's ENTIRE career (all
 * clubs + national teams), fetched lazily the first time it's opened.
 */
function PlayerRow({ player }: { player: LookupPlayer }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile | null>(() =>
    getCachedProfile(player.player_id),
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Warm the profile as soon as the row is pressed (fires before onClick), so
  // even rows past the initial prefetch window expand with minimal delay.
  function warm() {
    if (profile) return;
    void prefetchPlayerProfile(
      getSupabaseBrowserClient(),
      player.player_id,
    ).catch(() => {});
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !profile && !loading) {
      const cached = getCachedProfile(player.player_id);
      if (cached) {
        setProfile(cached);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const supabase = getSupabaseBrowserClient();
        setProfile(await getPlayerProfile(supabase, player.player_id));
      } catch (e) {
        setErr(friendlyError(e));
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <li className="card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        onPointerDown={warm}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <span className="min-w-0 space-y-2">
          <span className="block text-xl font-bold">{player.name}</span>
          {player.national_teams.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-accent-soft">
              {player.national_teams.map((nt) => (
                <span key={nt} className="inline-flex items-center gap-1">
                  <TeamBadge name={nt} national size={16} />
                  {nt}
                </span>
              ))}
            </span>
          )}
          <span className="block space-y-1">
            {player.clubs.map((c) => (
              <ClubLine key={c.name} name={c.name} appearances={c.appearances} />
            ))}
          </span>
        </span>
        <span
          className={clsx(
            "mt-1 shrink-0 text-white/40 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-white/10 px-4 pb-4 pt-3">
          {loading && <p className="text-sm text-white/50">Loading career…</p>}
          {err && <p className="text-sm text-red-400">{err}</p>}
          {profile && (
            <>
              <p className="text-xs uppercase tracking-widest text-white/40">
                Full career · {profile.clubs.length} club
                {profile.clubs.length === 1 ? "" : "s"}
              </p>
              <div className="space-y-1">
                {profile.clubs.map((c) => (
                  <ClubLine
                    key={c.name}
                    name={c.name}
                    appearances={c.appearances}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

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
  // Seed from the persisted cache so the selectors are usable immediately.
  const [clubs, setClubs] = useState<NamedEntity[]>(getCachedClubs);
  const [nationalTeams, setNationalTeams] = useState<NamedEntity[]>(
    getCachedNationalTeams,
  );

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

  // Warm the lookup query path the moment this screen opens, using the first
  // available ids. The user then spends a few seconds picking two teams, during
  // which the (cold) DB — planner, indexes, shared buffers, and any resume cost
  // — gets hot, so their first real search returns without the freeze. The
  // throwaway result is discarded (it may even be an empty combo; warming the
  // path is the point). Fires once, as soon as reference data is available.
  const warmedRef = useRef(false);
  useEffect(() => {
    if (warmedRef.current) return;
    if (nationalTeams.length === 0 || clubs.length < 2) return;
    warmedRef.current = true;
    const supabase = getSupabaseBrowserClient();
    void getPlayersForCountryClub(
      supabase,
      nationalTeams[0].id,
      clubs[0].id,
    ).catch(() => {});
    void getPlayersForClubClub(supabase, clubs[0].id, clubs[1].id).catch(
      () => {},
    );
  }, [nationalTeams, clubs]);

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

    // Both teams are picked — drop the keyboard so results aren't hidden behind
    // it and the list is immediately readable.
    dismissKeyboard();

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
        if (!cancelled) {
          const sorted = sortByAppearances(data);
          setResults(sorted);
          // Warm the "Full career" detail for the first results so tapping to
          // expand feels instant instead of waiting on the RPC.
          for (const p of sorted.slice(0, 12)) {
            void prefetchPlayerProfile(supabase, p.player_id).catch(() => {});
          }
        }
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
              iconKind="national"
            />
            <Autocomplete
              label="Club"
              placeholder="Search club..."
              items={clubs}
              value={clubId}
              onChange={setClubId}
              iconKind="club"
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
              iconKind="club"
            />
            <Autocomplete
              label="Club B"
              placeholder="Search club..."
              items={clubs}
              value={clubBId}
              onChange={setClubBId}
              iconKind="club"
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
                  <PlayerRow key={p.player_id} player={p} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </main>
  );
}
