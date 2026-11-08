import Link from 'next/link'
import type { CompletedRegularSeason as CompletedSeason } from '@/lib/completedRegularSeason'

const utc = (stamp: string) => new Date(stamp).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
const link = 'inline-flex min-h-[44px] items-center rounded-lg px-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-info)]'

/** Observed standings have conference positions, never a combined final rank. */
export function CompletedRegularSeason({ season }: { season: CompletedSeason }) {
  const observation = season.observation
  return (
    <div className="space-y-5">
      <section aria-label="Regular season completed" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-primary)]">Observed results · {season.season}</p>
        <h2 className="mt-2 text-xl font-bold text-[var(--text-primary)]">Regular season completed</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">All 510 regular-season matches reconciled. Each club played 34 games; no regular-season fixtures remain.</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">MLS Cup playoffs are separate from these regular-season standings. This table does not establish an MLS Cup winner.</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm text-[var(--text-secondary)]">
          <Link className={link} href="/evaluation">Archived forecast evaluation</Link>
          <Link className={link} href="/accuracy">Recorded prediction history</Link>
        </div>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">Past model calls remain archived separately from this observed record.</p>
      </section>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        {season.groups.map((group) => (
          <section key={group.name} aria-label={group.name} className="min-w-0 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            <h2 className="p-4 text-base font-semibold text-[var(--text-primary)]">{group.name}</h2>
            <div className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-info)]" role="region" aria-label={`${group.name} standings`} tabIndex={0}>
              <table className="w-full text-sm tabular-nums">
                <caption className="sr-only">{season.season} observed final regular-season {group.name} standings. Positions supplied by ESPN.</caption>
                <thead className="border-y border-[var(--border-color)] text-xs text-[var(--text-tertiary)]">
                  <tr>{['Pos', 'Club', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map((heading) => <th key={heading} scope="col" className={`whitespace-nowrap px-2 py-3 font-semibold ${heading === 'Club' ? 'text-left' : 'text-right'} ${['W', 'D', 'L', 'GD'].includes(heading) ? 'hidden sm:table-cell' : ''}`}>{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {season.clubs.filter((club) => club.group === group.name).sort((a, b) => a.position - b.position).map((club) => (
                    <tr key={club.team_id} className="border-b border-[var(--border-color)] text-[var(--text-secondary)] last:border-0">
                      <td className="px-2 py-3 text-right">{club.position}</td>
                      <th scope="row" className="min-w-36 px-2 py-3 text-left font-medium text-[var(--text-primary)]">{club.team}{club.qualified && <span className="ml-1 text-xs text-[var(--accent-primary)]" aria-label="Qualified for playoffs">Q</span>}</th>
                      {[club.played, club.wins, club.draws, club.losses, club.gd, club.points].map((value, index) => <td key={index} className={`px-2 py-3 text-right ${index === 5 ? 'font-bold text-[var(--text-primary)]' : ''} ${index > 0 && index < 5 ? 'hidden sm:table-cell' : ''}`}>{value}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="p-4 text-xs leading-relaxed text-[var(--text-tertiary)]">Q: Qualified for playoffs (top 9). Positions are within this conference.</p>
          </section>
        ))}
      </div>
      <section aria-label="Observed record provenance" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-sm text-[var(--text-secondary)]">
        <h2 className="font-semibold text-[var(--text-primary)]">Source and dates</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><dt>Results through</dt><dd className="mt-1 font-mono text-xs text-[var(--text-primary)]"><time dateTime={observation.results_through}>{observation.results_through}</time></dd></div>
          <div><dt>Standings observed (UTC)</dt><dd className="mt-1 break-words font-mono text-xs text-[var(--text-primary)]"><time dateTime={observation.observed_at}>{utc(observation.observed_at)}</time></dd></div>
          <div><dt>Artifact built (UTC)</dt><dd className="mt-1 break-words font-mono text-xs text-[var(--text-primary)]">{season.generatedAt ? <time dateTime={season.generatedAt}>{utc(season.generatedAt)}</time> : 'Unavailable'}</dd></div>
          <div><dt>Retained schedule verified (UTC)</dt><dd className="mt-1 break-words font-mono text-xs text-[var(--text-primary)]"><time dateTime={observation.schedule_last_verified_at}>{utc(observation.schedule_last_verified_at)}</time></dd></div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed">Standings observation, result cutoff, artifact build and schedule verification describe separate checks. The schedule refresh notice reports the latest refresh attempt.</p>
        <a href={observation.endpoint} className={`mt-2 ${link}`}>ESPN regular-season standings source</a>
      </section>
    </div>
  )
}
