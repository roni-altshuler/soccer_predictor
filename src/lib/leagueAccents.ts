/**
 * League visual identity: accent colours, display names, country, gender.
 *
 * Used across MatchRow, LeagueSection, LeagueBadge, and the league home
 * pages so every surface has the same brand mark for a given competition.
 * Keyed by the warehouse `competition_id` (ESPN-style), plus aliases for
 * common display-name fallbacks the frontend already receives from FotMob.
 *
 * `accent` is the league's strongest brand colour (Premier League purple,
 * Bundesliga red, …). `accentBg` is a heavily-faded variant suitable for
 * card-edge stripes and chip backgrounds without competing with body text.
 */

export type Gender = 'M' | 'F'

export interface LeagueAccent {
  competitionId: string
  displayName: string
  shortName: string
  country: string
  countryCode?: string
  gender: Gender
  accent: string
  accentBg: string
  /** Emoji flag for hero/badge fallback when no logo is available. */
  flag: string
  /** Optional public SVG/PNG asset for the league badge. */
  logoUrl?: string
  /** Domestic round-robin total per season (e.g. PL: 38, MLS: 34). */
  matchesPerSeason?: number
}

const ESPN_LOGO = (id: number) => `https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/${id}.png`

const accents: LeagueAccent[] = [
  // Men's — top-5 European leagues
  { competitionId: 'eng.1', displayName: 'Premier League', shortName: 'PL', country: 'England', countryCode: 'ENG', gender: 'M', accent: '#37003c', accentBg: 'rgba(55, 0, 60, 0.12)', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', logoUrl: ESPN_LOGO(23), matchesPerSeason: 38 },
  { competitionId: 'esp.1', displayName: 'La Liga', shortName: 'La Liga', country: 'Spain', countryCode: 'ES', gender: 'M', accent: '#ee2737', accentBg: 'rgba(238, 39, 55, 0.12)', flag: '🇪🇸', logoUrl: ESPN_LOGO(15), matchesPerSeason: 38 },
  { competitionId: 'ita.1', displayName: 'Serie A', shortName: 'Serie A', country: 'Italy', countryCode: 'IT', gender: 'M', accent: '#008fd7', accentBg: 'rgba(0, 143, 215, 0.12)', flag: '🇮🇹', logoUrl: ESPN_LOGO(12), matchesPerSeason: 38 },
  { competitionId: 'ger.1', displayName: 'Bundesliga', shortName: 'Bundesliga', country: 'Germany', countryCode: 'DE', gender: 'M', accent: '#d20515', accentBg: 'rgba(210, 5, 21, 0.12)', flag: '🇩🇪', logoUrl: ESPN_LOGO(10), matchesPerSeason: 34 },
  { competitionId: 'fra.1', displayName: 'Ligue 1', shortName: 'Ligue 1', country: 'France', countryCode: 'FR', gender: 'M', accent: '#091c3e', accentBg: 'rgba(9, 28, 62, 0.14)', flag: '🇫🇷', logoUrl: ESPN_LOGO(9), matchesPerSeason: 34 },
  // Men's — others
  { competitionId: 'ned.1', displayName: 'Eredivisie', shortName: 'Eredivisie', country: 'Netherlands', countryCode: 'NL', gender: 'M', accent: '#f04923', accentBg: 'rgba(240, 73, 35, 0.12)', flag: '🇳🇱', logoUrl: ESPN_LOGO(11), matchesPerSeason: 34 },
  { competitionId: 'por.1', displayName: 'Primeira Liga', shortName: 'Liga PT', country: 'Portugal', countryCode: 'PT', gender: 'M', accent: '#006a3d', accentBg: 'rgba(0, 106, 61, 0.12)', flag: '🇵🇹', logoUrl: ESPN_LOGO(14), matchesPerSeason: 34 },
  { competitionId: 'usa.1', displayName: 'MLS', shortName: 'MLS', country: 'USA', countryCode: 'US', gender: 'M', accent: '#1a1f2c', accentBg: 'rgba(26, 31, 44, 0.14)', flag: '🇺🇸', logoUrl: ESPN_LOGO(19), matchesPerSeason: 34 },
  // Second tiers and further top flights — added when each cleared the
  // per-league benchmark in reports/baselines/league_gate.json. Every logoUrl
  // below was resolved from ESPN's own scoreboard payload and curl-verified.
  { competitionId: 'eng.2', displayName: 'EFL Championship', shortName: 'Championship', country: 'England', countryCode: 'ENG', gender: 'M', accent: '#0e1f3f', accentBg: 'rgba(14, 31, 63, 0.14)', flag: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', logoUrl: ESPN_LOGO(24), matchesPerSeason: 46 },
  { competitionId: 'esp.2', displayName: 'LaLiga 2', shortName: 'LaLiga 2', country: 'Spain', countryCode: 'ES', gender: 'M', accent: '#1f6f4a', accentBg: 'rgba(31, 111, 74, 0.12)', flag: '🇪🇸', logoUrl: ESPN_LOGO(107), matchesPerSeason: 42 },
  { competitionId: 'ger.2', displayName: '2. Bundesliga', shortName: '2. Bundesliga', country: 'Germany', countryCode: 'DE', gender: 'M', accent: '#e2001a', accentBg: 'rgba(226, 0, 26, 0.12)', flag: '🇩🇪', logoUrl: ESPN_LOGO(97), matchesPerSeason: 34 },
  { competitionId: 'ita.2', displayName: 'Serie B', shortName: 'Serie B', country: 'Italy', countryCode: 'IT', gender: 'M', accent: '#004f9f', accentBg: 'rgba(0, 79, 159, 0.12)', flag: '🇮🇹', logoUrl: ESPN_LOGO(99), matchesPerSeason: 38 },
  { competitionId: 'fra.2', displayName: 'Ligue 2', shortName: 'Ligue 2', country: 'France', countryCode: 'FR', gender: 'M', accent: '#122b54', accentBg: 'rgba(18, 43, 84, 0.14)', flag: '🇫🇷', logoUrl: ESPN_LOGO(96), matchesPerSeason: 34 },
  { competitionId: 'tur.1', displayName: 'Süper Lig', shortName: 'Süper Lig', country: 'Türkiye', countryCode: 'TR', gender: 'M', accent: '#e30a17', accentBg: 'rgba(227, 10, 23, 0.12)', flag: '🇹🇷', logoUrl: ESPN_LOGO(18), matchesPerSeason: 34 },
  { competitionId: 'bra.1', displayName: 'Brasileirão Série A', shortName: 'Brasileirão', country: 'Brazil', countryCode: 'BR', gender: 'M', accent: '#009c3b', accentBg: 'rgba(0, 156, 59, 0.12)', flag: '🇧🇷', logoUrl: ESPN_LOGO(85), matchesPerSeason: 38 },

  // UEFA + FIFA tournaments
  { competitionId: 'uefa.champions', displayName: 'UEFA Champions League', shortName: 'UCL', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#0a1c47', accentBg: 'rgba(10, 28, 71, 0.14)', flag: '🇪🇺', logoUrl: ESPN_LOGO(2) },
  { competitionId: 'uefa.europa', displayName: 'UEFA Europa League', shortName: 'UEL', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#ff6900', accentBg: 'rgba(255, 105, 0, 0.12)', flag: '🇪🇺', logoUrl: ESPN_LOGO(2310) },
  { competitionId: 'uefa.europa.conf', displayName: 'UEFA Conference League', shortName: 'UECL', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#00d647', accentBg: 'rgba(0, 214, 71, 0.12)', flag: '🇪🇺', logoUrl: ESPN_LOGO(20296) },
  { competitionId: 'fifa.world', displayName: 'FIFA World Cup', shortName: 'World Cup', country: 'World', countryCode: 'EARTH', gender: 'M', accent: '#5a32a3', accentBg: 'rgba(90, 50, 163, 0.12)', flag: '🌍', logoUrl: ESPN_LOGO(4) },
  { competitionId: 'uefa.euro', displayName: 'UEFA European Championship', shortName: 'Euros', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#1a4b8c', accentBg: 'rgba(26, 75, 140, 0.14)', flag: '🇪🇺', logoUrl: ESPN_LOGO(74) },
  { competitionId: 'conmebol.america', displayName: 'Copa América', shortName: 'Copa América', country: 'South America', countryCode: 'SA', gender: 'M', accent: '#10708f', accentBg: 'rgba(16, 112, 143, 0.12)', flag: '🌎', logoUrl: ESPN_LOGO(83) },

  // Confederation and club tournaments. Every logoUrl below came from ESPN's
  // own scoreboard payload for that competition and was curl-verified; where
  // ESPN would not answer (afc.asian), the entry ships WITHOUT a logo and
  // LeagueMark falls back to a neutral trophy. A confidently wrong badge is
  // worse than an honest placeholder.
  { competitionId: 'uefa.nations', displayName: 'UEFA Nations League', shortName: 'Nations League', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#1a3a6b', accentBg: 'rgba(26, 58, 107, 0.14)', flag: '🇪🇺', logoUrl: ESPN_LOGO(2395) },
  { competitionId: 'fifa.cwc', displayName: 'FIFA Club World Cup', shortName: 'Club World Cup', country: 'World', countryCode: 'EARTH', gender: 'M', accent: '#c9a227', accentBg: 'rgba(201, 162, 39, 0.12)', flag: '🌍', logoUrl: ESPN_LOGO(1932) },
  { competitionId: 'conmebol.libertadores', displayName: 'Copa Libertadores', shortName: 'Libertadores', country: 'South America', countryCode: 'SA', gender: 'M', accent: '#c8102e', accentBg: 'rgba(200, 16, 46, 0.12)', flag: '🌎', logoUrl: ESPN_LOGO(58) },
  { competitionId: 'conmebol.sudamericana', displayName: 'Copa Sudamericana', shortName: 'Sudamericana', country: 'South America', countryCode: 'SA', gender: 'M', accent: '#f5a623', accentBg: 'rgba(245, 166, 35, 0.12)', flag: '🌎', logoUrl: ESPN_LOGO(1208) },
  { competitionId: 'caf.nations', displayName: 'Africa Cup of Nations', shortName: 'AFCON', country: 'Africa', countryCode: 'AF', gender: 'M', accent: '#1c7c3c', accentBg: 'rgba(28, 124, 60, 0.12)', flag: '🌍', logoUrl: ESPN_LOGO(76) },
  { competitionId: 'concacaf.champions', displayName: 'CONCACAF Champions Cup', shortName: 'CCC', country: 'North America', countryCode: 'NA', gender: 'M', accent: '#0a4a8f', accentBg: 'rgba(10, 74, 143, 0.14)', flag: '🌎', logoUrl: ESPN_LOGO(2298) },
  { competitionId: 'concacaf.gold', displayName: 'CONCACAF Gold Cup', shortName: 'Gold Cup', country: 'North America', countryCode: 'NA', gender: 'M', accent: '#d4af37', accentBg: 'rgba(212, 175, 55, 0.12)', flag: '🌎', logoUrl: ESPN_LOGO(59) },
  { competitionId: 'afc.asian', displayName: 'AFC Asian Cup', shortName: 'Asian Cup', country: 'Asia', countryCode: 'AS', gender: 'M', accent: '#c1121f', accentBg: 'rgba(193, 18, 31, 0.12)', flag: '🌏' },

  // Women's universe — same teal/magenta family as men's parents where applicable.
  { competitionId: 'eng.1.w', displayName: "FA Women's Super League", shortName: 'WSL', country: 'England', countryCode: 'ENG', gender: 'F', accent: '#c10078', accentBg: 'rgba(193, 0, 120, 0.12)', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', logoUrl: ESPN_LOGO(2314) },
  { competitionId: 'usa.1.w', displayName: 'NWSL', shortName: 'NWSL', country: 'USA', countryCode: 'US', gender: 'F', accent: '#00a651', accentBg: 'rgba(0, 166, 81, 0.12)', flag: '🇺🇸', logoUrl: ESPN_LOGO(2323) },
  { competitionId: 'uefa.champions.w', displayName: "UEFA Women's Champions League", shortName: 'UWCL', country: 'Europe', countryCode: 'EU', gender: 'F', accent: '#3e0a78', accentBg: 'rgba(62, 10, 120, 0.16)', flag: '🇪🇺', logoUrl: ESPN_LOGO(2408) },
  { competitionId: 'uefa.euro.w', displayName: "UEFA Women's European Championship", shortName: 'WEuros', country: 'Europe', countryCode: 'EU', gender: 'F', accent: '#1e6e9c', accentBg: 'rgba(30, 110, 156, 0.14)', flag: '🇪🇺', logoUrl: ESPN_LOGO(2381) },
  { competitionId: 'fifa.world.w', displayName: "FIFA Women's World Cup", shortName: 'WWC', country: 'World', countryCode: 'EARTH', gender: 'F', accent: '#7d2b8a', accentBg: 'rgba(125, 43, 138, 0.14)', flag: '🌍', logoUrl: ESPN_LOGO(60) },
]

const byCompetitionId = new Map<string, LeagueAccent>(
  accents.map((a) => [a.competitionId, a])
)
const byDisplayName = new Map<string, LeagueAccent>(
  accents.map((a) => [a.displayName.toLowerCase(), a])
)
const byShortName = new Map<string, LeagueAccent>(
  accents.map((a) => [a.shortName.toLowerCase(), a])
)

// Frontend often receives league names that don't exactly match the
// canonical `displayName`. Hand-map the common variants observed in the
// FotMob and ESPN feeds, plus the legacy underscore IDs used by the
// league home page route (`/leagues/premier_league`) and the FotMob
// numeric IDs the match centre still surfaces in some payloads.
const nameAliases: Record<string, string> = {
  'champions league': 'uefa.champions',
  'europa league': 'uefa.europa',
  'conference league': 'uefa.europa.conf',
  'fifa world cup': 'fifa.world',
  'fifa world cup 2026': 'fifa.world',
  'world cup': 'fifa.world',
  euros: 'uefa.euro',
  'euro 2024': 'uefa.euro',
  laliga: 'esp.1',
  'la liga': 'esp.1',
  'liga portugal': 'por.1',
  'major league soccer': 'usa.1',
  "fa women's super league": 'eng.1.w',
  "women's super league": 'eng.1.w',
  'national women\'s soccer league': 'usa.1.w',
  nwsl: 'usa.1.w',
  "uefa women's champions league": 'uefa.champions.w',
  "women's champions league": 'uefa.champions.w',
  "fifa women's world cup": 'fifa.world.w',
  "women's world cup": 'fifa.world.w',
  // Underscore IDs from the league-home route segment
  premier_league: 'eng.1',
  la_liga: 'esp.1',
  bundesliga: 'ger.1',
  serie_a: 'ita.1',
  ligue_1: 'fra.1',
  mls: 'usa.1',
  eredivisie: 'ned.1',
  primeira_liga: 'por.1',
  champions_league: 'uefa.champions',
  europa_league: 'uefa.europa',
  conference_league: 'uefa.europa.conf',
  // FotMob numeric IDs (string-cast because the IDs travel as strings)
  '47': 'eng.1',
  '87': 'esp.1',
  '54': 'ger.1',
  '55': 'ita.1',
  '53': 'fra.1',
  '130': 'usa.1',
  '57': 'ned.1',
  '61': 'por.1',
}

/**
 * Fallback accent used when nothing matches — neutral grey so we don't
 * accidentally invent a brand identity for a league we don't recognise.
 */
const FALLBACK: LeagueAccent = {
  competitionId: 'unknown',
  displayName: 'Match',
  shortName: 'Match',
  country: '',
  gender: 'M',
  accent: 'var(--text-tertiary, #5b6478)',
  accentBg: 'rgba(91, 100, 120, 0.1)',
  flag: '⚽',
}

/**
 * Resolve a league accent by competition_id (preferred) or display name.
 * Returns the fallback record (never null) so callers don't have to handle
 * undefined every time.
 */
export function getLeagueAccent(idOrName: string | null | undefined): LeagueAccent {
  if (!idOrName) return FALLBACK
  const trimmed = idOrName.trim()
  if (!trimmed) return FALLBACK

  const direct = byCompetitionId.get(trimmed)
  if (direct) return direct

  const lower = trimmed.toLowerCase()

  const aliasedId = nameAliases[lower]
  if (aliasedId) {
    const aliased = byCompetitionId.get(aliasedId)
    if (aliased) return aliased
  }

  const byName = byDisplayName.get(lower)
  if (byName) return byName

  const byShort = byShortName.get(lower)
  if (byShort) return byShort

  return FALLBACK
}

/**
 * The competitions the product actually covers.
 *
 * The registry above stays complete — a fixture from any competition still
 * resolves to a badge and an accent, which is what keeps a Champions League
 * row in a search result from rendering blank. Coverage is a narrower thing:
 * a league is in Wave A only once the model has been scored against that
 * league's closing line, which so far is the five big European men's leagues
 * (docs/PIVOT_2026-08.md §5). MLS is Wave B; UCL/UEL/Euros/World Cup/Copa
 * América are Wave C. Each advances on measured evidence, not on ambition.
 *
 * Every league picker in the product reads this list. Listing a competition
 * we have never scored, next to five we have, invites the reader to trust all
 * six equally.
 */
export const WAVE_A_COMPETITION_IDS = [
  'eng.1',
  'esp.1',
  'ger.1',
  'ita.1',
  'fra.1',
] as const

export type WaveACompetitionId = (typeof WAVE_A_COMPETITION_IDS)[number]

/**
 * The leagues the site actually PROJECTS, which is a wider set than the ones
 * scored against a closing line — and the two must not be conflated.
 *
 * `WAVE_A_COMPETITION_IDS` above is the benchmark corpus: five leagues with a
 * paired market price on every fixture, which is what lets `/accuracy` say how
 * far the model sits from the bookmaker. These nine are the ones admitted by
 * `league_gate.py` — a day-blocked walk-forward in which the league beat a
 * one-in-three guess, its own running base rate, and picking the home side
 * every time. Every one of the nine publishes a projected table; only five of
 * them can be placed against the market.
 *
 * Mirrors `LEAGUES` in `backend/scripts/forecast_season.py`, in its order:
 * the European top flight, then MLS.
 */
export const SERVED_COMPETITION_IDS = [
  'eng.1',
  'esp.1',
  'fra.1',
  'ger.1',
  'ita.1',
  'ned.1',
  'por.1',
  'tur.1',
  'usa.1',
] as const

/** Covered competitions, in the order league pickers should show them. */
export function coveredLeagues(): LeagueAccent[] {
  return WAVE_A_COMPETITION_IDS.map((id) => byCompetitionId.get(id)).filter(
    (a): a is LeagueAccent => a !== undefined,
  )
}

/** Is this competition inside the current coverage wave? */
export function isCovered(idOrName: string | null | undefined): boolean {
  if (!idOrName) return false
  const accent = getLeagueAccent(idOrName)
  return (WAVE_A_COMPETITION_IDS as readonly string[]).includes(accent.competitionId)
}

/** Return all registered accents for a given gender (preserves order). */
export function leaguesForGender(gender: Gender): LeagueAccent[] {
  return accents.filter((a) => a.gender === gender)
}

/** Convenience: is this competition known to the women's universe? */
export function isWomensCompetition(idOrName: string | null | undefined): boolean {
  return getLeagueAccent(idOrName).gender === 'F'
}
