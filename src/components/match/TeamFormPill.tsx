'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Five W/D/L circle pills for a team's recent form.
 * Most-recent result on the right (matches FotMob's convention).
 *
 * Accepts either a string of single chars ("WDLLW") or an array of objects
 * with optional opponent + score for richer tooltips.
 */
export type FormChar = 'W' | 'D' | 'L' | '-'

export interface FormEntry {
  result: FormChar
  opponent?: string
  score?: string
  date?: string
}

export interface TeamFormPillProps {
  form?: string | FormEntry[] | null
  size?: 'xs' | 'sm' | 'md'
  className?: string
  /** When provided, the tooltip identifies which team's form this is. */
  teamName?: string
}

const toneByResult: Record<FormChar, string> = {
  W: 'border-[var(--accent-primary)]/60 bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]',
  D: 'border-[var(--accent-warn)]/60 bg-[var(--accent-warn)]/15 text-[var(--accent-warn)]',
  L: 'border-[var(--accent-loss)]/60 bg-[var(--accent-loss)]/15 text-[var(--accent-loss)]',
  '-': 'border-[var(--border-color)] bg-[var(--surface-muted)]/40 text-[var(--text-tertiary)]',
}

const sizeMap = {
  xs: 'h-3.5 w-3.5 text-[8px]',
  sm: 'h-4 w-4 text-[9px]',
  md: 'h-5 w-5 text-[10px]',
} as const

function normalise(input: string | FormEntry[] | null | undefined): FormEntry[] {
  if (!input) return []
  if (typeof input === 'string') {
    return input
      .toUpperCase()
      .replace(/[^WDL\-]/g, '')
      .slice(0, 5)
      .split('')
      .map((c) => ({ result: (c as FormChar) === '-' ? '-' : (c as FormChar) }))
  }
  return input.slice(0, 5)
}

export function TeamFormPill({
  form,
  size = 'sm',
  className,
  teamName,
}: TeamFormPillProps) {
  const entries = normalise(form)
  if (entries.length === 0) return null
  const dim = sizeMap[size]

  return (
    <TooltipProvider delayDuration={150}>
      <div
        role="group"
        aria-label={teamName ? `${teamName} recent form` : 'Recent form'}
        className={cn('inline-flex items-center gap-0.5', className)}
      >
        {entries.map((entry, idx) => {
          const tone = toneByResult[entry.result]
          const tooltip = [
            entry.opponent ? `${entry.result === 'W' ? 'Won' : entry.result === 'D' ? 'Drew' : 'Lost'} vs ${entry.opponent}` : entry.result === '-' ? 'No data' : entry.result,
            entry.score,
            entry.date,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <Tooltip key={idx}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'inline-flex items-center justify-center rounded-full border font-bold',
                    dim,
                    tone
                  )}
                >
                  {entry.result}
                </span>
              </TooltipTrigger>
              {tooltip && <TooltipContent>{tooltip}</TooltipContent>}
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
