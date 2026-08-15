import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'

import { AIPredictionTab } from '@/components/match/AIPredictionTab'

/**
 * The prediction tab asks for the prediction.
 *
 * Opening the tab IS the request — there is nothing to decide first, so a
 * button that only means "yes, the thing you just clicked" is a gate rather
 * than a choice. The other two match cards on this site show the model's
 * answer the moment they render, and this one now matches them.
 *
 * What must survive removing the click is the CAVEAT it used to carry. A
 * number computed on demand is not the recorded pre-match pick, and for a
 * match already played it is not a forecast at all. These tests exist mostly
 * to stop that label being dropped along with the button.
 */

jest.mock('next/navigation', () => ({ useParams: () => ({ id: '740936' }) }))
jest.mock('@/hooks/useGenderQuery', () => ({ useGenderQuery: () => ({ asQueryParam: 'M' }) }))
jest.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as never}</div> }),
}))
jest.mock('@/components/prediction/PredictionResult', () => ({
  PredictionResult: ({ prediction }: { prediction: { home_team: string } }) => (
    <div data-testid="viz">{prediction.home_team}</div>
  ),
}))

const CTX = { home_team: 'Arsenal', away_team: 'Fulham', league: 'eng.1' }

const LEGACY = {
  success: true,
  predictions: { home_win: 0.62, draw: 0.22, away_win: 0.16 },
  home_team: 'Arsenal',
  away_team: 'Fulham',
  confidence: 62,
  predicted_home_goals: 2.1,
  predicted_away_goals: 0.9,
}

const answer = (body: unknown = LEGACY, ok = true) => {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch
}

afterEach(() => jest.resetAllMocks())

describe('AIPredictionTab', () => {
  it('fetches the prediction on mount, with nothing to click', async () => {
    answer()
    render(<AIPredictionTab prediction={null} matchState="finished" retrospectiveContext={CTX} />)
    await waitFor(() => expect(screen.getByTestId('viz')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /run/i })).not.toBeInTheDocument()
  })

  it('holds the space while it waits rather than offering a button', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch
    render(<AIPredictionTab prediction={null} matchState="upcoming" retrospectiveContext={CTX} />)
    expect(document.querySelector('[data-prediction="loading"]')).toBeTruthy()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says a number run after the final whistle is not a forecast', async () => {
    // The whole project rests on this distinction. Removing the click must
    // not remove the caveat the click used to carry.
    answer()
    render(<AIPredictionTab prediction={null} matchState="finished" retrospectiveContext={CTX} />)
    await waitFor(() => expect(screen.getByTestId('viz')).toBeInTheDocument())
    const note = document.querySelector('[data-provenance="retrospective"]')
    expect(note).toBeTruthy()
    expect(note!.textContent).toMatch(/not.*a forecast/i)
    expect(note!.textContent).toMatch(/never for scoring/i)
  })

  it('calls an upcoming fixture a real forecast, just not the recorded one', async () => {
    // Softening both cases into one label would either overstate a past-match
    // number or libel a perfectly good pre-match one.
    answer()
    render(<AIPredictionTab prediction={null} matchState="upcoming" retrospectiveContext={CTX} />)
    await waitFor(() => expect(screen.getByTestId('viz')).toBeInTheDocument())
    const note = document.querySelector('[data-provenance="on-demand"]')
    expect(note).toBeTruthy()
    expect(note!.textContent).toMatch(/real pre-match forecast/i)
    expect(document.querySelector('[data-provenance="retrospective"]')).toBeNull()
  })

  it('leaves the recorded pick unlabelled, because it is the real one', async () => {
    answer()
    render(
      <AIPredictionTab
        prediction={{ home_team: 'Arsenal' } as never}
        matchState="upcoming"
        retrospectiveContext={CTX}
      />,
    )
    expect(screen.getByTestId('viz')).toBeInTheDocument()
    expect(document.querySelector('[data-provenance]')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('offers a retry only once the request has actually failed', async () => {
    answer({ error: 'upstream exploded' }, false)
    render(<AIPredictionTab prediction={null} matchState="live" retrospectiveContext={CTX} />)
    await waitFor(() => expect(screen.getByText(/upstream exploded/i)).toBeInTheDocument())
    const retry = screen.getByRole('button', { name: /try again/i })

    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => LEGACY })
    await userEvent.click(retry)
    await waitFor(() => expect(screen.getByTestId('viz')).toBeInTheDocument())
  })

  it('survives a re-render with a fresh context object', async () => {
    // The parent builds `retrospectiveContext` inline, so it is a new object
    // on every render. Depending on it would refire the fetch each time.
    answer()
    const { rerender } = render(
      <AIPredictionTab prediction={null} matchState="upcoming" retrospectiveContext={{ ...CTX }} />,
    )
    await waitFor(() => expect(screen.getByTestId('viz')).toBeInTheDocument())
    rerender(
      <AIPredictionTab prediction={null} matchState="upcoming" retrospectiveContext={{ ...CTX }} />,
    )
    rerender(
      <AIPredictionTab prediction={null} matchState="upcoming" retrospectiveContext={{ ...CTX }} />,
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('asks once under StrictMode, which mounts effects twice', async () => {
    // This is what the `started` ref is actually for, and a plain re-render
    // does not reach it: StrictMode runs the effect, tears it down and runs it
    // again on the same instance. Without the guard that is two POSTs for one
    // fixture on every dev page load.
    answer()
    render(
      <StrictMode>
        <AIPredictionTab prediction={null} matchState="upcoming" retrospectiveContext={CTX} />
      </StrictMode>,
    )
    await waitFor(() => expect(screen.getByTestId('viz')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
