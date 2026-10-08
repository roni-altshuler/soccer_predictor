import type { FocusEvent } from 'react'

/** Native focus scrolling can ignore sticky chrome, especially <summary> and
 * date-picker subcontrols. Scroll an already-focused control; never move focus.
 * Kept local to comparison/evidence flows rather than changing the global shell.
 */
export function keepShellFocusVisible(event: FocusEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  const rect = target.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const top = document.querySelector('.match-flow-shell header')?.getBoundingClientRect().bottom ?? 0
  const bottomNav = document.querySelector('nav[aria-label="Mobile navigation"]')?.getBoundingClientRect()
  const bottom = bottomNav?.height ? bottomNav.top : window.innerHeight
  if (rect.top < top + 12 || rect.bottom > bottom - 12) target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
}
