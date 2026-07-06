'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Newspaper } from 'lucide-react'

import { AsyncSection, LeagueChip } from '@/components/primitives'
import { EmptyState } from '@/components/EmptyState'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent, type LeagueAccent } from '@/lib/leagueAccents'
import { Card } from '@/components/ui/card'
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

/** 16:9 thumbnail that falls back to a flat league-accent block on error. */
function NewsThumb({
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
    return (
      <div
        className={cn('flex items-center justify-center bg-[var(--muted-bg)]', className)}
        style={accent ? { backgroundColor: accent.accentBg } : undefined}
        aria-hidden="true"
      >
        <Newspaper
          className={cn(
            iconSize === 'lg' ? 'h-7 w-7' : 'h-4 w-4',
            'text-[var(--text-tertiary)]'
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
      loading="lazy"
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
}: {
  accent: LeagueAccent | null
  published: string
  formatDate: (d: string) => string
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
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

  const [lead, ...rest] = filteredArticles
  const leadAccent = lead ? resolveArticleLeague(lead) : null

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <h1 className="px-1 pb-3 text-lg font-bold tracking-tight text-[var(--text-primary)]">
        News
      </h1>

      {/* Competition filter chips — one quiet, scrollable line */}
      {!loading && !error && leagueChips.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        {/* Lead story — one larger flat card */}
        {lead && (
          <a
            href={lead.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="group mb-3 flex flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] transition-colors hover:bg-[var(--card-hover)] sm:flex-row"
          >
            <NewsThumb
              src={lead.image}
              accent={leadAccent}
              iconSize="lg"
              className="aspect-video w-full shrink-0 object-cover sm:w-72 md:w-80"
            />
            <div className="min-w-0 flex-1 p-4">
              <h2 className="line-clamp-3 text-base font-bold leading-snug text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] md:text-lg">
                {lead.title}
              </h2>
              {lead.description ? (
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-[var(--text-secondary)]">
                  {lead.description}
                </p>
              ) : null}
              <div className="mt-2">
                <ArticleMeta accent={leadAccent} published={lead.published} formatDate={formatDate} />
              </div>
            </div>
          </a>
        )}

        {/* Headline rows — dense list, thumbnail left */}
        {rest.length > 0 && (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-[var(--border-color)]/40">
              {rest.map((article) => {
                const accent = resolveArticleLeague(article)
                return (
                  <li key={article.id}>
                    <a
                      href={article.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-h-[64px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--card-hover)]"
                    >
                      <NewsThumb
                        src={article.image}
                        accent={accent}
                        className="aspect-video w-24 flex-shrink-0 rounded-md object-cover sm:w-28"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">
                          {article.title}
                        </h3>
                        <div className="mt-1">
                          <ArticleMeta
                            accent={accent}
                            published={article.published}
                            formatDate={formatDate}
                          />
                        </div>
                      </div>
                    </a>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </AsyncSection>
    </div>
  )
}
