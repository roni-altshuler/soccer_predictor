import { render, screen } from '@testing-library/react'

import { LayerTabs } from '@/components/evidence/LayerTabs'

/**
 * The one control both evidence pages open with.
 *
 * Its documented rule is that a layer with no evidence is disabled rather than
 * clickable into an empty page. The rule these tests add is the one that was
 * missing: **disabling must never be a one-way door.** `/accuracy` reported its
 * league layer as empty while that layer was also the default, so the page
 * opened on a dead tab and the first click into Tournaments could not be
 * undone.
 */

const noop = () => {}

describe('LayerTabs', () => {
  it('disables a layer that genuinely has nothing', () => {
    render(
      <LayerTabs
        value="leagues"
        onChange={noop}
        enabled={{ leagues: true, tournaments: false }}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Tournaments' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Leagues' })).toBeEnabled()
  })

  it('never disables the layer you are standing on', () => {
    // Rendering the active tab as disabled is incoherent on its own terms:
    // it says you cannot go where you already are.
    render(
      <LayerTabs
        value="leagues"
        onChange={noop}
        enabled={{ leagues: false, tournaments: true }}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Leagues' })).toBeEnabled()
  })

  it('still closes a layer that is genuinely empty once you have left it', () => {
    // Deliberate, and NOT the bug the reader hit. A layer with nothing in it
    // is not somewhere to go back to. `/accuracy` trapped people because it
    // reported leagues as empty while 46 picks were sitting in it pending —
    // the page was lying to this control, and that is fixed in the page.
    render(
      <LayerTabs
        value="tournaments"
        onChange={noop}
        enabled={{ leagues: false, tournaments: true }}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Leagues' })).toBeDisabled()
  })

  it('disables nothing at all when no layer has evidence', () => {
    // With both empty there is no better destination to protect the reader
    // from, and greying out everything would strand them wherever the page
    // happened to open.
    render(
      <LayerTabs
        value="leagues"
        onChange={noop}
        enabled={{ leagues: false, tournaments: false }}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Leagues' })).toBeEnabled()
    expect(screen.getByRole('tab', { name: 'Tournaments' })).toBeEnabled()
  })
})
