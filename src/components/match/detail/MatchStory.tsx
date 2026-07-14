'use client'

import { useEffect, useState } from 'react'

import { useReducedMotion } from 'framer-motion'

import { SectionHeader } from '@/components/primitives'
import { cn } from '@/lib/utils'

import { buildMatchStory, type MatchStory as MatchStoryData, type StoryBeat } from './story'
import type { MatchDetails } from './types'

/**
 * MatchStory — the Phase 0 story page (docs/VISION_2030.md §3.3, §11).
 *
 * Renders a finished match as acts and beats built by `story.ts`: every rate
 * is an exact historical count from `/api/v1/rarity`, every act header a
 * template over countable facts. Answers "how did it unfold" — a different
 * job from RarityStamp's "how rare was the final situation" further down the
 * page, and a structurally different sentence (a Δ across a goal vs a single
 * state's count), so the two never restate each other's claim.
 *
 * Honest empty behaviour: when the builder returns coverage 'none' (events
 * don't reconcile, no receipts in the artifact — e.g. women's keys before
 * their backfill lands) this renders NOTHING and the page keeps today's
 * layout exactly.
 */

/** Anchor on the Events card — beat rows scroll the timeline into view. */
export const MATCH_EVENTS_ANCHOR_ID = 'match-events'

/**
 * Honest percentage label: never "100" unless w === n, never "0" unless
 * w === 0 — one decimal at the extremes instead of a rounded lie.
 */
function pctLabel(w: number, n: number): string {
  if (n <= 0) return '0'
  const p = (w / n) * 100
  if (p > 0 && p < 1) return p.toFixed(1)
  if (p > 99 && p < 100) return p.toFixed(1)
  return String(Math.round(p))
}

function BeatRow({
  beat,
  isTurningPoint,
  onJump,
}: {
  beat: StoryBeat
  isTurningPoint: boolean
  onJump: () => void
}) {
  const minuteLabel = `${beat.minute}${beat.addedTime ? `+${beat.addedTime}` : ''}'`
  const marker = beat.type === 'own_goal' ? ' (og)' : beat.type === 'penalty_goal' ? ' (pen)' : ''
  const direction =
    beat.deltaWinRate === undefined ? '' : beat.deltaWinRate > 0 ? 'up' : beat.deltaWinRate < 0 ? 'down' : 'unchanged'

  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`View the ${minuteLabel} event in the timeline`}
      className={cn(
        'flex w-full min-h-[44px] items-center gap-3 px-2 py-1.5 text-left rounded-lg transition-colors hover:bg-[var(--muted-bg)]',
        isTurningPoint && 'rounded-l-none border-l-2 border-[var(--accent-primary)]'
      )}
    >
      <span className="w-12 shrink-0 rounded bg-[var(--muted-bg)] px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
        {minuteLabel}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-[var(--text-secondary)]">
        {isTurningPoint && (
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-primary)]">
            Turning point
          </span>
        )}
        <span className="font-medium text-[var(--text-primary)]">
          {beat.player}
          {marker}
        </span>
        {beat.type === 'red_card' ? ' — red card, still ' : ' — '}
        <span className="font-semibold tabular-nums text-[var(--text-primary)]">
          {beat.scoreAfter.home}-{beat.scoreAfter.away}
        </span>
        {'.'}
        {beat.rates && (
          <>
            {' Historically, teams here win '}
            <span
              className="font-semibold tabular-nums text-[var(--text-primary)]"
              title={`${beat.rates.w_after.toLocaleString()} of ${beat.rates.n_after.toLocaleString()} matches won`}
            >
              {pctLabel(beat.rates.w_after, beat.rates.n_after)}%
            </span>
            {' of such matches (n='}
            <span className="tabular-nums">{beat.rates.n_after.toLocaleString()}</span>
            {`), ${direction} from `}
            <span
              className="font-semibold tabular-nums text-[var(--text-primary)]"
              title={`${beat.rates.w_before.toLocaleString()} of ${beat.rates.n_before.toLocaleString()} matches won`}
            >
              {pctLabel(beat.rates.w_before, beat.rates.n_before)}%
            </span>
            {'.'}
          </>
        )}
      </span>
    </button>
  )
}

export function MatchStory({ match, isFinished }: { match: MatchDetails; isFinished: boolean }) {
  const [story, setStory] = useState<MatchStoryData | null>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!isFinished) return
    let cancelled = false
    buildMatchStory(match)
      .then((built) => {
        if (!cancelled) setStory(built)
      })
      .catch(() => {
        /* honest empty: render nothing */
      })
    return () => {
      cancelled = true
    }
  }, [match, isFinished])

  if (!isFinished || !story || story.coverage === 'none') return null

  const scrollToEvents = () => {
    document.getElementById(MATCH_EVENTS_ANCHOR_ID)?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  return (
    <section
      aria-label="The story"
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
    >
      <div className="border-b border-[var(--border-color)] px-4 py-3">
        <SectionHeader
          title="The story"
          description={`Win rates count how often teams in ${match.home_team}'s position went on to win.`}
        />
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {story.acts.map((act, actIndex) => (
          <div key={`${actIndex}-${act.header}`} className="px-4 py-3">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{act.header}</p>
            {act.beats.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {act.beats.map((beat, beatIndex) => (
                  <BeatRow
                    key={`${beat.minute}-${beat.addedTime ?? 0}-${beat.player}-${beat.type}`}
                    beat={beat}
                    isTurningPoint={
                      story.turningPoint?.actIndex === actIndex && story.turningPoint?.beatIndex === beatIndex
                    }
                    onJump={scrollToEvents}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
