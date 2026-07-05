'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Newspaper } from 'lucide-react'

import { AsyncSection, LeagueChip, SectionHeader } from '@/components/primitives'
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
            accent ? 'text-[var(--pitch-text)] opacity-90' : 'text-[var(--text-tertiary)]'
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

/** Accent dot + league short name + relative time, shared by story rows. */
function ArticleMeta({
  accent,
  published,
  formatDate,
  onScrim = false,
}: {
  accent: LeagueAccent | null
  published: string
  formatDate: (d: string) => string
  onScrim?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-[11px] font-medium',
        onScrim ? '' : 'text-[var(--text-tertiary)]'
      )}
      style={onScrim ? { color: 'color-mix(in srgb, var(--pitch-text) 72%, transparent)' } : undefined}
    >
      {accent && (
        <>
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: accent.accent }}
          />
          <span className="truncate">{accent.shortName}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <time dateTime={published}>{formatDate(published)}</time>
    </div>
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
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-8">
        <h1 className="sr-only">Pitchwise Newsroom — latest football headlines</h1>

        {/* Hero band */}
        <div className="hero-band surface-elevated mb-5 p-5 md:p-6">
          <SectionHeader
            kicker="Newsroom"
            title="Latest Football Headlines"
            description="Curated breaking stories, transfer chatter, and tactical updates in one feed."
            action={
              !loading && !error && articles.length > 0 ? (
                <div className="text-right">
                  <p className="text-2xl font-black leading-tight tabular-nums text-[var(--text-primary)]">
                    {articles.length}
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    stories
                  </p>
                </div>
              ) : undefined
            }
          />
        </div>

        {/* League filter chips — horizontal scroll on mobile */}
        {!loading && !error && leagueChips.length > 0 && (
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <LeagueChip
              name="All"
              size="sm"
              active={activeLeague === 'all'}
              onClick={() => setActiveLeague('all')}
              className="flex-shrink-0"
            />
            {leagueChips.map((chip) => (
              <LeagueChip
                key={chip.competitionId}
                leagueId={chip.competitionId}
                name={chip.shortName}
                size="sm"
                active={activeLeague === chip.competitionId}
                onClick={() => setActiveLeague(chip.competitionId)}
                className="flex-shrink-0"
              />
            ))}
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
            <a
              href={featured.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="surface-elevated group mb-5 block overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] transition-colors hover:border-[var(--border-hover)]"
            >
              <div className="relative aspect-video overflow-hidden">
                <NewsImage
                  src={featured.image}
                  accent={resolveArticleLeague(featured)}
                  iconSize="lg"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {/* Scrim: bottom 60% fading to transparent so the headline always passes contrast */}
                <div
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-[60%]"
                  style={{
                    background:
                      'linear-gradient(to top, var(--overlay-bg) 0%, var(--overlay-bg) 30%, transparent 100%), linear-gradient(to top, var(--overlay-bg) 0%, transparent 72%)',
                  }}
                />
                <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-sm"
                    style={{
                      color: 'var(--accent-primary-soft)',
                      backgroundColor: 'color-mix(in srgb, var(--accent-primary) 22%, var(--overlay-bg))',
                    }}
                  >
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: 'var(--accent-primary-soft)' }}
                    />
                    Featured
                  </span>
                  <h2
                    className="mt-1.5 line-clamp-2 text-base font-bold md:text-lg"
                    style={{ color: 'var(--pitch-text)' }}
                  >
                    {featured.title}
                  </h2>
                  <div className="mt-1.5">
                    <ArticleMeta
                      accent={resolveArticleLeague(featured)}
                      published={featured.published}
                      formatDate={formatDate}
                      onScrim
                    />
                  </div>
                </div>
              </div>
            </a>
          )}

          {/* Secondary stories — 2-col grid on desktop */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {rest.map((article) => {
              const accent = resolveArticleLeague(article)
              return (
                <a
                  key={article.id}
                  href={article.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-h-[88px] items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
                >
                  <NewsImage
                    src={article.image}
                    accent={accent}
                    className="h-16 w-24 flex-shrink-0 rounded-lg object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-sm font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--accent-primary)]">
                      {article.title}
                    </h3>
                    <div className="mt-1.5">
                      <ArticleMeta
                        accent={accent}
                        published={article.published}
                        formatDate={formatDate}
                      />
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        </AsyncSection>
      </div>
    </div>
  )
}
