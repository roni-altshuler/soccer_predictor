import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BarChart3, GitBranch, Scale, Sparkles } from 'lucide-react'

import GroupsGlance, { type GlanceGroup } from '@/components/worldcup/GroupsGlance'
import TodayAtTheCup, { type CupMatch } from '@/components/worldcup/TodayAtTheCup'
import WinnerProjectionsBoard, {
  type WinnerProjectionRow,
} from '@/components/worldcup/WinnerProjectionsBoard'
import { getBracketPaths } from '@/lib/server/worldCup'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'World Cup 2026 — AI predictions',
  description:
    'AI-powered 2026 FIFA World Cup hub: tournament winner probabilities, group advancement odds, and live match predictions from thousands of simulated tournament runs.',
}

const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings'
const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'

type Json = Record<string, unknown>

function asRecord(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

async function fetchJson(url: string, revalidateSeconds: number): Promise<Json | null> {
  try {
    // Timeout so a slow ESPN response can't stall prerender / ISR revalidation;
    // the page degrades to empty live sections rather than hanging the build.
    const res = await fetch(url, {
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return (await res.json()) as Json
  } catch {
    return null
  }
}

interface StandingsData {
  groups: GlanceGroup[]
  nameToId: Map<string, string>
}

async function loadStandings(): Promise<StandingsData> {
  const payload = await fetchJson(STANDINGS_URL, 300)
  const groups: GlanceGroup[] = []
  const nameToId = new Map<string, string>()
  for (const rawChild of asArray(payload?.children)) {
    const child = asRecord(rawChild)
    if (!child) continue
    const groupName = String(child.name ?? '')
    const letter = groupName.replace(/^Group\s+/i, '').trim().toUpperCase()
    if (!/^[A-L]$/.test(letter)) continue
    const teams = asArray(asRecord(child.standings)?.entries)
      .map((rawEntry) => {
        const entry = asRecord(rawEntry)
        const team = asRecord(entry?.team)
        const name = typeof team?.displayName === 'string' ? team.displayName : null
        if (!entry || !name) return null
        const stats = new Map<string, number>()
        for (const rawStat of asArray(entry.stats)) {
          const stat = asRecord(rawStat)
          if (typeof stat?.name === 'string' && typeof stat.value === 'number') {
            stats.set(stat.name, stat.value)
          }
        }
        const teamId = team?.id != null ? String(team.id) : undefined
        if (teamId) nameToId.set(name, teamId)
        return {
          name,
          teamId,
          played: Math.trunc(stats.get('gamesPlayed') ?? 0),
          points: Math.trunc(stats.get('points') ?? 0),
          rank: stats.get('rank') ?? 99,
        }
      })
      .filter((team): team is NonNullable<typeof team> => team !== null)
      .sort((a, b) => a.rank - b.rank)
      .map(({ name, teamId, played, points }) => ({ name, teamId, played, points }))
    groups.push({ letter, teams })
  }
  groups.sort((a, b) => a.letter.localeCompare(b.letter))
  return { groups, nameToId }
}

async function loadTodayMatches(): Promise<CupMatch[]> {
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const payload = await fetchJson(`${SCOREBOARD_URL}?dates=${today}`, 120)
  const matches: CupMatch[] = []
  for (const rawEvent of asArray(payload?.events)) {
    const event = asRecord(rawEvent)
    const comp = asRecord(asArray(event?.competitions)[0])
    if (!event || !comp) continue
    const competitors = asArray(comp.competitors).map(asRecord)
    const home = competitors.find((c) => c?.homeAway === 'home')
    const away = competitors.find((c) => c?.homeAway === 'away')
    const homeTeam = asRecord(home?.team)
    const awayTeam = asRecord(away?.team)
    if (!homeTeam?.displayName || !awayTeam?.displayName) continue
    const statusType = asRecord(asRecord(comp.status)?.type)
    const state = statusType?.state === 'in' ? 'in' : statusType?.state === 'post' ? 'post' : 'pre'
    const score = (side: Json | null | undefined): number | null => {
      const parsed = Number.parseInt(String(side?.score ?? ''), 10)
      return Number.isFinite(parsed) ? parsed : null
    }
    matches.push({
      id: String(event.id ?? ''),
      date: String(event.date ?? ''),
      status: state,
      statusDetail: typeof statusType?.shortDetail === 'string' ? statusType.shortDetail : undefined,
      home: { id: homeTeam.id != null ? String(homeTeam.id) : undefined, name: String(homeTeam.displayName), score: score(home) },
      away: { id: awayTeam.id != null ? String(awayTeam.id) : undefined, name: String(awayTeam.displayName), score: score(away) },
    })
  }
  matches.sort((a, b) => a.date.localeCompare(b.date))
  return matches
}

export default async function WorldCupHubPage() {
  const [bracket, standings, todayMatches] = await Promise.all([
    getBracketPaths(),
    loadStandings(),
    loadTodayMatches(),
  ])

  const projectionRows: WinnerProjectionRow[] = (bracket?.teams ?? []).map((team) => ({
    name: team.name,
    teamId: standings.nameToId.get(team.name),
    group: team.group,
    pChampion: team.p_champion,
    pFinal: team.p_final,
    pSemi: team.p_semi,
  }))
  const favourite = projectionRows[0]

  // Join model advance-to-knockout probability onto the standings cards.
  const advanceByName = new Map((bracket?.teams ?? []).map((t) => [t.name, t.p_r32]))
  const groups: GlanceGroup[] = standings.groups.map((group) => ({
    ...group,
    teams: group.teams.map((team) => ({ ...team, pAdvance: advanceByName.get(team.name) })),
  }))

  const liveCount = todayMatches.filter((m) => m.status === 'in').length

  return (
    <div className="mx-auto max-w-6xl px-4 pb-14">
      {/* Compact header band — title, live state, favourite. Data starts
          immediately below; no hero, no aurora, no CTA banner (v3.1 rule 1). */}
      <div className="flex flex-col gap-2 pb-3 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl">
            World Cup 2026
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
            {liveCount > 0 && (
              <>
                <span className="live-dot" aria-hidden="true" />
                <span className="font-semibold text-[var(--live-text)]">
                  {liveCount} live
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            Winner odds and match predictions from thousands of simulated tournament runs
          </p>
        </div>
        {favourite ? (
          <p className="text-xs text-[var(--text-secondary)]">
            Favourite{' '}
            <span className="font-bold text-[var(--text-primary)]">{favourite.name}</span>{' '}
            <span className="tabular-nums font-semibold text-[var(--accent-ai)]">
              {(favourite.pChampion * 100).toFixed(1)}%
            </span>
          </p>
        ) : null}
      </div>

      {/* Quiet section-nav chips — links, not marketing CTAs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-color)] pb-3">
        {[
          { href: '/leagues/fifa.world', label: 'Knockout bracket', icon: GitBranch },
          { href: '/world-cup/compare', label: 'Compare teams', icon: Scale },
          { href: '/simulator', label: 'Simulator', icon: BarChart3 },
          { href: '/accuracy', label: 'Model accuracy', icon: Sparkles },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>

      {/* Today's matches — the scores list leads the page */}
      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 text-[var(--text-primary)]">Today at the World Cup</h2>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)]"
          >
            Match centre <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <TodayAtTheCup matches={todayMatches} />
      </div>

      {/* Winner projections */}
      <div className="mt-10">
        {bracket && projectionRows.length > 0 ? (
          <WinnerProjectionsBoard
            rows={projectionRows}
            nSimulations={bracket.n_simulations}
            generatedAt={bracket.generated_at}
            bracketSet={bracket.bracket_set}
            source={bracket.source}
          />
        ) : (
          <p className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-5 text-small text-[var(--text-secondary)]">
            Winner projections are temporarily unavailable — the simulation snapshot has not been
            generated yet.
          </p>
        )}
      </div>

      {/* Groups */}
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 text-[var(--text-primary)]">Groups at a glance</h2>
          <Link
            href="/leagues/fifa.world"
            className="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)]"
          >
            Full tables <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <GroupsGlance groups={groups} />
      </div>
    </div>
  )
}
