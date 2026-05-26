import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'

import { TeamBadge } from '@/components/primitives/TeamBadge'
import { cn } from '@/lib/utils'

interface TeamCardProps {
  teamId?: number | string
  name: string
  /** Optional secondary line (league, country, record). */
  subtitle?: string
  /** Recent-form glyph stream e.g. "WWDLW". Each char rendered as a small pill. */
  form?: string
  teamColor?: string
  href?: string
  /** Trailing icon (e.g. star, bookmark). */
  TrailingIcon?: LucideIcon
  className?: string
}

const FORM_COLORS: Record<string, string> = {
  W: 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)]',
  D: 'bg-[var(--text-tertiary)]/30 text-[var(--text-primary)]',
  L: 'bg-[var(--accent-loss)] text-white',
}

export function TeamCard({
  teamId,
  name,
  subtitle,
  form,
  teamColor,
  href,
  TrailingIcon,
  className,
}: TeamCardProps) {
  const inner = (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 transition-colors hover:border-[var(--border-color-hover)]',
        className
      )}
      style={teamColor ? { borderLeftColor: teamColor, borderLeftWidth: 3 } : undefined}
    >
      <TeamBadge teamId={teamId} name={name} size={36} teamColor={teamColor} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-h4 text-[var(--text-primary)]">{name}</p>
        {subtitle ? (
          <p className="truncate text-caption text-[var(--text-tertiary)]">{subtitle}</p>
        ) : null}
      </div>
      {form ? (
        <ul className="hidden sm:flex items-center gap-1" aria-label={`Recent form: ${form}`}>
          {form
            .slice(-5)
            .split('')
            .map((c, i) => {
              const cls = FORM_COLORS[c.toUpperCase()] ?? 'bg-[var(--muted-bg)] text-[var(--text-tertiary)]'
              return (
                <li
                  key={i}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-md font-mono text-[10px] font-bold uppercase',
                    cls
                  )}
                >
                  {c}
                </li>
              )
            })}
        </ul>
      ) : null}
      {TrailingIcon ? (
        <TrailingIcon className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden />
      ) : href ? (
        <ChevronRight
          className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      ) : null}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
