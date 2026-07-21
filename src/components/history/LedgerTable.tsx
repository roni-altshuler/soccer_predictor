'use client'

import Link from 'next/link'
import { Check, X } from 'lucide-react'

import { getLeagueAccent } from '@/lib/leagueAccents'
import {
  callLabel,
  formatConfidence,
  formatPredictedScore,
  formatScore,
  formatShortDate,
  outcomeOf,
  type LedgerRecord,
} from '@/lib/historyLedger'
import { cn } from '@/lib/utils'

/**
 * The record ledger table. Quiet by default: one hairline-separated 44px
 * row per prediction, tabular numerics, and a single restrained mark for
 * right/wrong. No colour blocking — the credibility is in the completeness.
 */

function competitionLabel(league: string): string {
  const accent = getLeagueAccent(league)
  return accent.competitionId === 'unknown' ? league : accent.shortName
}

/** Right/wrong marker — a glyph, not a badge. Shape carries the meaning. */
function OutcomeMark({ record }: { record: LedgerRecord }) {
  const outcome = outcomeOf(record)
  if (outcome === 'correct') {
    return (
      <span className="inline-flex" title="Call was correct">
        <Check
          className="h-3.5 w-3.5 text-[var(--accent-primary)]"
          strokeWidth={2.75}
          aria-hidden="true"
        />
        <span className="sr-only">Correct</span>
      </span>
    )
  }
  if (outcome === 'incorrect') {
    return (
      <span className="inline-flex" title="Call was wrong">
        <X
          className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
          strokeWidth={2.75}
          aria-hidden="true"
        />
        <span className="sr-only">Incorrect</span>
      </span>
    )
  }
  return (
    <span className="inline-flex" title="Awaiting result">
      <span
        className="h-1 w-2.5 rounded-full bg-[var(--border-hover)]"
        aria-hidden="true"
      />
      <span className="sr-only">Awaiting result</span>
    </span>
  )
}

function TeamName({
  name,
  emphasis,
}: {
  name: string
  emphasis: 'winner' | 'loser' | 'neutral'
}) {
  return (
    <span
      className={cn(
        emphasis === 'winner' && 'font-semibold text-[var(--text-primary)]',
        emphasis === 'loser' && 'text-[var(--text-tertiary)]',
        emphasis === 'neutral' && 'text-[var(--text-secondary)]'
      )}
    >
      {name}
    </span>
  )
}

function LedgerRow({ record }: { record: LedgerRecord }) {
  const outcome = outcomeOf(record)
  const settled = outcome !== 'pending'
  const score = formatScore(record)
  const predicted = formatPredictedScore(record)
  const call = callLabel(record)
  const competition = competitionLabel(record.league)

  let home: 'winner' | 'loser' | 'neutral' = 'neutral'
  let away: 'winner' | 'loser' | 'neutral' = 'neutral'
  if (settled && record.actual_winner === 'home') {
    home = 'winner'
    away = 'loser'
  } else if (settled && record.actual_winner === 'away') {
    home = 'loser'
    away = 'winner'
  }

  const href = /^\d+$/.test(String(record.match_id))
    ? `/matches/${record.match_id}`
    : undefined

  const fixtureText = `${record.home_team} v ${record.away_team}`
  const fixture = (
    <span className="block truncate" title={fixtureText}>
      <TeamName name={record.home_team} emphasis={home} />
      <span className="px-1 text-[var(--text-tertiary)]">v</span>
      <TeamName name={record.away_team} emphasis={away} />
    </span>
  )
  const callText = predicted ? `${call} ${predicted}` : call

  return (
    <tr className="border-t border-[var(--border-color)] transition-colors hover:bg-[var(--card-hover)]">
      <td className="overflow-hidden whitespace-nowrap py-0 pl-3 pr-1.5 align-middle text-[12px] tabular-nums text-[var(--text-tertiary)] sm:pl-4 sm:pr-2">
        {formatShortDate(record.match_date)}
      </td>

      <td className="hidden overflow-hidden px-2 align-middle text-[12px] text-[var(--text-tertiary)] md:table-cell">
        <span className="block truncate">{competition}</span>
      </td>

      <td className="overflow-hidden px-1.5 align-middle sm:px-2">
        {href ? (
          <Link
            href={href}
            prefetch={false}
            className="flex min-h-[44px] flex-col justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            {fixture}
            <span className="truncate text-[11px] text-[var(--text-tertiary)] md:hidden">
              {competition} · {callText}
            </span>
          </Link>
        ) : (
          <div className="flex min-h-[44px] flex-col justify-center">
            {fixture}
            <span className="truncate text-[11px] text-[var(--text-tertiary)] md:hidden">
              {competition} · {callText}
            </span>
          </div>
        )}
      </td>

      <td className="hidden overflow-hidden px-2 align-middle md:table-cell">
        <span className="block truncate text-[var(--text-secondary)]" title={callText}>
          {call}
          {predicted && (
            <span className="pl-1.5 tabular-nums text-[var(--text-tertiary)]">
              {predicted}
            </span>
          )}
        </span>
      </td>

      <td className="hidden overflow-hidden whitespace-nowrap px-2 text-right align-middle tabular-nums text-[var(--text-tertiary)] sm:table-cell">
        {formatConfidence(record.confidence)}
      </td>

      <td className="overflow-hidden whitespace-nowrap px-1.5 text-right align-middle tabular-nums sm:px-2">
        {score ? (
          <span className="font-semibold text-[var(--text-primary)]">{score}</span>
        ) : (
          <span className="text-[var(--text-tertiary)]">—</span>
        )}
      </td>

      <td className="whitespace-nowrap py-0 pl-1 pr-3 text-right align-middle sm:pr-4">
        <OutcomeMark record={record} />
      </td>
    </tr>
  )
}

export function LedgerTable({ records }: { records: LedgerRecord[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      {/* table-fixed + widths on the header cells keeps the fixture column the
          only elastic one, so long club names truncate instead of pushing the
          numeric columns off the edge. Hidden columns claim no width. */}
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[300px] table-fixed border-collapse text-[13px]">
          <caption className="sr-only">
            Settled and pending predictions, newest first. Each row lists the
            fixture, the outcome we called, our confidence, the final score and
            whether the call was right.
          </caption>
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              <th
                scope="col"
                className="w-[52px] py-2 pl-3 pr-1.5 text-left font-semibold sm:w-[64px] sm:pl-4 sm:pr-2"
              >
                Date
              </th>
              <th
                scope="col"
                className="hidden px-2 py-2 text-left font-semibold md:table-cell md:w-[104px]"
              >
                Competition
              </th>
              <th scope="col" className="px-1.5 py-2 text-left font-semibold sm:px-2">
                Fixture
              </th>
              <th
                scope="col"
                className="hidden px-2 py-2 text-left font-semibold md:table-cell md:w-[184px]"
              >
                Our call
              </th>
              <th
                scope="col"
                className="hidden px-2 py-2 text-right font-semibold sm:table-cell sm:w-[60px]"
              >
                Conf.
              </th>
              <th
                scope="col"
                className="w-[46px] px-1.5 py-2 text-right font-semibold sm:w-[58px] sm:px-2"
              >
                Result
              </th>
              <th
                scope="col"
                className="w-[26px] py-2 pl-1 pr-3 text-right font-semibold sm:w-[32px] sm:pr-4"
              >
                <span className="sr-only">Call correct</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <LedgerRow
                key={`${record.match_id}-${record.match_date}`}
                record={record}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Loading placeholder shaped like the ledger it replaces — no card blocks. */
export function LedgerSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
      aria-hidden="true"
    >
      <div className="h-[33px] border-b border-[var(--border-color)]" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex min-h-[44px] items-center gap-3 border-t border-[var(--border-color)] px-3 sm:px-4"
        >
          <div className="h-2.5 w-10 rounded bg-[var(--muted-bg)]" />
          <div className="h-2.5 flex-1 rounded bg-[var(--muted-bg)]" />
          <div className="h-2.5 w-8 rounded bg-[var(--muted-bg)]" />
        </div>
      ))}
    </div>
  )
}
