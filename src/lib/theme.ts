export type ThemePreference = 'system' | 'light' | 'dark'
export const THEME_STORAGE_KEY = 'pitchverse-theme'
export const LEGACY_THEME_STORAGE_KEY = 'theme'
export const THEME_EVENT = 'pitchverse-theme-change'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function storedThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
    return isThemePreference(value) ? value : 'system'
  } catch { return 'system' }
}

export function readThemePreference(): ThemePreference {
  if (typeof document === 'undefined') return 'system'
  const value = document.documentElement.dataset.themePreference
  return isThemePreference(value) ? value : 'system'
}

/** Update tokens and all controls together; system changes need no storage write. */
export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.dataset.themePreference = preference
  root.dataset.theme = dark ? 'dark' : 'light'
  root.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#071009' : '#f5f3ee')
  window.dispatchEvent(new CustomEvent(THEME_EVENT))
}

export function writeThemePreference(preference: ThemePreference): void {
  try { localStorage.setItem(THEME_STORAGE_KEY, preference) } catch { /* Session choice still works. */ }
  applyTheme(preference)
}

// A closed function serialized into the head: no bundle/network dependency,
// no persisted string interpolation, and the same validated legacy key.
export const THEME_BOOT = `(${function (key: string, legacy: string) {
  let preference = 'system'
  try {
    const value = localStorage.getItem(key) ?? localStorage.getItem(legacy)
    if (value === 'light' || value === 'dark' || value === 'system') preference = value
  } catch { /* System preference remains available with storage blocked. */ }
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.dataset.themePreference = preference
  root.dataset.theme = dark ? 'dark' : 'light'
  root.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#071009' : '#f5f3ee')
}.toString()})(${JSON.stringify(THEME_STORAGE_KEY)},${JSON.stringify(LEGACY_THEME_STORAGE_KEY)})`
