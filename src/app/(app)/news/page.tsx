'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Newspaper } from 'lucide-react'

import { AsyncSection } from '@/components/primitives/AsyncSection'
import { EmptyState } from '@/components/EmptyState'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent, type LeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

interface NewsArticle {
  id: string; title: string; description: string; published: string
  image: string | null; imageCaption?: string | null; url: string; type: string; category?: string
}

/** Resolve a known league accent for an article, or null when unrecognised. */
function resolveArticleLeague(article: NewsArticle): LeagueAccent | null {
  const accent = getLeagueAccent(article.category)
  return accent.competitionId === 'unknown' ? null : accent
}

/** Image that swaps to a token-styled placeholder if the source is missing or fails. */
function NewsImage({
  src,
  accent,
  className,
  iconSize = 'md',
}: {
  src: string | null
  accent: LeagueAccent | null
  className?: string
  iconSize?: 'md' | 'lg'
}) {
  const [broken, setBroken] = useState(false)
  const showPlaceholder = !src || broken

  if (showPlaceholder) {
    const gradient = accent
      ? `linear-gradient(135deg, ${accent.accent} 0%, ${accent.accentBg} 100%)`
      : undefined
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-[var(--muted-bg)]',
          className
        )}
        style={gradient ? { backgroundImage: gradient } : undefined}
        aria-hidden="true"
      >
        <Newspaper
          className={cn(
            iconSize === 'lg' ? 'h-8 w-8' : 'h-5 w-5',
            accent ? 'text-white/90' : 'text-[var(--text-tertiary)]'
          )}
          strokeWidth={1.8}
        />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setBroken(true)}
    />
  )
}

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLeague, setActiveLeague] = useState<string>('all')
  const { asQueryParam } = useGenderQuery()

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/news?gender=${asQueryParam}`)
      if (!res.ok) throw new Error('Failed to fetch news')
      const data = await res.json()
      setArticles(data.articles || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load news')
    } finally {
      setLoading(false)
    }
  }, [asQueryParam])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  // Reset the active filter whenever the universe (gender) changes.
  useEffect(() => {
    setActiveLeague('all')
  }, [asQueryParam])

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

  // Distinct leagues present in the feed, in first-seen order, for filter chips.
  const leagueChips = useMemo(() => {
    const seen = new Map<string, LeagueAccent>()
    for (const a of articles) {
      const accent = resolveArticleLeague(a)
      if (accent && !seen.has(accent.competitionId)) {
        seen.set(accent.competitionId, accent)
      }
    }
    return Array.from(seen.values())
  }, [articles])

  const filteredArticles = useMemo(() => {
    if (activeLeague === 'all') return articles
    return articles.filter((a) => resolveArticleLeague(a)?.competitionId === activeLeague)
  }, [articles, activeLeague])

  const [featured, ...rest] = filteredArticles

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
        <div className="fm-surface p-4 mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-1">Newsroom</p>
          <h1 className="text-xl md:text-2xl font-black text-[var(--text-primary)]">Latest Football Headlines</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Curated breaking stories, transfer chatter, and tactical updates in one feed.</p>
        </div>

        {/* League filter chips — horizontal scroll on mobile */}
        {!loading && !error && leagueChips.length > 0 && (
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ competitionId: 'all', shortName: 'All', accent: 'var(--accent-primary)' } as Pick<LeagueAccent, 'competitionId' | 'shortName' | 'accent'>, ...leagueChips].map((chip) => {
              const selected = activeLeague === chip.competitionId
              return (
                <button
                  key={chip.competitionId}
                  type="button"
                  onClick={() => setActiveLeague(chip.competitionId)}
                  aria-pressed={selected}
                  className={cn(
                    'inline-flex flex-shrink-0 items-center rounded-full border px-3 min-h-[36px] text-xs font-semibold whitespace-nowrap transition-colors',
                    selected
                      ? 'text-white border-transparent'
                      : 'text-[var(--text-secondary)] border-[var(--border-color)] bg-[var(--card-bg)] hover:bg-[var(--muted-bg)]'
                  )}
                  style={selected ? { backgroundColor: chip.accent } : undefined}
                >
                  {chip.shortName}
                </button>
              )
            })}
          </div>
        )}

        <AsyncSection
          loading={loading}
          error={error}
          onRetry={fetchNews}
          section="news"
          empty={filteredArticles.length === 0}
          emptyState={
            <EmptyState
              illustration="no-matches"
              title="No news available"
              description="There are no stories for this selection right now. Check back soon."
            />
          }
        >
          {/* Featured */}
          {featured && (
            <a href={featured.url || '#'} target="_blank" rel="noopener noreferrer"
              className="block mb-4 rounded-2xl overflow-hidden bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors group shadow-[var(--shadow-sm)]">
              <div className="aspect-video relative overflow-hidden">
                <NewsImage
                  src={featured.image}
                  accent={resolveArticleLeague(featured)}
                  iconSize="lg"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-primary)]">Featured</span>
                  <h2 className="text-base font-bold text-white mt-0.5 line-clamp-2">{featured.title}</h2>
                  <p className="text-xs text-white/60 mt-1">{formatDate(featured.published)}</p>
                </div>
              </div>
            </a>
          )}

          {/* Article List */}
          <div className="space-y-0.5">
            {rest.map((article) => (
              <a key={article.id} href={article.url || '#'} target="_blank" rel="noopener noreferrer"
                className="flex gap-3 p-3 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors group shadow-[var(--shadow-sm)]">
                <NewsImage
                  src={article.image}
                  accent={resolveArticleLeague(article)}
                  className="w-20 h-14 rounded object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--accent-primary)] transition-colors">{article.title}</h3>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{formatDate(article.published)}</p>
                </div>
              </a>
            ))}
          </div>
        </AsyncSection>
      </div>
    </div>
  )
}
