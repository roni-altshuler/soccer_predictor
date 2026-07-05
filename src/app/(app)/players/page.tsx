'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { PlayerAvatar } from '@/components/primitives'
import { EmptyState } from '@/components/EmptyState'
import { Card } from '@/components/ui/card'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'

/**
 * Leading scorers per competition, from the same /api/leagues/leaders proxy
 * the league hubs use (ESPN leaders + statistics fallback, server-side).
 * Each entry pairs a leagueAccents competition id (for branding) with the
 * ESPN slug the provider expects — the women's universe uses ESPN's
 * women's league ids.
 */
const SCORER_SOURCES: Record<'M' | 'F', Array<{ accentId: string; espnSlug: string }>> = {
  M: [
    { accentId: 'eng.1', espnSlug: 'eng.1' },
    { accentId: 'esp.1', espnSlug: 'esp.1' },
    { accentId: 'ita.1', espnSlug: 'ita.1' },
    { accentId: 'ger.1', espnSlug: 'ger.1' },
    { accentId: 'fra.1', espnSlug: 'fra.1' },
    { accentId: 'ned.1', espnSlug: 'ned.1' },
    { accentId: 'por.1', espnSlug: 'por.1' },
    { accentId: 'usa.1', espnSlug: 'usa.1' },
  ],
  F: [
    { accentId: 'eng.1.w', espnSlug: 'eng.w.1' },
    { accentId: 'usa.1.w', espnSlug: 'usa.nwsl' },
  ],
}

interface LeaderRow {
  rank: number
  id?: number | null
  name: string
  team: string
  goals: number
  assists: number | null
  matches: number | null
}

interface PlayerEntry extends LeaderRow {
  leagueAccentId: string
  /** Set when the rows come from the last completed season, not the current one. */
  seasonLabel?: string
}

/** Human season label for the last completed season of a competition. */
function fallbackSeasonLabel(espnSlug: string): string {
  // MLS and NWSL run calendar-year seasons; European leagues span two years.
  return espnSlug === 'usa.1' || espnSlug === 'usa.nwsl' ? '2025' : '2025-26'
}

function PlayerRow({ player }: { player: PlayerEntry }) {
  const accent = getLeagueAccent(player.leagueAccentId)
  const inner = (
    <>
      <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-[var(--text-tertiary)]">
        {player.rank}
      </span>
      <PlayerAvatar playerId={player.id ?? undefined} name={player.name} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {player.name}
        </span>
        <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
          {[player.team, accent.shortName].filter(Boolean).join(' · ')}
        </span>
      </span>
      {player.assists != null ? (
        <span className="hidden shrink-0 text-[12px] tabular-nums text-[var(--text-tertiary)] sm:inline">
          {player.assists} A
        </span>
      ) : null}
      <span className="w-10 shrink-0 text-right text-[13px] font-bold tabular-nums text-[var(--text-primary)]">
        {player.goals}
        <span className="ml-1 text-[10px] font-semibold text-[var(--text-tertiary)]">G</span>
      </span>
    </>
  )

  const rowClass =
    'flex min-h-[48px] items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--card-hover)]'

  // Only players with a provider id have a profile route — never a dead link.
  if (player.id) {
    return (
      <Link href={`/players/${player.id}`} prefetch={false} className={rowClass}>
        {inner}
      </Link>
    )
  }
  return <div className={rowClass}>{inner}</div>
}

export default function PlayersPage() {
  const { asQueryParam } = useGenderQuery()
  const [players, setPlayers] = useState<PlayerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  // Reset search when the universe flips — the result set changes entirely.
  useEffect(() => {
    setQuery('')
  }, [asQueryParam])

  useEffect(() => {
    let cancelled = false
    const sources = SCORER_SOURCES[asQueryParam === 'F' ? 'F' : 'M']

    const load = async () => {
      setLoading(true)
      try {
        const fetchScorers = async (espnSlug: string, season?: string): Promise<LeaderRow[]> => {
          const seasonParam = season ? `&season=${encodeURIComponent(season)}` : ''
          const res = await fetch(
            `/api/leagues/leaders?league=${encodeURIComponent(espnSlug)}${seasonParam}`
          )
          if (!res.ok) return []
          const data = await res.json()
          return Array.isArray(data?.scorers) ? data.scorers : []
        }

        const results = await Promise.allSettled(
          sources.map(async ({ accentId, espnSlug }) => {
            // Current season first; between seasons the provider returns an
            // empty list, so fall back to the last completed season — and
            // label it honestly in the group header.
            const current = await fetchScorers(espnSlug)
            if (current.length > 0) {
              return current.map((s) => ({ ...s, leagueAccentId: accentId }))
            }
            const previous = await fetchScorers(espnSlug, '2025')
            return previous.map((s) => ({
              ...s,
              leagueAccentId: accentId,
              seasonLabel: fallbackSeasonLabel(espnSlug),
            }))
          })
        )
        if (cancelled) return
        setPlayers(
          results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        )
      } catch {
        if (!cancelled) setPlayers([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [asQueryParam])

  const grouped = useMemo(() => {
    const byLeague = new Map<string, PlayerEntry[]>()
    for (const p of players) {
      const list = byLeague.get(p.leagueAccentId) ?? []
      list.push(p)
      byLeague.set(p.leagueAccentId, list)
    }
    return Array.from(byLeague.entries())
  }, [players])

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return players
      .filter(
        (p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)
      )
      .sort((a, b) => b.goals - a.goals)
  }, [players, query])

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <h1 className="px-1 pb-3 text-lg font-bold tracking-tight text-[var(--text-primary)]">
        Players
      </h1>

      {/* Search — one quiet field */}
      <label className="relative mb-3 block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players or clubs…"
          aria-label="Search players"
          className="h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-primary)] focus:outline-none"
        />
      </label>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-48 animate-pulse rounded-xl bg-[var(--muted-bg)]" />
          <div className="h-48 animate-pulse rounded-xl bg-[var(--muted-bg)]" />
        </div>
      ) : players.length === 0 ? (
        <EmptyState
          illustration="no-matches"
          title="No player data right now"
          description="The stats provider hasn't published goal leaders for this universe yet — check back once matches are underway."
        />
      ) : searched ? (
        searched.length === 0 ? (
          <EmptyState
            illustration="no-matches"
            title={`No players match "${query.trim()}"`}
            description="Try a shorter name, or search by club."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-[var(--border-color)]/40">
              {searched.map((p) => (
                <li key={`${p.leagueAccentId}-${p.id ?? p.name}`}>
                  <PlayerRow player={p} />
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : (
        <div className="space-y-4">
          {grouped.map(([accentId, list]) => {
            const accent = getLeagueAccent(accentId)
            return (
              <Card key={accentId} className="overflow-hidden p-0">
                <div className="flex items-center gap-2 border-b border-[var(--border-color)]/40 bg-[var(--background-secondary)]/60 px-3 py-2">
                  {accent.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={accent.logoUrl}
                      alt=""
                      className="h-4 w-4 object-contain"
                      aria-hidden="true"
                    />
                  ) : null}
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                    {accent.displayName} · top scorers
                    {list[0]?.seasonLabel ? ` · ${list[0].seasonLabel}` : ''}
                  </p>
                </div>
                <ul className="divide-y divide-[var(--border-color)]/40">
                  {list.map((p) => (
                    <li key={`${accentId}-${p.id ?? p.name}`}>
                      <PlayerRow player={p} />
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
