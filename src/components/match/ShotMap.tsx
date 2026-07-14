'use client'

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'

export interface ShotMapShot {
  /** Normalized pitch coordinates in [0, 1]. */
  x: number
  y: number
  team: 'home' | 'away'
  expectedGoals?: number
  isGoal?: boolean
  minute?: number
  player?: string
}

interface ShotMapProps {
  shots: ShotMapShot[]
  homeTeam: string
  awayTeam: string
  className?: string
}

const HOME_COLOR = 'var(--team-tint-home, var(--accent-primary))'
const AWAY_COLOR = 'var(--team-tint-away, var(--accent-info))'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * ShotMap — real shot locations on a pitch. Renders ONLY when the upstream
 * payload carries actual shot coordinates (the caller must not feed it
 * synthesized positions — the approximate event heatmap covers that case).
 *
 * Grammar: dots sized by xG, goals filled with a ring, other shots outlined;
 * home/away toggle; footer totals the xG per team when xG values exist.
 */
export default function ShotMap({ shots, homeTeam, awayTeam, className }: ShotMapProps) {
  const [focusTeam, setFocusTeam] = useState<'home' | 'away'>('home')
  const reduce = useReducedMotion()

  const valid = useMemo(
    () =>
      shots.filter(
        (s) => Number.isFinite(s.x) && Number.isFinite(s.y) && (s.team === 'home' || s.team === 'away')
      ),
    [shots]
  )

  const focused = useMemo(() => valid.filter((s) => s.team === focusTeam), [valid, focusTeam])

  const xgTotals = useMemo(() => {
    let home = 0
    let away = 0
    let any = false
    for (const s of valid) {
      if (typeof s.expectedGoals === 'number' && Number.isFinite(s.expectedGoals)) {
        any = true
        if (s.team === 'home') home += s.expectedGoals
        else away += s.expectedGoals
      }
    }
    return any ? { home, away } : null
  }, [valid])

  // No real shot data → render nothing (missing data draws nothing).
  if (valid.length === 0) return null

  const teamColor = focusTeam === 'home' ? HOME_COLOR : AWAY_COLOR
  const goals = focused.filter((s) => s.isGoal).length

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className
      )}
    >
      <div className="border-b border-[var(--border-color)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Shot map</h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
              {focused.length} shot{focused.length === 1 ? '' : 's'}
              {goals > 0 ? ` · ${goals} goal${goals === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <div className="flex gap-1 rounded-lg bg-[var(--muted-bg)] p-1" role="group" aria-label="Shot map team">
            {(
              [
                { key: 'home' as const, label: homeTeam },
                { key: 'away' as const, label: awayTeam },
              ]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFocusTeam(key)}
                aria-pressed={focusTeam === key}
                className={cn(
                  'min-h-[44px] max-w-[160px] truncate rounded-md px-3 text-xs font-semibold transition-colors',
                  focusTeam === key
                    ? 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-2.5">
          <svg viewBox="0 0 340 220" className="h-auto w-full" role="img" aria-label="Shot map">
            {/* Pitch outline */}
            <rect x="8" y="8" width="324" height="204" rx="8" fill="transparent" stroke="var(--border-color)" strokeWidth="1.2" />
            <line x1="170" y1="8" x2="170" y2="212" stroke="var(--border-color)" strokeWidth="1" />
            <circle cx="170" cy="110" r="25" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <circle cx="170" cy="110" r="1.5" fill="var(--border-color)" />
            <rect x="8" y="58" width="52" height="104" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <rect x="8" y="78" width="20" height="64" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <rect x="280" y="58" width="52" height="104" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <rect x="312" y="78" width="20" height="64" fill="none" stroke="var(--border-color)" strokeWidth="1" />

            {focused.map((shot, index) => {
              const cx = 8 + clamp01(shot.x) * 324
              const cy = 8 + clamp01(shot.y) * 204
              const xg = typeof shot.expectedGoals === 'number' && Number.isFinite(shot.expectedGoals)
                ? Math.min(1, Math.max(0, shot.expectedGoals))
                : null
              // Dot radius scales with xG; shots without xG get the base size.
              const r = 4 + (xg ?? 0.06) * 9
              const label = [
                shot.player,
                shot.minute != null ? `${shot.minute}'` : null,
                xg != null ? `xG ${xg.toFixed(2)}` : null,
                shot.isGoal ? 'Goal' : 'Shot',
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <motion.g
                  key={`${focusTeam}-${index}-${shot.x}-${shot.y}`}
                  initial={reduce ? false : { opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.25, delay: reduce ? 0 : Math.min(index * 0.02, 0.4) }}
                  style={{ transformOrigin: `${cx}px ${cy}px` }}
                >
                  <title>{label}</title>
                  {shot.isGoal ? (
                    <>
                      <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke={teamColor} strokeWidth="1.5" opacity="0.55" />
                      <circle cx={cx} cy={cy} r={r} fill={teamColor} />
                      <circle cx={cx} cy={cy} r={Math.max(1.2, r * 0.3)} fill="var(--card-bg)" />
                    </>
                  ) : (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={teamColor}
                      fillOpacity="0.18"
                      stroke={teamColor}
                      strokeWidth="1.4"
                    />
                  )}
                </motion.g>
              )
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: teamColor }} />
            Goal
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full border"
              style={{ borderColor: teamColor, background: 'transparent' }}
            />
            Shot
          </span>
          <span>Dot size = chance quality (xG)</span>
        </div>

        {/* Per-team xG totals — only when the payload carried xG values. */}
        {xgTotals && (
          <div className="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: HOME_COLOR }} />
              <span className="truncate text-[var(--text-secondary)]">{homeTeam}</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {xgTotals.home.toFixed(2)}
              </span>
            </span>
            <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              Total xG
            </span>
            <span className="flex min-w-0 items-center justify-end gap-2">
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {xgTotals.away.toFixed(2)}
              </span>
              <span className="truncate text-[var(--text-secondary)]">{awayTeam}</span>
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: AWAY_COLOR }} />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
