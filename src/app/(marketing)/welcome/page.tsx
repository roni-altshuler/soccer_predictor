import type { Metadata } from 'next'

import { MarketingHero } from '@/components/marketing/MarketingHero'
import { CoverageMarquee } from '@/components/marketing/CoverageMarquee'
import { HowItWorks } from '@/components/marketing/HowItWorks'
import { FeatureBento } from '@/components/marketing/FeatureBento'
import { TechnicalCredibility } from '@/components/marketing/TechnicalCredibility'
import { TrustStrip } from '@/components/marketing/TrustStrip'
import { FinalCTA } from '@/components/marketing/FinalCTA'
import { Section, SectionHeader } from '@/components/marketing/primitives/Section'
import { Reveal } from '@/components/marketing/primitives/Reveal'
import {
  CalibrationShowcaseLazy,
  PredictionDemoLazy,
  SimulatorDemoLazy,
} from '@/components/marketing/LazyDemos'

export const metadata: Metadata = {
  title: 'Pitchwise — Football predictions you can verify',
  description:
    'Calibrated football intelligence: live scores, AI predictions that publish their confidence, and accuracy you can audit — for the men\'s and women\'s game.',
  alternates: { canonical: '/welcome' },
  openGraph: {
    title: 'Pitchwise — Football predictions you can verify',
    description:
      'Live scores, calibrated AI match probabilities, and accuracy you can audit. Every major league, men\'s and women\'s.',
    url: '/welcome',
  },
}

export default function WelcomePage() {
  return (
    <>
      <MarketingHero />

      <CoverageMarquee />

      <HowItWorks />

      <FeatureBento />

      {/* Live prediction demo */}
      <Section id="prediction-demo" labelledBy="prediction-demo-heading" className="bg-[var(--background-secondary)]">
        <Reveal>
          <SectionHeader
            eyebrow="Try it live"
            titleId="prediction-demo-heading"
            title={
              <>
                Run a real fixture through the{' '}
                <span className="mkt-headline-gradient">AI</span>.
              </>
            }
            lede="This isn't a mockup. Pick a fixture and the prediction is computed by the live backend — outcome probabilities, expected goals, the most-likely scoreline, and the factors behind it."
          />
        </Reveal>
        <Reveal delay={0.08} className="mt-12">
          <PredictionDemoLazy />
        </Reveal>
      </Section>

      {/* Simulator teaser */}
      <Section labelledBy="simulator-demo-heading">
        <Reveal>
          <SectionHeader
            eyebrow="Season simulator"
            titleId="simulator-demo-heading"
            title={
              <>
                Every result has <span className="mkt-headline-gradient">ripples</span>.
              </>
            }
            lede="The simulator runs thousands of seasons so you can see how one fixture reshapes the title race. Toggle a what-if below for a taste."
          />
        </Reveal>
        <Reveal delay={0.08} className="mt-12">
          <SimulatorDemoLazy />
        </Reveal>
      </Section>

      {/* Calibration showcase */}
      <Section id="calibration" labelledBy="calibration-heading" className="bg-[var(--background-secondary)]">
        <Reveal>
          <SectionHeader
            eyebrow="The number that matters"
            titleId="calibration-heading"
            title="Calibration, not just accuracy"
            align="center"
          />
        </Reveal>
        <Reveal delay={0.08} className="mt-12">
          <CalibrationShowcaseLazy />
        </Reveal>
      </Section>

      <TechnicalCredibility />

      <TrustStrip />

      <FinalCTA />
    </>
  )
}
