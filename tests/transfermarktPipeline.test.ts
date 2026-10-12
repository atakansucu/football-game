import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTransfermarktDataset,
  classifyNationalTeamCompetition,
  computeDatasetMetrics,
  qualifyingEventParticipants,
} from "../scripts/data-import/transfermarktPipeline";

const temporaryDirectories: string[] = [];

function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(path.join(tmpdir(), "football-duel-tm-"));
  temporaryDirectories.push(directory);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), contents);
  }
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Transfermarkt evidence policy", () => {
  it("does not accept cards or own-goal rows as standalone on-field evidence", () => {
    expect(
      qualifyingEventParticipants({
        type: "Cards",
        player_id: "bench-player",
        description: "Red card, Violent conduct",
      }),
    ).toEqual([]);
    expect(
      qualifyingEventParticipants({
        type: "Goals",
        player_id: "opponent",
        description: "Own-goal",
      }),
    ).toEqual([]);
  });

  it("accepts only roles that necessarily participated", () => {
    expect(
      qualifyingEventParticipants({
        type: "Substitutions",
        player_id: "out",
        player_in_id: "in",
      }),
    ).toEqual([
      { playerId: "out", role: "substituted_out" },
      { playerId: "in", role: "substituted_in" },
    ]);
    expect(
      qualifyingEventParticipants({
        type: "Goals",
        player_id: "scorer",
        player_assist_id: "assist",
        description: "Right-footed shot",
      }),
    ).toEqual([
      { playerId: "scorer", role: "goal" },
      { playerId: "assist", role: "assist" },
    ]);
  });

  it("uses team metadata to classify competitions with missing type metadata", () => {
    expect(
      classifyNationalTeamCompetition(
        "",
        "",
        "n1",
        "n2",
        new Set(["c1"]),
        new Set(["n1", "n2"]),
      ),
    ).toBe(true);
    expect(
      classifyNationalTeamCompetition(
        "",
        "",
        "c1",
        "c2",
        new Set(["c1", "c2"]),
        new Set(["n1", "n2"]),
      ),
    ).toBe(false);
  });
});

describe("buildTransfermarktDataset", () => {
  it("enforces caps, includes starts/events, and excludes bench-only evidence", async () => {
    const csvDir = fixture({
      "clubs.csv": [
        "club_id,name",
        "c1,Club One",
      ].join("\n"),
      "national_teams.csv": [
        "national_team_id,name,country_name",
        "n1,Nation One,Nation One",
        "n2,Nation Two,Nation Two",
      ].join("\n"),
      "competitions.csv": [
        "competition_id,type",
        "league,domestic_league",
        "national,national_team_competition",
      ].join("\n"),
      "players.csv": [
        "player_id,name,last_name,international_caps,current_national_team_id,country_of_citizenship",
        "p1,Zero Cap,Cap,0,n1,Nation One",
        "p2,Capped Player,Player,5,n1,Nation One",
        "p3,Direct International,International,0,,Nation Two",
        "p4,Bench Player,Player,0,,Nation Two",
      ].join("\n"),
      "games.csv": [
        "game_id,competition_id,competition_type,home_club_id,away_club_id,home_club_name,away_club_name",
        "g1,league,domestic_league,c1,c2,Club One,Club Two",
        "g2,league,domestic_league,c2,c1,Club Two,Club One",
        "g3,national,national_team_competition,n1,n2,Nation One,Nation Two",
      ].join("\n"),
      "appearances.csv": [
        "game_id,player_id,player_club_id",
        "g1,p1,c1",
        "g1,p2,c1",
        "g3,p3,n2",
      ].join("\n"),
      "game_lineups.csv": [
        "game_id,player_id,club_id,player_name,type",
        "g2,p1,c2,Zero Cap,starting_lineup",
        "g2,p2,c2,Capped Player,substitutes",
        "g2,p3,c2,Direct International,substitutes",
        "g2,p4,c1,Bench Player,substitutes",
      ].join("\n"),
      "game_events.csv": [
        "game_id,type,club_id,player_id,player_in_id,player_assist_id,description",
        "g2,Cards,c1,p4,,,Red card",
        "g2,Substitutions,c2,p1,p3,,Tactical",
      ].join("\n"),
    });

    const { dataset, stats } = await buildTransfermarktDataset(csvDir);
    expect(stats.zeroCapExplicitNationalTeamsRejected).toBe(1);
    expect(stats.ignoredBenchRows).toBe(3);
    expect(stats.ignoredCardRows).toBe(1);
    expect(dataset.players.map((player) => player.name)).toEqual([
      "Capped Player",
      "Zero Cap",
      "Direct International",
    ]);

    const zeroCap = dataset.players.find((player) => player.name === "Zero Cap");
    expect(zeroCap?.nationalTeams).toEqual([]);
    expect(zeroCap?.clubs.map((club) => club.name)).toEqual([
      "Club One",
      "Club Two",
    ]);

    const capped = dataset.players.find(
      (player) => player.name === "Capped Player",
    );
    expect(capped?.nationalTeams).toEqual(["Nation One"]);
    expect(capped?.clubs.map((club) => club.name)).toEqual(["Club One"]);
    const directInternational = dataset.players.find(
      (player) => player.name === "Direct International",
    );
    expect(directInternational?.nationalTeams).toEqual(["Nation Two"]);
    expect(directInternational?.clubs.map((club) => club.name)).toEqual([
      "Club Two",
    ]);
    expect(dataset.players.some((player) => player.name === "Bench Player")).toBe(
      false,
    );

    expect(computeDatasetMetrics(dataset)).toMatchObject({
      usablePlayers: 3,
      clubClubEligiblePlayers: 1,
      nationalClubEligiblePlayers: 2,
      clubClubChallenges: 1,
      nationalClubChallenges: 2,
      clubClubAnswers: 1,
      nationalClubAnswers: 2,
    });
  });
});
