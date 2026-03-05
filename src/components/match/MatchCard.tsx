'use client';

import React from 'react';

interface FormResult {
  result: 'W' | 'D' | 'L';
  score?: string;
}

interface H2HSummary {
  homeWins: number;
  draws: number;
  awayWins: number;
  totalMatches: number;
  lastMatchResult?: string; // e.g. "2-1"
}

interface MatchCardProps {
  match: {
    id: number;
    status: {
      started?: boolean;
      finished?: boolean;
      liveTime?: { short?: string };
      scoreStr?: string;
    };
    home: {
      name: string;
      shortName?: string;
      id: number;
    };
    away: {
      name: string;
      shortName?: string;
      id: number;
    };
    result?: {
      home: number;
      away: number;
    };
    time?: string;
  };
  league?: {
    id: number;
    name: string;
    country?: string;
  };
  showLeague?: boolean;
  onClick?: () => void;
  /** Optional referee name for the match */
  referee?: string;
  /** Optional head-to-head summary between the two teams */
  h2h?: H2HSummary;
  /** Last 5 form results for the home team */
  homeForm?: FormResult[];
  /** Last 5 form results for the away team */
  awayForm?: FormResult[];
  /** Whether to show the extra info sections (referee, H2H, form). Default: true when data is available */
  showExtras?: boolean;
}

const formColors: Record<string, string> = {
  W: 'bg-green-500',
  D: 'bg-amber-500',
  L: 'bg-red-400',
};

function FormBadges({ form, align = 'right' }: { form: FormResult[]; align?: 'left' | 'right' }) {
  return (
    <div className={`flex gap-0.5 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      {form.slice(0, 5).map((f, i) => (
        <span
          key={i}
          className={`w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center ${formColors[f.result] || 'bg-gray-400'}`}
          title={f.score ? `${f.result} (${f.score})` : f.result}
        >
          {f.result}
        </span>
      ))}
    </div>
  );
}

export default function MatchCard({ match, league, showLeague = true, onClick, referee, h2h, homeForm, awayForm, showExtras = true }: MatchCardProps) {
  const isLive = match.status?.started && !match.status?.finished;
  const isFinished = match.status?.finished;
  const isUpcoming = !match.status?.started;

  const homeScore = match.result?.home ?? '-';
  const awayScore = match.result?.away ?? '-';
  
  const liveMinute = match.status?.liveTime?.short || '';

  const hasExtras = showExtras && (referee || h2h || homeForm || awayForm);

  return (
    <div 
      className={`
        bg-[var(--card-bg)] rounded-xl shadow-sm hover:shadow-md 
        transition-all duration-200 cursor-pointer overflow-hidden
        border
        ${isLive ? 'ring-2 ring-green-500' : ''}
      `}
      style={{ borderColor: 'var(--border-color)' }}
      onClick={onClick}
    >
      {/* League Header */}
      {showLeague && league && (
        <div className="px-4 py-2 bg-[var(--muted-bg)] border-b" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-xs text-[var(--text-tertiary)] font-medium">
            {league.name}
          </span>
        </div>
      )}
      
      {/* Match Content */}
      <div className="p-4">
        {/* Team Form + Names + Score row */}
        <div className="flex items-center justify-between">
          {/* Home Team */}
          <div className="flex-1 text-right pr-4 space-y-1">
            <span className="font-medium text-[var(--text-primary)] text-sm md:text-base block">
              {match.home.shortName || match.home.name}
            </span>
            {showExtras && homeForm && homeForm.length > 0 && (
              <FormBadges form={homeForm} align="right" />
            )}
          </div>
          
          {/* Score / Time */}
          <div className="flex flex-col items-center min-w-[80px]">
            {isUpcoming ? (
              <span className="text-sm text-[var(--text-tertiary)]">
                {match.time || 'TBD'}
              </span>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-bold ${isLive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {homeScore}
                  </span>
                  <span className="text-[var(--text-tertiary)]">-</span>
                  <span className={`text-xl font-bold ${isLive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {awayScore}
                  </span>
                </div>
                {isLive && (
                  <span className="text-xs text-green-500 font-semibold animate-pulse mt-1">
                    {liveMinute}
                  </span>
                )}
                {isFinished && (
                  <span className="text-xs text-[var(--text-tertiary)] mt-1">FT</span>
                )}
              </>
            )}
          </div>
          
          {/* Away Team */}
          <div className="flex-1 text-left pl-4 space-y-1">
            <span className="font-medium text-[var(--text-primary)] text-sm md:text-base block">
              {match.away.shortName || match.away.name}
            </span>
            {showExtras && awayForm && awayForm.length > 0 && (
              <FormBadges form={awayForm} align="left" />
            )}
          </div>
        </div>
      </div>

      {/* Extra Info Section: Referee + H2H */}
      {hasExtras && (
        <div className="px-4 pb-3 pt-0">
          <div className="border-t pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-tertiary)]" style={{ borderColor: 'var(--border-color)' }}>
            {/* Referee */}
            {referee && (
              <span className="flex items-center gap-1">
                <span>👨‍⚖️</span>
                <span>{referee}</span>
              </span>
            )}
            {/* H2H */}
            {h2h && h2h.totalMatches > 0 && (
              <span className="flex items-center gap-1">
                <span>⚔️</span>
                <span>H2H: </span>
                <span className="text-green-500 font-semibold">{h2h.homeWins}W</span>
                <span>-</span>
                <span className="text-amber-500 font-semibold">{h2h.draws}D</span>
                <span>-</span>
                <span className="text-blue-500 font-semibold">{h2h.awayWins}W</span>
                <span className="text-[var(--text-tertiary)]">({h2h.totalMatches})</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
