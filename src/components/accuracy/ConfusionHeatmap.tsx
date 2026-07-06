'use client'

import { motion, useReducedMotion } from 'framer-motion'

import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { cn, formatPct } from '@/lib/utils'

/**
 * Visual 3×3 confusion matrix — rows = actual outcome, columns =
 * predicted outcome. Cells are tinted by recall (correct picks
 * concentrate on the diagonal) so users can see at a glance which
 * outcomes the model handles well and which it struggles with.
 *
 * Each cell renders the raw count and the row-normalised percentage.
 */

export type OutcomeKey = 'home' | 'draw' | 'away'

export interface ConfusionRow {
  actual: OutcomeKey
  predicted: Record<OutcomeKey, number>
}

interface ConfusionHeatmapProps {
  rows: ConfusionRow[]
  className?: string
}

const labels: Record<OutcomeKey, string> = {
  home: 'Home win',
  draw: 'Draw',
  away: 'Away win',
}

export function ConfusionHeatmap({ rows, className }: ConfusionHeatmapProps) {
  const totalCells = rows.reduce(
    (acc, row) => acc + row.predicted.home + row.predicted.draw + row.predicted.away,
    0
  )

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <SectionHeader
        kicker="Outcome audit"
        title="Picks vs results"
        className="mb-3"
        action={
          <p className="text-[10px] text-[var(--text-tertiary)]">
            Rows = actual result · columns = AI pick
          </p>
        }
      />

      {totalCells === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] text-sm text-[var(--text-tertiary)]">
          No settled predictions yet.
        </div>
      ) : (
        <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-1.5">
          {/* Column headers */}
          <div />
          {(['home', 'draw', 'away'] as OutcomeKey[]).map((col) => (
            <div
              key={`col-${col}`}
              className="text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
            >
              {labels[col]}
            </div>
          ))}

          {/* Rows */}
          {rows.map((row, rowIdx) => {
            const rowTotal = row.predicted.home + row.predicted.draw + row.predicted.away
            return (
              <RowGroup
                key={`row-${row.actual}`}
                row={row}
                rowTotal={rowTotal}
                idx={rowIdx}
              />
            )
          })}
        </div>
      )}
    </Card>
  )
}

function RowGroup({ row, rowTotal, idx }: { row: ConfusionRow; rowTotal: number; idx: number }) {
  const reduce = useReducedMotion()
  const cells: { key: OutcomeKey; count: number; share: number; correct: boolean }[] = (
    ['home', 'draw', 'away'] as OutcomeKey[]
  ).map((col) => ({
    key: col,
    count: row.predicted[col],
    share: rowTotal === 0 ? 0 : row.predicted[col] / rowTotal,
    correct: col === row.actual,
  }))

  return (
    <>
      <div
        className="flex items-center justify-end pr-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
      >
        {labels[row.actual]}
      </div>
      {cells.map((cell) => {
        const alpha = Math.max(0.08, cell.share)
        const token = cell.correct ? 'var(--accent-primary)' : 'var(--accent-loss)'
        return (
          <motion.div
            key={`cell-${row.actual}-${cell.key}`}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center justify-center rounded-md border border-[var(--border-color)] px-2 py-3 text-center"
            style={{ background: `color-mix(in srgb, ${token} ${(alpha * 100).toFixed(1)}%, transparent)` }}
            title={`${row.actual} → ${cell.key}: ${cell.count} (${formatPct(cell.share)})`}
          >
            <p
              className={cn(
                'text-base font-black tabular-nums',
                cell.correct ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'
              )}
            >
              {cell.count}
            </p>
            <p className="text-[10px] text-[var(--text-tertiary)]">{formatPct(cell.share)}</p>
          </motion.div>
        )
      })}
    </>
  )
}
