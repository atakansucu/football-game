import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { NormalizedDataset } from "./types";

export type CsvRow = Record<string, string>;

export interface PipelineOptions {
  minAppearances?: number;
  maxPlayers?: number;
}

export interface PipelineStats {
  sourcePlayers: number;
  sourceClubs: number;
  sourceNationalTeams: number;
  sourceGames: number;
  appearanceRows: number;
  lineupRows: number;
  eventRows: number;
  acceptedAppearancePlayers: number;
  acceptedStartingLineupPlayers: number;
  acceptedEventPlayers: number;
  ignoredBenchRows: number;
  ignoredCardRows: number;
  ignoredAmbiguousEventRows: number;
  ignoredUnknownPlayerEvidence: number;
  ignoredUnresolvedTeamEvidence: number;
  zeroCapExplicitNationalTeamsRejected: number;
  profileNationalTeamsAccepted: number;
  clubClubEligiblePlayers: number;
  nationalClubEligiblePlayers: number;
  usablePlayers: number;
}

export interface DatasetMetrics {
  usablePlayers: number;
  clubClubEligiblePlayers: number;
  nationalClubEligiblePlayers: number;
  clubs: number;
  nationalTeams: number;
  clubClubChallenges: number;
  nationalClubChallenges: number;
  clubClubAnswers: number;
  nationalClubAnswers: number;
}

interface PlayerState {
  id: string;
  name: string;
  lastName: string;
  caps: number;
  nationalTeamIds: Set<string>;
  clubGames: Map<string, Set<string>>;
  evidence: Set<"appearance" | "starting_lineup" | "event">;
}

export interface Game {
  id: string;
  competitionId: string;
  isNationalTeamCompetition: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
}

interface ReferenceData {
  players: Map<string, PlayerState>;
  games: Map<string, Game>;
  clubIdToName: Map<string, string>;
  nationalTeamIdToName: Map<string, string>;
  nationalTeamByCountry: Map<string, string>;
  stats: PipelineStats;
}

interface EventParticipant {
  playerId: string;
  role: "goal" | "assist" | "substituted_out" | "substituted_in" | "shootout";
}

/** RFC-4180-compatible for the source's single-line records. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      out.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  out.push(current);
  return out;
}

function readCsv(file: string): CsvRow[] {
  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""]));
  });
}

export async function streamCsv(
  file: string,
  consume: (row: CsvRow) => void,
): Promise<void> {
  const input = createInterface({
    input: createReadStream(file, "utf8"),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  for await (const line of input) {
    if (!line) continue;
    if (!header) {
      header = splitCsvLine(line);
      continue;
    }
    const values = splitCsvLine(line);
    consume(
      Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])),
    );
  }
}

function number(value: string): number {
  const parsed = Number(value || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function classifyNationalTeamCompetition(
  gameType: string,
  competitionType: string,
  homeTeamId: string,
  awayTeamId: string,
  clubIds: ReadonlySet<string>,
  nationalTeamIds: ReadonlySet<string>,
): boolean {
  if (
    gameType === "national_team_competition" ||
    competitionType === "national_team_competition"
  ) {
    return true;
  }
  if (gameType || competitionType) return false;
  const bothNational =
    nationalTeamIds.has(homeTeamId) && nationalTeamIds.has(awayTeamId);
  const eitherClub = clubIds.has(homeTeamId) || clubIds.has(awayTeamId);
  return bothNational && !eitherClub;
}

/**
 * Return only event roles that prove the player was on the pitch.
 * Cards are deliberately excluded: Transfermarkt may record cards shown to
 * unused substitutes or staff. Own-goal rows are excluded unless another
 * source (appearance/starting lineup) already proves participation.
 */
export function qualifyingEventParticipants(row: CsvRow): EventParticipant[] {
  const type = row.type;
  if (type === "Cards") return [];
  if (type === "Goals") {
    if (/\bown[- ]goal\b/i.test(row.description ?? "")) return [];
    const participants: EventParticipant[] = [];
    if (row.player_id) participants.push({ playerId: row.player_id, role: "goal" });
    if (row.player_assist_id) {
      participants.push({ playerId: row.player_assist_id, role: "assist" });
    }
    return participants;
  }
  if (type === "Substitutions") {
    const participants: EventParticipant[] = [];
    if (row.player_id) {
      participants.push({ playerId: row.player_id, role: "substituted_out" });
    }
    if (row.player_in_id) {
      participants.push({ playerId: row.player_in_id, role: "substituted_in" });
    }
    return participants;
  }
  if (type === "Shootout" && row.player_id) {
    return [{ playerId: row.player_id, role: "shootout" }];
  }
  return [];
}

function teamNameForGame(
  game: Game,
  teamId: string,
  fallback: ReadonlyMap<string, string>,
): string | null {
  if (teamId === game.homeTeamId && game.homeTeamName) return game.homeTeamName;
  if (teamId === game.awayTeamId && game.awayTeamName) return game.awayTeamName;
  // Evidence must identify one of the two teams in the referenced game.
  if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) return null;
  return fallback.get(teamId) ?? null;
}

function addEvidence(
  player: PlayerState,
  game: Game,
  teamId: string,
  source: "appearance" | "starting_lineup" | "event",
  references: ReferenceData,
): boolean {
  const names = game.isNationalTeamCompetition
    ? references.nationalTeamIdToName
    : references.clubIdToName;
  const name = teamNameForGame(game, teamId, names);
  if (!name) return false;
  if (game.isNationalTeamCompetition) {
    references.nationalTeamIdToName.set(teamId, name);
    player.nationalTeamIds.add(teamId);
  } else {
    references.clubIdToName.set(teamId, name);
    const games = player.clubGames.get(teamId) ?? new Set<string>();
    games.add(game.id);
    player.clubGames.set(teamId, games);
  }
  player.evidence.add(source);
  return true;
}

async function loadReferenceData(csvDir: string): Promise<ReferenceData> {
  const clubRows = readCsv(path.join(csvDir, "clubs.csv"));
  const nationalTeamRows = readCsv(path.join(csvDir, "national_teams.csv"));
  const competitionRows = readCsv(path.join(csvDir, "competitions.csv"));
  const playerRows = readCsv(path.join(csvDir, "players.csv"));
  const clubIdToName = new Map(
    clubRows
      .filter((row) => row.club_id && row.name.trim())
      .map((row) => [row.club_id, row.name.trim()]),
  );
  const nationalTeamIdToName = new Map(
    nationalTeamRows
      .filter((row) => row.national_team_id && row.name.trim())
      .map((row) => [row.national_team_id, row.name.trim()]),
  );
  const nationalTeamByCountry = new Map(
    nationalTeamRows
      .filter((row) => row.country_name.trim() && row.national_team_id)
      .map((row) => [row.country_name.trim(), row.national_team_id]),
  );
  const competitionTypes = new Map(
    competitionRows.map((row) => [row.competition_id, row.type]),
  );
  const players = new Map<string, PlayerState>();
  const stats: PipelineStats = {
    sourcePlayers: 0,
    sourceClubs: clubIdToName.size,
    sourceNationalTeams: nationalTeamIdToName.size,
    sourceGames: 0,
    appearanceRows: 0,
    lineupRows: 0,
    eventRows: 0,
    acceptedAppearancePlayers: 0,
    acceptedStartingLineupPlayers: 0,
    acceptedEventPlayers: 0,
    ignoredBenchRows: 0,
    ignoredCardRows: 0,
    ignoredAmbiguousEventRows: 0,
    ignoredUnknownPlayerEvidence: 0,
    ignoredUnresolvedTeamEvidence: 0,
    zeroCapExplicitNationalTeamsRejected: 0,
    profileNationalTeamsAccepted: 0,
    clubClubEligiblePlayers: 0,
    nationalClubEligiblePlayers: 0,
    usablePlayers: 0,
  };

  for (const row of playerRows) {
    const id = row.player_id;
    const name = row.name.trim();
    if (!id || !name) continue;
    const caps = number(row.international_caps);
    const explicitNationalTeamId = row.current_national_team_id.trim();
    const fallbackNationalTeamId = nationalTeamByCountry.get(
      row.country_of_citizenship.trim(),
    );
    const nationalTeamIds = new Set<string>();
    if (caps >= 1) {
      const nationalTeamId =
        (explicitNationalTeamId &&
          nationalTeamIdToName.has(explicitNationalTeamId) &&
          explicitNationalTeamId) ||
        fallbackNationalTeamId;
      if (nationalTeamId) {
        nationalTeamIds.add(nationalTeamId);
        stats.profileNationalTeamsAccepted++;
      }
    } else if (
      explicitNationalTeamId &&
      nationalTeamIdToName.has(explicitNationalTeamId)
    ) {
      stats.zeroCapExplicitNationalTeamsRejected++;
    }
    players.set(id, {
      id,
      name,
      lastName: row.last_name.trim(),
      caps,
      nationalTeamIds,
      clubGames: new Map(),
      evidence: new Set(),
    });
  }
  stats.sourcePlayers = players.size;

  const clubIds = new Set(clubIdToName.keys());
  const nationalTeamIds = new Set(nationalTeamIdToName.keys());
  const games = new Map<string, Game>();
  for (const row of readCsv(path.join(csvDir, "games.csv"))) {
    const game: Game = {
      id: row.game_id,
      competitionId: row.competition_id,
      isNationalTeamCompetition: classifyNationalTeamCompetition(
        row.competition_type,
        competitionTypes.get(row.competition_id) ?? "",
        row.home_club_id,
        row.away_club_id,
        clubIds,
        nationalTeamIds,
      ),
      homeTeamId: row.home_club_id,
      awayTeamId: row.away_club_id,
      homeTeamName: row.home_club_name.trim(),
      awayTeamName: row.away_club_name.trim(),
    };
    if (!game.id) continue;
    games.set(game.id, game);
    const destination = game.isNationalTeamCompetition
      ? nationalTeamIdToName
      : clubIdToName;
    if (game.homeTeamId && game.homeTeamName) {
      destination.set(game.homeTeamId, game.homeTeamName);
    }
    if (game.awayTeamId && game.awayTeamName) {
      destination.set(game.awayTeamId, game.awayTeamName);
    }
  }
  stats.sourceGames = games.size;

  return {
    players,
    games,
    clubIdToName,
    nationalTeamIdToName,
    nationalTeamByCountry,
    stats,
  };
}

export async function buildTransfermarktDataset(
  csvDir: string,
  options: PipelineOptions = {},
): Promise<{ dataset: NormalizedDataset; stats: PipelineStats }> {
  const references = await loadReferenceData(csvDir);
  const { players, games, stats } = references;
  const appearancePlayers = new Set<string>();
  const startingLineupPlayers = new Set<string>();
  const eventPlayers = new Set<string>();

  await streamCsv(path.join(csvDir, "appearances.csv"), (row) => {
    stats.appearanceRows++;
    const player = players.get(row.player_id);
    const game = games.get(row.game_id);
    if (!player || !game) {
      stats.ignoredUnknownPlayerEvidence++;
      return;
    }
    if (
      addEvidence(
        player,
        game,
        row.player_club_id,
        "appearance",
        references,
      )
    ) {
      appearancePlayers.add(player.id);
    } else {
      stats.ignoredUnresolvedTeamEvidence++;
    }
  });

  await streamCsv(path.join(csvDir, "game_lineups.csv"), (row) => {
    stats.lineupRows++;
    if (row.type !== "starting_lineup") {
      stats.ignoredBenchRows++;
      return;
    }
    const player = players.get(row.player_id);
    const game = games.get(row.game_id);
    if (!player || !game) {
      stats.ignoredUnknownPlayerEvidence++;
      return;
    }
    if (addEvidence(player, game, row.club_id, "starting_lineup", references)) {
      startingLineupPlayers.add(player.id);
    } else {
      stats.ignoredUnresolvedTeamEvidence++;
    }
  });

  await streamCsv(path.join(csvDir, "game_events.csv"), (row) => {
    stats.eventRows++;
    if (row.type === "Cards") {
      stats.ignoredCardRows++;
      return;
    }
    const participants = qualifyingEventParticipants(row);
    if (participants.length === 0) {
      stats.ignoredAmbiguousEventRows++;
      return;
    }
    const game = games.get(row.game_id);
    if (!game || !row.club_id) {
      stats.ignoredAmbiguousEventRows++;
      return;
    }
    for (const participant of participants) {
      const player = players.get(participant.playerId);
      if (!player) {
        stats.ignoredUnknownPlayerEvidence++;
        continue;
      }
      if (addEvidence(player, game, row.club_id, "event", references)) {
        eventPlayers.add(player.id);
      } else {
        stats.ignoredUnresolvedTeamEvidence++;
      }
    }
  });

  stats.acceptedAppearancePlayers = appearancePlayers.size;
  stats.acceptedStartingLineupPlayers = startingLineupPlayers.size;
  stats.acceptedEventPlayers = eventPlayers.size;

  const minAppearances = options.minAppearances ?? 1;
  const maxPlayers = options.maxPlayers ?? Number.POSITIVE_INFINITY;
  const kept = [...players.values()]
    .map((player) => {
      const clubs = [...player.clubGames.entries()]
        .map(([id, gameIds]) => ({
          id,
          name: references.clubIdToName.get(id) ?? "",
          appearances: gameIds.size,
        }))
        .filter((club) => club.name && club.appearances >= minAppearances)
        .sort((left, right) => left.name.localeCompare(right.name));
      const nationalTeams = [...player.nationalTeamIds]
        .map((id) => references.nationalTeamIdToName.get(id) ?? "")
        .filter(Boolean)
        .sort();
      const clubClubEligible = clubs.length >= 2;
      const nationalClubEligible = clubs.length >= 1 && nationalTeams.length >= 1;
      return {
        player,
        clubs,
        nationalTeams,
        clubClubEligible,
        nationalClubEligible,
        score:
          player.caps +
          clubs.reduce((total, club) => total + club.appearances, 0),
      };
    })
    .filter((entry) => entry.clubClubEligible || entry.nationalClubEligible)
    .sort(
      (left, right) =>
        right.score - left.score || left.player.id.localeCompare(right.player.id),
    )
    .slice(0, maxPlayers);

  stats.clubClubEligiblePlayers = kept.filter(
    (entry) => entry.clubClubEligible,
  ).length;
  stats.nationalClubEligiblePlayers = kept.filter(
    (entry) => entry.nationalClubEligible,
  ).length;
  stats.usablePlayers = kept.length;

  const usedClubs = new Set<string>();
  const usedNationalTeams = new Set<string>();
  for (const entry of kept) {
    for (const club of entry.clubs) usedClubs.add(club.name);
    for (const nationalTeam of entry.nationalTeams) {
      usedNationalTeams.add(nationalTeam);
    }
  }

  const dataset: NormalizedDataset = {
    clubs: [...usedClubs].sort().map((name) => ({ name })),
    nationalTeams: [...usedNationalTeams].sort().map((name) => ({ name })),
    players: kept.map(({ player, clubs, nationalTeams }) => ({
      sourceId: player.id,
      name: player.name,
      aliases:
        player.lastName.length >= 3 && player.lastName !== player.name
          ? [player.lastName]
          : undefined,
      nationalTeams,
      clubs: clubs.map(({ name, appearances }) => ({ name, appearances })),
    })),
  };

  return { dataset, stats };
}

export function computeDatasetMetrics(dataset: NormalizedDataset): DatasetMetrics {
  const clubClubChallenges = new Set<string>();
  const nationalClubChallenges = new Set<string>();
  let clubClubAnswers = 0;
  let nationalClubAnswers = 0;
  let clubClubEligiblePlayers = 0;
  let nationalClubEligiblePlayers = 0;

  dataset.players.forEach((player) => {
    const clubs = [...new Set(player.clubs.map((club) => club.name))].sort();
    const nationalTeams = [...new Set(player.nationalTeams)].sort();
    if (clubs.length >= 2) {
      clubClubEligiblePlayers++;
      for (let left = 0; left < clubs.length; left++) {
        for (let right = left + 1; right < clubs.length; right++) {
          clubClubChallenges.add(`${clubs[left]}\0${clubs[right]}`);
          clubClubAnswers++;
        }
      }
    }
    if (clubs.length >= 1 && nationalTeams.length >= 1) {
      nationalClubEligiblePlayers++;
      for (const nationalTeam of nationalTeams) {
        for (const club of clubs) {
          nationalClubChallenges.add(`${nationalTeam}\0${club}`);
          nationalClubAnswers++;
        }
      }
    }
  });

  return {
    usablePlayers: dataset.players.length,
    clubClubEligiblePlayers,
    nationalClubEligiblePlayers,
    clubs: new Set(dataset.clubs.map((club) => club.name)).size,
    nationalTeams: new Set(dataset.nationalTeams.map((team) => team.name)).size,
    clubClubChallenges: clubClubChallenges.size,
    nationalClubChallenges: nationalClubChallenges.size,
    clubClubAnswers,
    nationalClubAnswers,
  };
}

export interface ExternalIdentityAudit {
  identitiesWithOfficialEvidence: number;
  clubClubEligibleIdentities: number;
  nationalClubEligibleIdentities: number;
  eligibleUnion: number;
  eligibleWithName: number;
  eligibleWithoutName: number;
  eligibleWithMultipleNames: number;
}

export async function investigateExternalIdentities(
  csvDir: string,
): Promise<ExternalIdentityAudit> {
  const references = await loadReferenceData(csvDir);
  const knownPlayers = new Set(references.players.keys());
  const clubs = new Map<string, Set<string>>();
  const nationalTeams = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();

  const add = (playerId: string, game: Game, teamId: string) => {
    if (!playerId || knownPlayers.has(playerId)) return;
    const fallback = game.isNationalTeamCompetition
      ? references.nationalTeamIdToName
      : references.clubIdToName;
    if (!teamNameForGame(game, teamId, fallback)) return;
    const destination = game.isNationalTeamCompetition ? nationalTeams : clubs;
    const teams = destination.get(playerId) ?? new Set<string>();
    teams.add(teamId);
    destination.set(playerId, teams);
  };

  await streamCsv(path.join(csvDir, "game_lineups.csv"), (row) => {
    if (row.player_id && row.player_name) {
      const playerNames = names.get(row.player_id) ?? new Set<string>();
      playerNames.add(row.player_name.trim());
      names.set(row.player_id, playerNames);
    }
    if (row.type !== "starting_lineup") return;
    const game = references.games.get(row.game_id);
    if (game) add(row.player_id, game, row.club_id);
  });

  await streamCsv(path.join(csvDir, "game_events.csv"), (row) => {
    const game = references.games.get(row.game_id);
    if (!game || !row.club_id) return;
    for (const participant of qualifyingEventParticipants(row)) {
      add(participant.playerId, game, row.club_id);
    }
  });

  const identities = new Set([...clubs.keys(), ...nationalTeams.keys()]);
  const clubClub = new Set(
    [...clubs].filter(([, teams]) => teams.size >= 2).map(([id]) => id),
  );
  const nationalClub = new Set(
    [...clubs]
      .filter(([id, teams]) => teams.size >= 1 && (nationalTeams.get(id)?.size ?? 0) >= 1)
      .map(([id]) => id),
  );
  const eligible = new Set([...clubClub, ...nationalClub]);
  return {
    identitiesWithOfficialEvidence: identities.size,
    clubClubEligibleIdentities: clubClub.size,
    nationalClubEligibleIdentities: nationalClub.size,
    eligibleUnion: eligible.size,
    eligibleWithName: [...eligible].filter((id) => (names.get(id)?.size ?? 0) >= 1)
      .length,
    eligibleWithoutName: [...eligible].filter((id) => !names.get(id)?.size).length,
    eligibleWithMultipleNames: [...eligible].filter(
      (id) => (names.get(id)?.size ?? 0) > 1,
    ).length,
  };
}
