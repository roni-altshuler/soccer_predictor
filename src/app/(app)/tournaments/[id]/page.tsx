'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft, Medal, Trophy } from 'lucide-react'

import KnockoutBracket, { type BracketRound } from '@/components/knockout/KnockoutBracket'
import { BorderBeam } from '@/components/magicui/border-beam'
import { Spotlight } from '@/components/magicui/spotlight'
import { TableSkeleton } from '@/components/skeletons/TableSkeleton'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { useTournament, type BracketMatch } from '@/hooks/useTournament'

const KNOWN_TOURNAMENTS: Record<string, 'champions_league' | 'europa_league' | 'world_cup' | 'conference_league' | 'euro' | 'copa_america'> = {
  'uefa.champions': 'champions_league',
  'uefa.europa': 'europa_league',
  'uefa.conference': 'conference_league',
  'fifa.world': 'world_cup',
  'uefa.euro': 'euro',
  'conmebol.america': 'copa_america',
}

function toBracketRounds(rounds?: { id: number; name: string; matches: BracketMatch[] }[]): BracketRound[] {
  if (!rounds) return []
  return rounds.map((r) => ({
    name: r.name,
    matches: r.matches.map((m) => ({
      id: String(m.id),
      homeTeam: m.home?.name ?? 'TBD',
      awayTeam: m.away?.name ?? 'TBD',
      homeScore: m.homeScore ?? undefined,
      awayScore: m.awayScore ?? undefined,
      round: r.name,
      status:
        m.status === 'live'
          ? 'live'
          : m.status === 'finished'
            ? 'finished'
            : 'scheduled',
      winner:
        typeof m.homeScore === 'number' && typeof m.awayScore === 'number'
          ? m.homeScore > m.awayScore
            ? 'home'
            : m.awayScore > m.homeScore
              ? 'away'
              : null
          : null,
    })),
  }))
}

export default function TournamentPage() {
  const routeParams = useParams<{ id: string }>()
  const id = routeParams?.id ?? ''
  const tournamentKey = KNOWN_TOURNAMENTS[id]

  const { data: tournament, isLoading } = useTournament(id || null)

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
      <Link
        href="/tournaments"
        className="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> All tournaments
      </Link>

      <Spotlight
        className="mt-3 block rounded-2xl"
        size={460}
        color="color-mix(in srgb, var(--accent-primary) 16%, transparent)"
      >
        <Card className="relative overflow-hidden p-6">
          <BorderBeam size={1} duration={11} borderRadius={16} />
          <div className="relative z-10 flex flex-col items-start gap-4 md:flex-row md:items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
              <Medal className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-caption font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                Tournament
              </p>
              <h1 className="mt-1 text-display font-extrabold tracking-tight text-[var(--text-primary)]">
                {tournament?.name ?? (isLoading ? 'Loading…' : id || 'Tournament')}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-small text-[var(--text-secondary)]">
                {tournament?.season ? <span>{tournament.season}</span> : null}
                {tournament?.stage ? (
                  <span className="rounded-md bg-[var(--muted-bg)] px-2 py-0.5 font-mono uppercase tracking-[0.1em]">
                    {tournament.stage}
                  </span>
                ) : null}
                {tournament?.gender ? (
                  <span className="text-caption uppercase tracking-[0.16em]">
                    {tournament.gender === 'F' ? "Women's" : "Men's"}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      </Spotlight>

      {/* Bracket / Groups */}
      <div className="mt-6">
        {isLoading ? (
          <TableSkeleton rows={8} columns={4} />
        ) : tournamentKey ? (
          <Card className="overflow-x-auto p-4">
            <KnockoutBracket
              tournament={tournamentKey}
              rounds={toBracketRounds(tournament?.rounds)}
              showProbabilities
            />
          </Card>
        ) : tournament?.groups && tournament.groups.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {tournament.groups.map((group) => (
              <Card key={group.id} className="overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[var(--border-color)] bg-[var(--muted-bg)] px-4 py-2">
                  <Trophy className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                  <span className="text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                    Group {group.name}
                  </span>
                </div>
                <table className="w-full text-small">
                  <thead>
                    <tr className="text-left text-caption uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Team</th>
                      <th className="px-3 py-2 text-right">P</th>
                      <th className="px-3 py-2 text-right">W</th>
                      <th className="px-3 py-2 text-right">D</th>
                      <th className="px-3 py-2 text-right">L</th>
                      <th className="px-3 py-2 text-right">GD</th>
                      <th className="px-3 py-2 text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.teams.map((t, i) => (
                      <tr key={t.teamId} className="border-t border-[var(--border-color)]">
                        <td className="px-3 py-2 font-mono text-[var(--text-tertiary)]">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{t.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.played}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.won}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.drawn}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.lost}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.goalsFor - t.goalsAgainst}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-[var(--accent-primary)]">
                          {t.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            illustration="no-matches"
            title="Bracket not available yet"
            description="The tournament endpoint will populate this section once the backend route lands."
          />
        )}
      </div>
    </div>
  )
}
