'use client'

import { useState, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { SoccerSpinner } from './SoccerSpinner'

export const PageLoader = () => {
  const [loading, setLoading] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleStart = () => setLoading(true)
    const handleComplete = () => setLoading(false)

    // We track pathname and searchParams changes to determine loading state
    handleStart()
    handleComplete()

    return () => {
      handleComplete()
    }
  }, [pathname, searchParams])

  useEffect(() => {
    // Fallback for when the route change takes time
    const timer = setTimeout(() => {
      setLoading(false)
    }, 1000) // Adjust timeout as needed

    return () => clearTimeout(timer)
  }, [loading])


  if (!loading) return null

  return (
    <div className="fixed top-0 left-0 w-full h-full bg-[var(--overlay-bg)] flex justify-center items-center z-50">
      <SoccerSpinner />
    </div>
  )
}
