import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Match {
  id: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  time: string
  status: string
  league: string
  leagueId: string
  match_id: string | number
  venue?: string
  minute?: number | string
}

// ESPN league IDs for major leagues
const ESPN_LEAGUES = [
  { id: 'eng.1', name: 'Premier League' },
  { id: 'esp.1', name: 'La Liga' },
  { id: 'ita.1', name: 'Serie A' },
  { id: 'ger.1', name: 'Bundesliga' },
  { id: 'fra.1', name: 'Ligue 1' },
  { id: 'ned.1', name: 'Eredivisie' },
  { id: 'por.1', name: 'Primeira Liga' },
  { id: 'usa.1', name: 'MLS' },
  { id: 'uefa.champions', name: 'UEFA Champions League' },
  { id: 'uefa.europa', name: 'UEFA Europa League' },
  { id: 'uefa.europa.conf', name: 'UEFA Conference League' },
  { id: 'fifa.world', name: 'FIFA World Cup 2026' },
]

function resolveRequestedDate(rawDate: string | null): Date {
  if (!rawDate) return new Date()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return new Date()
  }

  const parsed = new Date(`${rawDate}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return new Date()
  }

  return parsed
}

async function fetchESPNMatches(targetDate: Date): Promise<Match[]> {
  const allMatches: Match[] = []
  
  // Convert target date to YYYYMMDD format for ESPN API
  const targetDateStr = `${targetDate.getUTCFullYear()}${String(targetDate.getUTCMonth() + 1).padStart(2, '0')}${String(targetDate.getUTCDate()).padStart(2, '0')}`
  
  for (const league of ESPN_LEAGUES) {
    try {
      // Use dates parameter to explicitly request today's matches
      const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.id}/scoreboard?dates=${targetDateStr}`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          next: { revalidate: 60 },
        }
      )
      
      if (!response.ok) continue
      
      const data = await response.json()
      
      for (const event of data.events || []) {
        const competition = event.competitions?.[0]
        if (!competition) continue
        
        const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home')
        const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away')
        
        if (!homeTeam || !awayTeam) continue
        
        const statusType = competition.status?.type?.name || 'STATUS_SCHEDULED'
        let status = 'upcoming'
        let minute: number | string | undefined = undefined
        
        if (statusType === 'STATUS_FINAL' || statusType === 'STATUS_FULL_TIME') {
          status = 'completed'
        } else if (statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME' || statusType === 'STATUS_FIRST_HALF' || statusType === 'STATUS_SECOND_HALF') {
          status = 'live'
          // Extract minute from clock or status
          const displayClock = competition.status?.displayClock
          if (displayClock) {
            minute = parseInt(displayClock.split(':')[0]) || displayClock
          }
          // For halftime, show "HT"
          if (statusType === 'STATUS_HALFTIME') {
            minute = 'HT'
          }
        }
        
        allMatches.push({
          id: String(event.id),
          home_team: homeTeam.team?.displayName || homeTeam.team?.name || '',
          away_team: awayTeam.team?.displayName || awayTeam.team?.name || '',
          home_score: status !== 'upcoming' ? parseInt(homeTeam.score || '0') : null,
          away_score: status !== 'upcoming' ? parseInt(awayTeam.score || '0') : null,
          time: event.date || '',
          status,
          league: league.name,
          leagueId: league.id,
          match_id: event.id,
          venue: competition.venue?.fullName,
          minute,
        })
      }
    } catch (error) {
      console.error(`Error fetching ${league.name} from ESPN:`, error)
    }
  }
  
  return allMatches
}

async function fetchFotMobMatches(targetDate: Date): Promise<Match[]> {
  const matches: Match[] = []
  const targetDateStr = `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, '0')}-${String(targetDate.getUTCDate()).padStart(2, '0')}`.replace(/-/g, '')
  
  // Map FotMob league names to ESPN league IDs
  const FOTMOB_LEAGUE_MAPPING: Record<string, string> = {
    'Premier League': 'eng.1',
    'La Liga': 'esp.1',
    'Serie A': 'ita.1',
    'Bundesliga': 'ger.1',
    'Ligue 1': 'fra.1',
    'MLS': 'usa.1',
    'Champions League': 'uefa.champions',
    'UEFA Champions League': 'uefa.champions',
    'Europa League': 'uefa.europa',
    'UEFA Europa League': 'uefa.europa',
  }
  
  try {
    const response = await fetch(`https://www.fotmob.com/api/matches?date=${targetDateStr}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.fotmob.com/',
      },
      next: { revalidate: 60 },
    })
    
    if (!response.ok) {
      throw new Error(`FotMob API returned ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.leagues && Array.isArray(data.leagues)) {
      for (const league of data.leagues) {
        const leagueName = league.name || 'Unknown'
        const leagueId = FOTMOB_LEAGUE_MAPPING[leagueName] || ''
        
        for (const match of league.matches || []) {
          const isFinished = match.status?.finished === true
          const isStarted = match.status?.started === true
          
          let status = 'upcoming'
          let minute: number | string | undefined = undefined
          
          if (isFinished) {
            status = 'completed'
          } else if (isStarted) {
            status = 'live'
            // Extract minute from FotMob status
            minute = match.status?.liveTime?.short || match.status?.reason?.short
            if (!minute && match.status?.reason?.short === 'HT') {
              minute = 'HT'
            }
          }
          
          matches.push({
            id: String(match.id),
            home_team: match.home?.name || match.home?.shortName || '',
            away_team: match.away?.name || match.away?.shortName || '',
            home_score: match.home?.score ?? null,
            away_score: match.away?.score ?? null,
            time: match.status?.utcTime || '',
            status,
            league: leagueName,
            leagueId: leagueId,
            match_id: match.id,
            minute,
          })
        }
      }
    }
  } catch (error) {
    console.error('Error fetching from FotMob:', error)
  }
  
  return matches
}

// Sample data for when APIs are unavailable - no longer used to avoid showing inaccurate data
// Users will see "No matches" when APIs are blocked

export async function GET(request: NextRequest) {
  try {
    const requestedDate = resolveRequestedDate(request.nextUrl.searchParams.get('date'))

    // Try ESPN first, then FotMob
    let matches = await fetchESPNMatches(requestedDate)
    
    if (matches.length === 0) {
      matches = await fetchFotMobMatches(requestedDate)
    }
    
    // Categorize matches
    const result = {
      live: matches.filter(m => m.status === 'live'),
      upcoming: matches.filter(m => m.status === 'upcoming'),
      completed: matches.filter(m => m.status === 'completed'),
      leagues: [] as { name: string; matches: Match[] }[],
      source: matches.length > 0 && matches[0].match_id.toString().startsWith('sample') ? 'sample' : 'live'
    }
    
    // Group by league
    const leagueMap = new Map<string, Match[]>()
    for (const match of matches) {
      const leagueMatches = leagueMap.get(match.league) || []
      leagueMatches.push(match)
      leagueMap.set(match.league, leagueMatches)
    }
    
    result.leagues = Array.from(leagueMap.entries()).map(([name, matches]) => ({
      name,
      matches,
    }))
    
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Error fetching today\'s matches:', error)
    // Return empty data instead of fake data when APIs fail
    return NextResponse.json({
      live: [],
      upcoming: [],
      completed: [],
      leagues: [],
      source: 'error'
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  }
}
