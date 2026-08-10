'use client'

import type { ScopeCounts } from '@/lib/predictionScope'
import { cn } from '@/lib/utils'

/**
 * What the record covers, and what it deliberately leaves out.
 *
 * The page used to print one hit rate over every prediction ever stored: eleven
 * competitions and three model generations, 44.29% over 1,244 settled picks.
 * Six of those competitions are not in the product and 1,162 of those picks
 * came from a model retired on 2026-08-08. Filtering to the serving model in
 * the covered leagues is the correct fix, but it shrinks the sample enormously,
 * and a number that quietly got smaller is its own kind of dishonesty.
 *
 * So the exclusions are stated. A thin record is the truthful state of a model
 * that only recently became the default, in leagues that were in their close
 * season — and saying so is more informative than the large wrong number was.
 */

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}

export function ScopeNote({ scope, className }: { scope?: ScopeCounts; className?: string }) {
  if (!scope || scope.total === 0) return null

  const excluded = scope.outOfScopeLeague + scope.retiredModel
  if (excluded === 0) return null

  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3.5 md:px-5',
        className
      )}
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        What this record covers
      </h2>
      <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        <p>
          Scored on <span className="text-[var(--text-primary)]">{plural(scope.inScope, 'pick')}</span>{' '}
          — the model serving today, in the five leagues the product covers.{' '}
          {plural(excluded, 'other stored pick')} {excluded === 1 ? 'is' : 'are'} held out.
        </p>
        <ul className="ml-4 list-disc space-y-1">
          {scope.retiredModel > 0 && (
            <li>
              {plural(scope.retiredModel, 'pick')} from a retired model. Their accuracy is a fact
              about a model that no longer runs, so averaging it in would describe nothing that
              exists.
            </li>
          )}
          {scope.outOfScopeLeague > 0 && (
            <li>
              {plural(scope.outOfScopeLeague, 'pick')} in competitions outside the covered set.
              Those leagues ship no predictions, so they carry no track record either.
            </li>
          )}
        </ul>
        <p className="text-[var(--text-tertiary)]">
          A small sample is a real limitation and is not smoothed over anywhere on this page. Rates
          below their minimum sample lose their verdict, and the market benchmark below states its
          own fixture count and date range separately.
        </p>
      </div>
    </div>
  )
}
