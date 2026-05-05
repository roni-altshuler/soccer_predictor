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
    shell: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  fotmob: {
    shell: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  guardian: {
    shell: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  uefa: {
    shell: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
  },
  model: {
    shell: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    dot: 'bg-cyan-500',
  },
  internal: {
    shell: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  none: {
    shell: 'border-slate-400/25 bg-slate-400/10 text-slate-600 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  error: {
    shell: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
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
