'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface NewsArticle {
  id: string
  title: string
  description: string
  published: string
  image: string | null
  imageCaption?: string | null
  url: string
  type: string
  category?: string
}

function formatRelative(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHrs < 1) {
      const mins = Math.max(1, Math.floor(diffMs / 60_000))
      return `${mins}m ago`
    }
    if (diffHrs < 24) return `${diffHrs}h ago`
    if (diffHrs < 48) return 'Yesterday'
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function sourceLabel(url: string, category?: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host.includes('espn')) return 'ESPN'
    if (host.includes('bbc')) return 'BBC'
    if (host.includes('skysports')) return 'Sky Sports'
    if (host.includes('fotmob')) return 'FotMob'
    return host.split('.')[0].replace(/-/g, ' ')
  } catch {
    return category || 'News'
  }
}

function NewsCardSkeleton() {
  return (
    <div className="snap-start flex-shrink-0 w-[260px] md:w-auto rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-[var(--shadow-sm)] animate-pulse">
      <div className="w-full h-[100px] bg-[var(--muted-bg)]" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-[var(--muted-bg)] rounded w-full" />
        <div className="h-3 bg-[var(--muted-bg)] rounded w-2/3" />
        <div className="h-2 bg-[var(--muted-bg)] rounded w-1/3" />
      </div>
    </div>
  )
}

function NewsCard({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="snap-start flex-shrink-0 w-[260px] md:w-auto rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-[var(--shadow-sm)] hover:border-[var(--accent-primary)] hover:shadow-[var(--shadow-md)] transition-all group"
    >
      <div className="relative w-full h-[100px] bg-[var(--muted-bg)] overflow-hidden">
        {article.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.image}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl">⚽</span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-black/55 backdrop-blur text-white">
            {sourceLabel(article.url, article.category)}
          </span>
        </div>
      </div>
      <div className="p-3">
        <h3 className="text-xs font-bold text-[var(--text-primary)] line-clamp-2 leading-snug group-hover:text-[var(--accent-primary)] transition-colors min-h-[2.5rem]">
          {article.title}
        </h3>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
          {formatRelative(article.published)}
        </p>
      </div>
    </a>
  )
}

export default function NewsStrip() {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetchNews = async () => {
      try {
        const res = await fetch('/api/news')
        if (!res.ok) throw new Error('news fetch failed')
        const data = await res.json()
        if (!cancelled) setArticles((data.articles || []).slice(0, 3))
      } catch (err) {
        console.error('Error fetching news strip:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchNews()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="px-3 md:px-4 pt-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          Latest news
        </h2>
        <Link
          href="/news"
          className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-primary)] hover:underline"
        >
          See all
        </Link>
      </div>

      {/* Mobile: horizontal scroll with snap. Desktop: 3-up grid. */}
      <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible snap-x snap-mandatory pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <NewsCardSkeleton key={i} />)
          : articles.length > 0
            ? articles.map((article) => (
                <NewsCard key={article.id} article={article} />
              ))
            : (
                <div className="w-full text-center py-6 text-[var(--text-tertiary)] text-xs">
                  No news available
                </div>
              )}
      </div>
    </section>
  )
}
