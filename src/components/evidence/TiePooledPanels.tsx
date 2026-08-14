'use client'

import { MetricRow, Panel, StatTile } from '@/components/evidence/primitives'
import { cn } from '@/lib/utils'

/**
 * The knockout layer's pooled record.
 *
 * These three panels used to sit on `/tournaments`, under the brackets, where
 * a reader who came to see who plays Real Madrid had to scroll past a
 * calibration table to reach the next round. They are model evidence, so they
 * belong on the evidence page — and they are POOLED evidence, measured across
 * all fourteen competitions at once, so they sit below the per-competition
 * panels with that stated rather than being silently attributed to whichever
 * tournament is selected.
 */

export interface CalibrationBand {
  stated_low: number
  stated_high: number
  n: number
  observed: number
  mean_stated: number
}

export interface RoundRow {
  correct: number
  n: number
  accuracy: number
}

const ROUND_LABELS: Record<string, string> = {
  final: 'Final',
  semifinals: 'Semi-finals',
  quarterfinals: 'Quarter-finals',
  'round-of-16': 'Round of 16',
  'round-of-32': 'Round of 32',
}

/**
 * What the confidence means, as paired bars per band.
 *
 * The table this replaces asked a reader to compare two columns of numbers to
 * see calibration, which is the one thing calibration is bad at communicating
 * in that form. A calibrated band is two bars the same length.
 */
export function TieCalibrationPanel({ bands }: { bands: CalibrationBand[] }) {
  if (!bands.length) return null

  return (
    <Panel
      title="What the confidence means"
      description="A calibrated band has its two bars the same length. This is the number a bracket simulation consumes."
    >
      <ul className="mt-4 space-y-3.5">
        {bands.map((b) => (
          <li key={b.stated_low}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                {b.stated_low}–{b.stated_high}%
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {b.n.toLocaleString()} ties
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              <PairedBar label="Said" value={b.mean_stated} tone="muted" />
              <PairedBar label="Happened" value={b.observed} tone="accent" />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function PairedBar({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'muted' | 'accent'
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-x-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'accent' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-tertiary)]',
          )}
          style={{ width: `${Math.max(2, Math.min(1, value) * 100)}%` }}
        />
      </div>
      <span className="text-right font-mono text-[11px] tabular-nums text-[var(--text-primary)]">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}

/** Where the model is strong, and where it is not. */
export function TieRoundsPanel({ rounds }: { rounds: Record<string, RoundRow> }) {
  const entries = Object.entries(rounds)
    .filter(([key]) => key in ROUND_LABELS)
    .sort((a, b) => b[1].n - a[1].n)
  if (!entries.length) return null

  return (
    <Panel
      title="Where it is strong, and where it is not"
      description="By round, across every competition. Bars start at the coin flip, so an empty bar has added nothing."
    >
      <ul className="mt-4 space-y-2.5">
        {entries.map(([key, row]) => (
          <li key={key}>
            <MetricRow
              label={ROUND_LABELS[key]}
              value={`${(row.accuracy * 100).toFixed(1)}%`}
              // Scaled from 50%, because 50% is where this question starts.
              fraction={(row.accuracy - 0.5) * 2}
              note={`${row.n} ties`}
              tone={row.accuracy >= 0.6 ? 'accent' : 'muted'}
            />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        Semi-finals are hardest: four teams that all deserve to be there, so the rating gap
        has mostly closed.
      </p>
    </Panel>
  )
}

export interface ImportanceRow {
  feature: string
  importance: number
  std: number
}

const FEATURE_LABELS: Record<string, string> = {
  elo_diff: 'Rating gap between the two sides',
  elo_expected_a: 'What that gap implies on its own',
  elo_a: 'Rating of the first side',
  elo_b: 'Rating of the second side',
  is_neutral: 'Played at a neutral venue',
  two_legs: 'Two legs rather than one',
  round_depth: 'How deep in the bracket the tie is',
  pedigree_a: 'Ties won here in the last five seasons',
  pedigree_b: 'The same, for the other side',
  pedigree_diff: 'The gap between those two',
}

const featureLabel = (f: string) => FEATURE_LABELS[f] ?? f.replace(/_/g, ' ')

/**
 * What it leaned on.
 *
 * Permutation importance: shuffle one feature, measure how much worse the
 * model gets. Shown top-down and only where positive — a feature whose shuffle
 * makes the model *better* is noise, and printing it with a negative bar
 * invites reading it as a signal in the other direction.
 */
export function TieFeaturesPanel({ rows }: { rows: ImportanceRow[] }) {
  const top = rows.filter((r) => r.importance > 0).slice(0, 6)
  if (!top.length) return null
  const worst = Math.max(...top.map((r) => r.importance), 1e-9)

  return (
    <Panel
      title="What it leaned on"
      description="Each feature shuffled in turn, and the damage measured. No damage means it was carrying nothing."
    >
      <ul className="mt-4 space-y-2.5">
        {top.map((r) => (
          <li key={r.feature}>
            <MetricRow
              label={featureLabel(r.feature)}
              value={r.importance.toFixed(4)}
              fraction={r.importance / worst}
              note={`± ${r.std.toFixed(4)}`}
            />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** The integrity gate, as a stat rather than a sentence buried in a footer. */
export function ProgressionPanel({
  checked,
  confirmed,
  rate,
}: {
  checked: number
  confirmed: number
  rate: number
}) {
  return (
    <Panel
      title="Does the data say what we think it says"
      description="The team recorded as advancing has to turn up in the next round. A wrong branch trains the model on the losing side and is otherwise invisible."
    >
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Confirmed" value={`${(rate * 100).toFixed(1)}%`} size="lead" />
        <StatTile label="Ties checked" value={checked.toLocaleString()} />
        <StatTile label="Of which confirmed" value={confirmed.toLocaleString()} />
      </dl>
    </Panel>
  )
}
