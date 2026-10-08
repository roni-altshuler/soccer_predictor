'use client'

import { useEffect, useState } from 'react'
import { isThemePreference, readThemePreference, THEME_EVENT, writeThemePreference, type ThemePreference } from '@/lib/theme'

export function ThemeToggle() {
  // SSR always renders System. The head script already painted the saved
  // palette; updating this control after mount cannot flash the page.
  const [preference, setPreference] = useState<ThemePreference>('system')
  useEffect(() => {
    const sync = () => setPreference(readThemePreference())
    sync()
    window.addEventListener(THEME_EVENT, sync)
    return () => window.removeEventListener(THEME_EVENT, sync)
  }, [])
  return (
    <select
      aria-label="Color theme"
      value={preference}
      onChange={(event) => { if (isThemePreference(event.target.value)) writeThemePreference(event.target.value) }}
      className="min-h-11 max-w-[100px] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2 text-xs font-medium text-[var(--text-primary)]"
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  )
}
