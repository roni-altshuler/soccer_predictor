import Link from 'next/link'
import {
  ArrowUpRight,
  BarChart3,
  Radio,
  Sparkles,
  Target,
  Trophy,
  Users,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Section, SectionHeader } from './primitives/Section'
import { Reveal, RevealGroup, RevealItem } from './primitives/Reveal'

type Feature = {
  Icon: typeof Radio
  title: string
  body: string
  href: string
  cta: string
  /** Tailwind col/row span classes for the bento layout (desktop). */
  span: string
  accent: 'ai' | 'primary'
}

const FEATURES: Feature[] = [
  {
    Icon: Sparkles,
    title: 'AI predictions, not guesses',
    body: 'Run any fixture through the unified model: home/draw/away probabilities, expected goals, the most-likely scoreline, and a confidence the model is willing to be measured against.',
    href: '/predict',
    cta: 'Run a prediction',
    span: 'lg:col-span-2 lg:row-span-2',
    accent: 'ai',
  },
  {
    Icon: Radio,
    title: 'Live scores, 3× daily',
    body: 'Every major league, refreshed automatically — with honest data-source badges and never a fabricated row.',
    href: '/',
    cta: 'Open Match Centre',
    span: 'lg:col-span-1',
    accent: 'primary',
  },
  {
    Icon: BarChart3,
    title: 'Accuracy you can audit',
    body: 'Public Brier score, calibration curve, and confusion matrix — the running win rate against a 33% baseline.',
    href: '/accuracy',
    cta: 'See accuracy',
    span: 'lg:col-span-1',
    accent: 'primary',
  },
  {
    Icon: Trophy,
    title: 'Monte Carlo simulator',
    body: 'Simulate a full season and watch a single what-if result reshape the title race, the top four, and the drop zone.',
    href: '/simulator',
    cta: 'Try the simulator',
    span: 'lg:col-span-1',
    accent: 'ai',
  },
  {
    Icon: Users,
    title: "Women's & men's, first-class",
    body: 'A dedicated women’s model — not an afterthought. Toggle universes anywhere; accuracy is tracked separately for each.',
    href: '/',
    cta: 'Explore both',
    span: 'lg:col-span-1',
    accent: 'primary',
  },
  {
    Icon: Target,
    title: 'Every pick, logged forever',
    body: 'No retroactive cherry-picking. Filter by correct, incorrect, or pending — and export the whole history to CSV.',
    href: '/history',
    cta: 'See the record',
    span: 'lg:col-span-1',
    accent: 'ai',
  },
]

function FeatureCard({ feature }: { feature: Feature }) {
  const { Icon, title, body, href, cta, span, accent } = feature
  const accentVar = accent === 'ai' ? 'var(--accent-ai)' : 'var(--accent-primary)'
  return (
    <RevealItem className={cn('h-full', span)}>
      <Link
        href={href}
        className={cn(
          'bento-card group flex h-full flex-col justify-between p-6',
          accent === 'ai' && 'bento-ai',
        )}
      >
        <div>
          <span
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: `color-mix(in srgb, ${accentVar} 14%, transparent)`, color: accentVar }}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-lg font-bold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
        </div>
        <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: accentVar }}>
          {cta}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
        </span>
      </Link>
    </RevealItem>
  )
}

export function FeatureBento() {
  return (
    <Section id="features" labelledBy="features-heading">
      <Reveal>
        <SectionHeader
          eyebrow="The product"
          titleId="features-heading"
          title={
            <>
              One model. <span className="mkt-headline-gradient">Six ways</span> to use it.
            </>
          }
          lede="The same unified prediction engine powers every surface — from a single fixture to a full-season simulation. No outcome is sold to you; everything is measured."
        />
      </Reveal>

      <RevealGroup className="mt-14 grid auto-rows-[minmax(13rem,auto)] grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} feature={feature} />
        ))}
      </RevealGroup>
    </Section>
  )
}
