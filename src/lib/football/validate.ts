import { normalizePlayerName } from "./normalize";
import type {
  Challenge,
  FootballDataset,
  Player,
} from "./types";

export interface AnswerChecks {
  /** national_club mode */
  nationalTeam?: boolean;
  club?: boolean;
  /** club_club mode */
  clubA?: boolean;
  clubB?: boolean;
}

export interface AnswerResult {
  /** Whether the raw answer resolved to a concrete player. */
  matched: boolean;
  /** Whether it matched several candidates without a unique valid one. */
  ambiguous: boolean;
  /** Whether the resolved player is a valid answer for the challenge. */
  valid: boolean;
  player?: Player;
  /** Per-condition breakdown, used for player-only feedback on wrong answers. */
  checks: AnswerChecks;
}

function playedForNationalTeam(
  dataset: FootballDataset,
  playerId: string,
  nationalTeamId: string,
): boolean {
  return dataset.playerNationals.some(
    (r) => r.playerId === playerId && r.nationalTeamId === nationalTeamId,
  );
}

/**
 * True when the player has at least one official first-team appearance for the
 * club. By construction `playerClubs` only ever contains rows with
 * appearances >= 1, so presence is sufficient.
 */
function appearedForClub(
  dataset: FootballDataset,
  playerId: string,
  clubId: string,
): boolean {
  return dataset.playerClubs.some(
    (r) => r.playerId === playerId && r.clubId === clubId && r.appearances >= 1,
  );
}

export function checkPlayerAgainstChallenge(
  dataset: FootballDataset,
  challenge: Challenge,
  player: Player,
): { valid: boolean; checks: AnswerChecks } {
  if (challenge.mode === "national_club") {
    const nationalTeam = playedForNationalTeam(
      dataset,
      player.id,
      challenge.nationalTeamId,
    );
    const club = appearedForClub(dataset, player.id, challenge.clubId);
    return { valid: nationalTeam && club, checks: { nationalTeam, club } };
  }
  const clubA = appearedForClub(dataset, player.id, challenge.clubAId);
  const clubB = appearedForClub(dataset, player.id, challenge.clubBId);
  return { valid: clubA && clubB, checks: { clubA, clubB } };
}

export function isValidAnswerPlayer(
  dataset: FootballDataset,
  challenge: Challenge,
  player: Player,
): boolean {
  return checkPlayerAgainstChallenge(dataset, challenge, player).valid;
}

/** All players that are valid answers for the challenge. */
export function getValidAnswersForChallenge(
  dataset: FootballDataset,
  challenge: Challenge,
): Player[] {
  return dataset.players.filter((p) =>
    isValidAnswerPlayer(dataset, challenge, p),
  );
}

/**
 * Resolves candidate players for a raw answer. Exact/normalized full-name
 * matches take priority over alias matches. Returns the deduplicated list of
 * candidate players in priority order.
 */
function resolveCandidates(
  dataset: FootballDataset,
  rawName: string,
): Player[] {
  const norm = normalizePlayerName(rawName);
  if (!norm) return [];

  const byFullName = dataset.players.filter((p) => p.normalizedName === norm);
  if (byFullName.length > 0) return byFullName;

  const aliasPlayerIds = new Set(
    dataset.aliases
      .filter((a) => a.normalizedAlias === norm)
      .map((a) => a.playerId),
  );
  return dataset.players.filter((p) => aliasPlayerIds.has(p.id));
}

/**
 * Validates a raw typed answer against a challenge.
 *
 * Disambiguation: if several players match (e.g. the ambiguous surname
 * "Ronaldo"), the answer is only accepted when exactly one of them is a valid
 * answer for the current challenge. Otherwise it is treated as ambiguous and
 * rejected without a winner.
 */
export function validateAnswer(
  dataset: FootballDataset,
  challenge: Challenge,
  rawName: string,
): AnswerResult {
  const candidates = resolveCandidates(dataset, rawName);

  if (candidates.length === 0) {
    return { matched: false, ambiguous: false, valid: false, checks: {} };
  }

  if (candidates.length === 1) {
    const player = candidates[0];
    const { valid, checks } = checkPlayerAgainstChallenge(
      dataset,
      challenge,
      player,
    );
    return { matched: true, ambiguous: false, valid, player, checks };
  }

  // Multiple candidates: only accept if exactly one is valid for the challenge.
  const validOnes = candidates.filter((p) =>
    isValidAnswerPlayer(dataset, challenge, p),
  );
  if (validOnes.length === 1) {
    const player = validOnes[0];
    const { valid, checks } = checkPlayerAgainstChallenge(
      dataset,
      challenge,
      player,
    );
    return { matched: true, ambiguous: false, valid, player, checks };
  }

  return { matched: true, ambiguous: true, valid: false, checks: {} };
}
