import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { DocsLink } from '@/components/evidence/DocsLink'
import { EvidenceHeader, Panel } from '@/components/evidence/primitives'
import { DOCS, REPO_URL, docsUrl, type DocKey } from '@/lib/docs'

/**
 * How it works — where the explaining happens.
 *
 * Every page of this site used to carry its own methodology paragraph: what a
 * walk-forward is, why a knockout tie is a different question from a match,
 * what Brier means, why the live sample is small. Each was reasonable alone.
 * Together they were the product — a reader who wanted the Champions League
 * bracket scrolled past an essay to reach it, and the same explanation existed
 * in four slightly different wordings because nothing made them one thing.
 *
 * They are one thing now. This page is the top of it: short, plain, and
 * organised by question, with every section handing off to the handbook in the
 * repository for the depth it deliberately does not carry. The pages carry the
 * numbers; this page carries the reasoning; the handbook carries the detail.
 */

export const metadata = {
  title: 'How it works · Pitchverse',
  description:
    'How Pitchverse forecasts matches, seasons and knockout tournaments — what each model is, what the numbers mean, and how the claims are checked.',
}

/** A question and its answer, with the document that carries the long version. */
function Section({
  title,
  doc,
  hash,
  docLabel,
  children,
}: {
  title: string
  doc: DocKey
  hash?: string
  docLabel?: string
  children: React.ReactNode
}) {
  return (
    <Panel title={title}>
      <div className="mt-2.5 space-y-2.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
      <DocsLink className="mt-3.5" doc={doc} hash={hash} label={docLabel} />
    </Panel>
  )
}

const READ_NEXT: Array<{ doc: DocKey }> = [
  { doc: 'tutorialMatch' },
  { doc: 'tutorialSeason' },
  { doc: 'tutorialBracket' },
  { doc: 'tutorialJudge' },
]

const REFERENCE: Array<{ doc: DocKey }> = [
  { doc: 'api' },
  { doc: 'artifacts' },
  { doc: 'cli' },
  { doc: 'glossary' },
]

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <EvidenceHeader
        title="How it works"
        lede="Pitchverse forecasts football matches, seasons and knockout tournaments, and publishes the record of how those forecasts have scored. This page is the short version of how."
      />

      <div className="mt-8 space-y-6">
        <Section title="What it does" doc="start">
          <p>Four things, and nothing else:</p>
          <ul className="space-y-1.5">
            <li>
              <span className="font-semibold text-[var(--text-primary)]">Match outcome</span> — who
              wins and the scoreline, from a Dixon-Coles goal model.
            </li>
            <li>
              <span className="font-semibold text-[var(--text-primary)]">Season shape</span> —
              title, relegation and the final table, from 20,000 simulations of the fixtures that
              remain.
            </li>
            <li>
              <span className="font-semibold text-[var(--text-primary)]">Tournaments</span> — who
              advances a knockout tie, and who lifts the trophy.
            </li>
            <li>
              <span className="font-semibold text-[var(--text-primary)]">The evidence</span> — all
              three measured against yardsticks anyone can check.
            </li>
          </ul>
        </Section>

        <Section title="Where to look" doc="start">
          <p>
            <Link
              href="/leagues"
              className="font-semibold text-[var(--accent-primary)] hover:underline"
            >
              Leagues
            </Link>{' '}
            and{' '}
            <Link
              href="/tournaments"
              className="font-semibold text-[var(--accent-primary)] hover:underline"
            >
              Tournaments
            </Link>{' '}
            are for the football: tables, fixtures, brackets, and what the model expects to happen
            next.
          </p>
          <p>
            <Link
              href="/evaluation"
              className="font-semibold text-[var(--accent-primary)] hover:underline"
            >
              Evaluation
            </Link>{' '}
            and{' '}
            <Link
              href="/accuracy"
              className="font-semibold text-[var(--accent-primary)] hover:underline"
            >
              Accuracy
            </Link>{' '}
            are for the model: what it believed in each competition, and how those beliefs scored.
            Neither of those questions belongs on the other&apos;s page.
          </p>
        </Section>

        <Section title="How the forecasts are made" doc="models">
          <p>
            Match forecasts come from a Dixon-Coles goal model fitted on years of results. The
            scoreline grid and the three outcome numbers are the same object — the publish aborts
            if they disagree.
          </p>
          <p>
            Knockout football is modelled separately, because it asks a different question. A
            league match has three outcomes and a quarter of them are draws; a tie has two, and
            extra time, penalties and away goals exist to guarantee it. That model is trained on
            every previous season across fourteen competitions and tested on the one being played.
          </p>
          <p>
            A neural network with 75 features was trained, measured, and{' '}
            <span className="text-[var(--text-primary)]">not promoted</span> — it did not beat
            Dixon-Coles by enough to survive a paired bootstrap.
          </p>
        </Section>

        <Section title="What the numbers mean" doc="scoring">
          <p>
            A probability is a claim that can be checked, and the check is calibration: when the
            model says 60%, those matches should happen about 60% of the time. That is the claim
            this project cares about most, and it is measured per band rather than asserted.
          </p>
          <p>
            Every rate is shown against a floor, because the gap to the floor is the information
            and the level is not. A blind three-way guess lands one in three; the bookmaker&apos;s
            closing line — the strongest public forecaster there is — reaches about 54%. On
            knockout ties the floor is a coin flip at 50%, and backing the better-rated side gets
            64% for free.
          </p>
          <p>
            Sample size is printed next to every rate. Below a minimum sample the site drops its
            verdict rather than its context, and a reliability chart is refused entirely below 200
            scored matches.
          </p>
        </Section>

        <Section title="How it is judged" doc="evaluation">
          <p>
            Two records are kept and never added together. The historical walk-forward refits the
            model as the corpus advances so no match is predicted by a model that has seen it —
            honest, large, and never public in advance. The live record is the last forecast
            published before each kickoff, scored after the result — small, sometimes zero, and
            the only one a reader could have acted on.
          </p>
          <p>
            Every forecast is written down before kickoff and never rewritten. Without that, a
            forecast that moved would quietly become the forecast we claim to have made.
          </p>
        </Section>

        <Section title="Where the data comes from" doc="data">
          <p>
            Results, fixtures and brackets come from ESPN; historical closing odds from
            football-data. Coverage gaps are left genuinely empty rather than filled with a
            plausible value — referees outside England, kickoff times before 2019, and weather for
            a third of the corpus are all missing, and are recorded as missing.
          </p>
        </Section>

        {/* The documentation, as a directory rather than a sentence. */}
        <Panel
          title="Documentation"
          description="The handbook lives in the repository: task-shaped tutorials, the concepts in full, and a reference for the API, the artifacts and the commands that produce them."
        >
          <ul className="mt-3.5 space-y-2.5">
            {READ_NEXT.map(({ doc }) => (
              <DocRow key={doc} doc={doc} />
            ))}
          </ul>
          <div className="mt-4 border-t border-[var(--border-color)] pt-3.5">
            <ul className="space-y-2.5">
              {REFERENCE.map(({ doc }) => (
                <DocRow key={doc} doc={doc} />
              ))}
            </ul>
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

        {/* Not a betting product. Stated once, where it belongs. */}
        <Panel title="What this is not">
          <div className="mt-2.5 flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-warn)]"
              aria-hidden="true"
            />
            <div className="space-y-2.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              <p>
                Not a betting product. The bookmaker&apos;s price is used here as a yardstick,
                because it is the hardest honest test available — not as a target to beat for
                profit.
              </p>
              <p>
                The repository carries the measurement that settles it: backing this model against
                the price loses money in every disagreement bucket, and loses more the more
                confident the model is. Football is unpredictable, and even a well-calibrated
                forecast is wrong constantly by design.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function DocRow({ doc }: { doc: DocKey }) {
  const entry = DOCS[doc]
  return (
    <li>
      <a
        href={docsUrl(doc)}
        target="_blank"
        rel="noopener noreferrer"
        className="group block"
      >
        <span className="text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">
          {entry.title}
        </span>
        <span className="block text-[12px] leading-snug text-[var(--text-tertiary)]">
          {entry.blurb}
        </span>
      </a>
    </li>
  )
}
