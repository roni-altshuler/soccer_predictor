'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { MatchDetail } from '@/components/fixture/MatchDetail'
import { TeamCrest } from '@/components/primitives/TeamCrest'
import { splitScore } from '@/components/tournament/bracketLayout'
import type { MatchCard } from '@/lib/server/tieFixtures'
import { cn } from '@/lib/utils'

/**
 * One knockout tie, opened from the bracket.
 *
 * The bracket answers *who plays whom*; this answers *what happened*, and the
 * two halves of it come from different places on purpose:
 *
 *   ours    who played, in which round, and what the model gave the side it
 *           expected to advance. A file on disk, so it is always here.
 *   ESPN's  the timeline, the commentary, both team sheets in their real
 *           shapes, the match statistics, the head-to-head record and each
 *           side's recent form. Live, and reached by joining our tie to their
 *           fixture — measured at 99.2% across 520 ties.
 *
 * When that join fails the page still has the tie and says the match detail is
 * missing, because the alternative — showing whichever fixture was nearest —
 * is a page confidently about the wrong match.
 */

interface Tie {
  team_a: string
  team_b: string
  team_a_id: number
  team_b_id: number
  score: string | null
  winner: string | null
  winner_id: number | null
  p_team_a: number | null
  kickoff: string
  two_legged: boolean
  pending: boolean
}

interface Payload {
  available: boolean
  competition?: { id: string; name: string }
  season?: number
  round?: { slug: string; display: string; label: string }
  tie?: Tie
  legs?: MatchCard[]
  resolution?: { how: string; events: string[] } | null
  reason?: string | null
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** How the tie was settled, in the words the result actually supports. */
function settledBy(tie: Tie): string | null {
  if (tie.pending || !tie.winner) return null
  const parts = splitScore(tie.score)
  if (parts?.[2]) return `Settled on ${parts[2]}`
  if (tie.two_legged) return 'Settled over two legs'
  return null
}

export default function TiePage() {
  const params = useParams<{ key: string[] }>()
  const key = params?.key ?? []
  const [competition, season, round, pair] = key
  const [a, b] = (pair ?? '').split('v')

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!competition || !season || !round || !a || !b) {
      setLoading(false)
      return
    }
    let live = true
    const q = new URLSearchParams({ competition, season, round, a, b })
    fetch(`/api/v1/tournaments/tie?${q}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: Payload) => {
        if (!live) return
        setData(d)
        setLoading(false)
      })
      .catch(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [competition, season, round, a, b])

  const tie = data?.tie
  const legs = data?.legs ?? []
  const back = competition ? `/tournaments?competition=${competition}` : '/tournaments'

  /**
   * A one-legged tie IS its match, so the card below already carries the two
   * clubs, the score and how it finished. Drawing our own header above it
   * printed the same three things again — and the league fixture page, using
   * the same card, printed them once. Two legs still need the header, because
   * the aggregate is a fact about the TIE that neither leg shows; so does a
   * tie whose match detail never resolved, where the header is all there is.
   */
  const singleLeg = legs.length === 1

  const eliminated =
    tie && tie.winner_id !== null
      ? tie.winner_id === tie.team_a_id
        ? tie.team_b
        : tie.winner_id === tie.team_b_id
          ? tie.team_a
          : null
      : null

  /** The advance probability, in the panel slot the league page uses. */
  const modelPanel =
    tie && tie.p_team_a !== null ? (
      <>
        <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          What the model expected
        </h2>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <span className="truncate text-[12.5px] text-[var(--text-secondary)]">{tie.team_a}</span>
          <span className="truncate text-right text-[12.5px] text-[var(--text-secondary)]">
            {tie.team_b}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="mt-1.5 flex h-[6px] w-full overflow-hidden rounded-full bg-[var(--border-color)]"
        >
          <span
            className="block h-full bg-[var(--accent-primary)]"
            style={{ width: `${tie.p_team_a * 100}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-3 font-mono text-[13px] tabular-nums">
          <span className="text-[var(--text-primary)]">{(tie.p_team_a * 100).toFixed(0)}%</span>
          <span className="text-[var(--text-primary)]">
            {((1 - tie.p_team_a) * 100).toFixed(0)}%
          </span>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
          The chance each side advances. A tie has two outcomes, so the floor here is 50%
          rather than the 33% a league match starts from.
        </p>
      </>
    ) : null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <Link
        href={back}
        className="-ml-2 inline-flex min-h-[2.25rem] items-center gap-1 rounded-lg px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        The bracket
      </Link>

      {loading ? (
        <div
          className="mt-6 h-64 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
          role="status"
          aria-label="Loading tie"
        />
      ) : !tie ? (
        <div className="mt-6">
          <EmptyState
            title="No such tie"
            description={
              data?.reason ??
              'This link does not name a tie in any edition the forecast holds.'
            }
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {singleLeg ? null : (
          <header>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              {[data?.competition?.name, data?.round?.display, data?.season]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {/* The aggregate, placed by column so the score cannot drift into
                the away side's cell. It is the TIE, which is a different thing
                from either leg — so it is drawn even when one match card below
                repeats the same two clubs. */}
            <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              {[
                { name: tie.team_a, id: tie.team_a_id },
                { name: tie.team_b, id: tie.team_b_id },
              ].map((side, i) => {
                const settled =
                  tie.winner_id !== null &&
                  (tie.winner_id === tie.team_a_id || tie.winner_id === tie.team_b_id)
                const out = settled && tie.winner_id !== side.id
                return (
                  <div
                    key={side.id}
                    data-club={side.name}
                    data-out={out ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 items-center gap-2.5',
                      i === 0
                        ? 'col-start-1 row-start-1'
                        : 'col-start-3 row-start-1 flex-row-reverse text-right',
                    )}
                  >
                    <TeamCrest
                      team={side.name}
                      competitionId={data?.competition?.id}
                      size="lg"
                      className={out ? 'opacity-40' : undefined}
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[17px] font-semibold md:text-[20px]',
                        out
                          ? 'text-[var(--text-tertiary)] line-through decoration-1'
                          : 'text-[var(--text-primary)]',
                      )}
                    >
                      {side.name}
                    </span>
                  </div>
                )
              })}
              <span className="col-start-2 row-start-1 font-mono text-[22px] tabular-nums text-[var(--text-primary)] md:text-[26px]">
                {splitScore(tie.score)
                  ? `${splitScore(tie.score)![0]} - ${splitScore(tie.score)![1]}`
                  : tie.score || '–'}
              </span>
            </div>

            <p className="mt-2.5 font-mono text-[11px] text-[var(--text-tertiary)]">
              {[
                tie.pending ? `Kicks off ${fmtDate(tie.kickoff)}` : fmtDate(tie.kickoff),
                tie.two_legged ? 'two legs' : null,
                settledBy(tie),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </header>
          )}

          {/* Two legs: the aggregate lives in the header above, so the panel
              belongs there too rather than being repeated on each leg. */}
          {!singleLeg && modelPanel ? (
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
              {modelPanel}
            </section>
          ) : null}

          {legs.map((leg, i) => (
            <MatchDetail
              key={leg.eventId}
              card={leg}
              competitionId={data?.competition?.id}
              // Single leg: the card is the whole page, so it names the
              // competition exactly as a league fixture's card does. Two legs
              // need telling apart instead.
              heading={
                singleLeg
                  ? [data?.competition?.name, data?.round?.display, data?.season, settledBy(tie)]
                      .filter(Boolean)
                      .join(' · ')
                  : `Leg ${i + 1} of ${legs.length}`
              }
              model={singleLeg ? modelPanel : null}
              eliminated={singleLeg ? eliminated : null}
            />
          ))}

          {!legs.length ? (
            <section className="rounded-xl border border-dashed border-[var(--border-color)] px-4 py-4 md:px-5 md:py-5">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                Match detail
              </h2>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                {data?.reason ??
                  'No match detail is available for this tie.'}{' '}
                The tie above is from our own record and is unaffected.
              </p>
            </section>
          ) : null}

        </div>
      )}
    </div>
  )
}
