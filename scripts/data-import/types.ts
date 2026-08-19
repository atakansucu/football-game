/**
 * Normalized, source-agnostic football data shape. Any raw dataset (e.g. a
 * Transfermarkt export) must be preprocessed into this shape before import.
 * The game logic never sees the raw source, so swapping datasets does not
 * require touching game code.
 */
export interface NormalizedDataset {
  clubs: { name: string }[];
  nationalTeams: { name: string }[];
  players: {
    name: string;
    aliases?: string[];
    /** Senior national teams represented (by name). */
    nationalTeams: string[];
    /** Only clubs with >= 1 official first-team appearance. */
    clubs: { name: string; appearances: number }[];
  }[];
}
