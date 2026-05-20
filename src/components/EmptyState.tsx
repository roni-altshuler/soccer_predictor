'use client'

import { type ReactNode } from 'react'
import { motion } from 'framer-motion'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** Path under /public/illustrations/ — e.g. "no-matches" -> /illustrations/no-matches.svg */
  illustration?:
    | 'no-matches'
    | 'no-predictions'
    | 'no-tracked'
    | 'data-error'
    | 'celebrate'
    | 'searching'
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'flex flex-col items-center justify-center text-center py-12 px-6 max-w-md mx-auto',
        className
      )}
    >
      {illustration && (
        <img
          src={`/illustrations/${illustration}.svg`}
          alt=""
          aria-hidden="true"
          className="w-40 h-40 mb-5 opacity-95"
          width={160}
          height={160}
        />
      )}
      <h3 className="text-h4 font-semibold text-[var(--text-primary)] mb-1.5">
        {title}
      </h3>
      {description && (
        <p className="text-small text-[var(--text-tertiary)] leading-relaxed mb-5">
          {description}
        </p>
      )}
      {action && <div className="flex items-center gap-2">{action}</div>}
    </motion.div>
  )
}
