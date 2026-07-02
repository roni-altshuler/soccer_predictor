import { NextRequest, NextResponse } from 'next/server'

const TOURNAMENT_ESPN_IDS: Record<string, string> = {
  champions_league: 'uefa.champions',
  europa_league: 'uefa.europa',
  conference_league: 'uefa.europa.conf',
  world_cup: 'fifa.world',
  euro: 'uefa.euro',
  copa_america: 'conmebol.america',
}

// Women's counterparts. Keyed by the men's slug plus the women's ESPN id
// itself (the /tournaments listing surfaces those directly). IDs verified
// against backend/services/data/espn_loader.py WOMEN_COMPETITIONS.
const WOMENS_TOURNAMENT_ESPN_IDS: Record<string, string> = {
  champions_league: 'uefa.wchampions',
  world_cup: 'fifa.wwc',
  euro: 'uefa.weuro',
  'uefa.wchampions': 'uefa.wchampions',
  'fifa.wwc': 'fifa.wwc',
  'uefa.weuro': 'uefa.weuro',
}

// Empty (but well-formed) tournament payload so the women's toggle never
// serves men's data for a competition with no women's counterpart.
const EMPTY_TOURNAMENT = {
  groups: [],
  knockoutMatches: [],
  upcomingMatches: [],
  recentResults: [],
  news: [],
  topScorers: [],
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params
  const { searchParams } = new URL(request.url)
  const gender = (searchParams.get('gender') || 'M').toUpperCase() === 'F' ? 'F' : 'M'

  const espnId = gender === 'F'
    ? WOMENS_TOURNAMENT_ESPN_IDS[tournamentId]
    : TOURNAMENT_ESPN_IDS[tournamentId]

  if (!espnId) {
    // For the women's universe an unmapped tournament returns an explicit
    // empty result (data honesty); an unknown men's tournament is a 404.
    if (gender === 'F') {
      return NextResponse.json(EMPTY_TOURNAMENT)
    }
    return NextResponse.json({ error: 'Unknown tournament' }, { status: 404 })
  }

  const season = searchParams.get('season') || ''

  const seasonParam = season ? `?season=${season}` : ''

  // Build knockout date range covering the full knockout stage (Feb–Jun)
  const seasonYear = parseInt(season || String(new Date().getFullYear()))
  const isInternationalTournament = ['world_cup', 'euro', 'copa_america'].includes(tournamentId)
  const knockoutStartYear = isInternationalTournament ? seasonYear : seasonYear + 1
  const knockoutDateRange = isInternationalTournament
    ? `${knockoutStartYear}0601-${knockoutStartYear}0731`
    : `${knockoutStartYear}0201-${knockoutStartYear}0630`

  // Build upcoming/recent date range (45 days before and after today)
  const today = new Date()
  const pastDate = new Date(today)
  pastDate.setDate(pastDate.getDate() - 45)
  const futureDate = new Date(today)
  futureDate.setDate(futureDate.getDate() + 45)
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const recentDateRange = `${fmt(pastDate)}-${fmt(futureDate)}`

  try {
    const [standingsRes, matchesRes, newsRes, knockoutRes, leadersRes] = await Promise.allSettled([
      fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${espnId}/standings${seasonParam}`, { next: { revalidate: 300 } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/scoreboard?dates=${recentDateRange}`, { next: { revalidate: 120 } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/news`, { next: { revalidate: 600 } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/scoreboard?dates=${knockoutDateRange}`, { next: { revalidate: 120 } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/leaders${seasonParam}`, { next: { revalidate: 3600 } }),
    ])

    const result: any = {
      groups: [],
      knockoutMatches: [],
      upcomingMatches: [],
      recentResults: [],
      news: [],
      topScorers: [],
    }

    // Process standings
    if (standingsRes.status === 'fulfilled' && standingsRes.value.ok) {
      const data = await standingsRes.value.json()
      const children = data.children || []
      for (const child of children) {
        const groupName = child.name || child.abbreviation || 'Group'
        const entries = child.standings?.entries || []
        if (entries.length > 0) {
          const standings = entries.map((entry: any, idx: number) => {
            const stat = (name: string) => {
              const s = entry.stats?.find((s: any) => s.name === name)
              return parseInt(s?.value || '0', 10)
            }
            return {
              position: stat('rank') || idx + 1,
              team: entry.team?.displayName || 'Unknown',
              teamId: entry.team?.id,
              played: stat('gamesPlayed'),
              won: stat('wins'),
              drawn: stat('ties'),
              lost: stat('losses'),
              goalsFor: stat('pointsFor'),
              goalsAgainst: stat('pointsAgainst'),
              goalDifference: stat('pointDifferential'),
              points: stat('points'),
            }
          }).sort((a: { position: number }, b: { position: number }) => a.position - b.position)
          result.groups.push({ name: groupName, standings })
        }
      }
    }

    // Process recent/upcoming matches
    if (matchesRes.status === 'fulfilled' && matchesRes.value.ok) {
      const data = await matchesRes.value.json()
      for (const event of data.events || []) {
        const comp = event.competitions?.[0]
        if (!comp) continue
        const home = comp.competitors?.find((c: any) => c.homeAway === 'home')
        const away = comp.competitors?.find((c: any) => c.homeAway === 'away')
        const statusName = comp.status?.type?.name || ''
        const isFinished = statusName.includes('FINAL') || statusName.includes('FULL_TIME')
        const isLive = statusName.includes('IN_PROGRESS') || statusName.includes('HALFTIME')
        const matchDate = new Date(event.date)
        const match = {
          id: String(event.id),
          homeTeam: home?.team?.displayName || 'TBD',
          awayTeam: away?.team?.displayName || 'TBD',
          homeScore: isFinished || isLive ? parseInt(home?.score || '0') : undefined,
          awayScore: isFinished || isLive ? parseInt(away?.score || '0') : undefined,
          date: matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          time: matchDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          round: comp.series?.title || comp.type?.text || '',
          venue: comp.venue?.fullName,
          status: isFinished ? 'finished' : isLive ? 'live' : 'upcoming',
        }
        if (isFinished) {
          result.recentResults.push(match)
        } else {
          result.upcomingMatches.push(match)
        }
      }
    }

    // Process knockout matches from full-season range
    if (knockoutRes.status === 'fulfilled' && knockoutRes.value.ok) {
      const data = await knockoutRes.value.json()
      const seenIds = new Set<string>()
      for (const event of data.events || []) {
        const comp = event.competitions?.[0]
        if (!comp) continue
        const eventId = String(event.id)
        if (seenIds.has(eventId)) continue
        seenIds.add(eventId)

        const home = comp.competitors?.find((c: any) => c.homeAway === 'home')
        const away = comp.competitors?.find((c: any) => c.homeAway === 'away')
        const statusName = comp.status?.type?.name || ''
        const isFinished = statusName.includes('FINAL') || statusName.includes('FULL_TIME')
        const isLive = statusName.includes('IN_PROGRESS') || statusName.includes('HALFTIME')
        const matchDate = new Date(event.date)

        const seriesTitle = comp.series?.title || ''
        const seasonSlug = event.season?.slug || ''
        const roundName = seriesTitle ||
          seasonSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') ||
          'Knockout'

        if (roundName.toLowerCase().includes('group')) continue

        const noteText = comp.notes?.[0]?.text || ''
        const leg = noteText.includes('1st Leg') ? 1 : noteText.includes('2nd Leg') ? 2 : undefined

        let winner: 'home' | 'away' | null = null
        if (isFinished) {
          const homeScore = parseInt(home?.score || '0')
          const awayScore = parseInt(away?.score || '0')
          if (home?.winner) winner = 'home'
          else if (away?.winner) winner = 'away'
          else if (homeScore > awayScore) winner = 'home'
          else if (awayScore > homeScore) winner = 'away'
        }
        if (comp.series?.completed) {
          const sw = (comp.series.competitors || []).find((c: any) => c.winner)
          if (sw) winner = sw.id === home?.team?.id ? 'home' : 'away'
        }

        result.knockoutMatches.push({
          id: eventId,
          homeTeam: home?.team?.displayName || 'TBD',
          awayTeam: away?.team?.displayName || 'TBD',
          homeScore: isFinished || isLive ? parseInt(home?.score || '0') : undefined,
          awayScore: isFinished || isLive ? parseInt(away?.score || '0') : undefined,
          date: matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          time: matchDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          round: roundName,
          venue: comp.venue?.fullName,
          status: isFinished ? 'finished' : isLive ? 'live' : 'upcoming',
          leg,
          winner,
        })
      }
    }

    // Process news
    if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
      const data = await newsRes.value.json()
      result.news = (data.articles || []).slice(0, 8).map((n: any) => ({
        headline: n.headline || '',
        description: n.description || '',
        link: n.links?.web?.href || '',
        image: n.images?.[0]?.url || '',
        published: n.published || '',
      }))
    }

    // Process top scorers from ESPN leaders
    if (leadersRes.status === 'fulfilled' && leadersRes.value.ok) {
      const leadersData = await leadersRes.value.json()
      let scorers: any[] = []

      // Path 1: leaders array with categories
      if (leadersData.leaders && Array.isArray(leadersData.leaders)) {
        const goalsCategory = leadersData.leaders.find((cat: any) =>
          cat.name?.toLowerCase().includes('goal') ||
          cat.displayName?.toLowerCase().includes('goal') ||
          cat.abbreviation?.toLowerCase() === 'g' ||
          cat.name?.toLowerCase() === 'goals'
        )
        if (goalsCategory?.leaders) {
          scorers = goalsCategory.leaders
        }
        if (scorers.length === 0 && leadersData.leaders[0]?.leaders) {
          scorers = leadersData.leaders[0].leaders
        }
      }

      // Path 2: categories within leaders
      if (scorers.length === 0 && leadersData.categories) {
        const goalsCategory = leadersData.categories.find((cat: any) =>
          cat.name?.toLowerCase().includes('goal') ||
          cat.displayName?.toLowerCase().includes('goal') ||
          cat.abbreviation?.toLowerCase() === 'g'
        )
        if (goalsCategory?.leaders) {
          scorers = goalsCategory.leaders
        }
        if (scorers.length === 0 && leadersData.categories[0]?.leaders) {
          scorers = leadersData.categories[0].leaders
        }
      }

      // Path 3: direct athletes array
      if (scorers.length === 0 && leadersData.athletes) {
        scorers = leadersData.athletes
      }

      if (scorers.length > 0) {
        result.topScorers = scorers.slice(0, 10).map((leader: any, idx: number) => ({
          rank: idx + 1,
          name: leader.athlete?.displayName || leader.athlete?.fullName || leader.displayName || leader.name || 'Unknown',
          team: leader.athlete?.team?.displayName || leader.team?.displayName || leader.team?.name || '',
          goals: parseInt(leader.value || leader.stat || leader.goals || '0'),
          assists: parseInt(leader.assists || leader.statistics?.assists || '0'),
          matches: leader.athlete?.statistics?.gamesPlayed || leader.gamesPlayed || 0,
        }))
      }
    }

    // Keep tournament scorer rows provider-backed. Legacy curated rows stay disabled
    // so stale data is never presented as a live tournament leader board.
    const allowCuratedTournamentFallback = false
    if (allowCuratedTournamentFallback && result.topScorers.length === 0) {
      const CURATED_TOURNAMENT_SCORERS: Record<string, Array<{ name: string; team: string; goals: number; assists: number; matches: number }>> = {
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
        'fifa.world': [
          { name: 'TBD', team: 'TBD', goals: 0, assists: 0, matches: 0 },
        ],
      }
      const curated = CURATED_TOURNAMENT_SCORERS[espnId]
      if (curated && curated.length > 0 && curated[0].name !== 'TBD') {
        result.topScorers = curated.map((s, idx) => ({
          rank: idx + 1,
          name: s.name,
          team: s.team,
          goals: s.goals,
          assists: s.assists,
          matches: s.matches,
        }))
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Tournament API error:', error)
    return NextResponse.json({ error: 'Failed to fetch tournament data' }, { status: 500 })
  }
}
