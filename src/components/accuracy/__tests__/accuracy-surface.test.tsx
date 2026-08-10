import { render, screen } from '@testing-library/react'

import { AccuracyHeadline } from '../AccuracyHeadline'
import { AccuracyKpiStrip } from '../AccuracyKpiStrip'
import { ConfidenceTiers } from '../ConfidenceTiers'
import { OutcomeBreakdown } from '../OutcomeBreakdown'
import { ReliabilityPanel } from '../ReliabilityPanel'
import {
  BRIER_SUMMED_FROM_MEAN,
  EVEN_ODDS_PROBABILITY_SCORE,
  MIN_BIN_SAMPLE,
  ALWAYS_HOME_RATE,
  RANDOM_WINNER_RATE,
  calibrationVerdict,
  samplePhrase,
  signedPts,
} from '../accuracyMetrics'
import type { CalibrationDotPoint } from '@/lib/types/accuracy'

/**
 * These tests pin the honesty rules, not the styling. Every case here maps
 * to something the previous surface got wrong: a wrong baseline constant,
 * a verdict drawn from a six-pick sample, a 0% bar built from one match.
 */

function bin(lower: number, count: number, actual: number): CalibrationDotPoint {
  return {
    bin_lower: lower,
    bin_upper: lower + 0.1,
    avg_predicted: lower + 0.05,
    avg_actual: actual,
    count,
  }
}

describe('accuracyMetrics', () => {
  it('derives the even-odds probability score as exactly 2/3 (summed Brier)', () => {
    // Standard multiclass Brier: squared error SUMMED over the three outcomes
    // for a (1/3, 1/3, 1/3) forecast. This is the convention used by the market
    // benchmark, penaltyblog, and every number in the docs — including the
    // .5666 closing-line target — so the whole surface must speak it.
    const p = 1 / 3
    const expected = (p - 0) ** 2 + (p - 0) ** 2 + (p - 1) ** 2
    expect(EVEN_ODDS_PROBABILITY_SCORE).toBeCloseTo(expected, 12)
    expect(EVEN_ODDS_PROBABILITY_SCORE).toBeCloseTo(0.6667, 4)
  })

  it('scales the route\'s mean-form Brier onto the summed convention', () => {
    // The tracking route still divides by 3. Display code must scale, or a
    // score gets printed ~3x better than the yardstick beside it.
    expect(BRIER_SUMMED_FROM_MEAN * (2 / 9)).toBeCloseTo(EVEN_ODDS_PROBABILITY_SCORE, 12)
  })

  it('uses one in three as the uninformed winner rate', () => {
    expect(RANDOM_WINNER_RATE).toBeCloseTo(0.3333, 4)
  })

  it('reports against the home-team floor, not a random pick', () => {
    // The page compared its hit rate to 1/3 for months. Nobody picks at
    // random; the home side wins ~43% of the time and picking it needs no
    // model, so that is the floor a reader should judge against. Using 1/3
    // overstates the margin by ten points.
    expect(ALWAYS_HOME_RATE).toBeCloseTo(0.43, 2)
    expect(ALWAYS_HOME_RATE).toBeGreaterThan(RANDOM_WINNER_RATE)
  })

  it('formats signed point differences with an explicit sign', () => {
    expect(signedPts(10.34)).toBe('+10.3 pts')
    expect(signedPts(-5.8)).toBe('−5.8 pts')
  })

  it('pluralises sample phrases', () => {
    expect(samplePhrase(1)).toBe('1 settled pick')
    expect(samplePhrase(1429)).toBe('1,429 settled picks')
  })

  it('withholds a calibration verdict below the minimum sample', () => {
    expect(calibrationVerdict(0.03, 4)).toBeNull()
    expect(calibrationVerdict(0.03, 500)).toEqual({
      label: expect.any(String),
      tone: 'good',
    })
  })
})

describe('AccuracyHeadline', () => {
  const base = {
    accuracy: 0.436,
    settled: 1429,
    pending: 31,
    recentForm: ['W', 'L', 'W'],
    gender: 'men' as const,
  }

  it('shows the rate, its sample and the margin over the home-team floor', () => {
    render(<AccuracyHeadline {...base} />)
    expect(screen.getByText('43.6%')).toBeInTheDocument()
    expect(screen.getByText('1,429 settled picks')).toBeInTheDocument()
    // 43.6% - 43.0% = 0.6 points. This assertion used to read +10.3, because
    // the margin was taken against a random one-in-three pick — a comparison
    // nobody makes, worth ten free points to every number on the page.
    expect(screen.getByText('+0.6 pts')).toBeInTheDocument()
    expect(screen.queryByText('+10.3 pts')).not.toBeInTheDocument()
  })

  it('marks the yardstick as the home-team floor rather than a random pick', () => {
    render(<AccuracyHeadline {...base} />)
    expect(screen.getByText(/always picking the home team/i)).toBeInTheDocument()
    expect(screen.queryByText(/made at random/i)).not.toBeInTheDocument()
  })

  it('flags a small sample as provisional', () => {
    render(<AccuracyHeadline {...base} accuracy={0.483} settled={29} pending={5} gender="women" />)
    expect(screen.getByText(/treat this rate and every breakdown below as provisional/i))
      .toBeInTheDocument()
  })

  it('does not flag a large sample', () => {
    render(<AccuracyHeadline {...base} />)
    expect(screen.queryByText(/provisional/i)).not.toBeInTheDocument()
  })
})

describe('AccuracyKpiStrip', () => {
  it('states the even-odds reference beside the probability score', () => {
    render(
      <AccuracyKpiStrip
        settled={1429}
        probabilityScore={0.21}
        calibrationGap={0.039}
        recentAccuracy={0.5}
        recentWindow={50}
      />
    )
    // The route emits mean-form Brier (0.21); the strip displays the summed
    // convention (0.630) against a 0.667 yardstick, matching the market panel.
    expect(screen.getByText('0.630')).toBeInTheDocument()
    expect(screen.getByText(/even odds scores 0\.667/i)).toBeInTheDocument()
    expect(screen.getByText('±3.9 pts')).toBeInTheDocument()
  })

  it('omits the trailing-window cell when it would restate the headline', () => {
    // 29 settled picks with a 50-pick window means the "last 50" cell is
    // the same number as the headline — the old strip showed both.
    render(
      <AccuracyKpiStrip
        settled={29}
        probabilityScore={0.216}
        calibrationGap={0.144}
        recentAccuracy={0.483}
        recentWindow={29}
      />
    )
    expect(screen.queryByText(/^Last /)).not.toBeInTheDocument()
  })

  it('drops cells whose data is missing rather than showing zero', () => {
    render(
      <AccuracyKpiStrip
        settled={12}
        probabilityScore={null}
        calibrationGap={null}
        recentAccuracy={0}
        recentWindow={0}
      />
    )
    expect(screen.queryByText(/probability score/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/calibration gap/i)).not.toBeInTheDocument()
  })
})

describe('ReliabilityPanel', () => {
  it('draws a read when at least one group has real evidence', () => {
    render(
      <ReliabilityPanel
        bins={[bin(0.4, 657, 0.5), bin(0.5, 183, 0.6), bin(0.8, 1, 0)]}
        gap={0.039}
        settled={1429}
      />
    )
    expect(screen.getByText(/percentages track reality closely/i)).toBeInTheDocument()
    expect(screen.getByText(/excluding 1 group too thin to read/i)).toBeInTheDocument()
  })

  it('refuses a verdict when every group is below the sample threshold', () => {
    render(
      <ReliabilityPanel
        bins={[bin(0.3, 11, 0.4), bin(0.4, 8, 0.5), bin(0.6, 5, 0.8)]}
        gap={0.144}
        settled={29}
      />
    )
    expect(screen.getByText(/not enough settled picks to judge this yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/percentages drift from reality/i)).not.toBeInTheDocument()
    // Stated twice on purpose — once in the read, once in the key.
    expect(
      screen.getAllByText(new RegExp(`fewer than ${MIN_BIN_SAMPLE} picks`, 'i')).length
    ).toBeGreaterThan(0)
  })

  it('renders an honest empty state with no bins', () => {
    render(<ReliabilityPanel bins={[]} gap={null} settled={0} />)
    expect(screen.getByText(/nothing to compare stated chances against/i)).toBeInTheDocument()
  })
})

describe('ConfidenceTiers', () => {
  it('withholds the stated-vs-delivered verdict on a thin tier', () => {
    // Six picks in the high tier: the old surface rendered "−32.3pts".
    render(<ConfidenceTiers bins={[bin(0.6, 6, 0.33)]} embedded />)
    expect(screen.getByText('too few')).toBeInTheDocument()
    expect(screen.queryByText(/pts$/)).not.toBeInTheDocument()
  })

  it('shows the verdict once the tier is big enough', () => {
    render(<ConfidenceTiers bins={[bin(0.6, 400, 0.7)]} embedded />)
    expect(screen.queryByText('too few')).not.toBeInTheDocument()
    expect(screen.getByText(/pts$/)).toBeInTheDocument()
  })
})

describe('OutcomeBreakdown', () => {
  it('shows counts but no rate for a pick type with too few picks', () => {
    render(
      <OutcomeBreakdown
        home={{ predicted: 908, correct: 472 }}
        draw={{ predicted: 1, correct: 0 }}
        away={{ predicted: 9, correct: 0 }}
        embedded
      />
    )
    // Home has a real sample and gets a rate.
    expect(screen.getByText('52%')).toBeInTheDocument()
    // Draw (1 pick) and away (9 picks) show counts only — no 0% bar.
    expect(screen.getAllByText(/too few/)).toHaveLength(2)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })
})
