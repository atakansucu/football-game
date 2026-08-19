import { describe, expect, it } from "vitest";
import {
  buildClubClubAnswers,
  buildCountryClubAnswers,
  challengeHasAnswer,
  generateChallenge,
  listClubClubChallenges,
  listNationalClubChallenges,
} from "@/lib/football/challenge";
import { CLUB, NT, dataset } from "./fixtures";

describe("precomputed answers", () => {
  it("excludes zero-appearance transfers from country_club answers", () => {
    const answers = buildCountryClubAnswers(dataset);
    // Ghost Player (Germany, Real Madrid, 0 apps) must not appear.
    const germanyRM = answers.filter(
      (a) => a.nationalTeamId === NT.germany && a.clubId === CLUB.realMadrid,
    );
    expect(germanyRM.length).toBe(0);
  });

  it("builds club_club answers in canonical order", () => {
    const answers = buildClubClubAnswers(dataset);
    for (const a of answers) {
      expect(a.clubAId < a.clubBId).toBe(true);
    }
    // Henry + Cesc both qualify for Arsenal × Barcelona.
    const [a, b] = [CLUB.arsenal, CLUB.barcelona].sort();
    const combo = answers.filter(
      (x) => x.clubAId === a && x.clubBId === b,
    );
    expect(combo.length).toBeGreaterThanOrEqual(2);
  });
});

describe("generateChallenge", () => {
  it("11. never generates an impossible combination", () => {
    // Try many draws for both modes; every one must be answerable.
    for (let i = 0; i < 200; i++) {
      const nc = generateChallenge(dataset, "national_club", {
        random: () => i / 200,
      });
      expect(nc).not.toBeNull();
      expect(challengeHasAnswer(dataset, nc!)).toBe(true);

      const cc = generateChallenge(dataset, "club_club", {
        random: () => i / 200,
      });
      expect(cc).not.toBeNull();
      expect(challengeHasAnswer(dataset, cc!)).toBe(true);
    }
  });

  it("only lists answerable challenges", () => {
    for (const c of listNationalClubChallenges(dataset)) {
      expect(c.answerCount).toBeGreaterThanOrEqual(1);
      expect(challengeHasAnswer(dataset, c.challenge)).toBe(true);
    }
    for (const c of listClubClubChallenges(dataset)) {
      expect(c.answerCount).toBeGreaterThanOrEqual(1);
      expect(challengeHasAnswer(dataset, c.challenge)).toBe(true);
    }
  });

  it("does not offer an impossible pair (Turkey × Chelsea)", () => {
    const offered = listNationalClubChallenges(dataset).some(
      (c) =>
        c.challenge.nationalTeamId === NT.turkey &&
        c.challenge.clubId === CLUB.chelsea,
    );
    expect(offered).toBe(false);
  });
});
