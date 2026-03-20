'use client';

import React from 'react';

interface TeamFormProps {
  form: string[];
  showLabels?: boolean;
  size?: 'sm' | 'md' | 'lg';
  matchDetails?: Array<{
    date?: string;
    opponent?: string;
    venue?: string;
    goals_for?: number;
    goals_against?: number;
  }>;
}

export default function TeamForm({ form, showLabels = false, size = 'md', matchDetails = [] }: TeamFormProps) {
  const sizeClasses = {
    sm: 'min-w-8 h-8 text-[11px]',
    md: 'min-w-10 h-10 text-xs',
    lg: 'min-w-12 h-12 text-sm',
  };
  
  const getResultColor = (result: string) => {
    switch (result.toUpperCase()) {
      case 'W':
        return 'bg-emerald-500 text-white';
      case 'D':
        return 'bg-amber-400 text-slate-950';
      case 'L':
        return 'bg-rose-500 text-white';
      default:
        return 'bg-gray-200 text-gray-600';
    }
  };

  const getResultLabel = (result: string) => {
    switch (result.toUpperCase()) {
      case 'W':
        return 'Win';
      case 'D':
        return 'Draw';
      case 'L':
        return 'Loss';
      default:
        return result;
    }
  };

  const formPoints = form.reduce((acc, r) => {
    if (r.toUpperCase() === 'W') return acc + 3;
    if (r.toUpperCase() === 'D') return acc + 1;
    return acc;
  }, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5 flex-wrap">
        {form.map((result, index) => (
          <div
            key={index}
            className={`
              ${sizeClasses[size]} 
              ${getResultColor(result)}
              rounded-xl flex items-center justify-center font-bold
              transition-transform hover:scale-105 shadow-sm
            `}
            title={
              matchDetails[index]
                ? `${getResultLabel(result)} vs ${matchDetails[index].opponent || 'Opponent'}${matchDetails[index].venue ? ` (${matchDetails[index].venue})` : ''}${Number.isFinite(matchDetails[index].goals_for) && Number.isFinite(matchDetails[index].goals_against) ? ` · ${matchDetails[index].goals_for}-${matchDetails[index].goals_against}` : ''}`
                : getResultLabel(result)
            }
          >
            {result.toUpperCase()}
          </div>
        ))}
      </div>
      {matchDetails.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {matchDetails.slice(0, form.length).map((match, index) => (
            <div
              key={`${match.opponent || 'opponent'}-${index}`}
              className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50/80 dark:bg-gray-800/70"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${getResultColor(form[index] || '')}`}>
                  {(form[index] || '-').toUpperCase()}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {match.venue === 'home' ? 'Home' : match.venue === 'away' ? 'Away' : 'Match'}
                </span>
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900 dark:text-white truncate">
                {match.opponent || 'Opponent'}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {Number.isFinite(match.goals_for) && Number.isFinite(match.goals_against)
                    ? `${match.goals_for}-${match.goals_against}`
                    : 'Score N/A'}
                </span>
                <span>{match.date || ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {showLabels && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {formPoints} pts from last {form.length}
        </div>
      )}
    </div>
  );
}

interface TeamFormDetailedProps {
  teamName: string;
  form: string[];
  stats?: {
    wins: number;
    draws: number;
    losses: number;
    goalsScored: number;
    goalsConceded: number;
  };
  recentMatches?: Array<{
    date?: string;
    opponent?: string;
    venue?: string;
    goals_for?: number;
    goals_against?: number;
  }>;
}

export function TeamFormDetailed({ teamName, form, stats, recentMatches = [] }: TeamFormDetailedProps) {
  const formPoints = form.reduce((acc, r) => {
    if (r.toUpperCase() === 'W') return acc + 3;
    if (r.toUpperCase() === 'D') return acc + 1;
    return acc;
  }, 0);

  const wins = stats?.wins ?? form.filter(r => r.toUpperCase() === 'W').length;
  const draws = stats?.draws ?? form.filter(r => r.toUpperCase() === 'D').length;
  const losses = stats?.losses ?? form.filter(r => r.toUpperCase() === 'L').length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white">{teamName}</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Last {form.length} matches
        </span>
      </div>
      
      <div className="flex justify-center mb-4">
        <TeamForm form={form} size="lg" matchDetails={recentMatches} />
      </div>
      
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formPoints}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Points</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{wins}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Wins</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
          <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">{draws}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Draws</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{losses}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Losses</div>
        </div>
      </div>
      
      {stats && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Goals</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {stats.goalsScored} scored, {stats.goalsConceded} conceded
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
