import Link from 'next/link'

export function EvidenceNavigation({ current }: { current: 'accuracy' | 'evaluation' }) {
  return <nav aria-label="Explore model evidence" className="mb-5 grid gap-2 sm:grid-cols-2">
    {([
      ['accuracy', '/accuracy', 'Prediction accuracy', 'Overall record, leagues and saved picks'],
      ['evaluation', '/evaluation', 'Historical evaluation', 'Backtests, baselines and separate older aggregates'],
    ] as const).map(([id, href, title, description]) => <Link key={id} href={href} aria-current={current === id ? 'page' : undefined}
      className="min-h-11 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3 text-sm text-[var(--text-primary)] hover:bg-[var(--card-hover)]">
      <span className="block font-semibold">{title}</span><span className="mt-1 block text-xs text-[var(--text-secondary)]">{description}</span>
    </Link>)}
  </nav>
}
