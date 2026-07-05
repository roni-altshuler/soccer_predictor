'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import {
  Activity,
  Brain,
  Calculator,
  Gauge,
  History,
  Info,
  Medal,
  Newspaper,
  Sparkles,
  TrendingUp,
  Trophy,
  UserRound,
} from 'lucide-react'

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
  { href: '/leagues', label: 'Leagues', icon: Trophy, hint: 'Browse competitions' },
  { href: '/tournaments', label: 'Tournaments', icon: Medal, hint: 'Brackets + group stages' },
  { href: '/ai', label: 'Model hub', icon: Sparkles, hint: 'Model transparency', accent: 'ai' as const },
  { href: '/predict', label: 'AI Predict', icon: Brain, hint: 'Custom match prediction', accent: 'ai' as const },
  { href: '/accuracy', label: 'Accuracy', icon: TrendingUp, hint: 'Model performance' },
  { href: '/history', label: 'Prediction History', icon: History, hint: 'Past picks + outcomes' },
  { href: '/simulator', label: 'Simulator', icon: Calculator, hint: 'Run scenarios' },
  { href: '/news', label: 'News', icon: Newspaper, hint: 'Latest stories' },
  { href: '/diagnostics', label: 'Diagnostics', icon: Gauge, hint: 'Model health' },
  { href: '/about', label: 'About', icon: Info, hint: 'How Pitchwise works' },
]

export function CommandPalette() {
  const router = useRouter()
  const open = useCommandPalette((s) => s.open)
  const setOpen = useCommandPalette((s) => s.setOpen)
  const toggle = useCommandPalette((s) => s.toggle)
  const { gender, setGender } = useGenderPreference()

  const leagues = leaguesForGender(gender === 'women' ? 'F' : 'M')

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
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a page, league, or action…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

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
