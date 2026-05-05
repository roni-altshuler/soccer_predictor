import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

// Map league IDs for ESPN API
const LEAGUE_ENDPOINTS = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'usa.1', 'uefa.champions', 'uefa.europa', 'fifa.world'
]

const ESPN_LEAGUE_ABBREVIATION_MAP: Record<string, string> = {
  premierleague: 'eng.1',
  laliga: 'esp.1',
  seriea: 'ita.1',
  bundesliga: 'ger.1',
  ligue1: 'fra.1',
  mls: 'usa.1',
}

function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a)
  const nb = normalizeTeamName(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function resolveLeagueIdFromESPN(leagueData: { slug?: string; abbreviation?: string; name?: string } | undefined, fallback: string): string {
  const slug = String(leagueData?.slug || '').toLowerCase()
  if (LEAGUE_ENDPOINTS.includes(slug)) return slug

  const abbr = String(leagueData?.abbreviation || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (abbr && ESPN_LEAGUE_ABBREVIATION_MAP[abbr]) {
    return ESPN_LEAGUE_ABBREVIATION_MAP[abbr]
  }

  const name = String(leagueData?.name || '').toLowerCase()
  if (name.includes('laliga') || name.includes('spanish')) return 'esp.1'
  if (name.includes('premier league') || name.includes('english')) return 'eng.1'
  if (name.includes('serie a') || name.includes('italian')) return 'ita.1'
  if (name.includes('bundesliga') || name.includes('german')) return 'ger.1'
  if (name.includes('ligue 1') || name.includes('french')) return 'fra.1'
  if (name.includes('mls') || name.includes('major league soccer')) return 'usa.1'
  if (name.includes('champions league')) return 'uefa.champions'
  if (name.includes('europa league')) return 'uefa.europa'
  if (name.includes('world cup')) return 'fifa.world'

  return fallback
}

function parseClock(clockDisplayValue: string | undefined, clockValue: number | undefined): { minute: number; addedTime?: number } {
  const display = (clockDisplayValue || '').replace(/\s/g, '')
  const match = display.match(/^(\d+)(?:\+(\d+))?/) 
  if (match) {
    return {
      minute: parseInt(match[1], 10),
      addedTime: match[2] ? parseInt(match[2], 10) : undefined,
    }
  }

  if (typeof clockValue === 'number' && Number.isFinite(clockValue) && clockValue > 0) {
    return { minute: Math.floor(clockValue / 60) }
  }

  return { minute: 0 }
}

function extractPrimaryPlayerFromText(text: string): string {
  const playerInParens = text.match(/\.\s*([^()]+?)\s*\(([^)]+)\)/)
  if (playerInParens?.[1]) return playerInParens[1].trim()

  const leadingPlayer = text.match(/^([^()]+?)\s*\(([^)]+)\)\s+is\s+/)
  if (leadingPlayer?.[1]) return leadingPlayer[1].trim()

  const substitution = text.match(/Substitution,\s*[^.]+\.\s*([^.]*)\s+replaces/i)
  if (substitution?.[1]) return substitution[1].trim()

  return 'Unknown'
}

function extractAssistFromText(text: string): string | undefined {
  const assist = text.match(/Assisted by\s+([^.,]+)/i)
  return assist?.[1]?.trim()
}

interface MatchEvent {
  type: string
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  relatedPlayer?: string
  description?: string
}

interface H2HMatch {
  date: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  competition?: string
}

interface H2HData {
  homeWins: number
  draws: number
  awayWins: number
  recentMatches: H2HMatch[]
}

interface PredictionData {
  home_win: number
  draw: number
  away_win: number
  predicted_score: { home: number; away: number }
  confidence: number
  total_goals?: number
  over_2_5?: number
  btts_yes?: number
  most_likely_score?: string
  model_version?: string
  confidence_band?: 'Low' | 'Medium' | 'High'
}

interface ShotMapPoint {
  x: number
  y: number
  team: 'home' | 'away'
  expectedGoals?: number
  isGoal?: boolean
  minute?: number
  player?: string
}

type ESPNEventLike = {
  team?: { id?: string | number; displayName?: string; shortDisplayName?: string }
  competitor?: { id?: string | number }
  competitorId?: string | number
  teamId?: string | number
  homeAway?: string
}

type FotMobShot = {
  x?: unknown
  X?: unknown
  y?: unknown
  Y?: unknown
  position?: { x?: unknown; y?: unknown }
  isHome?: boolean
  teamId?: string | number
  eventType?: string
  expectedGoals?: unknown
  xG?: unknown
  expectedGoal?: unknown
  isGoal?: boolean
  min?: unknown
  minute?: unknown
  time?: unknown
  playerName?: string
  player?: { name?: string }
}

interface MatchDetailsResponse {
  id: string
  source?: 'espn' | 'fotmob'
  sourceDetail?: string
  generatedAt?: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  status: string
  minute?: number
  addedTime?: number
  venue?: string
  attendance?: number
  capacity?: number
  date: string
  league: string
  leagueId?: string
  referee?: string
  refereeCountry?: string
  events: MatchEvent[]
  lineups: {
    home: { name: string; position?: string; jersey?: number }[]
    away: { name: string; position?: string; jersey?: number }[]
    homeFormation?: string
    awayFormation?: string
  }
  stats: {
    possession: [number, number]
    shots: [number, number]
    shotsOnTarget: [number, number]
    corners: [number, number]
    fouls: [number, number]
  }
  commentary?: { minute: number; text: string }[]
  prediction?: PredictionData
  h2h?: H2HData
  shotmap?: ShotMapPoint[]
}

function normalizeShotCoordinate(value: unknown, axis: 'x' | 'y'): number | null {
  const num = typeof value === 'string' ? parseFloat(value) : Number(value)
  if (!Number.isFinite(num)) return null

  if (num >= 0 && num <= 1) return num
  if (num >= 0 && num <= 100) return num / 100
  if (axis === 'x' && num >= 0 && num <= 105) return num / 105
  if (axis === 'y' && num >= 0 && num <= 68) return num / 68

  return null
}

async function fetchFromESPN(matchId: string, leagueId?: string): Promise<MatchDetailsResponse | null> {
  // Try with provided league ID first
  const leaguesToTry = leagueId ? [leagueId, ...LEAGUE_ENDPOINTS.filter(l => l !== leagueId)] : LEAGUE_ENDPOINTS
  
  for (const league of leaguesToTry) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${matchId}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        next: { revalidate: 30 }, // Cache for 30 seconds for live data
      })
      
      if (!res.ok) continue
      
      const data = await res.json()
      const competition = data.header?.competitions?.[0]
      if (!competition) continue
      
      const homeTeam = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === 'home')
      const awayTeam = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === 'away')
      
      if (!homeTeam || !awayTeam) continue
      
      // Extract status
      const statusType = competition.status?.type?.name || 'STATUS_SCHEDULED'
      let status = 'scheduled'
      let minute: number | undefined
      
      if (statusType === 'STATUS_FINAL' || statusType === 'STATUS_FULL_TIME') {
        status = 'finished'
      } else if (statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME' || 
                 statusType === 'STATUS_FIRST_HALF' || statusType === 'STATUS_SECOND_HALF') {
        status = 'live'
        const displayClock = competition.status?.displayClock
        if (displayClock) {
          minute = parseInt(displayClock.split(':')[0]) || undefined
        }
        if (statusType === 'STATUS_HALFTIME') {
          minute = 45
        }
      }

      const homeTeamName = homeTeam.team?.displayName || homeTeam.team?.name || ''
      const awayTeamName = awayTeam.team?.displayName || awayTeam.team?.name || ''
      const homeTeamId = String(homeTeam.team?.id || '')
      const awayTeamId = String(awayTeam.team?.id || '')
      const resolvedLeagueId = resolveLeagueIdFromESPN(data.header?.league, league)

      const inferEventTeam = (rawEvent: ESPNEventLike, text?: string): 'home' | 'away' | null => {
        const eventTeamId = String(
          rawEvent?.team?.id ||
          rawEvent?.competitor?.id ||
          rawEvent?.competitorId ||
          rawEvent?.teamId ||
          ''
        )
        if (eventTeamId && homeTeamId && eventTeamId === homeTeamId) return 'home'
        if (eventTeamId && awayTeamId && eventTeamId === awayTeamId) return 'away'

        if (rawEvent?.homeAway === 'home' || rawEvent?.homeAway === 'away') {
          return rawEvent.homeAway
        }

        const sourceTeamName = String(
          rawEvent?.team?.displayName ||
          rawEvent?.team?.shortDisplayName ||
          ''
        )

        if (sourceTeamName) {
          if (teamNamesMatch(sourceTeamName, homeTeamName)) return 'home'
          if (teamNamesMatch(sourceTeamName, awayTeamName)) return 'away'
        }

        const extractedTeam = text?.match(/\(([^)]+)\)/)?.[1]
        if (extractedTeam) {
          if (teamNamesMatch(extractedTeam, homeTeamName)) return 'home'
          if (teamNamesMatch(extractedTeam, awayTeamName)) return 'away'
        }

        return null
      }
      
      // Extract events
      const events: MatchEvent[] = []
      const eventKeys = new Set<string>()

      const pushEvent = (event: MatchEvent) => {
        const key = `${event.type}-${event.minute}-${event.team}-${event.player.toLowerCase()}`
        if (eventKeys.has(key)) return
        eventKeys.add(key)
        events.push(event)
      }
      
      // Scoring plays (goals)
      const scoringPlays = data.scoringPlays || []
      for (const play of scoringPlays) {
        const parsedClock = parseClock(play.clock?.displayValue, play.clock?.value)
        const text = String(play.text || '')
        const team = inferEventTeam(play, text)
        if (!team) continue

        const isOwnGoal = play.text?.toLowerCase().includes('own goal')
        pushEvent({
          type: isOwnGoal ? 'own_goal' : 'goal',
          minute: parsedClock.minute,
          addedTime: parsedClock.addedTime,
          player: play.scoringPlay?.scorer?.athlete?.displayName || extractPrimaryPlayerFromText(text),
          team,
          relatedPlayer: play.scoringPlay?.assists?.[0]?.athlete?.displayName || extractAssistFromText(text),
        })
      }

      // Fallback event extraction from key events when scoringPlays are missing.
      const keyEvents = Array.isArray(data.keyEvents) ? data.keyEvents : []
      for (const evt of keyEvents) {
        const rawType = String(evt?.type?.type || evt?.type?.text || '').toLowerCase()
        let eventType: MatchEvent['type'] | null = null

        if (rawType.includes('goal')) {
          eventType = rawType.includes('own') ? 'own_goal' : 'goal'
        } else if (rawType.includes('yellow')) {
          eventType = 'yellow_card'
        } else if (rawType.includes('red')) {
          eventType = 'red_card'
        } else if (rawType.includes('substitution')) {
          eventType = 'substitution'
        }

        if (!eventType) continue

        const text = String(evt?.text || '')
        const team = inferEventTeam(evt, text)
        if (!team) continue

        const parsedClock = parseClock(evt?.clock?.displayValue, evt?.clock?.value)
        const player =
          evt?.athlete?.displayName ||
          evt?.player?.displayName ||
          evt?.participants?.[0]?.athlete?.displayName ||
          extractPrimaryPlayerFromText(text)

        pushEvent({
          type: eventType,
          minute: parsedClock.minute,
          addedTime: parsedClock.addedTime,
          player,
          team,
          relatedPlayer: eventType === 'goal' || eventType === 'own_goal' ? extractAssistFromText(text) : undefined,
        })
      }
      
      // Extract lineups
      const homeLineup = data.rosters?.find((r: { homeAway: string }) => r.homeAway === 'home')?.roster || []
      const awayLineup = data.rosters?.find((r: { homeAway: string }) => r.homeAway === 'away')?.roster || []
      
      // Extract stats
      const boxscore = data.boxscore || {}
      const stats = {
        possession: [50, 50] as [number, number],
        shots: [0, 0] as [number, number],
        shotsOnTarget: [0, 0] as [number, number],
        corners: [0, 0] as [number, number],
        fouls: [0, 0] as [number, number],
      }
      
      if (boxscore.teams) {
        for (const team of boxscore.teams) {
          const isHome = team.homeAway === 'home'
          const idx = isHome ? 0 : 1
          for (const stat of team.statistics || []) {
            const name = stat.name?.toLowerCase() || stat.label?.toLowerCase() || ''
            const value = parseInt(stat.displayValue || stat.value) || 0
            if (name.includes('possession')) stats.possession[idx] = value
            else if (name.includes('shots on target') || name === 'shotsontarget') stats.shotsOnTarget[idx] = value
            else if (name === 'shots' || name === 'totalshots') stats.shots[idx] = value
            else if (name.includes('corner')) stats.corners[idx] = value
            else if (name.includes('foul')) stats.fouls[idx] = value
          }
        }
      }
      
      // Extract commentary
      const commentary: { minute: number; text: string }[] = []
      const playFeed = Array.isArray(data.plays) && data.plays.length > 0
        ? data.plays
        : Array.isArray(data.keyEvents)
          ? data.keyEvents
          : []
      for (const play of playFeed) {
        if (play.text) {
          const parsedClock = parseClock(play.clock?.displayValue, play.clock?.value)
          commentary.push({
            minute: parsedClock.minute,
            text: play.text,
          })
        }
      }
      
      return {
        id: matchId,
        source: 'espn',
        sourceDetail: 'ESPN soccer summary endpoint',
        generatedAt: new Date().toISOString(),
        home_team: homeTeam.team?.displayName || homeTeam.team?.name || '',
        away_team: awayTeam.team?.displayName || awayTeam.team?.name || '',
        home_score: status !== 'scheduled' ? parseInt(homeTeam.score || '0') : null,
        away_score: status !== 'scheduled' ? parseInt(awayTeam.score || '0') : null,
        status,
        minute,
        venue: data.gameInfo?.venue?.fullName || competition.venue?.fullName,
        attendance: data.gameInfo?.attendance || competition.attendance,
        capacity: data.gameInfo?.venue?.capacity,
        date: competition.date || data.header?.competitions?.[0]?.date || '',
        league: data.header?.league?.name || league,
        leagueId: resolvedLeagueId,
        referee: data.gameInfo?.officials?.[0]?.fullName,
        refereeCountry: data.gameInfo?.officials?.[0]?.nationality,
        events,
        lineups: {
          home: homeLineup.map((p: { athlete?: { displayName?: string }; position?: { abbreviation?: string }; jersey?: string }) => ({
            name: p.athlete?.displayName || 'Unknown',
            position: p.position?.abbreviation,
            jersey: p.jersey ? parseInt(p.jersey) : undefined,
          })),
          away: awayLineup.map((p: { athlete?: { displayName?: string }; position?: { abbreviation?: string }; jersey?: string }) => ({
            name: p.athlete?.displayName || 'Unknown',
            position: p.position?.abbreviation,
            jersey: p.jersey ? parseInt(p.jersey) : undefined,
          })),
          homeFormation: data.rosters?.find((r: { homeAway: string }) => r.homeAway === 'home')?.formation,
          awayFormation: data.rosters?.find((r: { homeAway: string }) => r.homeAway === 'away')?.formation,
        },
        stats,
        commentary: commentary.slice(-50), // Last 50 commentary items
      }
    } catch (e) {
      console.error(`Failed to fetch from ESPN ${league}:`, e)
      continue
    }
  }
  
  return null
}

async function fetchFromFotMob(matchId: string): Promise<MatchDetailsResponse | null> {
  try {
    const res = await fetch(`https://www.fotmob.com/api/matchDetails?matchId=${matchId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.fotmob.com/',
      },
      next: { revalidate: 30 },
    })
    
    if (!res.ok) return null
    
    const data = await res.json()
    if (!data.general) return null
    
    const general = data.general
    const header = data.header || {}
    const content = data.content || {}
    
    // Determine status
    let status = 'scheduled'
    if (general.finished || general.matchEnded) {
      status = 'finished'
    } else if (general.started) {
      status = 'live'
    }
    
    // Extract events
    const events: MatchEvent[] = []
    const matchEvents = content.matchFacts?.events?.events || []
    
    for (const evt of matchEvents) {
      const evtType = evt.type?.toLowerCase() || ''
      let type = 'goal'
      
      if (evtType === 'goal' || evtType === 'penaltygoal') {
        type = 'goal'
      } else if (evtType === 'owngoal') {
        type = 'own_goal'
      } else if (evtType === 'yellowcard') {
        type = 'yellow_card'
      } else if (evtType === 'redcard' || evtType === 'secondyellow') {
        type = 'red_card'
      } else if (evtType === 'substitution') {
        type = 'substitution'
      } else {
        continue
      }
      
      events.push({
        type,
        minute: evt.time || 0,
        addedTime: evt.overloadTime,
        player: evt.player?.name || evt.nameStr || 'Unknown',
        team: evt.isHome ? 'home' : 'away',
        relatedPlayer: evt.assistStr || evt.swap?.name,
      })
    }
    
    // Extract stats
    const statsData = content.stats?.Ede || []
    const stats = {
      possession: [50, 50] as [number, number],
      shots: [0, 0] as [number, number],
      shotsOnTarget: [0, 0] as [number, number],
      corners: [0, 0] as [number, number],
      fouls: [0, 0] as [number, number],
    }
    
    for (const section of statsData) {
      for (const stat of section.stats || []) {
        const title = stat.title?.toLowerCase() || ''
        const home = parseInt(stat.stats?.[0]) || 0
        const away = parseInt(stat.stats?.[1]) || 0
        
        if (title.includes('possession')) {
          stats.possession = [home, away]
        } else if (title === 'shots on target') {
          stats.shotsOnTarget = [home, away]
        } else if (title === 'total shots') {
          stats.shots = [home, away]
        } else if (title.includes('corner')) {
          stats.corners = [home, away]
        } else if (title.includes('foul')) {
          stats.fouls = [home, away]
        }
      }
    }
    
    // Extract lineups
    const lineupData = content.lineup || {}
    const homeTeamId = Number(general.homeTeam?.id || header.teams?.[0]?.id)
    const awayTeamId = Number(general.awayTeam?.id || header.teams?.[1]?.id)

    const rawShots = content.shotmap?.shots || content.shotmap?.shotsData || content.shotMap?.shots || []
    const shotmap: ShotMapPoint[] = Array.isArray(rawShots)
      ? rawShots
          .map((shot: FotMobShot) => {
            const x = normalizeShotCoordinate(shot?.x ?? shot?.X ?? shot?.position?.x, 'x')
            const y = normalizeShotCoordinate(shot?.y ?? shot?.Y ?? shot?.position?.y, 'y')
            if (x === null || y === null) return null

            const isHomeShot = typeof shot?.isHome === 'boolean'
              ? shot.isHome
              : Number(shot?.teamId) === homeTeamId
                ? true
                : Number(shot?.teamId) === awayTeamId
                  ? false
                  : true

            const isGoal = Boolean(
              shot?.isGoal ||
              shot?.eventType === 'Goal' ||
              shot?.eventType === 'goal'
            )

            return {
              x,
              y,
              team: isHomeShot ? 'home' : 'away',
              expectedGoals: Number(shot?.expectedGoals ?? shot?.xG ?? shot?.expectedGoal) || undefined,
              isGoal,
              minute: Number(shot?.min ?? shot?.minute ?? shot?.time) || undefined,
              player: shot?.playerName || shot?.player?.name || undefined,
            } as ShotMapPoint
          })
          .filter(Boolean)
      : []
    
    return {
      id: matchId,
      source: 'fotmob',
      sourceDetail: 'FotMob match details endpoint',
      generatedAt: new Date().toISOString(),
      home_team: general.homeTeam?.name || header.teams?.[0]?.name || '',
      away_team: general.awayTeam?.name || header.teams?.[1]?.name || '',
      home_score: header.teams?.[0]?.score ?? null,
      away_score: header.teams?.[1]?.score ?? null,
      status,
      // FotMob provides matchTime as current minute when match is live
      // If matchTimeUTCDate exists, the match hasn't started yet (scheduled)
      minute: general.started && !general.finished ? general.matchTime : undefined,
      venue: general.venue?.name,
      date: general.matchTimeUTCDate || '',
      league: general.leagueName || '',
      leagueId: general.leagueId?.toString(),
      referee: content.matchFacts?.infoBox?.Referee?.text,
      refereeCountry: content.matchFacts?.infoBox?.Referee?.country,
      attendance: content.matchFacts?.infoBox?.Attendance ? parseInt(String(content.matchFacts.infoBox.Attendance.text || '0').replace(/[^0-9]/g, '')) || undefined : undefined,
      capacity: general.venue?.capacity,
      events,
      lineups: {
        home: (lineupData.homeTeam?.starters || []).map((p: { name?: string; positionStringShort?: string; shirt?: number }) => ({
          name: p.name || 'Unknown',
          position: p.positionStringShort,
          jersey: p.shirt,
        })),
        away: (lineupData.awayTeam?.starters || []).map((p: { name?: string; positionStringShort?: string; shirt?: number }) => ({
          name: p.name || 'Unknown',
          position: p.positionStringShort,
          jersey: p.shirt,
        })),
        homeFormation: lineupData.homeTeam?.formation,
        awayFormation: lineupData.awayTeam?.formation,
      },
      stats,
      shotmap,
      commentary: (content.matchFacts?.highlights?.text || []).map((item: { text?: string; time?: number }) => ({
        minute: item.time || 0,
        text: item.text || '',
      })),
    }
  } catch (e) {
    console.error('FotMob fetch failed:', e)
    return null
  }
}

async function fetchBackendPrediction(homeTeam: string, awayTeam: string, leagueId?: string): Promise<PredictionData | null> {
  if (!homeTeam || !awayTeam) return null

  try {
    const res = await fetch(`${BACKEND_URL}/api/predict/unified`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        home_team: homeTeam,
        away_team: awayTeam,
        league: leagueId,
      }),
      cache: 'no-store',
    })

    if (!res.ok) return null

    const data = await res.json()
    const confidencePct = Math.round(data.confidence ?? 0)
    const homeWin = Number(data.probabilities?.home_win)
    const draw = Number(data.probabilities?.draw)
    const awayWin = Number(data.probabilities?.away_win)

    if (![homeWin, draw, awayWin].every(Number.isFinite)) {
      return null
    }

    return {
      home_win: homeWin / 100,
      draw: draw / 100,
      away_win: awayWin / 100,
      predicted_score: {
        home: data.predicted_home_goals ?? 0,
        away: data.predicted_away_goals ?? 0,
      },
      confidence: confidencePct,
      total_goals: Number.isFinite(Number(data.predicted_home_goals)) && Number.isFinite(Number(data.predicted_away_goals))
        ? Number(data.predicted_home_goals) + Number(data.predicted_away_goals)
        : undefined,
      model_version: data.model_used ?? undefined,
      confidence_band: confidencePct >= 70 ? 'High' : confidencePct >= 55 ? 'Medium' : 'Low',
    }
  } catch (error) {
    console.error('Backend prediction fetch failed:', error)
    return null
  }
}

// Fetch only real H2H data from ESPN scoreboards.
async function fetchH2H(homeTeam: string, awayTeam: string, leagueId?: string): Promise<H2HData | null> {
  try {
    const extraLeagues = ['uefa.champions', 'uefa.europa']
    const leagues = Array.from(
      new Set(
        leagueId
          ? [leagueId, ...extraLeagues]
          : LEAGUE_ENDPOINTS
      )
    )

    const now = new Date()
    const formatDate = (date: Date) =>
      `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`

    const seenIds = new Set<string>()
    const matches: H2HMatch[] = []

    for (const league of leagues) {
      try {
        for (let yearOffset = 0; yearOffset < 3; yearOffset++) {
          const chunkEnd = new Date(now)
          chunkEnd.setFullYear(chunkEnd.getFullYear() - yearOffset)
          const chunkStart = new Date(chunkEnd)
          chunkStart.setFullYear(chunkStart.getFullYear() - 1)

          const res = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${formatDate(chunkStart)}-${formatDate(chunkEnd)}&limit=300`,
            {
              headers: {
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
              next: { revalidate: 3600 },
            }
          )
          if (!res.ok) continue

          const data = await res.json()
          for (const event of data.events || []) {
            const competition = event.competitions?.[0]
            if (!competition) continue

            const statusType = competition.status?.type?.name || ''
            if (!statusType.includes('FINAL') && !statusType.includes('FULL_TIME')) continue

            const home = competition.competitors?.find((c: { homeAway?: string }) => c.homeAway === 'home')
            const away = competition.competitors?.find((c: { homeAway?: string }) => c.homeAway === 'away')
            if (!home || !away) continue

            const hName = home.team?.displayName || home.team?.name || ''
            const aName = away.team?.displayName || away.team?.name || ''

            const isDirectMatch =
              (teamNamesMatch(hName, homeTeam) && teamNamesMatch(aName, awayTeam)) ||
              (teamNamesMatch(hName, awayTeam) && teamNamesMatch(aName, homeTeam))

            if (!isDirectMatch) continue

            const eventId = String(event.id || `${event.date}-${hName}-${aName}`)
            if (seenIds.has(eventId)) continue
            seenIds.add(eventId)

            matches.push({
              date: event.date || '',
              homeTeam: hName,
              awayTeam: aName,
              homeScore: parseInt(home.score || '0', 10),
              awayScore: parseInt(away.score || '0', 10),
              competition: league,
            })
          }
        }
      } catch {
        continue
      }
    }

    if (matches.length === 0) {
      return null
    }

    const sortedMatches = matches.sort((a, b) => b.date.localeCompare(a.date))
    let homeWins = 0
    let awayWins = 0
    let draws = 0

    for (const m of sortedMatches) {
      const homeIsReferenceHome = teamNamesMatch(m.homeTeam, homeTeam)
      if (m.homeScore === m.awayScore) {
        draws += 1
        continue
      }
      if (homeIsReferenceHome) {
        if (m.homeScore > m.awayScore) homeWins += 1
        else awayWins += 1
      } else {
        if (m.homeScore > m.awayScore) awayWins += 1
        else homeWins += 1
      }
    }

    return {
      homeWins,
      draws,
      awayWins,
      recentMatches: sortedMatches.slice(0, 8),
    }
  } catch (e) {
    console.error('H2H fetch failed:', e)
    return null
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: matchId } = await params
  const leagueId = request.nextUrl.searchParams.get('league') || undefined
  
  // Try ESPN first
  let matchData = await fetchFromESPN(matchId, leagueId)
  
  // If ESPN fails, try FotMob
  if (!matchData) {
    matchData = await fetchFromFotMob(matchId)
  }
  
  if (!matchData) {
    return NextResponse.json(
      { error: 'Match not found', matchId, leagueId },
      {
        status: 404,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    )
  }
  
  // Fetch additional data: H2H and predictions
  const [h2h, backendPrediction] = await Promise.all([
    fetchH2H(matchData.home_team, matchData.away_team, matchData.leagueId),
    fetchBackendPrediction(matchData.home_team, matchData.away_team, matchData.leagueId)
  ])
  
  // Add H2H and prediction to response
  matchData.h2h = h2h || {
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    recentMatches: []
  }
  if (backendPrediction) {
    matchData.prediction = backendPrediction
  }
  
  return NextResponse.json(matchData, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
