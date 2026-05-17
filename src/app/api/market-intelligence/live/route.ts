import { NextRequest, NextResponse } from 'next/server'
import { buildMarketIntelligence, type DecimalThreeWayOdds, type ModelThreeWayProbabilities } from '@/lib/marketIntelligence'

export const dynamic = 'force-dynamic'

const LEAGUE_TO_ODDS_SPORT: Record<string, string> = {
  'eng.1': 'soccer_epl',
  '47': 'soccer_epl',
  'esp.1': 'soccer_spain_la_liga',
  '87': 'soccer_spain_la_liga',
  'ita.1': 'soccer_italy_serie_a',
  '55': 'soccer_italy_serie_a',
  'ger.1': 'soccer_germany_bundesliga',
  '54': 'soccer_germany_bundesliga',
  'fra.1': 'soccer_france_ligue_one',
  '53': 'soccer_france_ligue_one',
  'usa.1': 'soccer_usa_mls',
  '130': 'soccer_usa_mls',
  'ned.1': 'soccer_netherlands_eredivisie',
  '57': 'soccer_netherlands_eredivisie',
  'por.1': 'soccer_portugal_primeira_liga',
  '61': 'soccer_portugal_primeira_liga',
  'uefa.champions': 'soccer_uefa_champs_league',
  'uefa.europa': 'soccer_uefa_europa_league',
  'fifa.world': 'soccer_fifa_world_cup',
}

interface OddsApiOutcome {
  name: string
  price: number
}

interface OddsApiMarket {
  key: string
  outcomes?: OddsApiOutcome[]
}

interface OddsApiBookmaker {
  key: string
  title: string
  last_update?: string
  markets?: OddsApiMarket[]
}

interface OddsApiEvent {
  id: string
  sport_key: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers?: OddsApiBookmaker[]
}

function decimalFromOutcomes(event: OddsApiEvent): { odds: DecimalThreeWayOdds; bookmakers: string[]; last_update: string | null } | null {
  const prices: Record<'home' | 'draw' | 'away', number[]> = { home: [], draw: [], away: [] }
  const bookmakers: string[] = []
  let lastUpdate: string | null = null

  for (const bookmaker of event.bookmakers || []) {
    const h2h = bookmaker.markets?.find((market) => market.key === 'h2h')
    if (!h2h?.outcomes) continue
    const home = h2h.outcomes.find((outcome) => outcome.name === event.home_team)
    const away = h2h.outcomes.find((outcome) => outcome.name === event.away_team)
    const draw = h2h.outcomes.find((outcome) => outcome.name.toLowerCase() === 'draw')
    if (!home || !away || !draw) continue
    if (home.price <= 1 || away.price <= 1 || draw.price <= 1) continue

    prices.home.push(home.price)
    prices.draw.push(draw.price)
    prices.away.push(away.price)
    bookmakers.push(bookmaker.title)
    if (bookmaker.last_update && (!lastUpdate || bookmaker.last_update > lastUpdate)) {
      lastUpdate = bookmaker.last_update
    }
  }

  if (prices.home.length === 0 || prices.draw.length === 0 || prices.away.length === 0) return null

  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    odds: {
      home: Number(avg(prices.home).toFixed(3)),
      draw: Number(avg(prices.draw).toFixed(3)),
      away: Number(avg(prices.away).toFixed(3)),
    },
    bookmakers,
    last_update: lastUpdate,
  }
}

function readModel(searchParams: URLSearchParams): ModelThreeWayProbabilities | null {
  const home = Number(searchParams.get('model_home'))
  const draw = Number(searchParams.get('model_draw'))
  const away = Number(searchParams.get('model_away'))
  if (![home, draw, away].every((value) => Number.isFinite(value) && value >= 0)) return null
  const total = home + draw + away
  if (total <= 0) return null
  return {
    home_win: home / total,
    draw: draw / total,
    away_win: away / total,
  }
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY
  const league = request.nextUrl.searchParams.get('league') || 'eng.1'
  const sport = request.nextUrl.searchParams.get('sport') || LEAGUE_TO_ODDS_SPORT[league]
  const regions = request.nextUrl.searchParams.get('regions') || process.env.ODDS_API_REGIONS || 'us,uk,eu'
  const eventId = request.nextUrl.searchParams.get('eventId')
  const model = readModel(request.nextUrl.searchParams)

  if (!apiKey) {
    return NextResponse.json({
      configured: false,
      provider: 'the-odds-api-v4',
      guarantee: false,
      betting_advice: false,
      note: 'Set ODDS_API_KEY or THE_ODDS_API_KEY to enable licensed odds ingestion. The route remains disabled instead of scraping or fabricating market data.',
    }, { status: 501 })
  }

  if (!sport) {
    return NextResponse.json({
      error: `No odds sport key is mapped for league "${league}".`,
      guarantee: false,
      betting_advice: false,
    }, { status: 400 })
  }

  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds`)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('regions', regions)
  url.searchParams.set('markets', 'h2h')
  url.searchParams.set('oddsFormat', 'decimal')
  url.searchParams.set('dateFormat', 'iso')

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    const text = await response.text()
    return NextResponse.json({
      error: 'Licensed odds provider request failed.',
      provider_status: response.status,
      provider_message: text.slice(0, 300),
      guarantee: false,
      betting_advice: false,
    }, { status: 502 })
  }

  const events = await response.json() as OddsApiEvent[]
  const normalized = events
    .filter((event) => !eventId || event.id === eventId)
    .map((event) => {
      const consensus = decimalFromOutcomes(event)
      if (!consensus) return null
      return {
        id: event.id,
        sport_key: event.sport_key,
        commence_time: event.commence_time,
        home_team: event.home_team,
        away_team: event.away_team,
        bookmaker_count: consensus.bookmakers.length,
        bookmakers: consensus.bookmakers.slice(0, 8),
        last_update: consensus.last_update,
        consensus_decimal_odds: consensus.odds,
        market_intelligence: buildMarketIntelligence(consensus.odds, model, 'licensed_provider_odds'),
      }
    })
    .filter(Boolean)

  return NextResponse.json({
    configured: true,
    provider: 'the-odds-api-v4',
    sport,
    regions,
    event_count: normalized.length,
    guarantee: false,
    betting_advice: false,
    note: 'Licensed market odds are used for no-vig probability comparison and calibration audit only. This endpoint does not recommend bets.',
    events: normalized,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'x-requests-remaining': response.headers.get('x-requests-remaining') || '',
      'x-requests-used': response.headers.get('x-requests-used') || '',
    },
  })
}
