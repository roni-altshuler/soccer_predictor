'use client'

import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { BracketRecord } from '@/components/tournament/BracketRecord'
import type { BracketEvent, BracketSummary } from '@/components/tournament/BracketRecord'
import { TournamentLadder } from '@/components/tournament/TournamentLadder'
import type { LadderEntry } from '@/components/tournament/TournamentLadder'
import { cn } from '@/lib/utils'

/**
 * The tournament layer.
 *
 * Why this is a separate page and not a tab on /accuracy: it answers a
 * different question. Everything on /accuracy is three-way — home, draw, away
 * — and a quarter of league matches end level, which is why the market itself
 * only reaches 54% there. A knockout TIE has two outcomes; extra time,
 * penalties and away goals exist to guarantee it. Putting a 64.8% next to a
 * 52.3% without that framing would read as an improvement when it is a
 * different question.
 *
 * Order of the page follows the order of the claim:
 *   1. What a tie is, and why the numbers below are not comparable to 1X2.
 *   2. Who advances — the ladder, floored at a coin flip.
 *   3. Calibration, which is what a bracket simulation actually consumes.
 *   4. Who lifts the trophy — the simulation, and every tournament behind it.
 *   5. Where the model is strongest and weakest, by round.
 *
 * Everything here is a backtest, labelled as such: the model is refit on the
 * seasons strictly before each tournament and never on the one it predicts.
 */

interface Calibration {
  stated_low: number
  stated_high: number
  n: number
  observed: number
  mean_stated: number
}

interface RoundRow {
  correct: number
  n: number
  accuracy: number
}

interface TiesArtifact {
  n_ties_scored: number
  test_seasons: number[]
  ladder: LadderEntry[]
  calibration: Calibration[]
  by_round: Record<string, RoundRow>
  best_model: string
  method: {
    competitions: string[]
    progression_check: { checked: number; confirmed: number; rate: number }
  }
}

interface BracketsArtifact {
  summary: BracketSummary
  events: BracketEvent[]
}

interface Payload {
  available: boolean
  ties?: TiesArtifact | null
  brackets?: BracketsArtifact | null
}

const ROUND_LABELS: Record<string, string> = {
  final: 'Final',
  semifinals: 'Semi-finals',
  quarterfinals: 'Quarter-finals',
  'round-of-16': 'Round of 16',
  'round-of-32': 'Round of 32',
}

const roundLabel = (key: string) => ROUND_LABELS[key] ?? key.replace(/-/g, ' ')

export default function TournamentsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    fetch('/api/v1/tournaments/knockout', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((j: Payload) => {
        if (live) {
          setData(j)
          setLoading(false)
        }
      })
      .catch(() => {
        if (live) {
          setData({ available: false })
          setLoading(false)
        }
      })
    return () => {
      live = false
    }
  }, [])

  const ties = data?.ties ?? null
  const brackets = data?.brackets ?? null

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
          Tournaments
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          A league match has three outcomes and a quarter of them are draws — which is why
          every number on the accuracy page is capped near the market&apos;s 54%. A knockout
          tie has two. Extra time, penalties and away goals exist so that exactly one team
          advances, and that is where this model is asked a question it can answer cleanly.
        </p>
        <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          These are not the 1X2 numbers made bigger. They are a different question, measured
          separately, and shown against a floor of a coin flip rather than one-in-three.
        </p>
      </header>

      {loading ? (
        <div className="mt-8 h-40 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]" />
      ) : !data?.available || (!ties && !brackets) ? (
        <div className="mt-8">
          <EmptyState
            title="The tournament benchmarks have not been run here"
            description="They are regenerable artifacts, not shipped data. Run benchmark_knockout and backtest_brackets to populate this page."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {ties ? (
            <TournamentLadder
              ladder={ties.ladder}
              nTies={ties.n_ties_scored}
              seasons={ties.test_seasons}
              competitions={ties.method.competitions.length}
            />
          ) : null}

          {ties?.calibration?.length ? (
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                What the confidence means
              </h2>
              <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
                This is the number the trophy simulation actually consumes — a bracket is
                decided by probabilities compounded over four or five rounds, not by picks.
                Read down the last two columns: what it said, and what happened.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[340px] border-collapse font-mono text-[12px] tabular-nums">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                      <th className="pb-1.5 pr-3 font-medium">Band</th>
                      <th className="pb-1.5 pr-3 text-right font-medium">Ties</th>
                      <th className="pb-1.5 pr-3 text-right font-medium">It said</th>
                      <th className="pb-1.5 text-right font-medium">It happened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ties.calibration.map((c) => (
                      <tr key={c.stated_low} className="border-t border-[var(--border-color)]">
                        <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                          {c.stated_low}–{c.stated_high}%
                        </td>
                        <td className="py-1.5 pr-3 text-right text-[var(--text-tertiary)]">
                          {c.n.toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-[var(--text-secondary)]">
                          {(c.mean_stated * 100).toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-right text-[var(--text-primary)]">
                          {(c.observed * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {brackets?.summary ? (
            <BracketRecord summary={brackets.summary} events={brackets.events ?? []} />
          ) : null}

          {ties?.by_round ? (
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                Where it is strong, and where it is not
              </h2>
              <ul className="mt-3 space-y-2">
                {Object.entries(ties.by_round)
                  .filter(([key]) => key in ROUND_LABELS)
                  .sort((a, b) => b[1].n - a[1].n)
                  .map(([key, row]) => (
                    <li key={key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[13px] text-[var(--text-secondary)]">
                            {roundLabel(key)}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                            {row.n} ties
                          </span>
                        </div>
                        <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              row.accuracy >= 0.6
                                ? 'bg-[var(--accent-primary)]'
                                : 'bg-[var(--accent-warn)]',
                            )}
                            style={{ width: `${Math.max(4, (row.accuracy - 0.5) * 200)}%` }}
                          />
                        </div>
                      </div>
                      <span className="font-mono text-[13px] tabular-nums text-[var(--text-secondary)]">
                        {(row.accuracy * 100).toFixed(1)}%
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                Semi-finals are the hardest round, and that is not a flaw: by then the field
                is four teams that all deserve to be there, so the rating gap the model runs
                on has mostly closed.
              </p>
            </section>
          ) : null}

          {ties?.method?.progression_check ? (
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Integrity check: the team recorded as advancing does turn up in the next round
              in{' '}
              <span className="text-[var(--text-secondary)]">
                {ties.method.progression_check.confirmed.toLocaleString()} of{' '}
                {ties.method.progression_check.checked.toLocaleString()}
              </span>{' '}
              ties ({(ties.method.progression_check.rate * 100).toFixed(1)}%). Backtest, not a
              live record — every tournament is predicted by a model refit only on seasons
              before it.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
