import { cn } from '@/lib/utils'

interface ProbBarProps {
  /** Home-win probability, 0..1. */
  home: number
  /** Draw probability, 0..1. */
  draw: number
  /** Away-win probability, 0..1. */
  away: number
  /** Show the H/D/A percentage labels below the bar. */
  showLabels?: boolean
  /** Bar thickness: sm (h-1.5) or md (h-2). */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * ProbBar — the signature stacked win/draw/loss probability bar. Renders a
 * single rounded bar split into home (green), draw (amber), away (red)
 * segments, each with a 2% minimum width so no outcome vanishes. Probabilities
 * are renormalised defensively so they always sum to 100%.
 */
export function ProbBar({
  home,
  draw,
  away,
  showLabels = false,
  size = 'md',
  className,
}: ProbBarProps) {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)
  const h = safe(home)
  const d = safe(draw)
  const a = safe(away)
  const total = h + d + a
  const [hp, dp, ap] =
    total > 0 ? [h / total, d / total, a / total] : [1 / 3, 1 / 3, 1 / 3]

  const pct = (v: number) => Math.round(v * 100)
  const hPct = pct(hp)
  const dPct = pct(dp)
  const aPct = pct(ap)

  const segments = [
    { key: 'home', value: hp, color: 'var(--accent-primary)' },
    { key: 'draw', value: dp, color: 'var(--accent-warn)' },
    { key: 'away', value: ap, color: 'var(--accent-loss)' },
  ]

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn(
          'flex w-full overflow-hidden rounded-full',
          size === 'sm' ? 'h-1.5' : 'h-2'
        )}
        role="img"
        aria-label={`Win probability: home ${hPct}%, draw ${dPct}%, away ${aPct}%`}
      >
        {segments.map((seg) => (
          <span
            key={seg.key}
            className="prob-segment h-full"
            style={{
              width: `${seg.value * 100}%`,
              minWidth: '2%',
              backgroundColor: seg.color,
            }}
          />
        ))}
      </div>
      {showLabels && (
        <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold tabular-nums">
          <span style={{ color: 'var(--accent-primary)' }}>H {hPct}%</span>
          <span className="text-[var(--text-tertiary)]">·</span>
          <span style={{ color: 'var(--accent-warn)' }}>D {dPct}%</span>
          <span className="text-[var(--text-tertiary)]">·</span>
          <span style={{ color: 'var(--accent-loss)' }}>A {aPct}%</span>
        </div>
      )}
    </div>
  )
}
