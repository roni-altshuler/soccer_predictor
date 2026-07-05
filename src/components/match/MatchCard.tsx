'use client';

import React from 'react';
import Link from 'next/link';

import { ProbBar } from '@/components/primitives';

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
    venue?: string;
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
  prediction?: {
    home_win?: number;
    draw?: number;
    away_win?: number;
    confidence?: number;
    model?: string;
  };
  /** Whether to show the extra info sections (referee, H2H, form). Default: true when data is available */
  showExtras?: boolean;
}

const formColors: Record<string, string> = {
  W: 'bg-[var(--accent-primary)]',
  D: 'bg-[var(--accent-warn)]',
  L: 'bg-[var(--accent-loss)]',
};

function FormBadges({ form, align = 'right' }: { form: FormResult[]; align?: 'left' | 'right' }) {
  return (
    <div className={`flex gap-0.5 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      {form.slice(0, 5).map((f, i) => (
        <span
          key={i}
          className={`w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center ${formColors[f.result] || 'bg-[var(--text-tertiary)]'}`}
          title={f.score ? `${f.result} (${f.score})` : f.result}
        >
          {f.result}
        </span>
      ))}
    </div>
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pct(value: number): string {
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(0)}%`;
}

export default function MatchCard({ match, league, showLeague = true, onClick, referee, h2h, homeForm, awayForm, prediction, showExtras = true }: MatchCardProps) {
  const isLive = match.status?.started && !match.status?.finished;
  const isFinished = match.status?.finished;
  const isUpcoming = !match.status?.started;

  const homeScore = match.result?.home ?? '-';
  const awayScore = match.result?.away ?? '-';
  
  const liveMinute = match.status?.liveTime?.short || '';
  const venue = match.venue?.trim();
  const hasH2H = Boolean(h2h && h2h.totalMatches > 0);
  const hasHomeForm = Boolean(homeForm && homeForm.length > 0);
  const hasAwayForm = Boolean(awayForm && awayForm.length > 0);
  const homePrediction = prediction?.home_win;
  const drawPrediction = prediction?.draw;
  const awayPrediction = prediction?.away_win;
  const hasPrediction =
    isFiniteNumber(homePrediction) &&
    isFiniteNumber(drawPrediction) &&
    isFiniteNumber(awayPrediction);

  const hasExtras = showExtras && (referee || hasH2H || hasHomeForm || hasAwayForm);

  return (
    <div 
      className={`
        bg-[var(--card-bg)] rounded-xl shadow-sm hover:shadow-md 
        transition-all duration-200 cursor-pointer overflow-hidden
        border
        ${isLive ? 'ring-2 ring-[var(--accent-primary)]' : ''}
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
            {match.home.id ? (
              <Link
                href={`/teams/${match.home.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-[var(--text-primary)] text-sm md:text-base block hover:underline"
              >
                {match.home.shortName || match.home.name}
              </Link>
            ) : (
              <span className="font-medium text-[var(--text-primary)] text-sm md:text-base block">
                {match.home.shortName || match.home.name}
              </span>
            )}
            {showExtras && hasHomeForm && homeForm && (
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
                  <span className="text-xs text-[var(--accent-primary)] font-semibold animate-pulse mt-1">
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
            {match.away.id ? (
              <Link
                href={`/teams/${match.away.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-[var(--text-primary)] text-sm md:text-base block hover:underline"
              >
                {match.away.shortName || match.away.name}
              </Link>
            ) : (
              <span className="font-medium text-[var(--text-primary)] text-sm md:text-base block">
                {match.away.shortName || match.away.name}
              </span>
            )}
            {showExtras && hasAwayForm && awayForm && (
              <FormBadges form={awayForm} align="left" />
            )}
          </div>
        </div>

        {venue && (
          <p className="mt-3 text-center text-xs text-[var(--text-tertiary)]">{venue}</p>
        )}

        {hasPrediction && prediction && (
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border-color)' }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Model probabilities</span>
              {isFiniteNumber(prediction.confidence) && (
                <span className="text-[10px] font-semibold tabular-nums text-[var(--accent-ai)]">{pct(prediction.confidence)} confidence</span>
              )}
            </div>
            {/* Signature stacked W/D/L probability bar (design-language fixture anatomy) */}
            <ProbBar
              home={homePrediction}
              draw={drawPrediction}
              away={awayPrediction}
              showLabels
              size="md"
            />
            {prediction.model && (
              <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">{prediction.model}</p>
            )}
          </div>
        )}
      </div>

      {/* Extra Info Section: Referee + H2H */}
      {hasExtras && (
        <div className="px-4 pb-3 pt-0">
          <div className="border-t pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-tertiary)]" style={{ borderColor: 'var(--border-color)' }}>
            {/* Referee */}
            {referee && (
              <span className="flex items-center gap-1">
                <span className="font-semibold">Referee</span>
                <span>{referee}</span>
              </span>
            )}
            {/* H2H */}
            {hasH2H && h2h && (
              <span className="flex items-center gap-1">
                <span>H2H: </span>
                <span className="text-[var(--accent-primary)] font-semibold">{h2h.homeWins}W</span>
                <span>-</span>
                <span className="text-[var(--accent-warn)] font-semibold">{h2h.draws}D</span>
                <span>-</span>
                <span className="text-[var(--accent-info)] font-semibold">{h2h.awayWins}W</span>
                <span className="text-[var(--text-tertiary)]">({h2h.totalMatches})</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
