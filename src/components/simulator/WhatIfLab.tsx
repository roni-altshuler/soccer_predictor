'use client'

import { SectionHeader, StatusChip, TeamBadge } from '@/components/primitives'
import type { LeagueSimulationResult, WhatIfOutcome } from '@/lib/api'
import { cn } from '@/lib/utils'

import { type TeamMeta } from './shared'

/**
 * WhatIfLab — lock one upcoming fixture to a forced outcome and rerun the
 * season. Fixture rows carry a date chip, both crests, and a three-segment
 * H/D/A toggle (44px targets). One override is active at a time; tapping
 * the active segment clears it back to the baseline. Once the override run
 * lands, a delta strip compares the title favourite and the two affected
 * teams against the stored baseline run.
 */

export interface FixtureOverrideSelection {
  fixtureKey: string
  outcome: WhatIfOutcome
}

type Fixture = NonNullable<LeagueSimulationResult['upcoming_fixtures']>[number]

const OUTCOMES: Array<{ value: WhatIfOutcome; label: string; aria: string }> = [
  { value: 'home', label: 'H', aria: 'home win' },
  { value: 'draw', label: 'D', aria: 'draw' },
  { value: 'away', label: 'A', aria: 'away win' },
]

const MAX_FIXTURES = 10

function formatFixtureDate(date: string | null): string | null {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function titleProbFor(result: LeagueSimulationResult, team: string): number | null {
  const row = result.standings.find((s) => s.team_name === team)
  return row ? row.title_probability : null
}

/** Signed percentage-point delta with a colored ▲/▼; null under ±0.05pp. */
function DeltaArrow({ deltaPp }: { deltaPp: number }) {
  if (Math.abs(deltaPp) < 0.05) {
    return <span className="text-[11px] text-[var(--text-tertiary)]">±0.0</span>
  }
  const up = deltaPp > 0
  return (
    <span
      className="text-[11px] font-semibold tabular-nums"
      style={{ color: up ? 'var(--accent-primary)' : 'var(--accent-loss)' }}
    >
      {up ? '▲' : '▼'}
      {Math.abs(deltaPp).toFixed(1)}
    </span>
  )
}

function DeltaEntry({
  label,
  probability,
  deltaPp,
}: {
  label: string
  probability: number
  deltaPp: number
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span className="text-[13px] font-bold tabular-nums text-[var(--accent-ai)]">
        {(probability * 100).toFixed(1)}%
      </span>
      <DeltaArrow deltaPp={deltaPp} />
    </div>
  )
}

interface WhatIfLabProps {
  fixtures: Fixture[]
  override: FixtureOverrideSelection | null
  onOverrideChange: (next: FixtureOverrideSelection | null) => void
  /** Whether the engine actually applied the override (result.what_if.applied). */
  applied: boolean
  loading: boolean
  /** Last run WITHOUT an override — the comparison point for the delta strip. */
  baseline: LeagueSimulationResult | null
  /** The current run (override applied when `applied`). */
  current: LeagueSimulationResult | null
  teamMeta?: Record<string, TeamMeta>
  className?: string
}

export default function WhatIfLab({
  fixtures,
  override,
  onOverrideChange,
  applied,
  loading,
  baseline,
  current,
  teamMeta = {},
  className,
}: WhatIfLabProps) {
  const shown = fixtures.slice(0, MAX_FIXTURES)
  if (shown.length === 0) return null

  const overriddenFixture = override
    ? shown.find((f) => f.key === override.fixtureKey) ?? null
    : null

  // Delta strip data — only when the override run has landed against a baseline.
  const showDeltas =
    !loading && applied && override !== null && baseline !== null && current !== null
  let deltas: Array<{ label: string; probability: number; deltaPp: number }> = []
  if (showDeltas && current && baseline) {
    const champion = current.most_likely_champion
    const championBaseline = titleProbFor(baseline, champion)
    if (championBaseline !== null) {
      deltas.push({
        label: `Title favourite · ${champion}`,
        probability: current.champion_probability,
        deltaPp: (current.champion_probability - championBaseline) * 100,
      })
    }
    for (const team of [
      overriddenFixture?.home_team,
      overriddenFixture?.away_team,
    ]) {
      if (!team || team === champion) continue
      const now = titleProbFor(current, team)
      const before = titleProbFor(baseline, team)
      if (now === null || before === null) continue
      deltas.push({
        label: `${team} title`,
        probability: now,
        deltaPp: (now - before) * 100,
      })
    }
    deltas = deltas.slice(0, 3)
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className,
      )}
    >
      <div className="border-b border-[var(--border-color)] p-4 md:p-5">
        <SectionHeader
          kicker="What-if lab"
          title="Lock one result"
          description="Force a single fixture and the season reruns around it — one override at a time."
          action={
            override ? (
              applied ? (
                <StatusChip status="correct" label="applied" />
              ) : (
                <StatusChip status="pending" label="not applied" />
              )
            ) : undefined
          }
        />
      </div>

      <ul>
        {shown.map((fixture) => {
          const active = override?.fixtureKey === fixture.key
          const date = formatFixtureDate(fixture.date)
          return (
            <li
              key={fixture.key}
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] px-4 py-2 last:border-b-0',
                active && 'bg-[color-mix(in_srgb,var(--accent-ai)_6%,transparent)]',
              )}
            >
              {date && (
                <span className="w-14 shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                  {date}
                </span>
              )}
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium text-[var(--text-primary)]">
                <TeamBadge
                  teamId={teamMeta[fixture.home_team]?.id}
                  name={fixture.home_team}
                  teamColor={teamMeta[fixture.home_team]?.color}
                  size={16}
                />
                <span className="truncate">{fixture.home_team}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">v</span>
                <TeamBadge
                  teamId={teamMeta[fixture.away_team]?.id}
                  name={fixture.away_team}
                  teamColor={teamMeta[fixture.away_team]?.color}
                  size={16}
                />
                <span className="truncate">{fixture.away_team}</span>
              </span>
              <div
                role="group"
                aria-label={`Force ${fixture.home_team} v ${fixture.away_team}`}
                className="flex shrink-0 overflow-hidden rounded-lg border border-[var(--border-color)]"
              >
                {OUTCOMES.map((outcome) => {
                  const selected = active && override?.outcome === outcome.value
                  return (
                    <button
                      key={outcome.value}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${fixture.home_team} v ${fixture.away_team} — force ${outcome.aria}${selected ? ' (tap again to clear)' : ''}`}
                      disabled={loading}
                      onClick={() =>
                        onOverrideChange(
                          selected
                            ? null
                            : { fixtureKey: fixture.key, outcome: outcome.value },
                        )
                      }
                      className={cn(
                        'min-h-[44px] min-w-[44px] px-3 text-[13px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        selected
                          ? 'bg-[var(--accent-ai)] text-[var(--accent-on-primary)]'
                          : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]',
                        outcome.value !== 'home' &&
                          'border-l border-[var(--border-color)]',
                      )}
                    >
                      {outcome.label}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>

      {override && (
        <div className="border-t border-[var(--border-color)] px-4 py-3">
          {loading ? (
            <p className="text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
              Rerunning the season with the locked result…
            </p>
          ) : showDeltas && deltas.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-x-5 gap-y-1.5"
              aria-live="polite"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                vs baseline
              </span>
              {deltas.map((d) => (
                <DeltaEntry key={d.label} {...d} />
              ))}
            </div>
          ) : !applied ? (
            <p className="text-[12px] text-[var(--text-tertiary)]">
              This fixture is no longer in the remaining schedule — the run used the
              baseline instead.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
