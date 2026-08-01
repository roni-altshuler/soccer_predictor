'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { groupedCapabilitiesFor } from '@/lib/companion/capabilities'
import { contextLabel } from '@/lib/companion/context'
import { contextualPrompts, type ContextualPrompt } from '@/lib/companion/contextualIntent'
import type { AskResponse } from '@/lib/ask/types'
import { cn } from '@/lib/utils'

import { useCompanion } from './CompanionProvider'

/**
 * Ask Pitchverse — the docked rail.
 *
 * One interpretation layer that follows the fan, instead of three surfaces they
 * have to know about separately (the panel debate on the prediction tab, the
 * story on finished matches, the question box at /almanac). It is deliberately
 * NOT a chat window: it offers the questions this exact page can answer, and
 * every answer it gives is an exact count with its sample size attached.
 *
 * Layout follows the reference class in docs/design-language.md — structurally
 * a bet365 bet slip rather than an assistant overlay. Docked from `xl`; below
 * that it collapses to an edge tab that opens a slide-over, so the data grid
 * keeps its width on laptops and phones.
 *
 * Design rules honoured: tokens only (no hardcoded colours), cyan reserved for
 * AI-derived figures, no gradients or glow, 44px tap targets, and every
 * transition disabled under `prefers-reduced-motion`.
 *
 * Honest absence throughout: when the page has no state to interpret there are
 * no prompts — the rail shows what it *can* do and says nothing about a match
 * it cannot speak to.
 */

const RAIL_LABEL = 'Ask Pitchverse'

export function AskRail() {
  const { context } = useCompanion()
  const [open, setOpen] = useState(false)

  const groups = groupedCapabilitiesFor(context)
  const prompts = contextualPrompts(context)

  // A new subject invalidates the answer on screen: an exact count for the
  // previous match displayed under a new heading would be a quiet lie.
  const subjectKey = `${context.kind}:${contextLabel(context)}`

  return (
    <>
      {/* Edge tab — only below the docked breakpoint. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="ask-rail"
        className={cn(
          'fixed right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-lg border border-r-0',
          'border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-4',
          'text-xs font-semibold tracking-wide text-[var(--text-secondary)]',
          'hover:text-[var(--text-primary)] xl:hidden',
          '[writing-mode:vertical-rl]'
        )}
      >
        Ask
      </button>

      {/* Backdrop for the slide-over form. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 xl:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="ask-rail"
        aria-label={RAIL_LABEL}
        className={cn(
          'fixed right-0 top-0 z-40 h-screen w-[min(88vw,var(--shell-rail-w))]',
          'overflow-y-auto border-l border-[var(--border-color)] bg-[var(--card-bg)]',
          'transition-transform duration-200 motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-full',
          // Parked off-canvas it must not swallow taps at the right edge —
          // where the edge tab itself lives.
          !open && 'pointer-events-none xl:pointer-events-auto',
          // Docked and always present from xl up.
          'xl:translate-x-0'
        )}
      >
        <RailHeader
          subject={contextLabel(context)}
          onClose={() => setOpen(false)}
        />
        <div className="space-y-6 p-4">
          {prompts.length > 0 && <AskSection key={subjectKey} prompts={prompts} />}

          {groups.map((group) => (
            <section key={group.verb}>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                {group.label}
              </h3>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{group.blurb}</p>
              <ul className="mt-2 space-y-1">
                {group.capabilities.map((cap) => (
                  <li key={cap.id}>
                    <Link
                      href={cap.href(context)}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex min-h-[44px] flex-col justify-center rounded-md px-3 py-2',
                        'hover:bg-[var(--card-hover)]'
                      )}
                    >
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {cap.label}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">{cap.hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </>
  )
}

function RailHeader({ subject, onClose }: { subject: string; onClose: () => void }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-10 flex items-center justify-between gap-2 border-b',
        'border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3'
      )}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          {RAIL_LABEL}
        </p>
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{subject}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="min-h-[44px] px-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] xl:hidden"
      >
        ✕
      </button>
    </header>
  )
}

/**
 * The contextual questions for the current match state. Each chip already
 * carries a resolved intent, so tapping it is a direct exact-count lookup —
 * no parsing, no model, no quota.
 */
function AskSection({ prompts }: { prompts: ContextualPrompt[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    setActiveId(null)
    setResult(null)
    setState('idle')
  }, [prompts.length])

  const run = useCallback(async (prompt: ContextualPrompt) => {
    setActiveId(prompt.id)
    setState('loading')
    setResult(null)
    try {
      const res = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: prompt.intent, question: prompt.label }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setResult((await res.json()) as AskResponse)
      setState('idle')
    } catch {
      // No fabricated fallback: the section says it could not answer.
      setState('error')
    }
  }, [])

  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
        About this match
      </h3>
      <ul className="mt-2 space-y-1">
        {prompts.map((prompt) => (
          <li key={prompt.id}>
            <button
              type="button"
              onClick={() => run(prompt)}
              className={cn(
                'w-full rounded-md px-3 py-2 text-left text-sm min-h-[44px]',
                'hover:bg-[var(--card-hover)]',
                activeId === prompt.id
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)]'
              )}
            >
              {prompt.label}
            </button>
          </li>
        ))}
      </ul>

      {state === 'loading' && (
        <p className="mt-2 px-3 text-xs text-[var(--text-secondary)]">Counting…</p>
      )}
      {state === 'error' && (
        <p className="mt-2 px-3 text-xs text-[var(--text-secondary)]">
          Could not answer that just now.
        </p>
      )}
      {result?.answer && <AnswerCard response={result} />}
    </section>
  )
}

function AnswerCard({ response }: { response: AskResponse }) {
  const answer = response.answer
  if (!answer) return null
  const { numbers, headline, thin, narration } = answer

  // A state nobody has reached is a real finding, not an error — say so plainly
  // rather than rendering a 0% that reads as a measurement.
  if (numbers.n === 0) {
    return (
      <div className="mt-3 rounded-md border border-[var(--border-color)] p-3">
        <p className="text-sm text-[var(--text-primary)]">
          No match in the record has reached this exact state.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--border-color)] p-3">
      {headline && (
        <p className="font-numeric text-2xl font-bold tabular-nums text-[var(--accent-ai)]">
          {headline.valuePct.toFixed(1)}%
        </p>
      )}
      <p className="mt-1 text-sm text-[var(--text-primary)]">{narration[0]}</p>
      <p className="mt-2 font-numeric text-xs tabular-nums text-[var(--text-secondary)]">
        {numbers.focusCount.toLocaleString()} of {numbers.n.toLocaleString()} matches
      </p>
      {thin && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Thin sample — treat this one loosely.
        </p>
      )}
    </div>
  )
}
