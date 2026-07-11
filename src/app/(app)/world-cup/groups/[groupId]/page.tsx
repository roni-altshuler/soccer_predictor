import Link from 'next/link'
import { headers } from 'next/headers'
import { ChevronLeft } from 'lucide-react'

import GroupAdvancementChart from '@/components/worldcup/GroupAdvancementChart'
import GroupWhatIfExplorer from '@/components/worldcup/GroupWhatIfExplorer'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { FlagBadge } from '@/components/primitives'

type TeamRow = {
  team_id: number | null
  name: string
  p_advance_first: number
  p_advance_second: number
  p_advance_either: number
  p_eliminated: number
  expected_points: number
  expected_gd: number
  current_points: number
  current_gf: number
  current_ga: number
  current_played: number
}

type MatchRow = {
  match_id: string
  home: string
  away: string
  home_goals?: number
  away_goals?: number
  date?: string | null
}

type Standing = {
  order: string[]
  probability: number
}

type SimResponse = {
  group_id: string
  generated_at: string
  n_simulations: number
  teams: TeamRow[]
  played_matches: MatchRow[]
  remaining_matches: MatchRow[]
  most_likely_standings: Standing[]
  error?: string
}

export const dynamic = 'force-dynamic'

async function fetchGroupSim(groupId: string): Promise<SimResponse | { error: string }> {
  const h = await headers()
  const host = h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const url = `${proto}://${host}/api/world-cup/groups/${encodeURIComponent(groupId)}/simulate`
  try {
    const res = await fetch(url, { next: { revalidate: 300 } })
    if (!res.ok) {
      return { error: `Simulation request failed (${res.status})` }
    }
    return (await res.json()) as SimResponse
  } catch (err) {
    return { error: `Could not load simulation: ${String(err)}` }
  }
}

function pct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`
}

function kickoffLabel(date?: string | null): string {
  if (!date) return 'TBD'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return 'TBD'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const numCell = 'px-2 py-2 text-right tabular-nums'

export default async function WorldCupGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const groupLabel = groupId.toUpperCase()
  const data = await fetchGroupSim(groupLabel)

  const hasError = 'error' in data && data.error
  const teams: TeamRow[] = !hasError ? (data as SimResponse).teams || [] : []
  const playedMatches: MatchRow[] =
    !hasError ? (data as SimResponse).played_matches || [] : []
  const remainingMatches: MatchRow[] =
    !hasError ? (data as SimResponse).remaining_matches || [] : []
  const mostLikely: Standing[] =
    !hasError ? (data as SimResponse).most_likely_standings || [] : []
  const nSims = !hasError ? (data as SimResponse).n_simulations || 0 : 0

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--text-primary)]">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-4">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'World Cup', href: '/world-cup' },
              { label: `Group ${groupLabel}` },
            ]}
          />
        </div>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              Group {groupLabel}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              World Cup 2026
              {nSims > 0
                ? ` · advancement odds from ${nSims.toLocaleString()} simulated group outcomes`
                : ''}
            </p>
          </div>
          <Link
            href="/world-cup"
            className="flex min-h-[36px] items-center gap-1 self-start rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            World Cup hub
          </Link>
        </div>

        {hasError ? (
          <div className="rounded-xl border border-[var(--accent-warn)]/40 bg-[var(--accent-warn)]/10 p-4 text-sm text-[var(--accent-warn)]">
            {(data as { error: string }).error}
          </div>
        ) : (
          <>
            {/* Group table — current standings fused with the model's
                expected finish, one dense scan like a timing tower. */}
            <section className="mb-4 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
              <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border-color)] px-4 py-2.5">
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Table</h2>
                <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  xPts + advance = AI
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      <th className="py-2 pl-4 pr-2 font-medium">Team</th>
                      <th className={`${numCell} font-medium`}>P</th>
                      <th className={`${numCell} font-medium`}>Pts</th>
                      <th className={`${numCell} font-medium`}>GF</th>
                      <th className={`${numCell} font-medium`}>GA</th>
                      <th className={`${numCell} font-medium`}>xPts</th>
                      <th className={`${numCell} pr-4 font-medium`}>Advance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t) => (
                      <tr
                        key={t.name}
                        className="border-t border-[var(--border-color)]/40 transition-colors hover:bg-[var(--card-hover)]"
                      >
                        <td className="py-2 pl-4 pr-2">
                          <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                            <FlagBadge country={t.name} teamName={t.name} size={20} />
                            {t.name}
                          </span>
                        </td>
                        <td className={`${numCell} text-[var(--text-secondary)]`}>{t.current_played}</td>
                        <td className={`${numCell} font-semibold`}>{t.current_points}</td>
                        <td className={`${numCell} text-[var(--text-secondary)]`}>{t.current_gf}</td>
                        <td className={`${numCell} text-[var(--text-secondary)]`}>{t.current_ga}</td>
                        <td className={`${numCell} text-[var(--accent-ai)]`}>
                          {t.expected_points.toFixed(1)}
                        </td>
                        <td className={`${numCell} pr-4 font-semibold text-[var(--accent-ai)]`}>
                          {pct(t.p_advance_either)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Advancement probability
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                Darker bar = group winner. Lighter bar = runner-up. Both stack to the total
                advancement probability.
              </p>
              <div className="mt-3">
                <GroupAdvancementChart teams={teams} />
              </div>
            </section>

            <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Most likely final standings
                </h2>
                {mostLikely.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                    No completed simulations yet.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {mostLikely.map((s, idx) => (
                      <li
                        key={idx}
                        className="rounded-lg border border-[var(--border-color)]/60 bg-[var(--background-secondary)] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[var(--text-secondary)]">
                            Scenario {idx + 1}
                          </span>
                          <span className="tabular-nums font-semibold text-[var(--accent-ai)]">
                            {pct(s.probability)}
                          </span>
                        </div>
                        <ol className="mt-1.5 space-y-1">
                          {s.order.map((team, i) => (
                            <li
                              key={team + i}
                              className="flex items-center gap-2 text-[var(--text-secondary)]"
                            >
                              <span className="w-4 text-right tabular-nums text-[var(--text-tertiary)]">
                                {i + 1}
                              </span>
                              <FlagBadge country={team} teamName={team} size={16} />
                              <span className={i < 2 ? 'font-medium text-[var(--text-primary)]' : ''}>
                                {team}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Matches</h2>
                <div className="mt-3 space-y-1.5">
                  {playedMatches.length === 0 && remainingMatches.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)]">
                      No group fixtures available yet.
                    </p>
                  ) : null}
                  {playedMatches.map((m) => (
                    <div
                      key={m.match_id}
                      className="flex items-center justify-between rounded-lg bg-[var(--background-secondary)] px-3 py-2 text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        <FlagBadge country={m.home} teamName={m.home} size={16} />
                        <span className="font-medium text-[var(--text-primary)]">{m.home}</span>
                        <span className="text-[var(--text-tertiary)]">v</span>
                        <span className="font-medium text-[var(--text-primary)]">{m.away}</span>
                        <FlagBadge country={m.away} teamName={m.away} size={16} />
                      </span>
                      <span className="tabular-nums font-bold text-[var(--text-primary)]">
                        {m.home_goals}–{m.away_goals}
                      </span>
                    </div>
                  ))}
                  {remainingMatches.map((m) => (
                    <div
                      key={m.match_id}
                      className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        <FlagBadge country={m.home} teamName={m.home} size={16} />
                        <span className="text-[var(--text-secondary)]">{m.home}</span>
                        <span className="text-[var(--text-tertiary)]">v</span>
                        <span className="text-[var(--text-secondary)]">{m.away}</span>
                        <FlagBadge country={m.away} teamName={m.away} size={16} />
                      </span>
                      <span className="tabular-nums text-[var(--accent-primary)]">
                        {kickoffLabel(m.date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <GroupWhatIfExplorer
              groupId={groupLabel}
              remainingMatches={remainingMatches.map((m) => ({
                matchId: m.match_id,
                homeTeam: { id: m.home, name: m.home },
                awayTeam: { id: m.away, name: m.away },
                kickoff: m.date ?? '',
              }))}
              baselineTeams={teams.map((t) => ({
                teamId: t.team_id != null ? String(t.team_id) : t.name,
                name: t.name,
                pAdvanceEither: t.p_advance_either,
              }))}
            />
          </>
        )}
      </div>
    </main>
  )
}
