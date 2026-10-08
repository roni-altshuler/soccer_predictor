'use client'

import { useEffect, type ReactNode } from 'react'
import { applyTheme, LEGACY_THEME_STORAGE_KEY, readThemePreference, storedThemePreference, THEME_STORAGE_KEY } from '@/lib/theme'

/** Keep a pre-painted theme in step with the OS and other tabs. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme(readThemePreference())
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => {
      if (readThemePreference() === 'system') applyTheme('system')
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY || event.key === LEGACY_THEME_STORAGE_KEY) applyTheme(storedThemePreference())
    }
    media.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    return () => {
      media.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return children
}
