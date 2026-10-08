import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AuthProvider } from '@/contexts/AuthContext'
import { applyTheme, THEME_BOOT, THEME_STORAGE_KEY, writeThemePreference } from '@/lib/theme'

let systemDark = false
const changes = new Set<() => void>()
const originalMedia = window.matchMedia
beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themePreference
  systemDark = false
  changes.clear()
  window.matchMedia = jest.fn(() => ({
    get matches() { return systemDark }, media: '', onchange: null,
    addEventListener: (_: string, callback: () => void) => changes.add(callback),
    removeEventListener: (_: string, callback: () => void) => changes.delete(callback),
    addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { cleanup(); jest.restoreAllMocks(); window.matchMedia = originalMedia })

it.each([
  ['light', true, 'light'], ['dark', false, 'dark'], ['system', true, 'dark'],
  ['system', false, 'light'], [null, true, 'dark'], ['invalid', false, 'light'],
])('paints stored %s before hydration despite system dark=%s', (stored, dark, expected) => {
  systemDark = dark
  if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored)
  window.eval(THEME_BOOT)
  expect(document.documentElement.dataset.theme).toBe(expected)
  expect(document.documentElement.classList.contains('dark')).toBe(expected === 'dark')
})

it('honors the verified legacy theme key, then gives the current key precedence', () => {
  localStorage.setItem('theme', 'dark')
  window.eval(THEME_BOOT)
  expect(document.documentElement.dataset.theme).toBe('dark')
  localStorage.setItem(THEME_STORAGE_KEY, 'light')
  window.eval(THEME_BOOT)
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('preserves pre-painted preference during mount and synchronizes every control', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  window.eval(THEME_BOOT)
  render(<ThemeProvider><ThemeToggle /><ThemeToggle /></ThemeProvider>)
  const controls = screen.getAllByRole('combobox', { name: 'Color theme' })
  expect(controls[0]).toHaveValue('dark')
  fireEvent.change(controls[0], { target: { value: 'light' } })
  expect(controls[1]).toHaveValue('light')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('tracks OS changes only when System is selected, and removes listeners', () => {
  window.eval(THEME_BOOT)
  const { unmount } = render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
  systemDark = true
  act(() => changes.forEach((listener) => listener()))
  expect(document.documentElement.dataset.theme).toBe('dark')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'light' } })
  act(() => changes.forEach((listener) => listener()))
  expect(document.documentElement.dataset.theme).toBe('light')
  unmount()
  expect(changes.size).toBe(0)
})

it('applies a preference changed by another tab and follows System after clearing storage', () => {
  window.eval(THEME_BOOT)
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
  localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY })))
  expect(screen.getByRole('combobox')).toHaveValue('dark')
  localStorage.clear()
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })))
  expect(screen.getByRole('combobox')).toHaveValue('system')
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('retains a session preference if storage reads or writes are blocked', () => {
  systemDark = true
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  window.eval(THEME_BOOT)
  expect(document.documentElement.dataset.theme).toBe('dark')
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  expect(() => writeThemePreference('light')).not.toThrow()
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(document.documentElement.dataset.themePreference).toBe('light')
})

it('resolves System without replacing a saved explicit preference', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  applyTheme('system')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
})

it('updates browser chrome during both pre-paint and later selection', () => {
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  document.head.append(meta)
  systemDark = true
  window.eval(THEME_BOOT)
  expect(meta.content).toBe('#071009')
  applyTheme('light')
  expect(meta.content).toBe('#f5f3ee')
  meta.remove()
})

it('renders the signed-out shell controls when browser storage is unavailable', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  render(<ThemeProvider><AuthProvider><ThemeToggle /></AuthProvider></ThemeProvider>)
  expect(screen.getByRole('combobox', { name: 'Color theme' })).toHaveValue('system')
})
