'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  time: string;
  status: string;
  minute?: number;
  venue?: string;
}

interface MatchCalendarProps {
  leagueId: string;
  leagueName: string;
}

export default function MatchCalendar({ leagueId, leagueName }: MatchCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesByDate, setMatchesByDate] = useState<Record<string, Match[]>>({});
  const [loading, setLoading] = useState(false);

  // Get calendar data for current month
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startDay = firstDayOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = lastDayOfMonth.getDate();

  // Fetch matches for the current month
  useEffect(() => {
    const fetchMonthMatches = async () => {
      setLoading(true);
      const allMatches: Match[] = [];
      
      // Fetch for each day in the visible range (plus some buffer)
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);
      
      // Calculate date range as YYYYMMDD
      const formatDateESPN = (d: Date) => {
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      };
      
      try {
        // ESPN scoreboard endpoint provides current/recent matches
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueId}/scoreboard?dates=${formatDateESPN(startDate)}-${formatDateESPN(endDate)}`
        );
        
        if (res.ok) {
          const data = await res.json();
          for (const event of data.events || []) {
            const competition = event.competitions?.[0];
            const homeTeam = competition?.competitors?.find((c: any) => c.homeAway === 'home');
            const awayTeam = competition?.competitors?.find((c: any) => c.homeAway === 'away');
            const statusType = competition?.status?.type?.name || 'STATUS_SCHEDULED';
            
            let status = 'upcoming';
            let minute: number | undefined;
            if (statusType === 'STATUS_FINAL' || statusType === 'STATUS_FULL_TIME') {
              status = 'completed';
            } else if (statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME' || statusType.includes('HALF')) {
              status = 'live';
              minute = competition?.status?.displayClock ? parseInt(competition.status.displayClock, 10) : undefined;
            }
            
            allMatches.push({
              id: event.id,
              home_team: homeTeam?.team?.displayName || homeTeam?.team?.shortDisplayName || '',
              away_team: awayTeam?.team?.displayName || awayTeam?.team?.shortDisplayName || '',
              home_score: status !== 'upcoming' ? parseInt(homeTeam?.score || '0', 10) : null,
              away_score: status !== 'upcoming' ? parseInt(awayTeam?.score || '0', 10) : null,
              time: event.date || '',
              status,
              minute,
              venue: competition?.venue?.fullName,
            });
          }
        }
      } catch (e) {
        console.error('Error fetching calendar matches:', e);
      }
      
      // Group matches by date
      const grouped: Record<string, Match[]> = {};
      for (const match of allMatches) {
        // Cache the date string to avoid creating new Date objects repeatedly
        const matchDate = match.time ? new Date(match.time).toISOString().split('T')[0] : '';
        if (!matchDate) continue;
        if (!grouped[matchDate]) {
          grouped[matchDate] = [];
        }
        grouped[matchDate].push(match);
      }
      
      setMatches(allMatches);
      setMatchesByDate(grouped);
      setLoading(false);
    };

    fetchMonthMatches();
  }, [leagueId, year, month]);

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDate(null);
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDate(null);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const formatDateKey = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  const formatMatchTime = (timeStr: string): string => {
    try {
      const date = new Date(timeStr);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch {
      return 'TBD';
    }
  };

  const isToday = (day: number): boolean => {
    const today = new Date();
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const isSelected = (day: number): boolean => {
    if (!selectedDate) return false;
    return day === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear();
  };

  const getDayMatches = (day: number): Match[] => {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return matchesByDate[dateKey] || [];
  };

  const hasMatches = (day: number): boolean => {
    return getDayMatches(day).length > 0;
  };

  const selectedDayMatches = selectedDate ? getDayMatches(selectedDate.getDate()) : [];

  // Generate calendar days
  const calendarDays: (number | null)[] = [];
  
  // Empty cells for days before the first day of the month
  for (let i = 0; i < startDay; i++) {
    calendarDays.push(null);
  }
  
  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar */}
      <div className="lg:col-span-2">
        <div className="rounded-2xl border fm-card overflow-hidden" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
          {/* Calendar Header */}
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <button
              onClick={prevMonth}
              className="p-2 rounded-lg hover:bg-opacity-50 transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {monthNames[month]} {year}
              </h3>
              <button
                onClick={goToToday}
                className="rounded-lg bg-[var(--accent-primary)] px-3 py-1 text-sm font-semibold text-[var(--accent-on-primary)] transition-colors hover:opacity-90"
              >
                Today
              </button>
            </div>
            
            <button
              onClick={nextMonth}
              className="p-2 rounded-lg hover:bg-opacity-50 transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day Names */}
          <div className="grid grid-cols-7 border-b" style={{ borderColor: 'var(--border-color)' }}>
            {dayNames.map((day) => (
              <div key={day} className="p-2 text-center text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7">
            {calendarDays.map((day, index) => (
              <div
                key={index}
                onClick={() => day && setSelectedDate(new Date(year, month, day))}
                className={`
                  min-h-[70px] p-2 border-b border-r cursor-pointer transition-colors
                  ${day ? 'hover:bg-indigo-500/10' : ''}
                  ${isSelected(day || 0) ? 'bg-indigo-500/20' : ''}
                  ${isToday(day || 0) ? 'bg-amber-500/10' : ''}
                `}
                style={{ borderColor: 'var(--border-color)' }}
              >
                {day && (
                  <>
                    <div className={`text-sm font-medium mb-1 ${isToday(day) ? 'text-amber-500' : ''}`} style={{ color: isToday(day) ? undefined : 'var(--text-primary)' }}>
                      {day}
                    </div>
                    {hasMatches(day) && (
                      <div className="flex flex-wrap gap-1">
                        {getDayMatches(day).slice(0, 3).map((match, idx) => (
                          <div
                            key={idx}
                            className={`w-2 h-2 rounded-full ${
                              match.status === 'live' ? 'bg-red-500 animate-pulse' :
                              match.status === 'completed' ? 'bg-slate-500' :
                              'bg-indigo-500'
                            }`}
                            title={`${match.home_team} vs ${match.away_team}`}
                          />
                        ))}
                        {getDayMatches(day).length > 3 && (
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>+{getDayMatches(day).length - 3}</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          
          {/* Legend */}
          <div className="p-3 flex items-center gap-4 text-xs border-t" style={{ borderColor: 'var(--border-color)', color: 'var(--text-tertiary)' }}>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span>Upcoming</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span>Live</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-slate-500" />
              <span>Completed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Day Matches */}
      <div className="lg:col-span-1">
        <div className="rounded-2xl border fm-card overflow-hidden sticky top-4" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
          <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {selectedDate ? (
                <>
                  {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </>
              ) : (
                'Select a date'
              )}
            </h3>
            {selectedDate && (
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                {selectedDayMatches.length} {selectedDayMatches.length === 1 ? 'match' : 'matches'}
              </p>
            )}
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto" />
              </div>
            ) : selectedDayMatches.length > 0 ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {selectedDayMatches.map((match) => (
                  <Link
                    key={match.id}
                    href={`/matches/${match.id}?league=${leagueId}`}
                    className="block p-4 hover:bg-indigo-500/10 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {match.status === 'live' ? (
                        <span className="text-xs font-bold text-red-400 animate-pulse">LIVE</span>
                      ) : match.status === 'completed' ? (
                        <span className="text-xs text-slate-500">FT</span>
                      ) : (
                        <span className="text-xs text-indigo-400">{formatMatchTime(match.time)}</span>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{match.home_team}</p>
                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{match.away_team}</p>
                      </div>
                      
                      {match.status !== 'upcoming' && (
                        <div className="text-right">
                          <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{match.home_score}</p>
                          <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{match.away_score}</p>
                        </div>
                      )}
                    </div>
                    
                    {match.venue && (
                      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>{match.venue}</p>
                    )}
                  </Link>
                ))}
              </div>
            ) : selectedDate ? (
              <div className="p-8 text-center" style={{ color: 'var(--text-secondary)' }}>
                <span className="text-4xl mb-2 block">📅</span>
                <p>No matches on this date</p>
              </div>
            ) : (
              <div className="p-8 text-center" style={{ color: 'var(--text-secondary)' }}>
                <span className="text-4xl mb-2 block">👆</span>
                <p>Click on a date to see matches</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
