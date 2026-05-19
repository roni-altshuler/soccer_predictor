'use client'

import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type Kind = 'team' | 'league' | 'match' | 'player'

interface SearchHit {
  kind: Kind
  id: string
  name: string
  subtitle: string
  href: string
  score: number
}

interface SearchResponse {
  query: string
  results: SearchHit[]
  total: number
  generated_at: string
}

const POPULAR_SUGGESTIONS: SearchHit[] = [
  {
    kind: 'team',
    id: 'real-madrid',
    name: 'Real Madrid',
    subtitle: 'Team · La Liga',
    href: '/teams/real-madrid',
    score: 1,
  },
  {
    kind: 'team',
    id: 'manchester-city',
    name: 'Manchester City',
    subtitle: 'Team · Premier League',
    href: '/teams/manchester-city',
    score: 1,
  },
  {
    kind: 'team',
    id: 'fc-barcelona',
    name: 'FC Barcelona',
    subtitle: 'Team · La Liga',
    href: '/teams/fc-barcelona',
    score: 1,
  },
]

function KindIcon({ kind }: { kind: Kind }) {
  if (kind === 'league') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    )
  }
  if (kind === 'match') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    )
  }
  if (kind === 'player') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    )
  }
  // team
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 7 12 3 4 7v6c0 5 8 8 8 8s8-3 8-8Z" />
    </svg>
  )
}

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

interface OmniSearchProps {
  variant?: 'desktop' | 'mobile'
}

export function OmniSearch({ variant = 'desktop' }: OmniSearchProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showSuggestions = query.trim().length === 0
  const visibleHits = showSuggestions ? POPULAR_SUGGESTIONS : hits

  // --- Fetch -----------------------------------------------------------
  const runQuery = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q) {
      setHits([])
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`, {
        signal: ctrl.signal,
      })
      if (!res.ok) {
        setHits([])
        return
      }
      const data: SearchResponse = await res.json()
      setHits(Array.isArray(data.results) ? data.results : [])
      setActiveIndex(0)
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setHits([])
      }
    } finally {
      if (abortRef.current === ctrl) {
        setLoading(false)
      }
    }
  }, [])

  // Debounce input -> fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!open) return
    if (!query.trim()) {
      setHits([])
      return
    }
    debounceRef.current = setTimeout(() => runQuery(query), 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open, runQuery])

  // --- Open/close helpers ---------------------------------------------
  const openSearch = useCallback(() => {
    setOpen(true)
    // Defer focus to allow the input to mount in the mobile sheet variant.
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const closeSearch = useCallback(() => {
    setOpen(false)
    setQuery('')
    setHits([])
    setActiveIndex(0)
    abortRef.current?.abort()
  }, [])

  const navigateTo = useCallback(
    (hit: SearchHit) => {
      if (!hit?.href) return
      closeSearch()
      router.push(hit.href)
    },
    [router, closeSearch],
  )

  // --- Keyboard shortcuts (global) ------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (target?.isContentEditable ?? false)

      // Cmd/Ctrl + K opens search from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) {
          closeSearch()
        } else {
          openSearch()
        }
        return
      }

      // "/" opens search (when not already typing somewhere else).
      if (e.key === '/' && !isTyping && !open) {
        e.preventDefault()
        openSearch()
        return
      }

      if (e.key === 'Escape' && open) {
        e.preventDefault()
        closeSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openSearch, closeSearch])

  // --- Click outside ---------------------------------------------------
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      if (!container.contains(e.target as Node)) {
        closeSearch()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, closeSearch])

  // --- Keyboard navigation within results -----------------------------
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(visibleHits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = visibleHits[activeIndex]
      if (hit) navigateTo(hit)
    }
  }

  const dropdownClass = useMemo(() => {
    if (variant === 'mobile') {
      return 'fixed inset-0 z-[60] bg-[var(--background)]/98 backdrop-blur-md flex flex-col'
    }
    return 'absolute right-0 mt-2 w-[420px] max-w-[calc(100vw-32px)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl shadow-2xl shadow-black/40 z-[60] overflow-hidden'
  }, [variant])

  // --- Render ----------------------------------------------------------
  if (variant === 'mobile') {
    return (
      <>
        <button
          type="button"
          aria-label="Open search"
          onClick={openSearch}
          className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover)]"
        >
          <SearchIcon size={18} />
        </button>
        {open && (
          <div ref={containerRef} className={dropdownClass} role="dialog" aria-modal="true">
            <div className="flex items-center gap-2 px-3 h-14 border-b border-[var(--border-color)]">
              <SearchIcon size={18} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search teams, leagues, matches..."
                className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]"
              >
                Cancel
              </button>
            </div>
            <ResultsList
              query={query}
              loading={loading}
              hits={visibleHits}
              showingSuggestions={showSuggestions}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onSelect={navigateTo}
            />
          </div>
        )}
      </>
    )
  }

  // Desktop variant
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={openSearch}
        aria-label="Open search"
        className="flex items-center gap-2 h-9 px-3 rounded-lg border border-[var(--border-color)]/70 bg-[var(--card-bg)]/65 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover)]/85 text-xs font-medium transition-colors"
      >
        <SearchIcon size={14} />
        <span className="hidden lg:inline">Search teams, leagues...</span>
        <span className="hidden lg:inline ml-2 text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-tertiary)]">/</span>
      </button>

      {open && (
        <div className={dropdownClass} role="dialog" aria-modal="false">
          <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--border-color)]">
            <SearchIcon size={16} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search teams, leagues, matches..."
              className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-tertiary)]">Esc</span>
          </div>
          <ResultsList
            query={query}
            loading={loading}
            hits={visibleHits}
            showingSuggestions={showSuggestions}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onSelect={navigateTo}
          />
        </div>
      )}
    </div>
  )
}

interface ResultsListProps {
  query: string
  loading: boolean
  hits: SearchHit[]
  showingSuggestions: boolean
  activeIndex: number
  onHover: (i: number) => void
  onSelect: (hit: SearchHit) => void
}

function ResultsList({
  query,
  loading,
  hits,
  showingSuggestions,
  activeIndex,
  onHover,
  onSelect,
}: ResultsListProps) {
  // Group results by kind for visual sections, but keep a flat activeIndex
  // walking the rendered order.
  const order: Kind[] = ['team', 'league', 'match', 'player']
  const grouped: Record<Kind, SearchHit[]> = {
    team: [],
    league: [],
    match: [],
    player: [],
  }
  for (const hit of hits) {
    if (grouped[hit.kind]) {
      grouped[hit.kind].push(hit)
    }
  }
  // Build flat render list mirroring the order shown so activeIndex aligns.
  const flat: SearchHit[] = []
  for (const k of order) flat.push(...grouped[k])

  return (
    <div className="max-h-[60vh] overflow-y-auto py-1">
      {showingSuggestions && (
        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Popular
        </div>
      )}

      {loading && !showingSuggestions && (
        <div className="px-3 py-3 text-xs text-[var(--text-tertiary)]">Searching...</div>
      )}

      {!loading && !showingSuggestions && hits.length === 0 && (
        <div className="px-3 py-4 text-sm text-[var(--text-secondary)]">
          No results for &ldquo;{query}&rdquo;
        </div>
      )}

      {order.map((kind) => {
        const items = grouped[kind]
        if (items.length === 0) return null
        return (
          <div key={kind}>
            {!showingSuggestions && (
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                {kind === 'team'
                  ? 'Teams'
                  : kind === 'league'
                  ? 'Leagues'
                  : kind === 'match'
                  ? 'Matches'
                  : 'Players'}
              </div>
            )}
            {items.map((hit) => {
              const flatIdx = flat.indexOf(hit)
              const active = flatIdx === activeIndex
              return (
                <button
                  key={`${hit.kind}-${hit.id}`}
                  type="button"
                  onMouseEnter={() => onHover(flatIdx)}
                  onClick={() => onSelect(hit)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    active ? 'bg-[#7c3aed]/18' : 'hover:bg-[var(--card-hover)]/70'
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-7 h-7 rounded-md border ${
                      active
                        ? 'border-[#7c3aed]/60 text-[#7c3aed]'
                        : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <KindIcon kind={hit.kind} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">
                      {hit.name}
                    </span>
                    {hit.subtitle && (
                      <span className="block text-[11px] text-[var(--text-tertiary)] truncate">
                        {hit.subtitle}
                      </span>
                    )}
                  </span>
                  {active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#7c3aed]/60 text-[#7c3aed]">
                      Enter
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export default OmniSearch
