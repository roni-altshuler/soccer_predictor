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
  // UEFA + FIFA tournaments
  { competitionId: 'uefa.champions', displayName: 'UEFA Champions League', shortName: 'UCL', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#0a1c47', accentBg: 'rgba(10, 28, 71, 0.14)', flag: '🇪🇺', logoUrl: ESPN_LOGO(2) },
  { competitionId: 'uefa.europa', displayName: 'UEFA Europa League', shortName: 'UEL', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#ff6900', accentBg: 'rgba(255, 105, 0, 0.12)', flag: '🇪🇺', logoUrl: ESPN_LOGO(2310) },
  { competitionId: 'uefa.europa.conf', displayName: 'UEFA Conference League', shortName: 'UECL', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#00d647', accentBg: 'rgba(0, 214, 71, 0.12)', flag: '🇪🇺', logoUrl: ESPN_LOGO(20296) },
  { competitionId: 'fifa.world', displayName: 'FIFA World Cup', shortName: 'World Cup', country: 'World', countryCode: 'EARTH', gender: 'M', accent: '#5a32a3', accentBg: 'rgba(90, 50, 163, 0.12)', flag: '🌍', logoUrl: ESPN_LOGO(4) },
  { competitionId: 'uefa.euro', displayName: 'UEFA European Championship', shortName: 'Euros', country: 'Europe', countryCode: 'EU', gender: 'M', accent: '#1a4b8c', accentBg: 'rgba(26, 75, 140, 0.14)', flag: '🇪🇺', logoUrl: ESPN_LOGO(74) },
  { competitionId: 'conmebol.america', displayName: 'Copa América', shortName: 'Copa América', country: 'South America', countryCode: 'SA', gender: 'M', accent: '#10708f', accentBg: 'rgba(16, 112, 143, 0.12)', flag: '🌎', logoUrl: ESPN_LOGO(83) },

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

/** Return all registered accents for a given gender (preserves order). */
export function leaguesForGender(gender: Gender): LeagueAccent[] {
  return accents.filter((a) => a.gender === gender)
}

/** Convenience: is this competition known to the women's universe? */
export function isWomensCompetition(idOrName: string | null | undefined): boolean {
  return getLeagueAccent(idOrName).gender === 'F'
}
