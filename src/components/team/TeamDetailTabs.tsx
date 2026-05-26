'use client'

import React, { useEffect, useState } from 'react'
import MatchCard from '@/components/match/MatchCard'

type TabKey = 'overview' | 'squad' | 'stats' | 'injuries'

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  squad: 'Squad',
  stats: 'Stats',
  injuries: 'Injuries',
}

const TAB_ORDER: TabKey[] = ['overview', 'squad', 'stats', 'injuries']

interface SquadPlayer {
  player_id: string
  name: string
  position: string
  number: number | null
  nationality: string
}

interface InjuryRecord {
  player_id?: string | null
  name?: string | null
  status?: string | null
  reason?: string | null
}

interface FixtureLike {
  match_id: string
  kickoff?: string | null
  is_home: boolean
  venue?: string | null
  opponent: { id: string; name: string }
  self_score?: number | null
  opponent_score?: number | null
  status?: string | null
  status_detail?: string | null
  completed?: boolean
}

interface TeamStats {
  goals_per_match: number
  conceded_per_match: number
  clean_sheets: number | null
  possession_avg: number | null
}

interface TeamDetailTabsProps {
  teamName: string
  recentResults: FixtureLike[]
  upcomingFixtures: FixtureLike[]
  squad: SquadPlayer[]
  stats: TeamStats
  injuries: InjuryRecord[]
}

const POSITION_GROUPS: Array<{ key: string; label: string; matches: string[] }> = [
  { key: 'GK', label: 'Goalkeepers', matches: ['G', 'GK'] },
  { key: 'DEF', label: 'Defenders', matches: ['D', 'DEF', 'CB', 'LB', 'RB', 'LWB', 'RWB'] },
  { key: 'MID', label: 'Midfielders', matches: ['M', 'MID', 'CM', 'DM', 'AM', 'LM', 'RM'] },
  { key: 'FWD', label: 'Forwards', matches: ['F', 'FWD', 'ST', 'CF', 'LW', 'RW', 'SS'] },
]

function bucketPosition(raw: string): string {
  const pos = (raw || '').toUpperCase()
  for (const group of POSITION_GROUPS) {
    if (group.matches.some((m) => pos === m || pos.startsWith(m))) return group.key
  }
  return 'OTHER'
}

function fixtureToMatchCardProps(f: FixtureLike, teamName: string) {
  const isHome = !!f.is_home
  const opponent = f.opponent?.name || 'TBD'
  const homeName = isHome ? teamName : opponent
  const awayName = isHome ? opponent : teamName
  const homeScore = isHome ? f.self_score : f.opponent_score
  const awayScore = isHome ? f.opponent_score : f.self_score
  const completed = !!f.completed
  const started = completed || (f.status === 'in')

  return {
    id: Number(f.match_id) || 0,
    status: {
      started,
      finished: completed,
      scoreStr:
        homeScore != null && awayScore != null ? `${homeScore} - ${awayScore}` : undefined,
    },
    home: { name: homeName, id: 0 },
    away: { name: awayName, id: 0 },
    result:
      homeScore != null && awayScore != null
        ? { home: homeScore, away: awayScore }
        : undefined,
    time: f.kickoff ? new Date(f.kickoff).toLocaleString() : undefined,
    venue: f.venue || undefined,
  }
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-xl p-4 border"
      style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
    >
      <div className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--text-tertiary)]">{hint}</div>}
    </div>
  )
}

export default function TeamDetailTabs({
  teamName,
  recentResults,
  upcomingFixtures,
  squad,
  stats,
  injuries,
}: TeamDetailTabsProps) {
  const [active, setActive] = useState<TabKey>('overview')

  // Sync with URL hash on mount + when hash changes
  useEffect(() => {
    const apply = () => {
      const hash = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '')
      if (TAB_ORDER.includes(hash as TabKey)) {
        setActive(hash as TabKey)
      }
    }
    apply()
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', apply)
      return () => window.removeEventListener('hashchange', apply)
    }
  }, [])

  const setTab = (tab: TabKey) => {
    setActive(tab)
    if (typeof window !== 'undefined') {
      // Use replaceState to avoid spamming history.
      const url = new URL(window.location.href)
      url.hash = tab
      window.history.replaceState(null, '', url.toString())
    }
  }

  return (
    <div className="space-y-6">
      {/* Pill-style tab bar with horizontal scroll on mobile */}
      <div
        className="overflow-x-auto -mx-1 px-1"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div
          role="tablist"
          aria-label="Team detail sections"
          className="inline-flex gap-2 min-w-full rounded-xl p-1 border"
          style={{ backgroundColor: 'var(--muted-bg)', borderColor: 'var(--border-color)' }}
        >
          {TAB_ORDER.map((key) => {
            const isActive = key === active
            return (
              <button
                key={key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(key)}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                style={{
                  backgroundColor: isActive ? '#7c3aed' : 'transparent',
                }}
              >
                {TAB_LABELS[key]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Panels */}
      {active === 'overview' && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
              Recent Results
            </h2>
            {recentResults.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">No recent matches available.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {recentResults.map((f) => (
                  <MatchCard
                    key={f.match_id}
                    match={fixtureToMatchCardProps(f, teamName)}
                    showLeague={false}
                    showExtras={false}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
              Upcoming Fixtures
            </h2>
            {upcomingFixtures.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">No upcoming fixtures scheduled.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {upcomingFixtures.map((f) => (
                  <MatchCard
                    key={f.match_id}
                    match={fixtureToMatchCardProps(f, teamName)}
                    showLeague={false}
                    showExtras={false}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Mini Stats</h2>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <StatCard label="Goals / Match" value={stats.goals_per_match.toFixed(2)} />
              <StatCard label="Conceded / Match" value={stats.conceded_per_match.toFixed(2)} />
              <StatCard
                label="Clean Sheets"
                value={stats.clean_sheets != null ? String(stats.clean_sheets) : 'N/A'}
              />
              <StatCard
                label="Possession"
                value={stats.possession_avg != null ? `${stats.possession_avg}%` : 'N/A'}
              />
            </div>
          </section>
        </div>
      )}

      {active === 'squad' && (
        <div className="space-y-6">
          {squad.length === 0 ? (
            <p
              className="rounded-xl border px-4 py-6 text-center text-sm text-[var(--text-tertiary)]"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
            >
              Squad data not currently available.
            </p>
          ) : (
            POSITION_GROUPS.concat([{ key: 'OTHER', label: 'Other', matches: [] }]).map((group) => {
              const players = squad.filter((p) => bucketPosition(p.position) === group.key)
              if (players.length === 0) return null
              return (
                <section key={group.key}>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    {group.label}
                  </h3>
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {players.map((p) => (
                      <div
                        key={p.player_id || p.name}
                        className="rounded-xl border p-3 flex flex-col gap-1"
                        style={{
                          backgroundColor: 'var(--card-bg)',
                          borderColor: 'var(--border-color)',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="inline-flex items-center justify-center min-w-7 h-7 rounded-md text-xs font-bold text-white px-1.5"
                            style={{ backgroundColor: '#7c3aed' }}
                            title={p.position || group.key}
                          >
                            {p.position || group.key}
                          </span>
                          <span className="text-sm font-mono text-[var(--text-tertiary)]">
                            {p.number != null ? `#${p.number}` : ''}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                          {p.name}
                        </div>
                        {p.nationality && (
                          <div className="text-xs text-[var(--text-tertiary)]">{p.nationality}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </div>
      )}

      {active === 'stats' && (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            <StatCard
              label="Goals per Match"
              value={stats.goals_per_match.toFixed(2)}
              hint="Goals scored divided by matches played this season."
            />
            <StatCard
              label="Goals Conceded per Match"
              value={stats.conceded_per_match.toFixed(2)}
              hint="Goals allowed divided by matches played this season."
            />
            <StatCard
              label="Clean Sheets"
              value={stats.clean_sheets != null ? String(stats.clean_sheets) : 'N/A'}
              hint="Matches with zero goals conceded (when reported)."
            />
            <StatCard
              label="Possession Avg"
              value={stats.possession_avg != null ? `${stats.possession_avg}%` : 'N/A'}
              hint="Average share of possession across matches (when reported)."
            />
          </div>
        </div>
      )}

      {active === 'injuries' && (
        <div>
          {injuries.length === 0 ? (
            <p
              className="rounded-xl border px-4 py-6 text-center text-sm text-[var(--text-tertiary)]"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
            >
              No reported injuries.
            </p>
          ) : (
            <ul
              className="divide-y rounded-xl border overflow-hidden"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
            >
              {injuries.map((inj, i) => (
                <li
                  key={`${inj.player_id || inj.name || 'inj'}-${i}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {inj.name || 'Unknown player'}
                    </div>
                    {inj.reason && (
                      <div className="text-xs text-[var(--text-tertiary)] truncate">{inj.reason}</div>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold uppercase"
                    style={{
                      backgroundColor:
                        inj.status === 'out'
                          ? 'rgba(255, 99, 104, 0.15)'
                          : 'rgba(255, 175, 46, 0.15)',
                      color:
                        inj.status === 'out' ? 'var(--live-text)' : 'var(--warning)',
                    }}
                  >
                    {inj.status || 'unknown'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
