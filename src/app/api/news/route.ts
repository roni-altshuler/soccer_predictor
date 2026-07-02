import { NextRequest, NextResponse } from 'next/server'

interface NewsArticle {
  id: string
  headline: string
  description: string
  published: string
  images: { url: string; caption?: string }[]
  links: { web: { href: string } }
  type: string
  categories?: { description: string }[]
}

// Underscore/ESPN-style league slug -> ESPN men's soccer path segment.
const MENS_ESPN: Record<string, string> = {
  premier_league: 'eng.1',
  la_liga: 'esp.1',
  bundesliga: 'ger.1',
  serie_a: 'ita.1',
  ligue_1: 'fra.1',
  mls: 'usa.1',
  eredivisie: 'ned.1',
  primeira_liga: 'por.1',
  champions_league: 'uefa.champions',
  europa_league: 'uefa.europa',
  conference_league: 'uefa.europa.conf',
  world_cup: 'fifa.world',
}

// Women's counterparts, keyed by underscore slug, men's ESPN id, and the
// women's ESPN id itself so any of those forms resolves correctly. IDs verified
// against backend/services/data/espn_loader.py WOMEN_COMPETITIONS.
const WOMENS_ESPN: Record<string, string> = {
  premier_league: 'eng.w.1', 'eng.1': 'eng.w.1', 'eng.w.1': 'eng.w.1',
  mls: 'usa.nwsl', 'usa.1': 'usa.nwsl', 'usa.nwsl': 'usa.nwsl',
  champions_league: 'uefa.wchampions', 'uefa.champions': 'uefa.wchampions', 'uefa.wchampions': 'uefa.wchampions',
  world_cup: 'fifa.wwc', 'fifa.world': 'fifa.wwc', 'fifa.wwc': 'fifa.wwc',
  euro: 'uefa.weuro', 'uefa.euro': 'uefa.weuro', 'uefa.weuro': 'uefa.weuro',
}

// All women's ESPN feeds we aggregate for the universe-wide women's newsroom.
const WOMENS_ALL_FEEDS = ['usa.nwsl', 'eng.w.1', 'uefa.wchampions', 'uefa.weuro', 'fifa.wwc']

/**
 * Resolve an ESPN league path for a requested league + gender. Returns null
 * when the women's universe has no counterpart — callers must then serve an
 * empty result rather than falling back to men's data (data-honesty rule).
 */
function resolveEspnLeague(league: string | null, gender: 'M' | 'F'): string | null {
  if (!league) return null
  if (gender === 'F') return WOMENS_ESPN[league] ?? null
  return MENS_ESPN[league] ?? (league.includes('.') ? league : null)
}

async function fetchESPNNews(path: string): Promise<NewsArticle[]> {
  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${path}/news`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    )
    if (!response.ok) {
      throw new Error(`ESPN News API returned ${response.status}`)
    }
    const data = await response.json()
    return data.articles || []
  } catch (error) {
    console.error('Error fetching ESPN news:', error)
    return []
  }
}

function transform(article: NewsArticle) {
  return {
    id: article.id || article.headline?.replace(/\s+/g, '-').toLowerCase(),
    title: article.headline,
    description: article.description,
    published: article.published,
    image: article.images?.[0]?.url || null,
    imageCaption: article.images?.[0]?.caption || null,
    url: article.links?.web?.href || '#',
    type: article.type || 'Story',
    category: article.categories?.[0]?.description || 'Soccer',
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const gender = (searchParams.get('gender') || 'M').toUpperCase() === 'F' ? 'F' : 'M'
  const league = searchParams.get('league')

  try {
    let articles: NewsArticle[] = []

    if (league) {
      // League-scoped feed. When the women's universe has no counterpart for
      // the requested league we serve an explicit empty result.
      const path = resolveEspnLeague(league, gender)
      if (path) {
        articles = await fetchESPNNews(path)
      }
    } else if (gender === 'F') {
      // Universe-wide women's newsroom: aggregate the women's league feeds so
      // the toggle never silently serves men's headlines.
      const feeds = await Promise.all(WOMENS_ALL_FEEDS.map((p) => fetchESPNNews(p)))
      const seen = new Set<string>()
      for (const feed of feeds) {
        for (const a of feed) {
          const key = a.id || a.headline
          if (key && !seen.has(key)) {
            seen.add(key)
            articles.push(a)
          }
        }
      }
      articles.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
    } else {
      // Men's / default: the broad all-soccer feed.
      articles = await fetchESPNNews('all')
    }

    const news = articles.slice(0, 20).map(transform)

    return NextResponse.json({
      articles: news,
      source: 'espn',
      gender,
      count: news.length,
    })
  } catch (error) {
    console.error('Error fetching news:', error)
    return NextResponse.json({ articles: [], source: 'espn', gender, count: 0 })
  }
}
