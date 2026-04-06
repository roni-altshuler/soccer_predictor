'use client'

import { useState, useEffect } from 'react'

interface NewsArticle {
  id: string; title: string; description: string; published: string
  image: string | null; imageCaption?: string | null; url: string; type: string; category?: string
}

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const res = await fetch('/api/news')
        if (!res.ok) throw new Error('Failed to fetch news')
        const data = await res.json()
        setArticles(data.articles || [])
      } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load news') }
      finally { setLoading(false) }
    }
    fetchNews()
  }, [])

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
      if (diffHrs < 1) return 'Just now'
      if (diffHrs < 24) return `${diffHrs}h ago`
      if (diffHrs < 48) return 'Yesterday'
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return dateStr }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)]">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="animate-pulse bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-3 flex gap-3 shadow-[var(--shadow-sm)]">
                <div className="w-20 h-14 rounded bg-[var(--muted-bg)] flex-shrink-0" />
                <div className="flex-1 space-y-2"><div className="h-3 bg-[var(--muted-bg)] rounded w-3/4" /><div className="h-2 bg-[var(--muted-bg)] rounded w-1/2" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-[var(--accent-primary)] text-black text-xs font-semibold rounded-lg">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
        <div className="fm-surface p-4 mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-1">Newsroom</p>
          <h1 className="text-xl md:text-2xl font-black text-[var(--text-primary)]">Latest Football Headlines</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Curated breaking stories, transfer chatter, and tactical updates in one feed.</p>
        </div>

        {/* Featured */}
        {articles.length > 0 && (
          <a href={articles[0].url || '#'} target="_blank" rel="noopener noreferrer"
            className="block mb-4 rounded-2xl overflow-hidden bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors group shadow-[var(--shadow-sm)]">
            <div className="aspect-video relative overflow-hidden">
              {articles[0].image ? (
                <img src={articles[0].image} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[var(--muted-bg)]"><span className="text-4xl">⚽</span></div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-primary)]">Featured</span>
                <h2 className="text-base font-bold text-white mt-0.5 line-clamp-2">{articles[0].title}</h2>
                <p className="text-xs text-white/60 mt-1">{formatDate(articles[0].published)}</p>
              </div>
            </div>
          </a>
        )}

        {/* Article List */}
        <div className="space-y-0.5">
          {articles.slice(1).map((article) => (
            <a key={article.id} href={article.url || '#'} target="_blank" rel="noopener noreferrer"
              className="flex gap-3 p-3 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors group shadow-[var(--shadow-sm)]">
              {article.image ? (
                <img src={article.image} alt="" className="w-20 h-14 rounded object-cover flex-shrink-0" />
              ) : (
                <div className="w-20 h-14 rounded bg-[var(--muted-bg)] flex items-center justify-center flex-shrink-0"><span className="text-xl">⚽</span></div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--accent-primary)] transition-colors">{article.title}</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{formatDate(article.published)}</p>
              </div>
            </a>
          ))}
        </div>

        {articles.length === 0 && (
          <div className="text-center py-16"><span className="text-3xl block mb-2">📰</span><p className="text-sm text-[var(--text-tertiary)]">No news available</p></div>
        )}
      </div>
    </div>
  )
}
