'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import type { BoardroomDebate, BoardroomPersona, DissentLevel } from '@/lib/boardroom'

/**
 * The Boardroom (docs/VISION_2030.md §3.4) — three dissenting analysts on the
 * record for one fixture, plus a dissent meter that reads the disagreement as
 * the epistemic-uncertainty display.
 *
 * Honest absence: the debate renders **only** when the committed artifact has an
 * entry for this match. No entry → nothing at all (never a placeholder). Every
 * number in the prose was verified against a grounding bundle at pipeline time.
 *
 * `Boardroom` is the pure renderer (takes a debate or null). `BoardroomPanel`
 * is the client container that loads the committed debate by match id.
 */

// A quiet identity per persona — colour only, no naming of internals.
const PERSONA_ACCENT: Record<string, string> = {
  quant: 'var(--accent-ai)',
  historian: 'var(--accent-primary)',
  skeptic: 'var(--accent-warn)',
}

const DISSENT_SEGMENTS: DissentLevel[] = ['low', 'moderate', 'high']

const DISSENT_COLOR: Record<DissentLevel, string> = {
  low: 'var(--accent-primary)',
  moderate: 'var(--accent-warn)',
  high: 'var(--accent-loss)',
}

function stanceLabel(persona: BoardroomPersona, debate: BoardroomDebate): string {
  if (persona.stance === 'home') return `Leans ${debate.home_team}`
  if (persona.stance === 'away') return `Leans ${debate.away_team}`
  return 'Leans a draw'
}

function DissentMeter({ level, index }: { level: DissentLevel; index: number }) {
  const activeIdx = DISSENT_SEGMENTS.indexOf(level)
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" role="img" aria-label={`Dissent: ${level}`}>
        {DISSENT_SEGMENTS.map((seg, i) => (
          <span
            key={seg}
            className="h-1.5 w-8 rounded-full transition-colors"
            style={{
              backgroundColor: i <= activeIdx ? DISSENT_COLOR[level] : 'var(--border-color)',
            }}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium capitalize text-[var(--text-secondary)]">
        {level} dissent
      </span>
      <span className="ml-auto text-[11px] tabular-nums text-[var(--text-tertiary)]">
        {(index * 100).toFixed(0)} / 100
      </span>
    </div>
  )
}

function PersonaCard({ persona, debate }: { persona: BoardroomPersona; debate: BoardroomDebate }) {
  const accent = PERSONA_ACCENT[persona.key] ?? 'var(--accent-ai)'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} aria-hidden="true" />
        <span className="text-[13px] font-bold text-[var(--text-primary)]">{persona.name}</span>
      </div>
      <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: accent }}>
        {stanceLabel(persona, debate)}
      </span>
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{persona.text}</p>
      {persona.claims.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {persona.claims.map((claim, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-[var(--text-tertiary)]">
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{claim}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Boardroom({ debate, className }: { debate: BoardroomDebate | null; className?: string }) {
  // Honest absence — no committed debate for this match means render nothing.
  if (!debate || !debate.personas || debate.personas.length < 2) return null

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className
      )}
      aria-label="The Boardroom"
    >
      <div className="flex flex-col gap-1 border-b border-[var(--border-color)] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">The Boardroom</h3>
          <span className="text-[11px] text-[var(--text-tertiary)]">Three analysts, on the record</span>
        </div>
        <DissentMeter level={debate.dissent_level} index={debate.dissent_index} />
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
        {debate.personas.map((p) => (
          <PersonaCard key={p.key || p.name} persona={p} debate={debate} />
        ))}
      </div>
    </section>
  )
}

/**
 * Client container: loads the committed debate for `matchId` and renders it.
 * Renders nothing while loading or when there is no entry (honest absence), so
 * it can be dropped into any match-detail state without adding chrome.
 */
export function BoardroomPanel({ matchId, className }: { matchId: string; className?: string }) {
  const [debate, setDebate] = useState<BoardroomDebate | null>(null)

  useEffect(() => {
    if (!matchId) return
    const controller = new AbortController()
    fetch(`/api/v1/boardroom?match=${encodeURIComponent(matchId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.debate) setDebate(data.debate as BoardroomDebate)
      })
      .catch(() => {
        /* absent artifact / aborted fetch — stay silent */
      })
    return () => controller.abort()
  }, [matchId])

  if (!debate) return null
  return <Boardroom debate={debate} className={className} />
}
