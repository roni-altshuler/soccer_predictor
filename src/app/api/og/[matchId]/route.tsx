import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'
export const revalidate = 60

// Brand palette (mirrored from globals.css so the OG image is fully
// self-contained and does not depend on Tailwind at runtime).
const COLORS = {
  bg0: '#07101f',
  bg1: '#0c182a',
  bg2: '#111e36',
  border: '#243954',
  text: '#f1f5fb',
  textMuted: '#a8bcdb',
  primary: '#22c55e',
  ai: '#22d3ee',
  warn: '#f59e0b',
  loss: '#f87171',
} as const

function pct(value: number): string {
  if (Number.isNaN(value)) return '—'
  const v = Math.max(0, Math.min(1, value))
  return `${Math.round(v * 100)}%`
}

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function ProbabilityRow({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <span style={{ width: 280, fontSize: 24, color: COLORS.text, fontWeight: 600 }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 18,
          background: 'rgba(36, 57, 84, 0.6)',
          borderRadius: 9,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.round(value * 100)}%`,
            background: color,
            borderRadius: 9,
          }}
        />
      </div>
      <span style={{ width: 90, textAlign: 'right', fontSize: 26, fontWeight: 700, color }}>
        {pct(value)}
      </span>
    </div>
  )
}

interface RouteContext {
  params: Promise<{ matchId: string }>
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params
  const matchId = params.matchId
  const { searchParams } = new URL(req.url)

  // Inputs come either as ?home=&away=&hp=0.52&dp=0.21&ap=0.27&hg=2&ag=1
  // (so static link cards can be built without a DB hit) or, when only
  // matchId is provided, we render a generic Pitchwise card.
  const home = searchParams.get('home') || 'Home'
  const away = searchParams.get('away') || 'Away'
  const league = searchParams.get('league') || ''
  const homeScore = searchParams.get('hg')
  const awayScore = searchParams.get('ag')
  const homeProb = Number(searchParams.get('hp') ?? 'NaN')
  const drawProb = Number(searchParams.get('dp') ?? 'NaN')
  const awayProb = Number(searchParams.get('ap') ?? 'NaN')
  const hasProbs =
    !Number.isNaN(homeProb) && !Number.isNaN(drawProb) && !Number.isNaN(awayProb)

  const probHome = clampNum(homeProb, 0, 1)
  const probDraw = clampNum(drawProb, 0, 1)
  const probAway = clampNum(awayProb, 0, 1)

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
          {league ? (
            <span style={{ marginLeft: 'auto', fontSize: 22, color: COLORS.textMuted }}>{league}</span>
          ) : (
            <span style={{ marginLeft: 'auto', fontSize: 18, color: COLORS.textMuted }}>Match #{matchId}</span>
          )}
        </div>

        {/* match line */}
        <div
          style={{
            marginTop: 72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              flex: 1,
              gap: 8,
            }}
          >
            <span style={{ fontSize: 24, color: COLORS.textMuted }}>HOME</span>
            <span style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>{home}</span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '12px 28px',
              borderRadius: 18,
              background: 'rgba(15, 26, 44, 0.5)',
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <span style={{ fontSize: 18, color: COLORS.textMuted, letterSpacing: 2 }}>PREDICTED</span>
            <span style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2 }}>
              {homeScore ?? '?'} - {awayScore ?? '?'}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              flex: 1,
              gap: 8,
            }}
          >
            <span style={{ fontSize: 24, color: COLORS.textMuted }}>AWAY</span>
            <span style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, textAlign: 'right' }}>
              {away}
            </span>
          </div>
        </div>

        {/* probability bars */}
        {hasProbs ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              marginTop: 64,
            }}
          >
            <ProbabilityRow label={`${home} win`} value={probHome} color={COLORS.primary} />
            <ProbabilityRow label="Draw" value={probDraw} color={COLORS.warn} />
            <ProbabilityRow label={`${away} win`} value={probAway} color={COLORS.loss} />
          </div>
        ) : (
          <div
            style={{
              marginTop: 80,
              fontSize: 30,
              color: COLORS.textMuted,
              display: 'flex',
            }}
          >
            AI-powered match predictions across the world&apos;s leagues
          </div>
        )}

        {/* footer */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 20,
            color: COLORS.textMuted,
          }}
        >
          <span>fotpredict.ai</span>
          <span>Neural ensemble v5.1 · 66 features</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
