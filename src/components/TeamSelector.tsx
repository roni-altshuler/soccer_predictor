'use client'

/**
 * MatchupPicker — the /predict input experience.
 *
 * Two identity panels (home / away) facing a centre "vs" divider with a
 * swap button. Each empty panel is a league → team cascade: a league select
 * that scopes a searchable team combobox (type to filter, or browse the
 * whole league). Once a team is picked the panel becomes an identity card:
 * flag (national sides) or accent-tinted crest chip (clubs), the league
 * context line, and a last-5 form pill when ESPN has settled matches for
 * that club — never fabricated, hidden otherwise.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ChevronDown, Home, Plane, Search, X } from 'lucide-react'

import { leagueNames, teams as teamCatalog } from '@/data/leagues'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { FlagBadge, TeamBadge } from '@/components/primitives'
import { TeamFormPill } from '@/components/match/TeamFormPill'
import { cn } from '@/lib/utils'

export interface TeamPick {
  name: string
  league: string
}

/** Competitions whose "teams" are nations — identity is a country flag. */
const NATIONAL_COMPETITIONS = new Set<string>([
  'FIFA World Cup',
  'UEFA European Championship',
  'Copa America',
])

/** FIFA-style names → the common names FlagBadge resolves to iso2 codes. */
const COUNTRY_NAME_FIX: Record<string, string> = {
  'korea republic': 'South Korea',
  'ir iran': 'Iran',
  'china pr': 'China',
  'rep. of ireland': 'Ireland',
}

export function isNationalCompetition(league: string): boolean {
  return NATIONAL_COMPETITIONS.has(league)
}

export function flagCountryFor(teamName: string): string {
  return COUNTRY_NAME_FIX[teamName.trim().toLowerCase()] ?? teamName
}

/** Strip "(UCL)"-style suffixes so getLeagueAccent's aliases resolve. */
export function leagueAccentFor(league: string) {
  return getLeagueAccent(league.replace(/\s*\([^)]*\)\s*$/, ''))
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Resolve a free-text team name (e.g. from the ESPN scoreboard) to an entry
 * in the static catalog. Exact normalized match only — never guesses.
 */
export function resolveCatalogTeam(
  name: string,
  preferredLeague?: string
): TeamPick | null {
  const norm = normalizeName(name)
  if (!norm) return null
  const order = preferredLeague
    ? [preferredLeague, ...leagueNames.filter((l) => l !== preferredLeague)]
    : [...leagueNames]
  for (const league of order) {
    const hit = (teamCatalog[league] ?? []).find((t) => normalizeName(t) === norm)
    if (hit) return { name: hit, league }
  }
  return null
}

/** ESPN league ids the /api/team_form route can answer for (clubs only). */
const FORM_LEAGUES = new Set([
  'eng.1',
  'esp.1',
  'ita.1',
  'ger.1',
  'fra.1',
  'ned.1',
  'por.1',
  'usa.1',
  'uefa.champions',
  'uefa.europa',
])

interface TeamOption {
  name: string
  league: string
}

function TeamIdentity({
  pick,
  side,
  onClear,
}: {
  pick: TeamPick
  side: 'home' | 'away'
  onClear: () => void
}) {
  const accent = leagueAccentFor(pick.league)
  const national = isNationalCompetition(pick.league)
  const [form, setForm] = useState<string | null>(null)

  useEffect(() => {
    setForm(null)
    if (!FORM_LEAGUES.has(accent.competitionId)) return
    let cancelled = false
    fetch(`/api/team_form/${accent.competitionId}/${encodeURIComponent(pick.name)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const results = Array.isArray(data?.form) ? (data.form as string[]) : []
        // API returns most-recent first; TeamFormPill wants it on the right.
        if (results.length > 0) setForm([...results].reverse().join(''))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pick.name, accent.competitionId])

  return (
    <div className="relative flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)]/40 px-3 py-4 text-center">
      <button
        type="button"
        onClick={onClear}
        aria-label={`Change ${side} team`}
        className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      {national ? (
        <FlagBadge country={flagCountryFor(pick.name)} teamName={pick.name} size={52} />
      ) : (
        <TeamBadge name={pick.name} teamColor={accent.accent} size={52} />
      )}
      <p className="max-w-full truncate text-base font-bold text-[var(--text-primary)]">
        {pick.name}
      </p>
      <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent.accent }}
        />
        {accent.displayName !== 'Match' ? accent.displayName : pick.league}
      </p>
      {form && (
        <div className="flex items-center gap-1.5">
          <TeamFormPill form={form} size="sm" teamName={pick.name} />
          <span className="text-[10px] text-[var(--text-tertiary)]">last 5</span>
        </div>
      )}
    </div>
  )
}

function TeamPickerControls({
  side,
  otherPick,
  onPick,
}: {
  side: 'home' | 'away'
  /** The already-selected opposite team — excluded from results. */
  otherPick: TeamPick | null
  onPick: (pick: TeamPick) => void
}) {
  const [league, setLeague] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const results = useMemo<TeamOption[]>(() => {
    const q = query.trim().toLowerCase()
    const source: TeamOption[] = league
      ? (teamCatalog[league] ?? []).map((name) => ({ name, league }))
      : leagueNames.flatMap((lg) =>
          (teamCatalog[lg] ?? []).map((name) => ({ name, league: lg }))
        )
    // With a league picked and no query, browsing the full league is useful;
    // across all leagues require at least 2 chars to keep the list sane.
    const filtered =
      q.length > 0
        ? source.filter((t) => t.name.toLowerCase().includes(q))
        : league
          ? source
          : []
    const seen = new Set<string>()
    const deduped: TeamOption[] = []
    for (const t of filtered) {
      const key = t.name.toLowerCase()
      if (seen.has(key)) continue
      if (otherPick && t.name === otherPick.name) continue
      seen.add(key)
      deduped.push(t)
    }
    deduped.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q)
      const bStarts = b.name.toLowerCase().startsWith(q)
      if (aStarts !== bStarts) return aStarts ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return deduped.slice(0, 40)
  }, [query, league, otherPick])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (option: TeamOption) => {
    onPick(option)
    setQuery('')
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-[180px] flex-col justify-center gap-2.5 rounded-xl border border-dashed border-[var(--border-color)] p-3"
    >
      <div className="relative">
        <select
          value={league}
          onChange={(e) => {
            setLeague(e.target.value)
            setQuery('')
            setOpen(false)
          }}
          aria-label={`${side === 'home' ? 'Home' : 'Away'} team league`}
          className="min-h-[44px] w-full appearance-none rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] pl-3 pr-9 text-sm text-[var(--text-primary)] shadow-sm transition-shadow focus:border-[var(--accent-ai)]/70 focus:outline-none focus:ring-2 focus:ring-[var(--accent-ai)]/30"
        >
          <option value="">All leagues</option>
          {leagueNames.map((lg) => (
            <option key={lg} value={lg}>
              {lg}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
      </div>

      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length > 0) {
              e.preventDefault()
              select(results[0])
            }
            if (e.key === 'Escape') setOpen(false)
          }}
          aria-label={`${side === 'home' ? 'Home' : 'Away'} team`}
          placeholder={league ? `Search ${league}…` : 'Type to search any team…'}
          className="min-h-[44px] w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] shadow-sm transition-shadow focus:border-[var(--accent-ai)]/70 focus:outline-none focus:ring-2 focus:ring-[var(--accent-ai)]/30"
        />

        {open && results.length > 0 && (
          <div className="absolute z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-2xl">
            {results.map((option) => {
              const accent = leagueAccentFor(option.league)
              return (
                <button
                  key={`${option.league}-${option.name}`}
                  type="button"
                  onClick={() => select(option)}
                  className="flex min-h-[40px] w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--card-hover)]"
                >
                  {isNationalCompetition(option.league) ? (
                    <FlagBadge
                      country={flagCountryFor(option.name)}
                      teamName={option.name}
                      size={18}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: accent.accent }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">
                    {option.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                    {accent.shortName !== 'Match' ? accent.shortName : option.league}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {open && query.trim().length >= 2 && results.length === 0 && (
          <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3 text-center text-xs text-[var(--text-tertiary)] shadow-2xl">
            No teams found{league ? ` in ${league}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

export interface MatchupPickerProps {
  home: TeamPick | null
  away: TeamPick | null
  onHomeChange: (pick: TeamPick | null) => void
  onAwayChange: (pick: TeamPick | null) => void
  onSwap: () => void
}

export function MatchupPicker({
  home,
  away,
  onHomeChange,
  onAwayChange,
  onSwap,
}: MatchupPickerProps) {
  const canSwap = Boolean(home || away)

  return (
    <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          <Home className="h-3 w-3" aria-hidden="true" />
          Home
        </p>
        {home ? (
          <TeamIdentity pick={home} side="home" onClear={() => onHomeChange(null)} />
        ) : (
          <TeamPickerControls side="home" otherPick={away} onPick={onHomeChange} />
        )}
      </div>

      <div className="flex items-center justify-center gap-3 md:flex-col md:gap-2.5 md:pt-5">
        <span
          aria-hidden="true"
          className="hidden h-8 w-px bg-[var(--border-color)] md:block"
        />
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] text-[11px] font-black uppercase text-[var(--text-tertiary)]">
          vs
        </span>
        <button
          type="button"
          onClick={onSwap}
          disabled={!canSwap}
          aria-label="Swap home and away teams"
          title="Swap home and away"
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] transition-colors',
            canSwap
              ? 'hover:border-[var(--accent-ai)]/60 hover:text-[var(--accent-ai)]'
              : 'cursor-not-allowed opacity-40'
          )}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <span
          aria-hidden="true"
          className="hidden h-8 w-px bg-[var(--border-color)] md:block"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)] md:justify-end">
          <Plane className="h-3 w-3" aria-hidden="true" />
          Away
        </p>
        {away ? (
          <TeamIdentity pick={away} side="away" onClear={() => onAwayChange(null)} />
        ) : (
          <TeamPickerControls side="away" otherPick={home} onPick={onAwayChange} />
        )}
      </div>
    </div>
  )
}
