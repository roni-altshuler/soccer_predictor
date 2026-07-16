/**
 * Pitchverse viz kit (Matchday v3.1) — production-grade chart and data-display
 * components ported from the motorsportverse F1 project and retokenized to
 * `var(--*)`. New chart surfaces compose these instead of hand-rolling
 * recharts/divs. All components are pure-props (no fetching).
 */
export { ChartContainer } from './ChartContainer'
export { OutcomeBars, type OutcomeBarDatum } from './OutcomeBars'
export { ScorelineHeatmap, type ScorelineCell } from './ScorelineHeatmap'
export { ProgressionChart, type ProgressionSeries } from './ProgressionChart'
export { FactorMeters, type FactorMeterDatum } from './FactorMeters'
export { H2HMatrix, type H2HEntity } from './H2HMatrix'
export { NarrativeCard, type NarrativeInsight, type NarrativeTone } from './NarrativeCard'
export { FeaturedMatchCarousel, type FeaturedMatch } from './FeaturedMatchCarousel'
export { FormTrend } from './FormTrend'
