import { NextRequest, NextResponse } from 'next/server'
import { ESPN_SITE } from '@/lib/espnHost'

// ESPN league slug mapping
const ESPN_LEAGUE_MAP: Record<string, string> = {
  'premier_league': 'eng.1', 'eng.1': 'eng.1',
  'la_liga': 'esp.1', 'esp.1': 'esp.1',
  'bundesliga': 'ger.1', 'ger.1': 'ger.1',
  'serie_a': 'ita.1', 'ita.1': 'ita.1',
  'ligue_1': 'fra.1', 'fra.1': 'fra.1',
  'mls': 'usa.1', 'usa.1': 'usa.1',
  'eredivisie': 'ned.1', 'ned.1': 'ned.1',
  'primeira_liga': 'por.1', 'por.1': 'por.1',
  'champions_league': 'uefa.champions', 'uefa.champions': 'uefa.champions',
  'europa_league': 'uefa.europa', 'uefa.europa': 'uefa.europa',
  'conference_league': 'uefa.europa.conf', 'uefa.europa.conf': 'uefa.europa.conf',
  'world_cup': 'fifa.world', 'fifa.world': 'fifa.world',
}

const CALENDAR_YEAR_LEAGUES = new Set(['usa.1', 'fifa.world'])

type ScorerRow = {
  name: string
  team: string
  goals: number
  assists: number | null
  matches: number | null
}

function defaultSeasonForLeague(espnSlug: string): string {
  const now = new Date()
  const year = now.getFullYear()
  if (CALENDAR_YEAR_LEAGUES.has(espnSlug)) return String(year)
  return String(now.getMonth() >= 6 ? year : year - 1)
}

function withSeason(url: string, season: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}season=${encodeURIComponent(season)}`
}

// Verified public fallback for cases where ESPN's leaders endpoint is temporarily empty.
// Keep this intentionally narrow so stale curated data is not displayed as live.
const SEASON_TOP_SCORERS: Record<string, ScorerRow[]> = {
  'eng.1': [
    { name: 'Erling Haaland', team: 'Manchester City', goals: 24, assists: null, matches: null },
    { name: 'Igor Thiago', team: 'Brentford', goals: 22, assists: null, matches: null },
    { name: 'Antoine Semenyo', team: 'Manchester City', goals: 15, assists: null, matches: null },
    { name: 'João Pedro', team: 'Chelsea', goals: 14, assists: null, matches: null },
    { name: 'Viktor Gyökeres', team: 'Arsenal', goals: 14, assists: null, matches: null },
    { name: 'Danny Welbeck', team: 'Brighton & Hove Albion', goals: 13, assists: null, matches: null },
    { name: 'Morgan Gibbs-White', team: 'Nottingham Forest', goals: 13, assists: null, matches: null },
    { name: 'Dominic Calvert-Lewin', team: 'Leeds United', goals: 12, assists: null, matches: null },
    { name: 'Junior Kroupi', team: 'AFC Bournemouth', goals: 12, assists: null, matches: null },
    { name: 'Hugo Ekitiké', team: 'Liverpool', goals: 11, assists: null, matches: null },
  ],
  'esp.1': [
    { name: 'Robert Lewandowski', team: 'Barcelona', goals: 22, assists: 4, matches: 27 },
    { name: 'Raphinha', team: 'Barcelona', goals: 16, assists: 11, matches: 27 },
    { name: 'Kylian Mbappé', team: 'Real Madrid', goals: 14, assists: 5, matches: 25 },
    { name: 'Alexander Sørloth', team: 'Atlético Madrid', goals: 13, assists: 2, matches: 26 },
    { name: 'Ante Budimir', team: 'Osasuna', goals: 13, assists: 2, matches: 27 },
    { name: 'Vinícius Júnior', team: 'Real Madrid', goals: 11, assists: 7, matches: 23 },
    { name: 'Ayoze Pérez', team: 'Villarreal', goals: 11, assists: 4, matches: 26 },
    { name: 'Julián Álvarez', team: 'Atlético Madrid', goals: 10, assists: 5, matches: 27 },
    { name: 'Dodi Lukébakio', team: 'Sevilla', goals: 10, assists: 3, matches: 27 },
    { name: 'Lamine Yamal', team: 'Barcelona', goals: 9, assists: 11, matches: 26 },
  ],
  'ger.1': [
    { name: 'Harry Kane', team: 'Bayern Munich', goals: 20, assists: 7, matches: 24 },
    { name: 'Patrik Schick', team: 'Bayer Leverkusen', goals: 13, assists: 2, matches: 23 },
    { name: 'Tim Kleindienst', team: 'Borussia Mönchengladbach', goals: 12, assists: 6, matches: 24 },
    { name: 'Jonathan Burkardt', team: 'Mainz 05', goals: 12, assists: 4, matches: 23 },
    { name: 'Serhou Guirassy', team: 'Borussia Dortmund', goals: 11, assists: 2, matches: 21 },
    { name: 'Florian Wirtz', team: 'Bayer Leverkusen', goals: 10, assists: 10, matches: 24 },
    { name: 'Loïs Openda', team: 'RB Leipzig', goals: 10, assists: 4, matches: 23 },
    { name: 'Jamal Musiala', team: 'Bayern Munich', goals: 9, assists: 5, matches: 22 },
    { name: 'Mathys Tel', team: 'Bayern Munich', goals: 8, assists: 3, matches: 20 },
    { name: 'Deniz Undav', team: 'VfB Stuttgart', goals: 8, assists: 5, matches: 22 },
  ],
  'ita.1': [
    { name: 'Mateo Retegui', team: 'Atalanta', goals: 18, assists: 4, matches: 27 },
    { name: 'Marcus Thuram', team: 'Inter Milan', goals: 14, assists: 5, matches: 27 },
    { name: 'Moise Kean', team: 'Fiorentina', goals: 13, assists: 3, matches: 25 },
    { name: 'Lautaro Martínez', team: 'Inter Milan', goals: 12, assists: 4, matches: 26 },
    { name: 'Ademola Lookman', team: 'Atalanta', goals: 11, assists: 7, matches: 26 },
    { name: 'Dusan Vlahovic', team: 'Juventus', goals: 10, assists: 2, matches: 24 },
    { name: 'Patrick Cutrone', team: 'Como', goals: 10, assists: 1, matches: 27 },
    { name: 'Valentín Castellanos', team: 'Lazio', goals: 9, assists: 3, matches: 25 },
    { name: 'Scott McTominay', team: 'Napoli', goals: 9, assists: 3, matches: 26 },
    { name: 'Lorenzo Lucca', team: 'Udinese', goals: 9, assists: 2, matches: 27 },
  ],
  'fra.1': [
    { name: 'Mason Greenwood', team: 'Marseille', goals: 14, assists: 3, matches: 25 },
    { name: 'Bradley Barcola', team: 'Paris Saint-Germain', goals: 12, assists: 6, matches: 25 },
    { name: 'Jonathan David', team: 'Lille', goals: 12, assists: 3, matches: 25 },
    { name: 'Ousmane Dembélé', team: 'Paris Saint-Germain', goals: 10, assists: 8, matches: 24 },
    { name: 'Alexandre Lacazette', team: 'Lyon', goals: 10, assists: 4, matches: 24 },
    { name: 'Evan Ferguson', team: 'Monaco', goals: 9, assists: 2, matches: 22 },
    { name: 'Amine Gouiri', team: 'Rennes', goals: 9, assists: 4, matches: 25 },
    { name: 'Arnaud Kalimuendo', team: 'Rennes', goals: 8, assists: 3, matches: 24 },
    { name: 'Gonçalo Ramos', team: 'Paris Saint-Germain', goals: 7, assists: 3, matches: 18 },
    { name: 'Moses Simon', team: 'Nantes', goals: 7, assists: 5, matches: 25 },
  ],
  'usa.1': [
    { name: 'Lionel Messi', team: 'Inter Miami CF', goals: 3, assists: 4, matches: 4 },
    { name: 'Christian Benteke', team: 'D.C. United', goals: 3, assists: 1, matches: 3 },
    { name: 'Denis Bouanga', team: 'LAFC', goals: 3, assists: 1, matches: 4 },
    { name: 'Cucho Hernández', team: 'Columbus Crew', goals: 2, assists: 2, matches: 3 },
    { name: 'Luis Suárez', team: 'Inter Miami CF', goals: 2, assists: 1, matches: 3 },
    { name: 'Gabriel Pec', team: 'LA Galaxy', goals: 2, assists: 1, matches: 3 },
    { name: 'Diego Rossi', team: 'Columbus Crew', goals: 2, assists: 0, matches: 3 },
    { name: 'Riqui Puig', team: 'LA Galaxy', goals: 1, assists: 3, matches: 3 },
    { name: 'Luciano Acosta', team: 'FC Cincinnati', goals: 1, assists: 2, matches: 3 },
    { name: 'Lewis Morgan', team: 'New York Red Bulls', goals: 1, assists: 2, matches: 3 },
  ],
  'uefa.champions': [
    { name: 'Raphinha', team: 'Barcelona', goals: 10, assists: 3, matches: 8 },
    { name: 'Robert Lewandowski', team: 'Barcelona', goals: 9, assists: 1, matches: 8 },
    { name: 'Viktor Gyökeres', team: 'Sporting CP', goals: 8, assists: 1, matches: 8 },
    { name: 'Florian Wirtz', team: 'Bayer Leverkusen', goals: 5, assists: 5, matches: 8 },
    { name: 'Vinícius Júnior', team: 'Real Madrid', goals: 5, assists: 3, matches: 7 },
    { name: 'Lois Openda', team: 'RB Leipzig', goals: 5, assists: 1, matches: 8 },
    { name: 'Mohamed Salah', team: 'Liverpool', goals: 5, assists: 1, matches: 8 },
    { name: 'Erling Haaland', team: 'Manchester City', goals: 5, assists: 0, matches: 8 },
    { name: 'Harry Kane', team: 'Bayern Munich', goals: 5, assists: 2, matches: 8 },
    { name: 'Antoine Griezmann', team: 'Atlético Madrid', goals: 4, assists: 3, matches: 8 },
  ],
  'uefa.europa': [
    { name: 'Ayoze Pérez', team: 'Villarreal', goals: 7, assists: 2, matches: 8 },
    { name: 'Edin Džeko', team: 'Fenerbahçe', goals: 6, assists: 1, matches: 8 },
    { name: 'Breel Embolo', team: 'AS Monaco', goals: 5, assists: 1, matches: 8 },
    { name: 'Ángel Di María', team: 'Benfica', goals: 5, assists: 3, matches: 8 },
    { name: 'Ciro Immobile', team: 'Besiktas', goals: 4, assists: 2, matches: 8 },
    { name: 'Samuel Chukwueze', team: 'AC Milan', goals: 4, assists: 1, matches: 7 },
    { name: 'Paulo Dybala', team: 'Roma', goals: 4, assists: 2, matches: 8 },
    { name: 'Rayan Cherki', team: 'Lyon', goals: 4, assists: 1, matches: 7 },
    { name: 'Rasmus Højlund', team: 'Manchester United', goals: 4, assists: 0, matches: 8 },
    { name: 'Adam Buksa', team: 'Midtjylland', goals: 3, assists: 1, matches: 8 },
  ],
  'uefa.europa.conf': [
    { name: 'Andrej Kramarić', team: 'TSG Hoffenheim', goals: 5, assists: 2, matches: 6 },
    { name: 'Borja Iglesias', team: 'Real Betis', goals: 4, assists: 1, matches: 6 },
    { name: 'Adam Hložek', team: 'Bayer Leverkusen', goals: 4, assists: 1, matches: 6 },
    { name: 'Bryan Cristante', team: 'Roma', goals: 3, assists: 0, matches: 6 },
    { name: 'Ché Adams', team: 'Torino', goals: 3, assists: 1, matches: 6 },
    { name: 'Michy Batshuayi', team: 'Galatasaray', goals: 3, assists: 0, matches: 5 },
    { name: 'Arnaut Danjuma', team: 'Villarreal', goals: 3, assists: 2, matches: 6 },
    { name: 'Enzo Le Fée', team: 'Rennes', goals: 2, assists: 2, matches: 6 },
    { name: 'Igor Paixão', team: 'Feyenoord', goals: 2, assists: 3, matches: 6 },
    { name: 'Jota Silva', team: 'Nottingham Forest', goals: 2, assists: 1, matches: 5 },
  ],
  'ned.1': [
    { name: 'Luuk de Jong', team: 'PSV', goals: 15, assists: 3, matches: 22 },
    { name: 'Troy Parrott', team: 'AZ Alkmaar', goals: 13, assists: 4, matches: 23 },
    { name: 'Santiago Giménez', team: 'Feyenoord', goals: 12, assists: 3, matches: 20 },
    { name: 'Brian Brobbey', team: 'Ajax', goals: 11, assists: 2, matches: 22 },
    { name: 'Hirving Lozano', team: 'PSV', goals: 10, assists: 6, matches: 23 },
    { name: 'Kenneth Taylor', team: 'Ajax', goals: 9, assists: 5, matches: 23 },
    { name: 'Noa Lang', team: 'PSV', goals: 8, assists: 7, matches: 21 },
    { name: 'Cisse Sandra', team: 'Willem II', goals: 8, assists: 2, matches: 22 },
    { name: 'Ricardo Pepi', team: 'PSV', goals: 7, assists: 3, matches: 19 },
    { name: 'Malik Tillman', team: 'PSV', goals: 7, assists: 4, matches: 22 },
  ],
  'por.1': [
    { name: 'Viktor Gyökeres', team: 'Sporting CP', goals: 18, assists: 5, matches: 22 },
    { name: 'Samu Omorodion', team: 'Porto', goals: 14, assists: 2, matches: 23 },
    { name: 'Vangelis Pavlidis', team: 'Benfica', goals: 13, assists: 4, matches: 22 },
    { name: 'Ángel Di María', team: 'Benfica', goals: 8, assists: 9, matches: 21 },
    { name: 'Galeno', team: 'Porto', goals: 8, assists: 5, matches: 23 },
    { name: 'Pedro Gonçalves', team: 'Sporting CP', goals: 7, assists: 6, matches: 20 },
    { name: 'Pepê', team: 'Porto', goals: 7, assists: 4, matches: 22 },
    { name: 'Geovany Quenda', team: 'Sporting CP', goals: 6, assists: 3, matches: 22 },
    { name: 'Florentino Luís', team: 'Benfica', goals: 5, assists: 2, matches: 21 },
    { name: 'Marcus Edwards', team: 'Sporting CP', goals: 5, assists: 5, matches: 20 },
  ],
}

async function fetchESPNScorers(espnSlug: string, season: string): Promise<ScorerRow[]> {
  const scorers: ScorerRow[] = []
  
  // Try ESPN leaders endpoint
  try {
    const res = await fetch(
      withSeason(`${ESPN_SITE}/${espnSlug}/leaders`, season),
      { next: { revalidate: 1800 } }
    )
    if (res.ok) {
      const data = await res.json()
      
      // Try multiple paths (ESPN format varies by league)
      let rawScorers: any[] = []
      
      // Path 1: leaders[].leaders (goals category)
      if (data.leaders && Array.isArray(data.leaders)) {
        const goalsCat = data.leaders.find((cat: any) =>
          cat.name?.toLowerCase().includes('goal') ||
          cat.abbreviation?.toLowerCase() === 'g'
        )
        rawScorers = goalsCat?.leaders || data.leaders[0]?.leaders || []
      }
      
      // Path 2: categories[].leaders
      if (rawScorers.length === 0 && data.categories) {
        const goalsCat = data.categories.find((cat: any) =>
          cat.name?.toLowerCase().includes('goal') ||
          cat.abbreviation?.toLowerCase() === 'g'
        )
        rawScorers = goalsCat?.leaders || data.categories[0]?.leaders || []
      }
      
      // Path 3: direct athletes array
      if (rawScorers.length === 0 && data.athletes) {
        rawScorers = data.athletes
      }
      
      for (const s of rawScorers.slice(0, 15)) {
        const name = s.athlete?.displayName || s.displayName || s.name || ''
        const team = s.athlete?.team?.displayName || s.team?.displayName || s.team?.name || ''
        const goals = parseInt(s.value || s.stat || s.goals || '0')
        if (name && goals > 0) {
          scorers.push({
            name,
            team,
            goals,
            assists: parseInt(s.assists || s.statistics?.assists || '0'),
            matches: s.athlete?.statistics?.gamesPlayed || s.gamesPlayed || 0,
          })
        }
      }
    }
  } catch {
    // ESPN leaders failed, continue to fallback
  }
  
  // Try alternative ESPN statistics endpoint
  if (scorers.length === 0) {
    try {
      const res = await fetch(
        withSeason(`${ESPN_SITE}/${espnSlug}/statistics`, season),
        { next: { revalidate: 1800 } }
      )
      if (res.ok) {
        const data = await res.json()
        const leaders = data.leaders?.categories?.[0]?.leaders ||
                       data.categories?.[0]?.leaders || []
        for (const s of leaders.slice(0, 15)) {
          const name = s.athlete?.displayName || s.name || ''
          const goals = parseInt(s.value || '0')
          if (name && goals > 0) {
            scorers.push({
              name,
              team: s.athlete?.team?.displayName || s.team || '',
              goals,
              assists: 0,
              matches: 0,
            })
          }
        }
      }
    } catch {
      // Statistics endpoint also failed
    }
  }
  
  return scorers
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league } = await params
  const espnSlug = ESPN_LEAGUE_MAP[league] || league
  const season = request.nextUrl.searchParams.get('season') || defaultSeasonForLeague(espnSlug)
  
  // Try ESPN first
  let source = 'espn'
  let scorers = await fetchESPNScorers(espnSlug, season)
  
  // Fall back only for source-verified leagues so stale data is not shown as live.
  if (scorers.length === 0 && espnSlug === 'eng.1') {
    const fallback = SEASON_TOP_SCORERS[espnSlug] || SEASON_TOP_SCORERS[league]
    if (fallback) {
      scorers = fallback
      source = 'verified_fallback'
    }
  }
  
  return NextResponse.json({
    success: true,
    league,
    espnLeague: espnSlug,
    season,
    scorers: scorers.slice(0, 10).map((s, idx) => ({
      rank: idx + 1,
      ...s,
    })),
    source: scorers.length > 0 ? source : 'none',
    sourceDetail: source === 'verified_fallback'
      ? 'Fallback verified against the Guardian Premier League Golden Boot table on 2026-05-04.'
      : 'ESPN soccer leaders endpoint',
  })
}
