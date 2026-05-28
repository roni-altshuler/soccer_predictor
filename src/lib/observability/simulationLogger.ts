/**
 * Observability hooks for the league simulation pipeline.
 *
 * Two responsibilities:
 *   1. logSimulationRun(meta)        — emits a structured record per run
 *      (league, nSimulations, fixture source, duration, output sanity)
 *   2. logProbabilityAnomaly(reason) — emits when an invariant fails
 *      (sum-to-1 violation, negatives, NaN, missing buckets)
 *
 * Both are pure observation: they read inputs and write to a sink, never
 * mutate inputs or alter return values. Default sink is the console with
 * NDJSON-style structured output so it's grep-friendly in Vercel logs.
 *
 * The sink is pluggable via setObservabilitySink() so production can wire
 * a real reporter (Sentry, Datadog) without changing call sites. Calling
 * the logger functions when no sink override is installed is safe — the
 * default falls back to console.log/warn.
 */

import { PROBABILITY_SUM_TOLERANCE } from '@/lib/probabilityValidation'

export type ObservabilityLevel = 'info' | 'warn' | 'error'

export interface ObservabilityEvent {
  event: string
  level: ObservabilityLevel
  timestamp: string
  details: Record<string, unknown>
}

export type ObservabilitySink = (event: ObservabilityEvent) => void

const defaultSink: ObservabilitySink = (event) => {
  // NDJSON line — easy to grep, easy to ingest by log shippers.
  const line = JSON.stringify(event)
  if (event.level === 'error') {
    console.error(line)
  } else if (event.level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

let activeSink: ObservabilitySink = defaultSink

/** Swap the sink — useful from tests or to wire a real reporter in prod. */
export function setObservabilitySink(sink: ObservabilitySink | null): void {
  activeSink = sink ?? defaultSink
}

function emit(level: ObservabilityLevel, event: string, details: Record<string, unknown>): void {
  try {
    activeSink({
      event,
      level,
      timestamp: new Date().toISOString(),
      details,
    })
  } catch {
    // Sinks must never break the caller.
  }
}

export interface SimulationRunMeta {
  leagueId: number
  leagueName: string
  espnLeagueId?: string
  nSimulations: number
  numTeams: number
  fixtureSource: 'espn_live' | 'generated_fallback'
  remainingFixtures: number
  durationMs: number
  hasWhatIfOverride: boolean
}

/** Records a single simulation run. Called from the route handler. */
export function logSimulationRun(meta: SimulationRunMeta): void {
  emit('info', 'simulation_run', meta as unknown as Record<string, unknown>)
}

export interface ProbabilityAnomaly {
  /** Where the anomaly was detected (e.g. 'monte_carlo_title_probabilities'). */
  source: string
  /** Human-friendly reason (e.g. 'sum_off_tolerance'). */
  reason: string
  /** Numeric evidence — the field(s) that triggered the warning. */
  details: Record<string, unknown>
}

/** Records a probability invariant violation without changing any outputs. */
export function logProbabilityAnomaly(anomaly: ProbabilityAnomaly): void {
  emit('warn', 'probability_anomaly', { ...anomaly, tolerance: PROBABILITY_SUM_TOLERANCE })
}
