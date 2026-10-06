import { act, renderHook, waitFor } from '@testing-library/react'
import { webcrypto, createHash } from 'node:crypto'
import { usePlayerPortrait } from '@/hooks/usePlayerPortrait'
import { approvedPlayerPortrait } from '@/lib/playerPortrait'
import contract from '../../../backend/tests/fixtures/portraits/contract.json'

const bytes = Buffer.from('synthetic portrait bytes')
const digest = createHash('sha256').update(bytes).digest('hex')
const identity = { provider: 'espn', id: '123' }
const raw = { ...contract.cases[0].entry as object, sha256: digest, path: `/headshots/espn/123-${digest}.webp` }
const entry = approvedPlayerPortrait(identity, raw)!
const path = (value: string) => value
const response = (body = bytes) => ({ ok: true, headers: new Headers({ 'content-type': 'image/webp' }),
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) })

async function finishDigest(spy: jest.SpyInstance) {
  await waitFor(() => expect(spy).toHaveBeenCalled())
  await act(async () => { await spy.mock.results[0].value })
}

beforeEach(() => {
  Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto })
  URL.createObjectURL = jest.fn(() => 'blob:verified-local-bytes')
  URL.revokeObjectURL = jest.fn()
  global.fetch = jest.fn().mockResolvedValue(response())
})
afterEach(() => { jest.restoreAllMocks() })

it('checks exact cached bytes before displaying, then revokes them on identity change', async () => {
  const { result, rerender } = renderHook(({ value }) => usePlayerPortrait(value, path), { initialProps: { value: entry as typeof entry | undefined } })
  expect(result.current).toBeUndefined()
  await waitFor(() => expect(result.current).toBe('blob:verified-local-bytes'))
  rerender({ value: undefined })
  expect(result.current).toBeUndefined()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:verified-local-bytes')
})

it('rejects wrong cached bytes without creating an image URL', async () => {
  const digestSpy = jest.spyOn(crypto.subtle, 'digest')
  global.fetch = jest.fn().mockResolvedValue(response(Buffer.from('different person')))
  const { result } = renderHook(() => usePlayerPortrait(entry, path))
  await finishDigest(digestSpy)
  expect(result.current).toBeUndefined()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('never displays an older asset response after its identity is removed', async () => {
  const digestSpy = jest.spyOn(crypto.subtle, 'digest')
  let release!: (value: unknown) => void
  global.fetch = jest.fn(() => new Promise((resolve) => { release = resolve })) as typeof fetch
  const { result, rerender } = renderHook(({ value }) => usePlayerPortrait(value, path), { initialProps: { value: entry as typeof entry | undefined } })
  rerender({ value: undefined })
  await act(async () => { release(response()) })
  await finishDigest(digestSpy)
  expect(result.current).toBeUndefined()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('does not reuse a revoked URL when the same identity is enabled again', async () => {
  const { result, rerender } = renderHook(({ value }) => usePlayerPortrait(value, path), { initialProps: { value: entry as typeof entry | undefined } })
  await waitFor(() => expect(result.current).toBe('blob:verified-local-bytes'))
  rerender({ value: undefined })
  let release!: (value: unknown) => void
  global.fetch = jest.fn(() => new Promise((resolve) => { release = resolve })) as typeof fetch
  rerender({ value: entry })
  expect(result.current).toBeUndefined()
  URL.createObjectURL = jest.fn(() => 'blob:new-verified-local-bytes')
  await act(async () => { release(response()) })
  await waitFor(() => expect(result.current).toBe('blob:new-verified-local-bytes'))
})

it('fetches no asset without metadata and refuses an external delivery path', () => {
  const { rerender } = renderHook(({ value }) => usePlayerPortrait(value, () => 'https://example.com/portrait.webp'), { initialProps: { value: undefined as typeof entry | undefined } })
  rerender({ value: entry })
  expect(fetch).not.toHaveBeenCalled()
})
