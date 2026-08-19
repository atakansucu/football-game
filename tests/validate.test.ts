import { describe, expect, it } from "vitest";
import {
  getValidAnswersForChallenge,
  validateAnswer,
} from "@/lib/football/validate";
import type { Challenge } from "@/lib/football/types";
import { CLUB, NT, PL, dataset } from "./fixtures";

const turkeyRealMadrid: Challenge = {
  mode: "national_club",
  nationalTeamId: NT.turkey,
  clubId: CLUB.realMadrid,
};
const germanyRealMadrid: Challenge = {
  mode: "national_club",
  nationalTeamId: NT.germany,
  clubId: CLUB.realMadrid,
};
const franceChelsea: Challenge = {
  mode: "national_club",
  nationalTeamId: NT.france,
  clubId: CLUB.chelsea,
};
const arsenalBarcelona: Challenge = {
  mode: "club_club",
  clubAId: CLUB.arsenal,
  clubBId: CLUB.barcelona,
};
const realMadridBarcelona: Challenge = {
  mode: "club_club",
  clubAId: CLUB.realMadrid,
  clubBId: CLUB.barcelona,
};

describe("validateAnswer — national team × club", () => {
  it("1. accepts a valid answer", () => {
    const r = validateAnswer(dataset, turkeyRealMadrid, "Arda Güler");
    expect(r.valid).toBe(true);
    expect(r.player?.id).toBe(PL.arda);
  });

  it("2. rejects a wrong national team", () => {
    const r = validateAnswer(dataset, germanyRealMadrid, "Arda Güler");
    expect(r.matched).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.checks.nationalTeam).toBe(false);
    expect(r.checks.club).toBe(true);
  });

  it("3. rejects a wrong club", () => {
    const r = validateAnswer(dataset, franceChelsea, "Thierry Henry");
    expect(r.valid).toBe(false);
    expect(r.checks.nationalTeam).toBe(true);
    expect(r.checks.club).toBe(false);
  });

  it("4. rejects a player who transferred but never appeared", () => {
    // Ghost Player is German and joined Real Madrid but has 0 appearances.
    const r = validateAnswer(dataset, germanyRealMadrid, "Ghost Player");
    expect(r.matched).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.checks.club).toBe(false);
  });

  it("6. accepts accent-insensitive input", () => {
    const r = validateAnswer(dataset, turkeyRealMadrid, "arda guler");
    expect(r.valid).toBe(true);
    expect(r.player?.id).toBe(PL.arda);
  });
});

describe("validateAnswer — club × club", () => {
  it("5. accepts a player who appeared for both clubs", () => {
    const r = validateAnswer(dataset, arsenalBarcelona, "Thierry Henry");
    expect(r.valid).toBe(true);
  });

  it("7. resolves aliases", () => {
    const r = validateAnswer(dataset, arsenalBarcelona, "Cesc");
    expect(r.valid).toBe(true);
    expect(r.player?.id).toBe(PL.cesc);
  });
});

describe("validateAnswer — ambiguity", () => {
  it("accepts an ambiguous surname when exactly one candidate is valid", () => {
    // "Ronaldo" maps to Cristiano (Real Madrid) and Ronaldo Nazário (Barcelona).
    // For Portugal × Real Madrid only Cristiano qualifies.
    const r = validateAnswer(
      dataset,
      {
        mode: "national_club",
        nationalTeamId: NT.portugal,
        clubId: CLUB.realMadrid,
      },
      "Ronaldo",
    );
    expect(r.valid).toBe(true);
    expect(r.player?.id).toBe(PL.cristiano);
  });

  it("rejects an ambiguous surname when none/both are valid", () => {
    // Real Madrid × Barcelona: neither Ronaldo played for both clubs here.
    const r = validateAnswer(dataset, realMadridBarcelona, "Ronaldo");
    expect(r.matched).toBe(true);
    expect(r.ambiguous).toBe(true);
    expect(r.valid).toBe(false);
  });
});

describe("getValidAnswersForChallenge", () => {
  it("lists every valid player", () => {
    const ids = getValidAnswersForChallenge(dataset, arsenalBarcelona)
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual([PL.cesc, PL.henry].sort());
  });
});
