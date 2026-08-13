'use client'

import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * The projected final table.
 *
 * Two layouts, not one layout squeezed. A twenty-row six-column table at 375px
 * is unusable however small the text gets, so narrow screens get a stacked
 * card per club with the same numbers and the same sort. `hidden md:block` /
 * `md:hidden` rather than a horizontal scroll: scrolling a table sideways
 * hides the club name, which is the column you navigate by.
 *
 * Sorting is real `<th><button>` — clickable, focusable, and announced via
 * `aria-sort`, so keyboard and screen-reader users get the same control.
 */

export interface ProjectedRow {
  team: string
  p_title: number
  /** P(finishing inside this league's own headline band) — see `topCutLabel`. */
  p_top_cut?: number
  p_top4: number
  /**
   * Null where the competition has no relegation. Zero would read as "safe",
   * which is a different claim from "this league does not relegate anyone".
   */
  p_relegated: number | null
  p_playoff: number | null
  exp_points: number
  exp_position: number
  played: number
  points: number
  /** Grouped competitions only (MLS): the conference and the rank inside it. */
  group?: string
  group_exp_position?: number
  p_group_title?: number
  p_qualify?: number | null
}

type SortKey =
  | 'exp_position'
  | 'p_title'
  | 'p_top_cut'
  | 'p_relegated'
  | 'exp_points'

/**
 * The band worth naming differs by competition. Fourth place is a Champions
 * League spot in a top flight and nothing whatsoever in a second tier, where
 * second is the last automatic promotion place — so the column is labelled by
 * the league rather than hard-coded to "Top 4".
 */
const columns = (
  topCutLabel: string,
): { key: SortKey; label: string; short: string; desc: boolean }[] => [
  { key: 'exp_position', label: 'Projected position', short: 'Pos', desc: false },
  { key: 'exp_points', label: 'Expected points', short: 'xPts', desc: true },
  { key: 'p_title', label: 'Title', short: 'Title', desc: true },
  { key: 'p_top_cut', label: topCutLabel, short: topCutLabel, desc: true },
  { key: 'p_relegated', label: 'Relegation', short: 'Rel', desc: true },
]

/** Older artifacts predate `p_top_cut`; their top cut was always four. */
const topCut = (r: ProjectedRow) => r.p_top_cut ?? r.p_top4

const pct = (v: number) => (v >= 0.001 ? `${(v * 100).toFixed(1)}%` : '—')

export function ProjectedTable({
  rows,
  relegationPlaces,
  topCutLabel = 'Top 4',
  className,
}: {
  rows: ProjectedRow[]
  relegationPlaces: number
  topCutLabel?: string
  className?: string
}) {
  const [sort, setSort] = useState<SortKey>('exp_position')
  const [desc, setDesc] = useState(false)
  const COLUMNS = useMemo(() => columns(topCutLabel), [topCutLabel])

  const value = (r: ProjectedRow, key: SortKey) =>
    key === 'p_top_cut' ? topCut(r) : r[key]

  const sorted = useMemo(() => {
    const dir = desc ? -1 : 1
    return [...rows].sort(
      (a, b) => (value(a, sort) - value(b, sort)) * dir || a.team.localeCompare(b.team),
    )
  }, [rows, sort, desc])

  const toggle = (key: SortKey) => {
    if (key === sort) {
      setDesc((d) => !d)
      return
    }
    setSort(key)
    setDesc(COLUMNS.find((c) => c.key === key)?.desc ?? true)
  }

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (key !== sort) return 'none'
    return desc ? 'descending' : 'ascending'
  }

  return (
    <div className={className}>
      {/* ---- desktop / tablet ------------------------------------------ */}
      <div className="hidden md:block">
        <table className="w-full border-collapse font-mono text-[12px] tabular-nums">
          <caption className="sr-only">
            Projected final table. Sortable by projected position, expected points,
            title probability, top-four probability and relegation probability.
          </caption>
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              <th scope="col" className="pb-2 pr-3 font-medium">
                Club
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort(c.key)}
                  className="pb-2 pl-3 text-right font-medium"
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={cn(
                      'rounded-sm uppercase tracking-[0.1em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]',
                      c.key === sort
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                    )}
                  >
                    {c.short}
                    <span aria-hidden className="ml-1">
                      {c.key === sort ? (desc ? '↓' : '↑') : ''}
                    </span>
                    <span className="sr-only">, sort by {c.label}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => (
              <tr key={t.team} className="border-t border-[var(--border-color)]">
                <th
                  scope="row"
                  className="max-w-[220px] truncate py-2 pr-3 text-left font-sans text-[13px] font-normal text-[var(--text-secondary)]"
                >
                  <span className="mr-2 font-mono text-[11px] text-[var(--text-tertiary)]">
                    {i + 1}
                  </span>
                  {t.team}
                </th>
                <td className="py-2 pl-3 text-right text-[var(--text-tertiary)]">
                  {t.exp_position.toFixed(1)}
                </td>
                <td className="py-2 pl-3 text-right text-[var(--text-secondary)]">
                  {t.exp_points.toFixed(0)}
                </td>
                <td
                  className={cn(
                    'py-2 pl-3 text-right',
                    t.p_title >= 0.05
                      ? 'text-[var(--accent-primary)]'
                      : 'text-[var(--text-tertiary)]',
                  )}
                >
                  {pct(t.p_title)}
                </td>
                <td className="py-2 pl-3 text-right text-[var(--text-tertiary)]">
                  {pct(topCut(t))}
                </td>
                <td
                  className={cn(
                    'py-2 pl-3 text-right',
                    t.p_relegated >= 0.2
                      ? 'text-[var(--accent-warn)]'
                      : 'text-[var(--text-tertiary)]',
                  )}
                >
                  {pct(t.p_relegated)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- mobile ----------------------------------------------------- */}
      <div className="md:hidden">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort table">
          {COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={c.key === sort}
              onClick={() => toggle(c.key)}
              className={cn(
                'rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]',
                c.key === sort
                  ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-tertiary)]',
              )}
            >
              {c.short}
              {c.key === sort ? (desc ? ' ↓' : ' ↑') : ''}
            </button>
          ))}
        </div>

        <ul className="mt-3 space-y-2">
          {sorted.map((t, i) => (
            <li
              key={t.team}
              className="rounded-lg border border-[var(--border-color)] px-3 py-2.5"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--text-primary)]">
                  {t.team}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
                  {t.exp_points.toFixed(0)} pts
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { label: 'Title', value: t.p_title, warn: false },
                  { label: topCutLabel, value: topCut(t), warn: false },
                  { label: 'Rel', value: t.p_relegated, warn: t.p_relegated >= 0.2 },
                ].map((x) => (
                  <div key={x.label}>
                    <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                      {x.label}
                    </dt>
                    <dd
                      className={cn(
                        'font-mono text-[13px] tabular-nums',
                        x.warn
                          ? 'text-[var(--accent-warn)]'
                          : 'text-[var(--text-secondary)]',
                      )}
                    >
                      {pct(x.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {relegationPlaces} of {rows.length} go down. Probabilities come from 20,000
        simulations of the remaining fixtures; each run draws one strength offset per
        club and holds it all season, so a club&apos;s error is correlated across its
        matches rather than averaging away.
      </p>
    </div>
  )
}
