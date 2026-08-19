/**
 * Normalizes a player name for forgiving matching.
 *
 * Rules (kept intentionally in sync with the SQL `normalize_name()` function in
 * `supabase/migrations/0002_functions.sql`):
 *   1. Decompose accents and strip diacritics ("Güler" -> "guler").
 *   2. Lowercase.
 *   3. Collapse every run of non-alphanumeric characters (apostrophes, hyphens,
 *      punctuation, whitespace) into a single space. This makes "N'Golo",
 *      "NGolo" and "N Golo" all normalize the same way, and turns
 *      "Alexander-Arnold" into "alexander arnold".
 *   4. Trim.
 *
 * Examples:
 *   normalizePlayerName("Arda Güler")  === "arda guler"
 *   normalizePlayerName("  arda   guler ") === "arda guler"
 *   normalizePlayerName("N'Golo Kanté") === "n golo kante"
 */
export function normalizePlayerName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
