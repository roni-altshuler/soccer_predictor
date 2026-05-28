'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowRight, BarChart3, Brain, Flame, Gauge, Sparkles, Target } from 'lucide-react'

import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid'
import { BorderBeam } from '@/components/magicui/border-beam'
import { GridPattern } from '@/components/magicui/grid-pattern'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { PulsatingButton } from '@/components/magicui/pulsating-button'
import { ShimmerButton } from '@/components/magicui/shimmer-button'
import { Spotlight } from '@/components/magicui/spotlight'
import { ConfidencePill } from '@/components/primitives/ConfidencePill'
import { TeamBadge } from '@/components/primitives/TeamBadge'
import { BentoSkeleton } from '@/components/skeletons/BentoSkeleton'
import { Card } from '@/components/ui/card'
import { useGenderQuery } from '@/hooks/useGenderQuery'

interface TodayPick {
  id: string | number
  home_team: string
  away_team: string
  league?: string
  predicted_outcome?: 'H' | 'D' | 'A'
  predicted_scoreline?: string
  predicted_confidence?: number
}

interface AccuracySummary {
  accuracy?: number
  outcome_accuracy?: number
  recent_streak?: number
  total?: number
}

const NUMBER = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && !Number.isNaN(v) ? v : fallback

export default function AiDashboardPage() {
  const { asQueryParam, withParam } = useGenderQuery()

  const [picks, setPicks] = useState<TodayPick[] | null>(null)
  const [accuracy, setAccuracy] = useState<AccuracySummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [picksRes, accRes] = await Promise.all([
          fetch(withParam('/api/v1/tracking/recent?limit=20'), { cache: 'no-store' }),
          fetch(`/api/v1/tracking/accuracy?gender=${asQueryParam}&days=30`, { cache: 'no-store' }),
        ])
        if (picksRes.ok && !cancelled) {
          const data = await picksRes.json()
          const raw = Array.isArray(data?.predictions) ? data.predictions : []
          setPicks(raw.slice(0, 5))
        }
        if (accRes.ok && !cancelled) {
          const data = await accRes.json()
          setAccuracy(data)
        }
      } catch {
        // non-fatal — empty state will render
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [asQueryParam, withParam])

  const accuracyPct = useMemo(() => {
    const a = NUMBER(accuracy?.accuracy ?? accuracy?.outcome_accuracy, 0)
    return a <= 1 ? a * 100 : a
  }, [accuracy])

  const topPick = picks?.[0]

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
      {/* HERO */}
      <Spotlight className="block rounded-2xl" size={520} color="color-mix(in srgb, var(--accent-ai) 18%, transparent)">
        <Card className="relative overflow-hidden p-6">
          <BorderBeam size={1} duration={11} borderRadius={16} colorFrom="var(--accent-ai)" colorTo="var(--accent-primary)" />
          <GridPattern
            width={28}
            height={28}
            className="opacity-40 [mask-image:linear-gradient(to_bottom_right,white,transparent_70%)]"
          />
          <div className="relative z-10 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-caption font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                Pitchwise
              </p>
              <h1 className="mt-1 text-display font-extrabold tracking-tight text-[var(--text-primary)]">
                AI Dashboard
              </h1>
              <p className="mt-2 max-w-xl text-small text-[var(--text-secondary)]">
                Top picks, momentum, and the simulation engine — everything the unified model is
                serving up today.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <PulsatingButton pulseColor="var(--accent-primary)">Live</PulsatingButton>
              <Link href="/predict">
                <ShimmerButton
                  background="linear-gradient(135deg, var(--accent-ai), var(--accent-primary))"
                  borderRadius="0.75rem"
                  className="text-sm"
                >
                  Run a prediction
                  <ArrowRight className="ml-1.5 inline h-3.5 w-3.5" />
                </ShimmerButton>
              </Link>
            </div>
          </div>
        </Card>
      </Spotlight>

      {/* KPI Bento */}
      <BentoGrid className="mt-6 auto-rows-[9rem]">
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Gauge className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              30-day accuracy
            </div>
            <NumberTicker
              value={accuracyPct}
              decimalPlaces={1}
              suffix="%"
              className="text-h1 font-extrabold tabular-nums text-[var(--accent-primary)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">outcome hit-rate</span>
          </div>
        </BentoCard>
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Activity className="h-3.5 w-3.5 text-[var(--accent-loss)]" />
              Picks today
            </div>
            <NumberTicker
              value={picks?.length ?? 0}
              className="text-h1 font-extrabold tabular-nums text-[var(--text-primary)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">AI predictions live</span>
          </div>
        </BentoCard>
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Flame className="h-3.5 w-3.5 text-[var(--accent-warn)]" />
              Recent streak
            </div>
            <NumberTicker
              value={NUMBER(accuracy?.recent_streak, 0)}
              className="text-h1 font-extrabold tabular-nums text-[var(--accent-warn)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">correct in a row</span>
          </div>
        </BentoCard>
      </BentoGrid>

      {/* Marquee pick */}
      {topPick ? (
        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-[var(--border-color)] bg-[var(--muted-bg)]/60 px-5 py-3">
            <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
              Marquee pick
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <TeamBadge name={topPick.home_team} size={36} />
                <span className="text-h4 text-[var(--text-primary)]">{topPick.home_team}</span>
              </div>
              <div className="text-center">
                {topPick.predicted_scoreline ? (
                  <p className="font-mono text-display font-extrabold tabular-nums text-[var(--text-primary)]">
                    {topPick.predicted_scoreline}
                  </p>
                ) : null}
                {typeof topPick.predicted_confidence === 'number' ? (
                  <ConfidencePill value={topPick.predicted_confidence} label="Confidence" />
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-h4 text-[var(--text-primary)]">{topPick.away_team}</span>
                <TeamBadge name={topPick.away_team} size={36} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-caption text-[var(--text-tertiary)]">
              <span>{topPick.league ?? '—'}</span>
              <Link
                href={`/matches/${topPick.id}`}
                className="inline-flex items-center gap-1 font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)] hover:underline"
              >
                Match detail
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Top picks list */}
      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 text-[var(--text-primary)]">Top high-confidence picks</h2>
          <Link
            href="/history"
            className="text-caption font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)] hover:underline"
          >
            See full history →
          </Link>
        </div>

        {loading ? (
          <BentoSkeleton count={4} />
        ) : picks && picks.length > 0 ? (
          <BentoGrid className="auto-rows-[8rem]">
            {picks.map((pick) => (
              <BentoCard key={pick.id} className="col-span-3 md:col-span-1">
                <Link
                  href={`/matches/${pick.id}`}
                  className="relative z-10 flex h-full flex-col justify-between p-5"
                >
                  <div className="flex items-center justify-between text-caption text-[var(--text-tertiary)]">
                    <span className="uppercase tracking-[0.16em]">{pick.league ?? 'League'}</span>
                    {typeof pick.predicted_confidence === 'number' ? (
                      <ConfidencePill value={pick.predicted_confidence} compact />
                    ) : null}
                  </div>
                  <div>
                    <p className="truncate text-h4 text-[var(--text-primary)]">
                      {pick.home_team} <span className="text-[var(--text-tertiary)]">vs</span>{' '}
                      {pick.away_team}
                    </p>
                    {pick.predicted_scoreline ? (
                      <p className="mt-0.5 font-mono text-small text-[var(--accent-ai)]">
                        Pick: {pick.predicted_scoreline}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 text-caption text-[var(--accent-primary)]">
                    <Target className="h-3 w-3" />
                    Open match
                  </div>
                </Link>
              </BentoCard>
            ))}
          </BentoGrid>
        ) : (
          <Card className="p-8 text-center text-small text-[var(--text-tertiary)]">
            <Brain className="mx-auto mb-2 h-6 w-6 text-[var(--accent-ai)]" />
            No predictions are available right now. Check back after the next pipeline run.
          </Card>
        )}
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[var(--accent-primary)]" />
          <h2 className="text-h3 text-[var(--text-primary)]">Model performance</h2>
        </div>
        <Card className="p-6 text-small text-[var(--text-secondary)]">
          The full calibration view, confusion matrix, and reliability diagrams live on the{' '}
          <Link href="/accuracy" className="font-semibold text-[var(--accent-primary)] hover:underline">
            Accuracy page
          </Link>
          .
        </Card>
      </section>
    </div>
  )
}
