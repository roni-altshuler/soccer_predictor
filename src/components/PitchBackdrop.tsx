/**
 * The floodlit pitch behind the product — the one sanctioned ambient layer.
 *
 * Static mowing stripes, pitch markings at ≤8% white (halfway line, centre
 * circle, both boxes with their penalty arcs, corner arcs), two accent-green
 * light pools drifting on 90s+ cycles, and — on top of the lines — the
 * tactics-board match (see PitchMatchAnimation: chalk circles vs X-marks
 * playing a simulated game). Everything about the layer's restraint is
 * documented at the `.pitch-backdrop` block in globals.css and in DESIGN.md's
 * "Ambient layer" section — change those, not just this file.
 *
 * The stripes/glows/lines are static markup; the match is the one client
 * canvas. Mounted once in AppShell. The viewBox is a full pitch seen from
 * above, sliced by `preserveAspectRatio` so the centre circle stays near the
 * viewport's middle on any screen — the canvas replicates the same mapping.
 */
import { PitchMatchAnimation } from '@/components/PitchMatchAnimation'

export function PitchBackdrop() {
  return (
    <div aria-hidden="true" className="pitch-backdrop">
      <div className="pitch-backdrop__stripes" />
      <div className="pitch-backdrop__glow pitch-backdrop__glow--a" />
      <div className="pitch-backdrop__glow pitch-backdrop__glow--b" />
      <svg
        className="pitch-backdrop__lines"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        {/* touchlines are implied by the viewport — drawing a frame reads as a border */}
        {/* halfway line + centre circle */}
        <line x1="800" y1="-40" x2="800" y2="1040" />
        <circle cx="800" cy="500" r="240" />
        <circle cx="800" cy="500" r="6" />
        {/* left penalty box, six-yard box and arc */}
        <rect x="-60" y="230" width="330" height="540" />
        <rect x="-60" y="370" width="130" height="260" />
        <path d="M 270 415 A 190 190 0 0 1 270 585" />
        {/* right penalty box, six-yard box and arc */}
        <rect x="1330" y="230" width="330" height="540" />
        <rect x="1530" y="370" width="130" height="260" />
        <path d="M 1330 415 A 190 190 0 0 0 1330 585" />
        {/* corner arcs */}
        <path d="M -60 40 A 40 40 0 0 1 -20 0" transform="translate(60 0)" />
        <path d="M 1600 40 A 40 40 0 0 0 1560 0" />
        <path d="M 0 960 A 40 40 0 0 1 40 1000" />
        <path d="M 1600 960 A 40 40 0 0 0 1560 1000" />
      </svg>
      {/* The match plays ON the lines, so the canvas sits above them. */}
      <PitchMatchAnimation />
    </div>
  )
}
