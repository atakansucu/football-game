import { describe, it, expect } from "vitest";
import { roleForSlot } from "@/lib/football/playerPick";
import { remainingSeconds } from "@/features/game/useRoundPhase";
import type { RoundRow } from "@/types/game";

describe("Player Pick role alternation (national_club)", () => {
  it("assigns opposite roles to the two slots each round", () => {
    expect(roleForSlot("national_club", 1, 1)).toBe("national_team");
    expect(roleForSlot("national_club", 1, 2)).toBe("club");
  });

  it("alternates every round", () => {
    // Round 1: P1 national team, P2 club
    expect(roleForSlot("national_club", 1, 1)).toBe("national_team");
    expect(roleForSlot("national_club", 1, 2)).toBe("club");
    // Round 2: swapped
    expect(roleForSlot("national_club", 2, 1)).toBe("club");
    expect(roleForSlot("national_club", 2, 2)).toBe("national_team");
    // Round 3: back to round 1 assignment
    expect(roleForSlot("national_club", 3, 1)).toBe("national_team");
    expect(roleForSlot("national_club", 3, 2)).toBe("club");
  });

  it("never gives both players the same role in a round", () => {
    for (let round = 1; round <= 10; round++) {
      expect(roleForSlot("national_club", round, 1)).not.toBe(
        roleForSlot("national_club", round, 2),
      );
    }
  });
});

describe("Player Pick role assignment (club_club)", () => {
  it("always assigns club to both players", () => {
    for (let round = 1; round <= 6; round++) {
      expect(roleForSlot("club_club", round, 1)).toBe("club");
      expect(roleForSlot("club_club", round, 2)).toBe("club");
    }
  });
});

describe("Server-authoritative 30s timer", () => {
  const base: Partial<RoundRow> = {
    id: "r1",
    state: "active",
    winner_user_id: null,
  };

  function roundEndingIn(seconds: number): RoundRow {
    const ends = new Date(Date.now() + seconds * 1000).toISOString();
    return { ...base, ends_at: ends } as RoundRow;
  }

  it("derives remaining time from the authoritative deadline", () => {
    expect(remainingSeconds(roundEndingIn(30), Date.now())).toBeGreaterThan(28);
    expect(remainingSeconds(roundEndingIn(30), Date.now())).toBeLessThanOrEqual(
      30,
    );
  });

  it("shows the real remaining time on reconnect (not a full 30)", () => {
    // Simulate a round that started earlier and has 11s left.
    const r = roundEndingIn(11);
    const left = remainingSeconds(r, Date.now());
    expect(left).toBeGreaterThan(9);
    expect(left).toBeLessThanOrEqual(11);
  });

  it("clamps to zero once the deadline has passed", () => {
    const r = roundEndingIn(-5);
    expect(remainingSeconds(r, Date.now())).toBe(0);
  });
});
