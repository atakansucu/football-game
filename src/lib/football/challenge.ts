import {
  getValidAnswersForChallenge,
} from "./validate";
import type {
  Challenge,
  ClubClubChallenge,
  FootballDataset,
  GameMode,
  NationalClubChallenge,
} from "./types";

export interface CountryClubAnswer {
  nationalTeamId: string;
  clubId: string;
  playerId: string;
}

export interface ClubClubAnswer {
  clubAId: string;
  clubBId: string;
  playerId: string;
}

/** Deterministic ordering so club_club combinations are stored once. */
function orderClubIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Precomputes every valid (national_team, club, player) answer. A player is an
 * answer only when they represented the national team AND have >= 1 official
 * appearance for the club.
 */
export function buildCountryClubAnswers(
  dataset: FootballDataset,
): CountryClubAnswer[] {
  const clubIdsWithAppearances = new Map<string, Set<string>>();
  for (const rel of dataset.playerClubs) {
    if (rel.appearances < 1) continue;
    if (!clubIdsWithAppearances.has(rel.playerId)) {
      clubIdsWithAppearances.set(rel.playerId, new Set());
    }
    clubIdsWithAppearances.get(rel.playerId)!.add(rel.clubId);
  }

  const answers: CountryClubAnswer[] = [];
  for (const nat of dataset.playerNationals) {
    const clubs = clubIdsWithAppearances.get(nat.playerId);
    if (!clubs) continue;
    for (const clubId of clubs) {
      answers.push({
        nationalTeamId: nat.nationalTeamId,
        clubId,
        playerId: nat.playerId,
      });
    }
  }
  return answers;
}

/**
 * Precomputes every valid (clubA, clubB, player) answer where the player has
 * >= 1 official appearance for both clubs. Club ids are stored in canonical
 * order (clubAId < clubBId).
 */
export function buildClubClubAnswers(
  dataset: FootballDataset,
): ClubClubAnswer[] {
  const clubsByPlayer = new Map<string, string[]>();
  for (const rel of dataset.playerClubs) {
    if (rel.appearances < 1) continue;
    if (!clubsByPlayer.has(rel.playerId)) clubsByPlayer.set(rel.playerId, []);
    clubsByPlayer.get(rel.playerId)!.push(rel.clubId);
  }

  const answers: ClubClubAnswer[] = [];
  for (const [playerId, clubs] of clubsByPlayer) {
    const unique = Array.from(new Set(clubs));
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [clubAId, clubBId] = orderClubIds(unique[i], unique[j]);
        answers.push({ clubAId, clubBId, playerId });
      }
    }
  }
  return answers;
}

export interface ChallengeCandidate<C extends Challenge> {
  challenge: C;
  answerCount: number;
}

/** Distinct national_club challenges that have at least one valid answer. */
export function listNationalClubChallenges(
  dataset: FootballDataset,
): ChallengeCandidate<NationalClubChallenge>[] {
  const counts = new Map<string, number>();
  for (const a of buildCountryClubAnswers(dataset)) {
    const key = `${a.nationalTeamId}::${a.clubId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, answerCount]) => {
    const [nationalTeamId, clubId] = key.split("::");
    return {
      challenge: { mode: "national_club", nationalTeamId, clubId },
      answerCount,
    };
  });
}

/** Distinct club_club challenges that have at least one valid answer. */
export function listClubClubChallenges(
  dataset: FootballDataset,
): ChallengeCandidate<ClubClubChallenge>[] {
  const counts = new Map<string, number>();
  for (const a of buildClubClubAnswers(dataset)) {
    const key = `${a.clubAId}::${a.clubBId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, answerCount]) => {
    const [clubAId, clubBId] = key.split("::");
    return {
      challenge: { mode: "club_club", clubAId, clubBId },
      answerCount,
    };
  });
}

export interface GenerateChallengeOptions {
  /** Injectable RNG for deterministic tests. Returns a float in [0, 1). */
  random?: () => number;
  /** Prefer challenges with at least this many answers when possible. */
  preferMinAnswers?: number;
  /** Challenge keys to avoid repeating (e.g. already played this match). */
  exclude?: Set<string>;
}

export function challengeKey(challenge: Challenge): string {
  return challenge.mode === "national_club"
    ? `nc:${challenge.nationalTeamId}:${challenge.clubId}`
    : `cc:${challenge.clubAId}:${challenge.clubBId}`;
}

/**
 * Selects a playable challenge that is guaranteed to have at least one valid
 * answer. Impossible combinations are never returned. Combinations with more
 * answers are preferred, and previously used challenges can be excluded.
 */
export function generateChallenge(
  dataset: FootballDataset,
  mode: GameMode,
  options: GenerateChallengeOptions = {},
): Challenge | null {
  const random = options.random ?? Math.random;
  const preferMinAnswers = options.preferMinAnswers ?? 2;
  const exclude = options.exclude ?? new Set<string>();

  const candidates: ChallengeCandidate<Challenge>[] =
    mode === "national_club"
      ? listNationalClubChallenges(dataset)
      : listClubClubChallenges(dataset);

  // Never generate impossible rounds.
  const playable = candidates.filter((c) => c.answerCount >= 1);
  if (playable.length === 0) return null;

  const notExcluded = playable.filter(
    (c) => !exclude.has(challengeKey(c.challenge)),
  );
  const pool = notExcluded.length > 0 ? notExcluded : playable;

  const preferred = pool.filter((c) => c.answerCount >= preferMinAnswers);
  const finalPool = preferred.length > 0 ? preferred : pool;

  const idx = Math.floor(random() * finalPool.length);
  return finalPool[Math.min(idx, finalPool.length - 1)].challenge;
}

/** Convenience used by tests: verify a challenge is playable. */
export function challengeHasAnswer(
  dataset: FootballDataset,
  challenge: Challenge,
): boolean {
  return getValidAnswersForChallenge(dataset, challenge).length >= 1;
}
