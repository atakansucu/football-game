import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Best-effort load of .env.local (same pattern as submit.integration.test.ts).
function loadEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dbConfigured =
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "1" &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!anonKey &&
  !!url &&
  /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
const suite = dbConfigured ? describe : describe.skip;

suite("Player Pick (private selection, single reveal, validation)", () => {
  let actions: typeof import("@/server/game/actions");
  let supabase: SupabaseClient; // service role: bypasses RLS

  beforeAll(async () => {
    const { createServiceRoleClient } = await import(
      "@/lib/supabase/serverClient"
    );
    actions = await import("@/server/game/actions");
    supabase = createServiceRoleClient();
  });

  async function anonymousClient() {
    const client = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) {
      throw error ?? new Error("Anonymous sign-in did not return a user");
    }
    return { client, userId: data.user.id };
  }

  it("keeps selections private until both confirm, then reveals exactly once", async () => {
    const player1 = await anonymousClient();
    const player2 = await anonymousClient();
    const user1 = player1.userId;
    const user2 = player2.userId;

    const created = await actions.createRoom(player1.client, {
      userId: user1,
      displayName: "Atakan",
      gameMode: "national_club",
      winTarget: 5,
      challengeType: "player_pick",
    });
    expect(created.status).toBe("ok");
    await actions.joinRoom(player2.client, {
      userId: user2,
      displayName: "Rakip",
      code: created.code,
    });
    const started = await actions.startMatch(player1.client, {
      userId: user1,
      roomId: created.room_id,
    });
    const roundId = started.round_id!;

    // Round begins in the private selection phase with roles assigned but no
    // challenge yet.
    const { data: round0 } = await supabase
      .from("rounds")
      .select("*")
      .eq("id", roundId)
      .single();
    expect(round0.state).toBe("selection");
    expect(round0.national_team_id).toBeNull();
    expect(round0.club_1_id).toBeNull();
    expect(round0.sel1_role).not.toBeNull();

    // Privacy: a real (anon) client cannot read the private selections table.
    const { data: leak } = await player1.client
      .from("round_selections")
      .select("*")
      .eq("round_id", roundId);
    expect(leak ?? []).toHaveLength(0);

    // The participant-visible round exposes no challenge before reveal.
    const { data: pubRound } = await player1.client
      .from("rounds")
      .select("national_team_id, club_1_id, club_2_id")
      .eq("id", roundId)
      .single();
    expect(pubRound?.national_team_id).toBeNull();
    expect(pubRound?.club_1_id).toBeNull();

    // Pick a known-valid national_team x club combination.
    const { data: combo } = await supabase
      .from("country_club_answers")
      .select("national_team_id, club_id")
      .limit(1)
      .single();
    if (!combo) throw new Error("no country_club_answers seeded");

    const natUser = round0.sel1_role === "national_team" ? user1 : user2;
    const clubUser = natUser === user1 ? user2 : user1;

    // First confirmation just waits; nothing is revealed.
    const natClient = natUser === user1 ? player1.client : player2.client;
    const clubClient = clubUser === user1 ? player1.client : player2.client;
    const first = await actions.confirmSelection(natClient, {
      userId: natUser,
      roundId,
      selectionId: combo.national_team_id,
    });
    expect(first.status).toBe("waiting");

    const { data: midRound } = await supabase
      .from("rounds")
      .select("state, national_team_id")
      .eq("id", roundId)
      .single();
    if (!midRound) throw new Error("round vanished");
    expect(midRound.state).toBe("selection");
    expect(midRound.national_team_id).toBeNull();

    // Second confirmation triggers the reveal.
    const second = await actions.confirmSelection(clubClient, {
      userId: clubUser,
      roundId,
      selectionId: combo.club_id,
    });
    expect(second.status).toBe("revealed");

    const { data: revealed } = await supabase
      .from("rounds")
      .select("*")
      .eq("id", roundId)
      .single();
    expect(revealed.state).toBe("countdown");
    expect(revealed.national_team_id).toBe(combo.national_team_id);
    expect(revealed.club_1_id).toBe(combo.club_id);
    expect(revealed.ends_at).not.toBeNull();

    // Reveal happens exactly once: further confirms are no-ops.
    const again = await actions.confirmSelection(natClient, {
      userId: natUser,
      roundId,
      selectionId: combo.national_team_id,
    });
    expect(again.status).toBe("already_revealed");
  }, 20000);

  it("rejects the same club in Club x Club, resets, then accepts a valid pair", async () => {
    const player1 = await anonymousClient();
    const player2 = await anonymousClient();
    const user1 = player1.userId;
    const user2 = player2.userId;

    const created = await actions.createRoom(player1.client, {
      userId: user1,
      displayName: "A",
      gameMode: "club_club",
      winTarget: 5,
      challengeType: "player_pick",
    });
    await actions.joinRoom(player2.client, {
      userId: user2,
      displayName: "B",
      code: created.code,
    });
    const started = await actions.startMatch(player1.client, {
      userId: user1,
      roomId: created.room_id,
    });
    const roundId = started.round_id!;

    // Both privately pick the SAME club — allowed during selection.
    const { data: someClub } = await supabase
      .from("clubs")
      .select("id")
      .limit(1)
      .single();
    if (!someClub) throw new Error("no clubs seeded");

    await actions.confirmSelection(player1.client, {
      userId: user1,
      roundId,
      selectionId: someClub.id,
    });
    const conflict = await actions.confirmSelection(player2.client, {
      userId: user2,
      roundId,
      selectionId: someClub.id,
    });
    expect(conflict.status).toBe("invalid");
    expect(conflict.reason).toBe("same_club");

    // Selection phase resumes with confirmations cleared.
    const { data: afterReset } = await supabase
      .from("rounds")
      .select("state, sel1_confirmed, sel2_confirmed, invalid_reason")
      .eq("id", roundId)
      .single();
    if (!afterReset) throw new Error("round vanished");
    expect(afterReset.state).toBe("selection");
    expect(afterReset.sel1_confirmed).toBe(false);
    expect(afterReset.sel2_confirmed).toBe(false);
    expect(afterReset.invalid_reason).toBe("same_club");

    // Now pick a valid, distinct pair.
    const { data: pair } = await supabase
      .from("club_club_answers")
      .select("club_1_id, club_2_id")
      .limit(1)
      .single();
    if (!pair) throw new Error("no club_club_answers seeded");

    await actions.confirmSelection(player1.client, {
      userId: user1,
      roundId,
      selectionId: pair.club_1_id,
    });
    const ok = await actions.confirmSelection(player2.client, {
      userId: user2,
      roundId,
      selectionId: pair.club_2_id,
    });
    expect(ok.status).toBe("revealed");
  }, 20000);

  it("search_players returns global results independent of any challenge", async () => {
    const player = await anonymousClient();
    const { data: anyPlayer } = await supabase
      .from("players")
      .select("name")
      .limit(1)
      .single();
    if (!anyPlayer) throw new Error("no players seeded");
    const prefix = (anyPlayer.name as string).slice(0, 3);
    const results = await actions.searchPlayers(player.client, prefix);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(8);
    for (const r of results) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.name).toBe("string");
    }
  }, 20000);

  it("Random mode still works unchanged (challenge auto-generated with a deadline)", async () => {
    const player1 = await anonymousClient();
    const player2 = await anonymousClient();
    const user1 = player1.userId;
    const user2 = player2.userId;
    const created = await actions.createRoom(player1.client, {
      userId: user1,
      displayName: "A",
      gameMode: "national_club",
      winTarget: 5,
      challengeType: "random",
    });
    await actions.joinRoom(player2.client, {
      userId: user2,
      displayName: "B",
      code: created.code,
    });
    const started = await actions.startMatch(player1.client, {
      userId: user1,
      roomId: created.room_id,
    });
    const { data: round } = await supabase
      .from("rounds")
      .select("*")
      .eq("id", started.round_id!)
      .single();
    expect(round.challenge_type).toBe("random");
    expect(round.state).toBe("countdown");
    expect(round.national_team_id).not.toBeNull();
    expect(round.ends_at).not.toBeNull();
  }, 20000);
});
