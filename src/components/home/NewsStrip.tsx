'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Newspaper } from 'lucide-react'

import { useGenderQuery } from '@/hooks/useGenderQuery'
import { cn } from '@/lib/utils'

/**
 * Three latest news headlines as a horizontal carousel between the home
 * hero and the match list. Adds editorial weight to the home page
 * without competing with the AI-prediction CTA.
 */

interface NewsArticle {
  id: string
  title: string
  description: string
  published: string
  image: string | null
  url: string
  type: string
  category?: string
}

function relativeTime(input: string): string {
  try {
    const date = new Date(input)
    const diff = Date.now() - date.getTime()
    const hrs = Math.floor(diff / 3_600_000)
    if (hrs < 1) return 'Just now'
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

interface NewsStripProps {
  className?: string
}

export function NewsStrip({ className }: NewsStripProps) {
  const { asQueryParam } = useGenderQuery()
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/news?limit=4&gender=${asQueryParam}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('news fetch failed')
        const data = await res.json()
        if (cancelled) return
        setArticles((data.articles || []).slice(0, 4))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'news fetch failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [asQueryParam])

  if (error || (!loading && articles.length === 0)) return null

  return (
    <div className={cn('mx-auto w-full max-w-5xl px-4 pt-4', className)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          <Newspaper className="h-3 w-3" strokeWidth={2.5} />
          Latest news
        </span>
        <Link
          href="/news"
          className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-primary)] hover:underline"
        >
          See all
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="h-24 w-[280px] shrink-0 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
              />
            ))
          : articles.map((article) => (
              <Link
                key={article.id}
                href={article.url || '/news'}
                target={article.url ? '_blank' : undefined}
                rel={article.url ? 'noreferrer' : undefined}
                className="flex w-[280px] shrink-0 gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3 transition-colors hover:border-[var(--accent-primary)]"
              >
                {article.image ? (
                  <img
                    src={article.image}
                    alt=""
                    className="h-16 w-20 shrink-0 rounded object-cover ring-1 ring-[var(--border-color)]"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded bg-[var(--surface-highlight)] text-[var(--accent-ai)]">
                    <Newspaper className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12px] font-semibold leading-snug text-[var(--text-primary)]">
                    {article.title}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    {relativeTime(article.published)}
                  </p>
                </div>
              </Link>
            ))}
      </div>
    </div>
  )
}
