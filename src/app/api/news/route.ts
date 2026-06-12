import { NextResponse } from 'next/server'

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

async function fetchESPNNews(): Promise<NewsArticle[]> {
  try {
    const response = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/all/news',
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

export async function GET() {
  try {
    // No fabricated fallback — consumers render their empty states
    // when ESPN has nothing (data-provenance rule).
    const articles = await fetchESPNNews()
    
    // Transform to consistent format
    const news = articles.slice(0, 20).map((article: NewsArticle) => ({
      id: article.id || article.headline?.replace(/\s+/g, '-').toLowerCase(),
      title: article.headline,
      description: article.description,
      published: article.published,
      image: article.images?.[0]?.url || null,
      imageCaption: article.images?.[0]?.caption || null,
      url: article.links?.web?.href || '#',
      type: article.type || 'Story',
      category: article.categories?.[0]?.description || 'Soccer',
    }))
    
    return NextResponse.json({
      articles: news,
      source: 'espn',
      count: news.length,
    })
  } catch (error) {
    console.error('Error fetching news:', error)
    return NextResponse.json({ articles: [], source: 'espn', count: 0 })
  }
}
