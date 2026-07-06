'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

import { FlagBadge, LiveBadge, TeamBadge } from '@/components/primitives'
import { cn } from '@/lib/utils'

interface StickyScoreBarProps {
  /** Ref to the hero element. When the hero scrolls out of view, the bar appears. */
  heroRef: React.RefObject<HTMLElement | null>
  homeName: string
  awayName: string
  /** National-team fixtures — set to the country name to render a real flag. */
  homeCountry?: string
  awayCountry?: string
  homeTeamId?: number | string
  awayTeamId?: number | string
  homeColor?: string
  awayColor?: string
  homeScore: number | null
  awayScore: number | null
  /** Match status — used to decide whether to wrap in BorderBeam (live only). */
  isLive?: boolean
  /** Live minute label ("67'" or 67) — shown next to the score when live. */
  liveMinute?: number | string | null
  /** Static fallback status text for scheduled/finished matches. */
  statusLabel?: string
  className?: string
}

/**
 * StickyScoreBar — FotMob-style condensed scoreline that appears below the
 * topbar when the user scrolls past the match scoreboard header. Flat v3
 * chrome: hairline border, no beams or glows; live state is the red minute.
 *
 * Stacking: parent topbar is z-50, this bar is z-40, the match tabs sit at z-30.
 */
export function StickyScoreBar({
  heroRef,
  homeName,
  awayName,
  homeCountry,
  awayCountry,
  homeTeamId,
  awayTeamId,
  homeColor,
  awayColor,
  homeScore,
  awayScore,
  isLive,
  liveMinute,
  statusLabel,
  className,
}: StickyScoreBarProps) {
  const [visible, setVisible] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const node = heroRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        // When the hero leaves the viewport (top edge above topbar), show.
        setVisible(entry.intersectionRatio < 0.1)
      },
      // rootMargin top = -shell-topbar-h (60) so the observer triggers after the bar would naturally sit
      { threshold: [0, 0.1, 0.5, 1], rootMargin: '-60px 0px 0px 0px' },
    )
    observer.observe(node)
    observerRef.current = observer
    return () => observer.disconnect()
  }, [heroRef])

  const score = homeScore != null && awayScore != null ? `${homeScore} – ${awayScore}` : '—'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduce ? false : { y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: -8, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            // NOTE: no 'relative' here — twMerge would let it override 'sticky'
            // (both are position utilities) and the bar would never stick.
            'sticky z-40 top-[var(--shell-topbar-h)] w-full',
            'border-b border-[var(--border-color)]',
            'bg-[var(--nav-bg)] backdrop-blur-xl',
            className,
          )}
          style={
            {
              '--team-tint-home': homeColor ?? 'var(--accent-primary)',
              '--team-tint-away': awayColor ?? 'var(--accent-loss)',
            } as React.CSSProperties
          }
          role="banner"
          aria-label={`${homeName} ${score} ${awayName}`}
        >
          {/* gap-2 + px-3 at ≤sm so long names + score never overflow 390px. */}
          <div className="mx-auto flex max-w-[var(--shell-content-max)] items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-4">
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">
              <span className="min-w-0 truncate text-meta font-semibold text-[var(--text-primary)] sm:text-body">{homeName}</span>
              {homeCountry ? (
                <FlagBadge country={homeCountry} teamName={homeName} size={22} />
              ) : (
                <TeamBadge name={homeName} teamId={homeTeamId} teamColor={homeColor} size={24} />
              )}
            </div>
            <div className="flex flex-shrink-0 flex-col items-center">
              <span className="font-numeric text-h3 font-bold tabular-nums text-[var(--text-primary)] sm:text-h2">
                {score}
              </span>
              {isLive ? (
                <LiveBadge minute={liveMinute ?? null} compact={liveMinute == null} className="mt-0.5" />
              ) : statusLabel ? (
                <span className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {statusLabel}
                </span>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5 sm:gap-2">
              {awayCountry ? (
                <FlagBadge country={awayCountry} teamName={awayName} size={22} />
              ) : (
                <TeamBadge name={awayName} teamId={awayTeamId} teamColor={awayColor} size={24} />
              )}
              <span className="min-w-0 truncate text-meta font-semibold text-[var(--text-primary)] sm:text-body">{awayName}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
