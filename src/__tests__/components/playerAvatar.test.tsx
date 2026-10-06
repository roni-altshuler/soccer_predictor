import { render, screen } from '@testing-library/react'
import { PlayerAvatar } from '@/components/primitives/PlayerAvatar'
import { approvedPlayerPortrait } from '@/lib/playerPortrait'
import contract from '../../../backend/tests/fixtures/portraits/contract.json'

let entry: unknown
jest.mock('@/hooks/useHeadshotManifest', () => ({
  useHeadshotManifest: () => ({
    resolve: (identity: unknown) => approvedPlayerPortrait(identity, entry),
    path: (path: string) => path,
  }),
}))
jest.mock('@/hooks/usePlayerPortrait', () => ({
  usePlayerPortrait: (approved: { path: string } | undefined) => approved?.path,
}))
// Keep image selection observable; the production browser checks real Radix
// initials in the existing sparse match-detail path.
jest.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  // eslint-disable-next-line @next/next/no-img-element -- observe the selected image without Next's optimizer
  AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt="" />,
  AvatarFallback: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
}))

beforeEach(() => { entry = undefined })

it('never guesses a portrait from a bare ID or direct URL', () => {
  render(<PlayerAvatar playerId="123" name="Player One" imageUrl="https://a.espncdn.com/i/headshots/soccer/players/full/123.png" />)
  expect(screen.getByRole('img', { name: 'Player One' })).toHaveTextContent('PO')
  expect(document.querySelector('img')).toBeNull()
})

it('fails closed for an explicit unknown-rights portrait even when another manifest record is approved', () => {
  entry = contract.cases[0].entry
  const portrait = { ...entry as object, rights: { status: 'unknown', evidence: '' } }
  render(<PlayerAvatar identity={{ provider: 'espn', id: '123' }} portrait={portrait as never} name="Player One" />)
  expect(screen.getByRole('img', { name: 'Player One' })).toHaveTextContent('PO')
  expect(document.querySelector('img')).toBeNull()
})

it('never displays a colliding provider record and removes a prior approved image', () => {
  entry = contract.cases[0].entry
  const { rerender } = render(<PlayerAvatar identity={{ provider: 'espn', id: '123' }} name="Player One" />)
  expect(document.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/headshots/espn/123-'))
  rerender(<PlayerAvatar identity={{ provider: 'fotmob', id: '123' }} name="Player Two" />)
  expect(screen.getByRole('img', { name: 'Player Two' })).toHaveTextContent('PT')
  expect(document.querySelector('img')).toBeNull()
})

it('requires permission evidence even when the subject is qualified', () => {
  entry = contract.cases.find((test) => test.name === 'unknown rights')?.entry
  render(<PlayerAvatar identity={{ provider: 'espn', id: '123' }} name="Player One" />)
  expect(document.querySelector('img')).toBeNull()
})
