'use client'

import { cn } from '@/lib/utils'

export type NarrativeTone = 'edge' | 'risk' | 'watch' | 'note'

export interface NarrativeInsight {
  /**
   * `edge`  — an AI-identified advantage (cyan).
   * `risk`  — something working against the pick (amber).
   * `watch` — informational angle worth tracking (blue).
   * `note`  — neutral context (muted).
   */
  tone: NarrativeTone
  /** Short tag/headline for the bullet ("Set pieces", "Rotation risk"). */
  title: string
  /** One-sentence explanation. */
  detail: string
}

interface NarrativeCardProps {
  /** Card heading (default "Match angles"). */
  heading?: string
  /** Pre-computed insights — consumers own the rule logic, this is the shell. */
  insights: NarrativeInsight[]
  className?: string
}

const TONE_VAR: Record<NarrativeTone, string> = {
  edge: 'var(--accent-ai)',
  risk: 'var(--accent-warn)',
  watch: 'var(--accent-info)',
  note: 'var(--text-tertiary)',
}

const TONE_LABEL: Record<NarrativeTone, string> = {
  edge: 'Edge',
  risk: 'Risk',
  watch: 'Watch',
  note: 'Note',
}

/**
 * Tone-tagged bullet card for pre-match narrative angles.
 *
 * Soccer usage: "what the model sees" on a match detail page — 2–4 supplied
 * bullets like "Arsenal have scored first in 8 of the last 10 at home" tagged
 * edge/risk/watch/note. This component is a pure shell: consumers derive the
 * insights (rule engine, API field, editorial) and pass them in. Renders
 * nothing when the list is empty, per the no-placeholder rule. Flat hairline
 * card; tone colour appears only in the tag chip, mapped to Matchday tokens
 * (cyan = AI edge, amber = risk, blue = informational, muted = note).
 */
export function NarrativeCard({ heading = 'Match angles', insights, className }: NarrativeCardProps) {
  if (!insights || insights.length === 0) return null
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4',
        className,
      )}
    >
      <h3 className="mb-3 text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {heading}
      </h3>
      <ul className="space-y-2">
        {insights.map((insight, i) => {
          const tone = TONE_VAR[insight.tone]
          return (
            <li
              key={`${insight.tone}-${i}`}
              className="flex items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] p-3"
            >
              <span
                className="mt-0.5 shrink-0 rounded px-1.5 py-px text-[9px] uppercase tracking-[0.1em]"
                style={{
                  color: tone,
                  border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`,
                  background: `color-mix(in srgb, ${tone} 12%, transparent)`,
                }}
              >
                {TONE_LABEL[insight.tone]}
              </span>
              <div className="min-w-0">
                <p className="text-meta font-semibold text-[var(--text-primary)]">{insight.title}</p>
                <p className="mt-0.5 text-meta leading-snug text-[var(--text-secondary)]">
                  {insight.detail}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default NarrativeCard
