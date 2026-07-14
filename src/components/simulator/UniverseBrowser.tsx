'use client'

import { useEffect, useMemo, useState } from 'react'
import { Telescope } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { SectionHeader, TeamBadge } from '@/components/primitives'
import type {
  LeagueSimulationResult,
  SampledUniverse,
  Standing,
  UniverseOutcome,
} from '@/lib/api'
import { cn } from '@/lib/utils'

import { formatPct, ordinal, zoneForPosition, ZONE_COLOR, ZONE_LABEL, type TeamMeta } from './shared'

/**
 * UniverseBrowser — the Tournament Multiverse, v1. The Monte Carlo engine
 * keeps a uniform reservoir sample of complete simulated seasons instead of
 * discarding every trace; this section lets users browse those individual
 * "universes" and search the runs for one where a chosen team achieves a
 * chosen outcome.
 *
 * Data honesty: every table shown is a season the engine actually played
 * out, every callout number comes straight from the aggregate standings
 * probabilities in the same payload, and a condition that never occurred
 * renders an empty state — nothing is synthesized.
 *
 * Fetch orchestration lives with the callers: this component only reads
 * `result.sampled_universes` / `result.condition_matches` and requests a
 * condition search via `onFindUniverse(team, outcome)` — the callers rerun
 * the deterministic simulation with the find params.
 */

/** How many universes the two simulation surfaces request per run. */
export const UNIVERSE_SAMPLE_REQUEST = 40

export interface UniverseFindSelection {
  team: string
  outcome: UniverseOutcome
}

const OUTCOMES: Array<{ value: UniverseOutcome; label: string }> = [
  { value: 'champion', label: 'Wins the title' },
  { value: 'top4', label: 'Makes top 4' },
  { value: 'relegated', label: 'Relegated' },
]

const OUTCOME_PHRASE: Record<UniverseOutcome, string> = {
  champion: 'win the title',
  top4: 'make the top four',
  relegated: 'get relegated',
}

// ---------------------------------------------------------------------------
// Story callouts — plain sentences derived from the aggregate probabilities
// ---------------------------------------------------------------------------

interface Callout {
  /** Surprise ranking — higher = more worth telling. */
  score: number
  text: string
}

/**
 * 2–3 plain sentences that read this universe as a story of divergence.
 * Every number is traceable to the payload: outcome probabilities come from
 * the aggregate standings, positions from this universe's own table.
 */
function buildCallouts(
  universe: SampledUniverse,
  standingByName: Map<string, Standing>,
  numTeams: number,
): string[] {
  const candidates: Callout[] = []

  const champion = universe.table[0]
  const championAgg = champion ? standingByName.get(champion.team_name) : undefined
  const championText = championAgg
    ? championAgg.title_probability >= 0.5
      ? `${champion.team_name} take the title here, as they do in ${formatPct(championAgg.title_probability)} of seasons.`
      : `${champion.team_name} are champions here — the champion in this universe wins only ${formatPct(championAgg.title_probability)} of the time.`
    : null

  for (const row of universe.table) {
    const agg = standingByName.get(row.team_name)
    if (!agg) continue

    const relegatedHere = row.position > numTeams - 3
    if (!relegatedHere && agg.relegation_probability >= 0.5) {
      candidates.push({
        score: agg.relegation_probability,
        text: `${row.team_name} survive — they go down in ${formatPct(agg.relegation_probability)} of seasons.`,
      })
    }
    if (relegatedHere && agg.relegation_probability <= 0.25) {
      candidates.push({
        score: 1 - agg.relegation_probability,
        text: `${row.team_name} go down here, something that happens in ${formatPct(agg.relegation_probability)} of seasons.`,
      })
    }
    if (row.position > 1 && row.position <= 4 && agg.top_4_probability <= 0.25) {
      candidates.push({
        score: 1 - agg.top_4_probability,
        text: `${row.team_name} make the top four — a ${formatPct(agg.top_4_probability)} shot.`,
      })
    }
    if (row.position > 4 && agg.top_4_probability >= 0.75 && numTeams > 4) {
      candidates.push({
        score: agg.top_4_probability,
        text: `${row.team_name} miss the top four, which they reach in ${formatPct(agg.top_4_probability)} of seasons.`,
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const callouts: string[] = []
  if (championText) callouts.push(championText)
  for (const c of candidates) {
    if (callouts.length >= 3) break
    callouts.push(c.text)
  }

  // Fallback so a universe always tells at least two things: the single
  // biggest divergence from the mean projected finish.
  if (callouts.length < 2) {
    let best: { row: SampledUniverse['table'][number]; avg: number; gap: number } | null = null
    for (const row of universe.table) {
      const agg = standingByName.get(row.team_name)
      if (!agg) continue
      const gap = Math.abs(row.position - agg.avg_final_position)
      if (!best || gap > best.gap) best = { row, avg: agg.avg_final_position, gap }
    }
    if (best && best.gap >= 1) {
      const above = best.row.position < best.avg
      callouts.push(
        `${best.row.team_name} finish ${ordinal(best.row.position)}, ${Math.round(best.gap)} place${Math.round(best.gap) === 1 ? '' : 's'} ${above ? 'above' : 'below'} their ${best.avg.toFixed(1)} average finish.`,
      )
    }
  }

  return callouts.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Signed places-vs-average delta: ▲3 finished higher, ▼2 finished lower. */
function DeltaVsAvg({ position, avg }: { position: number; avg: number }) {
  const places = Math.round(avg - position)
  if (places === 0) {
    return (
      <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]" aria-label={`On their average finish of ${avg.toFixed(1)}`}>
        —
      </span>
    )
  }
  const up = places > 0
  return (
    <span
      className="text-[11px] font-semibold tabular-nums"
      style={{ color: up ? 'var(--accent-primary)' : 'var(--accent-loss)' }}
      aria-label={`${Math.abs(places)} places ${up ? 'above' : 'below'} their average finish of ${avg.toFixed(1)}`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(places)}
    </span>
  )
}

function UniverseChip({
  universe,
  active,
  onSelect,
  teamMeta,
}: {
  universe: SampledUniverse
  active: boolean
  onSelect: () => void
  teamMeta: Record<string, TeamMeta>
}) {
  const champion = universe.table[0]
  if (!champion) return null
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`Universe ${universe.universe_id.toLocaleString()} — champions ${champion.team_name}`}
      className={cn(
        'flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold transition-colors',
        active
          ? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--text-primary)]'
          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <span className="tabular-nums text-[var(--text-tertiary)]">
        #{universe.universe_id.toLocaleString()}
      </span>
      <TeamBadge
        teamId={teamMeta[champion.team_name]?.id}
        name={champion.team_name}
        teamColor={teamMeta[champion.team_name]?.color}
        size={16}
      />
      <span className="max-w-[120px] truncate">{champion.team_name}</span>
    </button>
  )
}

/** One universe's full final table + its story callouts (FotMob table grammar). */
function UniverseStory({
  universe,
  standingByName,
  teamMeta,
}: {
  universe: SampledUniverse
  standingByName: Map<string, Standing>
  teamMeta: Record<string, TeamMeta>
}) {
  const numTeams = universe.table.length
  const showEuropa = numTeams > 10
  const callouts = useMemo(
    () => buildCallouts(universe, standingByName, numTeams),
    [universe, standingByName, numTeams],
  )

  return (
    <div>
      {callouts.length > 0 && (
        <ul className="space-y-1.5 border-b border-[var(--border-color)] px-4 py-3 md:px-5">
          {callouts.map((text) => (
            <li key={text} className="flex items-start gap-2 text-[12px] leading-snug text-[var(--text-secondary)]">
              <span
                aria-hidden
                className="mt-[5px] h-2 w-[3px] shrink-0 rounded-full bg-[var(--accent-primary)]"
              />
              {text}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              <th className="px-3 py-2 text-left font-semibold">Pos</th>
              <th className="px-3 py-2 text-left font-semibold">Team</th>
              <th className="px-3 py-2 text-right font-semibold">Pts</th>
              <th className="px-3 py-2 text-right font-semibold">GD</th>
              <th className="px-3 py-2 text-right font-semibold">vs avg</th>
            </tr>
          </thead>
          <tbody>
            {universe.table.map((row) => {
              const zone = zoneForPosition(row.position, numTeams)
              const stripe = zone === 'mid' ? undefined : ZONE_COLOR[zone]
              const agg = standingByName.get(row.team_name)
              return (
                <tr
                  key={row.team_name}
                  className="border-b border-[var(--border-color)]/60 last:border-b-0"
                  style={stripe ? { boxShadow: `inset 2px 0 0 0 ${stripe}` } : undefined}
                >
                  <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">
                    {row.position}
                  </td>
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                    <span className="flex items-center gap-2">
                      <TeamBadge
                        teamId={teamMeta[row.team_name]?.id}
                        name={row.team_name}
                        teamColor={teamMeta[row.team_name]?.color}
                        size={18}
                      />
                      <span className="truncate">{row.team_name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                    {row.points}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                    {row.gd > 0 ? `+${row.gd}` : row.gd}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {agg ? <DeltaVsAvg position={row.position} avg={agg.avg_final_position} /> : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)]">
        {(showEuropa ? (['cl', 'europa', 'releg'] as const) : (['cl', 'releg'] as const)).map(
          (zone) => (
            <span key={zone} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-[3px] rounded-full"
                style={{ background: ZONE_COLOR[zone] }}
              />
              {ZONE_LABEL[zone]}
            </span>
          ),
        )}
        <span>vs avg = places above/below the team&apos;s mean simulated finish</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

interface UniverseBrowserProps {
  result: LeagueSimulationResult
  teamMeta: Record<string, TeamMeta>
  /** True while the caller is rerunning the simulation. */
  loading: boolean
  /** Ask the caller to rerun the deterministic sim with find_team/find_outcome. */
  onFindUniverse: (team: string, outcome: UniverseOutcome) => void
}

type Selection = { source: 'sample' | 'match'; id: number } | null

export default function UniverseBrowser({
  result,
  teamMeta,
  loading,
  onFindUniverse,
}: UniverseBrowserProps) {
  const samples = useMemo(
    () => result.sampled_universes ?? [],
    [result.sampled_universes],
  )
  const matches = result.condition_matches
  const matchCount = result.condition_match_count ?? 0
  const nRuns = result.n_simulations

  const [selected, setSelected] = useState<Selection>(null)
  const [findTeam, setFindTeam] = useState('')
  const [findOutcome, setFindOutcome] = useState<UniverseOutcome>('champion')
  const [requested, setRequested] = useState<UniverseFindSelection | null>(null)

  const standingByName = useMemo(
    () => new Map(result.standings.map((s) => [s.team_name, s])),
    [result.standings],
  )

  // When a find run lands with matches, focus the first matched universe.
  useEffect(() => {
    if (matches && matches.length > 0) {
      setSelected({ source: 'match', id: matches[0].universe_id })
    }
  }, [matches])

  // Resolve the selection against the current payload; default to the first
  // sample so the section always opens on a real season.
  const resolved = useMemo(() => {
    if (selected?.source === 'match' && matches) {
      const u = matches.find((m) => m.universe_id === selected.id)
      if (u) return { source: 'match' as const, universe: u }
    }
    if (selected?.source === 'sample') {
      const u = samples.find((s) => s.universe_id === selected.id)
      if (u) return { source: 'sample' as const, universe: u }
    }
    return samples.length > 0
      ? { source: 'sample' as const, universe: samples[0] }
      : null
  }, [selected, samples, matches])

  if (samples.length === 0 && !matches) return null

  const findPending = loading && requested !== null
  const findLanded = !loading && matches !== undefined

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="border-b border-[var(--border-color)] p-4 md:p-5">
        <SectionHeader
          kicker="Multiverse"
          title="Browse the simulated seasons"
          description={`${samples.length} complete seasons sampled evenly from the ${nRuns.toLocaleString()} runs — every table here is one the simulation actually played out.`}
        />
      </div>

      {/* Universe strip — horizontally scrollable chips. */}
      {samples.length > 0 && (
        <div className="border-b border-[var(--border-color)] px-4 py-3 md:px-5">
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Sampled universes">
            {samples.map((u) => (
              <UniverseChip
                key={u.universe_id}
                universe={u}
                active={resolved?.source === 'sample' && resolved.universe.universe_id === u.universe_id}
                onSelect={() => setSelected({ source: 'sample', id: u.universe_id })}
                teamMeta={teamMeta}
              />
            ))}
          </div>
        </div>
      )}

      {/* The selected sample's season, told as a story. */}
      {resolved && resolved.source === 'sample' && (
        <div className="border-b border-[var(--border-color)]">
          <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] md:px-5">
            Universe #{resolved.universe.universe_id.toLocaleString()} of {nRuns.toLocaleString()}
          </p>
          <UniverseStory
            universe={resolved.universe}
            standingByName={standingByName}
            teamMeta={teamMeta}
          />
        </div>
      )}

      {/* Find a universe. */}
      <div className="p-4 md:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Find a universe
        </p>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Pick a team and an outcome — the simulator replays the same{' '}
          {nRuns.toLocaleString()} seasons and pulls out the ones where it happens.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="universe-find-team" className="sr-only">
            Team
          </label>
          <select
            id="universe-find-team"
            value={findTeam}
            onChange={(e) => setFindTeam(e.target.value)}
            className="min-h-[44px] rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 text-[13px] text-[var(--text-primary)]"
          >
            <option value="">Pick a team…</option>
            {result.standings.map((s) => (
              <option key={s.team_name} value={s.team_name}>
                {s.team_name}
              </option>
            ))}
          </select>
          <div
            role="group"
            aria-label="Outcome to search for"
            className="flex overflow-hidden rounded-lg border border-[var(--border-color)]"
          >
            {OUTCOMES.map((outcome, i) => {
              const active = findOutcome === outcome.value
              return (
                <button
                  key={outcome.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFindOutcome(outcome.value)}
                  className={cn(
                    'min-h-[44px] px-3 text-[13px] font-semibold transition-colors',
                    active
                      ? 'bg-[var(--accent-ai)] text-[var(--accent-on-primary)]'
                      : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]',
                    i > 0 && 'border-l border-[var(--border-color)]',
                  )}
                >
                  {outcome.label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            disabled={!findTeam || loading}
            onClick={() => {
              setRequested({ team: findTeam, outcome: findOutcome })
              onFindUniverse(findTeam, findOutcome)
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-4 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Telescope className="h-3.5 w-3.5" aria-hidden="true" />
            Find
          </button>
        </div>

        {findPending && (
          <p className="mt-3 text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
            Replaying the same {nRuns.toLocaleString()} seasons…
          </p>
        )}
      </div>

      {/* Find results. */}
      {findLanded && matches && (
        matchCount === 0 ? (
          <div className="border-t border-[var(--border-color)]">
            <EmptyState
              illustration="searching"
              title={`It never happened in ${nRuns.toLocaleString()} seasons`}
              description={`${requested?.team ?? 'That team'} ${OUTCOME_PHRASE[requested?.outcome ?? findOutcome]} in none of the replayed runs — that's the answer.`}
            />
          </div>
        ) : (
          <div className="border-t border-[var(--border-color)]">
            <div className="px-4 py-3 md:px-5">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]" aria-live="polite">
                {requested
                  ? `${requested.team} ${OUTCOME_PHRASE[requested.outcome]} in ${matchCount.toLocaleString()} of ${nRuns.toLocaleString()} seasons`
                  : `Found in ${matchCount.toLocaleString()} of ${nRuns.toLocaleString()} seasons`}
                {matchCount > matches.length && (
                  <span className="font-normal text-[var(--text-tertiary)]">
                    {' '}
                    · showing the first {matches.length}
                  </span>
                )}
              </p>
              <div
                className="mt-2 flex gap-2 overflow-x-auto pb-1"
                role="group"
                aria-label="Matching universes"
              >
                {matches.map((u) => (
                  <UniverseChip
                    key={u.universe_id}
                    universe={u}
                    active={resolved?.source === 'match' && resolved.universe.universe_id === u.universe_id}
                    onSelect={() => setSelected({ source: 'match', id: u.universe_id })}
                    teamMeta={teamMeta}
                  />
                ))}
              </div>
            </div>
            {resolved && resolved.source === 'match' && (
              <div className="border-t border-[var(--border-color)]">
                <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] md:px-5">
                  Universe #{resolved.universe.universe_id.toLocaleString()} of {nRuns.toLocaleString()}
                </p>
                <UniverseStory
                  universe={resolved.universe}
                  standingByName={standingByName}
                  teamMeta={teamMeta}
                />
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
