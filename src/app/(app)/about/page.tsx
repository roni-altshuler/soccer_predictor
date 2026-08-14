import { promises as fs } from 'fs'
import path from 'path'

import Link from 'next/link'
import { ArrowRight, CalendarRange, ShieldAlert, Swords, Target, Trophy } from 'lucide-react'

import { DocsLink } from '@/components/evidence/DocsLink'
import { CalibrationBars, FloorBars } from '@/components/evidence/FloorBars'
import { EvidenceHeader, Panel, StatTile } from '@/components/evidence/primitives'
import { DOCS, REPO_URL, docsUrl, type DocKey } from '@/lib/docs'

/**
 * How it works — where the explaining happens, in as few words as possible.
 *
 * The first version of this page moved every methodology paragraph off the
 * product and onto one screen. That was the right move and the wrong format:
 * six sections of prose is still an essay, and an essay is a thing readers
 * scroll past. Every number in it was also typed by hand, which is the failure
 * mode this project cares most about — a page about being measured, quoting
 * measurements that could silently go stale.
 *
 * So it is built from the artifacts, and the explanations are pictures where a
 * picture exists:
 *
 *   the floors        bars, model against yardstick, per layer. Replaces the
 *                     paragraph that said "a number without a floor is not
 *                     information" on five pages in five wordings.
 *   calibration       two bars per band; a calibrated band has them equal.
 *   the two records   two tiles, side by side, never summed.
 *
 * Text that survives is text a picture cannot carry: what the four things are,
 * and what this product refuses to claim.
 */

export const metadata = {
  title: 'How it works · Pitchverse',
  description:
    'How Pitchverse forecasts matches, seasons and knockout tournaments — the models, the yardsticks, and how the claims are checked.',
}

const DATA = path.join(process.cwd(), 'backend', 'data')

async function readJson<T>(...segments: string[]): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, ...segments), 'utf8')) as T
  } catch {
    return null
  }
}

interface Evidence {
  matchBrier: number | null
  matchEce: number | null
  matchN: number | null
  liveN: number | null
  tieLadder: Array<{ key: string; label: string; brier: number; accuracy: number }>
  tieBands: Array<{ label: string; stated: number; observed: number; n: number }>
  tieN: number | null
  trophy: { model: number; elo: number; uniform: number } | null
  trophyN: number | null
}

/**
 * Everything this page states, read off the artifacts that produced it.
 *
 * A missing artifact drops its block rather than substituting a number. This
 * page's whole subject is measurement; a hard-coded figure here would be the
 * one lie the rest of the site is built to prevent.
 */
async function evidence(): Promise<Evidence> {
  const [live, knockout, brackets] = await Promise.all([
    readJson<{
      historical?: { n?: number; brier?: number; ece?: number }
      live?: { n?: number }
    }>('evaluation', 'live.json'),
    readJson<{
      n_ties_scored?: number
      ladder?: Array<{ key: string; label: string; brier: number; accuracy: number }>
      calibration?: Array<{
        stated_low: number
        stated_high: number
        n: number
        observed: number
        mean_stated: number
      }>
    }>('diagnostics', 'knockout_model.json'),
    readJson<{
      summary?: {
        n_tournaments?: number
        log_loss?: { model: number; elo_simulation: number; uniform: number }
      }
    }>('diagnostics', 'bracket_backtest.json'),
  ])

  return {
    matchBrier: live?.historical?.brier ?? null,
    matchEce: live?.historical?.ece ?? null,
    matchN: live?.historical?.n ?? null,
    liveN: live?.live?.n ?? null,
    tieLadder: knockout?.ladder ?? [],
    tieBands: (knockout?.calibration ?? []).map((c) => ({
      label: `${c.stated_low}–${c.stated_high}%`,
      stated: c.mean_stated,
      observed: c.observed,
      n: c.n,
    })),
    tieN: knockout?.n_ties_scored ?? null,
    trophy: brackets?.summary?.log_loss
      ? {
          model: brackets.summary.log_loss.model,
          elo: brackets.summary.log_loss.elo_simulation,
          uniform: brackets.summary.log_loss.uniform,
        }
      : null,
    trophyN: brackets?.summary?.n_tournaments ?? null,
  }
}

/** A blind three-way guess. Arithmetic, not a measurement — hence inline. */
const UNIFORM_1X2 = 2 / 3

const WHAT_IT_DOES: Array<{ icon: typeof Target; title: string; line: string; href: string }> = [
  {
    icon: Target,
    title: 'Match outcome',
    line: 'Who wins, and the scoreline',
    href: '/',
  },
  {
    icon: CalendarRange,
    title: 'Season shape',
    line: 'Title, relegation, final table',
    href: '/leagues',
  },
  {
    icon: Swords,
    title: 'Knockout ties',
    line: 'Who advances, tie by tie',
    href: '/tournaments',
  },
  {
    icon: Trophy,
    title: 'Trophies',
    line: 'Who lifts it, simulated',
    href: '/tournaments',
  },
]

const READ_NEXT: DocKey[] = ['tutorialMatch', 'tutorialSeason', 'tutorialBracket', 'tutorialJudge']
const REFERENCE: DocKey[] = ['scoring', 'models', 'evaluation', 'data', 'api', 'artifacts', 'cli', 'glossary']

export default async function HowItWorksPage() {
  const e = await evidence()
  const tieModel = e.tieLadder.find((r) => r.key === 'model')

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <EvidenceHeader
        title="How it works"
        lede="Four forecasts, each measured against the floor it has to clear. This page is the short version; the handbook is the long one."
      />

      {/* ---- the four things, as destinations ------------------------------ */}
      <ul className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {WHAT_IT_DOES.map(({ icon: Icon, title, line, href }) => (
          <li key={title}>
            <Link
              href={href}
              className="group flex h-full flex-col rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3.5 transition-colors hover:border-[color-mix(in_srgb,var(--accent-primary)_35%,var(--border-color))]"
            >
              <Icon className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
              <span className="mt-2.5 text-[13px] font-semibold text-[var(--text-primary)]">
                {title}
              </span>
              <span className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-tertiary)]">
                {line}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 space-y-6">
        {/* ---- the floors, as a picture ----------------------------------- */}
        <Panel
          title="Every number against its floor"
          description="Lower is better on both scales, so the short bar is the better forecaster. The gap is the claim; the level is not."
        >
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            {e.matchBrier ? (
              <div>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  A match · three outcomes
                </h3>
                <FloorBars
                  className="mt-3"
                  digits={4}
                  rows={[
                    { label: 'This model', value: e.matchBrier, subject: true, note: 'Brier' },
                    { label: 'A blind one-in-three guess', value: UNIFORM_1X2 },
                  ]}
                />
                <p className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {e.matchN?.toLocaleString()} matches · walk-forward
                </p>
              </div>
            ) : null}

            {tieModel ? (
              <div>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  A knockout tie · two outcomes
                </h3>
                <FloorBars
                  className="mt-3"
                  digits={4}
                  rows={e.tieLadder.map((r) => ({
                    label: r.label.replace(/\s*\(.*\)$/, ''),
                    value: r.brier,
                    subject: r.key === 'model',
                    note: r.key === 'model' ? 'Brier' : undefined,
                  }))}
                />
                <p className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {e.tieN?.toLocaleString()} ties · trained only on earlier seasons
                </p>
              </div>
            ) : null}
          </div>

          {e.trophy ? (
            <div className="mt-5 border-t border-[var(--border-color)] pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                A trophy · log loss on the team that actually won it
              </h3>
              <FloorBars
                className="mt-3"
                rows={[
                  { label: 'This model', value: e.trophy.model, subject: true },
                  { label: 'An unfitted Elo simulation', value: e.trophy.elo },
                  { label: 'Uniform over the field', value: e.trophy.uniform },
                ]}
              />
              <p className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {e.trophyN} tournaments
              </p>
            </div>
          ) : null}

          <DocsLink
            className="mt-4"
            doc="scoring"
            hash="the-floors"
            label="What each floor is"
          />
        </Panel>

        {/* ---- calibration, as a picture ---------------------------------- */}
        {e.tieBands.length ? (
          <Panel
            title="Does 70% mean 70%"
            description="The claim this project cares about most. A calibrated band has its two bars the same length."
          >
            <CalibrationBars className="mt-4" bands={e.tieBands} />
            {e.matchEce != null ? (
              <p className="mt-4 border-t border-[var(--border-color)] pt-3 text-[12px] text-[var(--text-secondary)]">
                On match forecasts the same check gives a calibration error of{' '}
                <span className="font-mono tabular-nums text-[var(--text-primary)]">
                  {e.matchEce.toFixed(4)}
                </span>{' '}
                over {e.matchN?.toLocaleString()} matches.
              </p>
            ) : null}
            <DocsLink className="mt-3" doc="scoring" hash="calibration" label="Why calibration, not accuracy" />
          </Panel>
        ) : null}

        {/* ---- the two records -------------------------------------------- */}
        <Panel
          title="Two records, never added together"
          description="One is retrospective and large. The other is what this site published before kickoff, scored afterwards."
        >
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <StatTile
              label="Backtest"
              value={e.matchN ? e.matchN.toLocaleString() : '—'}
              sub="matches, refit as the corpus advanced"
            />
            <StatTile
              label="Published live"
              value={(e.liveN ?? 0).toLocaleString()}
              tone={e.liveN ? undefined : 'muted'}
              sub="forecasts scored after the result"
            />
          </dl>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <DocsLink doc="evaluation" label="Why they stay apart" />
            <Link
              href="/evaluation"
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--accent-primary)] hover:underline"
            >
              See both, per competition
            </Link>
          </div>
        </Panel>

        {/* ---- what it is not --------------------------------------------- */}
        <Panel title="What this is not">
          <div className="mt-2.5 flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-warn)]"
              aria-hidden="true"
            />
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
              Not a betting product. The bookmaker&apos;s price is a yardstick here, not a
              target: measured across every bucket where this model disagrees with the
              closing line, backing it loses money — and loses more the more confident it
              is. That measurement is published rather than buried.
            </p>
          </div>
        </Panel>

        {/* ---- the handbook ------------------------------------------------ */}
        <Panel
          title="Documentation"
          description="Tutorials, the concepts in full, and a reference for the API, the artifacts and the commands."
        >
          <div className="mt-3.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {READ_NEXT.map((doc) => (
              <DocRow key={doc} doc={doc} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border-color)] pt-3.5">
            {REFERENCE.map((doc) => (
              <DocsLink key={doc} doc={doc} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border-color)] pt-3.5">
            <DocsLink doc="handbook" label="Handbook index" />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--accent-primary)] hover:underline"
            >
              Source code
            </a>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function DocRow({ doc }: { doc: DocKey }) {
  const entry = DOCS[doc]
  return (
    <a
      href={docsUrl(doc)}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-baseline gap-2"
    >
      <ArrowRight
        className="h-3 w-3 shrink-0 translate-y-[2px] text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">
          {entry.title}
        </span>
        <span className="block text-[11.5px] leading-snug text-[var(--text-tertiary)]">
          {entry.blurb}
        </span>
      </span>
    </a>
  )
}
