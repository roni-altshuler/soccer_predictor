'use client'

type CommandTab = 'Groups' | 'Knockout' | 'Fixtures' | 'Simulator' | 'Challenge'

type WorldCupGroupStanding = {
  position: number
  team: string
  played: number
  points: number
  goalDifference: number
}

type WorldCupGroup = {
  name: string
  standings: WorldCupGroupStanding[]
}

type WorldCupMatch = {
  id: string
  homeTeam: string
  awayTeam: string
  date: string
  time?: string
  round?: string
  venue?: string
  status?: 'upcoming' | 'live' | 'finished'
}

type ProbabilityRow = {
  team: string
  probability: number
}

type WorldCupCommandCenterProps = {
  selectedSeason: string
  groups: WorldCupGroup[]
  upcomingMatches: WorldCupMatch[]
  recentResults: WorldCupMatch[]
  topScorers: Array<{ name: string; team: string; goals: number }>
  simulationProbabilities?: {
    champion: ProbabilityRow[]
    final: ProbabilityRow[]
    semi_finals: ProbabilityRow[]
    quarter_finals: ProbabilityRow[]
  } | null
  onOpenTab: (tab: CommandTab) => void
  /**
   * Where the command centre is rendered. The 'public' surface hides
   * the "Tournament Desk / What needs attention" action grid because
   * that reads like an internal TODO list. The 'diagnostics' surface
   * keeps the grid for operators on /diagnostics.
   */
  surface?: 'public' | 'diagnostics'
}

function pct(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`
}

function MetricTile({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'good' | 'watch'
}) {
  const toneClass = tone === 'good'
    ? 'border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/10'
    : tone === 'watch'
      ? 'border-[var(--accent-warn)]/25 bg-[var(--accent-warn)]/10'
      : 'border-[var(--border-color)] bg-[var(--muted-bg)]'

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-1 text-xl font-black text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{detail}</p>
    </div>
  )
}

function ActionButton({
  label,
  detail,
  onClick,
}: {
  label: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-3 text-left transition-colors hover:border-[var(--accent-primary)] hover:bg-[var(--card-hover)]"
    >
      <p className="text-sm font-bold text-[var(--text-primary)]">{label}</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{detail}</p>
    </button>
  )
}

export default function WorldCupCommandCenter({
  selectedSeason,
  groups,
  upcomingMatches,
  recentResults,
  topScorers,
  simulationProbabilities,
  onOpenTab,
  surface = 'public',
}: WorldCupCommandCenterProps) {
  const isDiagnostics = surface === 'diagnostics'
  const isExpandedFormat = selectedSeason === '2026'
  const expectedTeams = isExpandedFormat ? 48 : 32
  const expectedGroups = isExpandedFormat ? 12 : 8
  const expectedKnockoutTeams = isExpandedFormat ? 32 : 16
  const loadedTeams = new Set(
    groups
      .flatMap((group) => group.standings)
      .map((team) => team.team)
      .filter((team) => team && team !== 'TBD')
  )
  const loadedTeamCount = loadedTeams.size
  const topChampion = simulationProbabilities?.champion?.[0]
  const nextMatch = upcomingMatches[0]
  const latestResult = recentResults[0]
  const leadingScorer = topScorers.find((scorer) => scorer.name && scorer.name !== 'TBD')

  return (
    <section className="fm-surface overflow-hidden">
      <div className="border-b border-[var(--border-color)] px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-ai)]">World Cup Command Center</p>
            <h2 className="mt-1 text-xl font-black text-[var(--text-primary)]">2026 tournament operating board</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-secondary)]">
              A single control surface for tournament coverage, prediction readiness, fixtures, knockout paths, and scenario simulation.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricTile
            label="Team Coverage"
            value={`${loadedTeamCount}/${expectedTeams}`}
            detail={`${groups.length}/${expectedGroups} groups loaded.`}
            tone={loadedTeamCount >= expectedTeams ? 'good' : loadedTeamCount > 0 ? 'watch' : 'neutral'}
          />
          <MetricTile
            label="Fixtures"
            value={`${upcomingMatches.length}`}
            detail={nextMatch ? `${nextMatch.homeTeam} vs ${nextMatch.awayTeam} · ${nextMatch.date}` : 'No upcoming fixtures loaded yet.'}
            tone={upcomingMatches.length > 0 ? 'good' : 'neutral'}
          />
          <MetricTile
            label="Knockout Field"
            value={`${expectedKnockoutTeams}`}
            detail={isExpandedFormat ? 'Expanded 2026 knockout field after group ranking.' : 'Classic round-of-16 knockout field.'}
            tone="neutral"
          />
          <MetricTile
            label="Title Favorite"
            value={topChampion?.team || 'Pending'}
            detail={topChampion ? `${pct(topChampion.probability)} simulated title probability.` : 'Run or refresh simulation once teams are available.'}
            tone={topChampion ? 'good' : 'watch'}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          {isDiagnostics && (
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Tournament Desk</p>
                  <h3 className="mt-1 text-base font-bold text-[var(--text-primary)]">What needs attention</h3>
                </div>
                <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-bold text-[var(--text-secondary)]">
                  {selectedSeason}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ActionButton
                  label="Review groups"
                  detail={loadedTeamCount > 0 ? 'Inspect qualification status and group table gaps.' : 'Open group tables when data appears.'}
                  onClick={() => onOpenTab('Groups')}
                />
                <ActionButton
                  label="Run scenario simulation"
                  detail="Stress-test a focus team, volatility profile, and tournament path."
                  onClick={() => onOpenTab('Simulator')}
                />
                <ActionButton
                  label="Open fixtures"
                  detail={nextMatch ? `Next fixture: ${nextMatch.date}${nextMatch.time ? ` at ${nextMatch.time}` : ''}.` : 'Check official fixtures as the tournament feed fills.'}
                  onClick={() => onOpenTab('Fixtures')}
                />
                <ActionButton
                  label="Knockout path"
                  detail={`Prepare the ${expectedKnockoutTeams}-team knockout bracket and probability view.`}
                  onClick={() => onOpenTab('Knockout')}
                />
                <ActionButton
                  label="Bracket challenge"
                  detail="Create private pick'em groups and score them against real knockout results."
                  onClick={() => onOpenTab('Challenge')}
                />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Live Context</p>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">Latest result</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {latestResult
                    ? `${latestResult.homeTeam} vs ${latestResult.awayTeam} · ${latestResult.date}`
                    : 'No completed World Cup result in the current window.'}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">Scoring board</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {leadingScorer
                    ? `${leadingScorer.name}, ${leadingScorer.team}: ${leadingScorer.goals} goals.`
                    : 'Top scorer board will stay empty until leader data is available.'}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">Data rule</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  Command center metrics use live data. Missing teams, scorers, fixtures, and venues are not filled with fabricated placeholders.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
