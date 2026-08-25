import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TournamentsPage from '@/app/(app)/tournaments/page'

/**
 * Smoke tests for the tournament page.
 *
 * This page is now only the football: pick an edition, read the bracket, read
 * the odds. The knockout backtest that used to sit underneath it — the ladder
 * against a coin flip, the calibration table, per-round accuracy, the
 * progression check — is on /evaluation, per competition.
 *
 * Three things are worth guarding beyond "it mounts":
 *
 *  1. The model's argument stays off this page. It came back once already, as
 *     "just one more panel", and the bracket ended up below the fold.
 *  2. The framing survives somewhere. A knockout tie has two outcomes and a
 *     league match has three, so a 64.8% here is not a better version of the
 *     52.3% on /accuracy. That now lives in the handbook, and
 *     `src/__tests__/lib/docs.test.ts` is what pins it.
 *  3. A missing artifact renders an honest empty state rather than crashing or
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

beforeEach(() => {
  // Opening a competition now writes `?competition=` into the URL (so the
  // browser's Back returns to the directory and a bracket can be linked).
  // jsdom keeps `location` across tests, so clear it or every test after the
  // first mounts on the previous test's competition.
  window.history.replaceState(null, '', '/tournaments')
})

afterEach(() => {
  jest.resetAllMocks()
})

/** One club's side of a tie, on the board — its name also appears in the odds. */
function bracketRow(club: string): HTMLElement {
  const row = document.querySelector(`[data-club="${club}"]`)
  if (!row) throw new Error(`no bracket row for ${club}`)
  return row as HTMLElement
}

/**
 * Open a competition from the directory — the page's front door.
 *
 * The page is two views now: every competition as a card, then one in full. A
 * dropdown showing one competition and hiding thirteen was a control, not a
 * home page.
 */
async function openCompetition(name: RegExp) {
  await waitFor(() => expect(screen.getByText(/Every competition/i)).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name }))
  await waitFor(() => expect(screen.getByText(/Pick a tournament/i)).toBeInTheDocument())
}

/**
 * Switch competition from inside the detail view, without going back.
 *
 * The same listbox the league picker uses — its whole keyboard contract is
 * hand-built, so it stays tested.
 */
async function chooseTournament(name: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: /change tournament/i }))
  await userEvent.click(
    within(screen.getByRole('listbox')).getByRole('option', { name }),
  )
}

describe('TournamentsPage', () => {
  it('keeps the model\'s own record off the football page', async () => {
    // Everything below was on this page and is now on /evaluation. A reader
    // who came to see who plays Real Madrid had to scroll a calibration table
    // to reach the next round.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    await openCompetition(/Copa Libertadores/i)
    expect(screen.queryByText(/Coin flip/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/What the confidence means/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Where it is strong/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Integrity check/i)).not.toBeInTheDocument()
    // The trophy ODDS for the selected edition stay — they are the forecast.
    // What left is the backtest of them across 85 past tournaments.
    expect(screen.queryByText(/tournaments simulated/i)).not.toBeInTheDocument()
  })

  it('sends a reader who wants the reasoning to the handbook', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText(/Every competition/i)).toBeInTheDocument())
    // In-app now — /docs renders the same handbook file that used to require
    // a trip to github.com.
    const link = screen.getByText(/How to read this/i).closest('a')
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/docs/tutorials/read-a-bracket'),
    )
  })

  it('prices the undecided ties of a tournament still being played', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    // A page of finished tournaments is a record; the undecided one is the
    // forecast. Ordering by status is what makes it the first thing seen.
    await openCompetition(/Copa Libertadores/i)
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
    await openCompetition(/Copa Libertadores/i)

    // Round of 16 down each side, the final once in the middle. A round that
    // appeared once, or a final that appeared twice, would not be a bracket.
    const columns = Array.from(document.querySelectorAll('[data-round]')).map((n) =>
      n.getAttribute('data-round'),
    )
    expect(columns).toEqual(['Round of 16', 'Final', 'Round of 16'])
  })

  it('shows a round nobody has drawn yet as empty boxes', async () => {
    // The quarter-finals of a live tournament are part of the bracket and have
    // no ties in them. Empty boxes are the true statement; omitting the round
    // would draw a bracket that stops halfway.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await openCompetition(/Copa Libertadores/i)

    expect(screen.getByText('Not drawn')).toBeInTheDocument()
  })

  it('lists an entry round instead of drawing it into the bracket', async () => {
    // The Libertadores group stages feed the round of 16 without halving into
    // it. Forcing them onto the board doubles its width and misaligns every
    // pairing above them.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await openCompetition(/Copa Libertadores/i)

    expect(screen.getByText(/Getting there/i)).toBeInTheDocument()
    expect(screen.getByText('First stage')).toBeInTheDocument()
    // The aggregate is split onto the two clubs it belongs to, the way a
    // scoreboard reads: Cerro Porteño 3, Nacional 1.
    expect(bracketRow('Cerro Porteño')).toHaveTextContent('3')
    expect(bracketRow('Nacional')).toHaveTextContent('1')
  })

  it('shows a shootout as well as the aggregate, not instead of it', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    // 1-1 alone reads as a drawn tie with a team advancing for no stated
    // reason. The two rows carry the aggregate; the shootout gets its own line
    // rather than being dropped as unparseable detail.
    await openCompetition(/Champions League/i)
    expect(screen.getByText(/4-2 pens/)).toBeInTheDocument()
    expect(bracketRow('Arsenal')).toHaveTextContent('1')
  })

  // ----------------------------------------------------- the season explorer

  it('opens on the current edition and walks back through earlier ones', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await openCompetition(/Copa Libertadores/i)

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
    expect(bracketRow('Botafogo')).toHaveTextContent('2')
    expect(bracketRow('Peñarol')).toHaveTextContent('0')
  })

  it('lands on the current edition when the competition changes, not last pick', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await openCompetition(/Copa Libertadores/i)

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
    await openCompetition(/Champions League/i)
    await userEvent.click(
      within(screen.getByRole('group', { name: /season/i })).getByRole('button', {
        name: /2020/,
      }),
    )

    // This edition is over — Chelsea won it on 2021-05-29 and the bracket
    // prints the final. It has no forecast because its rounds could not be
    // paired into a tree, which is a different fact from "the draw has not
    // been made", and the page used to state the wrong one of the two.
    expect(screen.getByText(/a result, not a call/i)).toBeInTheDocument()
    expect(bracketRow('Chelsea')).toHaveTextContent('1')
    expect(screen.queryByText(/Draw not made/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/has not been drawn/i)).not.toBeInTheDocument()
  })

  it('states the open-draw assumption behind the title odds', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    // Only the round of 16 is drawn. Every later round is paired at random,
    // and that assumption changes the numbers, so it is on the page.
    await openCompetition(/Copa Libertadores/i)
    expect(screen.getByText(/paired by a fresh random draw/i)).toBeInTheDocument()
  })

  it('shows a finished tournament as a record, with the result', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)

    await openCompetition(/Champions League/i)

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

    await openCompetition(/Club World Cup/i)

    // A power ranking, explicitly not a forecast. Filling this state with last
    // edition's field would produce confident percentages backed by nothing.
    expect(screen.getByText(/no path to the trophy to simulate/i)).toBeInTheDocument()
    expect(screen.getByText(/power\s+ranking, not a forecast/i)).toBeInTheDocument()
    expect(screen.getByText('Real Madrid')).toBeInTheDocument()
  })

  it('shows an honest empty state when no forecast has been generated', async () => {
    mockFetch({ available: false }, { available: false, tournaments: [] })
    render(<TournamentsPage />)

    await waitFor(() =>
      expect(
        screen.getByText(/No tournament forecast has been generated here/i),
      ).toBeInTheDocument(),
    )
    // An empty picker would read as "no tournament was predicted correctly".
    expect(screen.queryByText(/Pick a tournament/i)).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------- the directory
  //
  // The front door. What has to be true of it: every competition is visible
  // without opening anything, each one carries the STATE of its current
  // edition — which decides whether the numbers under it are odds on something
  // undecided or a record of a settled call — and the biggest competitions
  // lead.

  it('shows every competition with its state, before one is opened', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Every competition/i)).toBeInTheDocument())

    const cards = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(cards.some((t) => /Champions League/.test(t))).toBe(true)
    expect(cards.some((t) => /Copa Libertadores/.test(t))).toBe(true)
    expect(cards.some((t) => /Finished/.test(t))).toBe(true)
    expect(cards.some((t) => /Draw not made/.test(t))).toBe(true)
  })

  it('puts a live edition\'s title odds on its card', async () => {
    // A directory that only names competitions is a menu. The number that
    // makes a card worth reading is who is winning the thing.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Every competition/i)).toBeInTheDocument())

    const card = screen.getByRole('button', { name: /Copa Libertadores/i })
    expect(card).toHaveTextContent(/Who lifts it/i)
    expect(card).toHaveTextContent('Flamengo')
    expect(card).toHaveTextContent('23%')
  })

  it('says who won a finished edition, and what the model gave them', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Every competition/i)).toBeInTheDocument())

    const card = screen.getByRole('button', { name: /Champions League/i })
    expect(card).toHaveTextContent(/Won it/i)
    expect(card).toHaveTextContent('Arsenal')
    // 15% — and the model did NOT make them favourite, which the card says
    // rather than quietly implying the opposite.
    expect(card).toHaveTextContent('15%')
    expect(card).toHaveTextContent(/what the model gave them/i)
  })

  it('offers the biggest competitions first, whatever is live', async () => {
    // Sorting live-first reads well in the abstract and badly across a
    // calendar: some minor competition is nearly always mid-flight, so the
    // Champions League would spend most of the year below it. A reader came
    // for a competition, not for whichever one happens to be playing — the
    // live ones carry a dot instead.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await waitFor(() => expect(screen.getByText(/Every competition/i)).toBeInTheDocument())

    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(names.findIndex((n) => /Champions League/.test(n))).toBeLessThan(
      names.findIndex((n) => /Libertadores/.test(n)),
    )
  })

  it('goes back to the directory from a competition', async () => {
    // The one control for leaving a competition. Without it the only way out
    // of a bracket is the browser's own back button.
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await openCompetition(/Copa Libertadores/i)

    await userEvent.click(screen.getByRole('button', { name: /All tournaments/i }))
    expect(screen.getByText(/Every competition/i)).toBeInTheDocument()
    expect(screen.queryByText(/Pick a tournament/i)).not.toBeInTheDocument()
  })

  it('opens the competition the reader clicked, not the first one', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await openCompetition(/Copa Libertadores/i)

    expect(
      screen.getByRole('heading', { name: /Copa Libertadores/i }),
    ).toBeInTheDocument()
  })

  it('switches tournament from the keyboard alone', async () => {
    mockFetch(ARTIFACT, FORECASTS)
    render(<TournamentsPage />)
    await openCompetition(/Champions League/i)

    const trigger = screen.getByRole('button', { name: /change tournament/i })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
