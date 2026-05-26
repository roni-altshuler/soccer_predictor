import { NextRequest, NextResponse } from 'next/server'
import { buildMarketIntelligence, type DecimalThreeWayOdds, type ModelThreeWayProbabilities } from '@/lib/marketIntelligence'

export const dynamic = 'force-dynamic'

// Quota-protected, in-memory-cached wrapper around The Odds API v4.
//
// Free tier is 500 requests/month; this route stretches that across a
// World-Cup-length window by (a) defaulting to a single region (eu = 1
// quota/call instead of 3), (b) caching the per-league response for 15
// minutes so repeated match-detail opens share one fetch, and (c)
// counting per-day and per-month usage with a hard cap before the
// outbound fetch.
const CACHE_TTL_MS = Number(process.env.ODDS_API_CACHE_TTL_MS) || 15 * 60 * 1000
const STALE_OK_MS = Number(process.env.ODDS_API_STALE_OK_MS) || 6 * 60 * 60 * 1000 // serve stale during quota lockouts
const DAILY_BUDGET = Number(process.env.ODDS_API_DAILY_BUDGET) || 16 // 500 / ~31 days
const MONTHLY_BUDGET = Number(process.env.ODDS_API_MONTHLY_BUDGET) || 500

type NormalizedPayload = {
  configured: true
  provider: 'the-odds-api-v4'
  sport: string
  regions: string
  event_count: number
  guarantee: false
  betting_advice: false
  note: string
  events: unknown[]
}

type CacheEntry = { fetched_at: number; payload: NormalizedPayload; provider_remaining: number | null }
const cache: Map<string, CacheEntry> = new Map()

type QuotaState = {
  utc_date: string
  daily_count: number
  utc_month: string
  monthly_count: number
  provider_last_remaining: number | null
}
const quota: QuotaState = {
  utc_date: '',
  daily_count: 0,
  utc_month: '',
  monthly_count: 0,
  provider_last_remaining: null,
}

function quotaTick(): void {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const month = now.toISOString().slice(0, 7)
  if (quota.utc_date !== date) {
    quota.utc_date = date
    quota.daily_count = 0
  }
  if (quota.utc_month !== month) {
    quota.utc_month = month
    quota.monthly_count = 0
  }
}

function quotaCheck(): { allowed: boolean; reason: string | null } {
  quotaTick()
  if (quota.daily_count >= DAILY_BUDGET) return { allowed: false, reason: 'daily_budget_exhausted' }
  if (quota.monthly_count >= MONTHLY_BUDGET) return { allowed: false, reason: 'monthly_budget_exhausted' }
  if (quota.provider_last_remaining !== null && quota.provider_last_remaining <= 0) {
    return { allowed: false, reason: 'provider_quota_exhausted' }
  }
  return { allowed: true, reason: null }
}

function quotaSnapshot(): Record<string, unknown> {
  quotaTick()
  return {
    daily_used: quota.daily_count,
    daily_budget: DAILY_BUDGET,
    monthly_used: quota.monthly_count,
    monthly_budget: MONTHLY_BUDGET,
    provider_remaining: quota.provider_last_remaining,
  }
}

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
  // Default to `eu` only: 1 quota per fetch instead of 3 (us,uk,eu).
  const regions = request.nextUrl.searchParams.get('regions') || process.env.ODDS_API_REGIONS || 'eu'
  const eventId = request.nextUrl.searchParams.get('eventId')
  const fresh = request.nextUrl.searchParams.get('fresh') === 'true'
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

  const cacheKey = `${sport}|${regions}`
  const cached = cache.get(cacheKey)
  const cacheAge = cached ? Date.now() - cached.fetched_at : Infinity

  // Serve from cache when fresh enough and the caller didn't force a refresh.
  if (cached && cacheAge < CACHE_TTL_MS && !fresh) {
    return respondFromPayload(cached.payload, { eventId, model, cacheAge, source: 'cache_fresh', providerRemaining: cached.provider_remaining })
  }

  // Quota gate before any outbound request.
  const gate = quotaCheck()
  if (!gate.allowed) {
    // Fall back to a stale cache entry if we have one within the stale window.
    if (cached && cacheAge < STALE_OK_MS) {
      return respondFromPayload(cached.payload, {
        eventId, model, cacheAge, source: `cache_stale_${gate.reason}`,
        providerRemaining: cached.provider_remaining,
      })
    }
    return NextResponse.json({
      configured: true,
      quota_blocked: true,
      reason: gate.reason,
      provider: 'the-odds-api-v4',
      guarantee: false,
      betting_advice: false,
      note: 'Quota budget exhausted; live odds temporarily unavailable. Model probabilities remain valid.',
      quota: quotaSnapshot(),
    }, { status: 429 })
  }

  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds`)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('regions', regions)
  url.searchParams.set('markets', 'h2h')
  url.searchParams.set('oddsFormat', 'decimal')
  url.searchParams.set('dateFormat', 'iso')

  let response: Response
  try {
    response = await fetch(url.toString(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    // Network error — fall back to stale cache if available.
    if (cached && cacheAge < STALE_OK_MS) {
      return respondFromPayload(cached.payload, {
        eventId, model, cacheAge, source: 'cache_stale_network_error',
        providerRemaining: cached.provider_remaining,
      })
    }
    return NextResponse.json({
      error: 'Licensed odds provider unreachable.',
      detail: err instanceof Error ? err.message : String(err),
      guarantee: false,
      betting_advice: false,
    }, { status: 502 })
  }

  // Count the call regardless of HTTP status — provider charges for the attempt.
  quota.daily_count += 1
  quota.monthly_count += 1
  const providerRemainingHeader = response.headers.get('x-requests-remaining')
  const providerRemaining = providerRemainingHeader !== null ? Number(providerRemainingHeader) : null
  if (providerRemaining !== null && Number.isFinite(providerRemaining)) {
    quota.provider_last_remaining = providerRemaining
  }

  if (!response.ok) {
    const text = await response.text()
    // If provider says rate-limited or insufficient quota, prefer stale cache.
    if ((response.status === 429 || response.status === 401) && cached && cacheAge < STALE_OK_MS) {
      return respondFromPayload(cached.payload, {
        eventId, model, cacheAge, source: `cache_stale_provider_${response.status}`,
        providerRemaining: cached.provider_remaining,
      })
    }
    return NextResponse.json({
      error: 'Licensed odds provider request failed.',
      provider_status: response.status,
      provider_message: text.slice(0, 300),
      guarantee: false,
      betting_advice: false,
      quota: quotaSnapshot(),
    }, { status: 502 })
  }

  const events = await response.json() as OddsApiEvent[]
  const payload: NormalizedPayload = {
    configured: true,
    provider: 'the-odds-api-v4',
    sport,
    regions,
    event_count: events.length,
    guarantee: false,
    betting_advice: false,
    note: 'Licensed market odds are used for no-vig probability comparison and calibration audit only. This endpoint does not recommend bets.',
    events: events
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
          consensus_decimal_odds_raw: consensus.odds,
        }
      })
      .filter(Boolean),
  }

  cache.set(cacheKey, { fetched_at: Date.now(), payload, provider_remaining: providerRemaining })

  return respondFromPayload(payload, { eventId, model, cacheAge: 0, source: 'origin', providerRemaining })
}

// Apply per-event filtering + per-request model edge computation to a cached
// payload, then return the response. Kept separate so cache-hit and origin
// paths share the same shaping logic.
function respondFromPayload(
  payload: NormalizedPayload,
  opts: { eventId: string | null; model: ModelThreeWayProbabilities | null; cacheAge: number; source: string; providerRemaining: number | null },
): NextResponse {
  const filtered = (payload.events as Array<{
    id: string
    consensus_decimal_odds: DecimalThreeWayOdds
    [key: string]: unknown
  }>)
    .filter((event) => !opts.eventId || event.id === opts.eventId)
    .map((event) => ({
      ...event,
      market_intelligence: buildMarketIntelligence(event.consensus_decimal_odds, opts.model, 'licensed_provider_odds'),
    }))

  return NextResponse.json({
    ...payload,
    event_count: filtered.length,
    events: filtered,
    cache: {
      source: opts.source,
      age_ms: opts.cacheAge,
      ttl_ms: CACHE_TTL_MS,
    },
    quota: quotaSnapshot(),
  }, {
    headers: {
      // Edge caches can also keep this for 15 min fresh + 30 min SWR.
      'Cache-Control': 's-maxage=900, stale-while-revalidate=1800',
      'x-quota-daily-used': String(quota.daily_count),
      'x-quota-daily-budget': String(DAILY_BUDGET),
      'x-quota-monthly-used': String(quota.monthly_count),
      'x-quota-monthly-budget': String(MONTHLY_BUDGET),
      'x-provider-remaining': opts.providerRemaining !== null ? String(opts.providerRemaining) : '',
      'x-cache-source': opts.source,
    },
  })
}
