'use client'

/**
 * Chart theme — reads CSS variables from `src/app/globals.css` so Recharts
 * colours automatically adapt to dark/light mode without any prop drilling.
 *
 * Usage:
 *
 *   import { useChartTheme } from '@/components/charts/theme'
 *   ...
 *   const theme = useChartTheme()
 *   <BarChart>
 *     <Bar dataKey="wins" fill={theme.primary} />
 *     ...
 *   </BarChart>
 *
 * `useChartTheme` is a client hook that re-evaluates whenever the
 * `.dark` class flips on <html>, so charts repaint correctly on theme
 * change without needing a remount.
 */
import { useEffect, useState } from 'react'

export interface ChartTheme {
  primary: string
  primarySoft: string
  ai: string
  aiSoft: string
  warn: string
  warnSoft: string
  loss: string
  lossSoft: string
  text: string
  textMuted: string
  border: string
  cardBg: string
  background: string
  /** Multi-series palette ordered for good 2-up / 3-up / 4-up contrast. */
  series: string[]
  /** Colour for "home win" series — matches MatchCard. */
  home: string
  /** Colour for "draw" series. */
  draw: string
  /** Colour for "away win" series. */
  away: string
}

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

function build(): ChartTheme {
  const primary = readVar('--accent-primary', '#22c55e')
  const primarySoft = readVar('--accent-primary-soft', '#4ade80')
  const ai = readVar('--accent-ai', '#22d3ee')
  const aiSoft = readVar('--accent-ai-soft', '#67e8f9')
  const warn = readVar('--accent-warn', '#f59e0b')
  const warnSoft = readVar('--accent-warn-soft', '#fbbf24')
  const loss = readVar('--accent-loss', '#ef4444')
  const lossSoft = readVar('--accent-loss-soft', '#f87171')
  const text = readVar('--text-primary', '#0f1a2c')
  const textMuted = readVar('--text-tertiary', '#5d7290')
  const border = readVar('--border-color', '#d8e0ee')
  const cardBg = readVar('--card-bg', '#ffffff')
  const background = readVar('--background', '#f5f7fb')

  return {
    primary,
    primarySoft,
    ai,
    aiSoft,
    warn,
    warnSoft,
    loss,
    lossSoft,
    text,
    textMuted,
    border,
    cardBg,
    background,
    home: primary,
    draw: warn,
    away: loss,
    series: [primary, ai, warn, loss, primarySoft, aiSoft, '#a78bfa', '#f472b6'],
  }
}

/**
 * Static fallback theme — usable from non-React modules / SSR.
 */
export const fallbackChartTheme: ChartTheme = {
  primary: '#22c55e',
  primarySoft: '#4ade80',
  ai: '#22d3ee',
  aiSoft: '#67e8f9',
  warn: '#f59e0b',
  warnSoft: '#fbbf24',
  loss: '#ef4444',
  lossSoft: '#f87171',
  text: '#0f1a2c',
  textMuted: '#5d7290',
  border: '#d8e0ee',
  cardBg: '#ffffff',
  background: '#f5f7fb',
  home: '#22c55e',
  draw: '#f59e0b',
  away: '#ef4444',
  series: ['#22c55e', '#22d3ee', '#f59e0b', '#ef4444', '#4ade80', '#67e8f9', '#a78bfa', '#f472b6'],
}

/**
 * Reactive theme — repaints when the user toggles light/dark mode.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(() => {
    if (typeof window === 'undefined') return fallbackChartTheme
    return build()
  })

  useEffect(() => {
    setTheme(build())
    const observer = new MutationObserver(() => setTheme(build()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  return theme
}
