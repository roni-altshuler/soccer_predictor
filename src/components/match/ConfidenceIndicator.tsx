'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, clamp, formatPct } from '@/lib/utils'

/**
 * Compact confidence chip — coloured dot + label + numeric value.
 * Used on match rows and the match-detail header so users see the
 * model's certainty at a glance.
 *
 * Thresholds match the rest of the app: 0.7+ high (green), 0.5+ medium
 * (cyan/ai), 0.4+ low-medium (amber), <0.4 low (red).
 */

export interface ConfidenceIndicatorProps {
  /** 0..1 model confidence. */
  value: number
  /** Optional pick label, e.g. "Home win" or "Draw". */
  pick?: string
  size?: 'sm' | 'md'
  className?: string
}

type Tier = { dot: string; chip: string; label: string }

const tiers = (v: number): Tier => {
  if (v >= 0.7) {
    return {
      dot: 'bg-emerald-400',
      chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      label: 'High',
    }
  }
  if (v >= 0.55) {
    return {
      dot: 'bg-[var(--accent-ai)]',
      chip: 'border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]',
      label: 'Solid',
    }
  }
  if (v >= 0.4) {
    return {
      dot: 'bg-amber-400',
      chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      label: 'Mixed',
    }
  }
  return {
    dot: 'bg-red-400',
    chip: 'border-red-500/40 bg-red-500/10 text-red-300',
    label: 'Low',
  }
}

export function ConfidenceIndicator({
  value,
  pick,
  size = 'sm',
  className,
}: ConfidenceIndicatorProps) {
  const v = clamp(value)
  const t = tiers(v)
  const dim = size === 'md' ? 'h-6 px-2.5 text-[11px]' : 'h-5 px-2 text-[10px]'

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border font-semibold tabular-nums',
              dim,
              t.chip,
              className
            )}
            aria-label={`Model confidence ${formatPct(v)}${pick ? `, leaning ${pick}` : ''}`}
          >
            <span className={cn('inline-block rounded-full', t.dot, size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5')} />
            <span className="uppercase tracking-wider">{t.label}</span>
            <span>{formatPct(v)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-0.5">
            <p className="font-semibold">Model confidence {formatPct(v)}</p>
            {pick && <p className="text-[10px] opacity-80">Leaning {pick}</p>}
            <p className="text-[10px] opacity-70">
              Higher = the model concentrates probability on one outcome.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
