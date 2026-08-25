/**
 * The floodlit pitch behind the product — the one sanctioned ambient layer.
 *
 * Static mowing stripes, two accent-green light pools drifting on 90s+
 * cycles, and one canvas (PitchMatchAnimation) that draws the pitch itself —
 * outline, boxes, arcs, both goals — plus the tactics-board match played on
 * it: chalk circles vs X-marks in a simulated game. Lines and match share
 * the canvas so their mapping can never drift apart; the fit is CONTAIN and
 * centred, so the whole field with both goals is visible at every viewport,
 * rotating upright on portrait screens. Everything about the layer's
 * restraint is documented at the `.pitch-backdrop` block in globals.css and
 * in DESIGN.md's "Ambient layer" section — change those, not just this file.
 *
 * Mounted once in AppShell.
 */
import { PitchMatchAnimation } from '@/components/PitchMatchAnimation'

export function PitchBackdrop() {
  return (
    <div aria-hidden="true" className="pitch-backdrop">
      <div className="pitch-backdrop__stripes" />
      <div className="pitch-backdrop__glow pitch-backdrop__glow--a" />
      <div className="pitch-backdrop__glow pitch-backdrop__glow--b" />
      <PitchMatchAnimation />
    </div>
  )
}
