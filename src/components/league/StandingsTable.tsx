'use client';

import React from 'react';
import Link from 'next/link';

interface StandingsTableProps {
  standings: Array<{
    position: number;
    team_id?: number;
    team_name: string;
    team_logo?: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goals_for: number;
    goals_against: number;
    goal_difference: number;
    points: number;
    form?: string[];
  }>;
  highlightTeams?: number[];
  leagueName?: string;
}

export default function StandingsTable({ standings, highlightTeams = [], leagueName }: StandingsTableProps) {
  const getPositionColor = (position: number, total: number) => {
    if (position <= 4) return 'border-l-4 border-blue-500'; // Champions League
    if (position === 5) return 'border-l-4 border-orange-500'; // Europa League
    if (position === 6) return 'border-l-4 border-green-500'; // Conference League
    if (position > total - 3) return 'border-l-4 border-red-500'; // Relegation
    return '';
  };

  const getFormBadge = (result: string) => {
    switch (result.toUpperCase()) {
      case 'W':
        return 'bg-green-500 text-white';
      case 'D':
        return 'bg-gray-400 text-white';
      case 'L':
        return 'bg-red-500 text-white';
      default:
        return 'bg-gray-200';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden">
      {leagueName && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
          <h3 className="font-semibold text-gray-900 dark:text-white">{leagueName}</h3>
        </div>
      )}
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">Team</th>
              <th className="px-4 py-3 text-center">P</th>
              <th className="px-4 py-3 text-center">W</th>
              <th className="px-4 py-3 text-center">D</th>
              <th className="px-4 py-3 text-center">L</th>
              <th className="px-4 py-3 text-center hidden md:table-cell">GF</th>
              <th className="px-4 py-3 text-center hidden md:table-cell">GA</th>
              <th className="px-4 py-3 text-center">GD</th>
              <th className="px-4 py-3 text-center font-bold">Pts</th>
              <th className="px-4 py-3 text-center hidden lg:table-cell">Form</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {standings.map((row) => (
              <tr 
                key={row.position}
                className={`
                  hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors
                  ${getPositionColor(row.position, standings.length)}
                  ${highlightTeams.includes(row.team_id || 0) ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}
                `}
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-500">{row.position}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {row.team_logo && (
                      <img 
                        src={row.team_logo} 
                        alt={row.team_name}
                        className="w-6 h-6 object-contain"
                      />
                    )}
                    {row.team_id ? (
                      <Link
                        href={`/teams/${row.team_id}`}
                        className="font-medium text-gray-900 dark:text-white text-sm hover:underline"
                      >
                        {row.team_name}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        {row.team_name}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-300">{row.played}</td>
                <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-300">{row.won}</td>
                <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-300">{row.drawn}</td>
                <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-300">{row.lost}</td>
                <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-300 hidden md:table-cell">{row.goals_for}</td>
                <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-300 hidden md:table-cell">{row.goals_against}</td>
                <td className="px-4 py-3 text-center text-sm font-medium text-gray-900 dark:text-white">
                  {row.goal_difference > 0 ? '+' : ''}{row.goal_difference}
                </td>
                <td className="px-4 py-3 text-center text-sm font-bold text-gray-900 dark:text-white">{row.points}</td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {row.form && (
                    <div className="flex gap-1 justify-center">
                      {row.form.slice(0, 5).map((result, i) => (
                        <span
                          key={i}
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${getFormBadge(result)}`}
                        >
                          {result.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Legend */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-600">
        <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-500 rounded" />
            <span>Champions League</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-orange-500 rounded" />
            <span>Europa League</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500 rounded" />
            <span>Conference League</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500 rounded" />
            <span>Relegation</span>
          </div>
        </div>
      </div>
    </div>
  );
}
