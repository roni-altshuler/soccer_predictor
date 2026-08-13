import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TournamentsPage from '@/app/(app)/tournaments/page'

/**
 * Smoke tests for the tournament page.
 *
 * Two things are worth guarding beyond "it mounts":
 *
 *  1. The framing survives. The whole reason this page is separate from
 *     /accuracy is that a knockout tie has two outcomes and a league match has
 *     three, so a 64.8% here is not a better version of the 52.3% there. If
 *     that sentence ever gets edited away, the page starts overstating itself
 *     and nothing else would catch it.
 *  2. A missing artifact renders an honest empty state rather than crashing or
 *     — worse — rendering an empty table that reads as "no tournaments were
 *     predicted correctly".
 */

function mockFetch(record: unknown, predictions: unknown = { available: false }) {
  // Must resolve a Promise: the page calls fetch(...).then(...), so returning
  // the response object directly leaves `.then` undefined and every test fails
  // at render rather than at the assertion.
  global.fetch = jest.fn().mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () => (String(url).includes('predictions') ? predictions : record),
    }),
  ) as unknown as typeof fetch
}

/**
 * The artifact carries one entry per EDITION, not per competition — the last
 * eight of each. A fixture with one entry per competition is what let the page
 * ship broken: the real file has six rows reading "UEFA Champions League",
 * every one of them carrying the same `competition_id`, and the old picker put
 * all seventy-nine into a single flat listbox. So the shape is reproduced here
 * — multiple editions per competition, `is_current` marking which one to open
 * on, and a `bracket` on every entry.
 */
const tie = (over: Record<string, unknown>) => ({
  score: null,
  winner: null,
  winner_id: null,
  p_team_a: null,
  two_legged: false,
  pending: false,
  slot: null,
  ...over,
})

const FORECASTS = {
  available: true,
  tournaments: [
    {
      competition_id: 'conmebol.libertadores',
      name: 'Copa Libertadores',
      region: 'South America',
      season: 2026,
      is_current: true,
      status: 'upcoming',
      field: 16,
      current_round: 'round-of-16',
      draw_known_to: 'round-of-16',
      forecast_from: '2026-08-11',
      bracket: [
        {
          // An entry round: it feeds the bracket without being part of it, so
          // it carries no slots and is listed rather than drawn.
          slug: 'firststage',
          label: 'round-of-6',
          display: 'First stage',
          slots: 0,
          projected: false,
          ties: [
            tie({
              team_a: 'Cerro Porteño',
              team_b: 'Nacional',
              team_a_id: 20,
              team_b_id: 21,
              score: '3-1',
              winner: 'Cerro Porteño',
              winner_id: 20,
              kickoff: '2026-02-11',
              two_legged: true,
            }),
          ],
        },
        {
          slug: 'roundof16',
          label: 'round-of-16',
          display: 'Round of 16',
          slots: 2,
          projected: false,
          ties: [
            tie({
              team_a: 'Cruzeiro',
              team_b: 'Flamengo',
              team_a_id: 8,
              team_b_id: 9,
              p_team_a: 0.239,
              kickoff: '2026-08-13',
              two_legged: true,
              pending: true,
              slot: 0,
            }),
          ],
        },
        {
          // Not drawn yet — the rounds above a live frontier are still part of
          // the bracket, as empty boxes.
          slug: 'projected-1',
          label: 'final',
          display: 'Final',
          slots: 1,
          projected: true,
          ties: [],
        },
      ],
      odds: [
        { team_id: 9, team: 'Flamengo', probability: 0.234, elo: 1905 },
        { team_id: 10, team: 'Palmeiras', probability: 0.18, elo: 1888 },
      ],
    },
    {
      competition_id: 'conmebol.libertadores',
      name: 'Copa Libertadores',
      region: 'South America',
      season: 2025,
      is_current: false,
      status: 'completed',
      field: 16,
      forecast_made_at_round: 'round-of-16',
      forecast_from: '2025-08-12',
      bracket: [
        {
          slug: 'final',
          label: 'final',
          display: 'Final',
          slots: 1,
          projected: false,
          ties: [
            tie({
              slot: 0,
              team_a: 'Botafogo',
              team_b: 'Peñarol',
              team_a_id: 30,
              team_b_id: 31,
              score: '2-0',
              winner: 'Botafogo',
              winner_id: 30,
              kickoff: '2025-11-29',
            }),
          ],
        },
      ],
      odds: [{ team_id: 30, team: 'Botafogo', probability: 0.21, elo: 1890 }],
      actual_champion: 'Botafogo',
      actual_champion_id: 30,
      probability_on_actual: 0.21,
      called_it: true,
    },
    {
      competition_id: 'uefa.champions',
      name: 'UEFA Champions League',
      region: 'Europe',
      season: 2025,
      is_current: true,
      status: 'completed',
      field: 16,
      forecast_made_at_round: 'round-of-16',
      forecast_from: '2026-03-04',
      bracket: [
        {
          slug: 'final',
          label: 'final',
          display: 'Final',
          slots: 1,
          projected: false,
          ties: [
            tie({
              slot: 0,
              team_a: 'Arsenal',
              team_b: 'Bayern Munich',
              team_a_id: 2,
              team_b_id: 1,
              score: '1-1 (4-2 pens)',
              winner: 'Arsenal',
              winner_id: 2,
              kickoff: '2026-05-30',
            }),
          ],
        },
      ],
      odds: [
        { team_id: 1, team: 'Bayern Munich', probability: 0.229, elo: 1900 },
        { team_id: 2, team: 'Arsenal', probability: 0.15, elo: 1870 },
      ],
      actual_champion: 'Arsenal',
      actual_champion_id: 2,
      probability_on_actual: 0.15,
      called_it: false,
      next_fixture: { season: 2026, starts: '2026-09-16', fixtures: 36 },
    },
    {
      // Finished years ago, every tie played — but the rounds could not be
      // paired into a tree, so there is no forecast. NOT the same thing as a
      // draw that has not been made.
      competition_id: 'uefa.champions',
      name: 'UEFA Champions League',
      region: 'Europe',
      season: 2020,
      is_current: false,
      status: 'not_reconstructed',
      reason:
        'the bracket could not be paired into a tree, so no forecast was made for this edition',
      bracket: [
        {
          slug: 'final',
          label: 'final',
          display: 'Final',
          slots: 1,
          projected: false,
          ties: [
            tie({
              slot: 0,
              team_a: 'Manchester City',
              team_b: 'Chelsea',
              team_a_id: 2001,
              team_b_id: 2002,
              score: '0-1',
              winner: 'Chelsea',
              winner_id: 2002,
              kickoff: '2021-05-29',
            }),
          ],
        },
      ],
      power_ranking: [{ team_id: 2002, team: 'Chelsea', elo: 1901 }],
    },
    {
      competition_id: 'fifa.cwc',
      name: 'FIFA Club World Cup',
      region: 'World',
      season: 2025,
      is_current: true,
      status: 'awaiting_draw',
      reason: 'the round-of-16 has 6 ties, which is not a whole round',
      bracket: [],
      power_ranking: [{ team_id: 11, team: 'Real Madrid', elo: 1912 }],
    },
  ],
}

const ARTIFACT = {
  available: true,
  ties: {
    n_ties_scored: 2110,
    test_seasons: [2013, 2026],
    ladder: [
      { key: 'coin_flip', label: 'Coin flip', accuracy: 0.5, brier: 0.25 },
      { key: 'higher_elo', label: 'Higher-rated side advances', accuracy: 0.6412, brier: 0.2387 },
      { key: 'model', label: 'This model (random_forest)', accuracy: 0.6479, brier: 0.2179 },
    ],
    calibration: [
      { stated_low: 70, stated_high: 80, n: 408, observed: 0.743, mean_stated: 0.743 },
    ],
    by_round: { final: { correct: 79, n: 120, accuracy: 0.6583 } },
    best_model: 'random_forest',
    method: {
      competitions: new Array(14).fill('x'),
      progression_check: { checked: 2412, confirmed: 2403, rate: 0.9963 },
    },
  },
  brackets: {
    summary: {
      n_tournaments: 84,
      log_loss: { model: 1.9672, elo_simulation: 2.1454, uniform: 2.5498 },
      top1_hit_rate: { model: 0.321, highest_rated: 0.214 },
      top3_hit_rate: { model: 0.631 },
    },
    events: [
      {
        competition: 'fifa.world',
        season: 2022,
        field: 16,
        model_p: 0.155,
        elo_p: 0.12,
        uniform_p: 0.062,
        model_top1_hit: 0,
        elo_leader_hit: 0,
        model_top3_hit: 1,
      },
    ],
  },
}

afterEach(() => {
  jest.resetAllMocks()
})

/**
 * Choose a tournament from the picker.
 *
 * It was a row of chips and is now the same listbox the league picker uses —
 * nine competitions permanently on screen was the thing to fix.
 */
async function chooseTournament(name: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: /change tournament/i }))
  await userEvent.click(
    within(screen.getByRole('listbox')).getByRole('option', { name }),
  )
}

describe('TournamentsPage', () => {
  it('renders the ladder and the bracket record', async () => {
    mockFetch(ARTIFACT)
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText(/Who advances/i)).toBeInTheDocument())
    expect(screen.getByText(/Who lifts the trophy/i)).toBeInTheDocument()
    expect(screen.getByText('32.1%')).toBeInTheDocument()
    expect(screen.getByText(/84 tournaments simulated/i)).toBeInTheDocument()
  })

  it('keeps the two-outcome framing that stops the numbers being misread', async () => {
    mockFetch(ARTIFACT)
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText(/Who advances/i)).toBeInTheDocument())
    // The claim: knockout is binary, league play is not, so these numbers are
    // not the 1X2 numbers improved.
    expect(screen.getByText(/a knockout\s+tie has two/i)).toBeInTheDocument()
    expect(screen.getByText(/not the 1X2 numbers made bigger/i)).toBeInTheDocument()
  })

  it('prices the undecided ties of a tournament still being played', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    // A page of finished tournaments is a record; the undecided one is the
    // forecast. Ordering by status is what makes it the first thing seen.
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Copa Libertadores/i)
    expect(screen.getByRole('heading', { name: /Copa Libertadores/i })).toBeInTheDocument()
    expect(screen.getByText('Cruzeiro')).toBeInTheDocument()
    expect(screen.getByText('23.4%')).toBeInTheDocument()
  })

  // ------------------------------------------------------------ the bracket
  //
  // The artifact grew a full bracket per edition and the page rendered none of
  // it. A reader saw that Bayern were favourites and never saw who they had to
  // beat to get there — and a stack of round lists cannot say who could still
  // meet whom, which is the one thing a bracket is for.

  it('draws both halves of the draw meeting once', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Copa Libertadores/i)

    // Round of 16 down each side, the final once in the middle. A round that
    // appeared once, or a final that appeared twice, would not be a bracket.
    const columns = screen
      .getAllByText(/./, { selector: 'div.truncate.font-mono' })
      .map((n) => n.textContent)
    expect(columns).toEqual(['Round of 16', 'Final', 'Not drawn', 'Round of 16'])
  })

  it('shows a round nobody has drawn yet as empty boxes', async () => {
    // The quarter-finals of a live tournament are part of the bracket and have
    // no ties in them. Empty boxes are the true statement; omitting the round
    // would draw a bracket that stops halfway.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Copa Libertadores/i)

    expect(screen.getByText('Not drawn')).toBeInTheDocument()
  })

  it('lists an entry round instead of drawing it into the bracket', async () => {
    // The Libertadores group stages feed the round of 16 without halving into
    // it. Forcing them onto the board doubles its width and misaligns every
    // pairing above them.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Copa Libertadores/i)

    expect(screen.getByText(/Getting there/i)).toBeInTheDocument()
    expect(screen.getByText('First stage')).toBeInTheDocument()
    expect(screen.getByText('Cerro Porteño')).toBeInTheDocument()
    expect(screen.getByText('3-1')).toBeInTheDocument()
  })

  it('shows a shootout as well as the aggregate, not instead of it', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())

    // 1-1 alone reads as a drawn tie with a team advancing for no stated
    // reason, which is what the scoreline looked like before the shootout was
    // appended to it.
    expect(screen.getByText('1-1 (4-2 pens)')).toBeInTheDocument()
  })

  // ----------------------------------------------------- the season explorer

  it('opens on the current edition and walks back through earlier ones', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Copa Libertadores/i)

    const seasons = screen.getByRole('group', { name: /season/i })
    expect(within(seasons).getByRole('button', { name: /2026/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // The 2025 edition is a different tournament with a different winner, and
    // selecting it must actually change the panel — the old picker matched on
    // competition_id alone, so every edition of a competition resolved to the
    // same one.
    await userEvent.click(within(seasons).getByRole('button', { name: /2025/ }))
    expect(screen.getByRole('heading', { name: /Copa Libertadores 2025/i })).toBeInTheDocument()
    expect(screen.getByText('Peñarol')).toBeInTheDocument()
    expect(screen.getByText('2-0')).toBeInTheDocument()
  })

  it('lands on the current edition when the competition changes, not last pick', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())

    const seasons = () => screen.getByRole('group', { name: /season/i })
    await userEvent.click(within(seasons()).getByRole('button', { name: /2025/ }))
    await chooseTournament(/Champions League/i)

    // 2025 happens to exist in both competitions, so a stale season would look
    // like it worked. What must be true is that the CURRENT edition is chosen.
    expect(
      within(seasons()).getByRole('button', { name: /2025/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Next up: 36 fixtures/i)).toBeInTheDocument()
  })

  it('never calls a finished edition undrawn', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Champions League/i)
    await userEvent.click(
      within(screen.getByRole('group', { name: /season/i })).getByRole('button', {
        name: /2020/,
      }),
    )

    // This edition is over — Chelsea won it on 2021-05-29 and the bracket
    // prints the final. It has no forecast because its rounds could not be
    // paired into a tree, which is a different fact from "the draw has not
    // been made", and the page used to state the wrong one of the two.
    expect(screen.getByText(/This edition is finished/i)).toBeInTheDocument()
    expect(screen.getByText('0-1')).toBeInTheDocument()
    expect(screen.queryByText(/Draw not made/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/has not been drawn/i)).not.toBeInTheDocument()
  })

  it('states the open-draw assumption behind the title odds', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    // Only the round of 16 is drawn. Every later round is paired at random,
    // and that assumption changes the numbers, so it is on the page.
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Copa Libertadores/i)
    expect(screen.getByText(/paired by a fresh random draw/i)).toBeInTheDocument()
  })

  it('shows a finished tournament as a record, with the result', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Champions League/i)

    // The call made BEFORE the knockout stage, next to who actually won —
    // never presented as though it were still open.
    expect(screen.getByText(/What it said beforehand/i)).toBeInTheDocument()
    expect(screen.getByText(/before any of it was played/i)).toBeInTheDocument()
    expect(screen.getByText('won it')).toBeInTheDocument()
    expect(screen.getByText(/Next up: 36 fixtures of the 2026 edition/i)).toBeInTheDocument()
  })

  it('refuses to print odds for a tournament that has not been drawn', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
    await chooseTournament(/Club World Cup/i)

    // A power ranking, explicitly not a forecast. Filling this state with last
    // edition's field would produce confident percentages backed by nothing.
    expect(screen.getByText(/no title odds to give/i)).toBeInTheDocument()
    expect(screen.getByText(/power\s+ranking, not a forecast/i)).toBeInTheDocument()
    expect(screen.getByText('Real Madrid')).toBeInTheDocument()
  })

  it('shows an honest empty state when the benchmarks have not been run', async () => {
    mockFetch({ available: false, reason: 'not run' })
    render(<TournamentsPage />)

    await waitFor(() =>
      expect(screen.getByText(/have not been run here/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Who lifts the trophy/i)).not.toBeInTheDocument()
  })

  // ------------------------------------------------------------- the picker
  //
  // Nine tournaments as chips filled two lines on a phone with eight
  // competitions the reader is not looking at. It is now the same listbox as
  // /season. What must survive the change: a tournament's STATE has to be
  // visible before you pick it, because it decides whether the numbers
  // underneath are odds on something undecided or a record of a settled call.

  it('shows every tournament with its state, before one is chosen', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /change tournament/i }))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    const text = options.map((o) => o.textContent ?? '')
    expect(text.some((t) => /Champions League/.test(t))).toBe(true)
    expect(text.some((t) => /Finished/.test(t))).toBe(true)
    expect(text.some((t) => /Draw not made/.test(t))).toBe(true)
  })

  it('offers the biggest competitions first, whatever is live', async () => {
    // This used to sort live-first, which reads well in the abstract and badly
    // across a calendar: some minor competition is nearly always mid-flight,
    // so the Champions League spent most of the year below it. A reader came
    // for a competition, not for whichever one happens to be playing — the
    // live ones are still marked with a dot.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /change tournament/i }))
    const names = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '')
    expect(names[0]).toMatch(/Champions League/)
    expect(names.findIndex((n) => /Champions League/.test(n))).toBeLessThan(
      names.findIndex((n) => /Libertadores/.test(n)),
    )
  })

  it('opens on the most important competition rather than a minor live one', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())

    expect(
      screen.getByRole('heading', { name: /UEFA Champions League/i }),
    ).toBeInTheDocument()
  })

  it('switches tournament from the keyboard alone', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())

    const trigger = screen.getByRole('button', { name: /change tournament/i })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
