import { render, screen } from '@testing-library/react'
import { MarketBenchmarkPanel } from '@/components/accuracy/MarketBenchmarkPanel'

afterEach(() => jest.restoreAllMocks())
const metric = (n: number, brier: number | null) => ({ n, brier, log_loss: null, rps: null, accuracy: null })
function serve(n: number, metrics: object) {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ available: true, paired_benchmark: { overall: { n, metrics } } }) })
}
it('withholds a paired comparison for zero-count objects with null metrics', async () => {
  serve(0, { model: metric(0, null), market_shin: metric(0, null), baseline_base_rate: metric(0, null) })
  render(<MarketBenchmarkPanel />)
  expect(await screen.findByText(/No settled fixture yet/)).toBeVisible()
  expect(screen.queryByText(/available signal captured/)).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('NaN')
})
it('withholds mismatched paired sample counts', async () => {
  serve(2, { model: metric(2, .6), market_shin: metric(1, .5) })
  render(<MarketBenchmarkPanel />)
  expect(await screen.findByText(/No settled fixture yet/)).toBeVisible()
})
it('does not divide by a zero baseline-to-market distance', async () => {
  serve(2, { model: metric(2, .6), market_shin: metric(2, .5), baseline_base_rate: metric(2, .5) })
  render(<MarketBenchmarkPanel />)
  expect(await screen.findByText('Brier behind the close')).toBeVisible()
  expect(screen.queryByText(/available signal captured/)).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('NaN')
  expect(document.body).not.toHaveTextContent('Infinity')
})
