'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { leagues, leagueFlagUrls } from '@/data/leagues'

type LiveMatch = {
  home_team: string
  away_team: string
  home_score: number
  away_score: number
  minute: number
  status: string
  league: string
}

type TodayMatch = {
  id?: string
  home_team: string
  away_team: string
  home_score?: number
  away_score?: number
  time?: string
  status: string
  league: string
  leagueId?: string
  minute?: number | string
  venue?: string
}

function LiveScoresTicker() {
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    const fetchLive = async () => {
      try {
        const res = await fetch('/api/live_scores')
        if (res.ok) {
          const data = await res.json()
          setLiveMatches(data)
        }
      } catch (e) {
        console.error('Error fetching live scores:', e)
      } finally {
        setLoading(false)
      }
    }
    
    fetchLive()
    const interval = setInterval(fetchLive, 30000)
    return () => clearInterval(interval)
  }, [])
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 bg-[var(--muted-bg)] border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="w-4 h-4 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
        <span className="ml-2 text-[var(--text-secondary)] text-sm">Checking for live matches...</span>
      </div>
    )
  }
  
  if (liveMatches.length === 0) {
    return (
      <div className="flex items-center justify-center gap-3 py-3 bg-[var(--muted-bg)] border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
        <span className="text-[var(--text-secondary)] text-sm">No live matches at the moment</span>
        <Link href="/matches" className="text-[var(--accent-primary)] text-sm hover:opacity-80 transition-colors">
          View upcoming matches →
        </Link>
      </div>
    )
  }
  
  return (
    <div className="relative overflow-hidden border-b" style={{ backgroundColor: 'var(--live-bg)', borderColor: 'var(--live-border)' }}>
      <div className="flex items-center gap-6 py-3 px-4 overflow-x-auto">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-3 h-3 rounded-full bg-red-500 animate-ping" />
            <div className="w-2 h-2 rounded-full bg-red-500" />
          </div>
          <span style={{ color: 'var(--live-text)' }} className="font-bold text-xs uppercase tracking-wider">Live</span>
        </div>
        
        <div className="flex gap-6">
          {liveMatches.map((match, idx) => (
            <div key={idx} className="flex items-center gap-3 flex-shrink-0 px-4 py-1.5 rounded-lg bg-[var(--card-bg)] border" style={{ borderColor: 'var(--border-color)' }}>
              <span className="text-[var(--text-primary)] text-sm font-medium">{match.home_team}</span>
              <div className="flex items-center gap-1">
                <span className="text-xl font-bold text-[var(--text-primary)]">{match.home_score}</span>
                <span className="text-[var(--text-tertiary)]">-</span>
                <span className="text-xl font-bold text-[var(--text-primary)]">{match.away_score}</span>
              </div>
              <span className="text-[var(--text-primary)] text-sm font-medium">{match.away_team}</span>
              <span style={{ color: 'var(--live-text)' }} className="text-xs font-bold animate-pulse">{match.minute}&apos;</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Helper function to group matches by league
function groupMatchesByLeague(matches: TodayMatch[]): Record<string, TodayMatch[]> {
  return matches.reduce((acc, match) => {
    const league = match.league || 'Other'
    if (!acc[league]) {
      acc[league] = []
    }
    acc[league].push(match)
    return acc
  }, {} as Record<string, TodayMatch[]>)
}

// Helper to format time from ISO string
function formatMatchTime(timeStr?: string): string {
  if (!timeStr) return 'TBD'
  try {
    const date = new Date(timeStr)
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
  } catch {
    return 'TBD'
  }
}

// League flags mapping - using flagcdn.com for consistency
const leagueFlagCodes: Record<string, string> = {
  'Premier League': 'ENG',
  'La Liga': 'ES',
  'LaLiga': 'ES',
  'Serie A': 'IT',
  'Bundesliga': 'DE',
  'Ligue 1': 'FR',
  'Champions League': 'EU',
  'UEFA Champions League': 'EU',
  'Europa League': 'EU',
  'UEFA Europa League': 'EU',
  'FA Cup': 'ENG',
  'Copa del Rey': 'ES',
  'MLS': 'US',
  'FIFA World Cup': 'WORLD',
  'FIFA World Cup 2026': 'WORLD',
}

// Helper to get flag image URL
function getLeagueFlagUrl(league: string): string | null {
  const code = leagueFlagCodes[league]
  if (!code) return null
  return leagueFlagUrls[code] || null
}

function TodaysMatchesWidget() {
  const [matches, setMatches] = useState<{live: TodayMatch[], upcoming: TodayMatch[], completed: TodayMatch[]}>({
    live: [], upcoming: [], completed: []
  })
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    const fetchToday = async () => {
      try {
        const res = await fetch('/api/todays_matches')
        if (res.ok) {
          const data = await res.json()
          setMatches(data)
        }
      } catch (e) {
        console.error('Error fetching today matches:', e)
      } finally {
        setLoading(false)
      }
    }
    
    fetchToday()
    const interval = setInterval(fetchToday, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [])
  
  // Defensive: ensure matches has the expected structure
  const live = matches?.live || []
  const upcoming = matches?.upcoming || []
  const completed = matches?.completed || []
  
  // Combine all matches (live, upcoming, completed) and group by league
  const allMatches = [...live, ...upcoming, ...completed]
  const matchesByLeague = groupMatchesByLeague(allMatches)
  const leagueNames = Object.keys(matchesByLeague)
  const totalMatches = live.length + upcoming.length + completed.length
  
  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] backdrop-blur rounded-2xl border p-6" style={{ borderColor: 'var(--border-color)' }}>
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-6 bg-[var(--muted-bg)] rounded w-1/3" />
          <div className="h-20 bg-[var(--muted-bg)] rounded" />
          <div className="h-16 bg-[var(--muted-bg)] rounded" />
        </div>
      </div>
    )
  }
  
  return (
    <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border overflow-hidden shadow-xl" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className="px-6 py-4 bg-[var(--background-secondary)] border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span className="text-xl">📆</span>
            Today&apos;s Schedule
          </h3>
          <span className="text-sm text-[var(--text-secondary)]">{totalMatches} matches</span>
        </div>
      </div>
      
      {/* Matches by League */}
      <div className="max-h-[450px] overflow-y-auto">
        {leagueNames.length > 0 ? (
          <div>
            {leagueNames.map((league) => (
              <div key={league} className="bg-[var(--card-bg)]">
                {/* League Header */}
                <div className="px-4 py-3 bg-[var(--muted-bg)] flex items-center gap-2 sticky top-0 z-10 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  {getLeagueFlagUrl(league) ? (
                    <img 
                      src={getLeagueFlagUrl(league)!} 
                      alt={league}
                      className="w-5 h-auto rounded"
                    />
                  ) : (
                    <span className="text-lg">⚽</span>
                  )}
                  <span className="font-semibold text-[var(--text-primary)] text-sm">{league}</span>
                  <span className="text-xs text-[var(--text-tertiary)] ml-auto">{matchesByLeague[league].length} {matchesByLeague[league].length === 1 ? 'match' : 'matches'}</span>
                </div>
                
                {/* Matches List - subtle spacing instead of borders */}
                <div className="space-y-0.5 py-1 bg-[var(--muted-bg)]">
                  {matchesByLeague[league].map((match, idx) => (
                    <Link 
                      key={`${league}-${idx}`} 
                      href={match.id ? `/matches/${match.id}${match.leagueId ? `?league=${match.leagueId}` : ''}` : '/matches'}
                      className={`block px-4 py-3 cursor-pointer ${match.status === 'live' ? 'bg-[var(--live-bg)]' : 'bg-[var(--card-bg)] hover:bg-[var(--card-hover)]'} transition-colors`}
                    >
                      <div className="flex items-center">
                      {/* Home Team */}
                      <div className="flex-1 text-right pr-3">
                        <span className="text-sm text-[var(--text-primary)] font-medium">{match.home_team}</span>
                      </div>
                      
                      {/* Score or Time */}
                      <div className="w-28 flex-shrink-0 text-center">
                        {match.status === 'live' ? (
                          <div className="flex flex-col items-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-lg font-bold text-[var(--text-primary)]">{match.home_score}</span>
                              <span className="text-[var(--text-tertiary)]">-</span>
                              <span className="text-lg font-bold text-[var(--text-primary)]">{match.away_score}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                              <span className="text-xs font-semibold text-red-500">{match.minute ? `${match.minute}'` : 'LIVE'}</span>
                            </div>
                          </div>
                        ) : match.status === 'finished' || match.status === 'completed' ? (
                          <div className="flex flex-col items-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-lg font-bold text-[var(--text-secondary)]">{match.home_score}</span>
                              <span className="text-[var(--text-tertiary)]">-</span>
                              <span className="text-lg font-bold text-[var(--text-secondary)]">{match.away_score}</span>
                            </div>
                            <span className="text-xs text-[var(--text-tertiary)]">FT</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-semibold text-[var(--accent-primary)]">{formatMatchTime(match.time)}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Away Team */}
                      <div className="flex-1 text-left pl-3">
                        <span className="text-sm text-[var(--text-primary)] font-medium">{match.away_team}</span>
                      </div>
                      </div>
                      {/* Venue info */}
                      {match.venue && (
                        <div className="mt-1">
                          <span className="text-[10px] text-[var(--text-tertiary)]">📍 {match.venue}</span>
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10">
            <span className="text-4xl mb-3 block">⚽</span>
            <p className="text-[var(--text-secondary)] text-sm mb-2">No matches scheduled for today</p>
            <p className="text-[var(--text-tertiary)] text-xs">Check back later for updates</p>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="px-4 py-3 bg-[var(--muted-bg)] border-t" style={{ borderColor: 'var(--border-color)' }}>
        <Link href="/matches" className="text-[var(--accent-primary)] text-sm font-medium hover:opacity-80 transition-colors flex items-center justify-center gap-1">
          View full schedule
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  )
}

function QuickStatsCard({ icon, value, label, color }: { icon: string; value: string; label: string; color: string }) {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-2xl p-6 text-white shadow-xl`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-3xl font-bold">{value}</p>
          <p className="text-sm opacity-80 mt-1">{label}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  )
}

export default function Home() {
  const features = [
    {
      href: '/matches',
      icon: '📅',
      title: 'Match Calendar',
      description: 'Interactive calendar view with predictions and results comparison',
      color: 'from-indigo-500 to-purple-600'
    },
    {
      href: '/predict',
      icon: '🤖',
      title: 'AI Predictions',
      description: 'Machine learning predictions for any matchup across all leagues',
      color: 'from-emerald-500 to-teal-600'
    },
    {
      href: '/news',
      icon: '📰',
      title: 'Latest News',
      description: 'Stay updated with the latest soccer news from around the world',
      color: 'from-amber-500 to-orange-600'
    },
    {
      href: '/about',
      icon: '📊',
      title: 'About & Analytics',
      description: 'Learn about the prediction model and explore accuracy metrics',
      color: 'from-rose-500 to-pink-600'
    }
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {/* Live Scores Ticker */}
      <LiveScoresTicker />
      
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-primary)]/10 via-purple-600/5 to-transparent" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
        
        {/* Animated gradient orbs - only visible in dark mode */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-[var(--accent-primary)]/20 rounded-full blur-[100px] animate-pulse dark:block hidden" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] animate-pulse dark:block hidden" style={{ animationDelay: '1s' }} />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 mb-6 backdrop-blur-sm">
                <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)] animate-pulse" />
                <span className="text-sm font-medium text-[var(--accent-primary)]">Real-Time AI Predictions</span>
              </div>
              
              <h1 className="text-5xl md:text-7xl font-bold text-[var(--text-primary)] mb-6 tracking-tight leading-tight">
                Soccer Stats
                <span className="block bg-gradient-to-r from-[var(--accent-primary)] to-purple-500 bg-clip-text text-transparent">
                  Predictor
                </span>
              </h1>
              
              <p className="text-xl text-[var(--text-secondary)] max-w-xl mb-8 leading-relaxed">
                Advanced machine learning predictions powered by a <span className="text-[var(--text-primary)] font-semibold">neural ensemble + ELO + Poisson</span> model covering all major leagues.
              </p>
              
              <div className="flex flex-wrap gap-4">
                <Link 
                  href="/matches" 
                  className="group relative px-8 py-4 bg-gradient-to-r from-[var(--accent-primary)] to-emerald-600 text-white font-semibold rounded-xl shadow-xl hover:shadow-emerald-500/40 transition-all duration-300 flex items-center gap-2 overflow-hidden"
                >
                  <span className="relative z-10">View Calendar</span>
                  <svg className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                
                <Link 
                  href="/predict" 
                  className="px-8 py-4 bg-[var(--card-bg)] text-[var(--text-primary)] font-semibold rounded-xl border hover:border-[var(--accent-primary)] transition-all duration-300 backdrop-blur-sm"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  Make Prediction
                </Link>
              </div>
            </div>
            
            {/* Today's Matches Widget */}
            <div className="lg:pl-8">
              <TodaysMatchesWidget />
            </div>
          </div>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="relative -mt-8 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <QuickStatsCard icon="📊" value="1,100+" label="Predictions Made" color="from-indigo-600 to-indigo-700" />
            <QuickStatsCard icon="🎯" value="55" label="Feature Dimensions" color="from-emerald-600 to-emerald-700" />
            <QuickStatsCard icon="⚽" value="12" label="Leagues Covered" color="from-amber-600 to-amber-700" />
            <QuickStatsCard icon="🔄" value="8hrs" label="Auto Retrain" color="from-rose-600 to-rose-700" />
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-4">Powerful Features</h2>
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto">
            Explore our comprehensive suite of prediction tools and analytics
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => (
            <Link 
              key={feature.href} 
              href={feature.href}
              className="group relative bg-[var(--card-bg)] backdrop-blur-xl rounded-2xl p-6 border hover:border-[var(--accent-primary)]/50 transition-all duration-500 overflow-hidden"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {/* Gradient overlay on hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-10 transition-opacity duration-500`} />
              
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300 shadow-xl`}>
                <span className="text-2xl">{feature.icon}</span>
              </div>
              
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2 group-hover:text-[var(--accent-primary)] transition-colors">
                {feature.title}
              </h3>
              
              <p className="text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                {feature.description}
              </p>
              
              <div className="mt-4 flex items-center text-[var(--accent-primary)] text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Explore</span>
                <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Supported Leagues */}
      <section className="relative bg-[var(--background-secondary)] backdrop-blur-xl border-y" style={{ borderColor: 'var(--border-color)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-4">Supported Leagues</h2>
            <p className="text-[var(--text-secondary)]">Comprehensive coverage across the world&apos;s top competitions</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {leagues.map((league) => {
              // Map league names to ESPN IDs for navigation
              const leagueIdMap: Record<string, string> = {
                'Premier League': 'eng.1',
                'La Liga': 'esp.1',
                'Serie A': 'ita.1',
                'Bundesliga': 'ger.1',
                'Ligue 1': 'fra.1',
                'Eredivisie': 'ned.1',
                'Primeira Liga': 'por.1',
                'MLS': 'usa.1',
                'UEFA Champions League': 'uefa.champions',
                'UEFA Europa League': 'uefa.europa',
                'UEFA Conference League': 'uefa.europa.conf',
                'FIFA World Cup': 'fifa.world',
              }
              const leagueId = leagueIdMap[league.name] || ''
              
              return (
                <Link 
                  key={league.name}
                  href={leagueId ? `/matches?league=${leagueId}` : '/matches'}
                  className="group flex items-center gap-3 p-4 rounded-2xl bg-[var(--card-bg)] border hover:border-[var(--accent-primary)]/50 hover:scale-[1.02] hover:shadow-lg transition-all duration-300"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  {leagueFlagUrls[league.country] ? (
                    <img 
                      src={leagueFlagUrls[league.country]} 
                      alt={league.country}
                      className="w-6 h-auto rounded-sm shadow-sm"
                    />
                  ) : (
                    <span className="text-xs font-bold text-[var(--text-secondary)] bg-[var(--muted-bg)] px-2 py-1 rounded">{league.country}</span>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">{league.name}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{league.matches} matches/season</p>
                  </div>
                  <svg className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent-primary)] group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* Model Info Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 text-[var(--accent-primary)] text-sm font-medium mb-4">
              <span>🧠</span>
              <span>Unified AI Model</span>
            </div>
            <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
              Multi-Model Ensemble
            </h2>
            <p className="text-[var(--text-secondary)] mb-6 leading-relaxed">
              Our prediction engine combines a per-league neural ensemble (MLP + XGBoost + LightGBM + GradientBoosting + RandomForest) with ELO ratings and Dixon-Coles Poisson models for both outcome and scoreline predictions.
            </p>
            <ul className="space-y-3">
              {[
                'ELO ratings with league-specific coefficients',
                'Per-league neural models with 55-feature pipeline',
                'Market-implied probabilities + tactical stats + league characteristics',
                'Iterative feedback loop with automatic retraining via GitHub Actions'
              ].map((item, idx) => (
                <li key={idx} className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <div className="w-5 h-5 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center">
                    <svg className="w-3 h-3 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border p-8" style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-6">Rating Tiers</h3>
            <div className="space-y-4">
              {[
                { tier: 'Elite', range: '1700+', color: 'from-amber-400 to-amber-600', width: '100%' },
                { tier: 'Top Tier', range: '1600-1700', color: 'from-indigo-400 to-indigo-600', width: '85%' },
                { tier: 'Strong', range: '1500-1600', color: 'from-emerald-400 to-emerald-600', width: '70%' },
                { tier: 'Average', range: '1400-1500', color: 'from-slate-400 to-slate-600', width: '55%' },
                { tier: 'Below Average', range: '<1400', color: 'from-rose-400 to-rose-600', width: '40%' }
              ].map((item, idx) => (
                <div key={idx}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--text-primary)] font-medium">{item.tier}</span>
                    <span className="text-[var(--text-secondary)]">{item.range}</span>
                  </div>
                  <div className="h-2 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                    <div 
                      className={`h-full bg-gradient-to-r ${item.color} rounded-full`}
                      style={{ width: item.width }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-amber-500/10 backdrop-blur-xl rounded-2xl p-6 border border-amber-500/20">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xl">⚠️</span>
            </div>
            <div>
              <h3 className="font-semibold text-[var(--text-primary)] mb-2">Disclaimer</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                This tool is for educational and entertainment purposes only. Predictions are based on historical data and machine learning models. Soccer outcomes are inherently unpredictable. Do not use for betting purposes.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}