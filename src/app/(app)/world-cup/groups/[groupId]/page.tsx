import Link from 'next/link'
import { headers } from 'next/headers'
import GroupAdvancementChart from '@/components/worldcup/GroupAdvancementChart'
import GroupWhatIfExplorer from '@/components/worldcup/GroupWhatIfExplorer'
import { Breadcrumbs } from '@/components/Breadcrumbs'

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
  const generatedAt = !hasError ? (data as SimResponse).generated_at : null

  return (
    <main className="min-h-screen bg-[#0d1117] text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-4">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'World Cup', href: '/leagues/fifa.world' },
              { label: `Group ${groupLabel}` },
            ]}
          />
        </div>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7c3aed]">
              World Cup 2026 · Group Stage Simulator
            </p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Group {groupLabel}</h1>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Live advancement probabilities. {nSims > 0 ? `Simulated ${nSims.toLocaleString()} times` : 'No simulations available yet'}
              {generatedAt ? ` · generated ${new Date(generatedAt).toLocaleString()}` : ''}.
            </p>
          </div>
          <Link
            href="/leagues/fifa.world"
            className="self-start rounded-md border border-white/15 bg-[#161b22] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:border-[#7c3aed] hover:bg-[#1e2630]"
          >
            ← Back to World Cup hub
          </Link>
        </div>

        {hasError ? (
          <div className="rounded-lg border border-[var(--accent-warn)]/40 bg-[var(--accent-warn)]/10 p-4 text-sm text-[var(--accent-warn)]">
            {(data as { error: string }).error}
          </div>
        ) : (
          <>
            <section className="mb-4 rounded-lg border border-white/10 bg-[#161b22] p-4">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                Standings to date
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      <th className="px-2 py-2">Team</th>
                      <th className="px-2 py-2 text-right">P</th>
                      <th className="px-2 py-2 text-right">Pts</th>
                      <th className="px-2 py-2 text-right">GF</th>
                      <th className="px-2 py-2 text-right">GA</th>
                      <th className="px-2 py-2 text-right">xPts</th>
                      <th className="px-2 py-2 text-right">xGD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t) => (
                      <tr key={t.name} className="border-t border-white/5">
                        <td className="px-2 py-2 font-bold">{t.name}</td>
                        <td className="px-2 py-2 text-right">{t.current_played}</td>
                        <td className="px-2 py-2 text-right">{t.current_points}</td>
                        <td className="px-2 py-2 text-right">{t.current_gf}</td>
                        <td className="px-2 py-2 text-right">{t.current_ga}</td>
                        <td className="px-2 py-2 text-right text-[#7c3aed]">{t.expected_points.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right text-[#7c3aed]">{t.expected_gd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-4 rounded-lg border border-white/10 bg-[#161b22] p-4">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                Advancement probability
              </h2>
              <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                Darker bar = group winner. Lighter bar = runner-up. Both stack to the total advancement probability.
              </p>
              <div className="mt-3">
                <GroupAdvancementChart teams={teams} />
              </div>
            </section>

            <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#161b22] p-4">
                <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  Most likely final standings
                </h2>
                {mostLikely.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--text-tertiary)]">No completed simulations yet.</p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {mostLikely.map((s, idx) => (
                      <li
                        key={idx}
                        className="rounded-md border border-white/5 bg-[#0d1117] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[var(--text-secondary)]">
                            Scenario {idx + 1}
                          </span>
                          <span className="font-mono text-[#00c853]">
                            {pct(s.probability)}
                          </span>
                        </div>
                        <ol className="mt-1 list-decimal pl-5 text-[var(--text-secondary)]">
                          {s.order.map((team, i) => (
                            <li key={team + i}>{team}</li>
                          ))}
                        </ol>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-[#161b22] p-4">
                <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  Matches
                </h2>
                <div className="mt-3 space-y-2">
                  {playedMatches.length === 0 && remainingMatches.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)]">No group fixtures available yet.</p>
                  ) : null}
                  {playedMatches.map((m) => (
                    <div
                      key={m.match_id}
                      className="flex items-center justify-between rounded-md border border-[#00c85333] bg-[#00c85311] px-3 py-2 text-xs"
                    >
                      <span>
                        <span className="font-bold">{m.home}</span> vs{' '}
                        <span className="font-bold">{m.away}</span>
                      </span>
                      <span className="font-mono text-[#00c853]">
                        {m.home_goals}–{m.away_goals}
                      </span>
                    </div>
                  ))}
                  {remainingMatches.map((m) => (
                    <div
                      key={m.match_id}
                      className="flex items-center justify-between rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-xs text-[var(--text-secondary)]"
                    >
                      <span>
                        {m.home} vs {m.away}
                      </span>
                      <span className="text-[var(--text-tertiary)]">
                        {m.date ? new Date(m.date).toLocaleString() : 'TBD'}
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
