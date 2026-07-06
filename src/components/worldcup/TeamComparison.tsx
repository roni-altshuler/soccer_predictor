'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeftRight } from 'lucide-react'

import type { BracketTeam } from '@/lib/server/worldCup'

/**
 * Head-to-head comparison of any two World Cup teams from the committed
 * simulation snapshot. The "if they met" split is the canonical Elo
 * expected score on a neutral pitch — a well-defined quantity, not a
 * fabricated matchup prediction. Tournament-path rows are the per-team
 * advancement probabilities straight from the Monte Carlo run.
 */
type Row = {
  label: string
  a: number
  b: number
  format: (n: number) => string
  /** higher value is the "stronger" side for highlighting */
  higherIsBetter: boolean
}

const pct = (n: number) => (n >= 0.995 ? '100%' : `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`)

function eloExpected(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400))
}

function SideName({ name, group, align }: { name: string; group?: string; align: 'left' | 'right' }) {
  return (
    <div className={align === 'right' ? 'text-right' : 'text-left'}>
      <p className="text-[15px] font-extrabold leading-tight text-[var(--text-primary)]">{name}</p>
      {group ? (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Group {group}
        </p>
      ) : null}
    </div>
  )
}

export default function TeamComparison({ teams }: { teams: BracketTeam[] }) {
  const sorted = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams])
  const byChamp = useMemo(() => [...teams].sort((a, b) => b.p_champion - a.p_champion), [teams])

  const [aName, setAName] = useState(byChamp[0]?.name ?? '')
  const [bName, setBName] = useState(byChamp[1]?.name ?? '')

  const a = teams.find((t) => t.name === aName)
  const b = teams.find((t) => t.name === bName)

  if (!a || !b) {
    return (
      <p className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-5 text-small text-[var(--text-secondary)]">
        Comparison data is unavailable.
      </p>
    )
  }

  const eloA = a.elo ?? 1500
  const eloB = b.elo ?? 1500
  const winA = eloExpected(eloA, eloB)
  const winB = 1 - winA

  const rows: Row[] = [
    { label: 'Team rating', a: eloA, b: eloB, format: (n) => n.toFixed(0), higherIsBetter: true },
    { label: 'Win the tournament', a: a.p_champion, b: b.p_champion, format: pct, higherIsBetter: true },
    { label: 'Reach the final', a: a.p_final, b: b.p_final, format: pct, higherIsBetter: true },
    { label: 'Reach the semi-finals', a: a.p_semi, b: b.p_semi, format: pct, higherIsBetter: true },
    { label: 'Reach the quarter-finals', a: a.p_quarter, b: b.p_quarter, format: pct, higherIsBetter: true },
    { label: 'Reach the round of 16', a: a.p_r16, b: b.p_r16, format: pct, higherIsBetter: true },
    { label: 'Survive the group', a: a.p_r32, b: b.p_r32, format: pct, higherIsBetter: true },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Selectors */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamSelect value={aName} onChange={setAName} options={sorted} disabledName={bName} />
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-tertiary)]">
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
        </span>
        <TeamSelect value={bName} onChange={setBName} options={sorted} disabledName={aName} />
      </div>

      {/* Neutral-pitch Elo expectation */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 shadow-[var(--shadow-sm)]">
        <div className="mb-2 flex items-center justify-between">
          <SideName name={a.name} group={a.group} align="left" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            If they met · neutral pitch
          </span>
          <SideName name={b.name} group={b.group} align="right" />
        </div>
        <div className="flex h-7 w-full overflow-hidden rounded-lg text-[12px] font-bold">
          <motion.div
            className="flex items-center justify-start bg-[var(--accent-primary)] pl-2 text-[var(--accent-on-primary)]"
            initial={{ width: 0 }}
            animate={{ width: `${winA * 100}%` }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            {pct(winA)}
          </motion.div>
          <motion.div
            className="flex items-center justify-end bg-[var(--accent-loss)] pr-2 text-white"
            initial={{ width: 0 }}
            animate={{ width: `${winB * 100}%` }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            {pct(winB)}
          </motion.div>
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          Expected result from team ratings — the draw share is folded into each side&apos;s win expectancy.
        </p>
      </div>

      {/* Stat rows */}
      <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)]">
        {rows.map((r, i) => {
          const aBetter = r.higherIsBetter ? r.a >= r.b : r.a <= r.b
          const bBetter = r.higherIsBetter ? r.b >= r.a : r.b <= r.a
          const max = Math.max(r.a, r.b, 1e-9)
          return (
            <div
              key={r.label}
              className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 ${
                i > 0 ? 'border-t border-[var(--border-color)]' : ''
              }`}
            >
              {/* A side */}
              <div className="flex min-w-0 items-center justify-end gap-2">
                <span
                  className={`text-[13px] font-bold tabular-nums ${
                    aBetter ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {r.format(r.a)}
                </span>
                <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-[var(--muted-bg)] sm:block">
                  <div
                    className="ml-auto h-full rounded-full"
                    style={{
                      width: `${(r.a / max) * 100}%`,
                      background: aBetter ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                    }}
                  />
                </div>
              </div>
              <span className="w-[88px] text-center text-[10px] font-semibold uppercase leading-tight tracking-wider text-[var(--text-tertiary)] sm:w-36 sm:text-[11px]">
                {r.label}
              </span>
              {/* B side */}
              <div className="flex min-w-0 items-center gap-2">
                <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-[var(--muted-bg)] sm:block">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(r.b / max) * 100}%`,
                      background: bBetter ? 'var(--accent-loss)' : 'var(--text-tertiary)',
                    }}
                  />
                </div>
                <span
                  className={`text-[13px] font-bold tabular-nums ${
                    bBetter ? 'text-[var(--accent-loss)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {r.format(r.b)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TeamSelect({
  value,
  onChange,
  options,
  disabledName,
}: {
  value: string
  onChange: (v: string) => void
  options: BracketTeam[]
  disabledName: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2.5 text-[13px] font-semibold text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
      aria-label="Select a team to compare"
    >
      {options.map((t) => (
        <option key={t.name} value={t.name} disabled={t.name === disabledName}>
          {t.name}
          {t.group ? ` · Group ${t.group}` : ''}
        </option>
      ))}
    </select>
  )
}
