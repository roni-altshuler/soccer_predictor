import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

interface HeadToHeadRequest {
  league: string
  home_team: string
  away_team: string
}

const POLICY_MIN_CONFIDENCE = 55
const POLICY_MIN_EDGE = 12

// Per-league Dixon-Coles calibrated parameters — loaded from shared JSON
const KEY_TO_H2H_LEAGUE: Record<string, string> = {
  'eng.1': 'premier_league', 'esp.1': 'la_liga', 'ger.1': 'bundesliga',
  'ita.1': 'serie_a', 'fra.1': 'ligue_1', 'usa.1': 'mls',
  'ned.1': 'eredivisie', 'por.1': 'primeira_liga',
  'uefa.champions': 'champions_league', 'uefa.europa': 'europa_league',
  'uefa.europa.conf': 'conference_league', 'fifa.world': 'world_cup',
  'uefa.euro': 'euro', 'conmebol.america': 'copa_america',
}

const PARAM_DEFAULTS = { avg_goals: 1.35, home_adv: 0.25, rho: -0.12, draw_rate: 0.24 }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sanitizeH2HLeagueParams(lp: Record<string, unknown> | null | undefined): { avg_goals: number; home_adv: number; rho: number; draw_rate: number } {
  return {
    avg_goals: clamp(Number(lp?.avg_goals ?? PARAM_DEFAULTS.avg_goals), 0.75, 2.25),
    home_adv: clamp(Number(lp?.home_adv ?? PARAM_DEFAULTS.home_adv), 0.05, 0.45),
    rho: clamp(Number(lp?.rho ?? PARAM_DEFAULTS.rho), -0.35, 0.15),
    draw_rate: clamp(Number(lp?.draw_rate ?? PARAM_DEFAULTS.draw_rate), 0.08, 0.38),
  }
}

function loadH2HLeagueParams(): Record<string, { avg_goals: number; home_adv: number; rho: number; draw_rate: number }> {
  try {
    const paramsFile = path.join(process.cwd(), 'backend', 'data', 'league_params.json')
    if (fs.existsSync(paramsFile)) {
      const data = JSON.parse(fs.readFileSync(paramsFile, 'utf-8'))
      const result: Record<string, { avg_goals: number; home_adv: number; rho: number; draw_rate: number }> = {}
      for (const [key, lp] of Object.entries(data.leagues || {}) as [string, Record<string, unknown>][]) {
        const name = KEY_TO_H2H_LEAGUE[key]
        if (name) {
          result[name] = sanitizeH2HLeagueParams(lp)
        }
      }
      if (Object.keys(result).length > 0) return result
    }
  } catch { /* fall through */ }
  return {
    'premier_league': { avg_goals: 1.42, home_adv: 0.28, rho: -0.13, draw_rate: 0.23 },
    'la_liga':        { avg_goals: 1.30, home_adv: 0.30, rho: -0.12, draw_rate: 0.24 },
    'bundesliga':     { avg_goals: 1.55, home_adv: 0.25, rho: -0.11, draw_rate: 0.22 },
    'serie_a':        { avg_goals: 1.32, home_adv: 0.26, rho: -0.14, draw_rate: 0.27 },
    'ligue_1':        { avg_goals: 1.30, home_adv: 0.27, rho: -0.12, draw_rate: 0.24 },
    'mls':            { avg_goals: 1.45, home_adv: 0.20, rho: -0.10, draw_rate: 0.22 },
    'eredivisie':     { avg_goals: 1.45, home_adv: 0.24, rho: -0.11, draw_rate: 0.21 },
    'primeira_liga':  { avg_goals: 1.28, home_adv: 0.27, rho: -0.13, draw_rate: 0.25 },
    'champions_league': { avg_goals: 1.50, home_adv: 0.22, rho: -0.12, draw_rate: 0.20 },
    'europa_league':  { avg_goals: 1.42, home_adv: 0.20, rho: -0.11, draw_rate: 0.22 },
    'conference_league': { avg_goals: 1.38, home_adv: 0.20, rho: -0.10, draw_rate: 0.23 },
    'world_cup':      { avg_goals: 1.30, home_adv: 0.15, rho: -0.09, draw_rate: 0.18 },
    'euro':           { avg_goals: 1.28, home_adv: 0.12, rho: -0.09, draw_rate: 0.22 },
    'copa_america':   { avg_goals: 1.26, home_adv: 0.12, rho: -0.09, draw_rate: 0.20 },
  }
}

let _h2hParamsCache: ReturnType<typeof loadH2HLeagueParams> | null = null
function getH2HLeagueParams() {
  if (!_h2hParamsCache) _h2hParamsCache = loadH2HLeagueParams()
  return _h2hParamsCache
}

const DEFAULT_PARAMS = PARAM_DEFAULTS

// Team ELO ratings (top teams, approximated from historical data — Jan 2026)
const TEAM_ELO: Record<string, number> = {
  'manchester city': 1780, 'liverpool': 1750, 'arsenal': 1730, 'chelsea': 1680,
  'manchester utd': 1660, 'tottenham': 1650, 'newcastle utd': 1620, 'aston villa': 1600,
  'brighton': 1580, 'west ham': 1560, 'nottingham forest': 1560, 'bournemouth': 1540,
  'fulham': 1530, 'brentford': 1520, 'crystal palace': 1510, 'everton': 1500,
  'wolves': 1500, 'leicester city': 1480, 'ipswich town': 1460, 'southampton': 1440,
  'real madrid': 1800, 'barcelona': 1770, 'atlético madrid': 1700, 'athletic bilbao': 1640,
  'real betis': 1610, 'sevilla': 1620, 'real sociedad': 1600, 'villarreal': 1590,
  'girona': 1560, 'valencia': 1540, 'celta vigo': 1520, 'osasuna': 1510,
  'inter': 1720, 'napoli': 1700, 'juventus': 1690, 'milan': 1680,
  'atalanta': 1640, 'roma': 1620, 'lazio': 1600, 'fiorentina': 1580,
  'bayern munich': 1780, 'dortmund': 1680, 'rb leipzig': 1660, 'leverkusen': 1700,
  'stuttgart': 1600, 'eintracht frankfurt': 1580,
  'paris s-g': 1750, 'marseille': 1600, 'monaco': 1580, 'lille': 1560, 'lyon': 1570,
  'inter miami': 1580, 'la galaxy': 1560, 'lafc': 1550, 'columbus crew': 1540,
  'psv': 1620, 'ajax': 1600, 'feyenoord': 1590, 'az alkmaar': 1550,
  'sporting cp': 1640, 'benfica': 1630, 'porto': 1620, 'braga': 1560,
}

function getElo(name: string): number {
  const n = name.toLowerCase()
  // Try exact match first, then partial
  if (TEAM_ELO[n]) return TEAM_ELO[n]
  for (const [key, val] of Object.entries(TEAM_ELO)) {
    if (n.includes(key) || key.includes(n)) return val
    const last = n.split(' ').pop() || ''
    if (last.length > 3 && key.includes(last)) return val
  }
  return 1500
}

/** Fetch recent head-to-head results between two teams from ESPN */
async function fetchH2HHistory(homeTeam: string, awayTeam: string, espnLeague: string): Promise<Array<{ date: string; home: string; away: string; homeScore: number; awayScore: number }>> {
  const results: Array<{ date: string; home: string; away: string; homeScore: number; awayScore: number }> = []
  const espnMap: Record<string, string> = {
    premier_league: 'eng.1', la_liga: 'esp.1', bundesliga: 'ger.1',
    serie_a: 'ita.1', ligue_1: 'fra.1', mls: 'usa.1',
    eredivisie: 'ned.1', primeira_liga: 'por.1',
    champions_league: 'uefa.champions', europa_league: 'uefa.europa',
    conference_league: 'uefa.europa.conf',
    world_cup: 'fifa.world', euro: 'uefa.euro', copa_america: 'conmebol.america',
  }
  const espnId = espnMap[espnLeague] || 'eng.1'
  try {
    // Fetch last 90 days of matches
    const now = new Date()
    const past = new Date(now); past.setDate(past.getDate() - 365)
    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/scoreboard?dates=${fmt(past)}-${fmt(now)}&limit=300`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 3600 } })
    if (!res.ok) return results
    const data = await res.json()
    const homeLower = homeTeam.toLowerCase()
    const awayLower = awayTeam.toLowerCase()
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0]
      const status = comp?.status?.type?.name || ''
      if (!status.includes('FINAL') && !status.includes('FULL_TIME')) continue
      const hc = comp.competitors?.find((c: any) => c.homeAway === 'home')
      const ac = comp.competitors?.find((c: any) => c.homeAway === 'away')
      if (!hc || !ac) continue
      const hName = (hc.team?.displayName || '').toLowerCase()
      const aName = (ac.team?.displayName || '').toLowerCase()
      const hLast = hName.split(' ').pop() || ''
      const aLast = aName.split(' ').pop() || ''
      const matchesHome = hName.includes(homeLower) || homeLower.includes(hLast) || hName.includes(awayLower) || awayLower.includes(hLast)
      const matchesAway = aName.includes(awayLower) || awayLower.includes(aLast) || aName.includes(homeLower) || homeLower.includes(aLast)
      if (matchesHome && matchesAway) {
        results.push({
          date: event.date?.split('T')[0] || '',
          home: hc.team?.displayName || hName,
          away: ac.team?.displayName || aName,
          homeScore: parseInt(hc.score || '0'),
          awayScore: parseInt(ac.score || '0'),
        })
      }
    }
  } catch { /* no-op */ }
  return results
}

export async function POST(request: NextRequest) {
  try {
    const body: HeadToHeadRequest = await request.json()
    const { league, home_team, away_team } = body
    
    if (!league || !home_team || !away_team) {
      return NextResponse.json(
        { error: 'Missing required fields: league, home_team, away_team' },
        { status: 400 }
      )
    }

    const leagueKey = league.toLowerCase().replace(/\s+/g, '_')
    const params = getH2HLeagueParams()[leagueKey] || DEFAULT_PARAMS

    // Fetch H2H history from ESPN
    const h2hHistory = await fetchH2HHistory(home_team, away_team, leagueKey)

    // Try backend first
    let backendUsed = false
    let homeElo = getElo(home_team)
    let awayElo = getElo(away_team)

    try {
      const response = await fetch(`${BACKEND_URL}/api/predict/unified`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home_team, away_team, league }),
        signal: AbortSignal.timeout(3000),
      })
      if (response.ok) {
        const pred = await response.json()
        homeElo = pred.home_elo || homeElo
        awayElo = pred.away_elo || awayElo
        backendUsed = true
      }
    } catch { /* backend unavailable */ }

    // Per-league Dixon-Coles prediction
    const homeAdvElo = params.home_adv * 260  // scale to ELO points
    const eloDiff = (homeElo + homeAdvElo) - awayElo
    const homeWinRaw = 1 / (1 + Math.pow(10, -eloDiff / 400))
    const eloCloseness = Math.exp(-(eloDiff * eloDiff) / (2 * 250 * 250))
    const drawProb = Math.max(0.08, Math.min(0.38, params.draw_rate * (0.6 + 0.8 * eloCloseness)))
    const winPool = 1 - drawProb
    const homeWin = winPool * homeWinRaw
    const awayWin = winPool * (1 - homeWinRaw)

    // Goal prediction using Dixon-Coles inspired model
    const homeAttack = Math.max(0.5, 1.0 + (homeElo - 1500) / 600)
    const awayAttack = Math.max(0.5, 1.0 + (awayElo - 1500) / 600)
    const homeDefWeak = Math.max(0.4, 1.0 - (homeElo - 1500) / 900)
    const awayDefWeak = Math.max(0.4, 1.0 - (awayElo - 1500) / 900)
    const homeXG = homeAttack * awayDefWeak * params.avg_goals + params.home_adv
    const awayXG = awayAttack * homeDefWeak * params.avg_goals
    const confidence = Math.min(85, Math.max(30, 50 + Math.abs(eloDiff) / 10))
    const maxProb = Math.max(homeWin, drawProb, awayWin)
    const edgePct = (maxProb - (1 / 3)) * 100
    const thresholdQualified = confidence >= POLICY_MIN_CONFIDENCE && edgePct >= POLICY_MIN_EDGE

    return NextResponse.json({
      success: true,
      home_team,
      away_team,
      league: leagueKey,
      model: `Dixon-Coles (${leagueKey})`,
      predictions: {
        home_win: Math.round(homeWin * 1000) / 1000,
        draw: Math.round(drawProb * 1000) / 1000,
        away_win: Math.round(awayWin * 1000) / 1000,
      },
      predicted_home_goals: Math.round(Math.max(0.3, Math.min(5, homeXG)) * 10) / 10,
      predicted_away_goals: Math.round(Math.max(0.3, Math.min(5, awayXG)) * 10) / 10,
      confidence,
      verdict: {
        edge_pct: Math.round(edgePct * 10) / 10,
        threshold_qualified: thresholdQualified,
        recommended_action: thresholdQualified ? 'play' : 'pass',
        recommended_pick: thresholdQualified
          ? (homeWin >= drawProb && homeWin >= awayWin ? home_team : awayWin >= homeWin && awayWin >= drawProb ? away_team : 'Draw')
          : null,
        policy: {
          min_confidence: POLICY_MIN_CONFIDENCE,
          min_edge: POLICY_MIN_EDGE,
        },
      },
      ratings: {
        home_elo: Math.round(homeElo),
        away_elo: Math.round(awayElo),
      },
      league_params: {
        avg_goals: params.avg_goals,
        home_adv: params.home_adv,
        draw_rate: params.draw_rate,
        rho: params.rho,
      },
      head_to_head: h2hHistory.slice(0, 10),
      backend_used: backendUsed,
    })
  } catch (error) {
    console.error('Error predicting match:', error)
    return NextResponse.json(
      { error: 'Failed to predict match', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
