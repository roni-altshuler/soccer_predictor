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
    'AI-powered 2026 FIFA World Cup hub: tournament winner probabilities, group advancement odds, and live match predictions from calibrated Monte Carlo simulations.',
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
    const res = await fetch(url, { next: { revalidate: revalidateSeconds } })
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
      {/* Hero */}
      <section className="relative isolate -mx-4 overflow-hidden border-b border-[var(--border-color)] px-4 pb-10 pt-12 sm:pt-16">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(55%_60%_at_18%_10%,color-mix(in_srgb,var(--accent-ai)_22%,transparent),transparent_62%),radial-gradient(50%_55%_at_85%_18%,color-mix(in_srgb,var(--accent-primary)_20%,transparent),transparent_62%),radial-gradient(40%_45%_at_55%_95%,color-mix(in_srgb,var(--accent-warn)_12%,transparent),transparent_60%)]"
        />
        <div className="mx-auto max-w-4xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-loss)]" />
            FIFA World Cup 2026 · Group stage live
            {liveCount > 0 ? ` · ${liveCount} match${liveCount === 1 ? '' : 'es'} in play` : ''}
          </p>
          <h1 className="mt-4 font-display text-[clamp(2rem,6vw,3.6rem)] font-extrabold leading-[1.05] tracking-tight text-[var(--text-primary)]">
            Who wins the World Cup?
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-body text-[var(--text-secondary)]">
            Calibrated Monte Carlo simulations over the official 48-team bracket — winner
            probabilities, group advancement odds, and a prediction for every match.
          </p>
          {favourite ? (
            <p className="mt-4 text-small text-[var(--text-secondary)]">
              Current model favourite:{' '}
              <span className="font-bold text-[var(--text-primary)]">{favourite.name}</span>{' '}
              <span className="font-mono text-[var(--accent-ai)]">
                {(favourite.pChampion * 100).toFixed(1)}%
              </span>
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/leagues/fifa.world"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-primary)] px-5 py-2.5 text-small font-bold text-white transition-opacity hover:opacity-90"
            >
              <GitBranch className="h-4 w-4" /> Knockout bracket
            </Link>
            <Link
              href="/simulator"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-2.5 text-small font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
            >
              <BarChart3 className="h-4 w-4" /> Run your own simulation
            </Link>
            <Link
              href="/world-cup/compare"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-2.5 text-small font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
            >
              <Scale className="h-4 w-4" /> Compare teams
            </Link>
            <Link
              href="/accuracy"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-2.5 text-small font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
            >
              <Sparkles className="h-4 w-4 text-[var(--accent-ai)]" /> Model accuracy
            </Link>
          </div>
        </div>
      </section>

      {/* Winner projections */}
      <div className="mt-8">
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

      {/* Today's matches */}
      <div className="mt-10">
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
