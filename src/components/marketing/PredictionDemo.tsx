'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react'

import { PredictionResult } from '@/components/prediction/PredictionResult'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  adaptLegacyPrediction,
  DEMO_FIXTURES,
  FALLBACK_PREDICTION,
  type LegacyPredictionResponse,
} from './demoData'
import type { PredictionPayload } from '@/components/prediction/PredictionResult'

type Status = 'loading' | 'live' | 'fallback'

const FETCH_TIMEOUT_MS = 6000

export function PredictionDemo() {
  const reduce = useReducedMotion()
  const [fixtureIdx, setFixtureIdx] = useState(0)
  const [status, setStatus] = useState<Status>('loading')
  const [payload, setPayload] = useState<PredictionPayload>(FALLBACK_PREDICTION)

  const fixture = DEMO_FIXTURES[fixtureIdx]

  const run = useCallback(async (idx: number) => {
    const f = DEMO_FIXTURES[idx]
    setStatus('loading')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch('/api/predict/any-teams?gender=men', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          home_team: f.home,
          away_team: f.away,
          home_league: f.league,
          away_league: f.awayLeague,
          gender: 'men',
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as LegacyPredictionResponse
      const adapted = adaptLegacyPrediction(data)
      if (!adapted) throw new Error('unadaptable')
      setPayload(adapted)
      setStatus('live')
    } catch {
      // Graceful fallback — keep the section credible even if the API is down.
      setPayload({
        ...FALLBACK_PREDICTION,
        home_team: f.home,
        away_team: f.away,
        league: f.league,
      })
      setStatus('fallback')
    } finally {
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    run(fixtureIdx)
  }, [fixtureIdx, run])

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 shadow-[var(--shadow-md)] md:p-7">
      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Choose a sample fixture"
          className="flex flex-wrap gap-1.5 rounded-xl bg-[var(--muted-bg)] p-1"
        >
          {DEMO_FIXTURES.map((f, i) => (
            <button
              key={f.home}
              role="tab"
              aria-selected={i === fixtureIdx}
              onClick={() => setFixtureIdx(i)}
              className={cn(
                'min-h-[40px] rounded-lg px-3 text-xs font-semibold transition-colors',
                i === fixtureIdx
                  ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
              )}
            >
              {f.home} v {f.away}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          <button
            onClick={() => run(fixtureIdx)}
            disabled={status === 'loading'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
            aria-label="Re-run prediction"
          >
            <RefreshCw className={cn('h-4 w-4', status === 'loading' && 'animate-spin')} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Result */}
      <div className="relative min-h-[420px]">
        <AnimatePresence mode="wait">
          {status === 'loading' ? (
            <motion.div
              key="loading"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--muted-bg)]/40"
            >
              <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-ai)]" aria-hidden="true" />
              <p className="text-sm text-[var(--text-tertiary)]">
                Running {fixture.home} vs {fixture.away} through the model…
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={`${fixtureIdx}-${status}`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              {/* PredictionResult uses Radix tooltips; the marketing layout has
                  no AppShell-level provider, so supply one here. */}
              <TooltipProvider delayDuration={200}>
                <PredictionResult prediction={payload} />
              </TooltipProvider>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: Status }) {
  if (status === 'loading') return null
  const live = status === 'live'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        live
          ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]'
          : 'bg-[var(--accent-warn)]/12 text-[var(--accent-warn)]',
      )}
      title={live ? 'Computed live by the backend model' : 'Backend unreachable — showing a sample prediction'}
    >
      {live ? <Wifi className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}
      {live ? 'Live model' : 'Sample data'}
    </span>
  )
}
