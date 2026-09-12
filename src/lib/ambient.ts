/**
 * The reader's dial on the one ambient layer (PitchBackdrop).
 *
 * Three states, persisted per browser and applied as `data-ambient` on
 * `<html>` before first paint by the inline script in the root layout, so a
 * reader who turned the pitch off never sees it flash on:
 *
 *   soft   — the default. The match canvas at 60% opacity with a hair of
 *            blur, the light pools at 60%. Present, never in focus.
 *   vivid  — the layer at its full (already reduced) ceilings.
 *   off    — the layer is `display: none` and the canvas loop stops.
 *
 * `AmbientToggle` writes it; `PitchMatchAnimation` listens for it so it can
 * stop its rAF loop while off and resume when the reader turns it back on.
 */

export type AmbientMode = 'soft' | 'vivid' | 'off'

export const AMBIENT_STORAGE_KEY = 'pitchverse-ambient'
export const AMBIENT_EVENT = 'ambientchange'
export const AMBIENT_MODES: readonly AmbientMode[] = ['soft', 'vivid', 'off']
export const AMBIENT_DEFAULT: AmbientMode = 'soft'

export function isAmbientMode(value: unknown): value is AmbientMode {
  return value === 'soft' || value === 'vivid' || value === 'off'
}

/** The mode currently applied to the document — the attribute is the truth. */
export function readAmbient(): AmbientMode {
  if (typeof document === 'undefined') return AMBIENT_DEFAULT
  const v = document.documentElement.dataset.ambient
  return isAmbientMode(v) ? v : AMBIENT_DEFAULT
}

/** Apply, persist, and tell every listener (the canvas, the other toggle). */
export function writeAmbient(mode: AmbientMode): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.ambient = mode
  try {
    localStorage.setItem(AMBIENT_STORAGE_KEY, mode)
  } catch {
    /* private mode: the choice lasts the session */
  }
  window.dispatchEvent(new CustomEvent<AmbientMode>(AMBIENT_EVENT, { detail: mode }))
}
