'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

/** Observe Next's same-path navigation without making the static page dynamic. */
export function MatchdayUrlSync({ onChange }: { onChange: () => void }) {
  const query = useSearchParams()?.toString() ?? ''
  useEffect(() => {
    onChange()
  }, [query, onChange])
  return null
}
