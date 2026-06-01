import { ArrowRight, Sparkles } from 'lucide-react'

import { BorderBeam } from '@/components/magicui/border-beam'
import { DotPattern } from '@/components/magicui/dot-pattern'
import { Section } from './primitives/Section'
import { Reveal } from './primitives/Reveal'
import { CtaButton } from './primitives/CtaButton'

export function FinalCTA() {
  return (
    <Section labelledBy="final-cta-heading" className="pb-24">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[2rem] border border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-16 text-center md:px-12 md:py-20">
          <BorderBeam size={1} duration={16} borderRadius={32} colorFrom="var(--accent-primary)" colorTo="var(--accent-ai)" />
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_srgb,var(--accent-primary)_18%,transparent),transparent_65%),radial-gradient(50%_50%_at_50%_120%,color-mix(in_srgb,var(--accent-ai)_16%,transparent),transparent_60%)]"
          />
          <DotPattern
            width={24}
            height={24}
            className="[mask-image:radial-gradient(60%_50%_at_50%_50%,white,transparent)] text-[var(--accent-ai)]/25"
          />

          <span className="relative inline-flex items-center gap-2 rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Free · No account required
          </span>

          <h2
            id="final-cta-heading"
            className="relative mx-auto mt-5 max-w-2xl font-display text-[clamp(1.9rem,4.5vw,3.25rem)] font-extrabold leading-[1.05] tracking-tight text-[var(--text-primary)]"
          >
            See the next match through a{' '}
            <span className="mkt-headline-gradient">calibrated lens</span>.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
            Open the Match Centre for today&apos;s fixtures, or run any matchup through the model
            right now. Every probability comes with the track record to back it up.
          </p>

          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
            <CtaButton href="/" variant="primary" size="lg">
              Open Match Centre
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </CtaButton>
            <CtaButton href="/predict" variant="secondary" size="lg">
              Run a prediction
            </CtaButton>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
