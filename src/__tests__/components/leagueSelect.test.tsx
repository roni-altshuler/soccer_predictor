import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LeagueSelect, orderLeagues } from '@/components/forecast/LeagueSelect'

/**
 * The league picker.
 *
 * A custom listbox buys a richer row than a native `<select>` can render and
 * pays for it by owning the entire keyboard contract by hand. That contract is
 * invisible to anyone testing with a mouse, so it is pinned here: a control
 * that opens and selects on click while being unusable from a keyboard looks
 * completely finished in a screenshot.
 */

const LEAGUES = [
  { competition_id: 'ger.1', name: 'Bundesliga', country: 'Germany', season: 2026,
    fixtures_remaining: 306, teams: 18 },
  { competition_id: 'eng.1', name: 'Premier League', country: 'England', season: 2026,
    fixtures_remaining: 380, teams: 20 },
  { competition_id: 'fra.1', name: 'Ligue 1', country: 'France', season: 2026,
    fixtures_remaining: 306, teams: 18 },
  { competition_id: 'esp.1', name: 'La Liga', country: 'Spain', season: 2026,
    fixtures_remaining: 380, teams: 20 },
]

function setup(value = 'eng.1') {
  const onChange = jest.fn()
  render(<LeagueSelect leagues={LEAGUES} value={value} onChange={onChange} />)
  return { onChange, trigger: screen.getByRole('button', { name: /change league/i }) }
}

const open = async (trigger: HTMLElement) => {
  await userEvent.click(trigger)
  return screen.getByRole('listbox')
}

describe('LeagueSelect', () => {
  it('orders by following, not by alphabet', () => {
    expect(orderLeagues(LEAGUES).map((l) => l.competition_id)).toEqual([
      'eng.1', 'esp.1', 'ger.1', 'fra.1',
    ])
  })

  it('shows the current league without being opened', () => {
    setup()
    expect(screen.getByText('Premier League')).toBeInTheDocument()
    expect(screen.getByText(/England · 2026\/27/)).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks which league is current, for readers who cannot see the tick', async () => {
    const { trigger } = setup('esp.1')
    const list = await open(trigger)
    const selected = within(list).getAllByRole('option', { selected: true })
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent('La Liga')
  })

  it('reports how much of each season is left, so the choice is informed', async () => {
    const { trigger } = setup()
    const list = await open(trigger)
    expect(within(list).getByText(/England · 380 to play/)).toBeInTheDocument()
    expect(within(list).getByText(/Germany · 306 to play/)).toBeInTheDocument()
  })

  it('selects with the mouse and closes', async () => {
    const { onChange, trigger } = setup()
    const list = await open(trigger)
    await userEvent.click(within(list).getByRole('option', { name: /Ligue 1/ }))
    expect(onChange).toHaveBeenCalledWith('fra.1')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens from the keyboard and selects with Enter', async () => {
    const { onChange, trigger } = setup()
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    // Opens on the current league, not the top of the list.
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('esp.1')
  })

  it('wraps at both ends rather than dead-ending', async () => {
    const { onChange, trigger } = setup('eng.1')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}') // open, on Premier League (first)
    await userEvent.keyboard('{ArrowUp}{Enter}') // wrap to the last
    expect(onChange).toHaveBeenCalledWith('fra.1')
  })

  it('jumps to the ends with Home and End', async () => {
    const { onChange, trigger } = setup('esp.1')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}{End}{Enter}')
    expect(onChange).toHaveBeenCalledWith('fra.1')
  })

  it('finds a league by typing, past the first letter', async () => {
    const { onChange, trigger } = setup()
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    // "l" alone would stop at La Liga; "li" must reach Ligue 1.
    await userEvent.keyboard('li{Enter}')
    expect(onChange).toHaveBeenCalledWith('fra.1')
  })

  it('escapes without selecting and gives focus back', async () => {
    const { onChange, trigger } = setup()
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Escape}')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes when the reader clicks away', async () => {
    const { onChange, trigger } = setup()
    await open(trigger)
    await userEvent.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('announces itself as a collapsed listbox trigger', async () => {
    const { trigger } = setup()
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    const list = await open(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // The highlight has to be exposed, or a screen reader reads a static list.
    expect(list).toHaveAttribute('aria-activedescendant')
    const active = document.getElementById(
      list.getAttribute('aria-activedescendant') as string,
    )
    expect(active).toHaveTextContent('Premier League')
  })


  // ------------------------------------------------------------ small screens
  //
  // The anchored panel has to fit between the trigger and the fixed tab bar.
  // At 375x667 it does not — it was cut off with no scrollbar and no sign the
  // missing leagues existed — and flipping it upward only moved the clipping
  // to the top edge at 320px. Below the sm breakpoint it becomes a sheet,
  // which has no such geometry.

  const setViewport = (wide: boolean) => {
    window.matchMedia = ((q) => ({
      matches: wide, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  it('becomes a bottom sheet on a phone', async () => {
    setViewport(false)
    const { trigger } = setup()
    const list = await open(trigger)
    expect(list.className).toContain('fixed')
    expect(list.className).toContain('inset-x-0')
    // A sheet needs a scrim: without one the page behind it stays live and
    // the sheet reads as part of the page rather than over it.
    expect(document.querySelector('.fixed.inset-0')).toBeInTheDocument()
  })

  it('stays anchored to the trigger on a wide screen', async () => {
    setViewport(true)
    const { trigger } = setup()
    const list = await open(trigger)
    expect(list.className).toContain('absolute')
    expect(list.className).not.toContain('inset-x-0')
    expect(document.querySelector('.fixed.inset-0')).not.toBeInTheDocument()
  })

  it('closes when the scrim is tapped', async () => {
    setViewport(false)
    const { onChange, trigger } = setup()
    await open(trigger)
    await userEvent.click(document.querySelector('.fixed.inset-0') as Element)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the same options and semantics in either form', async () => {
    setViewport(false)
    const { trigger } = setup('esp.1')
    const list = await open(trigger)
    expect(within(list).getAllByRole('option')).toHaveLength(4)
    expect(within(list).getAllByRole('option', { selected: true })[0]).toHaveTextContent(
      'La Liga',
    )
  })

  it('renders nothing rather than a broken control when the value is unknown', () => {
    const onChange = jest.fn()
    const { container } = render(
      <LeagueSelect leagues={[]} value="eng.1" onChange={onChange} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
