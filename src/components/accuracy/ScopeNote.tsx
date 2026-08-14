'use client'

import type { ScopeCounts } from '@/lib/predictionScope'
import { cn } from '@/lib/utils'

/**
 * What the record covers, and what it deliberately leaves out.
 *
 * The page used to print one hit rate over every prediction ever stored: eleven
 * competitions and three model generations. Six of those competitions are not
 * in the product and most of those picks came from a model retired on
 * 2026-08-08. Filtering to the serving model in the covered leagues is the
 * correct fix, but it shrinks the sample enormously, and a number that quietly
 * got smaller is its own kind of dishonesty.
 *
 * So the exclusions are stated — as a bar, not as a paragraph with a bulleted
 * list under it. The proportion IS the point: a scored slice that is a sliver
 * of the stored pool says "thin record, honestly labelled" in one glance, which
 * is exactly what three sentences of hedging took a paragraph to say and got
 * skipped for.
 */

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}

export function ScopeNote({ scope, className }: { scope?: ScopeCounts; className?: string }) {
  if (!scope || scope.total === 0) return null

  const excluded = scope.outOfScopeLeague + scope.retiredModel
  if (excluded === 0) return null

  const total = Math.max(1, scope.inScope + excluded)
  const segments = [
    {
      key: 'in',
      n: scope.inScope,
      label: 'Scored here',
      detail: 'the model serving today, in the covered leagues',
      tone: 'var(--accent-primary)',
    },
    {
      key: 'retired',
      n: scope.retiredModel,
      label: 'Retired model',
      detail: 'a fact about a model that no longer runs',
      tone: 'color-mix(in srgb, var(--text-tertiary) 80%, transparent)',
    },
    {
      key: 'league',
      n: scope.outOfScopeLeague,
      label: 'Out of scope',
      detail: 'competitions that ship no predictions',
      tone: 'color-mix(in srgb, var(--text-tertiary) 45%, transparent)',
    },
  ].filter((s) => s.n > 0)

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5',
        className,
      )}
      aria-label="What this record covers"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          What this record covers
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          {plural(scope.inScope, 'pick')} of {total.toLocaleString()} stored
        </span>
      </div>

      {/* One bar, three segments. Held-out picks are not deleted from the
          picture — they are shown at their real size next to what is scored. */}
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[var(--border-color)]">
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${(s.n / total) * 100}%`, background: s.tone }}
            title={`${s.label}: ${s.n.toLocaleString()}`}
          />
        ))}
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.key} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="mt-[3px] h-2 w-2 shrink-0 rounded-full"
              style={{ background: s.tone }}
            />
            <div className="min-w-0">
              <dt className="truncate text-[12px] text-[var(--text-secondary)]">
                {s.label}{' '}
                <span className="font-mono tabular-nums text-[var(--text-primary)]">
                  {s.n.toLocaleString()}
                </span>
              </dt>
              <dd className="text-[11px] leading-snug text-[var(--text-tertiary)]">{s.detail}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  )
}
