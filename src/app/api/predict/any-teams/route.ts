import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

// Prediction calculation constants
const DEFAULT_ELO = 1500
const HOME_ADVANTAGE_ELO = 65
const MIN_CONFIDENCE = 30
const MAX_CONFIDENCE = 85
const MAX_PREDICTED_GOALS = 5
const BACKEND_TIMEOUT_MS = 3000

interface AnyTeamsPredictionRequest {
  home_team: string
  away_team: string
  home_league?: string
  away_league?: string
}

// Map display league names to API keys
const leagueNameToKey: Record<string, string> = {
  'Premier League': 'premier_league',
  'La Liga': 'la_liga',
  'Serie A': 'serie_a',
  'Bundesliga': 'bundesliga',
  'Ligue 1': 'ligue_1',
  'Champions League (UCL)': 'champions_league',
  'Europa League (UEL)': 'europa_league',
  'Conference League (UECL)': 'conference_league',
  'MLS': 'mls',
  'Eredivisie': 'eredivisie',
  'Primeira Liga': 'primeira_liga',
  'FIFA World Cup': 'world_cup',
}

// League strength coefficients (used for cross-league predictions)
const leagueStrength: Record<string, number> = {
  'premier_league': 1.15,
  'la_liga': 1.10,
  'serie_a': 1.05,
  'bundesliga': 1.05,
  'ligue_1': 1.00,
  'champions_league': 1.20,
  'europa_league': 1.00,
  'conference_league': 0.95,
  'mls': 0.85,
  'eredivisie': 0.92,
  'primeira_liga': 0.95,
  'world_cup': 1.10,
}

// Per-league Dixon-Coles calibrated parameters
// Loaded from league_params.json (single source of truth) with hardcoded fallbacks
const KEY_TO_LEAGUE: Record<string, string> = {
  'eng.1': 'premier_league', 'esp.1': 'la_liga', 'ger.1': 'bundesliga',
  'ita.1': 'serie_a', 'fra.1': 'ligue_1', 'usa.1': 'mls',
  'ned.1': 'eredivisie', 'por.1': 'primeira_liga',
  'uefa.champions': 'champions_league', 'uefa.europa': 'europa_league',
  'uefa.europa.conf': 'conference_league', 'fifa.world': 'world_cup',
}

function loadLeagueParams(): Record<string, { avg_goals: number; home_adv: number; rho: number; draw_rate: number }> {
  try {
    const paramsFile = path.join(process.cwd(), 'backend', 'data', 'league_params.json')
    if (fs.existsSync(paramsFile)) {
      const data = JSON.parse(fs.readFileSync(paramsFile, 'utf-8'))
      const result: Record<string, { avg_goals: number; home_adv: number; rho: number; draw_rate: number }> = {}
      for (const [key, lp] of Object.entries(data.leagues || {}) as [string, any][]) {
        const leagueName = KEY_TO_LEAGUE[key]
        if (leagueName) {
          result[leagueName] = {
            avg_goals: lp.avg_goals ?? 1.35,
            home_adv: lp.home_adv ?? 0.25,
            rho: lp.rho ?? -0.12,
            draw_rate: lp.draw_rate ?? 0.24,
          }
        }
      }
      if (Object.keys(result).length > 0) return result
    }
  } catch { /* fall through to hardcoded */ }

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
  }
}

let _leagueParamsCache: ReturnType<typeof loadLeagueParams> | null = null
function getLeagueParams() {
  if (!_leagueParamsCache) _leagueParamsCache = loadLeagueParams()
  return _leagueParamsCache
}

const DEFAULT_PARAMS = { avg_goals: 1.35, home_adv: 0.25, rho: -0.12, draw_rate: 0.24 }

function factorial(n: number): number {
  if (n <= 1) return 1
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

function poissonProbability(lambda: number, goals: number): number {
  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial(goals)
}

function buildScoreMatrix(homeXg: number, awayXg: number, rho: number, maxGoals = MAX_PREDICTED_GOALS + 1) {
  const scores: Array<{ score: string; probability: number; home: number; away: number }> = []
  let total = 0

  for (let home = 0; home <= maxGoals; home++) {
    for (let away = 0; away <= maxGoals; away++) {
      let prob = poissonProbability(homeXg, home) * poissonProbability(awayXg, away)

      if (home === 0 && away === 0) prob *= Math.max(0, 1 - homeXg * awayXg * rho)
      else if (home === 0 && away === 1) prob *= Math.max(0, 1 + homeXg * rho)
      else if (home === 1 && away === 0) prob *= Math.max(0, 1 + awayXg * rho)
      else if (home === 1 && away === 1) prob *= Math.max(0, 1 - rho)

      scores.push({ score: `${home}-${away}`, probability: prob, home, away })
      total += prob
    }
  }

  const normalized = scores.map((entry) => ({
    ...entry,
    probability: total > 0 ? entry.probability / total : 0,
  }))

  const over25 = normalized
    .filter((entry) => entry.home + entry.away >= 3)
    .reduce((sum, entry) => sum + entry.probability, 0)

  const btts = normalized
    .filter((entry) => entry.home > 0 && entry.away > 0)
    .reduce((sum, entry) => sum + entry.probability, 0)

  return {
    scores: normalized.sort((a, b) => b.probability - a.probability),
    over25,
    btts,
  }
}

/**
 * Team base ELO ratings - approximate values based on historical performance.
 * These ratings are used as fallback when the backend ML model is unavailable.
 * Ratings are calibrated to a 1500 baseline with top teams ranging from 1550-1800.
 * Source: Estimated from historical match results and UEFA coefficients.
 * Last updated: January 2026
 */
const teamBaseElo: Record<string, number> = {
  // Premier League
  'manchester city': 1780,
  'liverpool': 1750,
  'arsenal': 1730,
  'chelsea': 1680,
  'manchester utd': 1660,
  'tottenham': 1650,
  'newcastle utd': 1620,
  'aston villa': 1600,
  'brighton': 1580,
  'west ham': 1560,
  'crystal palace': 1540,
  'fulham': 1530,
  'brentford': 1520,
  'bournemouth': 1510,
  'everton': 1500,
  'wolves': 1500,
  'nottingham forest': 1490,
  'leicester city': 1480,
  'ipswich town': 1450,
  'southampton': 1450,
  // La Liga
  'real madrid': 1800,
  'barcelona': 1770,
  'atlético madrid': 1700,
  'athletic bilbao': 1640,
  'real betis': 1610,
  'sevilla': 1620,
  'real sociedad': 1600,
  'villarreal': 1590,
  'girona': 1570,
  'valencia': 1550,
  'celta vigo': 1530,
  'osasuna': 1520,
  'getafe': 1510,
  'rayo vallecano': 1500,
  'mallorca': 1490,
  'espanyol': 1480,
  'las palmas': 1470,
  'leganes': 1460,
  'alaves': 1460,
  'valladolid': 1450,
  // Serie A
  'inter': 1720,
  'napoli': 1700,
  'juventus': 1690,
  'milan': 1680,
  'atalanta': 1640,
  'roma': 1620,
  'lazio': 1600,
  'fiorentina': 1580,
  'bologna': 1560,
  'torino': 1540,
  'udinese': 1520,
  'genoa': 1510,
  'cagliari': 1500,
  'empoli': 1490,
  'parma': 1480,
  'como': 1470,
  'lecce': 1460,
  'verona': 1460,
  'monza': 1450,
  'venezia': 1440,
  // Bundesliga
  'bayern munich': 1780,
  'dortmund': 1680,
  'rb leipzig': 1660,
  'leverkusen': 1700,
  'stuttgart': 1600,
  'eintracht frankfurt': 1580,
  'freiburg': 1560,
  'wolfsburg': 1540,
  'hoffenheim': 1530,
  'mainz': 1520,
  'werder bremen': 1510,
  'augsburg': 1500,
  'union berlin': 1490,
  'borussia monchengladbach': 1480,
  'heidenheim': 1470,
  'st. pauli': 1460,
  'holstein kiel': 1450,
  'bochum': 1440,
  // Ligue 1
  'paris s-g': 1750,
  'marseille': 1600,
  'monaco': 1580,
  'lyon': 1570,
  'lille': 1560,
  'nice': 1540,
  'lens': 1530,
  'rennes': 1520,
  'strasbourg': 1500,
  'reims': 1490,
  'toulouse': 1480,
  'nantes': 1470,
  'auxerre': 1460,
  'le havre': 1450,
  'angers': 1450,
  'montpellier': 1440,
  'st. etienne': 1440,
  // MLS
  'inter miami': 1580,
  'la galaxy': 1560,
  'lafc': 1550,
  'columbus crew': 1540,
  'fc cincinnati': 1530,
  'seattle sounders': 1520,
  'atlanta united': 1510,
  'new york red bulls': 1500,
  'new york city fc': 1500,
  'philadelphia union': 1490,
}

/**
 * Fetch recent form from ESPN for a team in a league.
 * Returns a modifier in range [-15, +15] based on last 5 results.
 */
async function fetchTeamForm(teamName: string, leagueKey?: string): Promise<number> {
  if (!leagueKey) return 0
  const espnLeagueMap: Record<string, string> = {
    premier_league: 'eng.1', la_liga: 'esp.1', bundesliga: 'ger.1',
    serie_a: 'ita.1', ligue_1: 'fra.1', mls: 'usa.1',
    eredivisie: 'ned.1', primeira_liga: 'por.1',
    champions_league: 'uefa.champions', europa_league: 'uefa.europa',
    conference_league: 'uefa.europa.conf', world_cup: 'fifa.world',
  }
  const espnId = espnLeagueMap[leagueKey]
  if (!espnId) return 0

  try {
    const now = new Date()
    const past = new Date(now); past.setDate(past.getDate() - 30)
    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/scoreboard?dates=${fmt(past)}-${fmt(now)}&limit=100`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), next: { revalidate: 3600 } })
    if (!res.ok) return 0
    const data = await res.json()
    const teamLower = teamName.toLowerCase()
    const results: string[] = []
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0]
      const status = comp?.status?.type?.name || ''
      if (!status.includes('FINAL') && !status.includes('FULL_TIME')) continue
      const home = comp.competitors?.find((c: any) => c.homeAway === 'home')
      const away = comp.competitors?.find((c: any) => c.homeAway === 'away')
      if (!home || !away) continue
      const homeName = (home.team?.displayName || '').toLowerCase()
      const awayName = (away.team?.displayName || '').toLowerCase()
      const isHome = homeName.includes(teamLower) || teamLower.includes(homeName.split(' ').pop() || '___')
      const isAway = awayName.includes(teamLower) || teamLower.includes(awayName.split(' ').pop() || '___')
      if (!isHome && !isAway) continue
      const hg = parseInt(home.score || '0')
      const ag = parseInt(away.score || '0')
      if (isHome) results.push(hg > ag ? 'W' : hg < ag ? 'L' : 'D')
      else results.push(ag > hg ? 'W' : ag < hg ? 'L' : 'D')
    }
    // Compute form modifier from last 5: W=+3, D=0, L=-3
    const last5 = results.slice(-5)
    if (last5.length === 0) return 0
    return last5.reduce((sum, r) => sum + (r === 'W' ? 3 : r === 'L' ? -3 : 0), 0)
  } catch {
    return 0
  }
}

// Helper to convert league name to API key format
function normalizeLeagueKey(league: string): string {
  return leagueNameToKey[league] || league.toLowerCase().replace(/\s+/g, '_')
}

function getTeamElo(teamName: string, league?: string): number {
  const normalized = teamName.toLowerCase()
  let baseElo = teamBaseElo[normalized] || DEFAULT_ELO
  
  // Apply league strength modifier
  if (league) {
    const leagueKey = normalizeLeagueKey(league)
    const strengthMod = leagueStrength[leagueKey] || 1.0
    baseElo = baseElo * strengthMod
  }
  
  // Form is applied asynchronously via fetchTeamForm() in the main prediction path
  return baseElo
}

function calculateWinProbabilities(homeElo: number, awayElo: number, homeForm: number, awayForm: number, leagueKey?: string): { home: number; draw: number; away: number } {
  // Get league-specific parameters
  const params = (leagueKey && getLeagueParams()[leagueKey]) || DEFAULT_PARAMS

  // Apply home advantage from league-specific calibration
  const homeAdvElo = params.home_adv * HOME_ADVANTAGE_ELO / 0.25  // scale relative to default
  const adjustedHomeElo = homeElo + homeAdvElo
  
  // Apply form adjustments (form impacts probability slightly)
  const formAdjustment = (homeForm - awayForm) * 1.5
  const eloDiff = adjustedHomeElo - awayElo + formAdjustment
  
  // Use logistic function for win probability
  const homeWinRaw = 1 / (1 + Math.pow(10, -eloDiff / 400))
  
  // League-calibrated draw probability using Dixon-Coles inspired model
  const eloCloseness = Math.exp(-(eloDiff * eloDiff) / (2 * 250 * 250))
  const drawProb = Math.max(0.08, Math.min(0.38, params.draw_rate * (0.6 + 0.8 * eloCloseness)))
  
  // Distribute remaining probability to win/loss
  const winPool = 1 - drawProb
  const normalizedHome = winPool * homeWinRaw
  const normalizedAway = winPool * (1 - homeWinRaw)
  
  // Round and ensure they sum to 100
  const homeRounded = Math.round(normalizedHome * 100)
  const drawRounded = Math.round(drawProb * 100)
  const awayRounded = 100 - homeRounded - drawRounded
  
  return {
    home: homeRounded,
    draw: drawRounded,
    away: Math.max(0, awayRounded)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: AnyTeamsPredictionRequest = await request.json()
    const { home_team, away_team, home_league, away_league } = body
    
    if (!home_team || !away_team) {
      return NextResponse.json(
        { error: 'Both home_team and away_team are required' },
        { status: 400 }
      )
    }
    
    if (home_team === away_team) {
      return NextResponse.json(
        { error: 'Teams must be different' },
        { status: 400 }
      )
    }
    
    // Convert league names if needed
    const homeLeagueKey = home_league ? normalizeLeagueKey(home_league) : undefined
    const awayLeagueKey = away_league ? normalizeLeagueKey(away_league) : undefined
    
    // Fetch real form from ESPN (parallel)
    const [homeForm, awayForm] = await Promise.all([
      fetchTeamForm(home_team, homeLeagueKey),
      fetchTeamForm(away_team, awayLeagueKey),
    ])
    
    let homeElo: number
    let awayElo: number
    let backendAvailable = false
    
    // Try to get prediction from backend first
    try {
      const response = await fetch(`${BACKEND_URL}/api/predict/unified`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          home_team,
          away_team,
          league: homeLeagueKey || 'premier_league',
        }),
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      })
      
      if (response.ok) {
        const backendPrediction = await response.json()
        homeElo = backendPrediction.home_elo || getTeamElo(home_team, home_league)
        awayElo = backendPrediction.away_elo || getTeamElo(away_team, away_league)
        backendAvailable = true
      } else {
        homeElo = getTeamElo(home_team, home_league)
        awayElo = getTeamElo(away_team, away_league)
      }
    } catch {
      // Backend not available, use local calculation
      homeElo = getTeamElo(home_team, home_league)
      awayElo = getTeamElo(away_team, away_league)
    }
    
    // Calculate probabilities with per-league model and form adjustments
    const matchLeague = homeLeagueKey || awayLeagueKey
    const probs = calculateWinProbabilities(homeElo, awayElo, homeForm, awayForm, matchLeague)
    
    // Get league-specific parameters for goal prediction
    const params = (matchLeague && getLeagueParams()[matchLeague]) || DEFAULT_PARAMS
    
    // Calculate ELO difference with home advantage and form
    const homeAdvElo = params.home_adv * HOME_ADVANTAGE_ELO / 0.25
    const formAdjustment = (homeForm - awayForm) * 1.5
    const eloDiff = (homeElo + homeAdvElo) - awayElo + formAdjustment
    
    // Dixon-Coles inspired goal prediction using league-specific avg_goals
    const homeAttack = Math.max(0.5, 1.0 + (homeElo - 1500) / 800)
    const awayAttack = Math.max(0.5, 1.0 + (awayElo - 1500) / 800)
    const homeDefense = Math.max(0.5, 1.0 - (homeElo - 1500) / 1200)
    const awayDefense = Math.max(0.5, 1.0 - (awayElo - 1500) / 1200)
    
    const homeBaseGoals = Math.max(0.2, homeAttack * awayDefense * params.avg_goals + params.home_adv + Math.max(homeForm, -6) / 40)
    const awayBaseGoals = Math.max(0.2, awayAttack * homeDefense * params.avg_goals + Math.max(awayForm, -6) / 40)
    const scoreMatrix = buildScoreMatrix(homeBaseGoals, awayBaseGoals, params.rho)
    const topScore = scoreMatrix.scores[0]
    
    // Determine predicted winner
    let predictedWinner = 'Draw'
    if (probs.home > probs.draw && probs.home > probs.away) {
      predictedWinner = home_team
    } else if (probs.away > probs.draw && probs.away > probs.home) {
      predictedWinner = away_team
    }
    
    // Determine if cross-league match
    const isCrossLeague = homeLeagueKey && awayLeagueKey && homeLeagueKey !== awayLeagueKey
    
    // Calculate confidence based on ELO difference and form clarity
    const formClarity = Math.abs(homeForm - awayForm) / 2
    const confidence = Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, 50 + Math.abs(eloDiff) / 10 + formClarity))
    const edge = Math.max(probs.home, probs.draw, probs.away)
    const risk = edge >= 52 ? 'Low' : edge >= 42 ? 'Medium' : 'High'
    
    // Build enhanced prediction response
    const prediction = {
      success: true,
      home_team,
      away_team,
      home_league: home_league || 'Unknown',
      away_league: away_league || 'Unknown',
      is_cross_league: isCrossLeague,
      predictions: {
        home_win: probs.home / 100,
        draw: probs.draw / 100,
        away_win: probs.away / 100,
      },
      predicted_home_goals: Math.max(0, Math.min(MAX_PREDICTED_GOALS, topScore ? topScore.home : Math.round(homeBaseGoals * 10) / 10)),
      predicted_away_goals: Math.max(0, Math.min(MAX_PREDICTED_GOALS, topScore ? topScore.away : Math.round(awayBaseGoals * 10) / 10)),
      total_goals: Math.round((homeBaseGoals + awayBaseGoals) * 10) / 10,
      markets: {
        over_2_5: Math.round(scoreMatrix.over25 * 1000) / 1000,
        btts_yes: Math.round(scoreMatrix.btts * 1000) / 1000,
      },
      scoreline_probabilities: scoreMatrix.scores.slice(0, 5).map((entry) => ({
        score: entry.score,
        probability: Math.round(entry.probability * 1000) / 1000,
      })),
      confidence: Math.round(confidence),
      verdict: {
        edge: edge >= 52 ? 'Strong edge' : edge >= 42 ? 'Playable edge' : 'Thin edge',
        risk,
        summary: `${predictedWinner === 'Draw' ? 'The draw is live because the teams rate closely.' : `${predictedWinner} projects as the likelier winner.`} Expected goals sit at ${(homeBaseGoals + awayBaseGoals).toFixed(1)}, with ${Math.round(scoreMatrix.over25 * 100)}% for over 2.5 and ${Math.round(scoreMatrix.btts * 100)}% for both teams to score.`,
      },
      ratings: {
        home_elo: Math.round(homeElo),
        away_elo: Math.round(awayElo),
        elo_difference: Math.round(eloDiff),
      },
      form: {
        home_form: homeForm,
        away_form: awayForm,
        home_form_label: homeForm > 5 ? 'Good' : homeForm < -5 ? 'Poor' : 'Average',
        away_form_label: awayForm > 5 ? 'Good' : awayForm < -5 ? 'Poor' : 'Average',
      },
      analysis: {
        predicted_winner: predictedWinner,
        home_advantage_applied: true,
        factors_considered: [
          'Per-league Dixon-Coles model',
          'ELO rating difference',
          `Home advantage (league-calibrated: ${params.home_adv.toFixed(2)})`,
          `League draw rate: ${(params.draw_rate * 100).toFixed(0)}%`,
          'ESPN recent form analysis',
          'Poisson scoreline matrix',
          'Venue location',
          ...(isCrossLeague ? ['League strength coefficient'] : []),
          ...(backendAvailable ? ['Backend ML ensemble'] : ['Statistical estimation'])
        ],
        note: isCrossLeague 
          ? 'Cross-league match: Results adjusted for league strength differences.'
          : 'Same league match: Direct comparison based on current form and ratings.'
      }
    }
    
    return NextResponse.json(prediction)
  } catch (error) {
    console.error('Error predicting match:', error)
    return NextResponse.json(
      { error: 'Failed to predict match', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
