'use client'

import { useState } from 'react'

import { Formation } from '@/components/fixture/Formation'
import type { MatchCard, StatRow, TimelineEvent } from '@/lib/server/tieFixtures'
import { cn } from '@/lib/utils'

/**
 * One match, in the depth ESPN actually publishes.
 *
 * Four views, and a tab only exists when its data does — an empty *Lineups*
 * tab on a fixture whose sheets were never filed teaches a reader that the
 * site is broken. Nothing here is computed or filled in: every number is
 * ESPN's, and a stat that is missing on one side is dropped rather than paired
 * against a zero.
 */

const KIND: Record<string, { mark: string; tone: string; label: string }> = {
  goal: { mark: '●', tone: 'text-[var(--accent-primary)]', label: 'Goal' },
  'own-goal': { mark: '●', tone: 'text-[var(--accent-loss)]', label: 'Own goal' },
  'penalty-goal': { mark: '●', tone: 'text-[var(--accent-primary)]', label: 'Penalty' },
  'penalty-missed': { mark: '○', tone: 'text-[var(--text-tertiary)]', label: 'Penalty missed' },
  'yellow-card': { mark: '▮', tone: 'text-[var(--accent-warn)]', label: 'Yellow card' },
  'red-card': { mark: '▮', tone: 'text-[var(--accent-loss)]', label: 'Red card' },
  'yellow-red-card': { mark: '▮', tone: 'text-[var(--accent-loss)]', label: 'Second yellow' },
  substitution: { mark: '⇄', tone: 'text-[var(--text-tertiary)]', label: 'Substitution' },
}

const fallback = { mark: '·', tone: 'text-[var(--text-tertiary)]', label: '' }

function Timeline({ events, homeId }: { events: TimelineEvent[]; homeId: string }) {
  return (
    <ol className="space-y-2.5">
      {events.map((e) => {
        const k = KIND[e.type] ?? fallback
        const isHome = e.teamId === homeId
        return (
          <li
            key={e.id}
            data-event={e.type}
            className={cn(
              'flex items-baseline gap-2.5',
              !isHome && e.teamId ? 'flex-row-reverse text-right' : '',
            )}
          >
            <span className="w-9 shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {e.minute}
            </span>
            <span className={cn('shrink-0 text-[11px] leading-none', k.tone)} aria-hidden="true">
              {k.mark}
            </span>
            <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              <span className="sr-only">{k.label ? `${k.label}. ` : ''}</span>
              {e.players.length ? (
                <>
                  <span className="text-[var(--text-primary)]">{e.players[0]}</span>
                  {e.players[1] ? (
                    <span className="text-[var(--text-tertiary)]">
                      {e.type === 'substitution' ? ' for ' : ' assist '}
                      {e.players[1]}
                    </span>
                  ) : null}
                </>
              ) : (
                e.short
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Stats({ stats, homeName, awayName }: { stats: StatRow[]; homeName: string; awayName: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          {homeName}
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          {awayName}
        </span>
      </div>
      <ul className="mt-3 space-y-3">
        {stats.map((s) => {
          const h = s.homeValue ?? 0
          const a = s.awayValue ?? 0
          const total = h + a
          const hPct = total > 0 ? (h / total) * 100 : 50
          return (
            <li key={s.name} data-stat={s.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
                  {s.home}
                </span>
                <span className="truncate text-[11px] text-[var(--text-tertiary)]">{s.label}</span>
                <span className="font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
                  {s.away}
                </span>
              </div>
              {s.homeValue !== null && s.awayValue !== null ? (
                <div
                  aria-hidden="true"
                  className="mt-1 flex h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]"
                >
                  <span
                    className="block h-full bg-[var(--accent-primary)]"
                    style={{ width: `${hPct}%` }}
                  />
                  <span
                    className="block h-full bg-[var(--accent-info)]"
                    style={{ width: `${100 - hPct}%` }}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Commentary({ lines }: { lines: MatchCard['commentary'] }) {
  const [all, setAll] = useState(false)
  const shown = all ? lines : lines.slice(0, 14)
  return (
    <div>
      <ol className="space-y-2.5">
        {shown.map((c) => (
          <li key={c.sequence} className="flex items-baseline gap-2.5">
            <span className="w-9 shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {c.minute}
            </span>
            <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {c.text}
            </span>
          </li>
        ))}
      </ol>
      {lines.length > 14 ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-3 min-h-[32px] rounded-md border border-[var(--border-color)] px-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {all ? 'Show less' : `All ${lines.length} entries`}
        </button>
      ) : null}
    </div>
  )
}

const fmtWhen = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      })
    : ''

export function LegDetail({ card, legLabel }: { card: MatchCard; legLabel?: string | null }) {
  const tabs = [
    ['Timeline', card.events.length],
    ['Stats', card.stats.length],
    ['Lineups', card.lineups.length],
    ['Commentary', card.commentary.length],
  ] as const
  const available = tabs.filter(([, n]) => n > 0).map(([t]) => t)
  const [tab, setTab] = useState<string>(available[0] ?? 'Timeline')
  const active = available.includes(tab as (typeof available)[number]) ? tab : available[0]

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {[legLabel || card.leg, fmtWhen(card.date), card.statusDetail]
            .filter(Boolean)
            .join(' · ')}
          {card.neutralSite ? ' · neutral venue' : ''}
        </p>
        <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--text-primary)]">
            {card.home.name}
          </span>
          <span className="font-mono text-[20px] tabular-nums text-[var(--text-primary)]">
            {card.home.score ?? '–'}<span className="mx-1.5 text-[var(--text-tertiary)]">:</span>{card.away.score ?? '–'}
          </span>
          <span className="min-w-0 truncate text-right text-[14px] font-semibold text-[var(--text-primary)]">
            {card.away.name}
          </span>
        </div>
        {card.venue || card.attendance || card.officials.length ? (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            {[
              card.venue
                ? [card.venue.name, card.venue.city].filter(Boolean).join(', ')
                : null,
              card.attendance ? `${card.attendance.toLocaleString('en-GB')} in` : null,
              card.officials.length ? `Referee ${card.officials[0]}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </header>

      {available.length ? (
        <>
          <div
            role="tablist"
            aria-label="Match detail"
            className="mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {available.map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={t === active}
                onClick={() => setTab(t)}
                className={cn(
                  'min-h-[32px] shrink-0 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
                  t === active
                    ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                    : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {active === 'Timeline' ? (
              <Timeline events={card.events} homeId={card.home.id} />
            ) : active === 'Stats' ? (
              <Stats stats={card.stats} homeName={card.home.name} awayName={card.away.name} />
            ) : active === 'Lineups' ? (
              <Formation
                lineups={card.lineups}
                homeName={card.home.name}
                awayName={card.away.name}
              />
            ) : (
              <Commentary lines={card.commentary} />
            )}
          </div>
        </>
      ) : (
        <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          {card.state === 'pre'
            ? 'Team sheets and commentary appear about an hour before kickoff.'
            : 'No timeline, stats or team sheets were published for this match.'}
        </p>
      )}
    </section>
  )
}
