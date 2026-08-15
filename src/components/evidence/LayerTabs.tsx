'use client'

import { cn } from '@/lib/utils'

/**
 * Leagues or tournaments — the one control both evidence pages open with.
 *
 * Shared rather than copied because the two pages are one section and the
 * control is the thing a reader learns once. It also enforces the rule that
 * matters more than the styling: a layer with no evidence is DISABLED, not
 * hidden and not clickable into an empty page. A tab that leads nowhere is a
 * worse answer than a tab that says it has nothing.
 *
 * **A disabled tab must never be a one-way door.** `/accuracy` reported its
 * league layer as empty while that layer was also the default, so the page
 * opened on a dead tab and the first click into Tournaments could not be
 * undone. The page bug is fixed at its source, but the guarantee belongs here
 * too: the layer you are currently on is never rendered as disabled, and if
 * every layer is empty the control disables nothing rather than trapping the
 * reader in whichever one it happened to open on.
 */

export type Layer = 'leagues' | 'tournaments'

export function LayerTabs({
  value,
  onChange,
  enabled,
  className,
}: {
  value: Layer
  onChange: (v: Layer) => void
  enabled: Record<Layer, boolean>
  className?: string
}) {
  const tabs: Array<{ key: Layer; label: string }> = [
    { key: 'leagues', label: 'Leagues' },
    { key: 'tournaments', label: 'Tournaments' },
  ]

  const nothingHasEvidence = !tabs.some((t) => enabled[t.key])
  /** Disabled only where it cannot strand the reader. */
  const isDisabled = (key: Layer) => !enabled[key] && value !== key && !nothingHasEvidence

  return (
    <div
      role="tablist"
      aria-label="Which layer to look at"
      className={cn(
        'inline-flex shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-0.5',
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          disabled={isDisabled(t.key)}
          onClick={() => onChange(t.key)}
          className={cn(
            'min-h-[36px] rounded-md px-3 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors',
            value === t.key
              ? 'bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            isDisabled(t.key) && 'cursor-not-allowed opacity-40',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** A labelled divider: everything below this measures more than one competition. */
export function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </h2>
      <span className="h-px flex-1 bg-[var(--border-color)]" aria-hidden="true" />
    </div>
  )
}
