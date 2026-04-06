'use client'

import { useTheme } from '@/providers/ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className="relative w-9 h-9 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-all duration-200 flex items-center justify-center group"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      <span className="text-base transition-transform group-hover:scale-110">
        {theme === 'light' ? '🌙' : '☀️'}
      </span>
    </button>
  )
}
