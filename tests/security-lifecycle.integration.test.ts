import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/0018_security_lifecycle.sql",
);

describe("0018 security migration contract", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("binds submissions to auth membership and wall-clock deadlines", () => {
    expect(sql).toContain("public.require_game_caller(p_user_id)");
    expect(sql).toMatch(
      /room_id = v_room_id and user_id = v_user[\s\S]+not_participant/,
    );
    expect(sql).toContain("v_now := clock_timestamp()");
  });

  it("locks lifecycle transitions and removes public maintenance grants", () => {
    expect(sql).toMatch(
      /create or replace function public\.join_room[\s\S]+for update/,
    );
    expect(sql).toMatch(
      /create or replace function public\.start_match[\s\S]+for update/,
    );
    expect(sql).toMatch(
      /create or replace function public\.play_again[\s\S]+for update/,
    );
    for (const fn of [
      "rebuild_answers",
      "rebuild_prominence",
      "refresh_solo_combos",
      "activate_due_rounds",
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke execute on function public\\.${fn}\\(`),
      );
    }
  });

  it("contains presence, leave, deletion, and active-answer protections", () => {
    expect(sql).toContain("function public.mark_stale_presence");
    expect(sql).toContain("function public.leave_room");
    expect(sql).toContain("function public.claim_abandoned_match");
    expect(sql).toContain("function public.request_account_deletion");
    expect(sql).toContain(
      "Answers are hidden while this challenge is active",
    );
    expect(sql).toContain('drop policy if exists "read rooms"');
    expect(sql).toContain('create policy "participants read rounds"');
    expect(sql).toContain("public.is_room_participant");
  });
});

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
const integrationEnabled =
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "1" &&
  Boolean(url && anonKey && serviceKey) &&
  isLocal;
const integration = integrationEnabled ? describe : describe.skip;

integration("authenticated multiplayer security (local Supabase)", () => {
  let service: SupabaseClient;
  let host: SupabaseClient;
  let guest: SupabaseClient;
  let outsider: SupabaseClient;
  let hostId: string;
  let guestId: string;

  async function anonymousClient(): Promise<{
    client: SupabaseClient;
    id: string;
  }> {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) {
      throw error ?? new Error("Anonymous sign-in did not return a user");
    }
    return { client, id: data.user.id };
  }

  beforeAll(async () => {
    service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [a, b, c] = await Promise.all([
      anonymousClient(),
      anonymousClient(),
      anonymousClient(),
    ]);
    host = a.client;
    hostId = a.id;
    guest = b.client;
    guestId = b.id;
    outsider = c.client;
  });

  async function createStartedRoom() {
    const created = await host.rpc("create_room", {
      p_user_id: hostId,
      p_display_name: "Security Host",
      p_game_mode: "national_club",
      p_win_target: 5,
      p_challenge_type: "random",
      p_league: null,
    });
    expect(created.error).toBeNull();
    const room = created.data as { room_id: string; code: string };

    const joined = await guest.rpc("join_room", {
      p_user_id: guestId,
      p_display_name: "Security Guest",
      p_code: room.code,
    });
    expect(joined.error).toBeNull();

    const started = await host.rpc("start_match", {
      p_user_id: hostId,
      p_room_id: room.room_id,
    });
    expect(started.error).toBeNull();
    return {
      roomId: room.room_id,
      roundId: (started.data as { round_id: string }).round_id,
    };
  }

  it("rejects identity spoofing and non-member submissions", async () => {
    const { roundId } = await createStartedRoom();

    const spoofed = await host.rpc("submit_answer", {
      p_user_id: guestId,
      p_round_id: roundId,
      p_raw_answer: "Nobody",
    });
    expect(spoofed.error?.code).toBe("42501");

    const {
      data: { user: outsiderUser },
    } = await outsider.auth.getUser();
    const nonMember = await outsider.rpc("submit_answer", {
      p_user_id: outsiderUser!.id,
      p_round_id: roundId,
      p_raw_answer: "Nobody",
    });
    expect(nonMember.error).toBeNull();
    expect((nonMember.data as { status: string }).status).toBe(
      "not_participant",
    );
  });

  it("serializes concurrent starts into one active match", async () => {
    const created = await host.rpc("create_room", {
      p_user_id: hostId,
      p_display_name: "Race Host",
      p_game_mode: "national_club",
      p_win_target: 5,
      p_challenge_type: "random",
      p_league: null,
    });
    const room = created.data as { room_id: string; code: string };
    await guest.rpc("join_room", {
      p_user_id: guestId,
      p_display_name: "Race Guest",
      p_code: room.code,
    });

    const [a, b] = await Promise.all([
      host.rpc("start_match", {
        p_user_id: hostId,
        p_room_id: room.room_id,
      }),
      host.rpc("start_match", {
        p_user_id: hostId,
        p_room_id: room.room_id,
      }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const statuses = [
      (a.data as { status: string }).status,
      (b.data as { status: string }).status,
    ].sort();
    expect(statuses).toEqual(["already_started", "ok"]);

    const { count } = await service
      .from("matches")
      .select("*", { count: "exact", head: true })
      .eq("room_id", room.room_id)
      .eq("status", "active");
    expect(count).toBe(1);
  });

  it("finalizes expiry idempotently and hides live answer lists", async () => {
    const { roundId } = await createStartedRoom();
    const { data: round } = await service
      .from("rounds")
      .select("national_team_id,club_1_id")
      .eq("id", roundId)
      .single();

    const leaked = await outsider.rpc("get_players_for_country_club", {
      p_national_team_id: round!.national_team_id,
      p_club_id: round!.club_1_id,
    });
    expect(leaked.error?.code).toBe("42501");

    await service
      .from("rounds")
      .update({
        state: "active",
        activated_at: new Date(Date.now() - 60_000).toISOString(),
        ends_at: new Date(Date.now() - 1_000).toISOString(),
      })
      .eq("id", roundId);

    const first = await guest.rpc("finish_round_if_expired", {
      p_round_id: roundId,
    });
    const second = await guest.rpc("finish_round_if_expired", {
      p_round_id: roundId,
    });
    expect((first.data as { status: string }).status).toBe("timed_out");
    expect((second.data as { status: string }).status).toBe(
      "already_finished",
    );
  });

  it("enforces participant RLS and restores a reconnecting snapshot", async () => {
    const { roomId, roundId } = await createStartedRoom();
    const { data: roomRow } = await service
      .from("rooms")
      .select("code")
      .eq("id", roomId)
      .single();

    const hostSnapshot = await host.from("rounds").select("id").eq("id", roundId);
    expect(hostSnapshot.error).toBeNull();
    expect(hostSnapshot.data).toHaveLength(1);

    const outsiderRoom = await outsider.from("rooms").select("id").eq("id", roomId);
    const outsiderRound = await outsider
      .from("rounds")
      .select("id")
      .eq("id", roundId);
    expect(outsiderRoom.error).toBeNull();
    expect(outsiderRoom.data).toHaveLength(0);
    expect(outsiderRound.error).toBeNull();
    expect(outsiderRound.data).toHaveLength(0);

    await service
      .from("room_players")
      .update({
        connected: false,
        last_seen: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("room_id", roomId)
      .eq("user_id", guestId);

    const rejoined = await guest.rpc("join_room", {
      p_user_id: guestId,
      p_display_name: "Security Guest",
      p_code: roomRow!.code,
    });
    expect(rejoined.error).toBeNull();
    expect((rejoined.data as { status: string }).status).toBe("ok");

    const { data: guestRows } = await service
      .from("room_players")
      .select("connected")
      .eq("room_id", roomId)
      .eq("user_id", guestId);
    expect(guestRows).toEqual([{ connected: true }]);
  });

  it("handles lobby leave and host transfer without orphaning the room", async () => {
    const created = await host.rpc("create_room", {
      p_user_id: hostId,
      p_display_name: "Lifecycle Host",
      p_game_mode: "national_club",
      p_win_target: 5,
      p_challenge_type: "random",
      p_league: null,
    });
    const room = created.data as { room_id: string; code: string };
    await guest.rpc("join_room", {
      p_user_id: guestId,
      p_display_name: "Lifecycle Guest",
      p_code: room.code,
    });

    const guestLeft = await guest.rpc("leave_room", {
      p_user_id: guestId,
      p_room_id: room.room_id,
    });
    expect((guestLeft.data as { status: string }).status).toBe("left");
    await guest.rpc("join_room", {
      p_user_id: guestId,
      p_display_name: "Lifecycle Guest",
      p_code: room.code,
    });

    const hostLeft = await host.rpc("leave_room", {
      p_user_id: hostId,
      p_room_id: room.room_id,
    });
    expect((hostLeft.data as { status: string }).status).toBe("left");

    const { data: remainingRoom } = await service
      .from("rooms")
      .select("host_user_id,status")
      .eq("id", room.room_id)
      .single();
    expect(remainingRoom).toEqual({
      host_user_id: guestId,
      status: "waiting",
    });
  });

  it("finishes a match when an opponent remains stale", async () => {
    const { roomId } = await createStartedRoom();
    await service
      .from("room_players")
      .update({
        connected: false,
        last_seen: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("room_id", roomId)
      .eq("user_id", guestId);

    const claimed = await host.rpc("claim_abandoned_match", {
      p_user_id: hostId,
      p_room_id: roomId,
    });
    expect(claimed.error).toBeNull();
    expect((claimed.data as { status: string }).status).toBe(
      "won_by_disconnect",
    );

    const { data: match } = await service
      .from("matches")
      .select("status,winner_user_id")
      .eq("room_id", roomId)
      .single();
    expect(match).toEqual({ status: "finished", winner_user_id: hostId });
  });

  it("lets an anonymous auth user delete its own account", async () => {
    const doomed = await anonymousClient();
    const result = await doomed.client.rpc("request_account_deletion");
    expect(result.error).toBeNull();
    expect((result.data as { status: string }).status).toBe("deleted");

    const lookup = await service.auth.admin.getUserById(doomed.id);
    expect(lookup.data.user).toBeNull();
  });
});

