'use client'

import { leagueNames as leagues, teams } from '@/data/leagues'

interface TeamSelectorProps {
  type: 'head-to-head' | 'cross-league'
  formData: any
  setFormData: (data: any) => void
}

export const TeamSelector = ({ type, formData, setFormData }: TeamSelectorProps) => {

  if (type === 'head-to-head') {
    return (
      <div className="space-y-6">
        {/* League Selector - Full Width Center */}
        <div>
          <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)] text-center">League</label>
          <div className="relative max-w-md mx-auto">
            <select
              value={formData.league}
              onChange={(e) => setFormData({ ...formData, league: e.target.value, home_team: '', away_team: '' })}
              className="appearance-none w-full bg-[var(--input-bg)] border-2 border-[var(--accent-primary)] text-[var(--text-primary)] text-lg rounded-lg py-3 px-5 pr-10 min-h-[44px] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] transition duration-300 ease-in-out shadow-sm"
            >
              <option value="">Select League</option>
              {leagues.map(league => (
                <option key={league} value={league}>{league}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--accent-primary)]">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
            </div>
          </div>
        </div>

        {/* Team Selectors - Side by Side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Home Team</label>
            <div className="relative">
              <select
                value={formData.home_team}
                onChange={(e) => setFormData({ ...formData, home_team: e.target.value })}
                className="appearance-none w-full bg-[var(--input-bg)] border-2 border-[var(--border-color)] text-[var(--text-primary)] text-lg rounded-lg py-3 px-5 pr-10 min-h-[44px] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] transition duration-300 ease-in-out shadow-sm"
                disabled={!formData.league}
              >
                <option value="">Select Home Team</option>
                {formData.league && teams[formData.league as keyof typeof teams].map(team => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Away Team</label>
            <div className="relative">
              <select
                value={formData.away_team}
                onChange={(e) => setFormData({ ...formData, away_team: e.target.value })}
                className="appearance-none w-full bg-[var(--input-bg)] border-2 border-[var(--border-color)] text-[var(--text-primary)] text-lg rounded-lg py-3 px-5 pr-10 min-h-[44px] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] transition duration-300 ease-in-out shadow-sm"
                disabled={!formData.league}
              >
                <option value="">Select Away Team</option>
                {formData.league && teams[formData.league as keyof typeof teams].map(team => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Cross-league mode
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Home Team League</label>
          <div className="relative">
            <select
              value={formData.league_a}
              onChange={(e) => setFormData({ ...formData, league_a: e.target.value, team_a: '' })}
              className="appearance-none w-full bg-[var(--input-bg)] border-2 border-[var(--border-color)] text-[var(--text-primary)] text-lg rounded-lg py-3 px-5 pr-10 min-h-[44px] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] transition duration-300 ease-in-out shadow-sm"
            >
              <option value="">Select League</option>
              {leagues.map(league => (
                <option key={league} value={league}>{league}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Home Team</label>
            <div className="relative">
              <select
                value={formData.team_a}
                onChange={(e) => setFormData({ ...formData, team_a: e.target.value })}
                className="appearance-none w-full bg-[var(--input-bg)] border-2 border-[var(--border-color)] text-[var(--text-primary)] text-lg rounded-lg py-3 px-5 pr-10 min-h-[44px] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] transition duration-300 ease-in-out shadow-sm"
                disabled={!formData.league_a}
              >
                <option value="">Select Team</option>
                {formData.league_a && teams[formData.league_a as keyof typeof teams].map(team => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Away Team League</label>
          <div className="relative">
            <select
              value={formData.league_b}
              onChange={(e) => setFormData({ ...formData, league_b: e.target.value, team_b: '' })}
              className="appearance-none w-full bg-[var(--input-bg)] border-2 border-[var(--border-color)] text-[var(--text-primary)] text-lg rounded-lg py-3 px-5 pr-10 min-h-[44px] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] transition duration-300 ease-in-out shadow-sm"
            >
              <option value="">Select League</option>
              {leagues.map(league => (
                <option key={league} value={league}>{league}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm font-medium mb-2 text-[var(--text-secondary)]">Away Team</label>
            <div className="relative">
              <select
                value={formData.team_b}
                onChange={(e) => setFormData({ ...formData, team_b: e.target.value })}
                className="appearance-none w-full bg-[var(--input-bg)] border-2 border-[var(--border-color)] text-[var(--text-primary)] text-lg rounded-lg py-3 px-5 pr-10 min-h-[44px] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] transition duration-300 ease-in-out shadow-sm"
                disabled={!formData.league_b}
              >
                <option value="">Select Team</option>
                {formData.league_b && teams[formData.league_b as keyof typeof teams].map(team => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}