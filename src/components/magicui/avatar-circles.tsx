'use client'

import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'

interface Avatar {
  imageUrl?: string
  initials?: string
  teamColor?: string
  href?: string
  label?: string
}

interface AvatarCirclesProps {
  numPeople?: number
  className?: string
  avatars: Avatar[]
  size?: number
}

/**
 * Overlapping row of circular avatars with a "+N" trailing chip.
 */
export function AvatarCircles({
  numPeople,
  className,
  avatars,
  size = 40,
}: AvatarCirclesProps) {
  return (
    <div className={cn('z-10 flex -space-x-3 rtl:space-x-reverse', className)}>
      {avatars.map((avatar, index) => {
        const ring = avatar.teamColor ?? 'var(--border-color-hover)'
        const inner = avatar.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar.imageUrl}
            width={size}
            height={size}
            alt={avatar.label ?? `Avatar ${index + 1}`}
            className="rounded-full object-cover"
            style={{ width: size, height: size }}
            loading="lazy"
          />
        ) : (
          <span
            className="flex items-center justify-center rounded-full bg-[var(--muted-bg)] font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-primary)]"
            style={{ width: size, height: size }}
          >
            {avatar.initials ?? '·'}
          </span>
        )
        const ringStyle: CSSProperties = {
          boxShadow: `0 0 0 2px ${ring}, 0 0 0 4px var(--background)`,
          borderRadius: '9999px',
        }
        const wrapper = (
          <span key={index} className="inline-block" style={ringStyle}>
            {inner}
          </span>
        )
        return avatar.href ? (
          <a key={index} href={avatar.href} style={{ display: 'inline-block' }}>
            {wrapper}
          </a>
        ) : (
          wrapper
        )
      })}
      {typeof numPeople === 'number' && numPeople > avatars.length ? (
        <span
          className="flex items-center justify-center rounded-full bg-[var(--background)] text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--text-primary)] ring-2 ring-[var(--border-color-hover)]"
          style={{ width: size, height: size }}
        >
          +{numPeople - avatars.length}
        </span>
      ) : null}
    </div>
  )
}
