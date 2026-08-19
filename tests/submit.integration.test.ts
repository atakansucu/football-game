import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Best-effort load of .env.local so the integration test can find the local
// Supabase keys without an extra dependency.
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

const dbConfigured =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The embedded `players(name)` relation may come back as an object or a
// single-element array depending on the client version; handle both.
function extractName(row: unknown): string {
  const rel = (row as { players?: unknown }).players;
  const p = Array.isArray(rel) ? rel[0] : rel;
  return (p as { name?: string })?.name ?? "";
}

// These tests require a running local Supabase (`supabase db reset`) with the
// service role key exported. They are skipped automatically otherwise.
const suite = dbConfigured ? describe : describe.skip;

suite("submit_answer (atomic, race-safe)", () => {
  // Imported lazily so the module doesn't blow up when env is missing.
  let createServiceRoleClient: typeof import("@/lib/supabase/serverClient").createServiceRoleClient;
  let actions: typeof import("@/server/game/actions");
  let supabase: ReturnType<typeof createServiceRoleClient>;

  const user1 = randomUUID();
  const user2 = randomUUID();

  beforeAll(async () => {
    ({ createServiceRoleClient } = await import("@/lib/supabase/serverClient"));
    actions = await import("@/server/game/actions");
    supabase = createServiceRoleClient();
  });

  async function validNamesForRound(roundId: string): Promise<string[]> {
    const { data: round } = await supabase
      .from("rounds")
      .select("*")
      .eq("id", roundId)
      .single();
    if (!round) return [];
    if (round.mode === "national_club") {
      const { data } = await supabase
        .from("country_club_answers")
        .select("players(name)")
        .eq("national_team_id", round.national_team_id!)
        .eq("club_id", round.club_1_id!)
        .limit(2);
      return (data ?? []).map((r) => extractName(r));
    }
    const { data } = await supabase
      .from("club_club_answers")
      .select("players(name)")
      .eq("club_1_id", round.club_1_id!)
      .eq("club_2_id", round.club_2_id!)
      .limit(2);
    return (data ?? []).map((r) => extractName(r));
  }

  it("assigns exactly one winner for simultaneous correct answers and rejects late/early submissions", async () => {
    const created = await actions.createRoom(supabase, {
      userId: user1,
      displayName: "Atakan",
      gameMode: "national_club",
      winTarget: 5,
    });
    expect(created.status).toBe("ok");

    const joined = await actions.joinRoom(supabase, {
      userId: user2,
      displayName: "Player 2",
      code: created.code,
    });
    expect(joined.status).toBe("ok");

    const started = await actions.startMatch(supabase, {
      userId: user1,
      roomId: created.room_id,
    });
    expect(started.status).toBe("ok");
    const roundId = started.round_id!;

    const names = await validNamesForRound(roundId);
    expect(names.length).toBeGreaterThanOrEqual(1);
    const nameA = names[0];
    const nameB = names[1] ?? names[0];

    // 10a. Submitting during the countdown is rejected.
    const early = await actions.submitRoundAnswer(supabase, {
      userId: user1,
      roundId,
      answer: nameA,
    });
    expect(early.status).toBe("round_not_active");

    // Wait for the 3s countdown to elapse.
    await sleep(3300);

    // 8/9. Two correct answers arrive almost simultaneously.
    const [r1, r2] = await Promise.all([
      actions.submitRoundAnswer(supabase, {
        userId: user1,
        roundId,
        answer: nameA,
      }),
      actions.submitRoundAnswer(supabase, {
        userId: user2,
        roundId,
        answer: nameB,
      }),
    ]);

    const wins = [r1, r2].filter((r) => r.status === "won");
    expect(wins.length).toBe(1);

    const { data: round } = await supabase
      .from("rounds")
      .select("*")
      .eq("id", roundId)
      .single();
    expect(round?.state).toBe("finished");
    expect(round?.winner_user_id).not.toBeNull();

    // 10b. Submitting after the round has ended is rejected.
    const late = await actions.submitRoundAnswer(supabase, {
      userId: user2,
      roundId,
      answer: nameB,
    });
    expect(late.status).toBe("round_not_active");
  }, 20000);
});
