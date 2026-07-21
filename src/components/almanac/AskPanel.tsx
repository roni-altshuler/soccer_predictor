'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'

import { AskChart } from '@/components/almanac/AskChart'
import { EmptyState } from '@/components/EmptyState'
import { AnimatedNumber } from '@/components/motion'
import { atMinutePhrase, statePhrase } from '@/lib/ask/grammar'
import { EXAMPLE_QUESTIONS } from '@/lib/ask/schema'
import type { AskIntent } from '@/lib/ask/schema'
import type { AskPrecedent, AskResponse } from '@/lib/ask/types'
import { getLeagueAccent } from '@/lib/leagueAccents'

/**
 * Ask Pitchverse (Almanac v1) — the natural-language front door.
 *
 * The user types a question in plain English; the answer is an EXACT tally from
 * the history we count, an auto-chart, and a plain read. Nothing is fabricated:
 * the numbers come from `/api/v1/ask`, which only ever reports counts. When a
 * question falls outside the answerable set the panel says so and offers real
 * example questions rather than guessing.
 */

const ROUTABLE_ESPN = new Set([
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'usa.1',
  'uefa.champions', 'uefa.europa', 'uefa.euro', 'conmebol.america', 'fifa.world',
])

function precedentHref(p: AskPrecedent): string | undefined {
  const m = p.match_id.match(/^espn_(.+)_(\d+)$/)
  if (!m) return undefined
  const [, competition, eventId] = m
  if (!ROUTABLE_ESPN.has(competition)) return undefined
  return `/matches/${eventId}?league=${competition}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function describeIntent(intent: AskIntent): string {
  const who = intent.gender === 'F' ? 'Women’s · ' : ''
  return `${who}a team ${statePhrase(intent.diff)} ${atMinutePhrase(intent.minute)}`
}

function PrecedentRow({ p }: { p: AskPrecedent }) {
  const accent = getLeagueAccent(p.competition_id)
  const href = precedentHref(p)
  const inner = (
    <div className="flex w-full items-center gap-3 px-3 py-2.5">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: accent.accent }} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-secondary)]">
        <span className={p.side === 'home' ? 'font-semibold text-[var(--text-primary)]' : undefined}>{p.home}</span>
        <span className="px-1.5 font-semibold tabular-nums text-[var(--text-primary)]">{p.final_score}</span>
        <span className={p.side === 'away' ? 'font-semibold text-[var(--text-primary)]' : undefined}>{p.away}</span>
      </span>
      <span className="hidden shrink-0 text-[11px] text-[var(--text-tertiary)] sm:inline">
        {accent.competitionId !== 'unknown' ? accent.shortName : p.competition_id}
      </span>
      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-tertiary)]">
        {formatDate(p.date)}
      </span>
    </div>
  )
  const className =
    'block w-full transition-colors hover:bg-[var(--card-hover)] focus-visible:bg-[var(--card-hover)] focus-visible:outline-none'
  return href ? (
    <Link href={href} prefetch={false} className={className}>
      {inner}
    </Link>
  ) : (
    <div className="w-full">{inner}</div>
  )
}

function ExampleChips({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EXAMPLE_QUESTIONS.map((ex) => (
        <button
          key={ex.id}
          type="button"
          onClick={() => onPick(ex.text)}
          className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--border-color)] px-3.5 text-left text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
        >
          {ex.text}
        </button>
      ))}
    </div>
  )
}

function AnswerCard({ res }: { res: AskResponse }) {
  if (!res.supported || !res.answer || !res.intent) return null
  const { answer, intent, chartSpec, provenance } = res
  const { headline, thin, narration, precedents } = answer

  return (
    <div className="space-y-4">
      <div className="space-y-5 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 sm:p-6">
        <p className="text-xs font-medium text-[var(--text-tertiary)]">Reading: {describeIntent(intent)}</p>

        {headline ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <AnimatedNumber
              value={headline.valuePct}
              decimals={1}
              suffix="%"
              className="text-5xl font-bold tracking-tight text-[var(--text-primary)]"
            />
            <p className="text-sm tabular-nums text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">
                {answer.numbers.focusCount.toLocaleString()} of {answer.numbers.n.toLocaleString()}
              </span>{' '}
              {answer.numbers.n === 1 ? 'match' : 'matches'} {headline.label}
            </p>
          </div>
        ) : (
          <EmptyState
            title="This hasn’t happened in the matches on record"
            description="That’s the honest answer — this exact situation has never occurred in the history we count."
          />
        )}

        {thin && (
          <p
            role="note"
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium"
            style={{
              color: 'var(--accent-warn)',
              borderColor: 'color-mix(in srgb, var(--accent-warn) 40%, transparent)',
              background: 'color-mix(in srgb, var(--accent-warn) 8%, transparent)',
            }}
          >
            Thin sample — only {answer.numbers.n.toLocaleString()} such{' '}
            {answer.numbers.n === 1 ? 'match' : 'matches'} on record. Treat with care.
          </p>
        )}

        {headline && narration.length > 0 && (
          <div className="space-y-1.5">
            {narration.map((s, i) => (
              <p key={i} className="text-sm leading-relaxed text-[var(--text-secondary)]">
                {s}
              </p>
            ))}
          </div>
        )}

        {chartSpec && <AskChart spec={chartSpec} />}

        {provenance && (
          <p className="border-t border-[var(--border-color)] pt-3 text-[11px] leading-relaxed tabular-nums text-[var(--text-tertiary)]">
            Based on {provenance.sampleSize.toLocaleString()} such{' '}
            {provenance.sampleSize === 1 ? 'match' : 'matches'} · counted across{' '}
            {provenance.matchesCovered.toLocaleString()} {provenance.basis === 'F' ? "women's" : "men's"} matches on
            record. Educational only.
          </p>
        )}
      </div>

      {precedents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Precedents</h2>
            <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {Math.min(precedents.length, 12)} shown
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            <div className="divide-y divide-[var(--border-color)]/50">
              {precedents.slice(0, 12).map((p) => (
                <PrecedentRow key={`${p.match_id}-${p.side}`} p={p} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Unsupported({ res, onPick }: { res: AskResponse; onPick: (q: string) => void }) {
  const needMinute = res.reason === 'need_minute'
  return (
    <div className="space-y-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 sm:p-6">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {needMinute ? 'Almost — I just need a minute' : 'I can’t answer that one yet'}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          {needMinute
            ? 'Tell me when in the match and I’ll count it exactly — e.g. “at the 70th minute”, “at half-time”, or “with 10 minutes left”.'
            : 'I answer one kind of question exactly: how often a team in a given match state — a lead or deficit at a set minute — goes on to a result. I don’t predict specific fixtures or read a league table. Try one of these:'}
        </p>
      </div>
      <ExampleChips onPick={onPick} />
    </div>
  )
}

export function AskPanel() {
  const [question, setQuestion] = useState('')
  const [res, setRes] = useState<AskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  async function ask(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(false)
    try {
      const r = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json: AskResponse = await r.json()
      setRes(json)
    } catch {
      if (controller.signal.aborted) return
      setError(true)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  function pick(q: string) {
    setQuestion(q)
    void ask(q)
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(question)
        }}
        className="space-y-2"
      >
        <label htmlFor="ask-input" className="sr-only">
          Ask a question about football’s history
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="ask-input"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything… e.g. two goals down at 70 minutes — can they still win?"
            maxLength={400}
            autoComplete="off"
            className="min-h-[48px] flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-primary)]"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,var(--card-bg))] px-6 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-primary)_22%,var(--card-bg))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>

      {!res && !loading && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Try one of these
          </p>
          <ExampleChips onPick={pick} />
        </div>
      )}

      {loading && (
        <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-primary)] border-t-transparent" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
          <EmptyState
            title="Couldn’t reach the history"
            description="The service didn’t respond. Try again in a moment."
          />
        </div>
      )}

      {!loading && !error && res && (res.supported ? <AnswerCard res={res} /> : <Unsupported res={res} onPick={pick} />)}
    </div>
  )
}
