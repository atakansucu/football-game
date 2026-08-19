import { normalizePlayerName } from "@/lib/football/normalize";
import type { FootballDataset } from "@/lib/football/types";

function player(id: string, name: string) {
  return { id, name, normalizedName: normalizePlayerName(name) };
}
function team(id: string, name: string) {
  return { id, name, normalizedName: normalizePlayerName(name) };
}
function alias(playerId: string, aliasText: string) {
  return {
    playerId,
    alias: aliasText,
    normalizedAlias: normalizePlayerName(aliasText),
  };
}

// National teams
export const NT = {
  turkey: "nt-tr",
  germany: "nt-de",
  france: "nt-fr",
  spain: "nt-es",
  portugal: "nt-pt",
  brazil: "nt-br",
};

// Clubs
export const CLUB = {
  realMadrid: "c-rm",
  arsenal: "c-ars",
  barcelona: "c-bar",
  chelsea: "c-che",
};

// Players
export const PL = {
  arda: "p-arda",
  henry: "p-henry",
  cesc: "p-cesc",
  ghost: "p-ghost",
  cristiano: "p-cr",
  ronaldoNazario: "p-r9",
};

export const dataset: FootballDataset = {
  players: [
    player(PL.arda, "Arda Güler"),
    player(PL.henry, "Thierry Henry"),
    player(PL.cesc, "Cesc Fàbregas"),
    player(PL.ghost, "Ghost Player"),
    player(PL.cristiano, "Cristiano Ronaldo"),
    player(PL.ronaldoNazario, "Ronaldo Nazário"),
  ],
  aliases: [
    alias(PL.cesc, "Cesc"),
    alias(PL.cristiano, "Ronaldo"),
    alias(PL.ronaldoNazario, "Ronaldo"),
  ],
  clubs: [
    team(CLUB.realMadrid, "Real Madrid"),
    team(CLUB.arsenal, "Arsenal"),
    team(CLUB.barcelona, "Barcelona"),
    team(CLUB.chelsea, "Chelsea"),
  ],
  nationalTeams: [
    team(NT.turkey, "Turkey"),
    team(NT.germany, "Germany"),
    team(NT.france, "France"),
    team(NT.spain, "Spain"),
    team(NT.portugal, "Portugal"),
    team(NT.brazil, "Brazil"),
  ],
  playerClubs: [
    { playerId: PL.arda, clubId: CLUB.realMadrid, appearances: 30 },
    { playerId: PL.henry, clubId: CLUB.arsenal, appearances: 258 },
    { playerId: PL.henry, clubId: CLUB.barcelona, appearances: 80 },
    { playerId: PL.cesc, clubId: CLUB.arsenal, appearances: 212 },
    { playerId: PL.cesc, clubId: CLUB.barcelona, appearances: 96 },
    { playerId: PL.cesc, clubId: CLUB.chelsea, appearances: 156 },
    // Ghost transferred to Real Madrid but never played an official match.
    { playerId: PL.ghost, clubId: CLUB.realMadrid, appearances: 0 },
    { playerId: PL.cristiano, clubId: CLUB.realMadrid, appearances: 292 },
    { playerId: PL.ronaldoNazario, clubId: CLUB.barcelona, appearances: 49 },
  ],
  playerNationals: [
    { playerId: PL.arda, nationalTeamId: NT.turkey, appearances: 40 },
    { playerId: PL.henry, nationalTeamId: NT.france, appearances: 123 },
    { playerId: PL.cesc, nationalTeamId: NT.spain, appearances: 110 },
    { playerId: PL.ghost, nationalTeamId: NT.germany, appearances: 5 },
    { playerId: PL.cristiano, nationalTeamId: NT.portugal, appearances: 200 },
    { playerId: PL.ronaldoNazario, nationalTeamId: NT.brazil, appearances: 98 },
  ],
};
