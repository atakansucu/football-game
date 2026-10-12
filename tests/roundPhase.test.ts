import { describe, expect, it } from "vitest";
import {
  countdownSecondsLeft,
  getRoundPhase,
  remainingSeconds,
} from "@/features/game/useRoundPhase";
import type { RoundRow } from "@/types/game";

function round(overrides: Partial<RoundRow> = {}): RoundRow {
  return {
    id: "round-1",
    match_id: "match-1",
    round_number: 1,
    mode: "national_club",
    challenge_type: "random",
    national_team_id: "nation-1",
    club_1_id: "club-1",
    club_2_id: null,
    state: "active",
    winner_user_id: null,
    winner_submission_id: null,
    winner_player_name: null,
    winner_time_ms: null,
    activated_at: "2026-10-12T12:00:03.000Z",
    ends_at: "2026-10-12T12:00:33.000Z",
    finished_at: null,
    created_at: "2026-10-12T12:00:00.000Z",
    national_team_name: "Türkiye",
    club_1_name: "Example FC",
    club_2_name: null,
    sel1_confirmed: false,
    sel2_confirmed: false,
    sel1_role: null,
    sel2_role: null,
    invalid_reason: null,
    no_winner: false,
    ready_1: false,
    ready_2: false,
    ...overrides,
  };
}

describe("server timestamp based round phase", () => {
  it("reconstructs countdown and active phases after a fresh snapshot", () => {
    const value = round();
    expect(getRoundPhase(value, Date.parse("2026-10-12T12:00:01.000Z"))).toBe(
      "countdown",
    );
    expect(countdownSecondsLeft(value, Date.parse("2026-10-12T12:00:01.000Z"))).toBe(
      2,
    );
    expect(getRoundPhase(value, Date.parse("2026-10-12T12:00:04.000Z"))).toBe(
      "active",
    );
  });

  it("never reports a negative remaining time", () => {
    const value = round();
    expect(remainingSeconds(value, Date.parse("2026-10-12T12:00:18.100Z"))).toBe(
      15,
    );
    expect(remainingSeconds(value, Date.parse("2026-10-12T12:01:00.000Z"))).toBe(
      0,
    );
  });

  it("treats a server-finished round as finished after reconnect", () => {
    expect(
      getRoundPhase(
        round({ state: "finished", no_winner: true }),
        Date.parse("2026-10-12T12:01:00.000Z"),
      ),
    ).toBe("finished");
  });
});
