import { getLeagueAccent } from '@/lib/leagueAccents'
import { recordSummary, type PublishedPick } from '@/lib/publishedTrackRecord'

export function LeagueRecordExplorer({ rows, leagues, selected, onSelect }: {
  rows: PublishedPick[]; leagues: string[]; selected: string; onSelect: (id: string) => void
}) {
  const options = [{ id: '', name: 'All leagues', rows }, ...leagues.map(id => ({
    id, name: getLeagueAccent(id).displayName, rows: rows.filter(r => r.competitionId === id),
  }))]
  return <section aria-label="Explore league accuracy">
    <h2 className="text-sm font-semibold">Explore leagues</h2>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">Compare the same eligible outcome record. Season and date filters apply to every league.</p>
    <div role="group" aria-label="Choose accuracy league" className="mt-3 flex gap-2 overflow-x-auto pb-2">
      {options.map(option => {
        const summary = recordSummary(option.rows)
        return <button key={option.id} type="button" aria-pressed={selected === option.id} onClick={() => onSelect(option.id)}
          className="min-h-11 shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 text-left text-sm text-[var(--text-primary)] aria-pressed:bg-[var(--card-hover)]">
          <span className="block font-semibold">{option.name}</span>
          <span className="mt-1 block text-xs text-[var(--text-secondary)]">{summary.correct} correct / {summary.settled} eligible · {summary.unverified} unverified</span>
        </button>
      })}
    </div>
  </section>
}
