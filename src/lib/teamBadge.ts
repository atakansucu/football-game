/**
 * The dataset only stores team NAMES (no logo URLs), so we synthesize a visual
 * badge from the name:
 *   - national teams  -> the real country flag (emoji), incl. the special
 *     England / Scotland / Wales sub-flags.
 *   - clubs           -> a generated, non-official badge (short label +
 *     deterministic colors). No remote artwork or club crest is used.
 */

function normKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Country name (as it appears in the dataset, plus common aliases) -> ISO 3166-1
// alpha-2 code. Unlisted names fall back to a generic globe.
const ISO2: Record<string, string> = {
  afghanistan: "AF",
  albania: "AL",
  algeria: "DZ",
  andorra: "AD",
  angola: "AO",
  argentina: "AR",
  armenia: "AM",
  australia: "AU",
  austria: "AT",
  azerbaijan: "AZ",
  belarus: "BY",
  belgium: "BE",
  benin: "BJ",
  bolivia: "BO",
  "bosnia herzegovina": "BA",
  "bosnia and herzegovina": "BA",
  brazil: "BR",
  bulgaria: "BG",
  "burkina faso": "BF",
  cameroon: "CM",
  canada: "CA",
  "cape verde": "CV",
  chile: "CL",
  china: "CN",
  "china pr": "CN",
  colombia: "CO",
  congo: "CG",
  "congo dr": "CD",
  "dr congo": "CD",
  "costa rica": "CR",
  "cote divoire": "CI",
  "ivory coast": "CI",
  croatia: "HR",
  cuba: "CU",
  cyprus: "CY",
  "czech republic": "CZ",
  czechia: "CZ",
  denmark: "DK",
  ecuador: "EC",
  egypt: "EG",
  "el salvador": "SV",
  estonia: "EE",
  finland: "FI",
  france: "FR",
  gabon: "GA",
  gambia: "GM",
  georgia: "GE",
  germany: "DE",
  ghana: "GH",
  greece: "GR",
  guinea: "GN",
  honduras: "HN",
  hungary: "HU",
  iceland: "IS",
  india: "IN",
  iran: "IR",
  iraq: "IQ",
  ireland: "IE",
  israel: "IL",
  italy: "IT",
  jamaica: "JM",
  japan: "JP",
  jordan: "JO",
  kazakhstan: "KZ",
  kenya: "KE",
  "korea south": "KR",
  "south korea": "KR",
  "korea north": "KP",
  "north korea": "KP",
  kosovo: "XK",
  kuwait: "KW",
  latvia: "LV",
  lebanon: "LB",
  libya: "LY",
  lithuania: "LT",
  luxembourg: "LU",
  malaysia: "MY",
  mali: "ML",
  malta: "MT",
  mexico: "MX",
  moldova: "MD",
  montenegro: "ME",
  morocco: "MA",
  mozambique: "MZ",
  netherlands: "NL",
  "new zealand": "NZ",
  nigeria: "NG",
  "north macedonia": "MK",
  macedonia: "MK",
  norway: "NO",
  oman: "OM",
  panama: "PA",
  paraguay: "PY",
  peru: "PE",
  philippines: "PH",
  poland: "PL",
  portugal: "PT",
  qatar: "QA",
  romania: "RO",
  russia: "RU",
  "saudi arabia": "SA",
  senegal: "SN",
  serbia: "RS",
  "sierra leone": "SL",
  singapore: "SG",
  slovakia: "SK",
  slovenia: "SI",
  "south africa": "ZA",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  syria: "SY",
  thailand: "TH",
  togo: "TG",
  "trinidad and tobago": "TT",
  tunisia: "TN",
  turkey: "TR",
  turkiye: "TR",
  uganda: "UG",
  ukraine: "UA",
  "united arab emirates": "AE",
  "united states": "US",
  usa: "US",
  uruguay: "UY",
  uzbekistan: "UZ",
  venezuela: "VE",
  vietnam: "VN",
  zambia: "ZM",
  zimbabwe: "ZW",
};

// UK home nations have dedicated emoji (subdivision tag sequences).
const HOME_NATIONS: Record<string, string> = {
  england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
};

function iso2ToFlag(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Country flag emoji for a national-team name, or null if unknown. */
export function countryFlag(name: string): string | null {
  const key = normKey(name);
  if (HOME_NATIONS[key]) return HOME_NATIONS[key];
  const iso = ISO2[key];
  return iso ? iso2ToFlag(iso) : null;
}

// Tokens that are club-type noise, not part of the recognizable name.
const CLUB_STOPWORDS = new Set([
  "fc",
  "cf",
  "ac",
  "as",
  "sc",
  "sv",
  "vfb",
  "vfl",
  "rc",
  "sl",
  "ss",
  "ssc",
  "cd",
  "uc",
  "kv",
  "kaa",
  "bc",
  "gnk",
  "pfk",
  "fk",
  "ao",
  "afc",
  "cfc",
  "club",
  "de",
  "of",
  "the",
  "1",
]);

const BADGE_PALETTES = [
  { primary: "#173F5F", secondary: "#256F8E" },
  { primary: "#5B2A86", secondary: "#7E22CE" },
  { primary: "#7A2431", secondary: "#BE3144" },
  { primary: "#14532D", secondary: "#168255" },
  { primary: "#713F12", secondary: "#9A6515" },
  { primary: "#1E3A8A", secondary: "#2563EB" },
  { primary: "#3F3F46", secondary: "#71717A" },
  { primary: "#164E63", secondary: "#0E7490" },
  { primary: "#6B2146", secondary: "#C2417B" },
  { primary: "#3C2A21", secondary: "#A1623D" },
] as const;

export interface ClubBadgeVisual {
  /** A compact, generated label. It is not an official club abbreviation. */
  label: string;
  primary: string;
  secondary: string;
  foreground: "#FFFFFF";
}

function stableHash(value: string): number {
  // FNV-1a with Math.imul keeps output stable across JS runtimes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Generated 2–3 character club label. For familiar single-word names this
 * yields labels such as BAR, BAY and GAL without copying an official crest.
 */
export function clubInitials(name: string): string {
  const words = normKey(name)
    .split(" ")
    .filter((w) => w && !CLUB_STOPWORDS.has(w));
  const pool = words.length > 0 ? words : normKey(name).split(" ").filter(Boolean);
  if (pool.length === 0) return "?";
  if (pool.length >= 3) return pool.slice(0, 3).map((word) => word[0]).join("").toUpperCase();

  const first = pool[0];
  if (first.length >= 3) return first.slice(0, 3).toUpperCase();

  return pool.join("").slice(0, 3).toUpperCase();
}

/** Licensing-safe generated badge metadata for a club name. */
export function getClubBadgeVisual(name: string): ClubBadgeVisual {
  const key = normKey(name);
  const palette = BADGE_PALETTES[stableHash(key || name) % BADGE_PALETTES.length];

  return {
    label: clubInitials(name),
    primary: palette.primary,
    secondary: palette.secondary,
    foreground: "#FFFFFF",
  };
}
