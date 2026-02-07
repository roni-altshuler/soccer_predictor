import { NextRequest, NextResponse } from 'next/server'

const TOURNAMENT_ESPN_IDS: Record<string, string> = {
  champions_league: 'uefa.champions',
  europa_league: 'uefa.europa',
  world_cup: 'fifa.world',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params
  const espnId = TOURNAMENT_ESPN_IDS[tournamentId]
  if (!espnId) {
    return NextResponse.json({ error: 'Unknown tournament' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const season = searchParams.get('season') || ''

  const seasonParam = season ? `?season=${season}` : ''

  // Build knockout date range covering the full knockout stage (Feb–Jun)
  const seasonYear = parseInt(season || String(new Date().getFullYear()))
  const knockoutStartYear = tournamentId === 'world_cup' ? seasonYear : seasonYear + 1
  const knockoutDateRange = `${knockoutStartYear}0201-${knockoutStartYear}0630`

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
    const [standingsRes, matchesRes, newsRes, knockoutRes] = await Promise.allSettled([
      fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${espnId}/standings${seasonParam}`, { next: { revalidate: 300 } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/scoreboard?dates=${recentDateRange}`, { next: { revalidate: 120 } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/news`, { next: { revalidate: 600 } }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/scoreboard?dates=${knockoutDateRange}`, { next: { revalidate: 120 } }),
    ])

    const result: any = {
      groups: [],
      knockoutMatches: [],
      upcomingMatches: [],
      recentResults: [],
      news: [],
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
              position: idx + 1,
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
          })
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

        const noteText = comp.notes?.[0]?.text || ''
        const leg = noteText.includes('1st Leg') ? 1 : noteText.includes('2nd Leg') ? 2 : undefined

        let winner: 'home' | 'away' | null = null
        if (isFinished) {
          const homeScore = parseInt(home?.score || '0')
          const awayScore = parseInt(away?.score || '0')
          if (homeScore > awayScore) winner = 'home'
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

    return NextResponse.json(result)
  } catch (error) {
    console.error('Tournament API error:', error)
    return NextResponse.json({ error: 'Failed to fetch tournament data' }, { status: 500 })
  }
}
