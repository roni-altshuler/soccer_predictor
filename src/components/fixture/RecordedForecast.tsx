'use client'

import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import type { RecordedForecast as Recorded } from '@/lib/server/recordedForecast'

/**
 * What this site said before kickoff, and what happened — on the match itself.
 *
 * `/accuracy` is where the record is judged in aggregate. This is the same
 * claim at the only scale a reader can check by eye: one fixture, the forecast
 * that was written down for it, the timestamp proving it was written down
 * first, and the result.
 *
 * THREE RULES, and they are the whole design:
 *
 * 1. **A forecast that cannot be shown to predate kickoff is not drawn.** The
 *    panel's entire value is the ordering of two events. If `beforeKickoff` is
 *    false the number is not a forecast, and printing it beside a result would
 *    be the exact flattery this project exists to avoid.
 * 2. **One fixture is not evidence, and the panel says so.** A single miss is
 *    not a fault and a single hit is not a track record — a probability is
 *    only right or wrong across many of them. The caveat quotes no specific
 *    percentage: it sat under a bar showing a different one, which read as a
 *    contradiction rather than as a caution.
 * 3. **The probability it gave the actual outcome leads.** Brier is printed
 *    too, but "it gave this 16%" is the number a person can actually reason
 *    about, and it is the one a proper scoring rule is built on.
 */

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** "31 hours before kickoff", or "2 days before kickoff". */
export function leadTime(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null
  if (hours < 1.5) return 'less than an hour before kickoff'
  if (hours < 48) return `${Math.round(hours)} hours before kickoff`
  return `${Math.round(hours / 24)} days before kickoff`
}

export function RecordedForecastPanel({
  recorded,
  homeName,
  awayName,
}: {
  recorded: Recorded
  homeName: string
  awayName: string
}) {
  // Rule 1. Not a fallback, a refusal: nothing here is worth showing without
  // the ordering it depends on.
  if (recorded.beforeKickoff === false) return null

  const lead = leadTime(recorded.hoursBeforeKickoff)
  const played = recorded.outcome !== null
  const winner =
    recorded.outcome === 'home' ? homeName : recorded.outcome === 'away' ? awayName : null

  return (
    <div data-recorded-forecast={played ? 'scored' : 'pending'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {played ? 'What the model said before kickoff' : 'What the model expects'}
        </h2>
        {lead ? (
          <p data-lead-time className="font-mono text-[10px] text-[var(--text-tertiary)]">
            <span className="sr-only">Recorded </span>
            {lead}
          </p>
        ) : null}
      </div>

      <ProbabilityBar
        className="mt-3"
        probabilities={{ home: recorded.p[0], draw: recorded.p[1], away: recorded.p[2] }}
        homeLabel={homeName}
        awayLabel={awayName}
      />

      {played ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--border-color)] pt-3.5 sm:grid-cols-3">
            <div>
              <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                What happened
              </dt>
              <dd
                data-outcome={recorded.outcome ?? undefined}
                className="mt-1 truncate text-[13px] text-[var(--text-primary)]"
              >
                {winner ? `${winner} won` : 'Drawn'}
                {recorded.homeGoals !== null && recorded.awayGoals !== null ? (
                  <span className="ml-1.5 font-mono tabular-nums text-[var(--text-secondary)]">
                    {recorded.homeGoals}-{recorded.awayGoals}
                  </span>
                ) : null}
              </dd>
            </div>

            <div>
              <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                It gave that
              </dt>
              {/* Rule 3: the interpretable number, and the one the scoring rule
                  is actually built on. */}
              <dd
                data-p-actual
                className="mt-1 font-mono text-[16px] tabular-nums text-[var(--text-primary)]"
              >
                {recorded.pActual !== null ? pct(recorded.pActual) : '—'}
              </dd>
            </div>

            <div>
              <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Brier
              </dt>
              <dd className="mt-1 font-mono text-[16px] tabular-nums text-[var(--text-secondary)]">
                {recorded.brier !== null ? recorded.brier.toFixed(4) : '—'}
              </dd>
            </div>
          </dl>

          {/* Rule 2. Printed every time, not only on a miss — a hit read as
              proof is the same error in the flattering direction. */}
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
            {recorded.calledIt
              ? 'Its highest of the three landed on the result. '
              : 'Its highest of the three did not land on the result. '}
            One match cannot judge a forecast: a probability is only right or wrong
            across many of them, and this one was never a prediction that the result
            would happen.{' '}
            <a
              href="/accuracy"
              className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
            >
              The record across every settled pick
            </a>{' '}
            is where it can be.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
          These three add to 100% and are the model&apos;s complete answer. It is recorded
          now and kept, so it can be scored against the result rather than remembered
          selectively.
        </p>
      )}
    </div>
  )
}
