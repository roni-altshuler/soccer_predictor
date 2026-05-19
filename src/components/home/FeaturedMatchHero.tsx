'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export interface FeaturedMatchHeroProps {
  match: {
    matchId: string
    leagueId: string
    leagueName: string
    homeTeam: { id: string; name: string; logo?: string }
    awayTeam: { id: string; name: string; logo?: string }
    kickoff: string // ISO
    status: 'pre' | 'live' | 'final'
    score?: { home: number; away: number }
    venue?: string
    predictedProbs?: { homeWin: number; draw: number; awayWin: number }
    liveMinute?: number | string
  }
}

// Lightweight team-name → tint color map. Falls back to default gradient.
const TEAM_TINTS: Record<string, string> = {
  arsenal: '#ef4444',
  liverpool: '#dc2626',
  manchester: '#dc2626',
  'man united': '#dc2626',
  'man utd': '#dc2626',
  'man city': '#60a5fa',
  chelsea: '#3b82f6',
  tottenham: '#94a3b8',
  spurs: '#94a3b8',
  'real madrid': '#fbbf24',
  barcelona: '#a855f7',
  bayern: '#dc2626',
  juventus: '#e5e7eb',
  milan: '#ef4444',
  inter: '#3b82f6',
  psg: '#3b82f6',
}

function teamTint(name: string): string | null {
  const lower = name.toLowerCase()
  for (const key of Object.keys(TEAM_TINTS)) {
    if (lower.includes(key)) return TEAM_TINTS[key]
  }
  return null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Starting now'
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `Starts in ${days}d ${hours}h`
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`
  return `Starts in ${minutes}m`
}

function formatKickoffClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return ''
  }
}

function pct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)))
}

function TeamBlock({
  team,
  align,
}: {
  team: { id: string; name: string; logo?: string }
  align: 'left' | 'right'
}) {
  const tint = teamTint(team.name)
  return (
    <div
      className={`flex flex-col items-center gap-2 ${align === 'left' ? 'md:items-end' : 'md:items-start'} flex-1 min-w-0`}
    >
      {team.logo ? (
        <img
          src={team.logo}
          alt=""
          className="w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-lg"
        />
      ) : (
        <div
          className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center font-black text-xl md:text-2xl text-white shadow-lg ring-2 ring-white/10"
          style={{
            background: tint
              ? `linear-gradient(135deg, ${tint}, color-mix(in srgb, ${tint} 65%, #000))`
              : 'linear-gradient(135deg, var(--accent-primary), color-mix(in srgb, var(--accent-primary) 60%, #000))',
          }}
        >
          {initials(team.name)}
        </div>
      )}
      <p
        className={`text-xs md:text-sm font-bold text-[var(--text-primary)] text-center line-clamp-2 max-w-[120px] md:max-w-[160px] ${align === 'left' ? 'md:text-right' : 'md:text-left'}`}
      >
        {team.name}
      </p>
    </div>
  )
}

export default function FeaturedMatchHero({ match }: FeaturedMatchHeroProps) {
  // Defer `now` to after hydration to avoid SSR/client mismatch on countdown text.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    if (match.status !== 'pre') return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [match.status])

  const kickoffMs = (() => {
    const d = new Date(match.kickoff).getTime()
    return Number.isFinite(d) ? d : null
  })()

  const homeTint = teamTint(match.homeTeam.name)
  const awayTint = teamTint(match.awayTeam.name)
  const bgTintHome = homeTint || 'rgba(27, 214, 108, 0.18)'
  const bgTintAway = awayTint || 'rgba(33, 183, 255, 0.18)'

  const homePct = pct(match.predictedProbs?.homeWin ?? 0)
  const drawPct = pct(match.predictedProbs?.draw ?? 0)
  const awayPct = pct(match.predictedProbs?.awayWin ?? 0)
  const hasProbs = Boolean(
    match.predictedProbs &&
      (homePct > 0 || drawPct > 0 || awayPct > 0)
  )

  return (
    <section className="px-3 md:px-4 pt-3">
      <Link
        href={`/matches/${match.matchId}${match.leagueId ? `?league=${match.leagueId}` : ''}`}
        className="fm-hero block group focus:outline-none"
      >
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-md)] min-h-[260px] md:min-h-[300px]">
          {/* Background tint */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-90 pointer-events-none"
            style={{
              background: `radial-gradient(circle at 12% 30%, color-mix(in srgb, ${bgTintHome} 55%, transparent), transparent 55%), radial-gradient(circle at 88% 70%, color-mix(in srgb, ${bgTintAway} 55%, transparent), transparent 55%), linear-gradient(160deg, color-mix(in srgb, var(--card-bg) 88%, white 6%), var(--card-bg))`,
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 100%)',
            }}
          />

          <div className="relative p-4 md:p-6 flex flex-col gap-4">
            {/* Top: league pill + status */}
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--card-bg)]/70 backdrop-blur border border-[var(--border-color)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                <span className="text-[10px]">⚽</span>
                {match.leagueName}
              </span>
              {match.status === 'live' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/40 text-[10px] font-bold uppercase tracking-wider text-red-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                  </span>
                  Live {match.liveMinute ? `· ${match.liveMinute}'` : ''}
                </span>
              )}
              {match.status === 'final' && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Full time
                </span>
              )}
              {match.status === 'pre' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--accent-ai)]/15 border border-[var(--accent-ai)]/30 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-ai)]">
                  Featured · AI pick
                </span>
              )}
            </div>

            {/* Matchup row */}
            <div className="flex flex-col md:flex-row items-center md:items-stretch md:justify-between gap-3 md:gap-4">
              <TeamBlock team={match.homeTeam} align="left" />

              {/* Center meta */}
              <div className="flex flex-col items-center justify-center text-center min-w-[120px] md:min-w-[160px] gap-1">
                {match.status === 'live' && match.score ? (
                  <>
                    <p className="text-3xl md:text-5xl font-black text-[var(--text-primary)] tabular-nums leading-none">
                      {match.score.home}
                      <span className="mx-2 text-[var(--text-tertiary)] font-normal">
                        -
                      </span>
                      {match.score.away}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-red-400 mt-1">
                      {match.liveMinute ? `${match.liveMinute}'` : 'Live'}
                    </p>
                  </>
                ) : match.status === 'final' && match.score ? (
                  <>
                    <p className="text-3xl md:text-5xl font-black text-[var(--text-secondary)] tabular-nums leading-none">
                      {match.score.home}
                      <span className="mx-2 text-[var(--text-tertiary)] font-normal">
                        -
                      </span>
                      {match.score.away}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 mt-1">
                      Full time
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-lg md:text-2xl font-black text-[var(--text-primary)] leading-tight">
                      {kickoffMs && now != null
                        ? formatCountdown(kickoffMs - now)
                        : kickoffMs
                          ? formatKickoffClock(match.kickoff)
                          : 'Soon'}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                      Kickoff{' '}
                      {kickoffMs ? formatKickoffClock(match.kickoff) : 'TBD'}
                    </p>
                  </>
                )}
                {match.venue && (
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1 max-w-[180px] truncate">
                    {match.venue}
                  </p>
                )}
              </div>

              <TeamBlock team={match.awayTeam} align="right" />
            </div>

            {/* Probability bar */}
            {hasProbs ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold">
                  <span className="text-emerald-400">{homePct}% Home</span>
                  <span className="text-amber-400">{drawPct}% Draw</span>
                  <span className="text-blue-400">{awayPct}% Away</span>
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--muted-bg)] border border-[var(--border-color)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${homePct}%`,
                      background:
                        'linear-gradient(90deg, var(--accent-secondary), var(--accent-primary))',
                    }}
                  />
                  <div
                    className="h-full"
                    style={{
                      width: `${drawPct}%`,
                      background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                    }}
                  />
                  <div
                    className="h-full"
                    style={{
                      width: `${awayPct}%`,
                      background: 'linear-gradient(90deg, #60a5fa, #2563eb)',
                    }}
                  />
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: '#7c3aed' }}
                  />
                  AI model probabilities
                </p>
              </div>
            ) : (
              <div className="h-2" />
            )}

            {/* CTA */}
            <div className="flex items-center justify-end">
              <span
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-[#04120a] shadow-lg"
                style={{
                  background:
                    'linear-gradient(160deg, var(--accent-secondary), var(--accent-primary))',
                  boxShadow:
                    '0 8px 18px color-mix(in srgb, var(--surface-glow) 80%, transparent)',
                }}
              >
                View match
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </Link>
    </section>
  )
}
