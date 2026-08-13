import fs from 'fs'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { getLeagueAccent, ALL_COMPETITION_IDS } from '@/lib/leagueAccents'
import { ESPN_SITE } from '@/lib/espnHost'

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
  provider?: 'espn' | 'fotmob'
  home_crest_url?: string | null
  away_crest_url?: string | null
  /** Committed model prediction (joined from backend/data/predictions). */
  ai_home_prob?: number
  ai_draw_prob?: number
  ai_away_prob?: number
  ai_confidence?: number
  predicted_scoreline?: string
}

interface ESPNCompetitor {
  homeAway?: string
  score?: string | number
  team?: {
    displayName?: string
    name?: string
    logo?: string
  }
}

/* ── committed-prediction join ──
 * The prediction pipeline commits PredictionRecord JSON under
 * backend/data/predictions/predictions_YYYY-MM.json (the same files the
 * /api/v1/tracking routes read). We join them onto the day's fixtures by
 * ESPN match id first, then by normalised team names + date — and never
 * synthesise probabilities when no committed record exists.
 */

interface CommittedPrediction {
  match_id: string | number
  home_team: string
  away_team: string
  match_date: string
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_scoreline?: string | null
  confidence?: number
}

function normalizeTeamKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function loadCommittedPredictions(targetDate: Date): CommittedPrediction[] {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  // Only the requested month ± 1 — records are bucketed by match month.
  const months = new Set<string>()
  for (const offset of [-1, 0, 1]) {
    const d = new Date(targetDate)
    d.setUTCMonth(d.getUTCMonth() + offset)
    months.add(monthKey(d))
  }

  const out: CommittedPrediction[] = []
  for (const month of months) {
    const file = path.join(dataDir, `predictions_${month}.json`)
    if (!fs.existsSync(file)) continue
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        predictions?: CommittedPrediction[]
      }
      if (Array.isArray(data.predictions)) out.push(...data.predictions)
    } catch {
      /* skip unreadable month file */
    }
  }
  return out
}

function attachPredictions(matches: Match[], preds: CommittedPrediction[]): void {
  if (preds.length === 0) return
  const byId = new Map<string, CommittedPrediction>()
  const byTeams = new Map<string, CommittedPrediction>()
  for (const p of preds) {
    byId.set(String(p.match_id), p)
    byTeams.set(
      `${p.match_date}|${normalizeTeamKey(p.home_team)}|${normalizeTeamKey(p.away_team)}`,
      p
    )
  }

  for (const m of matches) {
    const dateKey = m.time ? m.time.slice(0, 10) : ''
    const p =
      byId.get(String(m.match_id)) ??
      byTeams.get(`${dateKey}|${normalizeTeamKey(m.home_team)}|${normalizeTeamKey(m.away_team)}`)
    if (!p) continue

    const h = Number(p.predicted_home_win)
    const d = Number(p.predicted_draw)
    const a = Number(p.predicted_away_win)
    if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a) || h + d + a <= 0) {
      continue
    }
    m.ai_home_prob = h
    m.ai_draw_prob = d
    m.ai_away_prob = a
    if (typeof p.predicted_scoreline === 'string' && p.predicted_scoreline.length > 0) {
      m.predicted_scoreline = p.predicted_scoreline
    }
    const conf = Number(p.confidence)
    if (Number.isFinite(conf) && conf > 0) {
      m.ai_confidence = conf > 1 ? conf / 100 : conf
    }
  }
}

// Everything the site covers: the six leagues and the fourteen knockout
// competitions. "Today" that shows five leagues is not today.
//
// This was cut back to Wave A once because the other competitions were still
// getting an "AI" scoreline chip from a model with no measured record in them.
// That was the right problem and the wrong fix — the chip comes from
// `attachPredictions`, which only writes one when a COMMITTED prediction
// exists for that fixture, so a competition the model has not forecast simply
// shows a fixture and no number. Narrowing the fixture list to fix a
// labelling bug cost the reader thirteen competitions.
//
// ESPN's scoreboard spells the Conference League differently from the forecast
// layer. Asking for `uefa.conference` returns 404 and the competition silently
// never appears.
//
// Declared BEFORE the list that reads it, and that ordering is load-bearing:
// `MENS_ESPN_LEAGUES` runs its `.map` at module scope, so a `const` defined
// below is still in the temporal dead zone when the callback reaches it. It
// throws `ReferenceError: Cannot access 'ESPN_SCOREBOARD_ID' before
// initialization` at import time, which fails `next build` at "Collecting page
// data" rather than at typecheck — TypeScript cannot prove when a callback
// runs, so it raises nothing.
const ESPN_SCOREBOARD_ID: Record<string, string> = {
  'uefa.conference': 'uefa.europa.conf',
}

const MENS_ESPN_LEAGUES = ALL_COMPETITION_IDS.map((id) => ({
  id: ESPN_SCOREBOARD_ID[id] ?? id,
  name: getLeagueAccent(id).displayName,
}))

// ESPN league IDs for women's competitions. The warehouse + unified women's
// model are trained on this set; see backend/services/data/espn_loader.py.
const WOMENS_ESPN_LEAGUES = [
  { id: 'usa.nwsl', name: 'NWSL' },
  { id: 'eng.w.1', name: "FA Women's Super League" },
  { id: 'uefa.wchampions', name: "UEFA Women's Champions League" },
  { id: 'uefa.weuro', name: "UEFA Women's European Championship" },
  { id: 'fifa.wwc', name: "FIFA Women's World Cup" },
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

async function fetchESPNMatches(targetDate: Date, gender: 'M' | 'F' = 'M'): Promise<Match[]> {
  const allMatches: Match[] = []

  // Convert target date to YYYYMMDD format for ESPN API
  const targetDateStr = `${targetDate.getUTCFullYear()}${String(targetDate.getUTCMonth() + 1).padStart(2, '0')}${String(targetDate.getUTCDate()).padStart(2, '0')}`

  const leaguesToFetch = gender === 'F' ? WOMENS_ESPN_LEAGUES : MENS_ESPN_LEAGUES

  // Fetch all league scoreboards concurrently — sequentially this route
  // took ~20s cold across 12+ leagues.
  const settled = await Promise.allSettled(
    leaguesToFetch.map((league) =>
      fetch(
        `${ESPN_SITE}/${league.id}/scoreboard?dates=${targetDateStr}`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          next: { revalidate: 60 },
        }
      ).then(async (response) => ({
        league,
        data: response.ok ? await response.json() : null,
      }))
    )
  )

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      console.error('Error fetching league scoreboard from ESPN:', outcome.reason)
      continue
    }
    const { league, data } = outcome.value
    if (!data) continue
    try {

      for (const event of data.events || []) {
        const competition = event.competitions?.[0]
        if (!competition) continue
        
        const competitors = (competition.competitors || []) as ESPNCompetitor[]
        const homeTeam = competitors.find((c) => c.homeAway === 'home')
        const awayTeam = competitors.find((c) => c.homeAway === 'away')
        
        if (!homeTeam || !awayTeam) continue
        
        const statusType = competition.status?.type?.name || 'STATUS_SCHEDULED'
        let status = 'upcoming'
        let minute: number | string | undefined = undefined
        
        if (statusType.startsWith('STATUS_FINAL') || statusType === 'STATUS_FULL_TIME') {
          status = 'completed'
        } else if (statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME' || statusType === 'STATUS_FIRST_HALF' || statusType === 'STATUS_SECOND_HALF' || statusType === 'STATUS_OVERTIME' || statusType === 'STATUS_SHOOTOUT') {
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
          home_score: status !== 'upcoming' ? parseInt(String(homeTeam.score ?? '0'), 10) : null,
          away_score: status !== 'upcoming' ? parseInt(String(awayTeam.score ?? '0'), 10) : null,
          time: event.date || '',
          status,
          league: league.name,
          leagueId: league.id,
          match_id: event.id,
          venue: competition.venue?.fullName,
          minute,
          provider: 'espn',
          home_crest_url: homeTeam.team?.logo || null,
          away_crest_url: awayTeam.team?.logo || null,
        })
      }
    } catch (error) {
      console.error(`Error parsing ${league.name} scoreboard from ESPN:`, error)
    }
  }

  return allMatches
}

async function fetchFotMobMatches(targetDate: Date): Promise<Match[]> {
  const matches: Match[] = []
  const targetDateStr = `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, '0')}-${String(targetDate.getUTCDate()).padStart(2, '0')}`.replace(/-/g, '')
  
  // League name → ESPN competition ID is resolved via the canonical
  // registry (getLeagueAccent handles aliases like 'la liga', 'champions
  // league', etc.). Returns '' for unknown leagues to preserve the
  // previous contract with downstream match-row consumers.
  const resolveLeagueId = (leagueName: string): string => {
    const accent = getLeagueAccent(leagueName)
    return accent.competitionId !== 'unknown' ? accent.competitionId : ''
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
        const leagueId = resolveLeagueId(leagueName)
        
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

          const homeName = match.home?.name || match.home?.shortName || ''
          const awayName = match.away?.name || match.away?.shortName || ''
          if (!homeName || !awayName) continue
          
          matches.push({
            id: String(match.id),
            home_team: homeName,
            away_team: awayName,
            home_score: status !== 'upcoming' ? match.home?.score ?? 0 : null,
            away_score: status !== 'upcoming' ? match.away?.score ?? 0 : null,
            time: match.status?.utcTime || '',
            status,
            league: leagueName,
            leagueId: leagueId,
            match_id: match.id,
            minute,
            provider: 'fotmob',
            home_crest_url: match.home?.id
              ? `https://images.fotmob.com/image_resources/logo/teamlogo/${match.home.id}_small.png`
              : null,
            away_crest_url: match.away?.id
              ? `https://images.fotmob.com/image_resources/logo/teamlogo/${match.away.id}_small.png`
              : null,
          })
        }
      }
    }
  } catch (error) {
    console.error('Error fetching from FotMob:', error)
  }
  
  return matches
}

export async function GET(request: NextRequest) {
  try {
    const requestedDate = resolveRequestedDate(request.nextUrl.searchParams.get('date'))
    const rawGender = request.nextUrl.searchParams.get('gender')
    const gender: 'M' | 'F' = rawGender === 'F' ? 'F' : 'M'

    // Try ESPN first, then FotMob. Never synthesize match rows.
    let source: 'espn' | 'fotmob' | 'none' = 'espn'
    let matches = await fetchESPNMatches(requestedDate, gender)

    // FotMob's coverage is essentially men's-only; only fall back to it for
    // the men's universe. For women's, we trust the ESPN result (even if
    // empty) so the UI shows an honest "no women's matches today" state.
    if (matches.length === 0 && gender === 'M') {
      const fotMobMatches = await fetchFotMobMatches(requestedDate)
      if (fotMobMatches.length > 0) {
        matches = fotMobMatches
        source = 'fotmob'
      } else {
        source = 'none'
      }
    } else if (matches.length === 0) {
      source = 'none'
    }

    // Join committed model predictions (probabilities + predicted scoreline)
    // so fixture rows can render the ProbBar without a second round-trip.
    attachPredictions(matches, loadCommittedPredictions(requestedDate))

    // Categorize matches
    const result = {
      live: matches.filter(m => m.status === 'live'),
      upcoming: matches.filter(m => m.status === 'upcoming'),
      completed: matches.filter(m => m.status === 'completed'),
      leagues: [] as { name: string; matches: Match[] }[],
      source,
      sourceDetail: source === 'espn'
        ? 'ESPN scoreboard endpoint'
        : source === 'fotmob'
          ? 'FotMob matches endpoint'
          : 'No ESPN or FotMob matches found for the requested date',
      requestedDate: requestedDate.toISOString().split('T')[0],
      generatedAt: new Date().toISOString(),
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
      source: 'error',
      sourceDetail: 'ESPN and FotMob match fetch failed',
      requestedDate: request.nextUrl.searchParams.get('date') || null,
      generatedAt: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  }
}
