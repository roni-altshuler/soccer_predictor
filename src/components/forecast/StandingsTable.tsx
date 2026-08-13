'use client'

import { useMemo, useState } from 'react'

import { TeamCrest } from '@/components/primitives/TeamCrest'
import { cn } from '@/lib/utils'

import type { ProjectedRow } from './ProjectedTable'

/**
 * The standings, read the way a supporter reads them.
 *
 * The order of the columns is the argument. A league table is answering "where
 * is my club" first and "what does the model think" second, so the left half
 * is what has actually happened — position, crest, played, points — and the
 * projection follows it. The previous table led with expected position, which
 * put a modelled number where every reader's eye looks for a real one.
 *
 * **Qualification bands are the table's real structure.** A supporter does not
 * read row 4 and row 5 as adjacent; they read one as Europe and the other as
 * not. The edge stripe and the legend carry that, and both are driven by the
 * league's own `top_cut` and relegation count rather than hard-coded — fourth
 * is a Champions League place in the Premier League, the last playoff place in
 * MLS, and nothing at all somewhere else.
 *
 * **A grouped competition gets group tabs, not one long list.** An MLS club's
 * season is decided inside its conference; ranking all thirty together answers
 * only the Supporters' Shield, which is why that is a separate tab rather than
 * the default view.
 *
 * Colour is never the only carrier: every band is also a legend entry, every
 * probability is text, and the stripe has a `title`.
 */

export interface GroupMeta {
  name: string
  short: string
  teams: number
  qualify: number
}

type Band = 'top' | 'qualify' | 'playoff' | 'relegation' | null

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v >= 0.001 ? `${(v * 100).toFixed(1)}%` : '—'

/**
 * Inline rather than Tailwind classes because the softer band needs an alpha
 * of the token, and `bg-[color-mix(in_srgb,var(--x)_45%,transparent)]` does not work: Tailwind's opacity
 * modifier has to know the colour to blend it, and a CSS variable is opaque to
 * it at build time. The class silently produced no background at all, so the
 * qualification band — four rows of every table — was invisible while the
 * champion's stripe rendered fine.
 */
const BAND_STYLE: Record<Exclude<Band, null>, string> = {
  top: 'var(--accent-primary)',
  qualify: 'color-mix(in srgb, var(--accent-primary) 45%, transparent)',
  playoff: 'var(--accent-warn-soft, var(--accent-warn))',
  relegation: 'var(--accent-warn)',
}

export function StandingsTable({
  rows,
  competitionId,
  relegationPlaces,
  topCut = 4,
  topCutLabel = 'Top 4',
  groups,
  qualifyLabel,
  className,
}: {
  rows: ProjectedRow[]
  competitionId?: string
  relegationPlaces: number
  topCut?: number
  topCutLabel?: string
  /** Present only for a competition ranked inside groups, e.g. MLS. */
  groups?: GroupMeta[] | null
  qualifyLabel?: string | null
  className?: string
}) {
  const grouped = Boolean(groups && groups.length > 1)
  // Open on a group rather than on the combined table: it is the view that
  // answers the question the competition is actually deciding.
  const [view, setView] = useState<string>(grouped ? groups![0].name : 'all')

  const inGroup = grouped && view !== 'all'
  const active = grouped ? groups!.find((g) => g.name === view) : undefined

  const visible = useMemo(() => {
    const subset = inGroup ? rows.filter((r) => r.group === view) : rows
    return [...subset].sort((a, b) => {
      const pa = inGroup ? (a.group_exp_position ?? 99) : a.exp_position
      const pb = inGroup ? (b.group_exp_position ?? 99) : b.exp_position
      return pa - pb || b.points - a.points || a.team.localeCompare(b.team)
    })
  }, [rows, inGroup, view])

  const bandFor = (index: number): Band => {
    const n = visible.length
    if (inGroup && active) {
      if (index === 0) return 'top'
      if (active.qualify && index < active.qualify) return 'qualify'
      return null
    }
    if (index < 1) return 'top'
    if (index < topCut) return 'qualify'
    if (relegationPlaces > 0 && index >= n - relegationPlaces) return 'relegation'
    return null
  }

  // Which projected columns make sense depends on the view, so they are named
  // here rather than assumed. In a conference, "title" means winning that
  // conference and the cut is the playoff line.
  const cols = inGroup
    ? {
        a: { short: 'Win conf', label: `Wins the ${active?.short} Conference` },
        b: {
          short: qualifyLabel ? 'Playoffs' : 'Qualify',
          label: qualifyLabel ?? 'Qualifies',
        },
      }
    : {
        a: { short: 'Title', label: 'Wins the league' },
        b: { short: topCutLabel, label: `Finishes in the ${topCutLabel}` },
      }

  const valueA = (r: ProjectedRow) => (inGroup ? r.p_group_title : r.p_title)
  const valueB = (r: ProjectedRow) =>
    inGroup ? r.p_qualify : (r.p_top_cut ?? r.p_top4)
  const position = (r: ProjectedRow) =>
    inGroup ? r.group_exp_position : r.exp_position

  return (
    <div className={className}>
      {grouped && (
        <div
          role="tablist"
          aria-label="Conference"
          className="mb-4 flex flex-wrap gap-1.5"
        >
          {[...groups!.map((g) => ({ id: g.name, label: g.short })), {
            id: 'all',
            // Named for what the combined table decides, because a 30-team
            // MLS list is not "the table" — it is one specific trophy.
            label: 'Supporters’ Shield',
          }].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                'rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]',
                view === tab.id
                  ? 'border-[var(--text-tertiary)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ---- table: md and up ------------------------------------------- */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <caption className="sr-only">
            {inGroup
              ? `${active?.name} standings, projected to the end of the season.`
              : 'Projected final table.'}{' '}
            Played and points are what has happened; the remaining columns are
            the model&apos;s projection.
          </caption>
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              <th scope="col" className="w-8 pb-2 pl-3 font-medium">
                #
              </th>
              <th scope="col" className="pb-2 pr-3 font-medium">
                Club
              </th>
              <th scope="col" className="w-12 pb-2 pl-3 text-right font-medium">
                P
              </th>
              <th scope="col" className="w-14 pb-2 pl-3 text-right font-medium">
                Pts
              </th>
              <th scope="col" className="w-16 pb-2 pl-3 text-right font-medium">
                <abbr title="Projected final points" className="no-underline">
                  xPts
                </abbr>
              </th>
              <th scope="col" className="w-20 pb-2 pl-3 text-right font-medium">
                {cols.a.short}
              </th>
              <th scope="col" className="w-24 pb-2 pl-3 text-right font-medium">
                {cols.b.short}
              </th>
              {relegationPlaces > 0 && (
                <th scope="col" className="w-16 pb-2 pl-3 text-right font-medium">
                  Rel
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const band = bandFor(i)
              return (
                <tr
                  key={t.team}
                  className="group border-t border-[var(--border-color)] transition-colors hover:bg-[var(--card-hover)]"
                >
                  <td className="relative py-2 pl-3 font-mono text-[12px] text-[var(--text-tertiary)]">
                    {band && (
                      <span
                        aria-hidden
                        title={BAND_TITLE[band]}
                        style={{ background: BAND_STYLE[band] }}
                        className="absolute left-0 top-0 h-full w-[3px]"
                      />
                    )}
                    {i + 1}
                  </td>
                  <th
                    scope="row"
                    className="max-w-[240px] py-2 pr-3 text-left font-normal"
                  >
                    <span className="flex items-center gap-2.5">
                      <TeamCrest
                        team={t.team}
                        competitionId={competitionId}
                        size="md"
                      />
                      <span className="truncate text-[var(--text-primary)]">
                        {t.team}
                      </span>
                    </span>
                  </th>
                  <td className="py-2 pl-3 text-right font-mono text-[12px] text-[var(--text-tertiary)]">
                    {t.played}
                  </td>
                  <td className="py-2 pl-3 text-right font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                    {t.points}
                  </td>
                  <td className="py-2 pl-3 text-right font-mono text-[12px] text-[var(--text-secondary)]">
                    {t.exp_points.toFixed(0)}
                    <span className="sr-only">
                      {' '}
                      projected, finishing around position{' '}
                      {position(t)?.toFixed(1)}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'py-2 pl-3 text-right font-mono text-[12px]',
                      (valueA(t) ?? 0) >= 0.05
                        ? 'text-[var(--accent-primary)]'
                        : 'text-[var(--text-tertiary)]',
                    )}
                  >
                    {pct(valueA(t))}
                  </td>
                  <td className="py-2 pl-3 text-right font-mono text-[12px] text-[var(--text-secondary)]">
                    {pct(valueB(t))}
                  </td>
                  {relegationPlaces > 0 && (
                    <td
                      className={cn(
                        'py-2 pl-3 text-right font-mono text-[12px]',
                        (t.p_relegated ?? 0) >= 0.2
                          ? 'text-[var(--accent-warn)]'
                          : 'text-[var(--text-tertiary)]',
                      )}
                    >
                      {pct(t.p_relegated)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ---- cards: below md -------------------------------------------- */}
      <ul className="space-y-px md:hidden">
        {visible.map((t, i) => {
          const band = bandFor(i)
          return (
            <li
              key={t.team}
              className="relative flex items-center gap-3 border-t border-[var(--border-color)] py-2.5 pl-3"
            >
              {band && (
                <span
                  aria-hidden
                  title={BAND_TITLE[band]}
                  style={{ background: BAND_STYLE[band] }}
                  className="absolute left-0 top-0 h-full w-[3px]"
                />
              )}
              <span className="w-5 shrink-0 font-mono text-[12px] text-[var(--text-tertiary)]">
                {i + 1}
              </span>
              <TeamCrest team={t.team} competitionId={competitionId} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-[var(--text-primary)]">
                  {t.team}
                </span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                  {t.played} played · {cols.a.short} {pct(valueA(t))}
                  {relegationPlaces > 0 && (t.p_relegated ?? 0) >= 0.2
                    ? ` · Rel ${pct(t.p_relegated)}`
                    : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[14px] font-semibold text-[var(--text-primary)]">
                  {t.points}
                </span>
                <span className="block font-mono text-[10px] text-[var(--text-tertiary)]">
                  {t.exp_points.toFixed(0)} xPts
                </span>
              </span>
            </li>
          )
        })}
      </ul>

      <Legend
        inGroup={inGroup}
        active={active}
        topCut={topCut}
        topCutLabel={topCutLabel}
        qualifyLabel={qualifyLabel}
        relegationPlaces={relegationPlaces}
      />
    </div>
  )
}

const BAND_TITLE: Record<Exclude<Band, null>, string> = {
  top: 'Top of the table',
  qualify: 'Qualification band',
  playoff: 'Playoff band',
  relegation: 'Relegation band',
}

function Legend({
  inGroup,
  active,
  topCut,
  topCutLabel,
  qualifyLabel,
  relegationPlaces,
}: {
  inGroup: boolean
  active?: GroupMeta
  topCut: number
  topCutLabel: string
  qualifyLabel?: string | null
  relegationPlaces: number
}) {
  const items: { band: Exclude<Band, null>; text: string }[] = []
  if (inGroup && active) {
    items.push({ band: 'top', text: `${active.short} Conference winner` })
    if (active.qualify) {
      items.push({
        band: 'qualify',
        text: `Top ${active.qualify} — ${qualifyLabel ?? 'qualification'}`,
      })
    }
  } else {
    items.push({ band: 'top', text: 'Champion' })
    items.push({ band: 'qualify', text: `Top ${topCut} — ${topCutLabel}` })
    if (relegationPlaces > 0) {
      items.push({
        band: 'relegation',
        text: `Bottom ${relegationPlaces} — relegation`,
      })
    }
  }

  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--border-color)] pt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
      {items.map((it) => (
        <li key={it.band} className="flex items-center gap-2">
          <span
            aria-hidden
            style={{ background: BAND_STYLE[it.band] }}
            className="h-2.5 w-[3px] shrink-0"
          />
          {it.text}
        </li>
      ))}
      <li className="text-[color-mix(in_srgb,var(--text-tertiary)_70%,transparent)]">
        Bands follow the projected finish, not today&apos;s position
      </li>
    </ul>
  )
}
