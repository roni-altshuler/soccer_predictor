/**
 * Read the design tokens the 3D scene needs as literal colours.
 *
 * R3F / WebGL can't consume `var(--token)` — materials need real colours. So,
 * like the win-chance landscape did, we resolve the tokens off a mounted
 * element with `getComputedStyle` and hand the scene literals. Re-read whenever
 * the theme flips (a MutationObserver on <html> drives that in the component).
 *
 * The token values in `globals.css` are plain hex, so a tiny hex parser is
 * enough; anything unexpected falls back to a sensible default and never a
 * crash or a hard-coded brand colour baked into the component.
 */

import type { RGB } from './landscape'

export interface ScenePalette {
  /** Home / positive momentum (green). RGB in 0..1 for mesh vertex colours. */
  home: RGB
  /** Away / negative momentum (red). */
  away: RGB
  /** Neutral / balanced (amber). */
  neutral: RGB
  /** Playhead + highlights (cyan). */
  accent: RGB
  /** Surface base / page background — used for fog + clear feel. */
  background: RGB
  /** Grid + hairline colour. */
  grid: RGB
}

interface TokenSpec {
  key: keyof ScenePalette
  varName: string
  fallback: string
}

const TOKENS: TokenSpec[] = [
  { key: 'home', varName: '--accent-primary', fallback: '#00c060' },
  { key: 'away', varName: '--accent-loss', fallback: '#ff5c5c' },
  { key: 'neutral', varName: '--accent-warn', fallback: '#f5b021' },
  { key: 'accent', varName: '--accent-ai', fallback: '#27c4f5' },
  { key: 'background', varName: '--background', fallback: '#171a18' },
  { key: 'grid', varName: '--border-color', fallback: '#333835' },
]

/** Parse `#rgb` / `#rrggbb` (or an `rgb(...)`) into RGB 0..1, else null. */
export function parseColor(value: string): RGB | null {
  const v = value.trim()
  if (v.startsWith('#')) {
    const hex = v.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex
    if (full.length < 6) return null
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    if ([r, g, b].some((n) => Number.isNaN(n))) return null
    return [r / 255, g / 255, b / 255]
  }
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s))
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255]
    }
  }
  return null
}

/** Resolve the scene palette off a mounted element's computed tokens. */
export function readScenePalette(el: HTMLElement): ScenePalette {
  const styles = getComputedStyle(el)
  const out = {} as ScenePalette
  for (const spec of TOKENS) {
    const raw = styles.getPropertyValue(spec.varName).trim()
    out[spec.key] = parseColor(raw) ?? parseColor(spec.fallback) ?? [0.5, 0.5, 0.5]
  }
  return out
}

/** `[r,g,b]` 0..1 → a `#rrggbb` string for a THREE.Color or CSS. */
export function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}
