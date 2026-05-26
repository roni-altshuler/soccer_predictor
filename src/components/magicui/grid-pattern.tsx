'use client'

import { useId, type SVGProps } from 'react'

import { cn } from '@/lib/utils'

interface GridPatternProps extends SVGProps<SVGSVGElement> {
  width?: number
  height?: number
  x?: number
  y?: number
  squares?: Array<[number, number]>
  strokeDasharray?: string
  className?: string
}

/**
 * Tileable grid pattern with optional highlighted squares (for sparkles).
 */
export function GridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = '0',
  squares,
  className,
  ...props
}: GridPatternProps) {
  const id = useId()
  return (
    <svg
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full fill-[var(--text-tertiary)]/10 stroke-[var(--border-color)]/40',
        className
      )}
      {...props}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
      {squares && (
        <svg x={x} y={y} className="overflow-visible">
          {squares.map(([sx, sy]) => (
            <rect
              strokeWidth="0"
              key={`${sx}-${sy}`}
              width={width - 1}
              height={height - 1}
              x={sx * width + 1}
              y={sy * height + 1}
            />
          ))}
        </svg>
      )}
    </svg>
  )
}
