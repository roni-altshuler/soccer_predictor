import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'
export const revalidate = 3600

// Brand palette (mirrored from globals.css so the OG image is fully
// self-contained) — kept identical to /api/og/[matchId].
const COLORS = {
  bg0: '#07101f',
  bg1: '#0c182a',
  bg2: '#111e36',
  border: '#243954',
  text: '#f1f5fb',
  textMuted: '#a8bcdb',
  primary: '#22c55e',
  ai: '#22d3ee',
} as const

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/**
 * Shareable rarity card: the exact-count historical claim rendered as a
 * branded 1200x630 image. All inputs arrive as query params (edge runtime —
 * no filesystem, same pattern as the match OG card):
 *
 *   /api/og/rarity?down=2-0&minute=70&n=10412&w=16
 *     &home=Alpha&away=Beta&hg=3&ag=2&league=Premier%20League
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const down = (searchParams.get('down') || '').slice(0, 8)
  const minute = Number.parseInt(searchParams.get('minute') ?? '', 10)
  const n = Number.parseInt(searchParams.get('n') ?? '', 10)
  const w = Number.parseInt(searchParams.get('w') ?? '', 10)
  const home = searchParams.get('home') || ''
  const away = searchParams.get('away') || ''
  const homeScore = searchParams.get('hg')
  const awayScore = searchParams.get('ag')
  const league = searchParams.get('league') || ''

  const hasClaim =
    /^\d+-\d+$/.test(down) && Number.isFinite(minute) && Number.isFinite(n) && n > 0 && Number.isFinite(w) && w >= 0 && w <= n

  // Percentage is recomputed from the counts so the card can never show a
  // fraction and a percentage that disagree.
  const pct = hasClaim ? ((w / n) * 100).toFixed(1) : ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: `linear-gradient(135deg, ${COLORS.bg0} 0%, ${COLORS.bg1} 50%, ${COLORS.bg2} 100%)`,
          color: COLORS.text,
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '64px 72px',
          position: 'relative',
        }}
      >
        {/* glow blobs */}
        <div
          style={{
            position: 'absolute',
            top: -120,
            left: -80,
            width: 520,
            height: 520,
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(34,197,94,0.35), rgba(34,197,94,0))',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: -100,
            right: -120,
            width: 540,
            height: 540,
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(34,211,238,0.32), rgba(34,211,238,0))',
          }}
        />

        {/* header strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            fontSize: 22,
            color: COLORS.textMuted,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.ai})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              color: '#02180c',
              fontSize: 28,
            }}
          >
            P
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ color: COLORS.text, fontWeight: 800, fontSize: 28 }}>Pitchwise</span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 22, color: COLORS.textMuted, letterSpacing: 4 }}>
            {league ? league.toUpperCase() : hasClaim ? 'RARITY' : ''}
          </span>
        </div>

        {hasClaim ? (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 64, gap: 24 }}>
            <span style={{ fontSize: 24, color: COLORS.textMuted, letterSpacing: 6 }}>
              HOW RARE WAS THAT?
            </span>
            <span style={{ fontSize: 62, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>
              Down {down} at the {ordinal(minute)} minute
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 36, marginTop: 12 }}>
              <span
                style={{
                  fontSize: 110,
                  fontWeight: 800,
                  letterSpacing: -3,
                  color: COLORS.primary,
                  lineHeight: 1,
                }}
              >
                {pct}%
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 30, color: COLORS.text, fontWeight: 600 }}>
                  went on to win
                </span>
                <span style={{ fontSize: 26, color: COLORS.textMuted }}>
                  {w.toLocaleString('en-US')} of {n.toLocaleString('en-US')} such matches
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 96, gap: 24 }}>
            <span style={{ fontSize: 24, color: COLORS.textMuted, letterSpacing: 6 }}>RARITY</span>
            <span style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5 }}>
              Every moment, stamped with history
            </span>
            <span style={{ fontSize: 28, color: COLORS.textMuted }}>
              Exact counts over decades of matches — no estimates
            </span>
          </div>
        )}

        {/* footer: match context + brand */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 22,
            color: COLORS.textMuted,
          }}
        >
          {home && away && homeScore !== null && awayScore !== null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: COLORS.text, fontWeight: 700 }}>{home}</span>
              <span
                style={{
                  padding: '4px 14px',
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  background: 'rgba(15, 26, 44, 0.5)',
                  color: COLORS.text,
                  fontWeight: 800,
                }}
              >
                {homeScore} - {awayScore}
              </span>
              <span style={{ color: COLORS.text, fontWeight: 700 }}>{away}</span>
            </div>
          ) : (
            <span>pitchwise.app</span>
          )}
          <span>Counted, not estimated</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
