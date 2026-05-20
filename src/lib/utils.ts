import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combine and de-duplicate Tailwind class names.
 * Standard shadcn/ui helper used by every UI primitive in `src/components/ui`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Clamp a number to a [min, max] window. Convenience for probability bars and gauges.
 */
export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min
  return Math.max(min, Math.min(max, value))
}

/**
 * Format a 0..1 probability as a rounded percentage string.
 */
export function formatPct(value: number, digits = 0): string {
  return `${(clamp(value) * 100).toFixed(digits)}%`
}
