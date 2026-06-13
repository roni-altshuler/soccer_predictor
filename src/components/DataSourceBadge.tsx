'use client'

export type DataProvider = 'espn' | 'fotmob' | 'guardian' | 'uefa' | 'model' | 'internal' | 'none' | 'error'

type DataSourceBadgeProps = {
  provider?: DataProvider | null
  detail?: string
  refreshedAt?: string
  compact?: boolean
  className?: string
}

const PROVIDER_LABEL: Record<DataProvider, string> = {
  espn: 'ESPN',
  fotmob: 'FotMob',
  guardian: 'Guardian',
  uefa: 'UEFA',
  model: 'Model',
  internal: 'Internal',
  none: 'No live source',
  error: 'Source issue',
}

const PROVIDER_STYLE: Record<DataProvider, { shell: string; dot: string }> = {
  espn: {
    shell: 'border-[color-mix(in_srgb,var(--accent-info)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-info)_10%,transparent)] text-[var(--accent-info)]',
    dot: 'bg-[var(--accent-info)]',
  },
  fotmob: {
    shell: 'border-[color-mix(in_srgb,var(--accent-primary)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]',
    dot: 'bg-[var(--accent-primary)]',
  },
  guardian: {
    shell: 'border-[color-mix(in_srgb,var(--accent-info)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-info)_10%,transparent)] text-[var(--accent-info)]',
    dot: 'bg-[var(--accent-info)]',
  },
  uefa: {
    shell: 'border-[color-mix(in_srgb,var(--accent-info)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-info)_10%,transparent)] text-[var(--accent-info)]',
    dot: 'bg-[var(--accent-info)]',
  },
  model: {
    shell: 'border-[color-mix(in_srgb,var(--accent-ai)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] text-[var(--accent-ai)]',
    dot: 'bg-[var(--accent-ai)]',
  },
  internal: {
    shell: 'border-[color-mix(in_srgb,var(--accent-market)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-market)_10%,transparent)] text-[var(--accent-market)]',
    dot: 'bg-[var(--accent-market)]',
  },
  none: {
    shell: 'border-[var(--border-color)] bg-[var(--muted-bg)] text-[var(--text-secondary)]',
    dot: 'bg-[var(--text-tertiary)]',
  },
  error: {
    shell: 'border-[color-mix(in_srgb,var(--accent-loss)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] text-[var(--accent-loss)]',
    dot: 'bg-[var(--accent-loss)]',
  },
}

function formatRefreshTime(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function DataSourceBadge({
  provider,
  detail,
  refreshedAt,
  compact = false,
  className = '',
}: DataSourceBadgeProps) {
  const resolvedProvider = provider || 'none'
  const style = PROVIDER_STYLE[resolvedProvider] || PROVIDER_STYLE.none
  const refreshed = formatRefreshTime(refreshedAt)
  const titleParts = [
    `Source: ${PROVIDER_LABEL[resolvedProvider]}`,
    detail,
    refreshed ? `Refreshed ${refreshed}` : undefined,
  ].filter(Boolean)

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${style.shell} ${className}`}
      title={titleParts.join(' | ')}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${style.dot}`} />
      <span className="truncate">{PROVIDER_LABEL[resolvedProvider]}</span>
      {!compact && detail && (
        <span className="hidden max-w-[220px] truncate normal-case tracking-normal opacity-80 sm:inline">
          {detail}
        </span>
      )}
      {refreshed && (
        <span className="hidden normal-case tracking-normal opacity-80 sm:inline">
          {compact ? refreshed : `Updated ${refreshed}`}
        </span>
      )}
    </span>
  )
}
