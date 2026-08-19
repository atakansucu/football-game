export type GameMode = "national_club" | "club_club";

export interface Player {
  id: string;
  name: string;
  normalizedName: string;
}

export interface PlayerAlias {
  playerId: string;
  alias: string;
  normalizedAlias: string;
}

export interface Club {
  id: string;
  name: string;
  normalizedName: string;
}

export interface NationalTeam {
  id: string;
  name: string;
  normalizedName: string;
}

/** Only stored when appearances >= 1 (official first-team appearance). */
export interface PlayerClubAppearance {
  playerId: string;
  clubId: string;
  appearances: number;
}

/** Only senior national teams. */
export interface PlayerNationalAppearance {
  playerId: string;
  nationalTeamId: string;
  appearances: number;
}

export interface NationalClubChallenge {
  mode: "national_club";
  nationalTeamId: string;
  clubId: string;
}

export interface ClubClubChallenge {
  mode: "club_club";
  clubAId: string;
  clubBId: string;
}

export type Challenge = NationalClubChallenge | ClubClubChallenge;

/**
 * In-memory representation of the football dataset. Kept independent from the
 * database and from React so the validation logic can be unit-tested and the
 * underlying data source can be swapped without touching game logic.
 */
export interface FootballDataset {
  players: Player[];
  aliases: PlayerAlias[];
  clubs: Club[];
  nationalTeams: NationalTeam[];
  playerClubs: PlayerClubAppearance[];
  playerNationals: PlayerNationalAppearance[];
}
