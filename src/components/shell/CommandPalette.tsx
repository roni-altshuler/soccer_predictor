'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  BookOpen,
  Brain,
  Calculator,
  CalendarDays,
  Database,
  Globe2,
  History,
  Info,
  Medal,
  Newspaper,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react'

import { TeamBadge } from '@/components/primitives'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { useGenderPreference } from '@/hooks/useGenderPreference'
import { leaguesForGender } from '@/lib/leagueAccents'
import { useCommandPalette } from '@/store/commandPaletteStore'

const PAGES = [
  { href: '/', label: 'Matches', icon: Activity, hint: 'Scores + fixtures' },
  { href: '/upcoming', label: 'Fixtures', icon: CalendarDays, hint: 'Upcoming schedule' },
  { href: '/leagues', label: 'Leagues', icon: Trophy, hint: 'Browse competitions' },
  { href: '/world-cup', label: 'World Cup', icon: Globe2, hint: 'Tournament hub' },
  { href: '/tournaments', label: 'Tournaments', icon: Medal, hint: 'Brackets + group stages' },
  { href: '/players', label: 'Players', icon: Users, hint: 'Top scorers + form' },
  { href: '/predict', label: 'AI Predict', icon: Brain, hint: 'Custom match prediction', accent: 'ai' as const },
  { href: '/almanac', label: 'Almanac', icon: BookOpen, hint: 'Ask the history for a count' },
  { href: '/accuracy', label: 'Accuracy', icon: TrendingUp, hint: 'How well the calls hold up' },
  // Keeps matching a "history" search — the palette indexes label + hint.
  { href: '/history', label: 'Prediction Record', icon: History, hint: 'Full history: every call and its result' },
  { href: '/simulator', label: 'Simulator', icon: Calculator, hint: 'Run scenarios' },
  { href: '/news', label: 'News', icon: Newspaper, hint: 'Latest stories' },
  { href: '/diagnostics', label: 'Data Coverage', icon: Database, hint: 'Event timeline coverage by league' },
  { href: '/about', label: 'About', icon: Info, hint: 'How Pitchverse works' },
]

interface TeamHit {
  name: string
  league: string
}

/**
 * Debounced team lookup against /api/search-teams. Results feed a "Teams"
 * group in the palette; each hit deep-links into /predict with the team
 * pre-filled as the home side.
 */
function useTeamSearch(query: string, enabled: boolean) {
  const [hits, setHits] = useState<TeamHit[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!enabled || query.trim().length < 2) {
      setHits([])
      return
    }
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    const timer = setTimeout(() => {
      fetch(`/api/search-teams?q=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (controller.signal.aborted) return
          setHits(Array.isArray(data?.teams) ? data.teams.slice(0, 6) : [])
        })
        .catch(() => {})
    }, 160)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, enabled])

  return hits
}

export function CommandPalette() {
  const router = useRouter()
  const open = useCommandPalette((s) => s.open)
  const setOpen = useCommandPalette((s) => s.setOpen)
  const toggle = useCommandPalette((s) => s.toggle)
  const { gender, setGender } = useGenderPreference()
  const [query, setQuery] = useState('')

  const leagues = leaguesForGender(gender === 'women' ? 'F' : 'M')
  const teamHits = useTeamSearch(query, open)

  // Reset the query whenever the palette closes so it reopens fresh.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  // Keyboard shortcut — Cmd+K / Ctrl+K opens, also '/' when not in an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggle()
        return
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null
        const editing =
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.isContentEditable
        if (!editing) {
          e.preventDefault()
          setOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen, toggle])

  const go = (href: string) => {
    setOpen(false)
    // Push on the next frame: the Radix dialog close in the same tick
    // otherwise swallows the route transition (selection never navigated).
    requestAnimationFrame(() => router.push(href))
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search teams, leagues, pages…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {teamHits.length > 0 && (
          <>
            <CommandGroup heading="Teams">
              {teamHits.map((team) => (
                <CommandItem
                  key={`${team.name}-${team.league}`}
                  value={`${team.name} ${team.league} team`}
                  onSelect={() => go(`/predict?home=${encodeURIComponent(team.name)}`)}
                >
                  <TeamBadge name={team.name} size={20} className="mr-2 shrink-0" />
                  <span>{team.name}</span>
                  <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">
                    {team.league}
                  </span>
                  <CommandShortcut>AI predict</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Navigate">
          {PAGES.map((p) => {
            const Icon = p.icon
            return (
              <CommandItem
                key={p.href}
                value={`${p.label} ${p.hint}`}
                onSelect={() => go(p.href)}
              >
                <Icon
                  className={`mr-2 h-4 w-4 ${
                    p.accent === 'ai' ? 'text-[var(--accent-ai)]' : 'text-[var(--text-secondary)]'
                  }`}
                />
                <span>{p.label}</span>
                <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">{p.hint}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={`${gender === 'women' ? "Women's" : "Men's"} Leagues`}>
          {leagues.map((league) => (
            <CommandItem
              key={league.competitionId}
              value={`${league.displayName} ${league.shortName} ${league.country}`}
              onSelect={() => go(`/leagues/${league.competitionId}`)}
            >
              <span
                aria-hidden="true"
                className="mr-2 inline-block h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: league.accent }}
              />
              <span>{league.displayName}</span>
              <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">{league.country}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          <CommandItem
            value="gender toggle men women universe"
            onSelect={() => {
              setGender(gender === 'women' ? 'men' : 'women')
              setOpen(false)
            }}
          >
            <UserRound
              className={`mr-2 h-4 w-4 ${
                gender === 'women' ? 'text-[var(--accent-ai)]' : 'text-[var(--accent-women)]'
              }`}
            />
            <span>Switch to {gender === 'women' ? "men's" : "women's"} football</span>
            <CommandShortcut>universe</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
