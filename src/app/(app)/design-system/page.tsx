import type { Metadata } from 'next'
import { CircleDot, Trophy, Activity, Brain, Target, TrendingUp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  BorderBeam,
  MagicCard,
  BentoGrid,
  BentoCard,
  NumberTicker,
  ShimmerButton,
  AnimatedGradientText,
  PulsatingButton,
  DotPattern,
} from '@/components/magicui'
import { ConfidencePill, LiveBadge, PlayerAvatar, TeamBadge } from '@/components/primitives'
import {
  ChartContainer,
  FactorMeters,
  FeaturedMatchCarousel,
  FormTrend,
  H2HMatrix,
  NarrativeCard,
  OutcomeBars,
  ProgressionChart,
  ScorelineHeatmap,
  type FeaturedMatch,
  type ScorelineCell,
} from '@/components/viz'
import { AnimatedNumber, ClubColorBar } from '@/components/motion'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Design System',
  description: 'Internal gallery of Pitchverse primitives, tokens, typography, and animations.',
  robots: { index: false, follow: false },
}

const SURFACE_TOKENS = [
  '--background',
  '--background-secondary',
  '--background-tertiary',
  '--card-bg',
  '--card-hover',
  '--input-bg',
  '--muted-bg',
  '--nav-bg',
  '--overlay-bg',
  '--pitch-bg',
] as const

const TEXT_TOKENS = ['--text-primary', '--text-secondary', '--text-tertiary', '--accent-on-primary'] as const

const ACCENT_TOKENS = [
  '--accent-primary',
  '--accent-primary-soft',
  '--accent-ai',
  '--accent-ai-soft',
  '--accent-warn',
  '--accent-warn-soft',
  '--accent-loss',
  '--accent-loss-soft',
] as const

const STATE_TOKENS = ['--live-bg', '--live-border', '--live-text', '--meta-chip-bg'] as const

const REDESIGN_TOKENS = [
  '--accent-pitch-line',
  '--accent-pitch-line-strong',
  '--rating-bg-high',
  '--rating-bg-mid',
  '--rating-bg-low',
  '--team-tint-home',
  '--team-tint-away',
  '--headshot-ring',
] as const

const SPACING_STEPS = [
  { name: 'gap-1', px: 4 },
  { name: 'gap-2', px: 8 },
  { name: 'gap-3', px: 12 },
  { name: 'gap-4', px: 16 },
  { name: 'gap-6', px: 24 },
  { name: 'gap-8', px: 32 },
]

const TYPE_SAMPLES: Array<{ tier: string; classes: string; sample: string }> = [
  { tier: 'display', classes: 'text-display', sample: 'Predicted scoreline' },
  { tier: 'h1', classes: 'text-h1', sample: 'Today’s matches' },
  { tier: 'h2', classes: 'text-h2', sample: 'Premier League · Matchweek 38' },
  { tier: 'h3', classes: 'text-h3', sample: 'AI Confidence' },
  { tier: 'h4', classes: 'text-h4', sample: 'Recent form' },
  { tier: 'body', classes: 'text-body', sample: 'Our model leans Liverpool but the confidence is modest.' },
  { tier: 'meta (NEW)', classes: 'text-meta text-[var(--text-secondary)]', sample: 'Anfield · 19:30 · Referee A. Taylor' },
  { tier: 'small', classes: 'text-small text-[var(--text-secondary)]', sample: 'Updated 4 minutes ago.' },
  { tier: 'caption (chip-only)', classes: 'text-caption uppercase tracking-[0.06em] text-[var(--text-tertiary)]', sample: 'live · 67′' },
  { tier: 'numeric (NEW)', classes: 'text-h1 font-numeric tabular-nums', sample: '2 – 1' },
]

/* ---------------------------------------------------------------- */
/* Viz kit (v3.1) sample data — Arsenal v Liverpool, realistic shapes */
/* ---------------------------------------------------------------- */

const ARSENAL_CREST = 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png'
const LIVERPOOL_CREST = 'https://a.espncdn.com/i/teamlogos/soccer/500/364.png'
const ARSENAL_RED = '#EF0107'
const LIVERPOOL_RED = '#C8102E'

const OUTCOME_SAMPLE = [
  {
    label: 'Arsenal',
    probability: 0.47,
    rawProbability: 0.52,
    color: ARSENAL_RED,
    crestUrl: ARSENAL_CREST,
    sublabel: 'Home',
  },
  { label: 'Draw', probability: 0.27, rawProbability: 0.24, color: 'var(--accent-warn)' },
  {
    label: 'Liverpool',
    probability: 0.26,
    rawProbability: 0.24,
    color: LIVERPOOL_RED,
    crestUrl: LIVERPOOL_CREST,
    sublabel: 'Away',
  },
]

function poisson(lambda: number, k: number): number {
  let fact = 1
  for (let i = 2; i <= k; i++) fact *= i
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact
}

/** Independent-Poisson scoreline grid (λ home 1.8, away 1.1) — demo only. */
function buildScorelineSample(): ScorelineCell[] {
  const cells: ScorelineCell[] = []
  for (let home = 0; home <= 5; home++) {
    for (let away = 0; away <= 5; away++) {
      cells.push({ home, away, probability: poisson(1.8, home) * poisson(1.1, away) })
    }
  }
  return cells
}

const SCORELINE_SAMPLE = buildScorelineSample()

/** Cumulative points through MD24 from deterministic W/D/L strings. */
function cumulativePoints(results: string): number[] {
  const out: number[] = []
  let total = 0
  for (const r of results) {
    total += r === 'W' ? 3 : r === 'D' ? 1 : 0
    out.push(total)
  }
  return out
}

const PROGRESSION_SAMPLE = [
  {
    key: 'ars',
    label: 'Arsenal',
    color: ARSENAL_RED,
    values: cumulativePoints('WWDWWLWWWDWWDWLWWWWDWWWW'),
  },
  {
    key: 'liv',
    label: 'Liverpool',
    color: LIVERPOOL_RED,
    values: cumulativePoints('WDWWWWDLWWWDWWWWDWLWWDWW'),
  },
]

const FACTOR_SAMPLE = [
  {
    label: 'Home form',
    value: 0.82,
    tone: 'advantage' as const,
    detail: '13 points from the last five at the Emirates.',
  },
  {
    label: 'Attacking output',
    value: 0.64,
    tone: 'advantage' as const,
    detail: 'xG 2.1 per match over the last month.',
  },
  {
    label: 'Injury list',
    value: 0.48,
    tone: 'risk' as const,
    detail: 'First-choice centre-back doubtful after international duty.',
  },
  {
    label: 'Congested schedule',
    value: 0.3,
    tone: 'risk' as const,
    detail: 'Third match in eight days.',
  },
]

const H2H_ENTITIES = [
  { id: 'ars', label: 'Arsenal', crestUrl: ARSENAL_CREST },
  { id: 'liv', label: 'Liverpool', crestUrl: LIVERPOOL_CREST },
  { id: 'mci', label: 'Manchester City', crestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/382.png' },
  { id: 'che', label: 'Chelsea', crestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png' },
]

const H2H_MATRIX: Array<Array<number | null>> = [
  [null, 0.55, 0.48, 0.62],
  [0.45, null, 0.44, 0.58],
  [0.52, 0.56, null, 0.65],
  [0.38, 0.42, 0.35, null],
]

const NARRATIVE_SAMPLE = [
  {
    tone: 'edge' as const,
    title: 'Set-piece threat',
    detail: 'Arsenal have scored from a corner in six of the last eight home matches.',
  },
  {
    tone: 'risk' as const,
    title: 'Counter-attack exposure',
    detail: 'Liverpool average 3.4 shots per match from fast breaks, the most in the league.',
  },
  {
    tone: 'watch' as const,
    title: 'Referee profile',
    detail: 'Saturday referee averages 4.8 cards per match this season.',
  },
  {
    tone: 'note' as const,
    title: 'Head to head',
    detail: 'Three of the last four league meetings here finished level.',
  },
]

const CAROUSEL_SAMPLE: FeaturedMatch[] = [
  {
    id: 'ars-liv',
    homeTeam: 'Arsenal',
    awayTeam: 'Liverpool',
    homeCrestUrl: ARSENAL_CREST,
    awayCrestUrl: LIVERPOOL_CREST,
    homeColor: ARSENAL_RED,
    awayColor: LIVERPOOL_RED,
    league: 'Premier League · Matchweek 24',
    kickoff: 'Sat 17:30',
    status: 'live',
    statusDetail: "74'",
    aiPick: 'AI 2-1',
    href: '#viz-kit',
  },
  {
    id: 'mci-che',
    homeTeam: 'Man City',
    awayTeam: 'Chelsea',
    homeCrestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/382.png',
    awayCrestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png',
    homeColor: '#6CABDD',
    awayColor: '#034694',
    league: 'Premier League · Matchweek 24',
    kickoff: 'Sun 16:30',
    status: 'upcoming',
    aiPick: 'AI 1X',
    href: '#viz-kit',
  },
  {
    id: 'tot-mun',
    homeTeam: 'Tottenham',
    awayTeam: 'Man Utd',
    homeCrestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/367.png',
    awayCrestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/360.png',
    homeColor: '#132257',
    awayColor: '#DA291C',
    league: 'Premier League · Matchweek 24',
    kickoff: 'Sun 14:00',
    status: 'ft',
    statusDetail: '2 – 2',
    href: '#viz-kit',
  },
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-h2 mb-6 text-[var(--text-primary)]">{title}</h2>
      {children}
    </section>
  )
}

function TokenSwatch({ token }: { token: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-3">
      <span
        className="h-10 w-10 shrink-0 rounded-md border border-[var(--border-color)]"
        style={{ background: `var(${token})` }}
        aria-hidden
      />
      <code className="text-meta font-mono text-[var(--text-secondary)]">{token}</code>
    </div>
  )
}

function TokenGrid({ tokens }: { tokens: readonly string[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tokens.map((t) => (
        <TokenSwatch key={t} token={t} />
      ))}
    </div>
  )
}

function Subhead({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{children}</h3>
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:py-14">
      <header className="mb-12">
        <p className="text-caption uppercase tracking-[0.1em] text-[var(--accent-ai)]">internal · sitemap-noindex</p>
        <h1 className="text-display mt-2 text-[var(--text-primary)]">Design system</h1>
        <p className="mt-3 max-w-2xl text-body text-[var(--text-secondary)]">
          Living gallery of every token, primitive, and animation that ships with Pitchverse&apos;s
          UI. Add a primitive here when you add one to the codebase; remove the entry
          when you delete it. See <code className="text-meta font-mono">docs/design-tokens.md</code> for the
          full token reference.
        </p>
      </header>

      <div className="space-y-16">
        <Section id="tokens" title="Color tokens">
          <Subhead>Surfaces</Subhead>
          <TokenGrid tokens={SURFACE_TOKENS} />
          <div className="mt-8" />
          <Subhead>Text</Subhead>
          <TokenGrid tokens={TEXT_TOKENS} />
          <div className="mt-8" />
          <Subhead>Brand accents</Subhead>
          <TokenGrid tokens={ACCENT_TOKENS} />
          <div className="mt-8" />
          <Subhead>State surfaces</Subhead>
          <TokenGrid tokens={STATE_TOKENS} />
          <div className="mt-8" />
          <Subhead>Redesign deltas (Phase 0.A)</Subhead>
          <TokenGrid tokens={REDESIGN_TOKENS} />
        </Section>

        <Section id="typography" title="Typography">
          <p className="mb-4 text-meta text-[var(--text-secondary)]">
            Inter for everything except scoreboard digits. JetBrains Mono (via next/font) drives the new
            <code className="ml-1 font-mono">font-numeric</code> family. <code className="font-mono">caption</code> (11px
            uppercase) is reserved for chip labels only — never body copy. Use <code className="font-mono">meta</code>
            (13px non-uppercase) for dates / venues / sources.
          </p>
          <div className="divide-y divide-[var(--border-color)] rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            {TYPE_SAMPLES.map((row) => (
              <div key={row.tier} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between">
                <code className="w-48 shrink-0 text-meta font-mono text-[var(--text-tertiary)]">{row.tier}</code>
                <span className={cn('flex-1 text-[var(--text-primary)]', row.classes)}>{row.sample}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="spacing" title="Spacing rhythm">
          <p className="mb-4 text-meta text-[var(--text-secondary)]">
            Allowed gap/padding sizes. Avoid odd intermediates (gap-5, gap-7, gap-10) in new code.
          </p>
          <div className="flex flex-wrap items-end gap-6">
            {SPACING_STEPS.map((step) => (
              <div key={step.name} className="flex flex-col items-center gap-2">
                <span
                  className="block rounded bg-[var(--accent-primary)]"
                  style={{ width: step.px * 4, height: step.px }}
                  aria-hidden
                />
                <code className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {step.name} · {step.px}px
                </code>
              </div>
            ))}
          </div>
        </Section>

        <Section id="shadcn" title="Shadcn primitives">
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="ai">AI</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="loss">Loss</Badge>
              <Badge variant="warn">Warn</Badge>
            </div>
            <Card className="max-w-md p-5">
              <h4 className="text-h4 text-[var(--text-primary)]">Card primitive</h4>
              <p className="mt-2 text-meta text-[var(--text-secondary)]">
                Used everywhere a surface needs subtle elevation. Reads tokens for bg + border, no hardcoded colors.
              </p>
            </Card>
          </div>
        </Section>

        <Section id="magicui" title="Magic-ui showcase">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="relative h-44 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
              <p className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">BorderBeam</p>
              <p className="mt-2 text-h3 text-[var(--text-primary)]">Live match accent</p>
              <p className="mt-1 text-meta text-[var(--text-secondary)]">Wraps StickyScoreBar in-play.</p>
              <BorderBeam size={80} duration={6} colorFrom="var(--accent-primary)" colorTo="var(--accent-ai)" />
            </div>

            <MagicCard className="h-44 p-5">
              <p className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">MagicCard</p>
              <p className="mt-2 text-h3 text-[var(--text-primary)]">Spotlight surface</p>
              <p className="mt-1 text-meta text-[var(--text-secondary)]">Hero, predict, AI panels.</p>
            </MagicCard>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
              <p className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">NumberTicker</p>
              <p className="mt-2 text-display font-numeric tabular-nums text-[var(--accent-primary)]">
                <NumberTicker value={246} />
              </p>
              <p className="mt-1 text-meta text-[var(--text-secondary)]">Animated scoreline / stat reveal.</p>
            </div>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
              <p className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">AnimatedGradientText</p>
              <AnimatedGradientText className="mt-2 text-h2">AI-powered predictions</AnimatedGradientText>
              <p className="mt-1 text-meta text-[var(--text-secondary)]">Tagline + hero accents.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
              <p className="w-full text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Buttons</p>
              <ShimmerButton>View today&apos;s picks</ShimmerButton>
              <PulsatingButton>Live now</PulsatingButton>
            </div>

            <div className="relative h-44 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
              <p className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">DotPattern</p>
              <p className="mt-2 text-h3 text-[var(--text-primary)]">Background motif</p>
              <p className="mt-1 text-meta text-[var(--text-secondary)]">Replaces emoji watermarks.</p>
              <DotPattern className="opacity-50 [mask-image:radial-gradient(ellipse_at_center,white,transparent_75%)]" />
            </div>
          </div>

          <div className="mt-6">
            <Subhead>BentoGrid</Subhead>
            <BentoGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <BentoCard
                name="Today's top pick"
                description="Manchester City to win at home"
                Icon={Trophy}
                href="#"
                cta="View"
                className="col-span-1 row-span-1"
                background={<DotPattern className="opacity-50 [mask-image:radial-gradient(circle_at_top_right,white,transparent)]" />}
              />
              <BentoCard
                name="Model accuracy"
                description="61.2% across 11,661 matches"
                Icon={Brain}
                href="#"
                cta="See breakdown"
                className="col-span-1 row-span-1"
                background={<DotPattern className="opacity-50 [mask-image:radial-gradient(circle_at_top_right,white,transparent)]" />}
              />
              <BentoCard
                name="Biggest upset call"
                description="Brentford 2-1 Liverpool · 14% prior"
                Icon={TrendingUp}
                href="#"
                cta="Read more"
                className="col-span-1 row-span-1"
                background={<DotPattern className="opacity-50 [mask-image:radial-gradient(circle_at_top_right,white,transparent)]" />}
              />
            </BentoGrid>
          </div>
        </Section>

        <Section id="primitives" title="App primitives">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="space-y-4 p-5">
              <Subhead>TeamBadge</Subhead>
              <div className="flex items-center gap-4">
                <TeamBadge name="Manchester City" teamColor="#6cabdd" size={48} />
                <TeamBadge name="Liverpool" teamColor="#c8102e" size={48} />
                <TeamBadge name="Arsenal" teamColor="#ef0107" size={32} />
                <TeamBadge name="Tottenham" size={32} />
              </div>
              <p className="text-meta text-[var(--text-secondary)]">
                Resolves crest via manifest; falls back to monogram chip tinted with the team brand colour.
              </p>
            </Card>

            <Card className="space-y-4 p-5">
              <Subhead>PlayerAvatar</Subhead>
              <div className="flex items-center gap-4">
                <PlayerAvatar name="Erling Haaland" size={48} teamColor="#6cabdd" />
                <PlayerAvatar name="Bukayo Saka" size={48} teamColor="#ef0107" />
                <PlayerAvatar name="Mohamed Salah" size={32} teamColor="#c8102e" />
                <PlayerAvatar name="Bruno Fernandes" size={32} />
              </div>
              <p className="text-meta text-[var(--text-secondary)]">
                Resolves headshot via manifest; falls back to initials with a 2px ring tinted to the player&apos;s team.
              </p>
            </Card>

            <Card className="space-y-4 p-5">
              <Subhead>ConfidencePill</Subhead>
              <div className="flex flex-wrap items-center gap-3">
                <ConfidencePill value={0.84} />
                <ConfidencePill value={0.62} />
                <ConfidencePill value={0.38} />
                <ConfidencePill value={0.84} compact />
              </div>
              <p className="text-meta text-[var(--text-secondary)]">
                Three-stop scale (high / mid / low) reads from `--rating-bg-*` tokens added in Phase 0.A.
              </p>
            </Card>

            <Card className="space-y-4 p-5">
              <Subhead>LiveBadge</Subhead>
              <div className="flex flex-wrap items-center gap-3">
                <LiveBadge minute={67} />
                <LiveBadge minute={45} />
                <LiveBadge minute={90} compact />
              </div>
              <p className="text-meta text-[var(--text-secondary)]">
                Reads `--live-bg / --live-border / --live-text`. Pulses via `animate-live-pulse`.
              </p>
            </Card>
          </div>
        </Section>

        <Section id="phase-0a-specimens" title="Phase 0.A token specimens">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="overflow-hidden p-0">
              <Subhead>
                <span className="block px-5 pt-5">Pitch surface + lines</span>
              </Subhead>
              <div
                className="relative h-40 w-full"
                style={{
                  background: 'var(--pitch-bg)',
                  borderTop: '1px solid var(--border-color)',
                  borderBottom: '1px solid var(--border-color)',
                }}
                aria-hidden
              >
                {/* Halfway line */}
                <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: 'var(--accent-pitch-line-strong)' }} />
                {/* Centre circle */}
                <div
                  className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ border: '1px solid var(--accent-pitch-line-strong)' }}
                />
                {/* Penalty arcs (simplified) */}
                <div
                  className="absolute inset-y-0 left-0 w-12 border-r"
                  style={{ borderColor: 'var(--accent-pitch-line)' }}
                />
                <div
                  className="absolute inset-y-0 right-0 w-12 border-l"
                  style={{ borderColor: 'var(--accent-pitch-line)' }}
                />
              </div>
              <p className="px-5 py-3 text-meta text-[var(--text-secondary)]">
                `--accent-pitch-line` (0.18α) for soft markings, `--accent-pitch-line-strong` (0.32α) for centre circle &amp; halfway line.
              </p>
            </Card>

            <Card className="space-y-4 p-5">
              <Subhead>Team tints</Subhead>
              <div className="space-y-3">
                <div
                  className="flex items-center justify-between rounded-lg border-l-4 bg-[var(--card-hover)] px-4 py-3"
                  style={{ borderLeftColor: 'var(--team-tint-home)', '--team-tint-home': '#6cabdd' } as React.CSSProperties}
                >
                  <span className="text-body text-[var(--text-primary)]">Manchester City</span>
                  <span className="text-meta text-[var(--text-tertiary)]">home tint</span>
                </div>
                <div
                  className="flex items-center justify-between rounded-lg border-l-4 bg-[var(--card-hover)] px-4 py-3"
                  style={{ borderLeftColor: 'var(--team-tint-away)', '--team-tint-away': '#ef0107' } as React.CSSProperties}
                >
                  <span className="text-body text-[var(--text-primary)]">Liverpool</span>
                  <span className="text-meta text-[var(--text-tertiary)]">away tint</span>
                </div>
              </div>
              <p className="text-meta text-[var(--text-secondary)]">
                Per-match colours are written inline: <code className="font-mono">style={'{{ \'--team-tint-home\': brand }}'}</code>.
              </p>
            </Card>

            <Card className="space-y-4 p-5">
              <Subhead>Rating tiers</Subhead>
              <div className="flex flex-wrap gap-3">
                <span className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-meta font-semibold text-[var(--accent-primary)]" style={{ background: 'var(--rating-bg-high)' }}>9.2 high</span>
                <span className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-meta font-semibold text-[var(--accent-warn)]" style={{ background: 'var(--rating-bg-mid)' }}>6.4 mid</span>
                <span className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-meta font-semibold text-[var(--text-secondary)]" style={{ background: 'var(--rating-bg-low)' }}>3.1 low</span>
              </div>
              <p className="text-meta text-[var(--text-secondary)]">
                Backs the FormationDisplay v2 player ratings (Phase 2.C).
              </p>
            </Card>

            <Card className="space-y-4 p-5">
              <Subhead>Meta chips + scoreboard glow</Subhead>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1 text-meta text-[var(--text-secondary)]" style={{ background: 'var(--meta-chip-bg)' }}>
                  <Target className="h-3.5 w-3.5" aria-hidden /> Anfield
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1 text-meta text-[var(--text-secondary)]" style={{ background: 'var(--meta-chip-bg)' }}>
                  <Activity className="h-3.5 w-3.5" aria-hidden /> 41,841 attendance
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1 text-meta text-[var(--text-secondary)]" style={{ background: 'var(--meta-chip-bg)' }}>
                  <CircleDot className="h-3.5 w-3.5" aria-hidden /> Ref A. Taylor
                </span>
              </div>
              <p
                className="text-display font-numeric tabular-nums text-[var(--text-primary)]"
                style={{ textShadow: 'var(--score-numeric-shadow)' }}
              >
                2 – 1
              </p>
              <p className="text-meta text-[var(--text-secondary)]">
                Meta chips read `--meta-chip-bg`. Scoreboard glow comes from `--score-numeric-shadow` (dark mode only).
              </p>
            </Card>
          </div>
        </Section>

        <Section id="viz-kit" title="Viz kit (v3.1)">
          <p className="mb-6 max-w-2xl text-meta text-[var(--text-secondary)]">
            Production-grade data-viz and motion components ported from the motorsportverse F1
            project and retokenized to Matchday v3.1 (<code className="font-mono">var(--*)</code> only,
            flat hairline cards, reduced-motion safe). Lives in{' '}
            <code className="font-mono">src/components/viz</code> and{' '}
            <code className="font-mono">src/components/motion</code>. New chart surfaces compose
            these instead of hand-rolling recharts.
          </p>

          <div className="mb-6">
            <Subhead>FeaturedMatchCarousel — club-colour duotone fixture cards</Subhead>
            <FeaturedMatchCarousel matches={CAROUSEL_SAMPLE} />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-5">
              <Subhead>OutcomeBars — 1X2 probabilities</Subhead>
              <OutcomeBars data={OUTCOME_SAMPLE} sorted={false} />
              <p className="mt-2 text-meta text-[var(--text-secondary)]">
                Club-coloured horizontal bars; hover for the raw → calibrated pair.
              </p>
            </Card>

            <Card className="p-5">
              <Subhead>ScorelineHeatmap — inside ChartContainer (lazy)</Subhead>
              <ChartContainer height={300} label="Loading scoreline heatmap">
                <ScorelineHeatmap cells={SCORELINE_SAMPLE} predicted={{ home: 2, away: 1 }} />
              </ChartContainer>
              <p className="mt-2 text-meta text-[var(--text-secondary)]">
                Cyan `--accent-ai` tint by probability; the predicted 2–1 cell is outlined.
              </p>
            </Card>

            <Card className="p-5 md:col-span-2">
              <Subhead>ProgressionChart — cumulative points + projection</Subhead>
              <ProgressionChart series={PROGRESSION_SAMPLE} now={24} totalSteps={38} height={300} />
            </Card>

            <Card className="p-5">
              <Subhead>FactorMeters — why the model leans home</Subhead>
              <FactorMeters factors={FACTOR_SAMPLE} />
            </Card>

            <Card className="p-5">
              <Subhead>H2HMatrix — row beats column</Subhead>
              <H2HMatrix entities={H2H_ENTITIES} matrix={H2H_MATRIX} />
            </Card>

            <NarrativeCard heading="Match angles" insights={NARRATIVE_SAMPLE} />

            <Card className="space-y-5 p-5">
              <div>
                <Subhead>FormTrend — last 5 vs season average</Subhead>
                <div className="space-y-4">
                  <FormTrend label="xG per match" baseline={1.42} recent={1.95} decimals={2} />
                  <FormTrend
                    label="Goals conceded"
                    baseline={1.1}
                    recent={0.6}
                    higherIsBetter={false}
                    decimals={1}
                  />
                </div>
              </div>
              <div>
                <Subhead>AnimatedNumber + ClubColorBar</Subhead>
                <div className="flex items-center gap-3">
                  <ClubColorBar color={ARSENAL_RED} team="Arsenal" size="lg" animate="draw" />
                  <p className="text-display text-[var(--text-primary)]">
                    <AnimatedNumber value={61.2} decimals={1} suffix="%" />
                  </p>
                  <ClubColorBar color={LIVERPOOL_RED} team="Liverpool" size="lg" animate="draw" />
                </div>
                <p className="mt-2 text-meta text-[var(--text-secondary)]">
                  Count-up in tabular numerals; instant under reduced motion. Bars are the flat
                  club-colour identity slivers.
                </p>
              </div>
            </Card>
          </div>
        </Section>
      </div>
    </main>
  )
}
