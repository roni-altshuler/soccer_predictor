'use client'

import { useGenderPreference, type GenderPreference } from '@/hooks/useGenderPreference'

interface GenderToggleProps {
  className?: string
  compact?: boolean
}

const OPTIONS: { value: GenderPreference; label: string; short: string }[] = [
  { value: 'men', label: "Men's", short: 'M' },
  { value: 'women', label: "Women's", short: 'W' },
]

/**
 * Segmented control that lets the user switch between men's and women's
 * football. The choice is persisted via `useGenderPreference` and
 * read by the prediction & match-list APIs (see `?gender=` query param).
 */
export function GenderToggle({ className = '', compact = false }: GenderToggleProps) {
  const { gender, setGender } = useGenderPreference()

  return (
    <div
      role="group"
      aria-label="Football competition gender"
      className={`inline-flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)]/65 p-0.5 ${className}`}
    >
      {OPTIONS.map((opt) => {
        const active = gender === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setGender(opt.value)}
            aria-pressed={active}
            aria-label={`${opt.label} football`}
            className={`relative px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              active
                ? 'bg-[var(--accent-primary)] text-[#04120a] shadow-[0_4px_12px_-6px_color-mix(in_srgb,var(--accent-primary)_60%,transparent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {compact ? opt.short : opt.label}
          </button>
        )
      })}
    </div>
  )
}
