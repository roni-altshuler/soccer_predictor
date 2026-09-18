'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowUpRight, ChevronDown, MapPin } from 'lucide-react'

import type { DayMatch } from '@/hooks/useMatchday'
import { FlagBadge } from '@/components/primitives/FlagBadge'
import { LeagueMark } from '@/components/primitives/LeagueMark'
import { ProbBar } from '@/components/primitives/ProbBar'
import { FollowTeamButton } from '@/components/team/FollowTeamButton'
import { isValidProbabilityTriple } from '@/lib/probabilityValidation'
import { cn } from '@/lib/utils'

export function fixtureHref(match: DayMatch) {
  return match.id ? `/matches/${encodeURIComponent(match.id)}${match.leagueId ? `?league=${encodeURIComponent(match.leagueId)}` : ''}` : undefined
}

function kickoff(time?: string) {
  const date = time ? new Date(time) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Time TBC'
}

export function MatchdaySpotlight({ matches }: { matches: DayMatch[] }) {
  const [selected, setSelected] = useState<string>()
  const match = matches.find((m) => m.id === selected) ?? matches[0]
  if (!match) return null
  const probabilities = { home: match.ai_home_prob, draw: match.ai_draw_prob, away: match.ai_away_prob }
  const valid = isValidProbabilityTriple(probabilities)
  const live = match.status === 'live'
  const finished = ['completed', 'finished'].includes(match.status)
  const href = fixtureHref(match)

  return (
    <section aria-label="Match spotlight" className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <LeagueMark league={match.leagueId ?? match.league} size="sm" />
          <span className="truncate text-xs font-semibold text-[var(--text-secondary)]">{match.league}</span>
        </div>
        <span className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-widest', live ? 'text-[var(--live-text)]' : 'text-[var(--text-tertiary)]')}>
          {live ? `Live${match.minute ? ` · ${match.minute}′` : ''}` : finished ? 'Full time' : 'Match spotlight'}
        </span>
      </div>

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
          <div className="flex min-w-0 flex-col items-center gap-2 text-center">
            <FlagBadge key={match.home_team} teamName={match.home_team} logoUrl={match.home_crest_url ?? undefined} size={52} />
            <p className="text-base font-bold leading-tight text-[var(--text-primary)] sm:text-xl">{match.home_team}</p>
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">Home</span>
          </div>
          <div className="pt-3 text-center">
            <p className={cn('font-numeric font-bold tabular-nums text-[var(--text-primary)]', !live && !finished && kickoff(match.time) === 'Time TBC' ? 'text-lg sm:text-2xl' : 'text-3xl sm:text-4xl')}>
              {live || finished ? `${match.home_score ?? '–'} : ${match.away_score ?? '–'}` : kickoff(match.time)}
            </p>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">{live ? 'In play' : finished ? 'Final score' : kickoff(match.time) === 'Time TBC' ? 'Kickoff' : 'Your local time'}</p>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2 text-center">
            <FlagBadge key={match.away_team} teamName={match.away_team} logoUrl={match.away_crest_url ?? undefined} size={52} />
            <p className="text-base font-bold leading-tight text-[var(--text-primary)] sm:text-xl">{match.away_team}</p>
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">Away</span>
          </div>
        </div>

        {valid && (
          <div className="mt-5 rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              <span>Pre-match forecast</span>
              {match.predicted_scoreline && <span className="text-[var(--accent-info)]">Score pick {match.predicted_scoreline}</span>}
            </div>
            <ProbBar home={probabilities.home!} draw={probabilities.draw!} away={probabilities.away!} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {([['Home win', probabilities.home], ['Draw', probabilities.draw], ['Away win', probabilities.away]] as const).map(([label, value]) => (
                <div key={label}>
                  <p className="font-numeric text-lg font-bold text-[var(--text-primary)]">{Math.round(value! * 100)}<span className="text-xs text-[var(--text-tertiary)]">%</span></p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {match.venue ? <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{match.venue}</span> : <span className="text-[11px] text-[var(--text-tertiary)]">{valid ? 'Every outcome is still possible.' : 'Follow the match as it unfolds.'}</span>}
          {href && <Link href={href} className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[var(--accent-info)] hover:underline">Match centre <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>}
        </div>
      </div>

      {matches.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-t border-[var(--border-color)] p-2" aria-label="Choose spotlight match">
          {matches.map((m) => (
            <button key={m.id} type="button" onClick={() => setSelected(m.id)} aria-pressed={m.id === match.id}
              className={cn('flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-[11px] transition-colors', m.id === match.id ? 'border-[var(--border-hover)] bg-[var(--card-hover)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:bg-[var(--card-hover)]')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', m.status === 'live' ? 'bg-[var(--accent-loss)]' : 'bg-[var(--border-hover)]')} aria-hidden />
              {m.home_team} <span className="text-[var(--text-tertiary)]">v</span> {m.away_team}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function ClubHouse({ matches }: { matches: DayMatch[] }) {
  const [expanded, setExpanded] = useState(false)
  const clubs = Array.from(new Map(matches.flatMap((m) => [
    [m.home_team, { name: m.home_team, crest: m.home_crest_url, league: m.league }],
    [m.away_team, { name: m.away_team, crest: m.away_crest_url, league: m.league }],
  ] as const)).values()).slice(0, 4)

  return (
    <aside aria-label="Your football" className="flex min-w-0 flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2 lg:p-5">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls="matchday-clubs" className="flex min-h-11 items-center justify-between gap-2 text-xs font-semibold text-[var(--text-primary)] lg:hidden">Make it your matchday · follow clubs <ChevronDown className={cn('h-4 w-4', expanded && 'rotate-180')} aria-hidden /></button>
      <div id="matchday-clubs" className={cn('flex-1 flex-col lg:flex', expanded ? 'flex' : 'hidden')}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">Your football</p>
      <h2 className="mt-2 text-base font-bold text-[var(--text-primary)]">Make it your matchday</h2>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">Follow your clubs. Keep their fixtures a tap away, saved on this device.</p>
      <div className="mt-3 divide-y divide-[var(--border-color)]">
        {clubs.map((club) => <div key={club.name} className="flex min-h-16 items-center gap-2 py-2">
          <span aria-hidden><FlagBadge teamName={club.name} logoUrl={club.crest ?? undefined} size={24} /></span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]">{club.name}</span>
          <FollowTeamButton teamName={club.name} league={club.league} className="shrink-0 px-2 text-[10px]" />
        </div>)}
      </div>
      <Link href="/leagues" className="mt-auto flex min-h-11 items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3 text-xs text-[var(--accent-info)]">Explore the season ahead <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    </aside>
  )
}
